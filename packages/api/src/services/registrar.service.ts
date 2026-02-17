import { db, domainRegistrars, domainRegistrations, insertReturning, updateReturning, eq } from '@fleet/db';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface DomainSearchResult {
  domain: string;
  available: boolean;
  premium: boolean;
  price: { registration: number; renewal: number; currency: string } | null;
}

export interface DomainContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string; // ISO 3166-1 alpha-2
  organization?: string;
}

export interface DomainInfo {
  domain: string;
  status: string;
  registeredAt: Date | null;
  expiresAt: Date | null;
  autoRenew: boolean;
  nameservers: string[];
  locked: boolean;
}

export interface RegistrarProvider {
  name: string;
  searchDomains(
    query: string,
    tlds: string[],
  ): Promise<DomainSearchResult[]>;
  checkAvailability(domain: string): Promise<DomainSearchResult>;
  registerDomain(
    domain: string,
    years: number,
    contact: DomainContact,
  ): Promise<{ registrarDomainId: string; expiresAt: Date }>;
  getDomainInfo(domain: string): Promise<DomainInfo>;
  renewDomain(
    registrarDomainId: string,
    years: number,
  ): Promise<{ expiresAt: Date }>;
}

// ────────────────────────────────────────────────────────────────────────────
// Built-in provider: Simulated / placeholder
// In production, replace with a real registrar API (Namecheap, Gandi, etc.)
// ────────────────────────────────────────────────────────────────────────────

class SimulatedRegistrarProvider implements RegistrarProvider {
  name = 'simulated';

  private readonly tldPrices: Record<string, { registration: number; renewal: number }> = {
    com: { registration: 12.99, renewal: 14.99 },
    net: { registration: 11.99, renewal: 13.99 },
    org: { registration: 10.99, renewal: 12.99 },
    io: { registration: 39.99, renewal: 44.99 },
    dev: { registration: 15.99, renewal: 17.99 },
    app: { registration: 15.99, renewal: 17.99 },
    co: { registration: 29.99, renewal: 34.99 },
    xyz: { registration: 2.99, renewal: 9.99 },
    me: { registration: 8.99, renewal: 19.99 },
    ai: { registration: 79.99, renewal: 79.99 },
  };

  async searchDomains(
    query: string,
    tlds: string[],
  ): Promise<DomainSearchResult[]> {
    // Clean up the query — remove protocol, www, and any TLD
    const cleaned = query
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('.')[0]!
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');

    const effectiveTlds =
      tlds.length > 0 ? tlds : Object.keys(this.tldPrices);

    const results: DomainSearchResult[] = [];

    for (const tld of effectiveTlds) {
      const domain = `${cleaned}.${tld}`;
      const prices = this.tldPrices[tld];

      // Check if already registered in our system
      const existing = await db.query.domainRegistrations.findFirst({
        where: eq(domainRegistrations.domain, domain),
      });

      results.push({
        domain,
        available: !existing,
        premium: false,
        price: prices
          ? {
              registration: prices.registration,
              renewal: prices.renewal,
              currency: 'USD',
            }
          : null,
      });
    }

    return results;
  }

  async checkAvailability(domain: string): Promise<DomainSearchResult> {
    const tld = domain.split('.').slice(1).join('.');
    const prices = this.tldPrices[tld];

    const existing = await db.query.domainRegistrations.findFirst({
      where: eq(domainRegistrations.domain, domain),
    });

    return {
      domain,
      available: !existing,
      premium: false,
      price: prices
        ? {
            registration: prices.registration,
            renewal: prices.renewal,
            currency: 'USD',
          }
        : null,
    };
  }

  async registerDomain(
    domain: string,
    years: number,
    _contact: DomainContact,
  ): Promise<{ registrarDomainId: string; expiresAt: Date }> {
    // In a real implementation, this would call the registrar's API
    const registrarDomainId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + years);

    return { registrarDomainId, expiresAt };
  }

  async getDomainInfo(domain: string): Promise<DomainInfo> {
    const registration = await db.query.domainRegistrations.findFirst({
      where: eq(domainRegistrations.domain, domain),
    });

    if (!registration) {
      throw new Error(`Domain ${domain} not found in registrations`);
    }

    return {
      domain: registration.domain,
      status: registration.status ?? 'active',
      registeredAt: registration.registeredAt,
      expiresAt: registration.expiresAt,
      autoRenew: registration.autoRenew ?? true,
      nameservers: [],
      locked: false,
    };
  }

  async renewDomain(
    _registrarDomainId: string,
    years: number,
  ): Promise<{ expiresAt: Date }> {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + years);
    return { expiresAt };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Registrar Service
// ────────────────────────────────────────────────────────────────────────────

export class RegistrarService {
  private provider: RegistrarProvider | null = null;

  /**
   * Get or create the configured registrar provider.
   * In production, this would look at the domainRegistrars table for the
   * enabled registrar and instantiate the appropriate API client.
   */
  async getProvider(): Promise<RegistrarProvider> {
    if (this.provider) return this.provider;

    // Check if there's an enabled registrar configured in DB
    const registrar = await db.query.domainRegistrars.findFirst({
      where: eq(domainRegistrars.enabled, true),
    });

    if (registrar) {
      const config = (registrar.config ?? {}) as Record<string, string>;
      switch (registrar.provider) {
        case 'resellerclub': {
          const { ResellerClubProvider } = await import('./resellerclub.provider.js');
          const resellerId = config['resellerId'] ?? registrar.apiKey;
          this.provider = new ResellerClubProvider(resellerId, registrar.apiSecret ?? registrar.apiKey);
          break;
        }
        default:
          this.provider = new SimulatedRegistrarProvider();
      }
    } else {
      this.provider = new SimulatedRegistrarProvider();
    }

    return this.provider;
  }

  resetProvider() {
    this.provider = null;
  }

  /**
   * Search for available domains matching a query.
   */
  async searchDomains(
    query: string,
    tlds: string[] = [],
  ): Promise<DomainSearchResult[]> {
    const provider = await this.getProvider();
    return provider.searchDomains(query, tlds);
  }

  /**
   * Check availability of a specific domain.
   */
  async checkAvailability(domain: string): Promise<DomainSearchResult> {
    const provider = await this.getProvider();
    return provider.checkAvailability(domain);
  }

  /**
   * Register a domain.
   * Creates a record in domainRegistrations and calls the registrar API.
   */
  async registerDomain(
    domain: string,
    years: number,
    contact: DomainContact,
    accountId: string,
  ): Promise<typeof domainRegistrations.$inferSelect> {
    const provider = await this.getProvider();

    // Find the active registrar for the DB reference
    const registrar = await db.query.domainRegistrars.findFirst({
      where: eq(domainRegistrars.enabled, true),
    });

    if (!registrar) {
      throw new Error('No domain registrar configured. Please configure one in settings.');
    }

    // Check availability first
    const availability = await provider.checkAvailability(domain);
    if (!availability.available) {
      throw new Error(`Domain ${domain} is not available for registration`);
    }

    // Register with the provider
    const result = await provider.registerDomain(domain, years, contact);

    // Create the registration record
    const [registration] = await insertReturning(domainRegistrations, {
      accountId,
      registrarId: registrar.id,
      domain,
      status: 'active',
      registeredAt: new Date(),
      expiresAt: result.expiresAt,
      autoRenew: true,
      registrarDomainId: result.registrarDomainId,
    });

    return registration!;
  }

  /**
   * Get info about a registered domain.
   */
  async getDomainInfo(domain: string): Promise<DomainInfo> {
    const provider = await this.getProvider();
    return provider.getDomainInfo(domain);
  }

  /**
   * Renew a domain registration.
   */
  async renewDomain(
    registrationId: string,
    years: number = 1,
  ): Promise<typeof domainRegistrations.$inferSelect> {
    const registration = await db.query.domainRegistrations.findFirst({
      where: eq(domainRegistrations.id, registrationId),
    });

    if (!registration) {
      throw new Error('Domain registration not found');
    }

    const provider = await this.getProvider();

    if (!registration.registrarDomainId) {
      throw new Error('Registration has no registrar domain ID');
    }

    const result = await provider.renewDomain(
      registration.registrarDomainId,
      years,
    );

    const [updated] = await updateReturning(
      domainRegistrations,
      { expiresAt: result.expiresAt },
      eq(domainRegistrations.id, registrationId),
    );

    return updated!;
  }

  /**
   * List all domain registrations for an account.
   */
  async listRegistrations(accountId: string) {
    return db.query.domainRegistrations.findMany({
      where: eq(domainRegistrations.accountId, accountId),
      orderBy: (r, { desc }) => desc(r.createdAt),
    });
  }
}

export const registrarService = new RegistrarService();
