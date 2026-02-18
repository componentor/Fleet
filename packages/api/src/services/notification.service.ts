import { db, notifications, insertReturning, eq, and, countSql, isNull, or } from '@fleet/db';

class NotificationService {
  async create(accountId: string, opts: {
    type: string;
    title: string;
    message: string;
    userId?: string;
    resourceType?: string;
    resourceId?: string;
  }) {
    const [notification] = await insertReturning(notifications, {
      accountId,
      userId: opts.userId ?? null,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      resourceType: opts.resourceType ?? null,
      resourceId: opts.resourceId ?? null,
    });
    return notification;
  }

  async getUnreadCount(accountId: string, userId: string): Promise<number> {
    const [result] = await db
      .select({ count: countSql() })
      .from(notifications)
      .where(and(
        eq(notifications.accountId, accountId),
        eq(notifications.read, false),
        or(eq(notifications.userId, userId), isNull(notifications.userId)),
      ));
    return (result?.count as number) ?? 0;
  }

  async markRead(id: string) {
    await db.update(notifications).set({ read: true }).where(eq(notifications.id, id));
  }

  async markAllRead(accountId: string, userId: string) {
    await db.update(notifications).set({ read: true }).where(
      and(
        eq(notifications.accountId, accountId),
        eq(notifications.read, false),
        or(eq(notifications.userId, userId), isNull(notifications.userId)),
      )
    );
  }
}

export const notificationService = new NotificationService();
