import type { Deployment, DeploymentStatus } from '@fleet/types';
import type { RequestFn, WaitOptions } from '../types.js';

export class DeploymentResource {
  constructor(private request: RequestFn) {}

  /** List deployments for a service. */
  async list(serviceId: string): Promise<Deployment[]> {
    const data = await this.request<{ deployments: Deployment[] }>(
      'GET',
      `/services/${serviceId}/deployments`,
    );
    return data.deployments ?? (data as unknown as Deployment[]);
  }

  /** Get a specific deployment. */
  async get(serviceId: string, deploymentId: string): Promise<Deployment> {
    const deployments = await this.list(serviceId);
    const dep = deployments.find((d) => d.id === deploymentId);
    if (!dep) throw new Error(`Deployment ${deploymentId} not found`);
    return dep;
  }

  /**
   * Poll until a deployment reaches a terminal state (`succeeded` or `failed`).
   * Returns the final deployment object.
   *
   * @throws if the timeout is exceeded.
   */
  async waitUntilReady(
    serviceId: string,
    deploymentId: string,
    opts?: WaitOptions,
  ): Promise<Deployment> {
    const interval = opts?.intervalMs ?? 3_000;
    const timeout = opts?.timeoutMs ?? 120_000;
    const terminal: DeploymentStatus[] = ['succeeded', 'failed'];
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const dep = await this.get(serviceId, deploymentId);
      if (terminal.includes(dep.status)) return dep;
      await new Promise((r) => setTimeout(r, interval));
    }

    throw new Error(
      `Deployment ${deploymentId} did not complete within ${timeout}ms`,
    );
  }
}
