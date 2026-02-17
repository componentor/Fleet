import type { DnsProvider, DnsProviderResult } from './dns-provider.js';

const POWERDNS_API_URL =
  process.env['POWERDNS_API_URL'] ?? 'http://powerdns:8081';
const POWERDNS_API_KEY = process.env['POWERDNS_API_KEY'] ?? '';

export class PowerDnsProvider implements DnsProvider {
  name = 'powerdns';
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = POWERDNS_API_URL;
    this.apiKey = POWERDNS_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  private canonicalize(domain: string): string {
    return domain.endsWith('.') ? domain : `${domain}.`;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1/servers/localhost${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `PowerDNS API error: ${response.status} ${response.statusText} - ${text}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async createZone(
    domain: string,
    nameservers: string[] = ['ns1.fleet.local.', 'ns2.fleet.local.'],
  ): Promise<DnsProviderResult> {
    try {
      const canonicalDomain = this.canonicalize(domain);
      await this.request('/zones', {
        method: 'POST',
        body: JSON.stringify({
          name: canonicalDomain,
          kind: 'Native',
          nameservers: nameservers.map((ns) => this.canonicalize(ns)),
          soa_edit_api: 'INCEPTION-INCREMENT',
        }),
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async deleteZone(domain: string): Promise<DnsProviderResult> {
    try {
      const canonicalDomain = this.canonicalize(domain);
      await this.request<void>(`/zones/${canonicalDomain}`, {
        method: 'DELETE',
      });
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
    ttl: number = 3600,
    priority?: number,
  ): Promise<DnsProviderResult> {
    try {
      const canonicalDomain = this.canonicalize(domain);
      const canonicalName = this.canonicalize(name);
      const recordContent =
        type === 'MX' && priority != null ? `${priority} ${content}` : content;

      await this.request<void>(`/zones/${canonicalDomain}`, {
        method: 'PATCH',
        body: JSON.stringify({
          rrsets: [
            {
              name: canonicalName,
              type,
              ttl,
              changetype: 'REPLACE',
              records: [{ content: recordContent, disabled: false }],
            },
          ],
        }),
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
    ttl: number = 3600,
    priority?: number,
  ): Promise<DnsProviderResult> {
    return this.createRecord(domain, name, type, content, ttl, priority);
  }

  async deleteRecord(
    domain: string,
    name: string,
    type: string,
  ): Promise<DnsProviderResult> {
    try {
      const canonicalDomain = this.canonicalize(domain);
      const canonicalName = this.canonicalize(name);

      await this.request<void>(`/zones/${canonicalDomain}`, {
        method: 'PATCH',
        body: JSON.stringify({
          rrsets: [
            {
              name: canonicalName,
              type,
              changetype: 'DELETE',
            },
          ],
        }),
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export const dnsService = new PowerDnsProvider();
