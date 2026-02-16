// ---------------------------------------------------------------------------
// Swarm Node types
// ---------------------------------------------------------------------------

export type NodeRole = 'manager' | 'worker';

export type NodeStatus = 'active' | 'draining' | 'down';

export interface SwarmNode {
  id: string;
  hostname: string;
  ipAddress: string;
  dockerNodeId: string;
  role: NodeRole;
  status: NodeStatus;
  labels: Record<string, string>;
  nfsServer: boolean;
  lastHeartbeat: Date;
}

export interface HeartbeatPayload {
  hostname: string;
  cpuCount: number;
  memTotal: number;
  memUsed: number;
  memFree: number;
  containerCount: number;
  timestamp: string;
}

export interface NodeMetrics {
  id: string;
  nodeId: string;
  hostname: string;
  cpuCount: number;
  memTotal: number;
  memUsed: number;
  memFree: number;
  containerCount: number;
  recordedAt: Date;
}
