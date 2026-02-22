import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { db, domainRegistrars, domainRegistrations, insertReturning, updateReturning, eq } from '@fleet/db';
import { decrypt } from './crypto.service.js';
import { logger } from './logger.js';

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
  setNameservers(domain: string, nameservers: string[]): Promise<void>;
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

  private async isDomainRegistered(domain: string): Promise<boolean> {
    // Check local DB first
    const existing = await db.query.domainRegistrations.findFirst({
      where: eq(domainRegistrations.domain, domain),
    });
    if (existing) return true;

    // Check DNS for NS or A records to determine if the domain is registered
    try {
      await dns.resolveNs(domain);
      return true; // Has NS records → registered
    } catch {
      // NXDOMAIN or SERVFAIL — try A record as fallback
      try {
        await dns.resolve4(domain);
        return true; // Has A records → registered
      } catch {
        return false; // No DNS records → likely available
      }
    }
  }

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

    // Check all domains in parallel for faster results
    const checks = effectiveTlds.map(async (tld) => {
      const domain = `${cleaned}.${tld}`;
      const prices = this.tldPrices[tld];
      const registered = await this.isDomainRegistered(domain);

      return {
        domain,
        available: !registered,
        premium: false,
        price: prices
          ? {
              registration: prices.registration,
              renewal: prices.renewal,
              currency: 'USD',
            }
          : null,
      } satisfies DomainSearchResult;
    });

    return Promise.all(checks);
  }

  async checkAvailability(domain: string): Promise<DomainSearchResult> {
    const tld = domain.split('.').slice(1).join('.');
    const prices = this.tldPrices[tld];
    const registered = await this.isDomainRegistered(domain);

    return {
      domain,
      available: !registered,
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
    logger.warn({ domain }, 'Domain registration SIMULATED - no real registrar configured');
    // In a real implementation, this would call the registrar's API
    const registrarDomainId = `sim-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
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

  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    logger.info({ domain, nameservers }, 'Simulated: setNameservers');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Registrar Service
// ────────────────────────────────────────────────────────────────────────────

export class RegistrarService {
  private provider: RegistrarProvider | null = null;
  private providerLoadedAt: number = 0;
  private static PROVIDER_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get or create the configured registrar provider.
   * In production, this would look at the domainRegistrars table for the
   * enabled registrar and instantiate the appropriate API client.
   * The provider is cached with a TTL so configuration changes take effect.
   */
  async getProvider(): Promise<RegistrarProvider> {
    const now = Date.now();
    if (this.provider && (now - this.providerLoadedAt) < RegistrarService.PROVIDER_TTL) {
      return this.provider;
    }

    // Check if there's an enabled registrar configured in DB
    const registrar = await db.query.domainRegistrars.findFirst({
      where: eq(domainRegistrars.enabled, true),
    });

    if (registrar) {
      const config = (registrar.config ?? {}) as Record<string, string>;
      const decryptedKey = decrypt(registrar.apiKey);
      const decryptedSecret = registrar.apiSecret ? decrypt(registrar.apiSecret) : null;
      switch (registrar.provider) {
        case 'resellerclub': {
          const { ResellerClubProvider } = await import('./resellerclub.provider.js');
          const resellerId = config['resellerId'] ?? decryptedKey;
          this.provider = new ResellerClubProvider(resellerId, decryptedSecret ?? decryptedKey, {
            customerId: config['customerId'],
            sandbox: config['sandbox'] === 'true',
          });
          break;
        }
        case 'namecom': {
          const { NamecomProvider } = await import('./namecom.provider.js');
          this.provider = new NamecomProvider(decryptedKey, decryptedSecret ?? '', {
            sandbox: config['sandbox'] === 'true',
          });
          break;
        }
        default:
          this.provider = new SimulatedRegistrarProvider();
      }
    } else {
      this.provider = new SimulatedRegistrarProvider();
    }

    // Log a warning if falling back to simulated provider in production
    if (this.provider.name === 'simulated' && process.env['NODE_ENV'] === 'production') {
      logger.error('No real domain registrar configured! Domain operations will be simulated. Set up a registrar provider in platform settings.');
    }

    this.providerLoadedAt = now;
    return this.provider;
  }

  resetProvider() {
    this.provider = null;
    this.providerLoadedAt = 0;
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
   * Update nameservers for a domain at the registrar.
   */
  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    const provider = await this.getProvider();
    await provider.setNameservers(domain, nameservers);
    logger.info({ domain, nameservers, provider: provider.name }, 'Nameservers updated at registrar');
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
