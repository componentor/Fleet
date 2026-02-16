const POWERDNS_API_URL =
  process.env['POWERDNS_API_URL'] ?? 'http://powerdns:8081';
const POWERDNS_API_KEY = process.env['POWERDNS_API_KEY'] ?? '';

interface PowerDnsZone {
  id: string;
  name: string;
  kind: string;
  serial: number;
  notified_serial: number;
  masters: string[];
  dnssec: boolean;
  account: string;
  url: string;
  rrsets: PowerDnsRrset[];
}

interface PowerDnsRrset {
  name: string;
  type: string;
  ttl: number;
  changetype?: string;
  records: Array<{
    content: string;
    disabled: boolean;
    set_ptr?: boolean;
  }>;
  comments?: Array<{
    content: string;
    account: string;
    modified_at: number;
  }>;
}

export class DnsService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = POWERDNS_API_URL;
    this.apiKey = POWERDNS_API_KEY;
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

    // DELETE returns 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * Ensure domain ends with a dot (FQDN) as required by PowerDNS.
   */
  private canonicalize(domain: string): string {
    return domain.endsWith('.') ? domain : `${domain}.`;
  }

  /**
   * Create a new DNS zone in PowerDNS.
   */
  async createZone(
    domain: string,
    nameservers: string[] = ['ns1.hoster.local.', 'ns2.hoster.local.'],
  ): Promise<PowerDnsZone> {
    const canonicalDomain = this.canonicalize(domain);

    const zone = await this.request<PowerDnsZone>('/zones', {
      method: 'POST',
      body: JSON.stringify({
        name: canonicalDomain,
        kind: 'Native',
        nameservers: nameservers.map((ns) => this.canonicalize(ns)),
        soa_edit_api: 'INCEPTION-INCREMENT',
      }),
    });

    return zone;
  }

  /**
   * Delete a DNS zone from PowerDNS.
   */
  async deleteZone(domain: string): Promise<void> {
    const canonicalDomain = this.canonicalize(domain);

    await this.request<void>(`/zones/${canonicalDomain}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get zone details including all record sets.
   */
  async getZone(domain: string): Promise<PowerDnsZone> {
    const canonicalDomain = this.canonicalize(domain);

    return this.request<PowerDnsZone>(`/zones/${canonicalDomain}`);
  }

  /**
   * List all zones managed by PowerDNS.
   */
  async listZones(): Promise<PowerDnsZone[]> {
    return this.request<PowerDnsZone[]>('/zones');
  }

  /**
   * Create a DNS record in a zone by adding it to the appropriate RRset.
   */
  async createRecord(
    domain: string,
    name: string,
    type: string,
    content: string,
    ttl: number = 3600,
    priority?: number,
  ): Promise<void> {
    const canonicalDomain = this.canonicalize(domain);
    const canonicalName = this.canonicalize(name);

    // For MX records, PowerDNS expects priority as part of the content
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
            records: [
              {
                content: recordContent,
                disabled: false,
              },
            ],
          },
        ],
      }),
    });
  }

  /**
   * Update a DNS record in a zone. Replaces the entire RRset for the given name/type.
   */
  async updateRecord(
    domain: string,
    name: string,
    type: string,
    content: string,
    ttl: number = 3600,
    priority?: number,
  ): Promise<void> {
    // Update is the same as create in PowerDNS — REPLACE changetype overwrites
    await this.createRecord(domain, name, type, content, ttl, priority);
  }

  /**
   * Delete a specific DNS record (RRset) from a zone.
   */
  async deleteRecord(
    domain: string,
    name: string,
    type: string,
  ): Promise<void> {
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
  }

  /**
   * Verify domain ownership by checking for a specific TXT record.
   * Returns true if the verification TXT record is found.
   */
  async verifyDomain(
    domain: string,
    expectedToken: string,
  ): Promise<boolean> {
    try {
      const zone = await this.getZone(domain);
      const verificationName = `_hoster-verify.${this.canonicalize(domain)}`;

      const txtRrset = zone.rrsets.find(
        (rrset) =>
          rrset.type === 'TXT' && rrset.name === verificationName,
      );

      if (!txtRrset) return false;

      // TXT records in PowerDNS are stored with surrounding quotes
      return txtRrset.records.some((record) => {
        const cleanContent = record.content.replace(/^"(.*)"$/, '$1');
        return cleanContent === expectedToken;
      });
    } catch {
      return false;
    }
  }

  /**
   * Sync a zone by notifying secondaries (triggers AXFR/IXFR).
   */
  async syncWithProvider(domain: string): Promise<void> {
    const canonicalDomain = this.canonicalize(domain);

    await this.request<void>(`/zones/${canonicalDomain}/notify`, {
      method: 'PUT',
    });
  }

  /**
   * Get all records for a zone as a flat list.
   */
  async listRecords(
    domain: string,
  ): Promise<
    Array<{
      name: string;
      type: string;
      content: string;
      ttl: number;
      disabled: boolean;
      priority?: number;
    }>
  > {
    const zone = await this.getZone(domain);

    const records: Array<{
      name: string;
      type: string;
      content: string;
      ttl: number;
      disabled: boolean;
      priority?: number;
    }> = [];

    for (const rrset of zone.rrsets) {
      for (const record of rrset.records) {
        let content = record.content;
        let priority: number | undefined;

        // Extract priority from MX content
        if (rrset.type === 'MX') {
          const parts = record.content.split(' ');
          if (parts.length >= 2) {
            priority = parseInt(parts[0]!, 10);
            content = parts.slice(1).join(' ');
          }
        }

        records.push({
          name: rrset.name,
          type: rrset.type,
          content,
          ttl: rrset.ttl,
          disabled: record.disabled,
          priority,
        });
      }
    }

    return records;
  }
}

export const dnsService = new DnsService();
