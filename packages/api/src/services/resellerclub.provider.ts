import type { RegistrarProvider, DomainSearchResult, DomainContact, DomainInfo } from './registrar.service.js';
import { logger } from './logger.js';

const RC_API_PROD = 'https://httpapi.com/api';
const RC_API_TEST = 'https://test.httpapi.com/api';
const REQUEST_TIMEOUT = 15_000;

export interface ResellerClubConfig {
  resellerId: string;
  apiKey: string;
  customerId?: string;
  sandbox?: boolean;
}

export class ResellerClubProvider implements RegistrarProvider {
  name = 'resellerclub';
  private resellerId: string;
  private apiKey: string;
  private customerId: string;
  private baseUrl: string;

  constructor(resellerId: string, apiKey: string, config?: { customerId?: string; sandbox?: boolean }) {
    this.resellerId = resellerId;
    this.apiKey = apiKey;
    this.customerId = config?.customerId ?? resellerId;
    this.baseUrl = config?.sandbox ? RC_API_TEST : RC_API_PROD;
  }

  private getNameservers(): string[] {
    const ns = process.env['NAMESERVERS'];
    if (ns) return ns.split(',').map((s) => s.trim()).filter(Boolean);
    return ['ns1.fleet.local', 'ns2.fleet.local'];
  }

  private async request<T>(method: string, path: string, params?: Record<string, string>, multiParams?: Record<string, string[]>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('auth-userid', this.resellerId);
    url.searchParams.set('api-key', this.apiKey);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    if (multiParams) {
      for (const [key, values] of Object.entries(multiParams)) {
        for (const value of values) {
          url.searchParams.append(key, value);
        }
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const res = await fetch(url.toString(), {
        method,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text().catch(() => 'Unknown error');
        throw new Error(`ResellerClub API error ${res.status}: ${text}`);
      }

      return res.json() as Promise<T>;
    } catch (err) {
      clearTimeout(timeout);
      if ((err as Error).name === 'AbortError') {
        throw new Error(`ResellerClub API timeout after ${REQUEST_TIMEOUT}ms: ${method} ${path}`);
      }
      throw err;
    }
  }

  async searchDomains(query: string, tlds: string[]): Promise<DomainSearchResult[]> {
    const cleaned = query
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('.')[0]!
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');

    const effectiveTlds = tlds.length > 0 ? tlds : ['com', 'net', 'org', 'io', 'dev'];

    const data = await this.request<Record<string, any>>(
      'GET',
      '/domains/available.json',
      { 'domain-name': cleaned },
      { tlds: effectiveTlds },
    );

    const results: DomainSearchResult[] = [];
    for (const tld of effectiveTlds) {
      const domain = `${cleaned}.${tld}`;
      const entry = data[domain];
      if (!entry) continue;

      const status = entry.status;
      const available = status === 'available';
      const price = entry.price
        ? {
            registration: Number(entry.price) || 0,
            renewal: Number(entry.price) || 0,
            currency: 'USD',
          }
        : null;

      results.push({
        domain,
        available,
        premium: false,
        price,
      });
    }

    return results;
  }

  async checkAvailability(domain: string): Promise<DomainSearchResult> {
    const parts = domain.split('.');
    const name = parts[0]!;
    const tld = parts.slice(1).join('.');

    const results = await this.searchDomains(name, [tld]);
    return results[0] ?? {
      domain,
      available: false,
      premium: false,
      price: null,
    };
  }

  async registerDomain(
    domain: string,
    years: number,
    contact: DomainContact,
  ): Promise<{ registrarDomainId: string; expiresAt: Date }> {
    // Extract phone country code from country (simplified — defaults to 1 for US)
    const phoneCc = contact.country === 'US' || contact.country === 'CA' ? '1' : '1';

    // Create a contact at ResellerClub
    let contactId: string;
    try {
      const contactData = await this.request<any>('POST', '/contacts/add.json', {
        'name': `${contact.firstName} ${contact.lastName}`,
        'company': contact.organization || 'N/A',
        'email': contact.email,
        'address-line-1': contact.address1,
        ...(contact.address2 ? { 'address-line-2': contact.address2 } : {}),
        'city': contact.city,
        'state': contact.state,
        'zipcode': contact.postalCode,
        'phone-cc': phoneCc,
        'phone': contact.phone.replace(/\D/g, ''),
        'country': contact.country,
        'type': 'Contact',
        'customer-id': this.customerId,
      });
      contactId = String(contactData);
    } catch (err) {
      logger.error({ err, domain }, 'Failed to create ResellerClub contact');
      throw new Error(`Failed to create domain contact: ${(err as Error).message}`);
    }

    // Register the domain
    const parts = domain.split('.');
    const domainName = parts[0]!;
    const tld = parts.slice(1).join('.');
    const nameservers = this.getNameservers();

    try {
      const regData = await this.request<any>(
        'POST',
        '/domains/register.json',
        {
          'domain-name': domainName,
          'tld': tld,
          'years': String(years),
          'customer-id': this.customerId,
          'reg-contact-id': contactId,
          'admin-contact-id': contactId,
          'tech-contact-id': contactId,
          'billing-contact-id': contactId,
          'invoice-option': 'NoInvoice',
          'protect-privacy': 'true',
        },
        { ns: nameservers },
      );

      const registrarDomainId = String(regData.entityid ?? regData);

      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + years);

      logger.info({ domain, registrarDomainId, years }, 'Domain registered via ResellerClub');

      return { registrarDomainId, expiresAt };
    } catch (err) {
      logger.error({ err, domain, years }, 'ResellerClub domain registration failed');
      throw new Error(`Domain registration failed: ${(err as Error).message}`);
    }
  }

  async getDomainInfo(domain: string): Promise<DomainInfo> {
    const data = await this.request<any>('GET', '/domains/details-by-name.json', {
      'domain-name': domain,
      'options': 'All',
    });

    return {
      domain,
      status: data.currentstatus || 'unknown',
      registeredAt: data.creationtime ? new Date(data.creationtime * 1000) : null,
      expiresAt: data.endtime ? new Date(data.endtime * 1000) : null,
      autoRenew: false,
      nameservers: data.ns ? Object.values(data.ns as Record<string, string>) : [],
      locked: data.orderstatus?.includes('locked') ?? false,
    };
  }

  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    // First, get the order ID for this domain
    const detailsUrl = new URL(`${this.baseUrl}/domains/details-by-name.json`);
    detailsUrl.searchParams.set('auth-userid', this.resellerId);
    detailsUrl.searchParams.set('api-key', this.apiKey);
    detailsUrl.searchParams.set('domain-name', domain);

    const detailsRes = await fetch(detailsUrl.toString(), {
      signal: AbortSignal.timeout(15_000),
    });

    if (!detailsRes.ok) {
      const body = await detailsRes.text();
      throw new Error(`ResellerClub domain details lookup failed (${detailsRes.status}): ${body}`);
    }

    const details = await detailsRes.json() as any;
    const orderId = details.orderid ?? details['entityid'];
    if (!orderId) {
      throw new Error('Could not find order ID for domain');
    }

    // Now modify nameservers
    const modifyUrl = new URL(`${this.baseUrl}/domains/modify-ns.json`);
    modifyUrl.searchParams.set('auth-userid', this.resellerId);
    modifyUrl.searchParams.set('api-key', this.apiKey);
    modifyUrl.searchParams.set('order-id', String(orderId));
    for (const ns of nameservers) {
      modifyUrl.searchParams.append('ns', ns);
    }

    const modifyRes = await fetch(modifyUrl.toString(), {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
    });

    if (!modifyRes.ok) {
      const body = await modifyRes.text();
      throw new Error(`ResellerClub setNameservers failed (${modifyRes.status}): ${body}`);
    }
  }

  async renewDomain(
    registrarDomainId: string,
    years: number,
  ): Promise<{ expiresAt: Date }> {
    // Get current domain details to find the actual expiry date
    let currentExpiry: number;
    try {
      const details = await this.request<any>('GET', '/domains/details.json', {
        'order-id': registrarDomainId,
        'options': 'OrderDetails',
      });
      currentExpiry = details.endtime ?? Math.floor(Date.now() / 1000);
    } catch {
      // Fallback to current time if we can't get details
      currentExpiry = Math.floor(Date.now() / 1000);
    }

    const data = await this.request<any>('POST', '/domains/renew.json', {
      'order-id': registrarDomainId,
      'years': String(years),
      'exp-date': String(currentExpiry),
      'invoice-option': 'NoInvoice',
    });

    // Calculate new expiry from the actual current expiry
    const expiresAt = new Date(currentExpiry * 1000);
    expiresAt.setFullYear(expiresAt.getFullYear() + years);

    logger.info({ registrarDomainId, years, expiresAt }, 'Domain renewed via ResellerClub');

    return { expiresAt };
  }
}
