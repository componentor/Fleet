import { db, services, eq, updateReturning } from '@fleet/db';
import { getOrchestrator, getDefaultOrchestratorType } from './orchestrator.js';
import type { OrchestratorType } from './orchestrator.js';
import { buildTraefikLabels, ensureIngressRoute, removeIngressRoutes } from './traefik.js';
import { getRegistryAuthForImage } from './docker.service.js';
import { logger } from './logger.js';

export interface MigrationResult {
  success: boolean;
  serviceId: string;
  from: OrchestratorType;
  to: OrchestratorType;
  error?: string;
}

/**
 * Resolve the effective orchestrator type for a service.
 * Uses per-service override if set, otherwise falls back to platform default.
 */
export function resolveOrchestratorType(
  serviceOrchestrator: string | null | undefined,
): OrchestratorType {
  if (serviceOrchestrator === 'swarm' || serviceOrchestrator === 'kubernetes') {
    return serviceOrchestrator;
  }
  return getDefaultOrchestratorType();
}

/**
 * Migrate a service from one orchestrator to another.
 *
 * Steps:
 * 1. Create service on the target orchestrator
 * 2. Wait for it to become ready
 * 3. Update the DB (new dockerServiceId + orchestrator column)
 * 4. Remove from the source orchestrator
 * 5. Update ingress routing
 */
export async function migrateService(
  serviceId: string,
  targetType: OrchestratorType,
): Promise<MigrationResult> {
  const svc = await db.query.services.findFirst({
    where: eq(services.id, serviceId),
  });

  if (!svc) {
    return { success: false, serviceId, from: 'swarm', to: targetType, error: 'Service not found' };
  }

  const currentType = resolveOrchestratorType(svc.orchestrator);
  if (currentType === targetType) {
    return { success: true, serviceId, from: currentType, to: targetType };
  }

  const source = getOrchestrator(currentType);
  const target = getOrchestrator(targetType);

  const accountId = svc.accountId;
  const accountShort = accountId.replace(/-/g, '').substring(0, 12);
  const swarmServiceName = `fleet-${accountShort}-${svc.name}`.toLowerCase();

  try {
    // 1. Build service options
    const svcPorts = (svc.ports as any[]) ?? [];
    const primaryTargetPort = svcPorts[0]?.target ?? 80;
    const traefikLabels = buildTraefikLabels(svc.name, svc.domain ?? null, svc.sslEnabled ?? true, primaryTargetPort);

    const networkName = `fleet-account-${accountId}`;
    const networkId = await target.ensureNetwork(networkName);
    const networkIds = [networkId];
    if (svc.domain) {
      const publicNetId = await target.ensureNetwork('fleet_fleet_public');
      networkIds.push(publicNetId);
    }

    const ingressPorts = svc.domain
      ? []
      : await target.allocateIngressPorts(
          svcPorts.map((p: any) => ({ target: p.target, protocol: p.protocol ?? 'tcp' })),
        );

    const registryAuth = await getRegistryAuthForImage(accountId, svc.image);

    // 2. Create on target orchestrator
    const result = await target.createService({
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
      constraints: (svc.placementConstraints as string[]) ?? [],
      healthCheck: (svc.healthCheck as any) ?? undefined,
      updateParallelism: svc.updateParallelism ?? 1,
      updateDelay: svc.updateDelay ?? '10s',
      rollbackOnFailure: svc.rollbackOnFailure ?? true,
      cpuLimit: svc.cpuLimit ?? undefined,
      memoryLimit: svc.memoryLimit ?? undefined,
      networkIds,
      registryAuth,
    });

    // 3. Update DB with new orchestrator and service ID
    const oldDockerServiceId = svc.dockerServiceId;
    await updateReturning(
      services,
      {
        dockerServiceId: result.id,
        orchestrator: targetType,
        updatedAt: new Date(),
      },
      eq(services.id, serviceId),
    );

    // 4. Remove from source orchestrator
    if (oldDockerServiceId) {
      try {
        await source.removeService(oldDockerServiceId);
      } catch (err) {
        logger.warn({ err, serviceId }, 'Failed to remove service from source orchestrator during migration');
      }
    }

    // 5. Update ingress routing
    const namespace = networkName.replace(/_/g, '-').toLowerCase();
    if (targetType === 'kubernetes') {
      await ensureIngressRoute(namespace, swarmServiceName, svc.domain ?? null, svc.sslEnabled ?? true, primaryTargetPort);
    } else {
      // Moving to Swarm — clean up K8s IngressRoute
      await removeIngressRoutes(namespace, swarmServiceName);
    }

    logger.info({ serviceId, from: currentType, to: targetType }, 'Service migrated successfully');
    return { success: true, serviceId, from: currentType, to: targetType };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, serviceId, from: currentType, to: targetType }, 'Service migration failed');
    return { success: false, serviceId, from: currentType, to: targetType, error: message };
  }
}

/**
 * Migrate all services for an account to a target orchestrator.
 */
export async function migrateAccountServices(
  accountId: string,
  targetType: OrchestratorType,
): Promise<MigrationResult[]> {
  const accountServices = await db.query.services.findMany({
    where: eq(services.accountId, accountId),
  });

  const results: MigrationResult[] = [];
  for (const svc of accountServices) {
    if (svc.deletedAt || svc.status === 'deleted') continue;
    if (!svc.dockerServiceId) continue; // Not deployed
    const result = await migrateService(svc.id, targetType);
    results.push(result);
  }
  return results;
}
