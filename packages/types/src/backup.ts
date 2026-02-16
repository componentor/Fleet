// ---------------------------------------------------------------------------
// Backup types
// ---------------------------------------------------------------------------

export type BackupType = 'scheduled' | 'manual';

export type BackupStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type BackupStorageBackend = 'nfs' | 's3';

export interface Backup {
  id: string;
  accountId: string;
  serviceId: string | null;
  type: BackupType;
  status: BackupStatus;
  storagePath: string;
  storageBackend: BackupStorageBackend;
  sizeBytes: number;
  contents: string;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface BackupSchedule {
  id: string;
  accountId: string;
  serviceId: string | null;
  cron: string;
  retentionDays: number;
  retentionCount: number;
  storageBackend: BackupStorageBackend;
  enabled: boolean;
}

export interface CreateBackupInput {
  accountId: string;
  serviceId?: string;
  type: BackupType;
  storageBackend?: BackupStorageBackend;
}

export interface CreateBackupScheduleInput {
  accountId: string;
  serviceId?: string;
  cron: string;
  retentionDays?: number;
  retentionCount?: number;
  storageBackend?: BackupStorageBackend;
  enabled?: boolean;
}
