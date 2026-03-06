import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { resolve as dnsResolve } from 'node:dns/promises';
import { db, dnsZones, dnsRecords, domainRegistrations, services, insertReturning, updateReturning, safeTransaction, eq, and, or, like, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { dnsManager } from '../services/dns-provider-manager.js';
import { requireMember } from '../middleware/rbac.js';
import { randomUUID } from 'crypto';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';
import { logger, logToErrorTable } from '../services/logger.js';
import { getPlatformDomain } from './settings.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

const dnsRoutes = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

dnsRoutes.use('*', authMiddleware);
dnsRoutes.use('*', tenantMiddleware);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

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

const verifyZoneSchema = z.object({
  token: z.string().optional(),
});

const nameserverSchema = z.object({
  nameservers: z.array(
    z.string().min(1).max(253).regex(/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/, 'Invalid nameserver hostname')
  ).min(2).max(13),
});

const zoneIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Zone ID' }),
});

const recordIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Record ID' }),
});

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

const listZonesRoute = createRoute({
  method: 'get',
  path: '/zones',
  tags: ['DNS'],
  summary: 'List DNS zones for current account',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(z.any()), 'List of DNS zones'),
    ...standardErrors,
  },
});

const createZoneRoute = createRoute({
  method: 'post',
  path: '/zones',
  tags: ['DNS'],
  summary: 'Add a domain (creates zone)',
  security: bearerSecurity,
  middleware: [requireMember] as const,
  request: {
    body: jsonBody(createZoneSchema),
  },
  responses: {
    ...standardErrors,
    201: jsonContent(z.any(), 'Zone created'),
    409: jsonContent(errorResponseSchema, 'Domain already exists'),
  },
});

const getZoneRoute = createRoute({
  method: 'get',
  path: '/zones/{id}',
  tags: ['DNS'],
  summary: 'Get zone details with records',
  security: bearerSecurity,
  request: {
    params: zoneIdParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Zone details with records'),
    ...standardErrors,
  },
});

const getZoneServicesRoute = createRoute({
  method: 'get',
  path: '/zones/{id}/services',
  tags: ['DNS'],
  summary: 'Get services bound to a domain zone',
  security: bearerSecurity,
  middleware: [requireMember] as const,
  request: {
    params: zoneIdParamSchema,
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.object({
      services: z.array(z.object({
        id: z.string(),
        name: z.string(),
        stackId: z.string().nullable(),
        status: z.string(),
        volumes: z.array(z.object({ source: z.string(), target: z.string() })),
      })),
    }), 'Services using this domain'),
  },
});

const deleteZoneRoute = createRoute({
  method: 'delete',
  path: '/zones/{id}',
  tags: ['DNS'],
  summary: 'Remove a domain',
  security: bearerSecurity,
  middleware: [requireMember] as const,
  request: {
    params: zoneIdParamSchema,
    body: {
      content: { 'application/json': { schema: z.object({
        deleteServices: z.array(z.string().uuid()).optional(),
        deleteVolumes: z.array(z.string()).optional(),
      }).optional() } },
      required: false,
    },
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Zone deleted'),
  },
});

const verifyZoneRoute = createRoute({
  method: 'post',
  path: '/zones/{id}/verify',
  tags: ['DNS'],
  summary: 'Verify domain ownership via DNS TXT record',
  security: bearerSecurity,
  middleware: [requireMember] as const,
  request: {
    params: zoneIdParamSchema,
    body: jsonBody(verifyZoneSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Verification result'),
    422: jsonContent(errorResponseSchema, 'Verification failed'),
  },
});

const listRecordsRoute = createRoute({
  method: 'get',
  path: '/zones/{id}/records',
  tags: ['DNS'],
  summary: 'List records for a zone',
  security: bearerSecurity,
  request: {
    params: zoneIdParamSchema,
  },
  responses: {
    200: jsonContent(z.array(z.any()), 'List of DNS records'),
    ...standardErrors,
  },
});

const createRecordRoute = createRoute({
  method: 'post',
  path: '/zones/{id}/records',
  tags: ['DNS'],
  summary: 'Create a DNS record',
  security: bearerSecurity,
  middleware: [requireMember] as const,
  request: {
    params: zoneIdParamSchema,
    body: jsonBody(createRecordSchema),
  },
  responses: {
    ...standardErrors,
    201: jsonContent(z.any(), 'Record created'),
  },
});

const updateRecordRoute = createRoute({
  method: 'patch',
  path: '/records/{id}',
  tags: ['DNS'],
  summary: 'Update a DNS record',
  security: bearerSecurity,
  middleware: [requireMember] as const,
  request: {
    params: recordIdParamSchema,
    body: jsonBody(updateRecordSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Updated record'),
    ...standardErrors,
  },
});

const deleteRecordRoute = createRoute({
  method: 'delete',
  path: '/records/{id}',
  tags: ['DNS'],
  summary: 'Delete a DNS record',
  security: bearerSecurity,
  middleware: [requireMember] as const,
  request: {
    params: recordIdParamSchema,
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'Record deleted'),
  },
});

const updateNameserversRoute = createRoute({
  method: 'patch',
  path: '/zones/{id}/nameservers',
  tags: ['DNS'],
  summary: 'Update nameservers for a zone',
  security: bearerSecurity,
  middleware: [requireMember] as const,
  request: {
    params: zoneIdParamSchema,
    body: jsonBody(nameserverSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Nameservers updated'),
    ...standardErrors,
  },
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// GET /zones
dnsRoutes.openapi(listZonesRoute, (async (c: any) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const zones = await db.query.dnsZones.findMany({
    where: eq(dnsZones.accountId, accountId),
    orderBy: (z: any, { desc }: any) => desc(z.createdAt),
  });

  return c.json(zones);
}) as any);

// POST /zones
dnsRoutes.openapi(createZoneRoute, (async (c: any) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { domain, nameservers } = c.req.valid('json');

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
  const platformDomain = await getPlatformDomain();
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
    verificationToken,
    nameservers: resolvedNameservers,
  });

  if (!zone) {
    return c.json({ error: 'Failed to create zone record' }, 500);
  }

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.DNS_ZONE_CREATED,
    description: `Added DNS zone '${domain}'`,
    resourceType: 'dns_zone',
    resourceId: zone.id,
    resourceName: domain,
  });

  return c.json(
    {
      ...zone,
      verificationToken,
      cnameTarget,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
    201,
  );
}) as any);

// GET /zones/:id
dnsRoutes.openapi(getZoneRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: zoneId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const zone = await db.query.dnsZones.findFirst({
    where: and(eq(dnsZones.id, zoneId), eq(dnsZones.accountId, accountId)),
    with: {
      records: {
        orderBy: (r: any, { asc }: any) => asc(r.name),
      },
    },
  });

  if (!zone) {
    return c.json({ error: 'Zone not found' }, 404);
  }

  // For unverified zones, include the CNAME target so the UI can show DNS instructions
  if (!zone.verified) {
    const account = c.get('account');
    const platformDomain = await getPlatformDomain();
    const cnameTarget = `${account?.slug ?? accountId}.${platformDomain}`;
    return c.json({ ...zone, cnameTarget });
  }

  // Check if this zone has a matching domain registration (purchased domain)
  const registration = await db.query.domainRegistrations.findFirst({
    where: eq(domainRegistrations.domain, zone.domain),
  });

  return c.json({ ...zone, isPurchased: !!registration });
}) as any);

// GET /zones/:id/services — find services bound to this domain
dnsRoutes.openapi(getZoneServicesRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: zoneId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const zone = await db.query.dnsZones.findFirst({
    where: and(eq(dnsZones.id, zoneId), eq(dnsZones.accountId, accountId)),
  });

  if (!zone) {
    return c.json({ error: 'Zone not found' }, 404);
  }

  // Find services whose domain matches or is a subdomain of this zone
  const boundServices = await db.select({
    id: services.id,
    name: services.name,
    stackId: services.stackId,
    status: services.status,
    volumes: services.volumes,
  })
    .from(services)
    .where(and(
      eq(services.accountId, accountId),
      isNull(services.deletedAt),
      or(
        eq(services.domain, zone.domain),
        like(services.domain, `%.${zone.domain}`),
      ),
    ));

  return c.json({
    services: boundServices.map((s) => ({
      id: s.id,
      name: s.name,
      stackId: s.stackId ?? null,
      status: s.status ?? 'unknown',
      volumes: ((s.volumes as Array<{ source: string; target: string }>) ?? []).map((v) => ({
        source: v.source,
        target: v.target,
      })),
    })),
  });
}) as any);

// DELETE /zones/:id
dnsRoutes.openapi(deleteZoneRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: zoneId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const zone = await db.query.dnsZones.findFirst({
    where: and(eq(dnsZones.id, zoneId), eq(dnsZones.accountId, accountId)),
  });

  if (!zone) {
    return c.json({ error: 'Zone not found' }, 404);
  }

  // Delete selected services if requested
  let body: { deleteServices?: string[]; deleteVolumes?: string[] } | undefined;
  try { body = await c.req.json(); } catch { /* no body */ }

  if (body?.deleteServices?.length) {
    for (const serviceId of body.deleteServices) {
      try {
        // Soft-delete the service
        await db.update(services)
          .set({ deletedAt: new Date(), status: 'deleted' })
          .where(and(eq(services.id, serviceId), eq(services.accountId, accountId)));
      } catch (err) {
        logger.error({ err, serviceId }, 'Failed to delete service during domain cleanup');
      }
    }
  }

  // Remove from providers (best-effort)
  await dnsManager.deleteZone(zone.domain);

  // Delete records and zone atomically
  await safeTransaction(async (tx) => {
    await tx.delete(dnsRecords).where(eq(dnsRecords.zoneId, zoneId));
    await tx.delete(dnsZones).where(eq(dnsZones.id, zoneId));
  });

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.DNS_ZONE_DELETED,
    description: `Deleted DNS zone '${zone.domain}'`,
    resourceType: 'dns_zone',
    resourceId: zoneId,
    resourceName: zone.domain,
  });

  return c.json({ message: 'Zone deleted' });
}) as any);

// POST /zones/:id/verify
dnsRoutes.openapi(verifyZoneRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: zoneId } = c.req.valid('param');

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

  // Use the stored token, fall back to client-sent token for backwards compatibility
  const data = c.req.valid('json');
  const token = zone.verificationToken ?? data?.token;

  if (!token) {
    return c.json(
      {
        error:
          'Verification token is missing. Try removing and re-adding the domain.',
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
}) as any);

// GET /zones/:id/records
dnsRoutes.openapi(listRecordsRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: zoneId } = c.req.valid('param');

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
    orderBy: (r: any, { asc }: any) => asc(r.name),
  });

  return c.json(records);
}) as any);

// POST /zones/:id/records
dnsRoutes.openapi(createRecordRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: zoneId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const zone = await db.query.dnsZones.findFirst({
    where: and(eq(dnsZones.id, zoneId), eq(dnsZones.accountId, accountId)),
  });

  if (!zone) {
    return c.json({ error: 'Zone not found' }, 404);
  }

  const { type, name, content, ttl, priority } = c.req.valid('json');

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

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.DNS_RECORD_CREATED,
    description: `Added ${type} record to '${zone.domain}'`,
    resourceType: 'dns_record',
    resourceId: record.id,
    resourceName: zone.domain,
  });

  return c.json(
    {
      ...record,
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
    },
    201,
  );
}) as any);

// PATCH /records/:id
dnsRoutes.openapi(updateRecordRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: recordId } = c.req.valid('param');

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

  const updates = c.req.valid('json');

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

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.DNS_RECORD_UPDATED,
    description: `Updated ${finalType} record in '${record.zone.domain}'`,
    resourceType: 'dns_record',
    resourceId: recordId,
    resourceName: record.zone.domain,
  });

  return c.json({
    ...updated,
    warnings: result.warnings.length > 0 ? result.warnings : undefined,
  });
}) as any);

// DELETE /records/:id
dnsRoutes.openapi(deleteRecordRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: recordId } = c.req.valid('param');

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

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.DNS_RECORD_DELETED,
    description: `Deleted record from '${record.zone.domain}'`,
    resourceType: 'dns_record',
    resourceId: recordId,
    resourceName: record.zone.domain,
  });

  return c.json({ message: 'Record deleted' });
}) as any);

// PATCH /zones/:id/nameservers
dnsRoutes.openapi(updateNameserversRoute, (async (c: any) => {
  const { id: zoneId } = c.req.valid('param');
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { nameservers } = c.req.valid('json');

  // Verify zone belongs to this account
  const zone = await db.query.dnsZones.findFirst({
    where: and(eq(dnsZones.id, zoneId), eq(dnsZones.accountId, accountId)),
  });

  if (!zone) {
    return c.json({ error: 'Zone not found' }, 404);
  }

  // Update in DB
  await db.update(dnsZones)
    .set({ nameservers, updatedAt: new Date() })
    .where(eq(dnsZones.id, zoneId));

  // If domain was purchased through Fleet, also update at registrar
  let registrarUpdated = false;
  try {
    const registration = await db.query.domainRegistrations.findFirst({
      where: and(
        eq(domainRegistrations.domain, zone.domain),
        eq(domainRegistrations.accountId, accountId),
      ),
    });

    if (registration) {
      const { registrarService } = await import('../services/registrar.service.js');
      await registrarService.setNameservers(zone.domain, nameservers);
      registrarUpdated = true;
    }
  } catch (err) {
    logger.warn({ err, domain: zone.domain }, 'Failed to update nameservers at registrar (DB update succeeded)');
    logToErrorTable({ level: 'warn', message: `Nameserver update at registrar failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'domains', operation: 'update-nameservers-at-registrar' } });
  }

  return c.json({
    nameservers,
    registrarUpdated,
  });
}) as any);

export default dnsRoutes;
