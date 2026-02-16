const CF_API = 'https://api.cloudflare.com/client/v4';

export interface CfZone {
  id: string;
  name: string;
  status: string;
  nameServers: string[];
  paused: boolean;
}

export interface CfDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority?: number;
}

export class CloudflareService {
  private apiToken: string | null = null;

  configure(apiToken: string) {
    this.apiToken = apiToken;
  }

  get isConfigured(): boolean {
    return !!this.apiToken;
  }

  async createZone(domain: string, accountId: string): Promise<CfZone> {
    const data = await this.request<{ result: Record<string, unknown> }>('POST', '/zones', {
      name: domain,
      account: { id: accountId },
      type: 'full',
    });
    return this.mapZone(data.result);
  }

  async getZone(zoneId: string): Promise<CfZone> {
    const data = await this.request<{ result: Record<string, unknown> }>('GET', `/zones/${zoneId}`);
    return this.mapZone(data.result);
  }

  async listZones(domain?: string): Promise<CfZone[]> {
    const params = domain ? `?name=${encodeURIComponent(domain)}` : '?per_page=50';
    const data = await this.request<{ result: Array<Record<string, unknown>> }>('GET', `/zones${params}`);
    return data.result.map((z) => this.mapZone(z));
  }

  async deleteZone(zoneId: string): Promise<void> {
    await this.request('DELETE', `/zones/${zoneId}`);
  }

  async createDnsRecord(
    zoneId: string,
    record: { type: string; name: string; content: string; ttl?: number; proxied?: boolean; priority?: number },
  ): Promise<CfDnsRecord> {
    const data = await this.request<{ result: Record<string, unknown> }>(
      'POST',
      `/zones/${zoneId}/dns_records`,
      record,
    );
    return this.mapRecord(data.result);
  }

  async updateDnsRecord(
    zoneId: string,
    recordId: string,
    record: { type: string; name: string; content: string; ttl?: number; proxied?: boolean; priority?: number },
  ): Promise<CfDnsRecord> {
    const data = await this.request<{ result: Record<string, unknown> }>(
      'PATCH',
      `/zones/${zoneId}/dns_records/${recordId}`,
      record,
    );
    return this.mapRecord(data.result);
  }

  async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    await this.request('DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
  }

  async listDnsRecords(zoneId: string, type?: string): Promise<CfDnsRecord[]> {
    const params = type ? `?type=${type}&per_page=100` : '?per_page=100';
    const data = await this.request<{ result: Array<Record<string, unknown>> }>(
      'GET',
      `/zones/${zoneId}/dns_records${params}`,
    );
    return data.result.map((r) => this.mapRecord(r));
  }

  async purgeCache(zoneId: string, urls?: string[]): Promise<void> {
    const body = urls ? { files: urls } : { purge_everything: true };
    await this.request('POST', `/zones/${zoneId}/purge_cache`, body);
  }

  async getAnalytics(
    zoneId: string,
    since: string,
    until: string,
  ): Promise<{ requests: number; bandwidth: number; threats: number; pageviews: number }> {
    const data = await this.request<{ result: { totals: Record<string, unknown> } }>(
      'GET',
      `/zones/${zoneId}/analytics/dashboard?since=${since}&until=${until}`,
    );
    const totals = data.result.totals;
    const requests = totals['requests'] as Record<string, number>;
    const bandwidth = totals['bandwidth'] as Record<string, number>;
    const threats = totals['threats'] as Record<string, number>;
    const pageviews = totals['pageviews'] as Record<string, number>;
    return {
      requests: requests['all'] ?? 0,
      bandwidth: bandwidth['all'] ?? 0,
      threats: threats['all'] ?? 0,
      pageviews: pageviews['all'] ?? 0,
    };
  }

  async updateSecurityLevel(zoneId: string, level: 'off' | 'essentially_off' | 'low' | 'medium' | 'high' | 'under_attack'): Promise<void> {
    await this.request('PATCH', `/zones/${zoneId}/settings/security_level`, { value: level });
  }

  async getSSLMode(zoneId: string): Promise<string> {
    const data = await this.request<{ result: { value: string } }>('GET', `/zones/${zoneId}/settings/ssl`);
    return data.result.value;
  }

  async setSSLMode(zoneId: string, mode: 'off' | 'flexible' | 'full' | 'strict'): Promise<void> {
    await this.request('PATCH', `/zones/${zoneId}/settings/ssl`, { value: mode });
  }

  async enableAlwaysHTTPS(zoneId: string, enabled: boolean): Promise<void> {
    await this.request('PATCH', `/zones/${zoneId}/settings/always_use_https`, { value: enabled ? 'on' : 'off' });
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.apiToken) {
      throw new Error('Cloudflare API token not configured');
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(`${CF_API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Cloudflare API error ${res.status}: ${errBody}`);
    }

    if (method === 'DELETE' && res.status === 200) {
      return {} as T;
    }

    return res.json() as Promise<T>;
  }

  private mapZone(z: Record<string, unknown>): CfZone {
    return {
      id: z['id'] as string,
      name: z['name'] as string,
      status: z['status'] as string,
      nameServers: (z['name_servers'] as string[]) ?? [],
      paused: (z['paused'] as boolean) ?? false,
    };
  }

  private mapRecord(r: Record<string, unknown>): CfDnsRecord {
    return {
      id: r['id'] as string,
      type: r['type'] as string,
      name: r['name'] as string,
      content: r['content'] as string,
      ttl: (r['ttl'] as number) ?? 1,
      proxied: (r['proxied'] as boolean) ?? false,
      priority: r['priority'] as number | undefined,
    };
  }
}

export const cloudflareService = new CloudflareService();
