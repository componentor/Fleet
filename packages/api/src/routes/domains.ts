import { Hono } from 'hono';
import { z } from 'zod';
import { db, dnsZones, dnsRecords, insertReturning, updateReturning, eq, and } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { dnsService } from '../services/dns.service.js';
import { randomUUID } from 'crypto';

const dnsRoutes = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

dnsRoutes.use('*', authMiddleware);
dnsRoutes.use('*', tenantMiddleware);

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

// GET /zones — list DNS zones for current account
dnsRoutes.get('/zones', async (c) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const zones = await db.query.dnsZones.findMany({
    where: eq(dnsZones.accountId, accountId),
    orderBy: (z, { desc }) => desc(z.createdAt),
  });

  return c.json(zones);
});

// POST /zones — add a domain (creates zone in PowerDNS + DB)
const createZoneSchema = z.object({
  domain: z
    .string()
    .min(1)
    .max(255)
    .regex(
      /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
      'Invalid domain format',
    ),
  nameservers: z.array(z.string()).optional(),
});

dnsRoutes.post('/zones', async (c) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = createZoneSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      400,
    );
  }

  const { domain, nameservers } = parsed.data;

  // Check if domain already exists in our DB
  const existing = await db.query.dnsZones.findFirst({
    where: eq(dnsZones.domain, domain),
  });

  if (existing) {
    return c.json({ error: 'Domain already exists' }, 409);
  }

  // Generate a verification token
  const verificationToken = randomUUID();

  // Create zone in PowerDNS
  try {
    await dnsService.createZone(domain, nameservers);
  } catch (err) {
    console.error('Failed to create PowerDNS zone:', err);
    return c.json({ error: 'Failed to create DNS zone in provider' }, 500);
  }

  // Create a TXT verification record in PowerDNS
  try {
    await dnsService.createRecord(
      domain,
      `_fleet-verify.${domain}`,
      'TXT',
      `"${verificationToken}"`,
      3600,
    );
  } catch (err) {
    console.error('Failed to create verification TXT record:', err);
    // Zone was created, continue — verification can be retried
  }

  // Insert into DB
  const resolvedNameservers = nameservers ?? [
    'ns1.fleet.local',
    'ns2.fleet.local',
  ];

  const [zone] = await insertReturning(dnsZones, {
    accountId,
    domain,
    verified: false,
    nameservers: resolvedNameservers,
  });

  if (!zone) {
    return c.json({ error: 'Failed to create zone record' }, 500);
  }

  return c.json({ ...zone, verificationToken }, 201);
});

// GET /zones/:id — zone details + records
dnsRoutes.get('/zones/:id', async (c) => {
  const accountId = c.get('accountId');
  const zoneId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const zone = await db.query.dnsZones.findFirst({
    where: and(eq(dnsZones.id, zoneId), eq(dnsZones.accountId, accountId)),
    with: {
      records: {
        orderBy: (r, { asc }) => asc(r.name),
      },
    },
  });

  if (!zone) {
    return c.json({ error: 'Zone not found' }, 404);
  }

  return c.json(zone);
});

// DELETE /zones/:id — remove domain
dnsRoutes.delete('/zones/:id', async (c) => {
  const accountId = c.get('accountId');
  const zoneId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const zone = await db.query.dnsZones.findFirst({
    where: and(eq(dnsZones.id, zoneId), eq(dnsZones.accountId, accountId)),
  });

  if (!zone) {
    return c.json({ error: 'Zone not found' }, 404);
  }

  // Remove from PowerDNS
  try {
    await dnsService.deleteZone(zone.domain);
  } catch (err) {
    console.error('Failed to delete PowerDNS zone:', err);
    // Continue with DB cleanup even if PowerDNS removal fails
  }

  // Delete all records for this zone first, then the zone itself
  await db.delete(dnsRecords).where(eq(dnsRecords.zoneId, zoneId));
  await db.delete(dnsZones).where(eq(dnsZones.id, zoneId));

  return c.json({ message: 'Zone deleted' });
});

// POST /zones/:id/verify — verify domain ownership via TXT record
dnsRoutes.post('/zones/:id/verify', async (c) => {
  const accountId = c.get('accountId');
  const zoneId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const zone = await db.query.dnsZones.findFirst({
    where: and(eq(dnsZones.id, zoneId), eq(dnsZones.accountId, accountId)),
  });

  if (!zone) {
    return c.json({ error: 'Zone not found' }, 404);
  }

  if (zone.verified) {
    return c.json({ message: 'Domain is already verified', verified: true });
  }

  // Attempt to read the body for a token, or use a lookup approach
  let token: string | undefined;
  try {
    const body = await c.req.json();
    token = body.token;
  } catch {
    // No body provided — that's fine
  }

  if (!token) {
    return c.json(
      {
        error:
          'Verification token is required. Provide the token that was returned when the zone was created.',
      },
      400,
    );
  }

  // Check PowerDNS for the verification TXT record
  const verified = await dnsService.verifyDomain(zone.domain, token);

  if (!verified) {
    return c.json(
      {
        error:
          'Verification failed. Ensure the TXT record _fleet-verify is configured correctly.',
        verified: false,
      },
      422,
    );
  }

  // Mark as verified in DB
  const [updated] = await updateReturning(dnsZones, { verified: true, updatedAt: new Date() }, eq(dnsZones.id, zoneId));

  return c.json({ message: 'Domain verified successfully', verified: true, zone: updated });
});

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

const dnsRecordTypes = [
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'TXT',
  'NS',
  'SRV',
  'CAA',
  'PTR',
  'SOA',
] as const;

const createRecordSchema = z.object({
  type: z.enum(dnsRecordTypes),
  name: z.string().min(1).max(255),
  content: z.string().min(1).max(4096),
  ttl: z.number().int().min(60).max(86400).default(3600),
  priority: z.number().int().min(0).max(65535).optional(),
});

const updateRecordSchema = z.object({
  type: z.enum(dnsRecordTypes).optional(),
  name: z.string().min(1).max(255).optional(),
  content: z.string().min(1).max(4096).optional(),
  ttl: z.number().int().min(60).max(86400).optional(),
  priority: z.number().int().min(0).max(65535).optional(),
});

// GET /zones/:id/records — list records for a zone
dnsRoutes.get('/zones/:id/records', async (c) => {
  const accountId = c.get('accountId');
  const zoneId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Verify zone belongs to account
  const zone = await db.query.dnsZones.findFirst({
    where: and(eq(dnsZones.id, zoneId), eq(dnsZones.accountId, accountId)),
  });

  if (!zone) {
    return c.json({ error: 'Zone not found' }, 404);
  }

  const records = await db.query.dnsRecords.findMany({
    where: eq(dnsRecords.zoneId, zoneId),
    orderBy: (r, { asc }) => asc(r.name),
  });

  return c.json(records);
});

// POST /zones/:id/records — create a DNS record
dnsRoutes.post('/zones/:id/records', async (c) => {
  const accountId = c.get('accountId');
  const zoneId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Verify zone belongs to account
  const zone = await db.query.dnsZones.findFirst({
    where: and(eq(dnsZones.id, zoneId), eq(dnsZones.accountId, accountId)),
  });

  if (!zone) {
    return c.json({ error: 'Zone not found' }, 404);
  }

  const body = await c.req.json();
  const parsed = createRecordSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      400,
    );
  }

  const { type, name, content, ttl, priority } = parsed.data;

  // Create in PowerDNS
  try {
    await dnsService.createRecord(zone.domain, name, type, content, ttl, priority);
  } catch (err) {
    console.error('Failed to create PowerDNS record:', err);
    return c.json({ error: 'Failed to create DNS record in provider' }, 500);
  }

  // Insert into DB
  const [record] = await insertReturning(dnsRecords, {
    zoneId,
    type,
    name,
    content,
    ttl,
    priority: priority ?? null,
  });

  if (!record) {
    return c.json({ error: 'Failed to create record' }, 500);
  }

  return c.json(record, 201);
});

// PATCH /records/:id — update a DNS record
dnsRoutes.patch('/records/:id', async (c) => {
  const accountId = c.get('accountId');
  const recordId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Find the record and its zone
  const record = await db.query.dnsRecords.findFirst({
    where: eq(dnsRecords.id, recordId),
    with: { zone: true },
  });

  if (!record) {
    return c.json({ error: 'Record not found' }, 404);
  }

  // Verify zone belongs to account
  if (record.zone.accountId !== accountId) {
    return c.json({ error: 'Record not found' }, 404);
  }

  const body = await c.req.json();
  const parsed = updateRecordSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      400,
    );
  }

  const updates = parsed.data;

  // Resolve final values (merge existing with updates)
  const finalName = updates.name ?? record.name;
  const finalType = updates.type ?? record.type;
  const finalContent = updates.content ?? record.content;
  const finalTtl = updates.ttl ?? record.ttl ?? 3600;
  const finalPriority = updates.priority ?? record.priority;

  // If name or type changed, delete the old record in PowerDNS first
  if (
    (updates.name && updates.name !== record.name) ||
    (updates.type && updates.type !== record.type)
  ) {
    try {
      await dnsService.deleteRecord(record.zone.domain, record.name, record.type);
    } catch (err) {
      console.error('Failed to delete old PowerDNS record:', err);
    }
  }

  // Update in PowerDNS
  try {
    await dnsService.updateRecord(
      record.zone.domain,
      finalName,
      finalType,
      finalContent,
      finalTtl,
      finalPriority ?? undefined,
    );
  } catch (err) {
    console.error('Failed to update PowerDNS record:', err);
    return c.json({ error: 'Failed to update DNS record in provider' }, 500);
  }

  // Update in DB
  const [updated] = await updateReturning(dnsRecords, {
    ...(updates.name !== undefined && { name: updates.name }),
    ...(updates.type !== undefined && { type: updates.type }),
    ...(updates.content !== undefined && { content: updates.content }),
    ...(updates.ttl !== undefined && { ttl: updates.ttl }),
    ...(updates.priority !== undefined && { priority: updates.priority }),
    updatedAt: new Date(),
  }, eq(dnsRecords.id, recordId));

  return c.json(updated);
});

// DELETE /records/:id — delete a DNS record
dnsRoutes.delete('/records/:id', async (c) => {
  const accountId = c.get('accountId');
  const recordId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Find the record and its zone
  const record = await db.query.dnsRecords.findFirst({
    where: eq(dnsRecords.id, recordId),
    with: { zone: true },
  });

  if (!record) {
    return c.json({ error: 'Record not found' }, 404);
  }

  // Verify zone belongs to account
  if (record.zone.accountId !== accountId) {
    return c.json({ error: 'Record not found' }, 404);
  }

  // Delete from PowerDNS
  try {
    await dnsService.deleteRecord(record.zone.domain, record.name, record.type);
  } catch (err) {
    console.error('Failed to delete PowerDNS record:', err);
    // Continue with DB cleanup
  }

  // Delete from DB
  await db.delete(dnsRecords).where(eq(dnsRecords.id, recordId));

  return c.json({ message: 'Record deleted' });
});

export default dnsRoutes;
