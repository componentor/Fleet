import {
  db,
  services,
  usageRecords,
  pricingConfig,
  locationMultipliers,
  accountBillingOverrides,
  subscriptions,
  nodes,
  eq,
  and,
  gte,
  lte,
  sql,
} from '@fleet/db';
import type { UsageSummary } from '@fleet/types';
import { stripeService } from './stripe.service.js';
import { logger } from './logger.js';

const COLLECTION_INTERVAL_SECONDS = 300; // 5 minutes

// Warn at startup if storage/bandwidth metrics are not yet implemented
if (process.env['NODE_ENV'] === 'production') {
  logger.warn('Storage and bandwidth usage metrics are not yet implemented. Usage-based billing will report 0 for these metrics.');
}

class UsageService {
  /**
   * Collect current resource usage for all accounts with running services.
   * Called every 5 minutes by the scheduler.
   */
  async collectUsage(): Promise<void> {
    try {
      // Get all running services grouped by account
      const runningServices = await db.query.services.findMany({
        where: eq(services.status, 'running'),
      });

      if (runningServices.length === 0) return;

      // Group by accountId
      const byAccount = new Map<string, typeof runningServices>();
      for (const svc of runningServices) {
        const list = byAccount.get(svc.accountId) ?? [];
        list.push(svc);
        byAccount.set(svc.accountId, list);
      }

      const now = new Date();
      const periodStart = new Date(now.getTime() - COLLECTION_INTERVAL_SECONDS * 1000);

      for (const [accountId, accountServices] of byAccount) {
        let totalCpuMillicores = 0;
        let totalMemoryMb = 0;
        let containerCount = 0;

        for (const svc of accountServices) {
          const replicas = svc.replicas ?? 1;
          containerCount += replicas;
          totalCpuMillicores += (svc.cpuLimit ?? 0) * replicas;
          totalMemoryMb += (svc.memoryLimit ?? 0) * replicas;
        }

        // Convert to billing units for this 5-minute interval
        const cpuSeconds = BigInt(Math.round((totalCpuMillicores / 1000) * COLLECTION_INTERVAL_SECONDS));
        const memoryMbHours = BigInt(Math.round(totalMemoryMb * (COLLECTION_INTERVAL_SECONDS / 3600)));

        await db.insert(usageRecords).values({
          accountId,
          periodStart,
          periodEnd: now,
          containers: containerCount,
          cpuSeconds,
          memoryMbHours,
          storageGb: 0, // FIXME(billing): integrate with actual storage metrics — usage-based billing reports 0 until implemented
          bandwidthGb: 0, // FIXME(billing): integrate with network metrics — usage-based billing reports 0 until implemented
          recordedAt: now,
        });
      }

      logger.info(
        { accounts: byAccount.size },
        'Usage collection completed',
      );
    } catch (err) {
      logger.error({ err }, 'Usage collection failed');
    }
  }

  /**
   * Get aggregated usage summary for an account within a billing period.
   */
  async getAccountUsageSummary(
    accountId: string,
    periodStart?: Date,
    periodEnd?: Date,
  ): Promise<UsageSummary> {
    const start = periodStart ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = periodEnd ?? new Date();

    const conditions = [
      eq(usageRecords.accountId, accountId),
      gte(usageRecords.recordedAt, start),
      lte(usageRecords.recordedAt, end),
    ];

    const result = await db
      .select({
        totalContainers: sql<number>`COALESCE(MAX(${usageRecords.containers}), 0)`,
        totalCpuSeconds: sql<number>`COALESCE(SUM(${usageRecords.cpuSeconds}), 0)`,
        totalMemoryMbHours: sql<number>`COALESCE(SUM(${usageRecords.memoryMbHours}), 0)`,
        totalStorageGb: sql<number>`COALESCE(MAX(${usageRecords.storageGb}), 0)`,
        totalBandwidthGb: sql<number>`COALESCE(SUM(${usageRecords.bandwidthGb}), 0)`,
      })
      .from(usageRecords)
      .where(and(...conditions));

    const row = result[0] ?? {
      totalContainers: 0,
      totalCpuSeconds: 0,
      totalMemoryMbHours: 0,
      totalStorageGb: 0,
      totalBandwidthGb: 0,
    };

    // Load pricing rates
    const pricing = await db.query.pricingConfig.findFirst();

    // Check for per-account billing overrides
    const override = await db.query.accountBillingOverrides.findFirst({
      where: eq(accountBillingOverrides.accountId, accountId),
    });

    const rates = {
      cpuCentsPerHour: override?.cpuCentsPerHourOverride ?? pricing?.cpuCentsPerHour ?? 0,
      memoryCentsPerGbHour: override?.memoryCentsPerGbHourOverride ?? pricing?.memoryCentsPerGbHour ?? 0,
      storageCentsPerGbMonth: override?.storageCentsPerGbMonthOverride ?? pricing?.storageCentsPerGbMonth ?? 0,
      bandwidthCentsPerGb: override?.bandwidthCentsPerGbOverride ?? pricing?.bandwidthCentsPerGb ?? 0,
      containerCentsPerHour: override?.containerCentsPerHourOverride ?? pricing?.containerCentsPerHour ?? 0,
    };

    const discountPercent = override?.discountPercent ?? 0;

    // Calculate hours from seconds
    const cpuHours = Number(row.totalCpuSeconds) / 3600;
    const memoryGbHours = Number(row.totalMemoryMbHours) / 1024;

    // Apply location multiplier if enabled
    let locationMultiplier = 1.0;
    if (pricing?.locationPricingEnabled) {
      locationMultiplier = await this.getAccountLocationMultiplier(accountId);
    }

    // Apply discount multiplier (100% - discount%)
    const discountMultiplier = 1 - discountPercent / 100;

    // Calculate cost breakdown
    const cpuCents = Math.round(cpuHours * rates.cpuCentsPerHour * locationMultiplier * discountMultiplier);
    const memoryCents = Math.round(memoryGbHours * rates.memoryCentsPerGbHour * locationMultiplier * discountMultiplier);
    const storageCents = Math.round(Number(row.totalStorageGb) * rates.storageCentsPerGbMonth * locationMultiplier * discountMultiplier);
    const bandwidthCents = Math.round(Number(row.totalBandwidthGb) * rates.bandwidthCentsPerGb * locationMultiplier * discountMultiplier);
    const containerCents = Math.round(
      Number(row.totalContainers) * this.periodHours(start, end) * rates.containerCentsPerHour * locationMultiplier * discountMultiplier,
    );

    return {
      containers: Number(row.totalContainers),
      cpuHours: Math.round(cpuHours * 100) / 100,
      memoryGbHours: Math.round(memoryGbHours * 100) / 100,
      storageGb: Number(row.totalStorageGb),
      bandwidthGb: Number(row.totalBandwidthGb),
      estimatedCostCents: cpuCents + memoryCents + storageCents + bandwidthCents + containerCents,
      breakdown: {
        cpuCents,
        memoryCents,
        storageCents,
        bandwidthCents,
        containerCents,
      },
      periodStart: start,
      periodEnd: end,
    };
  }

  /**
   * Report current usage to Stripe for metered billing.
   * Called hourly for accounts on usage or hybrid billing model.
   */
  async reportUsageToStripe(): Promise<void> {
    try {
      const activeSubscriptions = await db.query.subscriptions.findMany({
        where: and(
          eq(subscriptions.status, 'active'),
        ),
      });

      const usageSubs = activeSubscriptions.filter(
        (s) => s.billingModel === 'usage' || s.billingModel === 'hybrid',
      );

      if (usageSubs.length === 0) return;

      for (const sub of usageSubs) {
        if (!sub.stripeSubscriptionId) continue;

        try {
          const summary = await this.getAccountUsageSummary(
            sub.accountId,
            sub.currentPeriodStart ?? undefined,
            new Date(),
          );

          // Get the Stripe subscription to find metered items
          const stripeSub = await stripeService.getSubscription(sub.stripeSubscriptionId);
          const items = stripeSub.items?.data ?? [];

          for (const item of items) {
            const price = item.price;
            if (!price || price.recurring?.usage_type !== 'metered') continue;

            // Match price to usage type by metadata or known price IDs
            const usageType = (price.metadata as Record<string, string>)?.['usage_type'];
            let quantity = 0;

            switch (usageType) {
              case 'cpu':
                quantity = Math.round(summary.cpuHours * 100); // report in hundredths
                break;
              case 'memory':
                quantity = Math.round(summary.memoryGbHours * 100);
                break;
              case 'storage':
                quantity = summary.storageGb;
                break;
              case 'bandwidth':
                quantity = summary.bandwidthGb;
                break;
              case 'container':
                quantity = summary.containers;
                break;
            }

            if (quantity > 0) {
              await stripeService.reportUsage(item.id, quantity);
            }
          }
        } catch (err) {
          logger.error(
            { err, subscriptionId: sub.id, accountId: sub.accountId },
            'Failed to report usage to Stripe',
          );
        }
      }

      logger.info({ count: usageSubs.length }, 'Stripe usage reporting completed');
    } catch (err) {
      logger.error({ err }, 'Stripe usage reporting failed');
    }
  }

  /**
   * Get the weighted average location multiplier for an account's services.
   */
  private async getAccountLocationMultiplier(accountId: string): Promise<number> {
    const accountServices = await db.query.services.findMany({
      where: and(eq(services.accountId, accountId), eq(services.status, 'running')),
    });

    if (accountServices.length === 0) return 1.0;

    // Get node locations for services with constraints
    const allNodes = await db.query.nodes.findMany();
    const multipliers = await db.query.locationMultipliers.findMany();

    const multiplierMap = new Map(multipliers.map((m) => [m.locationKey, m.multiplier ?? 100]));
    const nodeLocationMap = new Map(
      allNodes.filter((n) => n.location).map((n) => [n.id, n.location!]),
    );

    let totalWeight = 0;
    let weightedMultiplier = 0;

    for (const svc of accountServices) {
      const replicas = svc.replicas ?? 1;
      // Try to find the node location from node constraint
      const nodeLocation = svc.nodeConstraint
        ? nodeLocationMap.get(svc.nodeConstraint)
        : undefined;

      const mult = nodeLocation ? (multiplierMap.get(nodeLocation) ?? 100) : 100;
      weightedMultiplier += mult * replicas;
      totalWeight += replicas;
    }

    return totalWeight > 0 ? weightedMultiplier / (totalWeight * 100) : 1.0;
  }

  private periodHours(start: Date, end: Date): number {
    return (end.getTime() - start.getTime()) / (1000 * 3600);
  }
}

export const usageService = new UsageService();
