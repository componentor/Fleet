import type { OrchestratorService } from './orchestrator.interface.js';

/**
 * Kubernetes orchestrator implementation (Phase 2).
 * Stub — will be implemented when K8s migration begins.
 */
export class KubernetesService implements OrchestratorService {
  constructor() {
    throw new Error(
      'KubernetesService is not yet implemented. Set ORCHESTRATOR=swarm or omit the variable.',
    );
  }

  // All methods throw at runtime since the constructor prevents instantiation.
  // TypeScript is satisfied by the constructor signature + implements clause.
  createService(): any { throw new Error('Not implemented'); }
  updateService(): any { throw new Error('Not implemented'); }
  removeService(): any { throw new Error('Not implemented'); }
  inspectService(): any { throw new Error('Not implemented'); }
  listServices(): any { throw new Error('Not implemented'); }
  scaleService(): any { throw new Error('Not implemented'); }
  waitForServiceTasksGone(): any { throw new Error('Not implemented'); }
  forceRemoveServiceContainers(): any { throw new Error('Not implemented'); }
  listTasks(): any { throw new Error('Not implemented'); }
  getServiceTasks(): any { throw new Error('Not implemented'); }
  inspectContainer(): any { throw new Error('Not implemented'); }
  getContainerStats(): any { throw new Error('Not implemented'); }
  getContainerNetworkBytes(): any { throw new Error('Not implemented'); }
  pruneServiceContainers(): any { throw new Error('Not implemented'); }
  pruneDeadContainers(): any { throw new Error('Not implemented'); }
  getServiceLogs(): any { throw new Error('Not implemented'); }
  getUsedIngressPorts(): any { throw new Error('Not implemented'); }
  allocateIngressPorts(): any { throw new Error('Not implemented'); }
  execInContainer(): any { throw new Error('Not implemented'); }
  execCommand(): any { throw new Error('Not implemented'); }
  execCommandStream(): any { throw new Error('Not implemented'); }
  execCommandWithInput(): any { throw new Error('Not implemented'); }
  resizeExec(): any { throw new Error('Not implemented'); }
  nodeAwareExecCommand(): any { throw new Error('Not implemented'); }
  nodeAwareExecCommandStream(): any { throw new Error('Not implemented'); }
  nodeAwareExecCommandWithInput(): any { throw new Error('Not implemented'); }
  getLocalNodeId(): any { throw new Error('Not implemented'); }
  getAgentAddress(): any { throw new Error('Not implemented'); }
  listNodes(): any { throw new Error('Not implemented'); }
  inspectNode(): any { throw new Error('Not implemented'); }
  updateNode(): any { throw new Error('Not implemented'); }
  drainNode(): any { throw new Error('Not implemented'); }
  activateNode(): any { throw new Error('Not implemented'); }
  removeNode(): any { throw new Error('Not implemented'); }
  getClusterInfo(): any { throw new Error('Not implemented'); }
  getJoinToken(): any { throw new Error('Not implemented'); }
  configureTaskHistoryLimit(): any { throw new Error('Not implemented'); }
  ensureNetwork(): any { throw new Error('Not implemented'); }
  createNetwork(): any { throw new Error('Not implemented'); }
  inspectNetwork(): any { throw new Error('Not implemented'); }
  removeNetwork(): any { throw new Error('Not implemented'); }
  copyVolumeData(): any { throw new Error('Not implemented'); }
  cleanVolume(): any { throw new Error('Not implemented'); }
  removeVolume(): any { throw new Error('Not implemented'); }
  removeDockerVolumeOnAllNodes(): any { throw new Error('Not implemented'); }
  runOnAllNodes(): any { throw new Error('Not implemented'); }
  runOnAllNodesPrivileged(): any { throw new Error('Not implemented'); }
  runOnLocalHost(): any { throw new Error('Not implemented'); }
  getPlatformVolumeMode(): any { throw new Error('Not implemented'); }
  updatePlatformVolumeMounts(): any { throw new Error('Not implemented'); }
  ensureServiceVolumeMount(): any { throw new Error('Not implemented'); }
  createOneOffService(): any { throw new Error('Not implemented'); }
  pollTaskCompletion(): any { throw new Error('Not implemented'); }
  removeOneOffService(): any { throw new Error('Not implemented'); }
}
