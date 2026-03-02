import type { OrchestratorService } from './orchestrator.interface.js';

export type OrchestratorType = 'swarm' | 'kubernetes';

// ── Instances ──

let swarmInstance: OrchestratorService | null = null;
let k8sInstance: OrchestratorService | null = null;
let defaultType: OrchestratorType = (process.env['ORCHESTRATOR'] as OrchestratorType) ?? 'swarm';

/**
 * The default orchestrator instance — for backward compat.
 * Routes that don't resolve per-service can use this directly.
 */
export let orchestrator: OrchestratorService;

// ── Initialization ──

/**
 * Initialize both orchestrator backends.
 * Swarm is always available (runs on Docker host). K8s is optional.
 * Must be called during application boot before routes are registered.
 */
export async function initOrchestrator(): Promise<void> {
  // Always init Swarm (Docker is always present)
  const { dockerService } = await import('./docker.service.js');
  swarmInstance = dockerService;

  // Try to init K8s (only works if kubeconfig is available)
  try {
    const { KubernetesService } = await import('./kubernetes.service.js');
    k8sInstance = new KubernetesService();
  } catch {
    // K8s client not available — that's fine, Swarm-only mode
  }

  // Set the default based on env var
  orchestrator = defaultType === 'kubernetes' && k8sInstance
    ? k8sInstance
    : swarmInstance;
}

// ── Resolvers ──

/**
 * Get orchestrator by type. Falls back to default if type not available.
 * Use this in routes that know which orchestrator a service is on.
 */
export function getOrchestrator(type?: OrchestratorType | null): OrchestratorService {
  if (type === 'kubernetes' && k8sInstance) return k8sInstance;
  if (type === 'swarm' && swarmInstance) return swarmInstance;
  return orchestrator;
}

/** Returns the platform-wide default orchestrator type. */
export function getDefaultOrchestratorType(): OrchestratorType {
  return defaultType;
}

/**
 * Returns the current orchestrator type.
 * @deprecated Use getDefaultOrchestratorType() for clarity.
 */
export function getOrchestratorType(): OrchestratorType {
  return defaultType;
}

// ── Runtime configuration ──

/**
 * Update the default orchestrator type at runtime.
 * Called when admin changes the platform orchestrator setting via UI.
 */
export function setDefaultOrchestratorType(type: OrchestratorType): void {
  defaultType = type;
  if (type === 'kubernetes' && k8sInstance) {
    orchestrator = k8sInstance;
  } else if (swarmInstance) {
    orchestrator = swarmInstance;
    defaultType = 'swarm';
  }
}

/** Check if Kubernetes is available (kubeconfig found, client initialized). */
export function isKubernetesAvailable(): boolean {
  return k8sInstance !== null;
}

/** Check if Swarm is available. */
export function isSwarmAvailable(): boolean {
  return swarmInstance !== null;
}

/** Get all available orchestrator types. */
export function getAvailableOrchestrators(): OrchestratorType[] {
  const available: OrchestratorType[] = [];
  if (swarmInstance) available.push('swarm');
  if (k8sInstance) available.push('kubernetes');
  return available;
}

/**
 * Re-attempt initialization of both backends.
 * Call after installing a new orchestrator (k3s or Docker) at runtime.
 */
export async function reloadOrchestrators(): Promise<void> {
  // Try Swarm
  if (!swarmInstance) {
    try {
      const { dockerService } = await import('./docker.service.js');
      swarmInstance = dockerService;
    } catch { /* Docker not available */ }
  }

  // Try K8s
  if (!k8sInstance) {
    try {
      const { KubernetesService } = await import('./kubernetes.service.js');
      k8sInstance = new KubernetesService();
    } catch { /* kubeconfig not available */ }
  }

  // Update the default orchestrator export
  if (defaultType === 'kubernetes' && k8sInstance) {
    orchestrator = k8sInstance;
  } else if (swarmInstance) {
    orchestrator = swarmInstance;
  }
}
