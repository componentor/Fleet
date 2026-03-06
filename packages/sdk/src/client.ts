import { FleetApiError } from './errors.js';
import { ServiceResource } from './resources/services.js';
import { DeploymentResource } from './resources/deployments.js';
import { DnsZoneResource, DnsRecordResource } from './resources/dns.js';
import { DomainResource } from './resources/domains.js';
import type { FleetClientOptions, RequestFn } from './types.js';

export class FleetClient {
  readonly services: ServiceResource;
  readonly deployments: DeploymentResource;
  readonly dns: { zones: DnsZoneResource; records: DnsRecordResource };
  readonly domains: DomainResource;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly accountId?: string;
  private readonly _fetch: typeof globalThis.fetch;

  constructor(options: FleetClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.accountId = options.accountId;
    this._fetch = options.fetch ?? globalThis.fetch.bind(globalThis);

    const req: RequestFn = this.request.bind(this);
    this.services = new ServiceResource(req);
    this.deployments = new DeploymentResource(req);
    this.dns = {
      zones: new DnsZoneResource(req),
      records: new DnsRecordResource(req),
    };
    this.domains = new DomainResource(req);
  }

  /** Make an authenticated request to the Fleet API. */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
    };

    if (this.accountId) {
      headers['X-Account-Id'] = this.accountId;
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await this._fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorBody: unknown;
      let message = response.statusText;
      let code: string | undefined;

      try {
        errorBody = await response.json();
        const eb = errorBody as Record<string, unknown>;
        if (typeof eb.message === 'string') message = eb.message;
        else if (typeof eb.error === 'string') message = eb.error;
        if (typeof eb.code === 'string') code = eb.code;
      } catch {
        // response body wasn't JSON
      }

      throw new FleetApiError(response.status, message, errorBody, code);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }
}
