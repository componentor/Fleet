import type { RegistrarProvider, DomainSearchResult, DomainContact, DomainInfo } from './registrar.service.js';

const RC_API = 'https://httpapi.com/api';

export class ResellerClubProvider implements RegistrarProvider {
  name = 'resellerclub';
  private resellerId: string;
  private apiKey: string;

  constructor(resellerId: string, apiKey: string) {
    this.resellerId = resellerId;
    this.apiKey = apiKey;
  }

  private authParams(): string {
    return `auth-userid=${encodeURIComponent(this.resellerId)}&api-key=${encodeURIComponent(this.apiKey)}`;
  }

  private async request<T>(method: string, path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${RC_API}${path}`);
    url.searchParams.set('auth-userid', this.resellerId);
    url.searchParams.set('api-key', this.apiKey);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const res = await fetch(url.toString(), {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`ResellerClub API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async searchDomains(query: string, tlds: string[]): Promise<DomainSearchResult[]> {
    const cleaned = query
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('.')[0]!
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');

    const effectiveTlds = tlds.length > 0 ? tlds : ['com', 'net', 'org', 'io', 'dev'];

    const params: Record<string, string> = {
      'domain-name': cleaned,
    };

    // ResellerClub expects tlds as tlds=com&tlds=net etc.
    // But since we're using URLSearchParams we need to handle this differently
    const url = new URL(`${RC_API}/domains/available.json`);
    url.searchParams.set('auth-userid', this.resellerId);
    url.searchParams.set('api-key', this.apiKey);
    url.searchParams.set('domain-name', cleaned);
    for (const tld of effectiveTlds) {
      url.searchParams.append('tlds', tld);
    }

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`ResellerClub search failed: ${res.status}`);
    }

    const data = await res.json() as Record<string, any>;

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
    // First create a contact at ResellerClub
    const contactUrl = new URL(`${RC_API}/contacts/add.json`);
    contactUrl.searchParams.set('auth-userid', this.resellerId);
    contactUrl.searchParams.set('api-key', this.apiKey);
    contactUrl.searchParams.set('name', `${contact.firstName} ${contact.lastName}`);
    contactUrl.searchParams.set('company', contact.organization || 'N/A');
    contactUrl.searchParams.set('email', contact.email);
    contactUrl.searchParams.set('address-line-1', contact.address1);
    if (contact.address2) contactUrl.searchParams.set('address-line-2', contact.address2);
    contactUrl.searchParams.set('city', contact.city);
    contactUrl.searchParams.set('state', contact.state);
    contactUrl.searchParams.set('zipcode', contact.postalCode);
    contactUrl.searchParams.set('phone-cc', '1'); // Default US
    contactUrl.searchParams.set('phone', contact.phone.replace(/\D/g, ''));
    contactUrl.searchParams.set('country', contact.country);
    contactUrl.searchParams.set('type', 'Contact');
    contactUrl.searchParams.set('customer-id', this.resellerId);

    const contactRes = await fetch(contactUrl.toString(), { method: 'POST' });
    const contactData = await contactRes.json() as any;
    const contactId = String(contactData);

    // Register the domain
    const parts = domain.split('.');
    const domainName = parts[0]!;
    const tld = parts.slice(1).join('.');

    const regUrl = new URL(`${RC_API}/domains/register.json`);
    regUrl.searchParams.set('auth-userid', this.resellerId);
    regUrl.searchParams.set('api-key', this.apiKey);
    regUrl.searchParams.set('domain-name', domainName);
    regUrl.searchParams.set('tld', tld);
    regUrl.searchParams.set('years', String(years));
    regUrl.searchParams.set('ns', 'ns1.fleet.local');
    regUrl.searchParams.append('ns', 'ns2.fleet.local');
    regUrl.searchParams.set('customer-id', this.resellerId);
    regUrl.searchParams.set('reg-contact-id', contactId);
    regUrl.searchParams.set('admin-contact-id', contactId);
    regUrl.searchParams.set('tech-contact-id', contactId);
    regUrl.searchParams.set('billing-contact-id', contactId);
    regUrl.searchParams.set('invoice-option', 'NoInvoice');
    regUrl.searchParams.set('protect-privacy', 'true');

    const regRes = await fetch(regUrl.toString(), { method: 'POST' });
    if (!regRes.ok) {
      const text = await regRes.text();
      throw new Error(`Domain registration failed: ${text}`);
    }

    const regData = await regRes.json() as any;
    const registrarDomainId = String(regData.entityid || regData);

    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + years);

    return { registrarDomainId, expiresAt };
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

  async renewDomain(
    registrarDomainId: string,
    years: number,
  ): Promise<{ expiresAt: Date }> {
    // Get current expiry first
    const url = new URL(`${RC_API}/domains/renew.json`);
    url.searchParams.set('auth-userid', this.resellerId);
    url.searchParams.set('api-key', this.apiKey);
    url.searchParams.set('order-id', registrarDomainId);
    url.searchParams.set('years', String(years));
    url.searchParams.set('exp-date', String(Math.floor(Date.now() / 1000)));
    url.searchParams.set('invoice-option', 'NoInvoice');

    const res = await fetch(url.toString(), { method: 'POST' });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Domain renewal failed: ${text}`);
    }

    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + years);

    return { expiresAt };
  }
}
