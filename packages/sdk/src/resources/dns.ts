import type { DnsZone, DnsRecord } from '@fleet/types';
import type {
  RequestFn,
  CreateDnsZoneInput,
  CreateDnsRecordInput,
  UpdateDnsRecordInput,
} from '../types.js';

export class DnsZoneResource {
  constructor(private request: RequestFn) {}

  /** List all DNS zones in the account. */
  async list(): Promise<DnsZone[]> {
    return this.request<DnsZone[]>('GET', '/dns');
  }

  /** Create a new DNS zone. */
  async create(input: CreateDnsZoneInput): Promise<DnsZone> {
    return this.request<DnsZone>('POST', '/dns', input);
  }

  /** Delete a DNS zone. */
  async delete(zoneId: string): Promise<void> {
    return this.request<void>('DELETE', `/dns/${zoneId}`);
  }
}

export class DnsRecordResource {
  constructor(private request: RequestFn) {}

  /** List all records in a DNS zone. */
  async list(zoneId: string): Promise<DnsRecord[]> {
    return this.request<DnsRecord[]>('GET', `/dns/${zoneId}/records`);
  }

  /** Create a new DNS record. */
  async create(input: CreateDnsRecordInput): Promise<DnsRecord> {
    const { zoneId, ...body } = input;
    return this.request<DnsRecord>('POST', `/dns/${zoneId}/records`, body);
  }

  /** Update a DNS record. */
  async update(
    zoneId: string,
    recordId: string,
    input: UpdateDnsRecordInput,
  ): Promise<DnsRecord> {
    return this.request<DnsRecord>(
      'PATCH',
      `/dns/${zoneId}/records/${recordId}`,
      input,
    );
  }

  /** Delete a DNS record. */
  async delete(zoneId: string, recordId: string): Promise<void> {
    return this.request<void>('DELETE', `/dns/${zoneId}/records/${recordId}`);
  }
}
