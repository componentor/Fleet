import {
  db,
  services,
  serviceAnalytics,
  eq,
  and,
  isNull,
  inArray,
} from '@fleet/db';
import { orchestrator } from './orchestrator.js';
import { getValkey } from './valkey.service.js';
import { logger } from './logger.js';

const ANALYTICS_KEY_PREFIX = 'fleet:analytics:prev:';
const ANALYTICS_TTL = 600; // 10 minutes
const INSERT_CHUNK_SIZE = 1000;

/**
 * Parses Prometheus text exposition format, only extracting traefik_service_* metrics.
 * Skips non-service metrics to reduce memory and processing time.
 */
function parsePrometheusText(text: string): Map<string, number> {
  const result = new Map<string, number>();
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;

    // Skip comments/empty lines; only parse traefik_service_* metrics
    if (end > start && text.charCodeAt(start) !== 35 /* '#' */ && text.startsWith('traefik_service_', start)) {
      const line = text.substring(start, end);
      const match = line.match(/^(\w+)\{([^}]*)\}\s+(\d+(?:\.\d+)?(?:e[+-]?\d+)?)/);
      if (match) {
        result.set(`${match[1]!}{${match[2]!}}`, parseFloat(match[3]!));
      }
    }
    start = end + 1;
  }
  return result;
}

/**
 * Extract label value from a Prometheus label string.
 */
function extractLabel(labels: string, key: string): string | null {
  const re = new RegExp(`${key}="([^"]*)"`);
  const m = labels.match(re);
  return m ? m[1]! : null;
}

/**
 * Categorize HTTP status code into bucket.
 */
function statusBucket(code: string): string {
  if (code.startsWith('2')) return '2xx';
  if (code.startsWith('3')) return '3xx';
  if (code.startsWith('4')) return '4xx';
  if (code.startsWith('5')) return '5xx';
  return 'other';
}

class AnalyticsService {
  /**
   * Scrape Traefik Prometheus metrics from all instances,
   * compute deltas via Valkey, and batch-insert per-service analytics rows.
   */
  async collectAnalytics(): Promise<void> {
    try {
      // 1. Build mapping: Docker Swarm service name → Fleet service record (single batch query)
      const { serviceMap, traefikNameToDockerName } = await this.buildServiceNameMap();
      if (serviceMap.size === 0) {
        logger.debug('No services found for analytics collection');
        return;
      }

      // 2. Fetch metrics from all Traefik instances
      const metricsTexts = await this.fetchTraefikMetrics();
      if (metricsTexts.length === 0) {
        logger.warn('No Traefik metrics available — analytics collection skipped');
        return;
      }

      // 3. Parse and merge metrics from all instances
      const merged = new Map<string, number>();
      for (const text of metricsTexts) {
        const parsed = parsePrometheusText(text);
        for (const [key, value] of parsed) {
          merged.set(key, (merged.get(key) ?? 0) + value);
        }
      }

      // 4. Extract per-service counters from merged metrics
      const serviceCounters = new Map<string, {
        requests: Record<string, number>;
        bytesIn: number;
        bytesOut: number;
      }>();

      for (const [key, value] of merged) {
        const metricMatch = key.match(/^(\w+)\{(.+)\}$/);
        if (!metricMatch) continue;
        const metricName = metricMatch[1]!;
        const labels = metricMatch[2]!;

        const svcLabel = extractLabel(labels, 'service');
        if (!svcLabel) continue;

        const rawSvcName = svcLabel.replace(/@(swarm|docker)$/, '');
        // Traefik uses hyphenated names in metrics, map back to Docker service name
        const dockerSvcName = serviceMap.has(rawSvcName)
          ? rawSvcName
          : traefikNameToDockerName.get(rawSvcName);
        if (!dockerSvcName || !serviceMap.has(dockerSvcName)) continue;

        if (!serviceCounters.has(dockerSvcName)) {
          serviceCounters.set(dockerSvcName, { requests: {}, bytesIn: 0, bytesOut: 0 });
        }
        const counters = serviceCounters.get(dockerSvcName)!;

        if (metricName === 'traefik_service_requests_total') {
          const code = extractLabel(labels, 'code') ?? 'unknown';
          const bucket = statusBucket(code);
          counters.requests[bucket] = (counters.requests[bucket] ?? 0) + value;
        } else if (metricName === 'traefik_service_requests_bytes_total') {
          counters.bytesIn += value;
        } else if (metricName === 'traefik_service_responses_bytes_total') {
          counters.bytesOut += value;
        }
      }

      // 5. Batch-read previous values from Valkey (single mget round-trip)
      const valkey = await getValkey();
      if (!valkey) {
        logger.warn('[analytics] Valkey not available, skipping delta computation');
        return;
      }
      const now = new Date();

      const serviceEntries = [...serviceCounters.entries()]
        .filter(([name]) => serviceMap.has(name));

      if (serviceEntries.length === 0) return;

      // Single MGET for all previous values
      const prevKeys = serviceEntries.map(([name]) => `${ANALYTICS_KEY_PREFIX}${name}`);
      const prevValues = await valkey.mget(...prevKeys);

      // Compute deltas and collect batch inserts + pipeline Valkey writes
      const insertBatch: Array<typeof serviceAnalytics.$inferInsert> = [];
      const setPipeline = valkey.pipeline();

      for (let i = 0; i < serviceEntries.length; i++) {
        const [dockerSvcName, counters] = serviceEntries[i]!;
        const svcInfo = serviceMap.get(dockerSvcName)!;
        const totalRequests = Object.values(counters.requests).reduce((a, b) => a + b, 0);

        // Parse previous values
        const prevJson = prevValues[i];
        let prevRequests = 0, prevBytesIn = 0, prevBytesOut = 0;
        if (prevJson) {
          try {
            const prev = JSON.parse(prevJson);
            prevRequests = prev.requests ?? 0;
            prevBytesIn = prev.bytesIn ?? 0;
            prevBytesOut = prev.bytesOut ?? 0;
          } catch { /* ignore */ }
        }

        // Compute deltas (handle counter resets: current < previous → use current as delta)
        const deltaRequests = totalRequests >= prevRequests ? totalRequests - prevRequests : totalRequests;
        const deltaBytesIn = counters.bytesIn >= prevBytesIn ? counters.bytesIn - prevBytesIn : counters.bytesIn;
        const deltaBytesOut = counters.bytesOut >= prevBytesOut ? counters.bytesOut - prevBytesOut : counters.bytesOut;

        // Compute per-status deltas proportionally
        let d2xx = 0, d3xx = 0, d4xx = 0, d5xx = 0;
        if (totalRequests > 0 && deltaRequests > 0) {
          const r = counters.requests;
          d2xx = Math.round(((r['2xx'] ?? 0) / totalRequests) * deltaRequests);
          d3xx = Math.round(((r['3xx'] ?? 0) / totalRequests) * deltaRequests);
          d4xx = Math.round(((r['4xx'] ?? 0) / totalRequests) * deltaRequests);
          d5xx = Math.round(((r['5xx'] ?? 0) / totalRequests) * deltaRequests);
        }

        // Queue Valkey SET in pipeline (single round-trip at the end)
        setPipeline.set(
          `${ANALYTICS_KEY_PREFIX}${dockerSvcName}`,
          JSON.stringify({ requests: totalRequests, bytesIn: counters.bytesIn, bytesOut: counters.bytesOut }),
          'EX', ANALYTICS_TTL,
        );

        // Only insert if there's actual data (skip first scrape — no previous values)
        if (prevJson && (deltaRequests > 0 || deltaBytesIn > 0 || deltaBytesOut > 0)) {
          insertBatch.push({
            serviceId: svcInfo.serviceId,
            accountId: svcInfo.accountId,
            requests: deltaRequests,
            requests2xx: d2xx,
            requests3xx: d3xx,
            requests4xx: d4xx,
            requests5xx: d5xx,
            bytesIn: deltaBytesIn,
            bytesOut: deltaBytesOut,
            period: '5m',
            recordedAt: now,
          });
        }
      }

      // Execute all Valkey SETs in one round-trip via pipeline
      try {
        await setPipeline.exec();
      } catch (pipelineErr) {
        // MISCONF or other transient Valkey errors should not block DB inserts
        logger.warn({ err: pipelineErr }, 'Valkey pipeline failed (analytics tracking may be inaccurate next cycle)');
      }

      // 6. Batch insert into DB in chunks of 1000
      for (let i = 0; i < insertBatch.length; i += INSERT_CHUNK_SIZE) {
        const chunk = insertBatch.slice(i, i + INSERT_CHUNK_SIZE);
        await db.insert(serviceAnalytics).values(chunk);
      }

      logger.debug({ serviceCount: serviceCounters.size, inserted: insertBatch.length }, 'Analytics collection complete');
    } catch (err) {
      logger.error({ err }, 'Analytics collection failed');
    }
  }

  /**
   * Fetch Prometheus metrics from all Traefik task instances.
   */
  private async fetchTraefikMetrics(): Promise<string[]> {
    const results: string[] = [];

    try {
      const tasks = await orchestrator.listTasks({
        service: ['fleet_traefik'],
        'desired-state': ['running'],
      });

      for (const task of tasks) {
        const ip = task.NetworksAttachments?.find((n: any) =>
          n.Network?.Spec?.Name?.includes('internal')
        )?.Addresses?.[0]?.split('/')[0];

        if (!ip) continue;

        try {
          const resp = await fetch(`http://${ip}:9100/metrics`, {
            signal: AbortSignal.timeout(5000),
          });
          if (resp.ok) {
            results.push(await resp.text());
          }
        } catch {
          logger.debug({ ip }, 'Failed to fetch metrics from Traefik instance');
        }
      }
    } catch {
      // Fallback: try the service DNS name
      try {
        const resp = await fetch('http://fleet_traefik:9100/metrics', {
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          results.push(await resp.text());
        }
      } catch {
        logger.debug('Fallback Traefik metrics fetch also failed');
      }
    }

    return results;
  }

  /**
   * Build mapping from Docker Swarm service names to Fleet service IDs.
   * Uses a single batch DB query instead of N+1 per-service queries.
   */
  private async buildServiceNameMap(): Promise<{
    serviceMap: Map<string, { serviceId: string; accountId: string }>;
    traefikNameToDockerName: Map<string, string>;
  }> {
    const serviceMap = new Map<string, { serviceId: string; accountId: string }>();
    const traefikNameToDockerName = new Map<string, string>();

    try {
      const swarmServices = await orchestrator.listServices();

      // Collect all fleet service IDs and their Docker names in one pass
      // Traefik uses the router/service name from labels, which replaces
      // non-alphanumeric chars with hyphens (see buildTraefikLabels).
      // We need to map BOTH the Docker name AND the Traefik name.
      const serviceIdToDockerName = new Map<string, string>();
      for (const svc of swarmServices) {
        const labels = svc.Spec?.Labels || {};
        const serviceId = labels['fleet.service-id'];
        const dockerName = svc.Spec?.Name;
        if (serviceId && dockerName) {
          serviceIdToDockerName.set(serviceId, dockerName);
          // Traefik router name: non-alphanumeric → hyphen
          const traefikName = dockerName.replace(/[^a-zA-Z0-9]/g, '-');
          if (traefikName !== dockerName) {
            traefikNameToDockerName.set(traefikName, dockerName);
          }
        }
      }

      if (serviceIdToDockerName.size === 0) return { serviceMap, traefikNameToDockerName };

      // Single batch query for all service IDs
      const serviceIds = [...serviceIdToDockerName.keys()];
      const dbServices = await db.select({
        id: services.id,
        accountId: services.accountId,
      })
        .from(services)
        .where(and(
          inArray(services.id, serviceIds),
          isNull(services.deletedAt),
        ));

      for (const dbSvc of dbServices) {
        const dockerName = serviceIdToDockerName.get(dbSvc.id);
        if (dockerName) {
          serviceMap.set(dockerName, { serviceId: dbSvc.id, accountId: dbSvc.accountId });
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to build service name map for analytics');
    }

    return { serviceMap, traefikNameToDockerName };
  }
}

export const analyticsService = new AnalyticsService();
