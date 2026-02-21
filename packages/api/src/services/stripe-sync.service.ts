import {
  db,
  billingPlans,
  billingConfig,
  pricingConfig,
  platformSettings,
  eq,
} from '@fleet/db';
import { insertReturning, upsert } from '@fleet/db';
import type { BillingModel, BillingCycle, CreateCheckoutInput } from '@fleet/types';
import { stripeService } from './stripe.service.js';
import { logger } from './logger.js';
import { calculateResellerPricing } from '../routes/reseller.js';

/** Cycle → Stripe recurring interval mapping */
const CYCLE_TO_STRIPE: Record<BillingCycle, { interval: 'day' | 'week' | 'month' | 'year'; interval_count: number }> = {
  daily: { interval: 'day', interval_count: 1 },
  weekly: { interval: 'week', interval_count: 1 },
  monthly: { interval: 'month', interval_count: 1 },
  quarterly: { interval: 'month', interval_count: 3 },
  half_yearly: { interval: 'month', interval_count: 6 },
  yearly: { interval: 'year', interval_count: 1 },
};

/** Cycle multiplier for pricing (monthly base) */
const CYCLE_MONTHS: Record<BillingCycle, number> = {
  daily: 1 / 30,
  weekly: 7 / 30,
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

class StripeSyncService {
  /**
   * Sync a single billing plan to Stripe Products + Prices.
   */
  async syncPlanToStripe(planId: string): Promise<void> {
    const plan = await db.query.billingPlans.findFirst({
      where: eq(billingPlans.id, planId),
    });
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const config = await db.query.billingConfig.findFirst();
    const allowedCycles: BillingCycle[] = (config?.allowedCycles as BillingCycle[] | null) ?? ['monthly', 'yearly'];
    const cycleDiscounts = (config?.cycleDiscounts ?? {}) as Record<string, { type: string; value: number }>;

    // Create or update Stripe Product
    let productId = plan.stripeProductId;
    if (productId) {
      await stripeService.updateProduct(productId, {
        name: plan.name,
        description: plan.description ?? undefined,
        metadata: { planId: plan.id, slug: plan.slug },
      });
    } else {
      const product = await stripeService.createProduct(
        plan.name,
        plan.description ?? undefined,
        { planId: plan.id, slug: plan.slug },
      );
      productId = product.id;
    }

    // Create Stripe Prices for each allowed cycle
    const stripePriceIds: Record<string, string> = {};

    for (const cycle of allowedCycles) {
      const stripeInterval = CYCLE_TO_STRIPE[cycle];
      let amount = Math.round(plan.priceCents * CYCLE_MONTHS[cycle]);

      // Apply cycle discount
      const discount = cycleDiscounts[cycle];
      if (discount) {
        if (discount.type === 'percentage') {
          amount = Math.round(amount * (1 - discount.value / 100));
        } else if (discount.type === 'fixed') {
          amount = Math.max(0, amount - discount.value);
        }
      }

      const price = await stripeService.createPrice(
        productId,
        amount,
        'usd',
        {
          interval: stripeInterval.interval,
          interval_count: stripeInterval.interval_count,
        },
        { cycle, planId: plan.id },
      );
      stripePriceIds[cycle] = price.id;
    }

    // Save back to DB
    await db
      .update(billingPlans)
      .set({
        stripeProductId: productId,
        stripePriceIds: stripePriceIds as any,
        updatedAt: new Date(),
      })
      .where(eq(billingPlans.id, planId));

    logger.info({ planId, productId }, `Plan "${plan.name}" synced to Stripe`);
  }

  /**
   * Sync all visible plans to Stripe.
   */
  async syncAllPlans(): Promise<{ synced: number }> {
    const plans = await db.query.billingPlans.findMany({
      where: eq(billingPlans.visible, true),
    });

    let synced = 0;
    for (const plan of plans) {
      if (plan.isFree) continue; // Skip free plans — no Stripe needed
      await this.syncPlanToStripe(plan.id);
      synced++;
    }

    return { synced };
  }

  /**
   * Create/update metered Stripe Products + Prices for usage-based billing.
   * Stores price IDs in platform_settings for reference.
   */
  async ensureMeteredPrices(): Promise<void> {
    const pricing = await db.query.pricingConfig.findFirst();
    if (!pricing) {
      logger.warn('No pricing config found — skipping metered price creation');
      return;
    }

    const meters = [
      { key: 'cpu', name: 'CPU Usage', rate: pricing.cpuCentsPerHour ?? 0, unit: 'hour' },
      { key: 'memory', name: 'Memory Usage', rate: pricing.memoryCentsPerGbHour ?? 0, unit: 'hour' },
      { key: 'storage', name: 'Storage Usage', rate: pricing.storageCentsPerGbMonth ?? 0, unit: 'month' },
      { key: 'bandwidth', name: 'Bandwidth Usage', rate: pricing.bandwidthCentsPerGb ?? 0, unit: 'month' },
      { key: 'container', name: 'Container Usage', rate: pricing.containerCentsPerHour ?? 0, unit: 'hour' },
    ];

    const meteredPriceIds: Record<string, string> = {};

    for (const meter of meters) {
      if (meter.rate <= 0) continue;

      const product = await stripeService.createProduct(
        meter.name,
        `Metered billing for ${meter.key}`,
        { type: 'usage_meter', usage_type: meter.key },
      );

      const price = await stripeService.createPrice(
        product.id,
        meter.rate,
        'usd',
        {
          interval: meter.unit === 'hour' ? 'month' : 'month',
          usage_type: 'metered',
        },
        { usage_type: meter.key },
      );

      meteredPriceIds[meter.key] = price.id;
    }

    // Store in platform_settings
    await upsert(
      platformSettings,
      {
        id: crypto.randomUUID(),
        key: 'billing:meteredPriceIds',
        value: JSON.stringify(meteredPriceIds),
        updatedAt: new Date(),
      },
      platformSettings.key,
      { value: JSON.stringify(meteredPriceIds), updatedAt: new Date() },
    );

    logger.info({ meters: Object.keys(meteredPriceIds) }, 'Metered prices created in Stripe');
  }

  /**
   * Create a Stripe Checkout session based on the billing model.
   * Automatically applies reseller discount + markup for reseller/sub-accounts.
   */
  async createCheckoutSession(input: CreateCheckoutInput & { stripeCustomerId: string }): Promise<{ url: string }> {
    const { billingModel, billingCycle, planId, stripeCustomerId, successUrl, cancelUrl, accountId } = input;

    const metadata: Record<string, string> = {
      billingModel,
      billingCycle,
      accountId,
    };

    if (billingModel === 'fixed' || billingModel === 'hybrid') {
      if (!planId) throw new Error('planId is required for fixed/hybrid billing');

      const plan = await db.query.billingPlans.findFirst({
        where: eq(billingPlans.id, planId),
      });
      if (!plan) throw new Error('Plan not found');

      // Calculate base price with cycle multiplier + cycle discount
      const config = await db.query.billingConfig.findFirst();
      const cycleDiscounts = (config?.cycleDiscounts ?? {}) as Record<string, { type: string; value: number }>;
      let baseAmount = Math.round(plan.priceCents * CYCLE_MONTHS[billingCycle]);
      const cycleDiscount = cycleDiscounts[billingCycle];
      if (cycleDiscount) {
        if (cycleDiscount.type === 'percentage') {
          baseAmount = Math.round(baseAmount * (1 - cycleDiscount.value / 100));
        } else if (cycleDiscount.type === 'fixed') {
          baseAmount = Math.max(0, baseAmount - cycleDiscount.value);
        }
      }

      // Apply reseller pricing (discount for reseller, markup for sub-accounts)
      const resellerPricing = await calculateResellerPricing(accountId, baseAmount);

      if (resellerPricing.resellerConnectId && resellerPricing.markupAmount > 0) {
        // Sub-account with reseller markup → use Stripe Connect destination charge
        metadata['resellerDiscount'] = String(resellerPricing.discountAmount);
        metadata['resellerMarkup'] = String(resellerPricing.markupAmount);
        metadata['planId'] = planId;

        const session = await stripeService.createPaymentWithConnect({
          customerId: stripeCustomerId,
          lineItems: [{
            price_data: {
              currency: 'usd',
              product_data: { name: plan.name, description: `${billingCycle} subscription` },
              unit_amount: resellerPricing.finalPrice,
              recurring: CYCLE_TO_STRIPE[billingCycle],
            },
            quantity: 1,
          }],
          metadata,
          successUrl,
          cancelUrl,
          connectAccountId: resellerPricing.resellerConnectId,
          applicationFeeAmount: resellerPricing.finalPrice - resellerPricing.markupAmount,
        });
        return { url: session.url! };
      }

      if (resellerPricing.discountAmount > 0) {
        // Reseller themselves (discount but no markup) → use price_data with adjusted amount
        metadata['resellerDiscount'] = String(resellerPricing.discountAmount);
        metadata['planId'] = planId;

        const lineItems: import('stripe').Stripe.Checkout.SessionCreateParams.LineItem[] = [{
          price_data: {
            currency: 'usd',
            product_data: { name: plan.name, description: `${billingCycle} subscription (reseller rate)` },
            unit_amount: resellerPricing.finalPrice,
            recurring: CYCLE_TO_STRIPE[billingCycle],
          },
          quantity: 1,
        }];

        if (billingModel === 'hybrid') {
          const meteredIds = await this.getMeteredPriceIds();
          for (const [, meterPriceId] of Object.entries(meteredIds)) {
            lineItems.push({ price: meterPriceId });
          }
        }

        const session = await stripeService.createFlexibleCheckoutSession(
          stripeCustomerId,
          lineItems,
          metadata,
          successUrl,
          cancelUrl,
        );
        return { url: session.url! };
      }

      // No reseller pricing — use existing Stripe Price IDs
      const priceIds = (plan.stripePriceIds ?? {}) as Record<string, string>;
      const priceId = priceIds[billingCycle];
      if (!priceId) throw new Error(`No Stripe price for cycle "${billingCycle}" on plan "${plan.name}"`);

      metadata['planId'] = planId;

      const lineItems: { price: string; quantity?: number }[] = [
        { price: priceId, quantity: 1 },
      ];

      // For hybrid: also add metered price items
      if (billingModel === 'hybrid') {
        const meteredIds = await this.getMeteredPriceIds();
        for (const [, meterPriceId] of Object.entries(meteredIds)) {
          lineItems.push({ price: meterPriceId });
        }
      }

      const session = await stripeService.createFlexibleCheckoutSession(
        stripeCustomerId,
        lineItems,
        metadata,
        successUrl,
        cancelUrl,
      );

      return { url: session.url! };
    }

    // Pure usage-based: only metered items
    if (billingModel === 'usage') {
      const meteredIds = await this.getMeteredPriceIds();
      const lineItems = Object.values(meteredIds).map((priceId) => ({
        price: priceId,
      }));

      if (lineItems.length === 0) {
        throw new Error('No metered prices configured. Set up usage pricing first.');
      }

      const session = await stripeService.createFlexibleCheckoutSession(
        stripeCustomerId,
        lineItems,
        metadata,
        successUrl,
        cancelUrl,
      );

      return { url: session.url! };
    }

    throw new Error(`Unknown billing model: ${billingModel}`);
  }

  /**
   * Load metered price IDs from platform_settings.
   */
  private async getMeteredPriceIds(): Promise<Record<string, string>> {
    const row = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, 'billing:meteredPriceIds'),
    });
    if (!row) return {};
    try {
      return JSON.parse(row.value as string);
    } catch {
      return {};
    }
  }
}

export const stripeSyncService = new StripeSyncService();
