import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, services, deployments, insertReturning, eq, and, isNull } from '@fleet/db';
import { authMiddleware, requireScope, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireMember } from '../middleware/rbac.js';
import { requireActiveSubscription } from '../middleware/subscription.js';
import { orchestrator } from '../services/orchestrator.js';
import { uploadService } from '../services/upload.service.js';
import { logger } from '../services/logger.js';
import { processDeploymentInline, type DeploymentJobData } from '../workers/deployment.worker.js';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { jsonBody, jsonContent, errorResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

const uploadRoutes = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

uploadRoutes.use('*', authMiddleware);
uploadRoutes.use('*', tenantMiddleware);

import { buildTraefikLabels, ensureIngressRoute } from '../services/traefik.js';

// POST /deploy — upload and deploy a new service
const deployRoute = createRoute({
  method: 'post',
  path: '/deploy',
  tags: ['Upload'],
  summary: 'Upload and deploy a new service',
  security: bearerSecurity,
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any().openapi({ type: 'string', format: 'binary' }),
            name: z.string(),
            buildFile: z.string().optional(),
            replicas: z.string().optional(),
            domain: z.string().optional(),
            sslEnabled: z.string().optional(),
            env: z.string().optional(),
            ports: z.string().optional(),
            volumes: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: jsonContent(z.object({
      service: z.any(),
      deploymentId: z.string(),
      detectedFiles: z.array(z.string()),
      buildMethod: z.string(),
      buildFile: z.string().nullable(),
      detectedRuntime: z.string().nullable(),
    }), 'Service created and deployment triggered'),
    ...standardErrors,
  },
  middleware: [requireMember, requireActiveSubscription, requireScope('write')],
});

uploadRoutes.openapi(deployRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const body = await c.req.parseBody({ all: true });
  const file = body['file'] as File | undefined;
  const name = body['name'] as string | undefined;
  const buildFile = (body['buildFile'] as string) || '';
  const replicas = parseInt((body['replicas'] as string) || '1', 10);
  const domain = (body['domain'] as string) || null;
  const sslEnabled = (body['sslEnabled'] as string) !== 'false';

  let env: Record<string, string> = {};
  let ports: Array<{ target: number; published: number; protocol: string }> = [];
  let volumes: Array<{ source: string; target: string; readonly: boolean }> = [];

  try {
    if (body['env']) env = JSON.parse(body['env'] as string);
    if (body['ports']) ports = JSON.parse(body['ports'] as string);
    if (body['volumes']) volumes = JSON.parse(body['volumes'] as string);
  } catch {
    return c.json({ error: 'Invalid JSON in env, ports, or volumes field' }, 400);
  }

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'Archive file is required' }, 400);
  }

  if (!name || !/^[a-zA-Z0-9]([a-zA-Z0-9_.-]*[a-zA-Z0-9])?$/.test(name) || name.length > 63) {
    return c.json({ error: 'Invalid service name' }, 400);
  }

  const archiveType = uploadService.detectArchiveType(file.name);
  if (!archiveType) {
    return c.json({ error: 'Unsupported file type. Supported: .zip, .tar, .tar.gz, .tgz' }, 400);
  }

  // Write uploaded file to temp location
  const tmpPath = join(tmpdir(), `fleet-upload-${randomUUID()}${archiveType === 'zip' ? '.zip' : archiveType === 'tar' ? '.tar' : '.tar.gz'}`);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tmpPath, buffer);

    // Create a placeholder service ID for the storage path
    const tempServiceId = randomUUID();

    // Extract and store
    const sourcePath = await uploadService.extractAndStore({
      accountId,
      serviceId: tempServiceId,
      archivePath: tmpPath,
      archiveType,
    });

    // Detect project files and build method (never fails)
    const detection = await uploadService.detectProjectFiles(sourcePath, buildFile || undefined);

    // If runtime detection found a default port and no ports provided, use it
    if (detection.defaultPort && ports.length === 0) {
      ports = [{ target: detection.defaultPort, published: 0, protocol: 'tcp' }];
    }

    // Port management: domain services use Traefik (no ingress ports),
    // non-domain services get auto-allocated published ports
    if (!domain && ports.length > 0) {
      ports = await orchestrator.allocateIngressPorts(
        ports.map((p) => ({ target: p.target, protocol: p.protocol || 'tcp' })),
      );
    } else if (domain) {
      // Domain services don't need published ports — Traefik routes by Host header
      ports = ports.map((p) => ({ target: p.target, published: 0, protocol: p.protocol || 'tcp' }));
    }

    const primaryTargetPort = ports[0]?.target ?? 80;
    const traefikLabels = buildTraefikLabels(name, domain, sslEnabled, primaryTargetPort);
    const initialStatus = detection.buildMethod === 'none' ? 'stopped' : 'deploying';

    // Create service record
    const [svc] = await insertReturning(services, {
      id: tempServiceId,
      accountId,
      name,
      image: detection.buildMethod === 'none' ? 'pending' : 'building...',
      replicas: detection.buildMethod === 'none' ? 0 : replicas,
      env,
      ports,
      volumes,
      domain,
      sslEnabled,
      sourceType: 'upload',
      sourcePath,
      dockerfile: detection.generatedDockerfile ?? null,
      status: initialStatus,
    });

    if (!svc) {
      await uploadService.deleteServiceFiles(accountId, tempServiceId);
      return c.json({ error: 'Failed to create service record' }, 500);
    }

    // Try to create Docker Swarm service (non-fatal — service record is always kept)
    try {
      const networkName = `fleet-account-${accountId}`;
      const networkId = await orchestrator.ensureNetwork(networkName);

      // Domain services need the Traefik public network for routing
      const networkIds = [networkId];
      if (domain) {
        const publicNetId = await orchestrator.ensureNetwork('fleet_fleet_public');
        networkIds.push(publicNetId);
      }

      const accountShort = accountId.replace(/-/g, '').substring(0, 12);
      const swarmServiceName = `fleet-${accountShort}-${name}`.toLowerCase();
      const result = await orchestrator.createService({
        name: swarmServiceName,
        image: 'alpine:latest', // Placeholder until build completes
        replicas: 0, // Don't start until build is done
        env,
        ports: ports.map((p) => ({
          target: p.target,
          published: p.published ?? 0,
          protocol: p.protocol || 'tcp',
        })),
        volumes: volumes.map((v) => ({
          source: v.source,
          target: v.target,
          readonly: v.readonly ?? false,
        })),
        labels: {
          ...traefikLabels,
          'fleet.account-id': accountId,
          'fleet.service-id': svc.id,
        },
        constraints: [],
        updateParallelism: 1,
        updateDelay: '10s',
        rollbackOnFailure: true,
        networkIds,
      });

      await ensureIngressRoute(`fleet-account-${accountId}`, swarmServiceName, domain, sslEnabled, primaryTargetPort).catch(() => {});

      await db.update(services)
        .set({ dockerServiceId: result.id })
        .where(eq(services.id, svc.id));

      svc.dockerServiceId = result.id;
    } catch (err) {
      logger.warn({ err }, 'Docker not available — service created but not started');
      await db.update(services)
        .set({ status: 'stopped' })
        .where(eq(services.id, svc.id));
    }

    // Create deployment record
    const [deployment] = await insertReturning(deployments, {
      serviceId: svc.id,
      status: 'building',
    });

    // Queue build job
    const jobData: DeploymentJobData = {
      deploymentId: deployment!.id,
      serviceId: svc.id,
      accountId,
      commitSha: null,
      sourceType: 'upload',
      sourcePath,
      buildMethod: detection.buildMethod,
      buildFile: detection.buildFile ?? undefined,
    };

    // Upload builds MUST run inline (same process that received the file)
    // because fleet_uploads is a node-local volume — other replicas can't see the files.
    processDeploymentInline(jobData).catch((err) => {
      logger.error({ err }, 'Inline deployment failed');
    });

    return c.json({
      service: { ...svc, sourceType: 'upload', sourcePath },
      deploymentId: deployment!.id,
      detectedFiles: detection.detectedFiles,
      buildMethod: detection.buildMethod,
      buildFile: detection.buildFile,
      detectedRuntime: detection.detectedRuntime,
    }, 201);
  } finally {
    // Clean up temp file
    await rm(tmpPath, { force: true }).catch((err) => logger.warn({ err, tmpPath }, 'Failed to clean up temp file'));
  }
}) as any);

// POST /:serviceId/rebuild — replace source and rebuild
const rebuildRoute = createRoute({
  method: 'post',
  path: '/{serviceId}/rebuild',
  tags: ['Upload'],
  summary: 'Replace source and rebuild a service',
  security: bearerSecurity,
  request: {
    params: z.object({
      serviceId: z.string(),
    }),
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any().openapi({ type: 'string', format: 'binary' }),
            buildFile: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonContent(z.object({
      message: z.string(),
      deploymentId: z.string(),
    }), 'Rebuild triggered'),
    ...standardErrors,
  },
  middleware: [requireMember, requireScope('write')],
});

uploadRoutes.openapi(rebuildRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) return c.json({ error: 'Service not found' }, 404);
  if (svc.sourceType !== 'upload') return c.json({ error: 'Service is not an upload-deployed service' }, 400);

  const body = await c.req.parseBody();
  const file = body['file'] as File | undefined;
  const buildFile = (body['buildFile'] as string) || '';

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'Archive file is required' }, 400);
  }

  const archiveType = uploadService.detectArchiveType(file.name);
  if (!archiveType) {
    return c.json({ error: 'Unsupported file type' }, 400);
  }

  const tmpPath = join(tmpdir(), `fleet-rebuild-${randomUUID()}${archiveType === 'zip' ? '.zip' : archiveType === 'tar' ? '.tar' : '.tar.gz'}`);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tmpPath, buffer);

    // Replace source files
    const sourcePath = await uploadService.replaceSource({
      accountId,
      serviceId,
      archivePath: tmpPath,
      archiveType,
    });

    // Detect build files
    const detection = await uploadService.detectProjectFiles(sourcePath, buildFile || undefined);

    if (detection.buildMethod === 'none') {
      return c.json({ error: 'No Dockerfile or docker-compose file found. Add one via the Files tab first.' }, 400);
    }

    // Update service status
    await db.update(services)
      .set({ status: 'deploying', sourcePath, updatedAt: new Date() })
      .where(eq(services.id, serviceId));

    // Create deployment record
    const [deployment] = await insertReturning(deployments, {
      serviceId,
      status: 'building',
    });

    // Queue build job
    const jobData: DeploymentJobData = {
      deploymentId: deployment!.id,
      serviceId,
      accountId,
      commitSha: null,
      sourceType: 'upload',
      sourcePath,
      buildMethod: detection.buildMethod,
      buildFile: detection.buildFile ?? undefined,
    };

    // Upload rebuilds MUST run inline — files are on this node's local volume only.
    processDeploymentInline(jobData).catch((err) => {
      logger.error({ err }, 'Inline rebuild failed');
    });

    return c.json({
      message: 'Rebuild triggered',
      deploymentId: deployment!.id,
    });
  } finally {
    await rm(tmpPath, { force: true }).catch((err) => logger.warn({ err, tmpPath }, 'Failed to clean up temp file'));
  }
}) as any);

export default uploadRoutes;
