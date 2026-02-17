import type { DnsProvider, DnsProviderResult } from './dns-provider.js';
import { cloudflareService } from './cloudflare.service.js';

/**
 * Cloudflare adapter implementing the DnsProvider interface.
 * Uses the existing CloudflareService under the hood.
 */
export class CloudflareDnsProvider implements DnsProvider {
  name = 'cloudflare';

  isConfigured(): boolean {
    return cloudflareService.isConfigured;
  }

  async createZone(domain: string): Promise<DnsProviderResult> {
    try {
      // Cloudflare requires an account ID; use env var
      const cfAccountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
      if (!cfAccountId) {
        return { success: false, error: 'CLOUDFLARE_ACCOUNT_ID not set' };
      }
      await cloudflareService.createZone(domain, cfAccountId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async deleteZone(domain: string): Promise<DnsProviderResult> {
    try {
      const zones = await cloudflareService.listZones(domain);
      if (zones.length === 0) {
        return { success: true }; // Already gone
      }
      await cloudflareService.deleteZone(zones[0]!.id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async createRecord(
    domain: string,
    name: string,
    type: string,
    content: string,
    ttl?: number,
    priority?: number,
  ): Promise<DnsProviderResult> {
    try {
      const zones = await cloudflareService.listZones(domain);
      if (zones.length === 0) {
        return { success: false, error: `Zone not found for ${domain}` };
      }
      await cloudflareService.createDnsRecord(zones[0]!.id, {
        type,
        name,
        content,
        ttl: ttl ?? 1, // 1 = auto in CF
        priority,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async updateRecord(
    domain: string,
    name: string,
    type: string,
    content: string,
    ttl?: number,
    priority?: number,
  ): Promise<DnsProviderResult> {
    try {
      const zones = await cloudflareService.listZones(domain);
      if (zones.length === 0) {
        return { success: false, error: `Zone not found for ${domain}` };
      }
      const zoneId = zones[0]!.id;
      const records = await cloudflareService.listDnsRecords(zoneId, type);
      const existing = records.find((r) => r.name === name && r.type === type);
      if (existing) {
        await cloudflareService.updateDnsRecord(zoneId, existing.id, {
          type,
          name,
          content,
          ttl: ttl ?? 1,
          priority,
        });
      } else {
        await cloudflareService.createDnsRecord(zoneId, {
          type,
          name,
          content,
          ttl: ttl ?? 1,
          priority,
        });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async deleteRecord(
    domain: string,
    name: string,
    type: string,
  ): Promise<DnsProviderResult> {
    try {
      const zones = await cloudflareService.listZones(domain);
      if (zones.length === 0) {
        return { success: true };
      }
      const zoneId = zones[0]!.id;
      const records = await cloudflareService.listDnsRecords(zoneId, type);
      const existing = records.find((r) => r.name === name && r.type === type);
      if (existing) {
        await cloudflareService.deleteDnsRecord(zoneId, existing.id);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
