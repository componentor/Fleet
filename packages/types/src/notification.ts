// ---------------------------------------------------------------------------
// Notification types
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'deployment_success'
  | 'deployment_failed'
  | 'service_down'
  | 'service_up'
  | 'backup_complete'
  | 'backup_failed';

export interface Notification {
  id: string;
  accountId: string;
  userId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  read: boolean;
  createdAt: Date;
}
