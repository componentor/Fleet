import type { Readable } from 'node:stream';

// ── Shared types (orchestrator-agnostic) ──

export interface CreateServiceOptions {
  name: string;
  image: string;
  replicas: number;
  env: Record<string, string>;
  ports: Array<{ target: number; published: number; protocol?: string }>;
  volumes: Array<{ source: string; target: string; readonly?: boolean }>;
  labels: Record<string, string>;
  constraints: string[];
  cpuLimit?: number;
  memoryLimit?: number;
  healthCheck?: {
    cmd: string;
    interval: number;
    timeout: number;
    retries: number;
  };
  updateParallelism: number;
  updateDelay: string;
  rollbackOnFailure: boolean;
  networkId?: string;
  networkIds?: string[];
  readOnly?: boolean;
  user?: string;
  storageLimitMb?: number;
  restartCondition?: 'none' | 'on-failure' | 'any';
  restartMaxAttempts?: number;
  restartDelay?: string;
  registryAuth?: { username: string; password: string; serveraddress: string };
}

export interface ContainerStats {
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  pids: number;
}

export interface ServiceTaskInfo {
  id: string;
  nodeId: string;
  status: string;
  desiredState: string;
  message: string;
  error?: string;
  containerStatus?: {
    containerId: string;
    pid: number;
    exitCode?: number;
  };
  createdAt: string;
}

export interface RegistryAuth {
  username: string;
  password: string;
  serveraddress: string;
}

export interface RunOnNodesResult {
  success: boolean;
  results: Array<{ nodeId: string; status: string; error?: string }>;
}

export interface OneOffServiceOptions {
  name: string;
  image: string;
  cmd: string[];
  env?: Record<string, string>;
  labels?: Record<string, string>;
  mounts?: Array<{ source: string; target: string; readonly?: boolean }>;
  memoryLimitMb?: number;
  restartCondition?: 'none' | 'on-failure' | 'any';
  networkIds?: string[];
}

// ── The orchestrator interface ──

export interface OrchestratorService {
  // ── Service lifecycle ──

  createService(opts: CreateServiceOptions): Promise<{ id: string }>;

  updateService(
    serviceId: string,
    opts: Partial<CreateServiceOptions>,
    registryAuth?: RegistryAuth,
  ): Promise<void>;

  removeService(serviceId: string): Promise<void>;

  inspectService(serviceId: string): Promise<any>;

  listServices(filters?: Record<string, string[]>): Promise<any[]>;

  scaleService(serviceId: string, replicas: number): Promise<void>;

  waitForServiceTasksGone(serviceId: string, timeoutMs?: number): Promise<void>;

  forceRemoveServiceContainers(serviceId: string): Promise<void>;

  // ── Tasks / Pods ──

  listTasks(filters?: Record<string, string[]>): Promise<any[]>;

  getServiceTasks(serviceId: string): Promise<ServiceTaskInfo[]>;

  // ── Container operations ──

  inspectContainer(containerId: string): Promise<any>;

  getContainerStats(containerId: string): Promise<ContainerStats | null>;

  getContainerNetworkBytes(
    containerId: string,
  ): Promise<{ containerId: string; rxBytes: number; txBytes: number } | null>;

  pruneServiceContainers(serviceId: string): Promise<number>;

  pruneDeadContainers(): Promise<number>;

  // ── Logging ──

  getServiceLogs(
    serviceId: string,
    opts?: { tail?: number; since?: number; follow?: boolean },
  ): Promise<Buffer | NodeJS.ReadableStream>;

  getContainerLogs(
    containerId: string,
    opts?: { tail?: number; since?: number; follow?: boolean; timestamps?: boolean },
  ): Promise<Buffer | NodeJS.ReadableStream>;

  // ── Port management ──

  getUsedIngressPorts(): Promise<Set<number>>;

  allocateIngressPorts(
    targetPorts: Array<{ target: number; protocol: string }>,
  ): Promise<Array<{ target: number; published: number; protocol: string }>>;

  // ── Exec operations ──

  execInContainer(
    containerId: string,
    cmd?: string[],
  ): Promise<{ stream: NodeJS.ReadWriteStream; execId: string }>;

  execCommand(
    containerId: string,
    cmd: string[],
    timeoutMs?: number,
    env?: string[],
  ): Promise<{ stdout: string; exitCode: number }>;

  execCommandStream(
    containerId: string,
    cmd: string[],
    timeoutMs?: number,
    env?: string[],
  ): Promise<{ stream: Readable; exec?: any }>;

  execCommandWithInput(
    containerId: string,
    cmd: string[],
    input: Readable,
    timeoutMs?: number,
    env?: string[],
  ): Promise<{ exitCode: number; stderr: string }>;

  resizeExec(execId: string, h: number, w: number): Promise<void>;

  // ── Node-aware exec routing ──

  nodeAwareExecCommand(
    containerId: string,
    nodeId: string,
    cmd: string[],
    timeoutMs?: number,
    env?: string[],
  ): Promise<{ stdout: string; exitCode: number }>;

  nodeAwareExecCommandStream(
    containerId: string,
    nodeId: string,
    cmd: string[],
    timeoutMs?: number,
    env?: string[],
  ): Promise<{ stream: Readable; exec?: any }>;

  nodeAwareExecCommandWithInput(
    containerId: string,
    nodeId: string,
    cmd: string[],
    input: Readable,
    timeoutMs?: number,
    env?: string[],
  ): Promise<{ stdout: string; stderr?: string; exitCode: number }>;

  getLocalNodeId(): Promise<string>;

  getAgentAddress(nodeId: string): Promise<string | null>;

  // ── Node management ──

  listNodes(): Promise<any[]>;

  inspectNode(nodeId: string): Promise<any>;

  updateNode(
    nodeId: string,
    opts: {
      availability?: 'active' | 'pause' | 'drain';
      role?: 'manager' | 'worker';
      labels?: Record<string, string>;
    },
  ): Promise<void>;

  drainNode(nodeId: string): Promise<void>;

  activateNode(nodeId: string): Promise<void>;

  removeNode(nodeId: string, force?: boolean): Promise<void>;

  // ── Cluster info ──

  getClusterInfo(): Promise<any>;

  getJoinToken(): Promise<{ worker: string; manager: string }>;

  configureTaskHistoryLimit(limit?: number): Promise<void>;

  // ── Network management ──

  ensureNetwork(name: string): Promise<string>;

  createNetwork(name: string, labels?: Record<string, string>): Promise<string>;

  inspectNetwork(networkId: string): Promise<{ Name: string; Id: string; Driver: string; Scope: string }>;

  removeNetwork(networkId: string): Promise<void>;

  // ── Volume management ──

  copyVolumeData(sourceVolume: string, targetVolume: string): Promise<void>;

  cleanVolume(volumeName: string): Promise<void>;

  removeVolume(name: string): Promise<boolean>;

  removeDockerVolumeOnAllNodes(volumeName: string): Promise<void>;

  // ── Host-level operations ──

  runOnAllNodes(command: string, opts?: { timeoutMs?: number }): Promise<RunOnNodesResult>;

  runOnAllNodesPrivileged(command: string, opts?: { timeoutMs?: number }): Promise<RunOnNodesResult>;

  runOnLocalHost(command: string, opts?: { timeoutMs?: number }): Promise<{ exitCode: number; stdout: string }>;

  // ── Platform storage management ──

  getPlatformVolumeMode(): Promise<'local' | 'distributed'>;

  updatePlatformVolumeMounts(mode: 'distributed' | 'local'): Promise<{ applied: boolean; message: string }>;

  ensureServiceVolumeMount(): Promise<{ applied: boolean; message: string }>;

  // ── One-off services (for self-healing, etc.) ──

  createOneOffService(opts: OneOffServiceOptions): Promise<{ id: string }>;

  pollTaskCompletion(serviceId: string, timeoutMs?: number): Promise<{ status: string; containerId?: string }>;

  removeOneOffService(serviceId: string): Promise<void>;
}
