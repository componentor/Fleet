import type { RequestFn } from '../types.js';

export interface SharedDomain {
  id: string;
  domain: string;
  verified: boolean;
  createdAt: string;
}

export class DomainResource {
  constructor(private request: RequestFn) {}

  /** List shared domains available to the account. */
  async list(): Promise<SharedDomain[]> {
    return this.request<SharedDomain[]>('GET', '/shared-domains');
  }
}
