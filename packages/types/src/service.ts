// ---------------------------------------------------------------------------
// Service & Deployment types
// ---------------------------------------------------------------------------

export type ServiceStatus = 'running' | 'stopped' | 'deploying' | 'failed';

export type DeploymentStatus =
  | 'pending'
  | 'building'
  | 'deploying'
  | 'succeeded'
  | 'failed';

export interface HealthCheck {
  cmd: string;
  interval: number;
  timeout: number;
  retries: number;
}

export interface Service {
  id: string;
  accountId: string;
  name: string;
  image: string;
  replicas: number;
  env: Record<string, string>;
  ports: number[];
  volumes: string[];
  dockerServiceId: string | null;
  githubRepo: string | null;
  githubBranch: string | null;
  autoDeploy: boolean;
  domain: string | null;
  sslEnabled: boolean;
  status: ServiceStatus;
  nodeConstraint: string | null;
  placementConstraints: string[];
  updateParallelism: number;
  updateDelay: string;
  rollbackOnFailure: boolean;
  healthCheck: HealthCheck | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateServiceInput {
  accountId: string;
  name: string;
  image: string;
  replicas?: number;
  env?: Record<string, string>;
  ports?: number[];
  volumes?: string[];
  githubRepo?: string;
  githubBranch?: string;
  autoDeploy?: boolean;
  domain?: string;
  sslEnabled?: boolean;
  nodeConstraint?: string;
  placementConstraints?: string[];
  updateParallelism?: number;
  updateDelay?: string;
  rollbackOnFailure?: boolean;
  healthCheck?: HealthCheck;
}

export interface UpdateServiceInput {
  name?: string;
  image?: string;
  replicas?: number;
  env?: Record<string, string>;
  ports?: number[];
  volumes?: string[];
  githubRepo?: string | null;
  githubBranch?: string | null;
  autoDeploy?: boolean;
  domain?: string | null;
  sslEnabled?: boolean;
  status?: ServiceStatus;
  nodeConstraint?: string | null;
  placementConstraints?: string[];
  updateParallelism?: number;
  updateDelay?: string;
  rollbackOnFailure?: boolean;
  healthCheck?: HealthCheck | null;
}

export interface Deployment {
  id: string;
  serviceId: string;
  commitSha: string | null;
  status: DeploymentStatus;
  log: string;
  createdAt: Date;
}
