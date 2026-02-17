import { Hono } from 'hono';
import { z } from 'zod';
import { resolve as dnsResolve } from 'node:dns/promises';
import { db, dnsZones, dnsRecords, insertReturning, updateReturning, eq, and } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { dnsManager } from '../services/dns-provider-manager.js';
import { requireMember } from '../middleware/rbac.js';
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

// POST /zones — add a domain (creates zone in DB, syncs to providers best-effort)
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

dnsRoutes.post('/zones', requireMember, async (c) => {
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

  // Build the CNAME target for BYOD domains
  const account = c.get('account');
  const platformDomain = process.env['PLATFORM_DOMAIN'] ?? 'fleet.local';
  const cnameTarget = `${account?.slug ?? accountId}.${platformDomain}`;

  // Sync to DNS providers (best-effort)
  const warnings: string[] = [];

  const zoneResult = await dnsManager.createZone(domain, nameservers);
  warnings.push(...zoneResult.warnings);

  // Create a TXT verification record in providers
  const txtResult = await dnsManager.createRecord(
    domain,
    `_fleet-verify.${domain}`,
    'TXT',
    `"fleet-verify=${verificationToken}"`,
    3600,
  );
  warnings.push(...txtResult.warnings);

  // Insert into DB
  const resolvedNameservers = nameservers ?? [
    ...(process.env['NAMESERVERS']?.split(',').map(s => s.trim()) ?? ['ns1.fleet.local', 'ns2.fleet.local']),
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

  return c.json(
    {
      ...zone,
      verificationToken,
      cnameTarget,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
    201,
  );
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
dnsRoutes.delete('/zones/:id', requireMember, async (c) => {
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

  // Remove from providers (best-effort)
  await dnsManager.deleteZone(zone.domain);

  // Delete all records for this zone first, then the zone itself
  await db.delete(dnsRecords).where(eq(dnsRecords.zoneId, zoneId));
  await db.delete(dnsZones).where(eq(dnsZones.id, zoneId));

  return c.json({ message: 'Zone deleted' });
});

// POST /zones/:id/verify — verify domain ownership via DNS TXT record
dnsRoutes.post('/zones/:id/verify', requireMember, async (c) => {
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

  let token: string | undefined;
  try {
    const body = await c.req.json();
    token = body.token;
  } catch {
    // No body provided
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

  // Use Node's built-in dns.promises to verify the TXT record publicly
  let verified = false;
  try {
    const records = await dnsResolve(
      `_fleet-verify.${zone.domain}`,
      'TXT',
    ) as string[][];
    const flat = records.flat();
    verified = flat.some(
      (txt) =>
        txt === `fleet-verify=${token}` ||
        txt === token,
    );
  } catch {
    // DNS lookup failed — record not found yet
  }

  if (!verified) {
    return c.json(
      {
        error:
          'Verification failed. Ensure a TXT record for _fleet-verify.' +
          zone.domain +
          ' contains: fleet-verify=' +
          token,
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
dnsRoutes.post('/zones/:id/records', requireMember, async (c) => {
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

  const body = await c.req.json();
  const parsed = createRecordSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      400,
    );
  }

  const { type, name, content, ttl, priority } = parsed.data;

  // Sync to providers (best-effort)
  const result = await dnsManager.createRecord(zone.domain, name, type, content, ttl, priority);

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

  return c.json(
    {
      ...record,
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
    },
    201,
  );
});

// PATCH /records/:id — update a DNS record
dnsRoutes.patch('/records/:id', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const recordId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const record = await db.query.dnsRecords.findFirst({
    where: eq(dnsRecords.id, recordId),
    with: { zone: true },
  });

  if (!record) {
    return c.json({ error: 'Record not found' }, 404);
  }

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

  const finalName = updates.name ?? record.name;
  const finalType = updates.type ?? record.type;
  const finalContent = updates.content ?? record.content;
  const finalTtl = updates.ttl ?? record.ttl ?? 3600;
  const finalPriority = updates.priority ?? record.priority;

  // If name or type changed, delete the old record in providers first
  if (
    (updates.name && updates.name !== record.name) ||
    (updates.type && updates.type !== record.type)
  ) {
    await dnsManager.deleteRecord(record.zone.domain, record.name, record.type);
  }

  // Update in providers (best-effort)
  const result = await dnsManager.updateRecord(
    record.zone.domain,
    finalName,
    finalType,
    finalContent,
    finalTtl,
    finalPriority ?? undefined,
  );

  // Update in DB
  const [updated] = await updateReturning(dnsRecords, {
    ...(updates.name !== undefined && { name: updates.name }),
    ...(updates.type !== undefined && { type: updates.type }),
    ...(updates.content !== undefined && { content: updates.content }),
    ...(updates.ttl !== undefined && { ttl: updates.ttl }),
    ...(updates.priority !== undefined && { priority: updates.priority }),
    updatedAt: new Date(),
  }, eq(dnsRecords.id, recordId));

  return c.json({
    ...updated,
    warnings: result.warnings.length > 0 ? result.warnings : undefined,
  });
});

// DELETE /records/:id — delete a DNS record
dnsRoutes.delete('/records/:id', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const recordId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const record = await db.query.dnsRecords.findFirst({
    where: eq(dnsRecords.id, recordId),
    with: { zone: true },
  });

  if (!record) {
    return c.json({ error: 'Record not found' }, 404);
  }

  if (record.zone.accountId !== accountId) {
    return c.json({ error: 'Record not found' }, 404);
  }

  // Delete from providers (best-effort)
  await dnsManager.deleteRecord(record.zone.domain, record.name, record.type);

  // Delete from DB
  await db.delete(dnsRecords).where(eq(dnsRecords.id, recordId));

  return c.json({ message: 'Record deleted' });
});

export default dnsRoutes;
