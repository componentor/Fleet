// ---------------------------------------------------------------------------
// Audit Log types
// ---------------------------------------------------------------------------

export interface AuditLog {
  id: string;
  userId: string;
  accountId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ipAddress: string;
  details: Record<string, unknown>;
  createdAt: Date;
}
