// ---------------------------------------------------------------------------
// DNS & Domain types
// ---------------------------------------------------------------------------

export type DnsRecordType =
  | 'A'
  | 'AAAA'
  | 'CNAME'
  | 'MX'
  | 'TXT'
  | 'SRV'
  | 'NS';

export interface DnsZone {
  id: string;
  accountId: string;
  domain: string;
  verified: boolean;
  nameservers: string[];
}

export interface DnsRecord {
  id: string;
  zoneId: string;
  type: DnsRecordType;
  name: string;
  content: string;
  ttl: number;
  priority: number | null;
}

export interface CreateDnsZoneInput {
  accountId: string;
  domain: string;
}

export interface CreateDnsRecordInput {
  zoneId: string;
  type: DnsRecordType;
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
}

export interface UpdateDnsRecordInput {
  type?: DnsRecordType;
  name?: string;
  content?: string;
  ttl?: number;
  priority?: number | null;
}

export interface ContactInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  organization?: string;
}

export interface DomainSearchResult {
  domain: string;
  available: boolean;
  priceCents: number;
  currency: string;
}

export interface DomainRegistration {
  domain: string;
  registrarId: string;
  expiresAt: Date;
  autoRenew: boolean;
  status: string;
}

export interface DomainInfo {
  domain: string;
  registrarId: string;
  status: string;
  expiresAt: Date;
  autoRenew: boolean;
  nameservers: string[];
  contact: ContactInfo;
}

export interface DomainRegistrar {
  id: string;
  name: string;
  searchDomains(query: string): Promise<DomainSearchResult[]>;
  checkAvailability(domain: string): Promise<boolean>;
  registerDomain(
    domain: string,
    contact: ContactInfo,
    years: number,
  ): Promise<DomainRegistration>;
  renewDomain(domain: string, years: number): Promise<DomainRegistration>;
  transferDomain(
    domain: string,
    authCode: string,
    contact: ContactInfo,
  ): Promise<DomainRegistration>;
  getDomainInfo(domain: string): Promise<DomainInfo>;
  setNameservers(domain: string, nameservers: string[]): Promise<void>;
}
