import type { DnsProvider } from './dns-provider.js';

export interface DnsOperationResult {
  success: boolean;
  warnings: string[];
}

/**
 * Orchestrates DNS operations across multiple providers.
 * Always succeeds (DB is the source of truth). Provider sync is best-effort.
 */
export class DnsProviderManager {
  private providers: DnsProvider[] = [];

  register(provider: DnsProvider) {
    if (provider.isConfigured()) {
      this.providers.push(provider);
    }
  }

  get hasProviders(): boolean {
    return this.providers.length > 0;
  }

  async createZone(domain: string, nameservers?: string[]): Promise<DnsOperationResult> {
    const warnings: string[] = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.createZone(domain, nameservers);
        if (!result.success) {
          warnings.push(`${provider.name}: ${result.error ?? 'Unknown error'}`);
        }
      } catch (err) {
        warnings.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { success: true, warnings };
  }

  async deleteZone(domain: string): Promise<DnsOperationResult> {
    const warnings: string[] = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.deleteZone(domain);
        if (!result.success) {
          warnings.push(`${provider.name}: ${result.error ?? 'Unknown error'}`);
        }
      } catch (err) {
        warnings.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { success: true, warnings };
  }

  async createRecord(
    domain: string,
    name: string,
    type: string,
    content: string,
    ttl?: number,
    priority?: number,
  ): Promise<DnsOperationResult> {
    const warnings: string[] = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.createRecord(domain, name, type, content, ttl, priority);
        if (!result.success) {
          warnings.push(`${provider.name}: ${result.error ?? 'Unknown error'}`);
        }
      } catch (err) {
        warnings.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { success: true, warnings };
  }

  async updateRecord(
    domain: string,
    name: string,
    type: string,
    content: string,
    ttl?: number,
    priority?: number,
  ): Promise<DnsOperationResult> {
    const warnings: string[] = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.updateRecord(domain, name, type, content, ttl, priority);
        if (!result.success) {
          warnings.push(`${provider.name}: ${result.error ?? 'Unknown error'}`);
        }
      } catch (err) {
        warnings.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { success: true, warnings };
  }

  async deleteRecord(
    domain: string,
    name: string,
    type: string,
  ): Promise<DnsOperationResult> {
    const warnings: string[] = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.deleteRecord(domain, name, type);
        if (!result.success) {
          warnings.push(`${provider.name}: ${result.error ?? 'Unknown error'}`);
        }
      } catch (err) {
        warnings.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { success: true, warnings };
  }
}

// Build and export the singleton manager
import { PowerDnsProvider } from './dns.service.js';
import { CloudflareDnsProvider } from './cloudflare-dns-provider.js';

export const dnsManager = new DnsProviderManager();
dnsManager.register(new PowerDnsProvider());
dnsManager.register(new CloudflareDnsProvider());
