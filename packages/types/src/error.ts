// ---------------------------------------------------------------------------
// Error tracking types
// ---------------------------------------------------------------------------

export interface ErrorLogEntry {
  id: string;
  level: 'error' | 'fatal' | 'warn';
  message: string;
  stack: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  resolved: boolean;
  createdAt: Date;
}
