export { SiglarClient } from './client.js';
export { SiglarApiError } from './errors.js';

// Resource classes (for advanced usage / typing)
export { ServiceResource } from './resources/services.js';
export { DeploymentResource } from './resources/deployments.js';
export { DnsZoneResource, DnsRecordResource } from './resources/dns.js';
export { DomainResource } from './resources/domains.js';
export type { SharedDomain } from './resources/domains.js';

// Types
export type {
  SiglarClientOptions,
  CreateServiceInput,
  UpdateServiceInput,
  PortMapping,
  VolumeMount,
  HealthCheckInput,
  LogsOptions,
  CreateDnsZoneInput,
  CreateDnsRecordInput,
  UpdateDnsRecordInput,
  WaitOptions,
} from './types.js';

// Re-exported from @fleet/types
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
} from './types.js';
