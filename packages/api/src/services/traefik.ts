/**
 * Build Traefik routing labels for a Docker Swarm service.
 *
 * When a domain is provided, returns labels that configure Traefik to route
 * HTTP(S) traffic for that domain to the service. When no domain is provided,
 * returns a label that disables Traefik for the service.
 */
// Domains that should never get Traefik routing (template defaults, loopback, etc.)
const INVALID_DOMAINS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function isRoutableDomain(domain: string): boolean {
  if (INVALID_DOMAINS.has(domain.toLowerCase())) return false;
  // Must have at least one dot (e.g. "example.com")
  if (!domain.includes('.')) return false;
  return true;
}

export function buildTraefikLabels(
  serviceName: string,
  domain: string | null,
  sslEnabled: boolean,
  targetPort: number = 80,
): Record<string, string> {
  if (!domain || !isRoutableDomain(domain)) return { 'traefik.enable': 'false' };

  const routerName = serviceName.replace(/[^a-zA-Z0-9]/g, '-');

  const labels: Record<string, string> = {
    'traefik.enable': 'true',
    [`traefik.http.routers.${routerName}.rule`]: `Host(\`${domain}\`)`,
    [`traefik.http.routers.${routerName}.entrypoints`]: 'websecure',
    [`traefik.http.services.${routerName}.loadbalancer.server.port`]: String(targetPort),
  };

  if (sslEnabled) {
    labels[`traefik.http.routers.${routerName}.tls`] = 'true';
    labels[`traefik.http.routers.${routerName}.tls.certresolver`] = 'letsencrypt';
  }

  return labels;
}

// ── Kubernetes IngressRoute management ──

import { getOrchestratorType } from './orchestrator.js';

/**
 * Ensure a Traefik IngressRoute exists for the given service+domain.
 * In Swarm mode this is a no-op (labels handle routing).
 * In K8s mode this creates/updates/deletes a Traefik IngressRoute CRD.
 */
export async function ensureIngressRoute(
  namespace: string,
  serviceName: string,
  domain: string | null,
  sslEnabled: boolean,
  targetPort: number = 80,
): Promise<void> {
  if (getOrchestratorType() !== 'kubernetes') return;

  // Lazy import to avoid loading K8s client in Swarm mode
  const k8s = await import('@kubernetes/client-node');
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

  const routeName = `${serviceName}-ingress`.replace(/[^a-z0-9-]/g, '-').slice(0, 63);

  if (!domain || !isRoutableDomain(domain)) {
    // Delete existing IngressRoute if any
    try {
      await customApi.deleteNamespacedCustomObject({
        group: 'traefik.io',
        version: 'v1alpha1',
        namespace,
        plural: 'ingressroutes',
        name: routeName,
      });
    } catch {
      // Already gone
    }
    return;
  }

  const ingressRoute = {
    apiVersion: 'traefik.io/v1alpha1',
    kind: 'IngressRoute',
    metadata: {
      name: routeName,
      namespace,
      labels: {
        'fleet.io/managed': 'true',
        'fleet.io/service': serviceName,
      },
    },
    spec: {
      entryPoints: ['websecure'],
      routes: [
        {
          match: `Host(\`${domain}\`)`,
          kind: 'Rule',
          services: [
            {
              name: serviceName,
              port: targetPort,
            },
          ],
        },
      ],
      ...(sslEnabled
        ? {
            tls: {
              certResolver: 'letsencrypt',
            },
          }
        : {}),
    },
  };

  try {
    // Try to update existing
    await customApi.getNamespacedCustomObject({
      group: 'traefik.io',
      version: 'v1alpha1',
      namespace,
      plural: 'ingressroutes',
      name: routeName,
    });
    await customApi.patchNamespacedCustomObject(
      {
        group: 'traefik.io',
        version: 'v1alpha1',
        namespace,
        plural: 'ingressroutes',
        name: routeName,
        body: ingressRoute,
      },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch),
    );
  } catch {
    // Create new
    await customApi.createNamespacedCustomObject({
      group: 'traefik.io',
      version: 'v1alpha1',
      namespace,
      plural: 'ingressroutes',
      body: ingressRoute,
    });
  }
}

/**
 * Delete all IngressRoutes for a service (used when removing a service).
 */
export async function removeIngressRoutes(
  namespace: string,
  serviceName: string,
): Promise<void> {
  if (getOrchestratorType() !== 'kubernetes') return;

  const k8s = await import('@kubernetes/client-node');
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

  const routeName = `${serviceName}-ingress`.replace(/[^a-z0-9-]/g, '-').slice(0, 63);
  try {
    await customApi.deleteNamespacedCustomObject({
      group: 'traefik.io',
      version: 'v1alpha1',
      namespace,
      plural: 'ingressroutes',
      name: routeName,
    });
  } catch {
    // Already gone
  }
}
