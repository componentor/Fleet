import {
  db,
  services,
  serviceAnalytics,
  eq,
  and,
  sql,
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
        logger.info('[analytics] No services with fleet.service-id label found — nothing to track');
        return;
      }
      logger.info({ serviceCount: serviceMap.size, names: [...serviceMap.keys()] }, '[analytics] Service map built');

      // 2. Fetch metrics from all Traefik instances
      const metricsTexts = await this.fetchTraefikMetrics();
      if (metricsTexts.length === 0) {
        logger.warn('[analytics] No Traefik metrics fetched — collection skipped');
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

      logger.info({ mergedMetricCount: merged.size }, '[analytics] Parsed Traefik metrics');

      // Collect all unique service labels from metrics for debugging
      const allMetricServiceNames = new Set<string>();
      for (const key of merged.keys()) {
        const m = key.match(/\{.*?service="([^"]*)".*?\}/);
        if (m) allMetricServiceNames.add(m[1]!);
      }
      if (allMetricServiceNames.size > 0) {
        logger.info({ metricServiceNames: [...allMetricServiceNames] }, '[analytics] Service names found in Traefik metrics');
      }

      // 4. Extract per-service counters from merged metrics
      const serviceCounters = new Map<string, {
        requests: Record<string, number>;
        bytesIn: number;
        bytesOut: number;
        durationSum: number;
        durationCount: number;
        histogramBuckets: Map<number, number>; // le threshold → cumulative count
      }>();

      let unmatchedServices = 0;
      const unmatchedNames = new Set<string>();

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
        if (!dockerSvcName || !serviceMap.has(dockerSvcName)) {
          // Track unmatched for diagnostics
          if (metricName === 'traefik_service_requests_total') {
            unmatchedServices++;
            unmatchedNames.add(rawSvcName);
          }
          continue;
        }

        if (!serviceCounters.has(dockerSvcName)) {
          serviceCounters.set(dockerSvcName, {
            requests: {}, bytesIn: 0, bytesOut: 0,
            durationSum: 0, durationCount: 0,
            histogramBuckets: new Map(),
          });
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
        } else if (metricName === 'traefik_service_request_duration_seconds_sum') {
          counters.durationSum += value;
        } else if (metricName === 'traefik_service_request_duration_seconds_count') {
          counters.durationCount += value;
        } else if (metricName === 'traefik_service_request_duration_seconds_bucket') {
          const le = extractLabel(labels, 'le');
          if (le && le !== '+Inf') {
            const threshold = parseFloat(le);
            counters.histogramBuckets.set(threshold, (counters.histogramBuckets.get(threshold) ?? 0) + value);
          }
        }
      }

      if (unmatchedNames.size > 0) {
        logger.info({ unmatchedCount: unmatchedServices, names: [...unmatchedNames].slice(0, 20) },
          '[analytics] Unmatched service names in metrics (not Fleet user services)');
      }

      logger.info({ matchedServices: serviceCounters.size }, '[analytics] Matched services with metrics');

      // 4b. Collect block I/O stats from Docker containers (parallel, best-effort)
      const serviceIoStats = await this.collectBlockIoStats(serviceMap);

      // 5. Batch-read previous values from Valkey (single mget round-trip)
      const valkey = await getValkey();
      if (!valkey) {
        logger.warn('[analytics] Valkey not available, skipping delta computation');
        return;
      }
      const now = new Date();

      const serviceEntries = [...serviceCounters.entries()]
        .filter(([name]) => serviceMap.has(name));

      if (serviceEntries.length === 0) {
        logger.info('[analytics] No matched service entries — nothing to insert');
        return;
      }

      // Single MGET for all previous values
      const prevKeys = serviceEntries.map(([name]) => `${ANALYTICS_KEY_PREFIX}${name}`);
      const prevValues = await valkey.mget(...prevKeys);

      // Compute deltas and collect batch inserts + pipeline Valkey writes
      const insertBatch: Array<typeof serviceAnalytics.$inferInsert> = [];
      const setPipeline = valkey.pipeline();
      let firstScrapeCount = 0;
      let zeroDeltaCount = 0;

      for (let i = 0; i < serviceEntries.length; i++) {
        const [dockerSvcName, counters] = serviceEntries[i]!;
        const svcInfo = serviceMap.get(dockerSvcName)!;
        const totalRequests = Object.values(counters.requests).reduce((a, b) => a + b, 0);

        // Parse previous values
        const prevJson = prevValues[i];
        let prevRequests = 0, prevBytesIn = 0, prevBytesOut = 0;
        let prevDurationSum = 0, prevDurationCount = 0;
        let prevHistogram: Record<string, number> = {};
        let prevIoRead = 0, prevIoWrite = 0;
        if (prevJson) {
          try {
            const prev = JSON.parse(prevJson);
            prevRequests = prev.requests ?? 0;
            prevBytesIn = prev.bytesIn ?? 0;
            prevBytesOut = prev.bytesOut ?? 0;
            prevDurationSum = prev.durationSum ?? 0;
            prevDurationCount = prev.durationCount ?? 0;
            prevHistogram = prev.histogram ?? {};
            prevIoRead = prev.ioRead ?? 0;
            prevIoWrite = prev.ioWrite ?? 0;
          } catch { /* ignore */ }
        }

        // Compute deltas (handle counter resets: current < previous → use current as delta)
        const deltaRequests = totalRequests >= prevRequests ? totalRequests - prevRequests : totalRequests;
        const deltaBytesIn = counters.bytesIn >= prevBytesIn ? counters.bytesIn - prevBytesIn : counters.bytesIn;
        const deltaBytesOut = counters.bytesOut >= prevBytesOut ? counters.bytesOut - prevBytesOut : counters.bytesOut;

        // Compute response time deltas
        const deltaDurationSum = counters.durationSum >= prevDurationSum
          ? counters.durationSum - prevDurationSum : counters.durationSum;
        const deltaDurationCount = counters.durationCount >= prevDurationCount
          ? counters.durationCount - prevDurationCount : counters.durationCount;

        // Average response time in ms for this interval
        const avgResponseTimeMs = deltaDurationCount > 0
          ? Math.round((deltaDurationSum / deltaDurationCount) * 1000)
          : 0;

        // P95 from histogram bucket deltas
        const p95ResponseTimeMs = this.computePercentileFromHistogram(
          counters.histogramBuckets, prevHistogram, deltaDurationCount, 0.95,
        );

        // Compute block I/O deltas
        const ioInfo = serviceIoStats.get(dockerSvcName);
        const currentIoRead = ioInfo?.readBytes ?? 0;
        const currentIoWrite = ioInfo?.writeBytes ?? 0;
        const deltaIoRead = currentIoRead >= prevIoRead ? currentIoRead - prevIoRead : currentIoRead;
        const deltaIoWrite = currentIoWrite >= prevIoWrite ? currentIoWrite - prevIoWrite : currentIoWrite;

        // Compute per-status deltas proportionally
        let d2xx = 0, d3xx = 0, d4xx = 0, d5xx = 0;
        if (totalRequests > 0 && deltaRequests > 0) {
          const r = counters.requests;
          d2xx = Math.round(((r['2xx'] ?? 0) / totalRequests) * deltaRequests);
          d3xx = Math.round(((r['3xx'] ?? 0) / totalRequests) * deltaRequests);
          d4xx = Math.round(((r['4xx'] ?? 0) / totalRequests) * deltaRequests);
          d5xx = Math.round(((r['5xx'] ?? 0) / totalRequests) * deltaRequests);
        }

        // Serialize histogram for next delta computation
        const histogramObj: Record<string, number> = {};
        for (const [le, count] of counters.histogramBuckets) {
          histogramObj[String(le)] = count;
        }

        // Queue Valkey SET in pipeline (single round-trip at the end)
        setPipeline.set(
          `${ANALYTICS_KEY_PREFIX}${dockerSvcName}`,
          JSON.stringify({
            requests: totalRequests, bytesIn: counters.bytesIn, bytesOut: counters.bytesOut,
            durationSum: counters.durationSum, durationCount: counters.durationCount,
            histogram: histogramObj,
            ioRead: currentIoRead, ioWrite: currentIoWrite,
          }),
          'EX', ANALYTICS_TTL,
        );

        // Only insert if there's actual data (skip first scrape — no previous values)
        if (!prevJson) {
          firstScrapeCount++;
        } else if (deltaRequests === 0 && deltaBytesIn === 0 && deltaBytesOut === 0 && deltaIoRead === 0 && deltaIoWrite === 0) {
          zeroDeltaCount++;
        } else {
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
            avgResponseTimeMs,
            p95ResponseTimeMs,
            ioReadBytes: deltaIoRead,
            ioWriteBytes: deltaIoWrite,
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
        logger.warn({ err: pipelineErr }, '[analytics] Valkey pipeline failed (tracking may be inaccurate next cycle)');
      }

      // 6. Batch insert into DB in chunks of 1000
      for (let i = 0; i < insertBatch.length; i += INSERT_CHUNK_SIZE) {
        const chunk = insertBatch.slice(i, i + INSERT_CHUNK_SIZE);
        await db.insert(serviceAnalytics).values(chunk);
      }

      logger.info({
        matchedServices: serviceCounters.size,
        firstScrape: firstScrapeCount,
        zeroDelta: zeroDeltaCount,
        inserted: insertBatch.length,
      }, '[analytics] Collection complete');
    } catch (err) {
      logger.error({ err }, '[analytics] Collection failed');
    }
  }

  /**
   * Run a full diagnostic check of the analytics pipeline.
   * Returns detailed info about each step for troubleshooting.
   */
  async runDiagnostics(): Promise<Record<string, any>> {
    const diag: Record<string, any> = {
      timestamp: new Date().toISOString(),
      steps: {} as Record<string, any>,
    };

    // Step 1: Service name map
    try {
      const { serviceMap, traefikNameToDockerName } = await this.buildServiceNameMap();
      diag.steps.serviceMap = {
        ok: serviceMap.size > 0,
        count: serviceMap.size,
        dockerNames: [...serviceMap.keys()],
        traefikAliases: Object.fromEntries(traefikNameToDockerName),
      };
    } catch (err) {
      diag.steps.serviceMap = { ok: false, error: String(err) };
    }

    // Step 2: Traefik task discovery
    try {
      const tasks = await orchestrator.listTasks({
        service: ['fleet_traefik'],
        'desired-state': ['running'],
      });
      const taskInfo = tasks.map((t: any) => {
        const networks = t.NetworksAttachments ?? [];
        return {
          id: t.ID?.substring(0, 12),
          state: t.Status?.State,
          networkCount: networks.length,
          networks: networks.map((n: any) => ({
            name: n.Network?.Spec?.Name ?? 'unknown',
            addresses: n.Addresses ?? [],
          })),
        };
      });
      diag.steps.traefikTasks = {
        ok: tasks.length > 0,
        count: tasks.length,
        tasks: taskInfo,
      };
    } catch (err) {
      diag.steps.traefikTasks = { ok: false, error: String(err) };
    }

    // Step 3: Metrics fetch via task IPs (primary method)
    try {
      const texts = await this.fetchTraefikMetrics();
      let uniqueServices = new Set<string>();
      let sampleLines: string[] = [];
      if (texts.length > 0) {
        const allText = texts.join('\n');
        const serviceMetricLines = allText.split('\n').filter(l => l.startsWith('traefik_service_requests_total'));
        for (const line of serviceMetricLines) {
          const m = line.match(/service="([^"]*)"/);
          if (m) uniqueServices.add(m[1]!);
        }
        sampleLines = serviceMetricLines.slice(0, 5);
      }
      diag.steps.metricsFetch = {
        ok: texts.length > 0,
        instanceCount: texts.length,
        totalBytes: texts.reduce((a, t) => a + t.length, 0),
        uniqueServiceNames: [...uniqueServices],
        sampleLines,
      };
    } catch (err) {
      diag.steps.metricsFetch = { ok: false, error: String(err) };
    }

    // Step 5: Valkey state
    try {
      const valkey = await getValkey();
      if (!valkey) {
        diag.steps.valkey = { ok: false, error: 'Valkey not available' };
      } else {
        // Check for any analytics keys
        const keys = await valkey.keys(`${ANALYTICS_KEY_PREFIX}*`);
        const samples: Record<string, any> = {};
        if (keys.length > 0) {
          const vals = await valkey.mget(...keys.slice(0, 5));
          for (let i = 0; i < Math.min(keys.length, 5); i++) {
            try { samples[keys[i]!] = JSON.parse(vals[i]!); } catch { samples[keys[i]!] = vals[i]; }
          }
        }
        diag.steps.valkey = {
          ok: true,
          analyticsKeyCount: keys.length,
          sampleKeys: keys.slice(0, 10),
          sampleValues: samples,
        };
      }
    } catch (err) {
      diag.steps.valkey = { ok: false, error: String(err) };
    }

    // Step 6: DB row count
    try {
      const [row] = await db.select({
        count: sql`count(*)`.as('count'),
      }).from(serviceAnalytics);
      diag.steps.database = {
        ok: true,
        totalRows: Number((row as any)?.count ?? 0),
      };
    } catch (err) {
      diag.steps.database = { ok: false, error: String(err) };
    }

    // Overall verdict
    const allOk = Object.values(diag.steps).every((s: any) => s.ok);
    diag.healthy = allOk;
    if (!allOk) {
      const failedSteps = Object.entries(diag.steps)
        .filter(([, s]: [string, any]) => !s.ok)
        .map(([k]) => k);
      diag.failedSteps = failedSteps;
    }

    return diag;
  }

  /**
   * Compute a percentile (e.g. 0.95 for p95) from Prometheus histogram bucket deltas.
   * Uses linear interpolation within the bucket that contains the target count.
   */
  private computePercentileFromHistogram(
    currentBuckets: Map<number, number>,
    prevHistogram: Record<string, number>,
    totalCount: number,
    percentile: number,
  ): number {
    if (totalCount <= 0 || currentBuckets.size === 0) return 0;

    // Compute delta buckets (current - previous) sorted by threshold
    const sortedThresholds = [...currentBuckets.keys()].sort((a, b) => a - b);
    const deltaBuckets: Array<{ le: number; count: number }> = [];

    for (const le of sortedThresholds) {
      const curr = currentBuckets.get(le) ?? 0;
      const prev = Number(prevHistogram[String(le)] ?? 0);
      const delta = curr >= prev ? curr - prev : curr;
      deltaBuckets.push({ le, count: delta });
    }

    // Target count for the percentile
    const target = totalCount * percentile;

    // Walk through cumulative counts to find the bucket containing the percentile
    let cumulative = 0;
    for (let i = 0; i < deltaBuckets.length; i++) {
      cumulative += deltaBuckets[i]!.count;
      if (cumulative >= target) {
        // Linear interpolation within this bucket
        const prevCumulative = cumulative - deltaBuckets[i]!.count;
        const bucketLower = i > 0 ? deltaBuckets[i - 1]!.le : 0;
        const bucketUpper = deltaBuckets[i]!.le;
        const bucketCount = deltaBuckets[i]!.count;

        if (bucketCount === 0) return Math.round(bucketUpper * 1000);

        const fraction = (target - prevCumulative) / bucketCount;
        const estimatedSeconds = bucketLower + (bucketUpper - bucketLower) * fraction;
        return Math.round(estimatedSeconds * 1000); // Convert to ms
      }
    }

    // If we didn't find it, use the highest bucket
    const lastBucket = deltaBuckets[deltaBuckets.length - 1];
    return lastBucket ? Math.round(lastBucket.le * 1000) : 0;
  }

  /**
   * Fetch Prometheus metrics from all Traefik task instances.
   * Tries DNS-based fetch first (most reliable), then per-task IPs for full coverage.
   */
  private async fetchTraefikMetrics(): Promise<string[]> {
    const results: string[] = [];

    // Fetch from all Traefik task instances directly via task IPs.
    // Traefik runs in global mode (one per manager node), each with independent counters.
    // We need all instances for accurate totals.
    try {
      const tasks = await orchestrator.listTasks({
        service: ['fleet_traefik'],
        'desired-state': ['running'],
      });

      for (const task of tasks) {
        const networks: any[] = (task as any).NetworksAttachments ?? [];
        // Try fleet_internal first, then fall back to any overlay network with an IP
        const preferredNet = networks.find((n: any) =>
          n.Network?.Spec?.Name?.includes('internal')
        );
        const anyNet = networks.find((n: any) =>
          n.Addresses?.length > 0
        );
        const net = preferredNet ?? anyNet;
        const ip = net?.Addresses?.[0]?.split('/')[0];

        if (!ip) {
          logger.debug({
            taskId: (task as any).ID?.substring(0, 12),
            networkCount: networks.length,
            networkNames: networks.map((n: any) => n.Network?.Spec?.Name),
          }, '[analytics] Task has no usable network IP');
          continue;
        }

        try {
          const resp = await fetch(`http://${ip}:9100/metrics`, {
            signal: AbortSignal.timeout(5000),
          });
          if (resp.ok) {
            results.push(await resp.text());
            logger.debug({ ip }, '[analytics] Fetched metrics from Traefik task');
          } else {
            logger.debug({ ip, status: resp.status }, '[analytics] Task metrics returned non-OK');
          }
        } catch (fetchErr) {
          logger.debug({ ip, err: String(fetchErr) }, '[analytics] Failed to fetch metrics from Traefik task');
        }
      }
    } catch (err) {
      logger.warn({ err: String(err) }, '[analytics] Task enumeration failed');
    }

    // Fallback: try DNS-based fetch if no task IPs worked
    if (results.length === 0) {
      try {
        const resp = await fetch('http://fleet_traefik:9100/metrics', {
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          results.push(await resp.text());
          logger.debug('[analytics] Fetched metrics via DNS fallback (fleet_traefik:9100)');
        }
      } catch (err) {
        logger.debug({ err: String(err) }, '[analytics] DNS fallback also failed');
      }
    }

    if (results.length === 0) {
      logger.warn('[analytics] All Traefik metrics fetch attempts failed');
    } else {
      logger.debug({ instanceCount: results.length }, '[analytics] Traefik metrics fetched');
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

      if (serviceIdToDockerName.size === 0) {
        logger.info({ totalSwarmServices: swarmServices.length }, '[analytics] No Swarm services with fleet.service-id label');
        return { serviceMap, traefikNameToDockerName };
      }

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
      logger.error({ err }, '[analytics] Failed to build service name map');
    }

    return { serviceMap, traefikNameToDockerName };
  }

  /**
   * Collect block I/O stats from Docker containers for all tracked services.
   * Aggregates across all running tasks/containers per service.
   * Returns a map: Docker service name → { readBytes, writeBytes } (cumulative counters).
   */
  private async collectBlockIoStats(
    serviceMap: Map<string, { serviceId: string; accountId: string }>,
  ): Promise<Map<string, { readBytes: number; writeBytes: number }>> {
    const result = new Map<string, { readBytes: number; writeBytes: number }>();
    try {
      // List running tasks for all tracked services
      const tasks = await orchestrator.listTasks({
        'desired-state': ['running'],
      });

      // Group running tasks by Docker service name
      const tasksByService = new Map<string, { containerId: string; nodeId: string }[]>();
      for (const task of tasks as any[]) {
        const state = task.Status?.State;
        if (state !== 'running') continue;
        const containerId = task.Status?.ContainerStatus?.ContainerID;
        if (!containerId) continue;

        // Find the Docker service name from the task's ServiceID
        const svcId = task.ServiceID;
        if (!svcId) continue;

        // We need to find the Docker service name that maps to this ServiceID
        // The task's Spec.ContainerSpec.Labels should have fleet.service-id
        const fleetServiceId = task.Spec?.ContainerSpec?.Labels?.['fleet.service-id'];
        if (!fleetServiceId) continue;

        // Find the Docker service name from our serviceMap
        let dockerName: string | null = null;
        for (const [name, info] of serviceMap) {
          if (info.serviceId === fleetServiceId) {
            dockerName = name;
            break;
          }
        }
        if (!dockerName) continue;

        const group = tasksByService.get(dockerName) ?? [];
        group.push({ containerId, nodeId: task.NodeID ?? '' });
        tasksByService.set(dockerName, group);
      }

      // Fetch container stats in parallel (with 10s timeout per call, max 20 concurrent)
      const IO_STATS_TIMEOUT = 10_000;
      const entries = [...tasksByService.entries()];

      // Process in batches of 20 to avoid overwhelming the Docker API
      for (let i = 0; i < entries.length; i += 20) {
        const batch = entries.slice(i, i + 20);
        const batchResults = await Promise.all(
          batch.map(async ([dockerName, containers]) => {
            let totalRead = 0;
            let totalWrite = 0;
            for (const { containerId, nodeId } of containers) {
              try {
                const orch = orchestrator as any;
                const stats = await Promise.race([
                  typeof orch.nodeAwareGetContainerStats === 'function'
                    ? orch.nodeAwareGetContainerStats(containerId, nodeId)
                    : orchestrator.getContainerStats(containerId),
                  new Promise<null>((resolve) => setTimeout(() => resolve(null), IO_STATS_TIMEOUT)),
                ]);
                if (stats) {
                  totalRead += stats.blockReadBytes;
                  totalWrite += stats.blockWriteBytes;
                }
              } catch {
                // Individual container stat failure is non-fatal
              }
            }
            return { dockerName, totalRead, totalWrite };
          }),
        );

        for (const { dockerName, totalRead, totalWrite } of batchResults) {
          result.set(dockerName, { readBytes: totalRead, writeBytes: totalWrite });
        }
      }

      logger.info({ servicesWithIo: result.size }, '[analytics] Block I/O stats collected');
    } catch (err) {
      logger.warn({ err }, '[analytics] Block I/O collection failed (non-fatal)');
    }
    return result;
  }
}

export const analyticsService = new AnalyticsService();
