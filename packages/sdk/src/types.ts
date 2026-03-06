// Re-export common types from @fleet/types
export type {
  Service,
  ServiceStatus,
  Deployment,
  DeploymentStatus,
  HealthCheck,
  RestartCondition,
  DnsZone,
  DnsRecord,
  DnsRecordType,
  ApiKey,
  CreateApiKeyResponse,
} from '@fleet/types';

// ── SDK-specific types ──

export interface SiglarClientOptions {
  /** API key. Required for authentication. */
  apiKey: string;
  /** Base URL of the Siglar API, e.g. `https://yoursiglar.com/api/v1` */
  baseUrl: string;
  /** Optional account ID. API keys auto-resolve their account, but this can override it. */
  accountId?: string;
  /** Optional custom fetch implementation (for testing or custom environments). */
  fetch?: typeof globalThis.fetch;
}

export interface PortMapping {
  target: number;
  published?: number;
  protocol?: 'tcp' | 'udp';
}

export interface VolumeMount {
  source: string;
  target: string;
  readonly?: boolean;
}

export interface CreateServiceInput {
  name: string;
  image: string;
  replicas?: number;
  env?: Record<string, string>;
  ports?: PortMapping[];
  volumes?: VolumeMount[];
  domain?: string | null;
  sslEnabled?: boolean;
  nodeConstraint?: string | null;
  region?: string | null;
  placementConstraints?: string[];
  updateParallelism?: number;
  updateDelay?: string;
  rollbackOnFailure?: boolean;
  healthCheck?: HealthCheckInput | null;
  githubRepo?: string | null;
  githubBranch?: string | null;
  autoDeploy?: boolean;
  cpuLimit?: number | null;
  memoryLimit?: number | null;
  sourceType?: 'docker' | 'github' | 'upload' | 'marketplace' | 'registry' | null;
  tags?: string[];
}

export interface UpdateServiceInput {
  name?: string;
  image?: string;
  replicas?: number;
  env?: Record<string, string>;
  ports?: PortMapping[];
  volumes?: VolumeMount[];
  domain?: string | null;
  sslEnabled?: boolean;
  nodeConstraint?: string | null;
  region?: string | null;
  placementConstraints?: string[];
  updateParallelism?: number;
  updateDelay?: string;
  rollbackOnFailure?: boolean;
  healthCheck?: HealthCheckInput | null;
  restartCondition?: 'none' | 'on-failure' | 'any';
  restartMaxAttempts?: number;
  restartDelay?: string;
  cpuLimit?: number;
  memoryLimit?: number;
  autoDeploy?: boolean;
  githubBranch?: string;
  tags?: string[];
}

export interface HealthCheckInput {
  cmd: string;
  interval: number;
  timeout: number;
  retries: number;
}

export interface LogsOptions {
  tail?: number;
}

export interface CreateDnsZoneInput {
  domain: string;
}

export interface CreateDnsRecordInput {
  zoneId: string;
  type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS';
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
}

export interface UpdateDnsRecordInput {
  type?: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS';
  name?: string;
  content?: string;
  ttl?: number;
  priority?: number | null;
}

export interface WaitOptions {
  /** Polling interval in milliseconds (default: 3000) */
  intervalMs?: number;
  /** Maximum time to wait in milliseconds (default: 120000) */
  timeoutMs?: number;
}

/** Internal type for the request function passed to resources. */
export type RequestFn = <T = unknown>(
  method: string,
  path: string,
  body?: unknown,
) => Promise<T>;
