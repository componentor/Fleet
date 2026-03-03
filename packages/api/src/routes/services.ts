import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, services, deployments, oauthProviders, resourceLimits, locationMultipliers, nodes, platformSettings, insertReturning, updateReturning, eq, and, not, isNull, desc } from '@fleet/db';
import { authMiddleware, requireScope, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { orchestrator } from '../services/orchestrator.js';
import { getRegistryAuthForImage } from '../services/docker.service.js';
import { githubService, getGitHubConfig } from '../services/github.service.js';
import { requireMember } from '../middleware/rbac.js';
import { requireActiveSubscription } from '../middleware/subscription.js';
import { buildService } from '../services/build.service.js';
import { logger, logToErrorTable } from '../services/logger.js';
import { decrypt } from '../services/crypto.service.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';
import { uploadService } from '../services/upload.service.js';
import { getDeploymentQueue, isQueueAvailable } from '../services/queue.service.js';
import { storageManager } from '../services/storage/storage-manager.js';
import { processDeploymentInline, type DeploymentJobData } from '../workers/deployment.worker.js';
import { getPlatformDomain } from './settings.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';
import { isNginxService, DEFAULT_NGINX_CONFIG } from '../services/runtime.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Get the container disk size limit for an account (in MB).
 * Returns the account-specific override, or the global default, or undefined (no limit).
 */
async function getContainerDiskLimit(accountId: string): Promise<number | undefined> {
  // Account-specific override
  const accountLimit = await db.query.resourceLimits.findFirst({
    where: eq(resourceLimits.accountId, accountId),
  });
  if (accountLimit?.maxContainerDiskMb) return accountLimit.maxContainerDiskMb;

  // Global default (accountId is null)
  const globalLimit = await db.query.resourceLimits.findFirst({
    where: isNull(resourceLimits.accountId),
  });
  return globalLimit?.maxContainerDiskMb ?? undefined;
}

/**
 * Enforce total CPU/memory pool limits for an account.
 * Returns an error string if the limit would be exceeded, or null if OK.
 */
async function enforceResourcePool(
  accountId: string,
  serviceId: string | null,
  cpuLimit: number,
  memoryLimit: number,
  replicas: number,
): Promise<string | null> {
  const accountLimit = await db.query.resourceLimits.findFirst({
    where: eq(resourceLimits.accountId, accountId),
  });
  const globalLimit = await db.query.resourceLimits.findFirst({
    where: isNull(resourceLimits.accountId),
  });
  const maxTotalCpu = accountLimit?.maxTotalCpuCores ?? globalLimit?.maxTotalCpuCores;
  const maxTotalMemory = accountLimit?.maxTotalMemoryMb ?? globalLimit?.maxTotalMemoryMb;

  // No pool limits configured — skip enforcement
  if (!maxTotalCpu && !maxTotalMemory) return null;

  // Sum current allocations across all account services (excluding the one being updated)
  const allServices = await db.query.services.findMany({
    where: and(eq(services.accountId, accountId), isNull(services.deletedAt)),
    columns: { id: true, cpuLimit: true, memoryLimit: true, replicas: true },
  });

  let totalCpu = 0;
  let totalMemory = 0;
  for (const svc of allServices) {
    if (serviceId && svc.id === serviceId) continue;
    const r = svc.replicas ?? 1;
    totalCpu += (svc.cpuLimit ?? 1) * r;
    totalMemory += (svc.memoryLimit ?? 1024) * r;
  }

  // Add the requested allocation
  const requestedCpu = cpuLimit * replicas;
  const requestedMemory = memoryLimit * replicas;

  if (maxTotalCpu && totalCpu + requestedCpu > maxTotalCpu) {
    return `Total CPU limit exceeded: using ${totalCpu.toFixed(1)} of ${maxTotalCpu} cores, requested ${requestedCpu.toFixed(1)} cores (${cpuLimit} x ${replicas} replicas)`;
  }
  if (maxTotalMemory && totalMemory + requestedMemory > maxTotalMemory) {
    const usedGb = (totalMemory / 1024).toFixed(1);
    const maxGb = (maxTotalMemory / 1024).toFixed(1);
    const reqGb = (requestedMemory / 1024).toFixed(1);
    return `Total memory limit exceeded: using ${usedGb} GB of ${maxGb} GB, requested ${reqGb} GB (${memoryLimit} MB x ${replicas} replicas)`;
  }

  return null;
}

const serviceRoutes = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

serviceRoutes.use('*', authMiddleware);
serviceRoutes.use('*', tenantMiddleware);

import { buildTraefikLabels, ensureIngressRoute, removeIngressRoutes } from '../services/traefik.js';
import { resolveOrchestratorType } from '../services/orchestrator-migration.service.js';

/** Convenience wrapper for port allocation */
async function allocateIngressPorts(
  targetPorts: Array<{ target: number; protocol: string }>,
): Promise<Array<{ target: number; published: number; protocol: string }>> {
  return orchestrator.allocateIngressPorts(targetPorts);
}

// ── Schemas ──

const createServiceSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-zA-Z0-9]([a-zA-Z0-9_.-]*[a-zA-Z0-9])?$/, 'Service name must contain only letters, numbers, hyphens, dots, and underscores'),
  image: z.string().min(1),
  replicas: z.number().int().min(1).max(100).default(1),
  env: z.record(z.string(), z.string()).default({}),
  ports: z.array(z.object({
    target: z.number().int().min(1).max(65535),
    published: z.number().int().min(1).max(65535).optional(),
    protocol: z.enum(['tcp', 'udp']).default('tcp'),
  })).default([]),
  volumes: z.array(z.object({
    source: z.string(),
    target: z.string(),
    readonly: z.boolean().default(false),
  })).default([]),
  domain: z.string().regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/).nullable().optional(),
  sslEnabled: z.boolean().default(true),
  nodeConstraint: z.string().regex(/^[a-zA-Z0-9]+$/, 'Invalid node ID format').nullable().optional(),
  region: z.string().max(50).nullable().optional(),
  placementConstraints: z.array(
    z.string().max(200).refine(
      (s) => {
        const lower = s.toLowerCase();
        return !lower.includes('node.role') && !lower.includes('node.id') && !lower.includes('node.hostname');
      },
      { message: 'Constraints on node.role, node.id, and node.hostname are not allowed' },
    ),
  ).default([]),
  updateParallelism: z.number().int().min(1).default(1),
  updateDelay: z.string().max(20).regex(/^\d+(\.\d+)?(ns|us|ms|s|m|h)$/, 'Invalid duration format').default('10s'),
  rollbackOnFailure: z.boolean().default(true),
  healthCheck: z.object({
    cmd: z.string().max(1000),
    interval: z.number().int().min(1),
    timeout: z.number().int().min(1),
    retries: z.number().int().min(1).max(20),
  }).nullable().optional(),
  githubRepo: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, 'Must be in owner/repo format').nullable().optional(),
  githubBranch: z.string().nullable().optional(),
  autoDeploy: z.boolean().default(false),
  cpuLimit: z.number().min(0.1).max(64).nullable().optional(),
  memoryLimit: z.number().int().min(64).max(131072).nullable().optional(),
  sourceType: z.enum(['docker', 'github', 'upload', 'marketplace', 'registry']).nullable().optional(),
  sourcePath: z.string().nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).default([]),
  registryPollEnabled: z.boolean().default(false),
  registryPollInterval: z.number().int().min(60).max(86400).default(300),
}).openapi('CreateServiceRequest');

const updateServiceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  image: z.string().min(1).optional(),
  replicas: z.number().int().min(0).max(100).optional(),
  env: z.record(z.string(), z.string()).optional(),
  ports: z.array(z.object({
    target: z.number().int().min(1).max(65535),
    published: z.number().int().min(1).max(65535).optional(),
    protocol: z.enum(['tcp', 'udp']).default('tcp'),
  })).optional(),
  volumes: z.array(z.object({
    source: z.string(),
    target: z.string(),
    readonly: z.boolean().default(false),
  })).optional(),
  domain: z.string().regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/).nullable().optional(),
  sslEnabled: z.boolean().optional(),
  placementConstraints: z.array(
    z.string().max(200).refine(
      (s) => {
        const lower = s.toLowerCase();
        return !lower.includes('node.role') && !lower.includes('node.id') && !lower.includes('node.hostname');
      },
      { message: 'Constraints on node.role, node.id, and node.hostname are not allowed' },
    ),
  ).optional(),
  nodeConstraint: z.string().regex(/^[a-zA-Z0-9]+$/, 'Invalid node ID format').nullable().optional(),
  region: z.string().max(50).nullable().optional(),
  updateParallelism: z.number().int().min(1).optional(),
  updateDelay: z.string().max(20).regex(/^\d+(\.\d+)?(ns|us|ms|s|m|h)$/, 'Invalid duration format').optional(),
  rollbackOnFailure: z.boolean().optional(),
  healthCheck: z.object({
    cmd: z.string().max(1000),
    interval: z.number().int().min(1),
    timeout: z.number().int().min(1),
    retries: z.number().int().min(1).max(20),
  }).nullable().optional(),
  restartCondition: z.enum(['none', 'on-failure', 'any']).optional(),
  restartMaxAttempts: z.number().int().min(0).max(100).optional(),
  restartDelay: z.string().max(20).regex(/^\d+(\.\d+)?(ns|us|ms|s|m|h)$/, 'Invalid duration format').optional(),
  cpuLimit: z.number().min(0.1).max(64).optional(),
  memoryLimit: z.number().int().min(64).max(131072).optional(),
  autoDeploy: z.boolean().optional(),
  githubBranch: z.string().min(1).max(255).regex(/^[a-zA-Z0-9][a-zA-Z0-9._\-\/]*$/, 'Invalid branch name').optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  robotsConfig: z.object({
    mode: z.enum(['default', 'custom', 'disabled']),
    content: z.string().max(10_000).optional(),
  }).nullable().optional(),
}).openapi('UpdateServiceRequest');

const dockerfileContentSchema = z.object({
  content: z.string().min(1).max(100_000),
}).openapi('DockerfileContentRequest');

const idParamSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Service ID' }),
});

const serviceIdParamSchema = z.object({
  serviceId: z.string().uuid().openapi({ description: 'Service ID' }),
});

const stackIdParamSchema = z.object({
  stackId: z.string().uuid().openapi({ description: 'Stack ID' }),
});

const logsQuerySchema = z.object({
  tail: z.string().optional().openapi({ description: 'Number of log lines to fetch (default 100, max 5000)' }),
});

/**
 * Helper: register or remove GitHub webhook when autoDeploy changes.
 * Returns the webhook ID on registration, null on removal.
 */
async function manageWebhook(opts: {
  userId: string;
  githubRepo: string;
  enable: boolean;
  existingWebhookId: number | null;
}): Promise<number | null> {
  const oauth = await db.query.oauthProviders.findFirst({
    where: and(
      eq(oauthProviders.userId, opts.userId),
      eq(oauthProviders.provider, 'github'),
    ),
  });

  if (!oauth?.accessToken) {
    throw new Error('GitHub account not connected');
  }

  const token = decrypt(oauth.accessToken);
  const parts = opts.githubRepo.split('/');
  const owner = parts[0]!;
  const repo = parts[1]!;

  if (opts.enable) {
    // Build webhook URL from platform domain
    const platformDomain = await getPlatformDomain();
    const apiBase = platformDomain && platformDomain !== 'fleet.local'
      ? `https://${platformDomain}/api/v1`
      : `http://localhost:${process.env['PORT'] ?? '3000'}/api/v1`;
    const webhookUrl = `${apiBase}/deployments/github/webhook`;
    const ghConfig = await getGitHubConfig();
    const webhookSecret = ghConfig.webhookSecret;

    if (!webhookSecret) {
      throw new Error('GitHub webhook secret not configured');
    }

    const webhook = await githubService.createWebhook(token, owner, repo, webhookUrl, webhookSecret);
    return webhook.id;
  } else {
    // Remove existing webhook
    if (opts.existingWebhookId) {
      await githubService.deleteWebhook(token, owner, repo, opts.existingWebhookId).catch((err) => {
        logger.warn({ err, hookId: opts.existingWebhookId }, 'Failed to delete GitHub webhook (may already be removed)');
        logToErrorTable({ level: 'warn', message: `Failed to delete GitHub webhook: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'delete-github-webhook' } });
      });
    }
    return null;
  }
}

// ── Route definitions ──

const listServicesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Services'],
  summary: 'List services for the current account',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(z.any()), 'List of services'),
    ...standardErrors,
  },
});

const createServiceRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Services'],
  summary: 'Deploy a new service',
  security: bearerSecurity,
  middleware: [requireMember, requireActiveSubscription, requireScope('write')] as const,
  request: {
    body: jsonBody(createServiceSchema),
  },
  responses: {
    ...standardErrors,
    201: jsonContent(z.any(), 'Created service'),
    409: jsonContent(errorResponseSchema, 'Port collision'),
    429: jsonContent(errorResponseSchema, 'Service quota reached'),
  },
});

// Note: /regions is registered as a plain .get() handler (not openapi) to guarantee
// it matches before the /{id} parameterized routes in Hono's router.

const getServiceRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Services'],
  summary: 'Get service details',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Service details with Docker status'),
    ...standardErrors,
  },
});

const getServiceStatsRoute = createRoute({
  method: 'get',
  path: '/{id}/stats',
  tags: ['Services'],
  summary: 'Get live container resource stats',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Container stats'),
    ...standardErrors,
  },
});

const updateServiceRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Services'],
  summary: 'Update a service',
  security: bearerSecurity,
  middleware: [requireMember, requireScope('write')] as const,
  request: {
    params: idParamSchema,
    body: jsonBody(updateServiceSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Updated service'),
    ...standardErrors,
    429: jsonContent(errorResponseSchema, 'Replica quota exceeded'),
  },
});

const deleteQuerySchema = z.object({
  deleteVolumes: z.enum(['true', 'false']).optional().openapi({ description: 'Also delete related storage volumes' }),
});

const deleteServiceRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Services'],
  summary: 'Destroy a service',
  security: bearerSecurity,
  middleware: [requireMember, requireScope('write')] as const,
  request: {
    params: idParamSchema,
    query: deleteQuerySchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Service destroyed'),
    ...standardErrors,
  },
});

const restartServiceRoute = createRoute({
  method: 'post',
  path: '/{id}/restart',
  tags: ['Services'],
  summary: 'Restart a service (force update)',
  security: bearerSecurity,
  middleware: [requireMember, requireScope('write')] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Restart initiated'),
    ...standardErrors,
  },
});

const redeployServiceRoute = createRoute({
  method: 'post',
  path: '/{id}/redeploy',
  tags: ['Services'],
  summary: 'Rebuild and redeploy a service',
  security: bearerSecurity,
  middleware: [requireMember, requireScope('write')] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Redeployment initiated'),
    ...standardErrors,
    409: jsonContent(errorResponseSchema, 'Service is already deploying'),
  },
});

const stopServiceRoute = createRoute({
  method: 'post',
  path: '/{id}/stop',
  tags: ['Services'],
  summary: 'Stop a running service (scale to 0)',
  security: bearerSecurity,
  middleware: [requireMember, requireScope('write')] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Service stopped'),
    ...standardErrors,
    409: jsonContent(errorResponseSchema, 'Cannot stop deploying service'),
  },
});

const cancelDeployRoute = createRoute({
  method: 'post',
  path: '/{id}/cancel-deploy',
  tags: ['Services'],
  summary: 'Cancel an in-progress deployment',
  security: bearerSecurity,
  middleware: [requireMember, requireScope('write')] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Deployment cancelled'),
    ...standardErrors,
  },
});

const startServiceRoute = createRoute({
  method: 'post',
  path: '/{id}/start',
  tags: ['Services'],
  summary: 'Start a stopped service (restore replicas)',
  security: bearerSecurity,
  middleware: [requireMember, requireScope('write')] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Service started'),
    ...standardErrors,
  },
});

const syncServiceRoute = createRoute({
  method: 'post',
  path: '/{id}/sync',
  tags: ['Services'],
  summary: 'Manually sync service status with Docker',
  security: bearerSecurity,
  middleware: [requireMember] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(z.object({ status: z.string(), synced: z.boolean() }), 'Sync result'),
    ...standardErrors,
  },
});

const volumeMigrateRoute = createRoute({
  method: 'post',
  path: '/{id}/volume-migrate',
  tags: ['Services'],
  summary: 'Copy data between volumes (with optional clean)',
  security: bearerSecurity,
  middleware: [requireMember, requireScope('write')] as const,
  request: {
    params: idParamSchema,
    body: jsonBody(z.object({
      sourceVolume: z.string().min(1),
      targetVolume: z.string().min(1),
      clean: z.boolean().default(false),
    })),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Volume data migrated'),
    ...standardErrors,
  },
});

const getServiceLogsRoute = createRoute({
  method: 'get',
  path: '/{id}/logs',
  tags: ['Services'],
  summary: 'Get service logs',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    query: logsQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Service logs'),
    ...standardErrors,
  },
});

const getDeploymentsRoute = createRoute({
  method: 'get',
  path: '/{id}/deployments',
  tags: ['Services'],
  summary: 'Get deployment history',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(z.array(z.any()), 'Deployment history'),
    ...standardErrors,
  },
});

const deleteStackRoute = createRoute({
  method: 'delete',
  path: '/stack/{stackId}',
  tags: ['Services'],
  summary: 'Destroy all services in a stack',
  security: bearerSecurity,
  middleware: [requireMember, requireScope('write')] as const,
  request: {
    params: stackIdParamSchema,
    query: deleteQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Stack deleted'),
    ...standardErrors,
  },
});

const restartStackRoute = createRoute({
  method: 'post',
  path: '/stack/{stackId}/restart',
  tags: ['Services'],
  summary: 'Restart all services in a stack',
  security: bearerSecurity,
  middleware: [requireMember, requireScope('write')] as const,
  request: {
    params: stackIdParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Stack restart initiated'),
    ...standardErrors,
  },
});

const getStackStatusRoute = createRoute({
  method: 'get',
  path: '/stack/{stackId}/status',
  tags: ['Services'],
  summary: 'Get deployment progress for a template stack',
  security: bearerSecurity,
  request: {
    params: stackIdParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Stack status'),
    ...standardErrors,
  },
});

const getDockerfileRoute = createRoute({
  method: 'get',
  path: '/{serviceId}/dockerfile',
  tags: ['Services'],
  summary: 'Get Dockerfile content for a service',
  security: bearerSecurity,
  request: {
    params: serviceIdParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Dockerfile content'),
    ...standardErrors,
  },
});

const previewServiceRoute = createRoute({
  method: 'post',
  path: '/preview',
  tags: ['Services'],
  summary: 'Dry-run deployment preview (no actual deployment)',
  security: bearerSecurity,
  middleware: [requireMember] as const,
  request: {
    body: jsonBody(createServiceSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Deployment preview'),
    ...standardErrors,
  },
});

const updateDockerfileRoute = createRoute({
  method: 'put',
  path: '/{serviceId}/dockerfile',
  tags: ['Services'],
  summary: 'Update Dockerfile content for a service',
  security: bearerSecurity,
  middleware: [requireMember, requireScope('write')] as const,
  request: {
    params: serviceIdParamSchema,
    body: jsonBody(dockerfileContentSchema),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Dockerfile updated'),
    ...standardErrors,
  },
});

// ── Nginx config routes ─────────────────────────────────────────────────

const getNginxConfigRoute = createRoute({
  method: 'get',
  path: '/{serviceId}/nginx-config',
  tags: ['Services'],
  summary: 'Get nginx config for a service',
  security: bearerSecurity,
  request: {
    params: serviceIdParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Nginx config'),
    ...standardErrors,
  },
});

const updateNginxConfigRoute = createRoute({
  method: 'put',
  path: '/{serviceId}/nginx-config',
  tags: ['Services'],
  summary: 'Update nginx config for a service',
  security: bearerSecurity,
  middleware: [requireMember, requireScope('write')] as const,
  request: {
    params: serviceIdParamSchema,
    body: jsonBody(z.object({
      config: z.string().min(1).max(50_000),
      applyNow: z.boolean().optional().default(false),
    }).openapi('NginxConfigUpdateRequest')),
  },
  responses: {
    200: jsonContent(z.any(), 'Nginx config updated'),
    ...standardErrors,
  },
});

const resetNginxConfigRoute = createRoute({
  method: 'post',
  path: '/{serviceId}/nginx-config/reset',
  tags: ['Services'],
  summary: 'Reset nginx config to default',
  security: bearerSecurity,
  middleware: [requireMember, requireScope('write')] as const,
  request: {
    params: serviceIdParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Config reset'),
    ...standardErrors,
  },
});

const aggregatedLogsQuerySchema = z.object({
  tail: z.string().optional().openapi({ description: 'Number of log lines per service (default 100, max 1000)' }),
  serviceId: z.string().optional().openapi({ description: 'Filter to a single service ID' }),
});

const aggregatedLogsRoute = createRoute({
  method: 'get',
  path: '/logs',
  tags: ['Services'],
  summary: 'Get aggregated container logs across all account services',
  security: bearerSecurity,
  request: {
    query: aggregatedLogsQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Aggregated service logs'),
    ...standardErrors,
  },
});

// ── Route handlers ──

// GET /logs — aggregated container logs across all account services
serviceRoutes.openapi(aggregatedLogsRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const tail = Math.min(parseInt(c.req.query('tail') ?? '100', 10) || 100, 1000);
  const filterServiceId = c.req.query('serviceId') || '';

  // Fetch account services that have Docker deployments
  const where = filterServiceId
    ? and(eq(services.id, filterServiceId), eq(services.accountId, accountId), isNull(services.deletedAt))
    : and(eq(services.accountId, accountId), isNull(services.deletedAt));

  const accountServices = await db.query.services.findMany({
    where,
    columns: { id: true, name: true, dockerServiceId: true },
  });

  const deployedServices = accountServices.filter((s) => s.dockerServiceId);
  const serviceList = accountServices.map((s) => ({ id: s.id, name: s.name, hasDocker: !!s.dockerServiceId }));

  // Fetch logs from each service in parallel (limited to 10 at a time)
  const logEntries: { serviceName: string; serviceId: string; line: string; timestamp: string }[] = [];

  const LOGS_TIMEOUT_MS = 15_000;
  const fetchPromises = deployedServices.slice(0, 10).map(async (svc) => {
    try {
      const result = await orchestrator.getServiceLogs(svc.dockerServiceId!, { tail: Math.min(tail, 200), follow: false });

      let raw: Buffer;
      if (Buffer.isBuffer(result)) {
        raw = result;
      } else {
        raw = await new Promise<Buffer>((resolve) => {
          const chunks: Buffer[] = [];
          const stream = result as NodeJS.ReadableStream & { destroy(): void };
          const finish = () => {
            stream.removeAllListeners();
            stream.destroy();
            resolve(Buffer.concat(chunks));
          };
          stream.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          stream.on('end', finish);
          stream.on('error', finish);
          setTimeout(finish, LOGS_TIMEOUT_MS);
        });
      }

      // Demultiplex Docker frame headers
      const lines: string[] = [];
      let offset = 0;
      while (offset + 8 <= raw.length) {
        const size = raw.readUInt32BE(offset + 4);
        if (offset + 8 + size > raw.length) break;
        const payload = raw.subarray(offset + 8, offset + 8 + size).toString('utf-8');
        lines.push(payload);
        offset += 8 + size;
      }

      const text = lines.length > 0 ? lines.join('') : raw.toString('utf-8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Docker timestamps are at the start: "2024-01-01T00:00:00.000000000Z ..."
        const tsMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s/);
        logEntries.push({
          serviceName: svc.name,
          serviceId: svc.id,
          line: tsMatch ? trimmed.slice(tsMatch[0].length) : trimmed,
          timestamp: tsMatch?.[1] ?? new Date().toISOString(),
        });
      }
    } catch {
      // Service may not exist in Docker — skip
    }
  });

  await Promise.all(fetchPromises);

  // Sort by timestamp descending (newest first)
  logEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return c.json({ logs: logEntries.slice(0, tail * 10), services: serviceList });
}) as any);

// GET / — list services for the current account (with live Docker status sync)
serviceRoutes.openapi(listServicesRoute, (async (c: any) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const result = await db.query.services.findMany({
    where: and(eq(services.accountId, accountId), isNull(services.deletedAt)),
    orderBy: (s: any, { desc }: any) => desc(s.createdAt),
    with: { deployments: { orderBy: (d: any, { desc }: any) => desc(d.createdAt), limit: 1, columns: { status: true, log: true } } },
  });

  // Live Docker status sync — reconcile DB status with actual Swarm state
  const active = result.filter((s) => (s.status === 'running' || s.status === 'deploying') && s.dockerServiceId);
  if (active.length > 0) {
    try {
      const dockerIds = active.map((s) => s.dockerServiceId!);
      const [dockerSvcs, dockerTasks] = await Promise.all([
        orchestrator.listServices({ label: [`fleet.account-id=${accountId}`] }),
        orchestrator.listTasks({ label: [`fleet.account-id=${accountId}`] }),
      ]);
      const dockerSvcSet = new Set(dockerSvcs.map((s: any) => s.ID));

      // Aggregate tasks by service ID
      const tasksByService = new Map<string, { running: number; failed: number; total: number }>();
      for (const t of dockerTasks) {
        const sid = t.ServiceID;
        if (!sid) continue;
        let e = tasksByService.get(sid);
        if (!e) { e = { running: 0, failed: 0, total: 0 }; tasksByService.set(sid, e); }
        e.total++;
        const state = t.Status?.State;
        if (state === 'running') e.running++;
        else if (state === 'failed' || state === 'rejected') e.failed++;
      }

      const now = new Date();
      for (const svc of active) {
        let newStatus: string | null = null;
        const updateFields: Record<string, any> = { updatedAt: now };

        if (!dockerSvcSet.has(svc.dockerServiceId!)) {
          newStatus = 'stopped';
          updateFields['dockerServiceId'] = null;
        } else {
          const tasks = tasksByService.get(svc.dockerServiceId!) ?? { running: 0, failed: 0, total: 0 };
          if (tasks.running > 0 && svc.status !== 'running') {
            newStatus = 'running';
          } else if (tasks.running === 0 && tasks.failed > 0) {
            newStatus = 'failed';
          } else if (svc.status === 'running' && tasks.running === 0 && tasks.total > 0) {
            // Tasks exist but none running or failed — stuck in intermediate state
            newStatus = 'deploying';
          }
        }

        if (newStatus) {
          updateFields['status'] = newStatus;
          // Optimistic guard: only update if status hasn't changed since we read it
          await db.update(services).set(updateFields).where(
            and(eq(services.id, svc.id), eq(services.status, svc.status as string)),
          );
          // Update in-memory result so the response reflects the corrected status
          (svc as any).status = newStatus;
          if (updateFields['dockerServiceId'] === null) (svc as any).dockerServiceId = null;
        }
      }
    } catch {
      // Docker unavailable — return DB state as-is
    }
  }

  // Attach lastDeployError for failed services so the list UI can show it
  const enriched = result.map((svc: any) => {
    const lastDeploy = svc.deployments?.[0];
    const lastDeployError = (svc.status === 'failed' && lastDeploy?.status === 'failed' && lastDeploy?.log)
      ? lastDeploy.log.slice(0, 200)
      : null;
    const { deployments: _d, ...rest } = svc;
    return lastDeployError ? { ...rest, lastDeployError } : rest;
  });

  return c.json(enriched);
}) as any);

// GET /regions — list available regions with active nodes
// Registered as plain .get() to guarantee matching before /{id} parameterized routes
// Only returns regions that have at least one service-capable storage cluster
serviceRoutes.get('/regions', async (c: any) => {
  const locations = await db.query.locationMultipliers.findMany();

  const activeNodes = await db.query.nodes.findMany({
    where: and(eq(nodes.status, 'active'), not(isNull(nodes.location))),
    columns: { location: true },
  });

  const nodeCounts = new Map<string, number>();
  for (const node of activeNodes) {
    if (node.location) {
      nodeCounts.set(node.location, (nodeCounts.get(node.location) ?? 0) + 1);
    }
  }

  // Filter by service-capable clusters (only when real clusters exist)
  const allClusters = storageManager.getAllClusters();
  const firstCluster = allClusters[0];
  const hasRealClusters = allClusters.length > 0 && firstCluster !== undefined && firstCluster.id !== '__local__';

  let serviceRegions: Set<string> | null = null;
  if (hasRealClusters) {
    const serviceClusters = storageManager.getClustersForPurpose('services');
    const hasGlobal = serviceClusters.some((c) => c.scope === 'global');
    if (!hasGlobal) {
      serviceRegions = new Set(serviceClusters.map((c) => c.region).filter(Boolean) as string[]);
    }
    // If a global service cluster exists, all regions are available (serviceRegions stays null)
  }

  const regions = locations
    .filter((loc: any) => {
      if (!nodeCounts.has(loc.locationKey)) return false;
      if (serviceRegions) return serviceRegions.has(loc.locationKey);
      return true;
    })
    .map((loc: any) => ({
      key: loc.locationKey,
      label: loc.label,
      nodeCount: nodeCounts.get(loc.locationKey) ?? 0,
    }));

  return c.json(regions);
});

// POST / — deploy a new service
serviceRoutes.openapi(createServiceRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const data = c.req.valid('json');

  // Per-account service quota (DB overrides env)
  let serviceQuota = parseInt(process.env['MAX_SERVICES_PER_ACCOUNT'] ?? '50', 10);
  try {
    const dbVal = await db.query.platformSettings.findFirst({ where: eq(platformSettings.key, 'limits:maxServicesPerAccount') });
    if (dbVal?.value != null) serviceQuota = Number(dbVal.value) || serviceQuota;
  } catch { /* use env default */ }
  const existingCount = await db.query.services.findMany({
    where: and(eq(services.accountId, accountId), isNull(services.deletedAt)),
    columns: { id: true },
  });
  if (existingCount.length >= serviceQuota) {
    return c.json({ error: `Service limit reached (${serviceQuota}). Please delete unused services or contact support.` }, 429);
  }

  // Enforce per-container resource limits
  if (data.cpuLimit || data.memoryLimit) {
    const accountLimit = await db.query.resourceLimits.findFirst({
      where: eq(resourceLimits.accountId, accountId),
    });
    const globalLimit = await db.query.resourceLimits.findFirst({
      where: isNull(resourceLimits.accountId),
    });
    const maxCpu = accountLimit?.maxCpuPerContainer ?? globalLimit?.maxCpuPerContainer ?? 4;
    const maxMemory = accountLimit?.maxMemoryPerContainer ?? globalLimit?.maxMemoryPerContainer ?? 8192;

    if (data.cpuLimit && data.cpuLimit > maxCpu) {
      return c.json({ error: `CPU limit exceeds maximum of ${maxCpu} cores per container` }, 403);
    }
    if (data.memoryLimit && data.memoryLimit > maxMemory) {
      return c.json({ error: `Memory limit exceeds maximum of ${maxMemory} MB per container` }, 403);
    }
  }

  // Enforce total resource pool limits
  const poolError = await enforceResourcePool(
    accountId, null,
    data.cpuLimit ?? 1, data.memoryLimit ?? 1024, data.replicas,
  );
  if (poolError) {
    return c.json({ error: poolError }, 403);
  }

  // Determine target port for Traefik and port allocation
  const primaryTargetPort = data.ports?.[0]?.target ?? 80;
  const traefikLabels = buildTraefikLabels(data.name, data.domain ?? null, data.sslEnabled, primaryTargetPort);

  // Build constraints
  const constraints = [...data.placementConstraints];
  if (data.nodeConstraint) {
    constraints.push(`node.id == ${data.nodeConstraint}`);
  }
  if (data.region) {
    constraints.push(`node.labels.region == ${data.region}`);
  }

  // Insert into DB
  const [svc] = await insertReturning(services, {
    accountId,
    name: data.name,
    image: data.image,
    replicas: data.replicas,
    env: data.env,
    ports: data.ports,
    volumes: data.volumes,
    domain: data.domain ?? null,
    sslEnabled: data.sslEnabled,
    nodeConstraint: data.nodeConstraint ?? null,
    region: data.region ?? null,
    placementConstraints: data.placementConstraints,
    updateParallelism: data.updateParallelism,
    updateDelay: data.updateDelay,
    rollbackOnFailure: data.rollbackOnFailure,
    healthCheck: data.healthCheck ?? null,
    githubRepo: data.githubRepo ?? null,
    githubBranch: data.githubBranch ?? null,
    autoDeploy: data.autoDeploy,
    cpuLimit: data.cpuLimit ?? null,
    memoryLimit: data.memoryLimit ?? null,
    sourceType: data.sourceType ?? (data.githubRepo ? 'github' : 'docker'),
    sourcePath: data.sourcePath ?? null,
    tags: data.tags,
    registryPollEnabled: data.registryPollEnabled,
    registryPollInterval: data.registryPollInterval,
    registryWebhookSecret: data.sourceType === 'registry' ? (await import('node:crypto')).randomBytes(32).toString('hex') : null,
    status: 'deploying',
  });

  if (!svc) {
    return c.json({ error: 'Failed to create service record' }, 500);
  }

  // Register GitHub webhook if autoDeploy is enabled
  let webhookWarning: string | undefined;
  if (data.autoDeploy && data.githubRepo) {
    try {
      const webhookId = await manageWebhook({
        userId: user.userId,
        githubRepo: data.githubRepo,
        enable: true,
        existingWebhookId: null,
      });
      if (webhookId) {
        await db.update(services).set({ githubWebhookId: webhookId }).where(eq(services.id, svc.id));
        svc.githubWebhookId = webhookId;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to register GitHub webhook during service creation — auto-deploy may not work');
      logToErrorTable({ level: 'warn', message: `GitHub webhook registration failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'create-github-webhook' } });
      // Disable autoDeploy since webhook registration failed
      await db.update(services).set({ autoDeploy: false }).where(eq(services.id, svc.id));
      svc.autoDeploy = false;
      webhookWarning = 'GitHub webhook registration failed — auto-deploy has been disabled. Re-enable it in service settings after connecting your GitHub account.';
    }
  }

  // Try to deploy to Docker Swarm (non-fatal — service record is always kept)
  try {
    const networkName = `fleet-account-${accountId}`;
    const networkId = await orchestrator.ensureNetwork(networkName);

    // Domain services need the Traefik public network for routing
    const networkIds = [networkId];
    if (data.domain) {
      const publicNetId = await orchestrator.ensureNetwork('fleet_fleet_public');
      networkIds.push(publicNetId);
    }

    const accountShort = accountId.replace(/-/g, '').substring(0, 12);
    const swarmServiceName = `fleet-${accountShort}-${data.name}`.toLowerCase();
    const storageLimitMb = await getContainerDiskLimit(accountId);

    // Port management: domain services use Traefik (no ingress ports),
    // non-domain services get auto-allocated published ports
    const ingressPorts = data.domain
      ? []
      : await allocateIngressPorts(
          data.ports.map((p: any) => ({ target: p.target, protocol: p.protocol ?? 'tcp' })),
        );

    const registryAuth = await getRegistryAuthForImage(accountId, data.image);
    const result = await orchestrator.createService({
      name: swarmServiceName,
      image: data.image,
      replicas: data.replicas,
      env: data.env,
      ports: ingressPorts,
      volumes: data.volumes.map((v: any) => ({
        source: v.source,
        target: v.target,
        readonly: v.readonly,
      })),
      labels: {
        ...traefikLabels,
        'fleet.account-id': accountId,
        'fleet.service-id': svc.id,
      },
      constraints,
      registryAuth,
      healthCheck: data.healthCheck ?? undefined,
      updateParallelism: data.updateParallelism,
      updateDelay: data.updateDelay,
      rollbackOnFailure: data.rollbackOnFailure,
      cpuLimit: data.cpuLimit ?? undefined,
      memoryLimit: data.memoryLimit ?? undefined,
      networkIds,
      storageLimitMb,
    });

    await ensureIngressRoute(`fleet-account-${accountId}`, swarmServiceName, data.domain ?? null, data.sslEnabled ?? true, primaryTargetPort).catch(() => {});

    await db
      .update(services)
      .set({
        dockerServiceId: result.id,
        status: 'deploying',
        ports: ingressPorts.length > 0 ? ingressPorts : data.ports,
        updatedAt: new Date(),
      })
      .where(eq(services.id, svc.id));

    const response: Record<string, unknown> = { ...svc, dockerServiceId: result.id, status: 'deploying', ports: ingressPorts.length > 0 ? ingressPorts : data.ports };
    if (webhookWarning) response.warning = webhookWarning;
    eventService.log({
      ...eventContext(c),
      eventType: EventTypes.SERVICE_CREATED,
      description: `Created service '${data.name}'`,
      resourceId: svc.id,
      resourceName: data.name,
    });
    return c.json(response, 201);
  } catch (err) {
    logger.warn({ err }, 'Docker not available — service created but not started');
    logToErrorTable({ level: 'error', message: `Service creation Docker deployment failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'create-docker-deploy' } });
    await db
      .update(services)
      .set({ status: 'stopped', updatedAt: new Date() })
      .where(eq(services.id, svc.id));

    // Return 201 with stopped status so the client knows Docker deployment failed
    return c.json({ ...svc, status: 'stopped', warning: 'Docker deployment failed — service saved but not running' }, 201);
  }
}) as any);


// GET /:id — service details
serviceRoutes.openapi(getServiceRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: serviceId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  if (!UUID_RE.test(serviceId)) {
    return c.json({ error: 'Service not found' }, 404);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
    with: { deployments: { orderBy: (d: any, { desc }: any) => desc(d.createdAt), limit: 10 } },
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  // Fetch live Docker status and sync DB if state drifted
  let dockerStatus = null;
  let correctedStatus: string | null = null;
  if (svc.dockerServiceId) {
    try {
      const info = await orchestrator.inspectService(svc.dockerServiceId);
      const tasks = await orchestrator.getServiceTasks(svc.dockerServiceId);
      const runningTasks = tasks.filter((t) => t.status === 'running').length;
      const failedTasks = tasks.filter((t) => t.status === 'failed' || t.status === 'rejected').length;
      // Extract volume mount driver info from Docker service spec
      const mounts = (info.Spec?.TaskTemplate as any)?.ContainerSpec?.Mounts ?? [];
      const volumeDrivers = mounts
        .filter((m: any) => m.Type === 'volume')
        .map((m: any) => ({
          source: m.Source,
          target: m.Target,
          driver: m.VolumeOptions?.DriverConfig?.Name ?? 'local',
          driverType: m.VolumeOptions?.DriverConfig?.Options?.type ?? null,
        }));

      // Extract network info from Docker service endpoint
      const virtualIPs: Array<{ networkId: string; addr: string }> = (info.Endpoint?.VirtualIPs ?? [])
        .map((vip: any) => ({ networkId: vip.NetworkID, addr: vip.Addr }));
      const networkNames: string[] = [];
      const specNetworks = (info.Spec?.TaskTemplate as any)?.Networks ?? [];
      for (const net of specNetworks) {
        try {
          const netInfo = await orchestrator.inspectNetwork(net.Target);
          networkNames.push(netInfo.Name);
        } catch { /* ignore — network may be gone */ }
      }

      dockerStatus = {
        createdAt: info.CreatedAt,
        updatedAt: info.UpdatedAt,
        runningTasks,
        desiredTasks: svc.replicas ?? 1,
        tasks,
        volumeDrivers,
        networks: networkNames.map((name, i) => ({
          name,
          virtualIP: virtualIPs[i]?.addr ?? null,
        })),
      };

      // Auto-correct status drift
      if (runningTasks > 0 && svc.status !== 'running') {
        correctedStatus = 'running';
      } else if (runningTasks === 0 && failedTasks > 0) {
        correctedStatus = 'failed';
      } else if (svc.status === 'running' && runningTasks === 0 && tasks.length > 0) {
        // Tasks exist but none running or failed — stuck in intermediate state
        correctedStatus = 'deploying';
      }
    } catch {
      // Docker service doesn't exist anymore — correct the DB
      if (svc.status === 'running' || svc.status === 'deploying') {
        correctedStatus = 'stopped';
        await db.update(services).set({ status: 'stopped', dockerServiceId: null, updatedAt: new Date() }).where(eq(services.id, svc.id));
        return c.json({ ...svc, status: 'stopped', dockerServiceId: null, dockerStatus: null });
      }
    }
  } else if (svc.status === 'running') {
    // No Docker service ID but DB says running
    correctedStatus = 'stopped';
  }

  if (correctedStatus) {
    const updateFields: Record<string, any> = { status: correctedStatus, updatedAt: new Date() };
    await db.update(services).set(updateFields).where(eq(services.id, svc.id));
    return c.json({ ...svc, status: correctedStatus, dockerStatus });
  }

  return c.json({ ...svc, dockerStatus });
}) as any);

// GET /:id/stats — live container resource stats
serviceRoutes.openapi(getServiceStatsRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: serviceId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  if (!svc.dockerServiceId) {
    return c.json({ error: 'Service has no Docker deployment' }, 400);
  }

  try {
    const tasks = await orchestrator.getServiceTasks(svc.dockerServiceId);
    const runningTasks = tasks.filter((t) => t.status === 'running');

    // Fetch stats for all running containers using node-aware routing
    // This routes through Fleet agents on remote nodes so stats work
    // regardless of which API replica handles the request.
    const { dockerService } = await import('../services/docker.service.js');
    const containerStats: Array<{ containerId: string; stats: import('../services/docker.service.js').ContainerStats | null }> = [];
    const CONCURRENCY = 10;
    for (let i = 0; i < runningTasks.length; i += CONCURRENCY) {
      const batch = runningTasks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (t) => {
          const containerId = t.containerStatus?.containerId;
          if (!containerId) return { containerId: '', stats: null };
          const stats = await dockerService.nodeAwareGetContainerStats(containerId, t.nodeId);
          return { containerId, stats };
        }),
      );
      containerStats.push(...results);
    }

    // Uptime: time since last successful deployment
    const lastDeploy = await db.query.deployments.findFirst({
      where: and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'succeeded')),
      orderBy: (d: any, { desc }: any) => desc(d.createdAt),
    });

    // Task state breakdown for debugging
    const taskStates: Record<string, number> = {};
    for (const t of tasks) {
      taskStates[t.status] = (taskStates[t.status] || 0) + 1;
    }

    return c.json({
      containers: containerStats.filter((s) => s.stats).map((s) => ({
        containerId: s.containerId,
        ...s.stats,
      })),
      uptimeSince: lastDeploy?.createdAt ?? svc.createdAt,
      taskCount: {
        running: runningTasks.length,
        total: tasks.length,
      },
      taskStates,
      tasks: tasks.map((t) => ({
        id: t.id.slice(0, 12),
        status: t.status,
        desiredState: t.desiredState,
        message: t.message,
        error: t.error,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch service stats');
    logToErrorTable({ level: 'error', message: `Failed to fetch service stats: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'fetch-stats' } });
    return c.json({ error: 'Failed to fetch service stats' }, 500);
  }
}) as any);

// PATCH /:id — update service
serviceRoutes.openapi(updateServiceRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  const { id: serviceId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const data = c.req.valid('json');

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  // Enforce per-account total replica quota when scaling (DB overrides env)
  if (data.replicas !== undefined && data.replicas > (svc.replicas ?? 1)) {
    let maxTotalReplicas = parseInt(process.env['MAX_TOTAL_REPLICAS_PER_ACCOUNT'] ?? '200', 10);
    try {
      const dbVal = await db.query.platformSettings.findFirst({ where: eq(platformSettings.key, 'limits:maxTotalReplicasPerAccount') });
      if (dbVal?.value != null) maxTotalReplicas = Number(dbVal.value) || maxTotalReplicas;
    } catch { /* use env default */ }
    const allServices = await db.query.services.findMany({
      where: and(eq(services.accountId, accountId), isNull(services.deletedAt)),
      columns: { id: true, replicas: true },
    });
    const currentTotal = allServices.reduce((sum, s) => sum + (s.id === serviceId ? 0 : (s.replicas ?? 1)), 0);
    if (currentTotal + data.replicas > maxTotalReplicas) {
      return c.json({
        error: `Total replica limit (${maxTotalReplicas}) would be exceeded. Current: ${currentTotal}, requested: ${data.replicas}.`,
      }, 429);
    }
  }

  // Enforce per-container resource limits when changing CPU or memory
  if (data.cpuLimit !== undefined || data.memoryLimit !== undefined) {
    const accountLimit = await db.query.resourceLimits.findFirst({
      where: eq(resourceLimits.accountId, accountId),
    });
    const globalLimit = await db.query.resourceLimits.findFirst({
      where: isNull(resourceLimits.accountId),
    });
    const maxCpu = accountLimit?.maxCpuPerContainer ?? globalLimit?.maxCpuPerContainer ?? 4;
    const maxMemory = accountLimit?.maxMemoryPerContainer ?? globalLimit?.maxMemoryPerContainer ?? 8192;

    if (data.cpuLimit !== undefined && data.cpuLimit > maxCpu) {
      return c.json({ error: `CPU limit exceeds maximum of ${maxCpu} cores per container` }, 403);
    }
    if (data.memoryLimit !== undefined && data.memoryLimit > maxMemory) {
      return c.json({ error: `Memory limit exceeds maximum of ${maxMemory} MB per container` }, 403);
    }
  }

  // Enforce total resource pool limits when changing CPU, memory, or replicas
  if (data.cpuLimit !== undefined || data.memoryLimit !== undefined || data.replicas !== undefined) {
    const effectiveCpu = data.cpuLimit ?? svc.cpuLimit ?? 1;
    const effectiveMemory = data.memoryLimit ?? svc.memoryLimit ?? 1024;
    const effectiveReplicas = data.replicas ?? svc.replicas ?? 1;
    const poolError = await enforceResourcePool(accountId, serviceId, effectiveCpu, effectiveMemory, effectiveReplicas);
    if (poolError) {
      return c.json({ error: poolError }, 403);
    }
  }

  // Handle auto-deploy webhook management
  const autoDeployChanged = data.autoDeploy !== undefined && data.autoDeploy !== (svc.autoDeploy ?? false);
  let githubWebhookId = svc.githubWebhookId ?? null;

  if (autoDeployChanged && svc.githubRepo) {
    try {
      githubWebhookId = await manageWebhook({
        userId: user.userId,
        githubRepo: svc.githubRepo,
        enable: data.autoDeploy!,
        existingWebhookId: githubWebhookId,
      });
    } catch (err) {
      logger.error({ err }, 'GitHub webhook management failed');
      logToErrorTable({ level: 'error', message: `GitHub webhook management failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'update-github-webhook' } });
      return c.json({ error: `Failed to ${data.autoDeploy ? 'register' : 'remove'} GitHub webhook: ${(err as Error).message}` }, 400);
    }
  }

  // Build DB update payload (exclude autoDeploy/githubBranch from Docker update)
  const { autoDeploy: _ad, githubBranch: _gb, robotsConfig: _rc, ...dockerFields } = data;

  // Track volume migration failures to report in the response
  const migrationFailures: Array<{ source: string; target: string; mountPath: string; error: string }> = [];

  // If Docker update is needed, try Docker FIRST to ensure atomicity
  if (svc.dockerServiceId && Object.keys(dockerFields).length > 0) {
    try {
      const effectiveDomain = dockerFields.domain !== undefined ? dockerFields.domain : (svc.domain ?? null);
      const effectivePorts = dockerFields.ports ?? (svc.ports as any[]) ?? [];
      const primaryTargetPort = effectivePorts[0]?.target ?? 80;
      const effectiveRobotsMode = (data.robotsConfig as any)?.mode ?? (svc.robotsConfig as any)?.mode ?? 'default';
      const traefikLabels = buildTraefikLabels(
        dockerFields.name ?? svc.name,
        effectiveDomain,
        dockerFields.sslEnabled ?? svc.sslEnabled ?? true,
        primaryTargetPort,
        effectiveRobotsMode,
      );

      // Port management: re-allocate if ports changed
      let updatedPorts: Array<{ target: number; published: number; protocol: string }> | undefined;
      if (dockerFields.ports) {
        updatedPorts = effectiveDomain
          ? []
          : await allocateIngressPorts(
              dockerFields.ports.map((p: any) => ({ target: p.target, protocol: p.protocol ?? 'tcp' })),
            );
      }

      // Volume data migration: copy data when a mount path's source volume changes
      if (dockerFields.volumes) {
        const oldVolumes = (svc.volumes as Array<{ source: string; target: string }>) ?? [];
        const oldByTarget = new Map(oldVolumes.map((v) => [v.target, v.source]));

        for (const newVol of dockerFields.volumes) {
          const oldSource = oldByTarget.get(newVol.target);
          if (oldSource && oldSource !== newVol.source) {
            // Mount path had a different volume before — migrate data
            try {
              logger.info({ from: oldSource, to: newVol.source, path: newVol.target }, 'Migrating volume data');
              await orchestrator.copyVolumeData(oldSource, newVol.source);
            } catch (err) {
              logger.warn({ err, from: oldSource, to: newVol.source }, 'Volume data migration failed — continuing with empty volume');
              logToErrorTable({ level: 'warn', message: `Volume data migration failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'update-volume-migration' } });
              migrationFailures.push({
                source: oldSource,
                target: newVol.source,
                mountPath: newVol.target,
                error: (err as Error).message,
              });
            }
          }
        }
      }

      // Rebuild constraints including nodeConstraint and region
      const effectiveConstraints = [...(dockerFields.placementConstraints ?? (svc.placementConstraints as string[]) ?? [])];
      const effectiveNodeConstraint = dockerFields.nodeConstraint !== undefined ? dockerFields.nodeConstraint : svc.nodeConstraint;
      if (effectiveNodeConstraint) {
        effectiveConstraints.push(`node.id == ${effectiveNodeConstraint}`);
      }
      const effectiveRegion = dockerFields.region !== undefined ? dockerFields.region : svc.region;
      if (effectiveRegion) {
        effectiveConstraints.push(`node.labels.region == ${effectiveRegion}`);
      }

      // If domain is changing, manage Traefik public network attachment
      let networkUpdate: string[] | undefined;
      if (dockerFields.domain !== undefined) {
        const accountNetId = await orchestrator.ensureNetwork(`fleet-account-${accountId}`);
        if (effectiveDomain) {
          const publicNetId = await orchestrator.ensureNetwork('fleet_fleet_public');
          networkUpdate = [accountNetId, publicNetId];
        } else {
          networkUpdate = [accountNetId];
        }
      }

      const updateImage = dockerFields.image ?? svc.image;
      const updateRegistryAuth = updateImage ? await getRegistryAuthForImage(accountId, updateImage) : undefined;
      await orchestrator.updateService(svc.dockerServiceId, {
        image: dockerFields.image,
        replicas: dockerFields.replicas,
        env: dockerFields.env,
        labels: {
          ...traefikLabels,
          'fleet.account-id': accountId,
          'fleet.service-id': serviceId,
        },
        constraints: effectiveConstraints,
        ports: updatedPorts,
        volumes: dockerFields.volumes?.map((v: any) => ({
          source: v.source,
          target: v.target,
          readonly: v.readonly ?? false,
        })),
        healthCheck: dockerFields.healthCheck ?? undefined,
        updateParallelism: dockerFields.updateParallelism,
        updateDelay: dockerFields.updateDelay,
        rollbackOnFailure: dockerFields.rollbackOnFailure,
        cpuLimit: dockerFields.cpuLimit,
        memoryLimit: dockerFields.memoryLimit,
        restartCondition: dockerFields.restartCondition,
        restartMaxAttempts: dockerFields.restartMaxAttempts,
        restartDelay: dockerFields.restartDelay,
        networkIds: networkUpdate,
      }, updateRegistryAuth);

      const updateAccountShort = accountId.replace(/-/g, '').substring(0, 12);
      const updateSwarmName = `fleet-${updateAccountShort}-${dockerFields.name ?? svc.name}`.toLowerCase();
      await ensureIngressRoute(`fleet-account-${accountId}`, updateSwarmName, effectiveDomain, dockerFields.sslEnabled ?? svc.sslEnabled ?? true, primaryTargetPort).catch(() => {});
    } catch (err) {
      logger.error({ err }, 'Docker service update failed — DB not updated');
      logToErrorTable({
        level: 'error',
        message: `Docker service update failed: ${String(err)}`,
        stack: err instanceof Error ? err.stack : undefined,
        method: 'PATCH',
        path: c.req.path,
        statusCode: 500,
      });
      return c.json({ error: 'Docker Swarm update failed — no changes applied' }, 500);
    }
  }

  // Docker succeeded (or not needed) — now persist to DB
  const [updated] = await updateReturning(services, {
    ...data,
    githubWebhookId,
    updatedAt: new Date(),
  }, and(eq(services.id, serviceId), eq(services.accountId, accountId))!);


  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.SERVICE_UPDATED,
    description: `Updated service '${svc.name}'`,
    resourceId: serviceId,
    resourceName: svc.name,
  });
  return c.json({
    ...updated,
    ...(migrationFailures.length > 0 ? { migrationFailures } : {}),
  });
}) as any);

// DELETE /:id — destroy service
serviceRoutes.openapi(deleteServiceRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  const { id: serviceId } = c.req.valid('param');
  const { deleteVolumes: deleteVolumesParam } = c.req.valid('query');
  const shouldDeleteVolumes = deleteVolumesParam === 'true';

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  // Remove from Docker Swarm
  const deleteAccountShort = accountId.replace(/-/g, '').substring(0, 12);
  const deleteSwarmServiceName = `fleet-${deleteAccountShort}-${svc.name}`.toLowerCase();
  if (svc.dockerServiceId) {
    try {
      await orchestrator.removeService(svc.dockerServiceId);
    } catch (err) {
      logger.error({ err }, 'Docker service removal failed');
      logToErrorTable({ level: 'error', message: `Docker service removal failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'delete-docker-service' } });
    }
    await removeIngressRoutes(`fleet-account-${accountId}`, deleteSwarmServiceName).catch(() => {});
    // Wait for tasks to stop, then force-remove leftover containers so volumes are released
    await orchestrator.waitForServiceTasksGone(svc.dockerServiceId).catch(() => {});
    await orchestrator.forceRemoveServiceContainers(svc.dockerServiceId);
  }

  // Clean up GitHub webhook
  if (svc.githubRepo && svc.githubWebhookId) {
    try {
      await manageWebhook({
        userId: user.userId,
        githubRepo: svc.githubRepo,
        enable: false,
        existingWebhookId: svc.githubWebhookId,
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to clean up GitHub webhook on service delete');
      logToErrorTable({ level: 'warn', message: `Failed to clean up GitHub webhook on delete: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'delete-webhook-cleanup' } });
    }
  }

  // Clean up uploaded source files
  if (svc.sourceType === 'upload' && svc.sourcePath) {
    try {
      const { uploadService } = await import('../services/upload.service.js');
      await uploadService.deleteServiceFiles(accountId, serviceId);
    } catch (err) {
      logger.error({ err }, 'Failed to clean up upload source files');
      logToErrorTable({ level: 'warn', message: `Upload source files cleanup failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'delete-upload-cleanup' } });
    }
  }

  // Clean up Docker volumes (only if no other active services reference them)
  const vols = svc.volumes as Array<{ source: string; target: string }> | null;
  logger.info({ serviceId, shouldDeleteVolumes, volumeCount: vols?.length ?? 0, volumes: vols }, 'Service delete: volume cleanup');
  if (vols && vols.length > 0) {
    // Check ALL other active services in the account that reference the same volumes
    const otherServices = await db.query.services.findMany({
      where: and(
        eq(services.accountId, accountId),
        not(eq(services.id, svc.id)),
        isNull(services.deletedAt),
      ),
      columns: { volumes: true },
    });

    const usedByOthers = new Set<string>();
    for (const s of otherServices) {
      const sv = s.volumes as Array<{ source: string }> | null;
      if (sv) for (const v of sv) { if (v.source) usedByOthers.add(v.source); }
    }

    for (const v of vols) {
      const isUsed = usedByOthers.has(v.source);
      logger.info({ volume: v.source, isUsed, shouldDeleteVolumes }, 'Service delete: processing volume');
      if (v.source && !isUsed) {
        // Remove Docker volume on ALL Swarm nodes (not just the manager)
        await orchestrator.removeDockerVolumeOnAllNodes(v.source).catch((err) => {
          logger.warn({ err, volume: v.source }, 'Failed to remove Docker volume on service delete');
          logToErrorTable({ level: 'warn', message: `Failed to remove Docker volume on service delete: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'delete-docker-volume' } });
        });

        // Also delete storage volumes (GlusterFS + DB record) when requested
        if (shouldDeleteVolumes) {
          logger.info({ volume: v.source, accountId }, 'Service delete: calling storageManager.deleteVolume');
          await storageManager.deleteVolume(accountId, v.source).catch((err) => {
            logger.warn({ err, volume: v.source }, 'Failed to delete storage volume on service delete');
            logToErrorTable({ level: 'warn', message: `Failed to delete storage volume on service delete: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'delete-storage-volume' } });
          });

          // Fallback: if no DB record existed (non-marketplace services), also try
          // to remove the physical directory from shared storage directly
          try {
            if (storageManager.volumes.isReady() && storageManager.volumes.getHostMountPath) {
              const hostPath = storageManager.volumes.getHostMountPath(v.source);
              if (hostPath) {
                await orchestrator.runOnLocalHost(`rm -rf "${hostPath}"`, { timeoutMs: 15000 }).catch(() => {});
              }
            }
          } catch { /* storage not initialized — skip */ }
        }
      }
    }
  } else {
    logger.info({ serviceId, shouldDeleteVolumes }, 'Service delete: no volumes on service record');
  }

  // Soft-delete the service (keep deployment history)
  await db.update(services).set({ deletedAt: new Date(), status: 'deleted' }).where(eq(services.id, serviceId));


  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.SERVICE_DELETED,
    description: `Deleted service '${svc.name}'${shouldDeleteVolumes ? ' (with volumes)' : ''}`,
    resourceId: serviceId,
    resourceName: svc.name,
  });
  return c.json({ message: 'Service destroyed' });
}) as any);

// POST /:id/restart — restart service (force update)
serviceRoutes.openapi(restartServiceRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: serviceId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  if (!svc.dockerServiceId) {
    return c.json({ error: 'Service has no Docker deployment' }, 400);
  }

  try {
    // Force update triggers a rolling restart
    const restartAuth = await getRegistryAuthForImage(accountId, svc.image);
    await orchestrator.updateService(svc.dockerServiceId, {
      image: svc.image,
    }, restartAuth);


    eventService.log({
      ...eventContext(c),
      eventType: EventTypes.SERVICE_RESTARTED,
      description: `Restarted service '${svc.name}'`,
      resourceId: serviceId,
      resourceName: svc.name,
    });
    return c.json({ message: 'Service restart initiated' });
  } catch (err) {
    logger.error({ err }, 'Service restart failed');
    logToErrorTable({ level: 'error', message: `Service restart failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'restart-service' } });
    return c.json({ error: 'Failed to restart service' }, 500);
  }
}) as any);

// POST /:id/redeploy — rebuild and redeploy
serviceRoutes.openapi(redeployServiceRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: serviceId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  // Atomic status transition — prevents concurrent redeploy race condition
  const [locked] = await updateReturning(services, {
    status: 'deploying',
    updatedAt: new Date(),
  }, and(eq(services.id, serviceId), not(eq(services.status, 'deploying')))!);

  if (!locked) {
    return c.json({ error: 'Service is already deploying. Wait for the current deployment to finish.' }, 409);
  }

  // Upload-based services need a full rebuild through the deployment worker
  if (svc.sourceType === 'upload' && svc.sourcePath) {
    const detection = await uploadService.detectProjectFiles(svc.sourcePath, svc.dockerfile ? undefined : undefined);
    const buildMethod = svc.dockerfile ? 'dockerfile' : detection.buildMethod;
    const buildFile = svc.dockerfile ? 'Dockerfile' : (detection.buildFile ?? undefined);

    if (buildMethod === 'none') {
      // Revert the status lock
      await db.update(services).set({ status: svc.status ?? 'stopped', updatedAt: new Date() }).where(eq(services.id, serviceId));
      return c.json({ error: 'No Dockerfile or docker-compose file found. Add one via the Files tab first.' }, 400);
    }

    const [deployment] = await insertReturning(deployments, {
      serviceId,
      status: 'building',
    });

    const jobData: DeploymentJobData = {
      deploymentId: deployment!.id,
      serviceId,
      accountId,
      commitSha: null,
      sourceType: 'upload',
      sourcePath: svc.sourcePath,
      buildMethod,
      buildFile,
    };

    // Upload rebuilds MUST run inline — uploaded files live on this replica's filesystem.
    // Queuing via BullMQ could route the job to a different replica that doesn't have the files.
    processDeploymentInline(jobData).catch((err) => {
      logger.error({ err }, 'Inline redeploy rebuild failed');
      logToErrorTable({ level: 'error', message: `Inline redeploy rebuild failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'redeploy-inline-rebuild' } });
    });

    eventService.log({
      ...eventContext(c),
      eventType: EventTypes.SERVICE_REDEPLOYED,
      description: `Rebuild triggered for upload service '${svc.name}'`,
      resourceId: serviceId,
      resourceName: svc.name,
    });
    return c.json({ message: 'Rebuild initiated', deploymentId: deployment?.id });
  }

  // For image-based / GitHub services — re-pull the existing image
  const [deployment] = await insertReturning(deployments, {
    serviceId,
    status: 'deploying',
    imageTag: svc.image,
  });

  // Helper to create a fresh Docker Swarm service
  async function createDockerService() {
    const networkName = `fleet-account-${accountId}`;
    const networkId = await orchestrator.ensureNetwork(networkName);

    // Domain services need the Traefik public network for routing
    const networkIds = [networkId];
    if (svc!.domain) {
      const publicNetId = await orchestrator.ensureNetwork('fleet_fleet_public');
      networkIds.push(publicNetId);
    }

    const accountShort = accountId.replace(/-/g, '').substring(0, 12);
    const swarmServiceName = `fleet-${accountShort}-${svc!.name}`.toLowerCase();
    const svcPorts = (svc!.ports as any[]) ?? [];
    const primaryTargetPort = svcPorts[0]?.target ?? 80;
    const traefikLabels = buildTraefikLabels(svc!.name, svc!.domain ?? null, svc!.sslEnabled ?? true, primaryTargetPort, (svc!.robotsConfig as any)?.mode ?? 'default');
    const constraints = [...((svc!.placementConstraints as string[]) ?? [])];
    if (svc!.nodeConstraint) {
      constraints.push(`node.id == ${svc!.nodeConstraint}`);
    }

    const storageLimitMb = await getContainerDiskLimit(accountId!);

    // Port management: domain services use Traefik, others get auto-allocated ports
    const ingressPorts = svc!.domain
      ? []
      : await allocateIngressPorts(
          svcPorts.map((p: any) => ({ target: p.target, protocol: p.protocol ?? 'tcp' })),
        );

    const recreateAuth = await getRegistryAuthForImage(accountId!, svc!.image);
    const result = await orchestrator.createService({
      name: swarmServiceName,
      image: svc!.image,
      replicas: svc!.replicas ?? 1,
      env: (svc!.env as Record<string, string>) ?? {},
      ports: ingressPorts,
      volumes: ((svc!.volumes as any[]) ?? []).map((v: any) => ({
        source: v.source,
        target: v.target,
        readonly: v.readonly ?? false,
      })),
      labels: {
        ...traefikLabels,
        'fleet.account-id': accountId!,
        'fleet.service-id': serviceId,
      },
      constraints,
      healthCheck: (svc!.healthCheck as any) ?? undefined,
      updateParallelism: svc!.updateParallelism ?? 1,
      updateDelay: svc!.updateDelay ?? '10s',
      rollbackOnFailure: svc!.rollbackOnFailure ?? true,
      networkIds,
      storageLimitMb,
      registryAuth: recreateAuth,
    });

    await ensureIngressRoute(`fleet-account-${accountId}`, swarmServiceName, svc!.domain ?? null, svc!.sslEnabled ?? true, primaryTargetPort).catch(() => {});

    // Save allocated ports back to DB
    if (ingressPorts.length > 0) {
      await db.update(services).set({ ports: ingressPorts }).where(eq(services.id, serviceId));
    }

    return result.id;
  }

  try {
    let dockerSvcId = svc.dockerServiceId;

    if (dockerSvcId) {
      // Check if the Docker service still exists in Swarm
      try {
        await orchestrator.inspectService(dockerSvcId);
        // Exists — force re-pull the image
        const repullAuth = await getRegistryAuthForImage(accountId, svc.image);
        await orchestrator.updateService(dockerSvcId, {
          image: svc.image,
        }, repullAuth);
      } catch {
        // Docker service is gone — create a new one
        logger.warn({ serviceId, dockerSvcId }, 'Docker service not found during redeploy — recreating');
        dockerSvcId = await createDockerService();
        await db.update(services).set({ dockerServiceId: dockerSvcId }).where(eq(services.id, serviceId));
      }
    } else {
      // No Docker service exists — create one
      dockerSvcId = await createDockerService();
      await db.update(services).set({ dockerServiceId: dockerSvcId }).where(eq(services.id, serviceId));
    }

    await db
      .update(deployments)
      .set({ status: 'succeeded' })
      .where(eq(deployments.id, deployment!.id));

    await db
      .update(services)
      .set({ status: 'deploying', updatedAt: new Date() })
      .where(eq(services.id, serviceId));
  } catch (err) {
    logger.error({ err }, 'Redeployment failed');
    logToErrorTable({
      level: 'error',
      message: `Redeployment failed: ${String(err)}`,
      stack: err instanceof Error ? err.stack : undefined,
      method: 'POST',
      path: c.req.path,
      statusCode: 500,
    });

    await db
      .update(deployments)
      .set({ status: 'failed', log: String(err) })
      .where(eq(deployments.id, deployment!.id));

    await db
      .update(services)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(services.id, serviceId));
  }

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.SERVICE_REDEPLOYED,
    description: `Redeployed service '${svc.name}'`,
    resourceId: serviceId,
    resourceName: svc.name,
  });
  return c.json({ message: 'Redeployment initiated', deploymentId: deployment?.id });
}) as any);

// POST /:id/stop — stop a running service (scale to 0)
serviceRoutes.openapi(stopServiceRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: serviceId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  if (svc.status === 'deploying') {
    return c.json({ error: 'Cannot stop a service that is currently deploying' }, 409);
  }

  if (svc.status === 'stopped') {
    return c.json({ error: 'Service is already stopped' }, 400);
  }

  if (svc.dockerServiceId) {
    try {
      await orchestrator.scaleService(svc.dockerServiceId, 0);
    } catch (err) {
      logger.error({ err }, 'Docker scale-to-zero failed');
      logToErrorTable({ level: 'error', message: `Docker scale-to-zero failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'stop-scale-to-zero' } });
      return c.json({ error: 'Failed to stop service in Docker' }, 500);
    }
  }

  await db
    .update(services)
    .set({ status: 'stopped', stoppedAt: new Date(), updatedAt: new Date() })
    .where(eq(services.id, serviceId));


  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.SERVICE_STOPPED,
    description: `Stopped service '${svc.name}'`,
    resourceId: serviceId,
    resourceName: svc.name,
  });
  return c.json({ message: 'Service stopped' });
}) as any);

// POST /:id/cancel-deploy — cancel an in-progress deployment
serviceRoutes.openapi(cancelDeployRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: serviceId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  if (svc.status !== 'deploying' && svc.status !== 'building') {
    return c.json({ error: 'Service is not currently deploying' }, 400);
  }

  // Find the active deployment and cancel its build (building or deploying)
  const activeDeployment = await db.query.deployments.findFirst({
    where: and(
      eq(deployments.serviceId, serviceId),
      not(eq(deployments.status, 'succeeded')),
      not(eq(deployments.status, 'failed')),
    ),
    orderBy: desc(deployments.createdAt),
  });

  if (activeDeployment) {
    await buildService.cancelBuild(activeDeployment.id);
    await db
      .update(deployments)
      .set({ status: 'failed', log: (activeDeployment.log ?? '') + 'Deployment cancelled by user.\n' })
      .where(eq(deployments.id, activeDeployment.id));
  }

  // Also mark any 'deploying' status deployments as failed
  await db
    .update(deployments)
    .set({ status: 'failed', log: 'Deployment cancelled by user.\n' })
    .where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'deploying')));

  await db
    .update(services)
    .set({ status: svc.dockerServiceId ? 'running' : 'stopped', updatedAt: new Date() })
    .where(eq(services.id, serviceId));


  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.DEPLOYMENT_CANCELLED,
    description: `Cancelled deployment for '${svc.name}'`,
    resourceId: serviceId,
    resourceName: svc.name,
  });
  return c.json({ message: 'Deployment cancelled' });
}) as any);

// POST /:id/start — start a stopped service (restore replicas)
serviceRoutes.openapi(startServiceRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: serviceId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  if (svc.status !== 'stopped') {
    return c.json({ error: 'Service is not stopped' }, 400);
  }

  if (!svc.dockerServiceId) {
    // No Docker service exists — deploy it now
    try {
      const networkName = `fleet-account-${accountId}`;
      const networkId = await orchestrator.ensureNetwork(networkName);

      // Domain services need the Traefik public network for routing
      const networkIds = [networkId];
      if (svc.domain) {
        const publicNetId = await orchestrator.ensureNetwork('fleet_fleet_public');
        networkIds.push(publicNetId);
      }

      const accountShort = accountId.replace(/-/g, '').substring(0, 12);
      const swarmServiceName = `fleet-${accountShort}-${svc.name}`.toLowerCase();
      const svcPorts = (svc.ports as any[]) ?? [];
      const primaryTargetPort = svcPorts[0]?.target ?? 80;

      const traefikLabels = buildTraefikLabels(svc.name, svc.domain ?? null, svc.sslEnabled ?? true, primaryTargetPort, (svc.robotsConfig as any)?.mode ?? 'default');

      const constraints = [...((svc.placementConstraints as string[]) ?? [])];
      if (svc.nodeConstraint) {
        constraints.push(`node.id == ${svc.nodeConstraint}`);
      }

      const storageLimitMb = await getContainerDiskLimit(accountId);

      // Port management: domain services use Traefik, others get auto-allocated ports
      const ingressPorts = svc.domain
        ? []
        : await allocateIngressPorts(
            svcPorts.map((p: any) => ({ target: p.target, protocol: p.protocol ?? 'tcp' })),
          );

      const stackRegistryAuth = await getRegistryAuthForImage(accountId, svc.image);
      const result = await orchestrator.createService({
        name: swarmServiceName,
        image: svc.image,
        replicas: svc.replicas ?? 1,
        env: (svc.env as Record<string, string>) ?? {},
        ports: ingressPorts,
        volumes: ((svc.volumes as any[]) ?? []).map((v: any) => ({
          source: v.source,
          target: v.target,
          readonly: v.readonly ?? false,
        })),
        labels: {
          ...traefikLabels,
          'fleet.account-id': accountId,
          'fleet.service-id': serviceId,
        },
        constraints,
        healthCheck: (svc.healthCheck as any) ?? undefined,
        updateParallelism: svc.updateParallelism ?? 1,
        updateDelay: svc.updateDelay ?? '10s',
        rollbackOnFailure: svc.rollbackOnFailure ?? true,
        networkIds,
        storageLimitMb,
        registryAuth: stackRegistryAuth,
      });

      await ensureIngressRoute(`fleet-account-${accountId}`, swarmServiceName, svc.domain ?? null, svc.sslEnabled ?? true, primaryTargetPort).catch(() => {});

      await db
        .update(services)
        .set({ dockerServiceId: result.id, status: 'deploying', stoppedAt: null, updatedAt: new Date() })
        .where(eq(services.id, serviceId));

    
      eventService.log({
        ...eventContext(c),
        eventType: EventTypes.SERVICE_STARTED,
        description: `Started service '${svc.name}'`,
        resourceId: serviceId,
        resourceName: svc.name,
      });
      return c.json({ message: 'Service deployed and started' });
    } catch (err) {
      logger.error({ err }, 'Docker deployment on start failed');
      logToErrorTable({ level: 'error', message: `Service start deploy failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'start-deploy' } });
      return c.json({ error: 'Failed to deploy service to Docker' }, 500);
    }
  }

  try {
    await orchestrator.scaleService(svc.dockerServiceId, svc.replicas ?? 1);
  } catch (err) {
    logger.error({ err }, 'Docker scale-up failed');
    logToErrorTable({ level: 'error', message: `Service start scale-up failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'start-scale-up' } });
    return c.json({ error: 'Failed to start service in Docker' }, 500);
  }

  await db
    .update(services)
    .set({ status: 'deploying', stoppedAt: null, updatedAt: new Date() })
    .where(eq(services.id, serviceId));


  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.SERVICE_STARTED,
    description: `Started service '${svc.name}'`,
    resourceId: serviceId,
    resourceName: svc.name,
  });
  return c.json({ message: 'Service started' });
}) as any);

// POST /:id/sync — manually sync service status with Docker
serviceRoutes.openapi(syncServiceRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: serviceId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
    columns: { id: true, status: true, dockerServiceId: true, replicas: true },
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  let newStatus = svc.status;
  const updateFields: Record<string, any> = { updatedAt: new Date() };

  if (!svc.dockerServiceId) {
    if (svc.status === 'running' || svc.status === 'deploying') {
      newStatus = 'stopped';
    }
  } else {
    try {
      await orchestrator.inspectService(svc.dockerServiceId);
      const tasks = await orchestrator.getServiceTasks(svc.dockerServiceId);
      const running = tasks.filter((t) => t.status === 'running').length;
      const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'rejected').length;

      if (running > 0) {
        newStatus = 'running';
      } else if (failed > 0 && tasks.length > 0) {
        newStatus = 'failed';
      } else if (svc.status === 'running') {
        // Service exists but no running/failed tasks — might be pending
        newStatus = 'deploying';
      }
    } catch {
      // Docker service gone
      newStatus = 'stopped';
      updateFields['dockerServiceId'] = null;
    }
  }

  updateFields['status'] = newStatus;
  await db.update(services).set(updateFields).where(eq(services.id, svc.id));

  return c.json({ status: newStatus, synced: true });
}) as any);

// POST /:id/volume-migrate — copy data between volumes (with optional clean)
serviceRoutes.openapi(volumeMigrateRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: serviceId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
    columns: { id: true, volumes: true },
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  const data = c.req.valid('json');

  // Verify the volumes are actually related to this service
  const svcVolumes = (svc.volumes as Array<{ source: string; target: string }>) ?? [];
  const knownSources = new Set(svcVolumes.map((v) => v.source));
  if (!knownSources.has(data.sourceVolume) && !knownSources.has(data.targetVolume)) {
    return c.json({ error: 'Neither volume is attached to this service' }, 400);
  }

  try {
    if (data.clean) {
      logger.info({ volume: data.targetVolume }, 'Cleaning target volume before migration');
      await orchestrator.cleanVolume(data.targetVolume);
    }
    logger.info({ from: data.sourceVolume, to: data.targetVolume }, 'Migrating volume data (manual retry)');
    await orchestrator.copyVolumeData(data.sourceVolume, data.targetVolume);
    return c.json({ message: 'Volume data migrated successfully' });
  } catch (err) {
    logger.error({ err, from: data.sourceVolume, to: data.targetVolume }, 'Volume migration failed');
    logToErrorTable({ level: 'error', message: `Volume migration failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'volume-migration' } });
    return c.json({ error: `Volume migration failed: ${(err as Error).message}` }, 500);
  }
}) as any);

// GET /:id/logs — stream service logs
serviceRoutes.openapi(getServiceLogsRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: serviceId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc || !svc.dockerServiceId) {
    return c.json({ error: 'Service not found or has no Docker deployment' }, 404);
  }

  const tail = Math.min(parseInt(c.req.query('tail') ?? '100', 10), 5000);
  const LOGS_TIMEOUT_MS = 30_000;

  try {
    const result = await orchestrator.getServiceLogs(svc.dockerServiceId, { tail, follow: false });

    // Consume the result — Dockerode may return a Buffer or a stream.
    // Use event listeners (not `for await`) because Dockerode's service log
    // streams can fail to signal completion, causing `for await` to hang.
    let raw: Buffer;
    if (Buffer.isBuffer(result)) {
      raw = result;
    } else {
      raw = await new Promise<Buffer>((resolve) => {
        const chunks: Buffer[] = [];
        const stream = result as NodeJS.ReadableStream & { destroy(): void };
        const finish = () => {
          stream.removeAllListeners();
          stream.destroy();
          resolve(Buffer.concat(chunks));
        };
        stream.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        stream.on('end', finish);
        stream.on('error', finish);
        setTimeout(finish, LOGS_TIMEOUT_MS);
      });
    }

    // Docker multiplexed log format: each frame has an 8-byte header
    // [stream_type(1), 0, 0, 0, size(4 big-endian)] followed by payload
    // Demultiplex to extract plain text
    const lines: string[] = [];
    let offset = 0;
    while (offset + 8 <= raw.length) {
      const size = raw.readUInt32BE(offset + 4);
      if (offset + 8 + size > raw.length) break;
      const payload = raw.subarray(offset + 8, offset + 8 + size).toString('utf-8');
      lines.push(payload);
      offset += 8 + size;
    }

    // If demultiplexing produced no results, the output might be raw text (TTY mode)
    const logs = lines.length > 0 ? lines.join('') : raw.toString('utf-8');
    return c.json({ logs });
  } catch (err: any) {
    // Docker service may have been removed — return empty logs with context
    if (err?.statusCode === 404 || err?.reason === 'no such service') {
      return c.json({ logs: '', warning: 'Docker service not found — it may have been removed or is not yet deployed.' });
    }
    logger.error({ err }, 'Log fetch failed');
    logToErrorTable({ level: 'error', message: `Log fetch failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'fetch-logs' } });
    return c.json({ error: 'Failed to fetch logs' }, 500);
  }
}) as any);

// GET /:id/deployments — deployment history
serviceRoutes.openapi(getDeploymentsRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: serviceId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  const deploys = await db.query.deployments.findMany({
    where: eq(deployments.serviceId, serviceId),
    orderBy: (d: any, { desc }: any) => desc(d.createdAt),
    limit: 100,
  });

  return c.json(deploys);
}) as any);

// DELETE /stack/:stackId — destroy all services in a stack
serviceRoutes.openapi(deleteStackRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  const { stackId } = c.req.valid('param');
  const { deleteVolumes: deleteVolumesParam } = c.req.valid('query');
  const shouldDeleteVolumes = deleteVolumesParam === 'true';

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const stackServices = await db.query.services.findMany({
    where: and(
      eq(services.accountId, accountId),
      eq(services.stackId, stackId),
      isNull(services.deletedAt),
    ),
  });

  if (stackServices.length === 0) {
    return c.json({ error: 'Stack not found' }, 404);
  }

  const results: { id: string; name: string; success: boolean }[] = [];

  // Collect all Docker volume names and service IDs for cleanup
  const volumeNames = new Set<string>();
  const removedDockerServiceIds: string[] = [];

  for (const svc of stackServices) {
    try {
      if (svc.dockerServiceId) {
        await orchestrator.removeService(svc.dockerServiceId).catch((err) => {
          logger.warn({ err, serviceId: svc.id }, 'Docker removal failed during stack delete');
          logToErrorTable({ level: 'warn', message: `Docker removal failed during stack delete: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'stack-delete-docker-removal' } });
        });
        const stackDeleteAccountShort = accountId.replace(/-/g, '').substring(0, 12);
        const stackDeleteSwarmName = `fleet-${stackDeleteAccountShort}-${svc.name}`.toLowerCase();
        await removeIngressRoutes(`fleet-account-${accountId}`, stackDeleteSwarmName).catch(() => {});
        removedDockerServiceIds.push(svc.dockerServiceId);
      }

      if (svc.githubRepo && svc.githubWebhookId) {
        await manageWebhook({
          userId: user.userId,
          githubRepo: svc.githubRepo,
          enable: false,
          existingWebhookId: svc.githubWebhookId,
        }).catch(() => {});
      }

      // Track volumes for cleanup
      const vols = svc.volumes as Array<{ source: string; target: string }> | null;
      if (vols) {
        for (const v of vols) {
          if (v.source) volumeNames.add(v.source);
        }
      }

      await db.update(services).set({ deletedAt: new Date(), status: 'deleted' }).where(eq(services.id, svc.id));
      results.push({ id: svc.id, name: svc.name, success: true });
    } catch (err) {
      logger.error({ err, serviceId: svc.id }, 'Failed to delete stack service');
      logToErrorTable({ level: 'error', message: `Failed to delete stack service: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'stack-delete-service' } });
      results.push({ id: svc.id, name: svc.name, success: false });
    }
  }

  // Wait for tasks to stop, then force-remove leftover containers so volumes are released
  await Promise.all(
    removedDockerServiceIds.map((id) => orchestrator.waitForServiceTasksGone(id).catch(() => {})),
  );
  await Promise.all(
    removedDockerServiceIds.map((id) => orchestrator.forceRemoveServiceContainers(id)),
  );

  // Check which volumes are still used by other services outside this stack
  const stackServiceIds = new Set(stackServices.map((s) => s.id));
  const otherServices = await db.query.services.findMany({
    where: and(
      eq(services.accountId, accountId),
      isNull(services.deletedAt),
    ),
    columns: { id: true, volumes: true },
  });

  const usedByOthers = new Set<string>();
  for (const s of otherServices) {
    if (stackServiceIds.has(s.id)) continue; // skip services we just deleted
    const sv = s.volumes as Array<{ source: string }> | null;
    if (sv) for (const v of sv) { if (v.source) usedByOthers.add(v.source); }
  }

  // Clean up Docker volumes after containers are gone (only if not used by other services)
  for (const volName of volumeNames) {
    if (usedByOthers.has(volName)) continue;

    // Remove Docker volume on ALL Swarm nodes (not just the manager)
    await orchestrator.removeDockerVolumeOnAllNodes(volName).catch((err) => {
      logger.warn({ err, volume: volName }, 'Failed to remove Docker volume during stack delete');
      logToErrorTable({ level: 'warn', message: `Failed to remove Docker volume during stack delete: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'stack-delete-docker-volume' } });
    });

    // Also delete storage volumes (GlusterFS + DB record) when requested
    if (shouldDeleteVolumes) {
      await storageManager.deleteVolume(accountId, volName).catch((err) => {
        logger.warn({ err, volume: volName }, 'Failed to delete storage volume during stack delete');
        logToErrorTable({ level: 'warn', message: `Failed to delete storage volume during stack delete: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'stack-delete-storage-volume' } });
      });

      // Fallback: remove physical directory from shared storage directly
      try {
        if (storageManager.volumes.isReady() && storageManager.volumes.getHostMountPath) {
          const hostPath = storageManager.volumes.getHostMountPath(volName);
          if (hostPath) {
            await orchestrator.runOnLocalHost(`rm -rf "${hostPath}"`, { timeoutMs: 15000 }).catch(() => {});
          }
        }
      } catch { /* storage not initialized */ }
    }
  }

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.STACK_DELETED,
    description: `Deleted stack (${stackServices.length} services)`,
    details: { serviceCount: stackServices.length },
  });
  return c.json({ message: 'Stack deleted', results });
}) as any);

// POST /stack/:stackId/restart — restart all services in a stack
serviceRoutes.openapi(restartStackRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { stackId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const stackServices = await db.query.services.findMany({
    where: and(
      eq(services.accountId, accountId),
      eq(services.stackId, stackId),
      isNull(services.deletedAt),
    ),
  });

  if (stackServices.length === 0) {
    return c.json({ error: 'Stack not found' }, 404);
  }

  const results: { id: string; name: string; success: boolean }[] = [];

  for (const svc of stackServices) {
    if (!svc.dockerServiceId) {
      results.push({ id: svc.id, name: svc.name, success: false });
      continue;
    }

    try {
      const stackRestartAuth = await getRegistryAuthForImage(accountId, svc.image);
      await orchestrator.updateService(svc.dockerServiceId, { image: svc.image }, stackRestartAuth);
      results.push({ id: svc.id, name: svc.name, success: true });
    } catch (err) {
      logger.error({ err, serviceId: svc.id }, 'Failed to restart stack service');
      logToErrorTable({ level: 'error', message: `Failed to restart stack service: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'stack-restart-service' } });
      results.push({ id: svc.id, name: svc.name, success: false });
    }
  }


  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.STACK_RESTARTED,
    description: `Restarted stack (${stackServices.length} services)`,
    details: { serviceCount: stackServices.length },
  });
  return c.json({ message: 'Stack restart initiated', results });
}) as any);

// GET /stack/:stackId/status — deployment progress for a template stack
serviceRoutes.openapi(getStackStatusRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { stackId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const stackServices = await db.query.services.findMany({
    where: and(
      eq(services.accountId, accountId),
      eq(services.stackId, stackId),
    ),
  });

  if (stackServices.length === 0) {
    return c.json({ error: 'Stack not found' }, 404);
  }

  const statuses = stackServices.map((s) => s.status);
  let overall: 'deploying' | 'running' | 'failed' | 'partial' = 'running';
  if (statuses.some((s) => s === 'deploying')) {
    overall = 'deploying';
  } else if (statuses.every((s) => s === 'running')) {
    overall = 'running';
  } else if (statuses.every((s) => s === 'failed')) {
    overall = 'failed';
  } else if (statuses.some((s) => s === 'failed')) {
    overall = 'partial';
  }

  return c.json({
    stackId,
    overall,
    services: stackServices.map((s) => ({
      id: s.id,
      name: s.name,
      image: s.image,
      status: s.status,
      dockerServiceId: s.dockerServiceId,
    })),
  });
}) as any);

// GET /:serviceId/dockerfile — get Dockerfile content
serviceRoutes.openapi(getDockerfileRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });
  if (!svc) return c.json({ error: 'Service not found' }, 404);

  // 1. Check DB-stored Dockerfile (auto-generated or user-edited)
  if (svc.dockerfile) {
    return c.json({ content: svc.dockerfile, source: 'generated', runtime: null });
  }

  // 2. For upload services, try to read Dockerfile from source directory
  if (svc.sourceType === 'upload' && svc.sourcePath) {
    try {
      const { uploadService } = await import('../services/upload.service.js');
      const result = await uploadService.readFile(svc.sourcePath, 'Dockerfile');
      return c.json({ content: result.content, source: 'file', runtime: null });
    } catch {
      // No Dockerfile on disk
    }
  }

  return c.json({ content: null, source: 'none', runtime: null });
}) as any);

// POST /preview — dry-run deployment preview (no actual deployment)
serviceRoutes.openapi(previewServiceRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const data = c.req.valid('json');

  const warnings: string[] = [];

  // Check service quota (DB overrides env)
  let previewQuota = parseInt(process.env['MAX_SERVICES_PER_ACCOUNT'] ?? '50', 10);
  try {
    const dbVal = await db.query.platformSettings.findFirst({ where: eq(platformSettings.key, 'limits:maxServicesPerAccount') });
    if (dbVal?.value != null) previewQuota = Number(dbVal.value) || previewQuota;
  } catch { /* use env default */ }
  const existingCount = await db.query.services.findMany({
    where: and(eq(services.accountId, accountId), isNull(services.deletedAt)),
    columns: { id: true },
  });
  if (existingCount.length >= previewQuota) {
    warnings.push(`Service limit reached (${previewQuota}). Deployment will fail.`);
  }

  // Check port collisions
  if (data.ports.some((p: any) => p.published)) {
    const publishedPorts = data.ports.filter((p: any) => p.published).map((p: any) => p.published!);
    const otherServices = await db.query.services.findMany({
      where: and(not(eq(services.accountId, accountId)), isNull(services.deletedAt)),
      columns: { id: true, ports: true },
    });
    for (const existing of otherServices) {
      const existingPorts = (existing.ports as any[])?.map((p: any) => p.published).filter(Boolean) ?? [];
      for (const port of publishedPorts) {
        if (existingPorts.includes(port)) {
          warnings.push(`Port ${port} is already in use by another service`);
        }
      }
    }
  }

  const traefikLabels = buildTraefikLabels(data.name, data.domain ?? null, data.sslEnabled);

  return c.json({
    preview: {
      name: data.name,
      image: data.image,
      replicas: data.replicas,
      ports: data.ports,
      volumes: data.volumes,
      domain: data.domain ?? null,
      sslEnabled: data.sslEnabled,
      envCount: Object.keys(data.env).length,
      traefikEnabled: traefikLabels['traefik.enable'] === 'true',
      sourceType: data.sourceType ?? (data.githubRepo ? 'github' : 'docker'),
    },
    warnings,
    valid: warnings.length === 0,
  });
}) as any);

// PUT /:serviceId/dockerfile — update Dockerfile content
serviceRoutes.openapi(updateDockerfileRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });
  if (!svc) return c.json({ error: 'Service not found' }, 404);

  const body = c.req.valid('json');

  // Save to DB
  await db.update(services)
    .set({ dockerfile: body.content, updatedAt: new Date() })
    .where(eq(services.id, serviceId));

  // Also write to disk for upload services
  if (svc.sourceType === 'upload' && svc.sourcePath) {
    try {
      const { uploadService } = await import('../services/upload.service.js');
      await uploadService.writeFile(svc.sourcePath, 'Dockerfile', body.content);
    } catch (err) {
      logger.warn({ err }, 'Failed to write Dockerfile to source directory');
      logToErrorTable({ level: 'warn', message: `Failed to write Dockerfile to source directory: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'services', operation: 'write-dockerfile' } });
    }
  }

  return c.json({ message: 'Dockerfile updated' });
}) as any);

// ── Nginx config handlers ─────────────────────────────────────────────────

// GET /:serviceId/nginx-config — get current config
serviceRoutes.openapi(getNginxConfigRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });
  if (!svc) return c.json({ error: 'Service not found' }, 404);

  if (!isNginxService(svc.image, svc.dockerfile)) {
    return c.json({ error: 'Service does not use nginx' }, 400);
  }

  return c.json({
    config: svc.nginxConfig ?? DEFAULT_NGINX_CONFIG,
    isCustom: !!svc.nginxConfig,
    defaultConfig: DEFAULT_NGINX_CONFIG,
  });
}) as any);

// PUT /:serviceId/nginx-config — save (and optionally apply live)
serviceRoutes.openapi(updateNginxConfigRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });
  if (!svc) return c.json({ error: 'Service not found' }, 404);

  if (!isNginxService(svc.image, svc.dockerfile)) {
    return c.json({ error: 'Service does not use nginx' }, 400);
  }

  const body = c.req.valid('json');

  // Save to DB
  await db.update(services)
    .set({ nginxConfig: body.config, updatedAt: new Date() })
    .where(eq(services.id, serviceId));

  logger.info({ userId: user.userId, serviceId }, 'Nginx config updated');

  let applied = false;
  let validationError: string | undefined;

  // Apply to running container(s) if requested
  if (body.applyNow && svc.dockerServiceId && svc.status === 'running') {
    try {
      const tasks = await orchestrator.getServiceTasks(svc.dockerServiceId);
      const running = tasks.filter((t: any) => t.status === 'running' && t.containerStatus?.containerId);

      for (const task of running) {
        const containerId = task.containerStatus!.containerId;
        const nodeId = task.nodeId;

        // Write config and validate
        const writeCmd = ['sh', '-c', `cat > /etc/nginx/conf.d/default.conf && nginx -t 2>&1`];
        const { Readable } = await import('node:stream');
        const input = Readable.from([body.config]);
        const writeResult = await orchestrator.nodeAwareExecCommandWithInput(containerId, nodeId, writeCmd, input);

        if (writeResult.exitCode !== 0) {
          validationError = writeResult.stdout?.trim() || writeResult.stderr?.trim() || 'nginx -t failed';
          // Restore old config on validation failure
          const oldConfig = svc.nginxConfig ?? DEFAULT_NGINX_CONFIG;
          const restoreInput = Readable.from([oldConfig]);
          await orchestrator.nodeAwareExecCommandWithInput(containerId, nodeId,
            ['sh', '-c', 'cat > /etc/nginx/conf.d/default.conf'],
            restoreInput,
          );
          break;
        }

        // Reload nginx
        await orchestrator.nodeAwareExecCommand(containerId, nodeId, ['nginx', '-s', 'reload']);
      }

      if (!validationError && running.length > 0) {
        applied = true;
      }
    } catch (err) {
      logger.warn({ err, serviceId }, 'Failed to apply nginx config live');
      validationError = err instanceof Error ? err.message : 'Failed to apply config';
    }
  }

  return c.json({
    message: applied ? 'Nginx config saved and applied' : 'Nginx config saved',
    applied,
    ...(validationError ? { validationError } : {}),
  });
}) as any);

// POST /:serviceId/nginx-config/reset — reset to default
serviceRoutes.openapi(resetNginxConfigRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });
  if (!svc) return c.json({ error: 'Service not found' }, 404);

  await db.update(services)
    .set({ nginxConfig: null, updatedAt: new Date() })
    .where(eq(services.id, serviceId));

  logger.info({ userId: user.userId, serviceId }, 'Nginx config reset to default');

  // Apply default to running container if possible
  if (svc.dockerServiceId && svc.status === 'running') {
    try {
      const tasks = await orchestrator.getServiceTasks(svc.dockerServiceId);
      const running = tasks.filter((t: any) => t.status === 'running' && t.containerStatus?.containerId);
      for (const task of running) {
        const { Readable } = await import('node:stream');
        const input = Readable.from([DEFAULT_NGINX_CONFIG]);
        await orchestrator.nodeAwareExecCommandWithInput(
          task.containerStatus!.containerId, task.nodeId,
          ['sh', '-c', 'cat > /etc/nginx/conf.d/default.conf && nginx -s reload'],
          input,
        );
      }
    } catch (err) {
      logger.warn({ err, serviceId }, 'Failed to apply default nginx config to running container');
    }
  }

  return c.json({ message: 'Nginx config reset to default' });
}) as any);

export default serviceRoutes;
