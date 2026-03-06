import type { Service } from '@fleet/types';
import type { RequestFn, CreateServiceInput, UpdateServiceInput, LogsOptions } from '../types.js';

export class ServiceResource {
  constructor(private request: RequestFn) {}

  /** List all services in the account. */
  async list(): Promise<Service[]> {
    return this.request<Service[]>('GET', '/services');
  }

  /** Get a service by ID. */
  async get(id: string): Promise<Service> {
    return this.request<Service>('GET', `/services/${id}`);
  }

  /** Create a new service. */
  async create(input: CreateServiceInput): Promise<Service> {
    return this.request<Service>('POST', '/services', input);
  }

  /** Update an existing service. */
  async update(id: string, input: UpdateServiceInput): Promise<Service> {
    return this.request<Service>('PATCH', `/services/${id}`, input);
  }

  /** Delete a service. */
  async delete(id: string, opts?: { deleteVolumeNames?: string[] }): Promise<void> {
    return this.request<void>('DELETE', `/services/${id}`, opts);
  }

  /** Restart a service (recreate all containers). */
  async restart(id: string): Promise<{ message: string }> {
    return this.request('POST', `/services/${id}/restart`);
  }

  /** Stop a service (scale to 0). */
  async stop(id: string): Promise<{ message: string }> {
    return this.request('POST', `/services/${id}/stop`);
  }

  /** Start a stopped service. */
  async start(id: string): Promise<{ message: string }> {
    return this.request('POST', `/services/${id}/start`);
  }

  /** Redeploy a service (pull latest image and restart). */
  async redeploy(id: string): Promise<{ message: string }> {
    return this.request('POST', `/services/${id}/redeploy`);
  }

  /** Get service logs. */
  async logs(id: string, opts?: LogsOptions): Promise<{ logs: string }> {
    const params = new URLSearchParams();
    if (opts?.tail) params.set('tail', String(opts.tail));
    const qs = params.toString();
    return this.request('GET', `/services/${id}/logs${qs ? `?${qs}` : ''}`);
  }
}
