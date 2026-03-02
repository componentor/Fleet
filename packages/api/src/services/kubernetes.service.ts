import * as k8s from '@kubernetes/client-node';
import { Readable, PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { exec as cpExec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from './logger.js';
import type {
  OrchestratorService,
  CreateServiceOptions,
  ContainerStats,
  ServiceTaskInfo,
  RegistryAuth,
  RunOnNodesResult,
  OneOffServiceOptions,
} from './orchestrator.interface.js';

const execAsync = promisify(cpExec);

// ── Constants ──

const SYSTEM_NS = 'fleet-system';
const LABEL_MANAGED = 'fleet.io/managed';
const LABEL_SERVICE_ID = 'fleet.io/service-id';
const LABEL_ACCOUNT_ID = 'fleet.io/account-id';
const LABEL_ONEOFF = 'fleet.io/oneoff';
const NODEPORT_MIN = 30000;
const NODEPORT_MAX = 32767;
const STORAGE_CLASS = 'fleet-default';

// ── Helpers ──

/** Parse "namespace/podName" container ID format used in K8s mode. */
function parsePodId(containerId: string): { namespace: string; pod: string; container?: string } {
  const parts = containerId.split('/');
  if (parts.length === 3) return { namespace: parts[0]!, pod: parts[1]!, container: parts[2] };
  if (parts.length === 2) return { namespace: parts[0]!, pod: parts[1]! };
  // Fallback: assume fleet-system namespace
  return { namespace: SYSTEM_NS, pod: containerId };
}

/** Convert our labels Record to K8s labelSelector string. */
function toLabelSelector(labels: Record<string, string>): string {
  return Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(',');
}

/** Build namespace name from network name (fleet-account-{id} → fleet-account-{id}). */
function networkToNamespace(name: string): string {
  // Network names are already suitable as namespace names
  return name.replace(/_/g, '-').toLowerCase();
}

/** Map K8s pod phase to Swarm-compatible task status. */
function podPhaseToStatus(phase?: string): string {
  switch (phase) {
    case 'Running': return 'running';
    case 'Pending': return 'preparing';
    case 'Succeeded': return 'complete';
    case 'Failed': return 'failed';
    default: return 'unknown';
  }
}

/** Convert CPU nanoCPUs (e.g. 1e9) to K8s CPU string (e.g. "1000m"). */
function cpuToK8s(nanoCpus: number): string {
  return `${Math.round(nanoCpus * 1000)}m`;
}

/** Convert memory in MB to K8s memory string (e.g. "512Mi"). */
function memoryToK8s(mb: number): string {
  return `${mb}Mi`;
}

/** Convert Swarm constraints to K8s nodeSelector. */
function constraintsToNodeSelector(constraints: string[]): Record<string, string> {
  const selector: Record<string, string> = {};
  for (const c of constraints) {
    // Swarm: "node.role==manager" → K8s: node-role.kubernetes.io/control-plane=true
    const match = c.match(/^node\.([\w.]+)\s*==\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      if (key === 'role' && value === 'manager') {
        selector['node-role.kubernetes.io/control-plane'] = 'true';
      } else if (key === 'role' && value === 'worker') {
        // Workers just don't have control-plane label — skip
      } else if (key?.startsWith('labels.')) {
        selector[key.replace('labels.', '')] = value!;
      }
    }
  }
  return selector;
}

// ── KubernetesService ──

export class KubernetesService implements OrchestratorService {
  private kc: k8s.KubeConfig;
  private coreApi: k8s.CoreV1Api;
  private appsApi: k8s.AppsV1Api;
  private batchApi: k8s.BatchV1Api;
  private customApi: k8s.CustomObjectsApi;
  private k8sExec: k8s.Exec;
  private k8sLog: k8s.Log;

  constructor() {
    this.kc = new k8s.KubeConfig();

    // Load config: in-cluster when running as a pod, or default kubeconfig for dev
    try {
      this.kc.loadFromCluster();
    } catch {
      this.kc.loadFromDefault();
    }

    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.batchApi = this.kc.makeApiClient(k8s.BatchV1Api);
    this.customApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
    this.k8sExec = new k8s.Exec(this.kc);
    this.k8sLog = new k8s.Log(this.kc);

    logger.info('KubernetesService initialized');
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Service Lifecycle
  // ══════════════════════════════════════════════════════════════════════

  async createService(opts: CreateServiceOptions): Promise<{ id: string }> {
    const namespace = opts.networkId
      ? networkToNamespace(opts.networkId)
      : opts.networkIds?.[0]
        ? networkToNamespace(opts.networkIds[0])
        : SYSTEM_NS;

    // Ensure namespace exists
    await this.ensureNamespace(namespace);

    const name = opts.name;
    const labels: Record<string, string> = {
      [LABEL_MANAGED]: 'true',
      [LABEL_SERVICE_ID]: name,
      ...opts.labels,
    };

    // Create imagePullSecret if registry auth is provided
    let imagePullSecretName: string | undefined;
    if (opts.registryAuth) {
      imagePullSecretName = `regcred-${name}`;
      await this.ensureImagePullSecret(namespace, imagePullSecretName, opts.registryAuth);
    }

    // Create PVCs for volumes
    for (const vol of opts.volumes) {
      await this.ensurePVC(namespace, vol.source, labels);
    }

    // Build the Deployment
    const deployment: k8s.V1Deployment = {
      metadata: { name, namespace, labels },
      spec: {
        replicas: opts.replicas,
        selector: { matchLabels: { [LABEL_SERVICE_ID]: name } },
        strategy: {
          type: 'RollingUpdate',
          rollingUpdate: {
            maxSurge: opts.updateParallelism > 0 ? opts.updateParallelism : 1,
            maxUnavailable: 0,
          },
        },
        revisionHistoryLimit: opts.rollbackOnFailure ? 10 : 2,
        template: {
          metadata: { labels: { [LABEL_SERVICE_ID]: name, ...opts.labels } },
          spec: {
            containers: [{
              name: 'app',
              image: opts.image,
              env: Object.entries(opts.env).map(([k, v]) => ({ name: k, value: v })),
              ports: opts.ports.map((p) => ({
                containerPort: p.target,
                protocol: (p.protocol?.toUpperCase() ?? 'TCP') as 'TCP' | 'UDP' | 'SCTP',
              })),
              volumeMounts: opts.volumes.map((v) => ({
                name: `vol-${v.source}`,
                mountPath: v.target,
                readOnly: v.readonly ?? false,
              })),
              resources: {
                limits: {
                  ...(opts.cpuLimit ? { cpu: cpuToK8s(opts.cpuLimit) } : {}),
                  ...(opts.memoryLimit ? { memory: memoryToK8s(opts.memoryLimit) } : {}),
                },
              },
              securityContext: {
                ...(opts.readOnly ? { readOnlyRootFilesystem: true } : {}),
                ...(opts.user ? { runAsUser: parseInt(opts.user, 10) || undefined } : {}),
              },
              ...(opts.healthCheck ? {
                livenessProbe: this.buildProbe(opts.healthCheck),
                startupProbe: this.buildProbe(opts.healthCheck, true),
              } : {}),
            }],
            volumes: opts.volumes.map((v) => ({
              name: `vol-${v.source}`,
              persistentVolumeClaim: { claimName: v.source, readOnly: v.readonly ?? false },
            })),
            nodeSelector: opts.constraints.length > 0
              ? constraintsToNodeSelector(opts.constraints)
              : undefined,
            restartPolicy: 'Always',
            imagePullSecrets: imagePullSecretName
              ? [{ name: imagePullSecretName }]
              : undefined,
          },
        },
      },
    };

    const created = await this.appsApi.createNamespacedDeployment({ namespace, body: deployment });
    const deploymentName = created?.metadata?.name ?? name;

    // Create a ClusterIP Service for internal routing (+ NodePort for published ports)
    if (opts.ports.length > 0) {
      const hasPublishedPorts = opts.ports.some((p) => p.published > 0);
      const svcSpec: k8s.V1Service = {
        metadata: { name, namespace, labels },
        spec: {
          type: hasPublishedPorts ? 'NodePort' : 'ClusterIP',
          selector: { [LABEL_SERVICE_ID]: name },
          ports: opts.ports.map((p) => ({
            name: `port-${p.target}`,
            port: p.target,
            targetPort: p.target,
            protocol: (p.protocol?.toUpperCase() ?? 'TCP') as 'TCP' | 'UDP' | 'SCTP',
            ...(hasPublishedPorts && p.published > 0 ? { nodePort: p.published } : {}),
          })),
        },
      };
      await this.coreApi.createNamespacedService({ namespace, body: svcSpec });
    }

    return { id: deploymentName };
  }

  async updateService(
    serviceId: string,
    opts: Partial<CreateServiceOptions>,
    registryAuth?: RegistryAuth,
  ): Promise<void> {
    const { namespace, name } = await this.findDeployment(serviceId);

    // Build the patch
    const patch: any = { spec: { template: { spec: { containers: [{ name: 'app' }] } } } };
    const container = patch.spec.template.spec.containers[0];

    if (opts.image) container.image = opts.image;

    if (opts.env) {
      container.env = Object.entries(opts.env).map(([k, v]) => ({ name: k, value: v }));
    }

    if (opts.replicas !== undefined) {
      patch.spec.replicas = opts.replicas;
    }

    if (opts.labels) {
      patch.metadata = { labels: opts.labels };
      patch.spec.template.metadata = { labels: { [LABEL_SERVICE_ID]: name, ...opts.labels } };
    }

    if (opts.ports) {
      container.ports = opts.ports.map((p) => ({
        containerPort: p.target,
        protocol: (p.protocol?.toUpperCase() ?? 'TCP') as 'TCP' | 'UDP' | 'SCTP',
      }));
    }

    if (opts.volumes) {
      // Ensure PVCs exist
      const labels = { [LABEL_MANAGED]: 'true', [LABEL_SERVICE_ID]: name };
      for (const vol of opts.volumes) {
        await this.ensurePVC(namespace, vol.source, labels);
      }
      container.volumeMounts = opts.volumes.map((v) => ({
        name: `vol-${v.source}`,
        mountPath: v.target,
        readOnly: v.readonly ?? false,
      }));
      patch.spec.template.spec.volumes = opts.volumes.map((v) => ({
        name: `vol-${v.source}`,
        persistentVolumeClaim: { claimName: v.source, readOnly: v.readonly ?? false },
      }));
    }

    if (opts.cpuLimit !== undefined || opts.memoryLimit !== undefined) {
      container.resources = {
        limits: {
          ...(opts.cpuLimit !== undefined ? { cpu: cpuToK8s(opts.cpuLimit) } : {}),
          ...(opts.memoryLimit !== undefined ? { memory: memoryToK8s(opts.memoryLimit) } : {}),
        },
      };
    }

    if (opts.readOnly !== undefined) {
      container.securityContext = { readOnlyRootFilesystem: opts.readOnly };
    }

    if (opts.user !== undefined) {
      container.securityContext = {
        ...(container.securityContext ?? {}),
        runAsUser: parseInt(opts.user, 10) || undefined,
      };
    }

    if (opts.constraints) {
      patch.spec.template.spec.nodeSelector = constraintsToNodeSelector(opts.constraints);
    }

    if (opts.healthCheck) {
      container.livenessProbe = this.buildProbe(opts.healthCheck);
    }

    if (opts.networkIds?.length) {
      // Move deployment to new namespace — requires recreate in K8s
      // For now, this is a no-op; networks are handled at namespace level
    }

    // Handle registry auth
    if (registryAuth || opts.registryAuth) {
      const auth = registryAuth ?? opts.registryAuth!;
      const secretName = `regcred-${name}`;
      await this.ensureImagePullSecret(namespace, secretName, auth);
      patch.spec.template.spec.imagePullSecrets = [{ name: secretName }];
    }

    await this.appsApi.patchNamespacedDeployment(
      { name, namespace, body: patch },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.StrategicMergePatch),
    );

    // Update the K8s Service if ports changed
    if (opts.ports) {
      try {
        const hasPublishedPorts = opts.ports.some((p) => p.published > 0);
        const svcPatch: any = {
          spec: {
            type: hasPublishedPorts ? 'NodePort' : 'ClusterIP',
            ports: opts.ports.map((p) => ({
              name: `port-${p.target}`,
              port: p.target,
              targetPort: p.target,
              protocol: (p.protocol?.toUpperCase() ?? 'TCP') as 'TCP' | 'UDP' | 'SCTP',
              ...(hasPublishedPorts && p.published > 0 ? { nodePort: p.published } : {}),
            })),
          },
        };
        await this.coreApi.patchNamespacedService(
          { name, namespace, body: svcPatch },
          k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.StrategicMergePatch),
        );
      } catch {
        // Service may not exist if deployment had no ports originally
      }
    }
  }

  async removeService(serviceId: string): Promise<void> {
    const { namespace, name } = await this.findDeployment(serviceId);

    // Delete Deployment (pods are garbage-collected via ownerReferences)
    try {
      await this.appsApi.deleteNamespacedDeployment({ name, namespace });
    } catch (err: any) {
      if (err?.statusCode !== 404) throw err;
    }

    // Delete associated K8s Service
    try {
      await this.coreApi.deleteNamespacedService({ name, namespace });
    } catch {
      // Service may not exist
    }

    // Delete imagePullSecret
    try {
      await this.coreApi.deleteNamespacedSecret({ name: `regcred-${name}`, namespace });
    } catch {
      // Secret may not exist
    }
  }

  async inspectService(serviceId: string): Promise<any> {
    const { namespace, name } = await this.findDeployment(serviceId);
    const deployment = await this.appsApi.readNamespacedDeployment({ name, namespace });
    // Return in a format compatible with what callers expect
    return {
      ID: deployment.metadata?.uid ?? serviceId,
      Version: { Index: deployment.metadata?.generation ?? 0 },
      CreatedAt: deployment.metadata?.creationTimestamp?.toISOString?.() ?? new Date().toISOString(),
      UpdatedAt: deployment.metadata?.creationTimestamp?.toISOString?.() ?? new Date().toISOString(),
      Spec: {
        Name: name,
        Mode: { Replicated: { Replicas: deployment.spec?.replicas ?? 1 } },
        TaskTemplate: {
          ContainerSpec: {
            Image: deployment.spec?.template?.spec?.containers?.[0]?.image ?? '',
            Env: deployment.spec?.template?.spec?.containers?.[0]?.env?.map(
              (e) => `${e.name}=${e.value ?? ''}`,
            ) ?? [],
          },
        },
        Labels: deployment.metadata?.labels ?? {},
      },
      // K8s-specific metadata
      _k8s: deployment,
    };
  }

  async listServices(filters?: Record<string, string[]>): Promise<any[]> {
    let labelSelector = `${LABEL_MANAGED}=true`;
    if (filters?.name?.length) {
      labelSelector += `,${LABEL_SERVICE_ID} in (${filters.name.join(',')})`;
    }
    if (filters?.label?.length) {
      for (const l of filters.label) {
        labelSelector += `,${l}`;
      }
    }

    // List across all namespaces
    const list = await this.appsApi.listDeploymentForAllNamespaces(
      { labelSelector },
    );

    // Map to Swarm-compatible format
    return (list?.items ?? []).map((d) => ({
      ID: d.metadata?.uid ?? d.metadata?.name,
      Version: { Index: d.metadata?.generation ?? 0 },
      Spec: {
        Name: d.metadata?.name,
        Mode: { Replicated: { Replicas: d.spec?.replicas ?? 1 } },
        TaskTemplate: {
          ContainerSpec: {
            Image: d.spec?.template?.spec?.containers?.[0]?.image ?? '',
            Env: d.spec?.template?.spec?.containers?.[0]?.env?.map(
              (e) => `${e.name}=${e.value ?? ''}`,
            ) ?? [],
            Mounts: d.spec?.template?.spec?.volumes?.map((v) => ({
              Source: v.persistentVolumeClaim?.claimName ?? v.name,
              Target: d.spec?.template?.spec?.containers?.[0]?.volumeMounts?.find(
                (m) => m.name === v.name,
              )?.mountPath ?? '',
              Type: v.persistentVolumeClaim ? 'volume' : 'bind',
              ReadOnly: v.persistentVolumeClaim?.readOnly ?? false,
            })) ?? [],
          },
        },
        Labels: d.metadata?.labels ?? {},
        EndpointSpec: { Ports: [] }, // Populated from K8s Service if needed
      },
    }));
  }

  async scaleService(serviceId: string, replicas: number): Promise<void> {
    const { namespace, name } = await this.findDeployment(serviceId);
    await this.appsApi.patchNamespacedDeployment(
      { name, namespace, body: { spec: { replicas } } },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch),
    );
  }

  async waitForServiceTasksGone(serviceId: string, timeoutMs = 15000): Promise<void> {
    const { namespace, name } = await this.findDeployment(serviceId).catch(() => ({
      namespace: SYSTEM_NS, name: serviceId,
    }));

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const pods = await this.coreApi.listNamespacedPod(
          { namespace, labelSelector: `${LABEL_SERVICE_ID}=${name}` },
        );
        if (!pods.items?.length) return;
      } catch {
        return; // Deployment/namespace gone
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async forceRemoveServiceContainers(serviceId: string): Promise<void> {
    const { namespace, name } = await this.findDeployment(serviceId).catch(() => ({
      namespace: SYSTEM_NS, name: serviceId,
    }));

    try {
      const pods = await this.coreApi.listNamespacedPod(
        { namespace, labelSelector: `${LABEL_SERVICE_ID}=${name}` },
      );
      for (const pod of pods.items ?? []) {
        try {
          await this.coreApi.deleteNamespacedPod(
            { name: pod.metadata!.name!, namespace, gracePeriodSeconds: 0 },
          );
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Tasks / Pods
  // ══════════════════════════════════════════════════════════════════════

  async listTasks(filters?: Record<string, string[]>): Promise<any[]> {
    let labelSelector = `${LABEL_MANAGED}=true`;
    if (filters?.service?.length) {
      labelSelector += `,${LABEL_SERVICE_ID} in (${filters.service.join(',')})`;
    }

    const pods = await this.coreApi.listPodForAllNamespaces(
      { labelSelector },
    );

    // Map to Swarm task format
    return (pods.items ?? []).map((pod) => {
      const cs = pod.status?.containerStatuses?.[0];
      return {
        ID: pod.metadata?.uid,
        ServiceID: pod.metadata?.labels?.[LABEL_SERVICE_ID] ?? '',
        NodeID: pod.spec?.nodeName ?? '',
        Status: {
          State: podPhaseToStatus(pod.status?.phase),
          Message: cs?.state?.waiting?.reason ?? cs?.state?.terminated?.reason ?? '',
          Err: cs?.state?.waiting?.message ?? cs?.state?.terminated?.message ?? '',
          ContainerStatus: cs?.containerID ? {
            ContainerID: `${pod.metadata?.namespace}/${pod.metadata?.name}`,
          } : undefined,
        },
        DesiredState: pod.metadata?.deletionTimestamp ? 'shutdown' : 'running',
        CreatedAt: pod.metadata?.creationTimestamp?.toISOString?.() ?? '',
      };
    });
  }

  async getServiceTasks(serviceId: string): Promise<ServiceTaskInfo[]> {
    const { namespace, name } = await this.findDeployment(serviceId);

    const pods = await this.coreApi.listNamespacedPod(
      { namespace, labelSelector: `${LABEL_SERVICE_ID}=${name}` },
    );

    return (pods.items ?? []).map((pod) => {
      const cs = pod.status?.containerStatuses?.[0];
      const containerID = cs?.containerID
        ? cs.containerID.replace(/^containerd:\/\//, '').replace(/^docker:\/\//, '')
        : undefined;

      return {
        id: pod.metadata?.uid ?? '',
        nodeId: pod.spec?.nodeName ?? '',
        status: podPhaseToStatus(pod.status?.phase),
        desiredState: pod.metadata?.deletionTimestamp ? 'shutdown' : 'running',
        message: cs?.state?.waiting?.reason ?? cs?.state?.terminated?.reason ?? '',
        error: cs?.state?.waiting?.message ?? cs?.state?.terminated?.message ?? undefined,
        containerStatus: cs ? {
          containerId: `${pod.metadata?.namespace}/${pod.metadata?.name}`,
          pid: 0, // Not exposed by K8s API
          exitCode: cs.state?.terminated?.exitCode ?? undefined,
        } : undefined,
        createdAt: pod.metadata?.creationTimestamp?.toISOString?.() ?? '',
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Container Operations
  // ══════════════════════════════════════════════════════════════════════

  async inspectContainer(containerId: string): Promise<any> {
    const { namespace, pod } = parsePodId(containerId);
    const result = await this.coreApi.readNamespacedPod({ name: pod, namespace });
    return {
      Id: containerId,
      State: {
        Status: result.status?.phase?.toLowerCase() ?? 'unknown',
        Running: result.status?.phase === 'Running',
        Pid: 0,
        ExitCode: result.status?.containerStatuses?.[0]?.state?.terminated?.exitCode ?? 0,
      },
      Config: {
        Image: result.spec?.containers?.[0]?.image ?? '',
        Env: result.spec?.containers?.[0]?.env?.map((e) => `${e.name}=${e.value ?? ''}`) ?? [],
      },
      _k8s: result,
    };
  }

  async getContainerStats(containerId: string): Promise<ContainerStats | null> {
    const { namespace, pod } = parsePodId(containerId);

    try {
      // Use metrics-server PodMetrics API
      const metrics = await this.customApi.getNamespacedCustomObject(
        { group: 'metrics.k8s.io', version: 'v1beta1', namespace, plural: 'pods', name: pod },
      ) as any;

      const container = metrics?.containers?.[0];
      if (!container) return null;

      // Parse cpu (e.g. "250m" or "1") and memory (e.g. "128Mi" or "1Gi")
      const cpuNano = this.parseCpuString(container.usage?.cpu ?? '0');
      const memBytes = this.parseMemoryString(container.usage?.memory ?? '0');

      // Get pod spec for memory limits
      const podInfo = await this.coreApi.readNamespacedPod({ name: pod, namespace });
      const limits = podInfo.spec?.containers?.[0]?.resources?.limits;
      const memLimit = limits?.memory ? this.parseMemoryString(limits.memory) : 0;

      return {
        cpuPercent: cpuNano / 1e9 * 100, // Convert to percentage
        memoryUsageBytes: memBytes,
        memoryLimitBytes: memLimit,
        memoryPercent: memLimit > 0 ? (memBytes / memLimit) * 100 : 0,
        networkRxBytes: 0, // Not available from metrics-server
        networkTxBytes: 0,
        blockReadBytes: 0,
        blockWriteBytes: 0,
        pids: 0,
      };
    } catch {
      return null;
    }
  }

  async getContainerNetworkBytes(
    containerId: string,
  ): Promise<{ containerId: string; rxBytes: number; txBytes: number } | null> {
    // K8s metrics-server doesn't expose network I/O.
    // Would need cAdvisor or Prometheus for this — return null.
    return null;
  }

  async pruneServiceContainers(_serviceId: string): Promise<number> {
    // K8s automatically garbage-collects completed/failed pods
    return 0;
  }

  async pruneDeadContainers(): Promise<number> {
    // K8s handles this automatically
    return 0;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Logging
  // ══════════════════════════════════════════════════════════════════════

  async getServiceLogs(
    serviceId: string,
    opts?: { tail?: number; since?: number; follow?: boolean },
  ): Promise<Buffer | NodeJS.ReadableStream> {
    const { namespace, name } = await this.findDeployment(serviceId);

    // Get all pods for this deployment
    const pods = await this.coreApi.listNamespacedPod(
      { namespace, labelSelector: `${LABEL_SERVICE_ID}=${name}` },
    );

    if (opts?.follow) {
      // Streaming mode — aggregate logs from all pods into a single stream
      const output = new PassThrough();
      const activePods = pods.items?.filter(
        (p) => p.status?.phase === 'Running',
      ) ?? [];

      for (const pod of activePods) {
        const podName = pod.metadata!.name!;
        const containerName = pod.spec!.containers[0]!.name!;
        this.k8sLog.log(namespace, podName, containerName, output, {
          follow: true,
          tailLines: opts?.tail ?? 100,
          ...(opts?.since ? { sinceSeconds: Math.floor((Date.now() / 1000) - opts.since) } : {}),
        }).catch(() => { /* pod may die */ });
      }

      return output;
    }

    // Non-streaming: collect logs from all pods and concatenate
    const allLogs: string[] = [];
    for (const pod of pods.items ?? []) {
      try {
        const log = await this.coreApi.readNamespacedPodLog(
          { name: pod.metadata!.name!, namespace, tailLines: opts?.tail ?? 100 },
        );
        if (log) allLogs.push(typeof log === 'string' ? log : String(log));
      } catch {
        // Pod may not have logs yet
      }
    }

    return Buffer.from(allLogs.join('\n'));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Port Management
  // ══════════════════════════════════════════════════════════════════════

  async getUsedIngressPorts(): Promise<Set<number>> {
    const services = await this.coreApi.listServiceForAllNamespaces({});
    const ports = new Set<number>();
    for (const svc of services.items ?? []) {
      for (const port of svc.spec?.ports ?? []) {
        if (port.nodePort) ports.add(port.nodePort);
      }
    }
    return ports;
  }

  async allocateIngressPorts(
    targetPorts: Array<{ target: number; protocol: string }>,
  ): Promise<Array<{ target: number; published: number; protocol: string }>> {
    const used = await this.getUsedIngressPorts();
    const result: Array<{ target: number; published: number; protocol: string }> = [];
    let nextPort = NODEPORT_MIN;

    for (const tp of targetPorts) {
      while (used.has(nextPort) && nextPort <= NODEPORT_MAX) nextPort++;
      if (nextPort > NODEPORT_MAX) {
        throw new Error('No available NodePort in range');
      }
      result.push({ target: tp.target, published: nextPort, protocol: tp.protocol });
      used.add(nextPort);
      nextPort++;
    }

    return result;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Exec Operations
  // ══════════════════════════════════════════════════════════════════════

  async execInContainer(
    containerId: string,
    cmd?: string[],
  ): Promise<{ stream: NodeJS.ReadWriteStream; execId: string }> {
    const { namespace, pod, container } = parsePodId(containerId);
    const command = cmd ?? ['/bin/sh'];

    const duplex = new PassThrough();
    const ws = await this.k8sExec.exec(
      namespace, pod, container ?? 'app', command,
      duplex, // stdout
      duplex, // stderr
      duplex, // stdin (for TTY, all three go to same stream)
      true,   // tty
    );

    const execId = `k8s-exec-${Date.now()}`;
    // Attach websocket to the duplex stream
    (duplex as any)._ws = ws;

    return { stream: duplex, execId };
  }

  async execCommand(
    containerId: string,
    cmd: string[],
    timeoutMs?: number,
    env?: string[],
  ): Promise<{ stdout: string; exitCode: number }> {
    const { namespace, pod, container } = parsePodId(containerId);

    // Wrap command with env vars if specified
    const fullCmd = env?.length
      ? ['sh', '-c', `${env.map((e) => `export ${e}`).join('; ')}; ${cmd.join(' ')}`]
      : cmd;

    return new Promise((resolve, reject) => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let output = '';
      let exitCode = 0;

      stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });

      const timer = timeoutMs ? setTimeout(() => {
        resolve({ stdout: output, exitCode: 124 }); // 124 = timeout
      }, timeoutMs) : null;

      this.k8sExec.exec(
        namespace, pod, container ?? 'app', fullCmd,
        stdout, stderr, null, false,
        (status: k8s.V1Status) => {
          if (timer) clearTimeout(timer);
          exitCode = status.status === 'Success' ? 0 : 1;
          // Try to extract exit code from status details
          if (status.details?.causes) {
            const exitCause = status.details.causes.find((c) => c.reason === 'ExitCode');
            if (exitCause?.message) exitCode = parseInt(exitCause.message, 10);
          }
          resolve({ stdout: output, exitCode });
        },
      ).catch((err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }

  async execCommandStream(
    containerId: string,
    cmd: string[],
    timeoutMs?: number,
    env?: string[],
  ): Promise<{ stream: Readable; exec?: any }> {
    const { namespace, pod, container } = parsePodId(containerId);

    const fullCmd = env?.length
      ? ['sh', '-c', `${env.map((e) => `export ${e}`).join('; ')}; ${cmd.join(' ')}`]
      : cmd;

    const output = new PassThrough();

    const ws = await this.k8sExec.exec(
      namespace, pod, container ?? 'app', fullCmd,
      output, output, null, false,
    );

    if (timeoutMs) {
      setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        output.end();
      }, timeoutMs);
    }

    return { stream: output, exec: ws };
  }

  async execCommandWithInput(
    containerId: string,
    cmd: string[],
    input: Readable,
    timeoutMs?: number,
    env?: string[],
  ): Promise<{ exitCode: number; stderr: string }> {
    const { namespace, pod, container } = parsePodId(containerId);

    const fullCmd = env?.length
      ? ['sh', '-c', `${env.map((e) => `export ${e}`).join('; ')}; ${cmd.join(' ')}`]
      : cmd;

    return new Promise((resolve, reject) => {
      const stderrStream = new PassThrough();
      let stderrOutput = '';
      stderrStream.on('data', (chunk: Buffer) => { stderrOutput += chunk.toString(); });

      const timer = timeoutMs ? setTimeout(() => {
        resolve({ exitCode: 124, stderr: stderrOutput });
      }, timeoutMs) : null;

      this.k8sExec.exec(
        namespace, pod, container ?? 'app', fullCmd,
        null, stderrStream, input, false,
        (status: k8s.V1Status) => {
          if (timer) clearTimeout(timer);
          let exitCode = status.status === 'Success' ? 0 : 1;
          if (status.details?.causes) {
            const exitCause = status.details.causes.find((c) => c.reason === 'ExitCode');
            if (exitCause?.message) exitCode = parseInt(exitCause.message, 10);
          }
          resolve({ exitCode, stderr: stderrOutput });
        },
      ).catch((err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }

  async resizeExec(_execId: string, _h: number, _w: number): Promise<void> {
    // K8s exec doesn't support resize via the same API.
    // Terminal resize is handled via the WebSocket protocol RESIZE channel.
    // This is a no-op — resize is handled at the WebSocket level.
  }

  // ── Node-aware exec (pass-through — K8s API server routes automatically) ──

  async nodeAwareExecCommand(
    containerId: string,
    _nodeId: string,
    cmd: string[],
    timeoutMs?: number,
    env?: string[],
  ): Promise<{ stdout: string; exitCode: number }> {
    // K8s API server handles routing to the correct node natively
    return this.execCommand(containerId, cmd, timeoutMs, env);
  }

  async nodeAwareExecCommandStream(
    containerId: string,
    _nodeId: string,
    cmd: string[],
    timeoutMs?: number,
    env?: string[],
  ): Promise<{ stream: Readable; exec?: any }> {
    return this.execCommandStream(containerId, cmd, timeoutMs, env);
  }

  async nodeAwareExecCommandWithInput(
    containerId: string,
    _nodeId: string,
    cmd: string[],
    input: Readable,
    timeoutMs?: number,
    env?: string[],
  ): Promise<{ stdout: string; stderr?: string; exitCode: number }> {
    const result = await this.execCommandWithInput(containerId, cmd, input, timeoutMs, env);
    return { stdout: '', stderr: result.stderr, exitCode: result.exitCode };
  }

  async getLocalNodeId(): Promise<string> {
    // In K8s, return the node name this pod is running on (via Downward API)
    return process.env['NODE_NAME'] ?? process.env['HOSTNAME'] ?? 'unknown';
  }

  async getAgentAddress(_nodeId: string): Promise<string | null> {
    // In K8s, exec routing is handled by the API server — no agent needed
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Node Management
  // ══════════════════════════════════════════════════════════════════════

  async listNodes(): Promise<any[]> {
    const nodes = await this.coreApi.listNode({});
    return (nodes.items ?? []).map((n) => this.mapNodeToSwarmFormat(n));
  }

  async inspectNode(nodeId: string): Promise<any> {
    const node = await this.coreApi.readNode({ name: nodeId });
    return this.mapNodeToSwarmFormat(node);
  }

  async updateNode(
    nodeId: string,
    opts: {
      availability?: 'active' | 'pause' | 'drain';
      role?: 'manager' | 'worker';
      labels?: Record<string, string>;
    },
  ): Promise<void> {
    const patch: any = { metadata: { labels: {} }, spec: {} };

    if (opts.labels) {
      patch.metadata.labels = opts.labels;
    }

    if (opts.role === 'manager') {
      patch.metadata.labels['node-role.kubernetes.io/control-plane'] = '';
    } else if (opts.role === 'worker') {
      // Remove control-plane label — use JSON patch for deletion
      await this.coreApi.patchNode(
        { name: nodeId, body: [{ op: 'remove', path: '/metadata/labels/node-role.kubernetes.io~1control-plane' }] },
        k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.JsonPatch),
      ).catch(() => { /* label may not exist */ });
    }

    if (opts.availability === 'drain') {
      patch.spec.unschedulable = true;
    } else if (opts.availability === 'active') {
      patch.spec.unschedulable = false;
    }

    await this.coreApi.patchNode(
      { name: nodeId, body: patch },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.StrategicMergePatch),
    );
  }

  async drainNode(nodeId: string): Promise<void> {
    // Cordon the node
    await this.coreApi.patchNode(
      { name: nodeId, body: { spec: { unschedulable: true } } },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch),
    );

    // Evict all pods
    const pods = await this.coreApi.listPodForAllNamespaces(
      { fieldSelector: `spec.nodeName=${nodeId}` },
    );
    for (const pod of pods.items ?? []) {
      if (pod.metadata?.namespace === 'kube-system') continue; // Skip system pods
      try {
        await this.coreApi.createNamespacedPodEviction(
          {
            name: pod.metadata!.name!,
            namespace: pod.metadata!.namespace!,
            body: {
              metadata: { name: pod.metadata!.name!, namespace: pod.metadata!.namespace! },
              deleteOptions: { gracePeriodSeconds: 30 },
            },
          },
        );
      } catch {
        // Pod may already be evicting
      }
    }
  }

  async activateNode(nodeId: string): Promise<void> {
    // Uncordon the node
    await this.coreApi.patchNode(
      { name: nodeId, body: { spec: { unschedulable: false } } },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch),
    );
  }

  async removeNode(nodeId: string, _force?: boolean): Promise<void> {
    await this.coreApi.deleteNode({ name: nodeId });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Cluster Info
  // ══════════════════════════════════════════════════════════════════════

  async getClusterInfo(): Promise<any> {
    const nodes = await this.coreApi.listNode({});

    return {
      ID: 'kubernetes',
      Version: { Index: 1 },
      CreatedAt: new Date().toISOString(),
      Spec: {
        Name: 'kubernetes',
        Orchestration: { TaskHistoryRetentionLimit: 5 },
      },
      _k8s: {
        nodeCount: nodes.items?.length ?? 0,
      },
    };
  }

  async getJoinToken(): Promise<{ worker: string; manager: string }> {
    // k3s stores the node token in a file or K8s secret
    try {
      // Try reading from k3s server token file
      const token = await readFile('/var/lib/rancher/k3s/server/node-token', 'utf-8');
      return { worker: token.trim(), manager: token.trim() };
    } catch {
      // Try reading from K8s secret
      try {
        const secret = await this.coreApi.readNamespacedSecret(
          { name: 'k3s-node-token', namespace: 'kube-system' },
        );
        const token = secret.data?.['node-token']
          ? Buffer.from(secret.data['node-token'], 'base64').toString()
          : '';
        return { worker: token.trim(), manager: token.trim() };
      } catch {
        return { worker: '', manager: '' };
      }
    }
  }

  async configureTaskHistoryLimit(_limit?: number): Promise<void> {
    // K8s handles pod garbage collection automatically via kubelet
    // revisionHistoryLimit on Deployments controls ReplicaSet retention
    // No global configuration needed
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Network Management
  // ══════════════════════════════════════════════════════════════════════

  async ensureNetwork(name: string): Promise<string> {
    const nsName = networkToNamespace(name);
    await this.ensureNamespace(nsName);

    // Apply default deny-all NetworkPolicy + allow from same namespace and fleet-system
    try {
      const policy: any = {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: { name: 'fleet-default', namespace: nsName },
        spec: {
          podSelector: {},
          policyTypes: ['Ingress', 'Egress'],
          ingress: [
            { from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': nsName } } }] },
            { from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': SYSTEM_NS } } }] },
          ],
          egress: [{ }], // Allow all egress
        },
      };

      try {
        await this.customApi.getNamespacedCustomObject(
          { group: 'networking.k8s.io', version: 'v1', namespace: nsName, plural: 'networkpolicies', name: 'fleet-default' },
        );
        // Already exists — patch it
        await this.customApi.patchNamespacedCustomObject(
          { group: 'networking.k8s.io', version: 'v1', namespace: nsName, plural: 'networkpolicies', name: 'fleet-default', body: policy },
          k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch),
        );
      } catch {
        await this.customApi.createNamespacedCustomObject(
          { group: 'networking.k8s.io', version: 'v1', namespace: nsName, plural: 'networkpolicies', body: policy },
        );
      }
    } catch (err) {
      logger.warn({ err, namespace: nsName }, 'Failed to apply NetworkPolicy');
    }

    return nsName;
  }

  async createNetwork(name: string, labels?: Record<string, string>): Promise<string> {
    const nsName = networkToNamespace(name);
    await this.ensureNamespace(nsName, labels);
    return nsName;
  }

  async inspectNetwork(networkId: string): Promise<{ Name: string; Id: string; Driver: string; Scope: string }> {
    const nsName = networkToNamespace(networkId);
    const ns = await this.coreApi.readNamespace({ name: nsName });
    return {
      Name: nsName,
      Id: ns.metadata?.uid ?? nsName,
      Driver: 'kubernetes',
      Scope: 'cluster',
    };
  }

  async removeNetwork(networkId: string): Promise<void> {
    const nsName = networkToNamespace(networkId);
    try {
      await this.coreApi.deleteNamespace({ name: nsName });
    } catch (err: any) {
      if (err?.statusCode !== 404) throw err;
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Volume Management
  // ══════════════════════════════════════════════════════════════════════

  async copyVolumeData(sourceVolume: string, targetVolume: string): Promise<void> {
    // Run a Job that mounts both PVCs and copies data
    const jobName = `copy-vol-${Date.now().toString(36)}`;

    // Ensure both PVCs exist in system namespace
    await this.ensurePVC(SYSTEM_NS, sourceVolume, { [LABEL_MANAGED]: 'true' });
    await this.ensurePVC(SYSTEM_NS, targetVolume, { [LABEL_MANAGED]: 'true' });

    const job: k8s.V1Job = {
      metadata: { name: jobName, namespace: SYSTEM_NS },
      spec: {
        ttlSecondsAfterFinished: 60,
        template: {
          spec: {
            restartPolicy: 'Never',
            containers: [{
              name: 'copier',
              image: 'alpine:latest',
              command: ['sh', '-c', 'cp -a /source/. /target/'],
              volumeMounts: [
                { name: 'source', mountPath: '/source', readOnly: true },
                { name: 'target', mountPath: '/target' },
              ],
            }],
            volumes: [
              { name: 'source', persistentVolumeClaim: { claimName: sourceVolume, readOnly: true } },
              { name: 'target', persistentVolumeClaim: { claimName: targetVolume } },
            ],
          },
        },
      },
    };

    await this.batchApi.createNamespacedJob({ namespace: SYSTEM_NS, body: job });
    await this.waitForJob(jobName, SYSTEM_NS, 300_000);
  }

  async cleanVolume(volumeName: string): Promise<void> {
    const jobName = `clean-vol-${Date.now().toString(36)}`;

    const job: k8s.V1Job = {
      metadata: { name: jobName, namespace: SYSTEM_NS },
      spec: {
        ttlSecondsAfterFinished: 60,
        template: {
          spec: {
            restartPolicy: 'Never',
            containers: [{
              name: 'cleaner',
              image: 'alpine:latest',
              command: ['sh', '-c', 'rm -rf /vol/*'],
              volumeMounts: [
                { name: 'vol', mountPath: '/vol' },
              ],
            }],
            volumes: [
              { name: 'vol', persistentVolumeClaim: { claimName: volumeName } },
            ],
          },
        },
      },
    };

    await this.batchApi.createNamespacedJob({ namespace: SYSTEM_NS, body: job });
    await this.waitForJob(jobName, SYSTEM_NS, 120_000);
  }

  async removeVolume(name: string): Promise<boolean> {
    try {
      // Try in all namespaces
      const pvcs = await this.coreApi.listPersistentVolumeClaimForAllNamespaces(
        { fieldSelector: `metadata.name=${name}` },
      );
      for (const pvc of pvcs.items ?? []) {
        await this.coreApi.deleteNamespacedPersistentVolumeClaim(
          { name: pvc.metadata!.name!, namespace: pvc.metadata!.namespace! },
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  async removeDockerVolumeOnAllNodes(volumeName: string): Promise<void> {
    // In K8s, volumes are PVCs managed by the storage class — just delete the PVC
    await this.removeVolume(volumeName);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Host-Level Operations
  // ══════════════════════════════════════════════════════════════════════

  async runOnAllNodes(command: string, opts?: { timeoutMs?: number }): Promise<RunOnNodesResult> {
    return this.runDaemonSetJob(command, false, opts?.timeoutMs);
  }

  async runOnAllNodesPrivileged(command: string, opts?: { timeoutMs?: number }): Promise<RunOnNodesResult> {
    return this.runDaemonSetJob(command, true, opts?.timeoutMs);
  }

  async runOnLocalHost(command: string, opts?: { timeoutMs?: number }): Promise<{ exitCode: number; stdout: string }> {
    try {
      const { stdout } = await execAsync(command, {
        timeout: opts?.timeoutMs ?? 30_000,
      });
      return { exitCode: 0, stdout };
    } catch (err: any) {
      return { exitCode: err.code ?? 1, stdout: err.stdout ?? '' };
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Platform Storage Management
  // ══════════════════════════════════════════════════════════════════════

  async getPlatformVolumeMode(): Promise<'local' | 'distributed'> {
    // In K8s, storage is always managed by StorageClass — report as 'distributed'
    // since Longhorn/Ceph handles replication
    try {
      const sc = await this.customApi.getClusterCustomObject(
        { group: 'storage.k8s.io', version: 'v1', plural: 'storageclasses', name: STORAGE_CLASS },
      );
      return (sc as any)?.provisioner ? 'distributed' : 'local';
    } catch {
      return 'local';
    }
  }

  async updatePlatformVolumeMounts(
    _mode: 'distributed' | 'local',
  ): Promise<{ applied: boolean; message: string }> {
    // In K8s, storage mode is controlled by StorageClass — not per-mount configuration
    return { applied: true, message: 'K8s storage is managed by StorageClass' };
  }

  async ensureServiceVolumeMount(): Promise<{ applied: boolean; message: string }> {
    // In K8s, PVCs handle volume provisioning automatically
    return { applied: true, message: 'K8s handles volume provisioning via PVCs' };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  One-Off Services
  // ══════════════════════════════════════════════════════════════════════

  async createOneOffService(opts: OneOffServiceOptions): Promise<{ id: string }> {
    const namespace = opts.networkIds?.[0]
      ? networkToNamespace(opts.networkIds[0])
      : SYSTEM_NS;

    await this.ensureNamespace(namespace);

    const labels: Record<string, string> = {
      [LABEL_MANAGED]: 'true',
      [LABEL_ONEOFF]: 'true',
      ...(opts.labels ?? {}),
    };

    const job: k8s.V1Job = {
      metadata: { name: opts.name, namespace, labels },
      spec: {
        ttlSecondsAfterFinished: 300,
        backoffLimit: opts.restartCondition === 'on-failure' ? 3 : 0,
        template: {
          metadata: { labels },
          spec: {
            restartPolicy: opts.restartCondition === 'on-failure' ? 'OnFailure' : 'Never',
            containers: [{
              name: 'task',
              image: opts.image,
              command: opts.cmd,
              env: opts.env
                ? Object.entries(opts.env).map(([k, v]) => ({ name: k, value: v }))
                : [],
              resources: opts.memoryLimitMb ? {
                limits: { memory: memoryToK8s(opts.memoryLimitMb) },
              } : undefined,
              volumeMounts: opts.mounts?.map((m) => ({
                name: `vol-${m.source}`,
                mountPath: m.target,
                readOnly: m.readonly ?? false,
              })),
            }],
            volumes: opts.mounts?.map((m) => ({
              name: `vol-${m.source}`,
              persistentVolumeClaim: { claimName: m.source, readOnly: m.readonly ?? false },
            })),
          },
        },
      },
    };

    const created = await this.batchApi.createNamespacedJob({ namespace, body: job });
    return { id: created.metadata?.name ?? opts.name };
  }

  async pollTaskCompletion(
    serviceId: string,
    timeoutMs = 300_000,
  ): Promise<{ status: string; containerId?: string }> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 3000));

      try {
        // Find the job across namespaces
        const jobs = await this.batchApi.listJobForAllNamespaces(
          { fieldSelector: `metadata.name=${serviceId}` },
        );
        const job = jobs.items?.[0];
        if (!job) continue;

        const namespace = job.metadata?.namespace ?? SYSTEM_NS;

        // Find pods for this job
        const pods = await this.coreApi.listNamespacedPod(
          { namespace, labelSelector: `job-name=${serviceId}` },
        );
        const pod = pods.items?.[0];
        const containerId = pod
          ? `${namespace}/${pod.metadata?.name}`
          : undefined;

        if (job.status?.succeeded && job.status.succeeded > 0) {
          return { status: 'complete', containerId };
        }
        if (job.status?.failed && job.status.failed > 0) {
          return { status: 'failed', containerId };
        }
        if (job.status?.active && job.status.active > 0) {
          return { status: 'running', containerId };
        }
      } catch {
        // Job may not exist yet
      }
    }

    return { status: 'timeout' };
  }

  async removeOneOffService(serviceId: string): Promise<void> {
    try {
      // Find and delete the job across namespaces
      const jobs = await this.batchApi.listJobForAllNamespaces(
        { fieldSelector: `metadata.name=${serviceId}` },
      );
      for (const job of jobs.items ?? []) {
        await this.batchApi.deleteNamespacedJob(
          { name: job.metadata!.name!, namespace: job.metadata!.namespace!, propagationPolicy: 'Background' },
        );
      }
    } catch {
      /* ignore cleanup failures */
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Private Helpers
  // ══════════════════════════════════════════════════════════════════════

  /** Find a deployment by name across all namespaces. */
  private async findDeployment(serviceId: string): Promise<{ namespace: string; name: string }> {
    // First try: serviceId is a deployment name — search across namespaces
    const deployments = await this.appsApi.listDeploymentForAllNamespaces(
      { labelSelector: `${LABEL_SERVICE_ID}=${serviceId}` },
    );
    if (deployments.items?.length) {
      const d = deployments.items[0]!;
      return { namespace: d.metadata!.namespace!, name: d.metadata!.name! };
    }

    // Second try: serviceId might be a UID — search by name directly
    const allDeployments = await this.appsApi.listDeploymentForAllNamespaces(
      { labelSelector: `${LABEL_MANAGED}=true` },
    );
    const match = allDeployments.items?.find(
      (d) => d.metadata?.uid === serviceId || d.metadata?.name === serviceId,
    );
    if (match) {
      return { namespace: match.metadata!.namespace!, name: match.metadata!.name! };
    }

    throw new Error(`Deployment not found: ${serviceId}`);
  }

  /** Ensure a namespace exists. */
  private async ensureNamespace(name: string, labels?: Record<string, string>): Promise<void> {
    try {
      await this.coreApi.readNamespace({ name });
    } catch {
      await this.coreApi.createNamespace({
        body: {
          metadata: {
            name,
            labels: {
              [LABEL_MANAGED]: 'true',
              ...(labels ?? {}),
            },
          },
        },
      });
    }
  }

  /** Ensure a PVC exists. */
  private async ensurePVC(
    namespace: string,
    name: string,
    labels: Record<string, string>,
    sizeGi = 10,
  ): Promise<void> {
    try {
      await this.coreApi.readNamespacedPersistentVolumeClaim({ name, namespace });
    } catch {
      await this.coreApi.createNamespacedPersistentVolumeClaim({
        namespace,
        body: {
          metadata: { name, namespace, labels },
          spec: {
            accessModes: ['ReadWriteOnce'],
            storageClassName: STORAGE_CLASS,
            resources: {
              requests: { storage: `${sizeGi}Gi` },
            },
          },
        },
      });
    }
  }

  /** Ensure an imagePullSecret exists for registry auth. */
  private async ensureImagePullSecret(
    namespace: string,
    name: string,
    auth: RegistryAuth,
  ): Promise<void> {
    const dockerConfig = JSON.stringify({
      auths: {
        [auth.serveraddress]: {
          username: auth.username,
          password: auth.password,
          auth: Buffer.from(`${auth.username}:${auth.password}`).toString('base64'),
        },
      },
    });

    const secret: k8s.V1Secret = {
      metadata: { name, namespace },
      type: 'kubernetes.io/dockerconfigjson',
      data: {
        '.dockerconfigjson': Buffer.from(dockerConfig).toString('base64'),
      },
    };

    try {
      await this.coreApi.readNamespacedSecret({ name, namespace });
      await this.coreApi.replaceNamespacedSecret({ name, namespace, body: secret });
    } catch {
      await this.coreApi.createNamespacedSecret({ namespace, body: secret });
    }
  }

  /** Build a K8s probe from health check config. */
  private buildProbe(
    hc: { cmd: string; interval: number; timeout: number; retries: number },
    startup = false,
  ): k8s.V1Probe {
    const isHttpCheck = hc.cmd.startsWith('http://') || hc.cmd.startsWith('https://');

    if (isHttpCheck) {
      const url = new URL(hc.cmd);
      return {
        httpGet: {
          path: url.pathname,
          port: parseInt(url.port, 10) || 80,
        },
        periodSeconds: Math.round(hc.interval / 1e9), // nanoseconds to seconds
        timeoutSeconds: Math.round(hc.timeout / 1e9),
        failureThreshold: startup ? hc.retries * 3 : hc.retries,
        ...(startup ? { initialDelaySeconds: 5 } : {}),
      };
    }

    return {
      exec: { command: ['sh', '-c', hc.cmd] },
      periodSeconds: Math.round(hc.interval / 1e9),
      timeoutSeconds: Math.round(hc.timeout / 1e9),
      failureThreshold: startup ? hc.retries * 3 : hc.retries,
      ...(startup ? { initialDelaySeconds: 5 } : {}),
    };
  }

  /** Wait for a K8s Job to complete. */
  private async waitForJob(name: string, namespace: string, timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const job = await this.batchApi.readNamespacedJob({ name, namespace });
        if (job.status?.succeeded && job.status.succeeded > 0) return;
        if (job.status?.failed && job.status.failed > 0) {
          throw new Error(`Job ${name} failed`);
        }
      } catch (err: any) {
        if (err?.statusCode === 404) return; // Job cleaned up by TTL
        if (err.message?.includes('failed')) throw err;
      }
    }
    throw new Error(`Job ${name} timed out after ${timeoutMs}ms`);
  }

  /** Run a command on all nodes using a DaemonSet-like Job pattern. */
  private async runDaemonSetJob(
    command: string,
    privileged: boolean,
    timeoutMs = 60_000,
  ): Promise<RunOnNodesResult> {
    const nodes = await this.coreApi.listNode({});
    const results: Array<{ nodeId: string; status: string; error?: string }> = [];
    const jobPrefix = `fleet-run-${Date.now().toString(36)}`;

    // Create a Job per node
    const jobPromises = (nodes.items ?? []).map(async (node) => {
      const nodeId = node.metadata!.name!;
      const jobName = `${jobPrefix}-${nodeId.slice(0, 20)}`;

      const job: k8s.V1Job = {
        metadata: { name: jobName, namespace: SYSTEM_NS, labels: { [LABEL_MANAGED]: 'true' } },
        spec: {
          ttlSecondsAfterFinished: 60,
          template: {
            spec: {
              restartPolicy: 'Never',
              nodeSelector: { 'kubernetes.io/hostname': nodeId },
              hostPID: privileged,
              containers: [{
                name: 'runner',
                image: 'alpine:latest',
                command: privileged
                  ? ['nsenter', '--target', '1', '--mount', '--uts', '--ipc', '--net', '--pid', '--', 'sh', '-c', command]
                  : ['sh', '-c', command],
                securityContext: privileged
                  ? { privileged: true, capabilities: { add: ['SYS_ADMIN'] } }
                  : undefined,
              }],
            },
          },
        },
      };

      try {
        await this.batchApi.createNamespacedJob({ namespace: SYSTEM_NS, body: job });
        await this.waitForJob(jobName, SYSTEM_NS, timeoutMs);
        results.push({ nodeId, status: 'success' });
      } catch (err) {
        results.push({ nodeId, status: 'error', error: (err as Error).message });
      }
    });

    await Promise.allSettled(jobPromises);

    return {
      success: results.every((r) => r.status === 'success'),
      results,
    };
  }

  /** Map a K8s node to Swarm-compatible format. */
  private mapNodeToSwarmFormat(node: k8s.V1Node): any {
    const conditions = node.status?.conditions ?? [];
    const ready = conditions.find((c) => c.type === 'Ready');
    const isControlPlane = node.metadata?.labels?.['node-role.kubernetes.io/control-plane'] !== undefined;

    return {
      ID: node.metadata?.name ?? '',
      Version: { Index: parseInt(node.metadata?.resourceVersion ?? '0', 10) },
      CreatedAt: node.metadata?.creationTimestamp?.toISOString?.() ?? '',
      Spec: {
        Labels: node.metadata?.labels ?? {},
        Role: isControlPlane ? 'manager' : 'worker',
        Availability: node.spec?.unschedulable ? 'drain' : 'active',
      },
      Status: {
        State: ready?.status === 'True' ? 'ready' : 'down',
        Addr: node.status?.addresses?.find((a) => a.type === 'InternalIP')?.address ?? '',
        Message: ready?.message ?? '',
      },
      Description: {
        Hostname: node.metadata?.name ?? '',
        Platform: {
          Architecture: node.status?.nodeInfo?.architecture ?? '',
          OS: node.status?.nodeInfo?.operatingSystem ?? '',
        },
        Resources: {
          NanoCPUs: this.parseCpuString(node.status?.capacity?.cpu ?? '0') * 1e9,
          MemoryBytes: this.parseMemoryString(node.status?.capacity?.memory ?? '0'),
        },
        Engine: {
          EngineVersion: node.status?.nodeInfo?.containerRuntimeVersion ?? '',
        },
      },
      _k8s: node,
    };
  }

  /** Parse K8s CPU string (e.g. "500m", "2") to cores as a float. */
  private parseCpuString(cpu: string): number {
    if (cpu.endsWith('m')) return parseInt(cpu, 10) / 1000;
    if (cpu.endsWith('n')) return parseInt(cpu, 10) / 1e9;
    return parseFloat(cpu);
  }

  /** Parse K8s memory string (e.g. "128Mi", "1Gi", "1024") to bytes. */
  private parseMemoryString(mem: string): number {
    const match = mem.match(/^(\d+(?:\.\d+)?)\s*([KMGTPE]i?|[kmgtpe])?$/);
    if (!match) return parseInt(mem, 10) || 0;

    const value = parseFloat(match[1]!);
    const unit = match[2] ?? '';

    const multipliers: Record<string, number> = {
      '': 1, 'k': 1e3, 'K': 1e3,
      'Ki': 1024, 'Mi': 1024 ** 2, 'Gi': 1024 ** 3,
      'Ti': 1024 ** 4, 'Pi': 1024 ** 5, 'Ei': 1024 ** 6,
      'M': 1e6, 'G': 1e9, 'T': 1e12,
    };

    return Math.round(value * (multipliers[unit] ?? 1));
  }
}
