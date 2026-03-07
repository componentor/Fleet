import { createReadStream, statSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  db,
  services,
  visitorAnalytics,
  eq,
  and,
  isNull,
  inArray,
} from '@fleet/db';
import { orchestrator } from './orchestrator.js';
import { getValkey } from './valkey.service.js';
import { logger } from './logger.js';
import geoip from 'geoip-lite';

const ACCESS_LOG_PATH = '/var/log/traefik/access.log';
const OFFSET_KEY = 'fleet:visitor-analytics:log-offset';
const INSERT_CHUNK_SIZE = 500;

/**
 * Categorize a User-Agent string into a browser name.
 */
function detectBrowser(ua: string): string {
  const lc = ua.toLowerCase();
  if (lc.includes('edg/') || lc.includes('edge/')) return 'Edge';
  if (lc.includes('opr/') || lc.includes('opera')) return 'Opera';
  if (lc.includes('chrome') && !lc.includes('chromium')) return 'Chrome';
  if (lc.includes('firefox')) return 'Firefox';
  if (lc.includes('safari') && !lc.includes('chrome')) return 'Safari';
  if (lc.includes('bot') || lc.includes('crawl') || lc.includes('spider')) return 'Bot';
  if (lc.includes('curl') || lc.includes('wget') || lc.includes('httpie')) return 'CLI';
  return 'Other';
}

/**
 * Categorize a User-Agent string into a device type.
 */
function detectDevice(ua: string): string {
  const lc = ua.toLowerCase();
  if (lc.includes('bot') || lc.includes('crawl') || lc.includes('spider')) return 'bot';
  if (lc.includes('mobile') || lc.includes('android') || lc.includes('iphone')) return 'mobile';
  if (lc.includes('tablet') || lc.includes('ipad')) return 'tablet';
  return 'desktop';
}

/**
 * Parse a Traefik service name from the access log entry to a Docker service name.
 * Traefik uses format like "service-name@swarm" or "service-name@docker".
 */
function parseServiceName(raw: string | undefined): string | null {
  if (!raw) return null;
  return raw.replace(/@(swarm|docker|file)$/, '');
}

interface ServiceCounters {
  uniqueIps: Set<string>;
  pageViews: number;
  pathCounts: Map<string, number>;
  referrerCounts: Map<string, number>;
  browserCounts: Record<string, number>;
  deviceCounts: Record<string, number>;
  countryCounts: Record<string, number>;
}

class VisitorAnalyticsService {
  /**
   * Parse Traefik access log since last read offset, aggregate visitor metrics,
   * and insert into the visitor_analytics table.
   */
  async collectVisitorAnalytics(): Promise<void> {
    try {
      if (!existsSync(ACCESS_LOG_PATH)) {
        logger.debug('[visitor-analytics] Access log not found at %s — skipping', ACCESS_LOG_PATH);
        return;
      }

      const fileStat = statSync(ACCESS_LOG_PATH);
      const fileSize = fileStat.size;
      if (fileSize === 0) return;

      // Get last read offset from Valkey
      const valkey = await getValkey();
      let offset = 0;
      if (valkey) {
        const stored = await valkey.get(OFFSET_KEY);
        if (stored) offset = parseInt(stored, 10) || 0;
        // If file was truncated/rotated, reset offset
        if (offset > fileSize) offset = 0;
      }

      if (offset >= fileSize) return; // Nothing new

      // Build service name mapping (same approach as analytics.service.ts)
      const { serviceMap, traefikNameToDockerName } = await this.buildServiceNameMap();
      if (serviceMap.size === 0) {
        logger.debug('[visitor-analytics] No services found for visitor analytics');
        return;
      }

      // Read and parse the log from the offset
      const counters = new Map<string, ServiceCounters>();
      let newOffset = offset;

      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(ACCESS_LOG_PATH, { start: offset, encoding: 'utf-8' });
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        let bytesRead = offset;

        rl.on('line', (line) => {
          bytesRead += Buffer.byteLength(line, 'utf-8') + 1; // +1 for newline
          if (!line.startsWith('{')) return;

          try {
            const entry = JSON.parse(line);
            const rawSvcName = parseServiceName(entry.ServiceName);
            if (!rawSvcName) return;

            // Map Traefik name → Docker name
            const dockerSvcName = serviceMap.has(rawSvcName)
              ? rawSvcName
              : traefikNameToDockerName.get(rawSvcName);
            if (!dockerSvcName || !serviceMap.has(dockerSvcName)) return;

            // Skip non-HTTP or internal requests
            const statusCode = entry.OriginStatus || entry.DownstreamStatus || 0;
            if (statusCode === 0) return;

            const clientIp = entry.ClientHost?.split(':')[0] ?? '';
            const path = entry.RequestPath ?? '/';
            const ua = entry.request_User_Agent ?? entry['request_User-Agent'] ?? '';
            const referer = entry.request_Referer ?? '';

            if (!counters.has(dockerSvcName)) {
              counters.set(dockerSvcName, {
                uniqueIps: new Set(),
                pageViews: 0,
                pathCounts: new Map(),
                referrerCounts: new Map(),
                browserCounts: {},
                deviceCounts: {},
                countryCounts: {},
              });
            }
            const c = counters.get(dockerSvcName)!;

            if (clientIp) c.uniqueIps.add(clientIp);
            c.pageViews++;

            // Track paths (normalize by stripping query string)
            const cleanPath = path.split('?')[0] ?? '/';
            c.pathCounts.set(cleanPath, (c.pathCounts.get(cleanPath) ?? 0) + 1);

            // Track referrers (only external)
            if (referer && !referer.includes(dockerSvcName)) {
              try {
                const refHost = new URL(referer).hostname;
                if (refHost) c.referrerCounts.set(refHost, (c.referrerCounts.get(refHost) ?? 0) + 1);
              } catch { /* invalid URL */ }
            }

            // Track browsers and devices
            if (ua) {
              const browser = detectBrowser(ua);
              c.browserCounts[browser] = (c.browserCounts[browser] ?? 0) + 1;
              const device = detectDevice(ua);
              c.deviceCounts[device] = (c.deviceCounts[device] ?? 0) + 1;
            }

            // GeoIP country detection
            if (clientIp) {
              const geo = geoip.lookup(clientIp);
              const country = geo?.country ?? 'Unknown';
              c.countryCounts[country] = (c.countryCounts[country] ?? 0) + 1;
            }
          } catch { /* skip malformed lines */ }
        });

        rl.on('close', () => {
          newOffset = bytesRead;
          resolve();
        });
        rl.on('error', reject);
        stream.on('error', reject);
      });

      // Save new offset
      if (valkey) {
        await valkey.set(OFFSET_KEY, String(newOffset), 'EX', 86400).catch(() => {});
      }

      // Build insert batch
      const now = new Date();
      const insertBatch: Array<typeof visitorAnalytics.$inferInsert> = [];

      for (const [dockerSvcName, c] of counters) {
        if (c.pageViews === 0) continue;
        const svcInfo = serviceMap.get(dockerSvcName);
        if (!svcInfo) continue;

        // Top 20 paths
        const topPaths = [...c.pathCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([path, count]) => ({ path, count }));

        // Top 20 referrers
        const topReferrers = [...c.referrerCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([referrer, count]) => ({ referrer, count }));

        insertBatch.push({
          serviceId: svcInfo.serviceId,
          accountId: svcInfo.accountId,
          uniqueVisitors: c.uniqueIps.size,
          pageViews: c.pageViews,
          topPaths: topPaths as any,
          topReferrers: topReferrers as any,
          browsers: c.browserCounts as any,
          devices: c.deviceCounts as any,
          countries: c.countryCounts as any,
          period: '5m',
          recordedAt: now,
        });
      }

      // Batch insert
      for (let i = 0; i < insertBatch.length; i += INSERT_CHUNK_SIZE) {
        const chunk = insertBatch.slice(i, i + INSERT_CHUNK_SIZE);
        await db.insert(visitorAnalytics).values(chunk);
      }

      logger.debug(
        { serviceCount: counters.size, inserted: insertBatch.length, bytesProcessed: newOffset - offset },
        'Visitor analytics collection complete',
      );
    } catch (err) {
      logger.error({ err }, 'Visitor analytics collection failed');
    }
  }

  /**
   * Build mapping from Docker Swarm service names to Fleet service IDs.
   */
  private async buildServiceNameMap(): Promise<{
    serviceMap: Map<string, { serviceId: string; accountId: string }>;
    traefikNameToDockerName: Map<string, string>;
  }> {
    const serviceMap = new Map<string, { serviceId: string; accountId: string }>();
    const traefikNameToDockerName = new Map<string, string>();

    try {
      const swarmServices = await orchestrator.listServices();

      const serviceIdToDockerName = new Map<string, string>();
      for (const svc of swarmServices) {
        const labels = svc.Spec?.Labels || {};
        const serviceId = labels['fleet.service-id'];
        const dockerName = svc.Spec?.Name;
        if (serviceId && dockerName) {
          serviceIdToDockerName.set(serviceId, dockerName);
          const traefikName = dockerName.replace(/[^a-zA-Z0-9]/g, '-');
          if (traefikName !== dockerName) {
            traefikNameToDockerName.set(traefikName, dockerName);
          }
        }
      }

      if (serviceIdToDockerName.size === 0) return { serviceMap, traefikNameToDockerName };

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
      logger.error({ err }, 'Failed to build service name map for visitor analytics');
    }

    return { serviceMap, traefikNameToDockerName };
  }
}

export const visitorAnalyticsService = new VisitorAnalyticsService();
