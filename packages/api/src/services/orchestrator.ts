import type { OrchestratorService } from './orchestrator.interface.js';

const ORCHESTRATOR = process.env['ORCHESTRATOR'] ?? 'swarm';

/** The active orchestrator instance — initialized at startup via initOrchestrator(). */
export let orchestrator: OrchestratorService;

/**
 * Initialize the orchestrator based on the ORCHESTRATOR env var.
 * Must be called during application boot before any routes are registered.
 */
export async function initOrchestrator(): Promise<void> {
  if (ORCHESTRATOR === 'kubernetes') {
    const { KubernetesService } = await import('./kubernetes.service.js');
    orchestrator = new KubernetesService();
  } else {
    const { dockerService } = await import('./docker.service.js');
    orchestrator = dockerService;
  }
}

/** Returns the current orchestrator type. */
export function getOrchestratorType(): 'swarm' | 'kubernetes' {
  return ORCHESTRATOR as 'swarm' | 'kubernetes';
}
