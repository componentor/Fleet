import type { RegistrarProvider, DomainSearchResult, DomainContact, DomainInfo } from './registrar.service.js';
import { logger } from './logger.js';

const NAMECOM_API_PROD = 'https://api.name.com/v4';
const NAMECOM_API_DEV = 'https://api.dev.name.com/v4';
const REQUEST_TIMEOUT = 15_000;

export class NamecomProvider implements RegistrarProvider {
  name = 'namecom';
  private username: string;
  private apiToken: string;
  private baseUrl: string;

  constructor(username: string, apiToken: string, config?: { sandbox?: boolean }) {
    this.username = username;
    this.apiToken = apiToken;
    this.baseUrl = config?.sandbox ? NAMECOM_API_DEV : NAMECOM_API_PROD;
  }

  private getNameservers(): string[] {
    const ns = process.env['NAMESERVERS'];
    if (ns) return ns.split(',').map((s) => s.trim()).filter(Boolean);
    return ['ns1.fleet.local', 'ns2.fleet.local'];
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const auth = Buffer.from(`${this.username}:${this.apiToken}`).toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
        throw new Error(`Name.com API error ${res.status}: ${errorBody.message ?? 'Unknown error'}`);
      }

      // Some endpoints return 204 with no body
      if (res.status === 204) return {} as T;

      return res.json() as Promise<T>;
    } catch (err) {
      clearTimeout(timeout);
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Name.com API timeout after ${REQUEST_TIMEOUT}ms: ${method} ${path}`);
      }
      throw err;
    }
  }

  /**
   * Format phone to Name.com expected format: +{countryCode}.{number}
   */
  private formatPhone(phone: string, country: string): string {
    const digits = phone.replace(/\D/g, '');
    // If the number already starts with a country code, use it as-is
    if (phone.startsWith('+')) {
      const cleaned = digits;
      // Try to split into country code and number
      // For common cases: US/CA = 1, UK = 44, DE = 49, NO = 47, CN = 86
      return `+${cleaned.slice(0, cleaned.length > 10 ? cleaned.length - 10 : 1)}.${cleaned.slice(-10)}`;
    }
    // Default country code mapping
    const ccMap: Record<string, string> = {
      US: '1', CA: '1', GB: '44', DE: '49', NO: '47', CN: '86', AU: '61', FR: '33', SE: '46',
    };
    const cc = ccMap[country] ?? '1';
    return `+${cc}.${digits}`;
  }

  async searchDomains(query: string, tlds: string[]): Promise<DomainSearchResult[]> {
    const cleaned = query
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('.')[0]!
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');

    const effectiveTlds = tlds.length > 0 ? tlds : ['com', 'net', 'org', 'io', 'dev'];

    const domainNames = effectiveTlds.map((tld) => `${cleaned}.${tld}`);

    const data = await this.request<{
      results: Array<{
        domainName: string;
        purchasable: boolean;
        premium: boolean;
        purchasePrice?: number;
        renewalPrice?: number;
      }>;
    }>('POST', '/domains:checkAvailability', { domainNames });

    return (data.results ?? []).map((r) => ({
      domain: r.domainName,
      available: r.purchasable,
      premium: r.premium ?? false,
      price: r.purchasePrice != null
        ? {
            registration: r.purchasePrice,
            renewal: r.renewalPrice ?? r.purchasePrice,
            currency: 'USD',
          }
        : null,
    }));
  }

  async checkAvailability(domain: string): Promise<DomainSearchResult> {
    const data = await this.request<{
      results: Array<{
        domainName: string;
        purchasable: boolean;
        premium: boolean;
        purchasePrice?: number;
        renewalPrice?: number;
      }>;
    }>('POST', '/domains:checkAvailability', { domainNames: [domain] });

    const result = data.results?.[0];
    if (!result) {
      return { domain, available: false, premium: false, price: null };
    }

    return {
      domain: result.domainName,
      available: result.purchasable,
      premium: result.premium ?? false,
      price: result.purchasePrice != null
        ? {
            registration: result.purchasePrice,
            renewal: result.renewalPrice ?? result.purchasePrice,
            currency: 'USD',
          }
        : null,
    };
  }

  async registerDomain(
    domain: string,
    years: number,
    contact: DomainContact,
  ): Promise<{ registrarDomainId: string; expiresAt: Date }> {
    // First check availability to get the purchase price
    const availability = await this.checkAvailability(domain);
    if (!availability.available || !availability.price) {
      throw new Error(`Domain ${domain} is not available for registration`);
    }

    const nameservers = this.getNameservers();
    const phone = this.formatPhone(contact.phone, contact.country);

    const contactInfo = {
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone,
      address1: contact.address1,
      ...(contact.address2 ? { address2: contact.address2 } : {}),
      city: contact.city,
      state: contact.state,
      zip: contact.postalCode,
      country: contact.country,
      ...(contact.organization ? { organization: contact.organization } : {}),
    };

    try {
      const data = await this.request<{
        domain: {
          domainName: string;
          expireDate?: string;
        };
      }>('POST', '/domains', {
        domain: { domainName: domain },
        purchasePrice: availability.price.registration,
        years,
        contacts: {
          registrant: contactInfo,
          admin: contactInfo,
          tech: contactInfo,
          billing: contactInfo,
        },
        nameservers: nameservers.map((host) => ({ host })),
      });

      const registrarDomainId = data.domain?.domainName ?? domain;
      const expiresAt = data.domain?.expireDate
        ? new Date(data.domain.expireDate)
        : new Date(Date.now() + years * 365.25 * 24 * 60 * 60 * 1000);

      logger.info({ domain, years }, 'Domain registered via Name.com');

      return { registrarDomainId, expiresAt };
    } catch (err) {
      logger.error({ err, domain, years }, 'Name.com domain registration failed');
      throw new Error(`Domain registration failed: ${(err as Error).message}`);
    }
  }

  async getDomainInfo(domain: string): Promise<DomainInfo> {
    const data = await this.request<{
      domainName: string;
      locked: boolean;
      autorenewEnabled: boolean;
      expireDate?: string;
      createDate?: string;
      nameservers?: Array<{ host: string }>;
    }>('GET', `/domains/${encodeURIComponent(domain)}`);

    return {
      domain: data.domainName ?? domain,
      status: 'active',
      registeredAt: data.createDate ? new Date(data.createDate) : null,
      expiresAt: data.expireDate ? new Date(data.expireDate) : null,
      autoRenew: data.autorenewEnabled ?? false,
      nameservers: (data.nameservers ?? []).map((ns) => ns.host),
      locked: data.locked ?? false,
    };
  }

  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    const res = await fetch(`${this.baseUrl}/domains/${domain}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.username}:${this.apiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nameservers }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Name.com setNameservers failed (${res.status}): ${body}`);
    }
  }

  async renewDomain(
    registrarDomainId: string,
    years: number,
  ): Promise<{ expiresAt: Date }> {
    // Get current domain info to determine renewal price
    const info = await this.getDomainInfo(registrarDomainId);
    const tld = registrarDomainId.split('.').slice(1).join('.');

    // Check pricing for renewal
    const availability = await this.request<{
      results: Array<{
        domainName: string;
        renewalPrice?: number;
      }>;
    }>('POST', '/domains:checkAvailability', { domainNames: [registrarDomainId] });

    const renewalPrice = availability.results?.[0]?.renewalPrice;

    try {
      const data = await this.request<{
        domain: {
          expireDate?: string;
        };
      }>('POST', `/domains/${encodeURIComponent(registrarDomainId)}:renew`, {
        years,
        ...(renewalPrice != null ? { purchasePrice: renewalPrice } : {}),
      });

      const expiresAt = data.domain?.expireDate
        ? new Date(data.domain.expireDate)
        : new Date((info.expiresAt ?? new Date()).getTime() + years * 365.25 * 24 * 60 * 60 * 1000);

      logger.info({ domain: registrarDomainId, years, expiresAt }, 'Domain renewed via Name.com');

      return { expiresAt };
    } catch (err) {
      logger.error({ err, domain: registrarDomainId, years }, 'Name.com domain renewal failed');
      throw new Error(`Domain renewal failed: ${(err as Error).message}`);
    }
  }
}
