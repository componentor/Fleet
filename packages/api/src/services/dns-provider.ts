export interface DnsProviderResult {
  success: boolean;
  error?: string;
}

export interface DnsProvider {
  name: string;
  isConfigured(): boolean;

  createZone(domain: string, nameservers?: string[]): Promise<DnsProviderResult>;
  deleteZone(domain: string): Promise<DnsProviderResult>;

  createRecord(
    domain: string,
    name: string,
    type: string,
    content: string,
    ttl?: number,
    priority?: number,
  ): Promise<DnsProviderResult>;

  updateRecord(
    domain: string,
    name: string,
    type: string,
    content: string,
    ttl?: number,
    priority?: number,
  ): Promise<DnsProviderResult>;

  deleteRecord(
    domain: string,
    name: string,
    type: string,
  ): Promise<DnsProviderResult>;
}
