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
