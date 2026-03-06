import Stripe from 'stripe';
import { db, platformSettings, eq } from '@fleet/db';
import { decrypt } from './crypto.service.js';

/** Stripe product tax code for SaaS / cloud services */
export const SAAS_TAX_CODE = 'txcd_10103001';

/** Check if Stripe Tax is enabled in platform settings */
async function isStripeTaxEnabled(): Promise<boolean> {
  try {
    const row = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, 'stripe:taxEnabled'),
    });
    return row?.value === 'true' || row?.value === true;
  } catch {
    return false;
  }
}

let _stripe: Stripe | null = null;

async function getStripe(): Promise<Stripe> {
  if (!_stripe) {
    // 1. Prefer env var
    let key = process.env['STRIPE_SECRET_KEY'];

    // 2. Fall back to DB-stored key (set via admin settings UI)
    if (!key) {
      const row = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, 'stripe:secretKey'),
      });
      if (row?.value && typeof row.value === 'string' && row.value.length > 0) {
        try {
          key = decrypt(row.value);
        } catch {
          // Decryption failed — key was stored without encryption or is corrupt
        }
      }
    }

    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not configured. Set it in your environment or admin settings.');
    }
    _stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
  }
  return _stripe;
}

export class StripeService {
  /**
   * Check if Stripe is configured (env or DB).
   */
  async isConfigured(): Promise<boolean> {
    try {
      await getStripe();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a Stripe customer for an account.
   */
  async createCustomer(
    email: string,
    name: string,
  ): Promise<Stripe.Customer> {
    return (await getStripe()).customers.create({ email, name });
  }

  /**
   * Create a Stripe Checkout session for subscribing to a plan.
   */
  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<Stripe.Checkout.Session> {
    const taxEnabled = await isStripeTaxEnabled();
    return (await getStripe()).checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      ...(taxEnabled && {
        automatic_tax: { enabled: true },
        customer_update: { address: 'auto' },
        billing_address_collection: 'required',
      }),
    });
  }

  /**
   * Create a billing portal session so the customer can manage their subscription.
   */
  async createPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<Stripe.BillingPortal.Session> {
    return (await getStripe()).billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  /**
   * Retrieve a subscription by its Stripe subscription ID.
   */
  async getSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    return (await getStripe()).subscriptions.retrieve(subscriptionId);
  }

  /**
   * Cancel a subscription at period end.
   */
  async cancelSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    return (await getStripe()).subscriptions.cancel(subscriptionId);
  }

  /**
   * Report metered usage for a subscription item.
   */
  async reportUsage(
    subscriptionItemId: string,
    quantity: number,
  ): Promise<Stripe.Billing.MeterEvent | Stripe.UsageRecord> {
    return (await getStripe()).subscriptionItems.createUsageRecord(subscriptionItemId, {
      quantity,
      timestamp: Math.floor(Date.now() / 1000),
      action: 'set',
    });
  }

  /**
   * List invoices for a Stripe customer.
   */
  async listInvoices(
    customerId: string,
    limit = 20,
  ): Promise<Stripe.ApiList<Stripe.Invoice>> {
    return (await getStripe()).invoices.list({ customer: customerId, limit });
  }

  /**
   * Create a one-time Stripe Checkout session for domain purchase/renewal.
   */
  async createDomainCheckoutSession(
    customerId: string,
    domain: string,
    amountCents: number,
    currency: string,
    years: number,
    accountId: string,
    successUrl: string,
    cancelUrl: string,
    registrationId?: string,
  ): Promise<Stripe.Checkout.Session> {
    const metadata: Record<string, string> = {
      type: registrationId ? 'domain_renewal' : 'domain_registration',
      domain,
      years: String(years),
      accountId,
    };
    if (registrationId) {
      metadata['registrationId'] = registrationId;
    }

    const taxEnabled = await isStripeTaxEnabled();
    return (await getStripe()).checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      payment_intent_data: {
        capture_method: 'manual', // Authorize only — capture after registrar confirms
      },
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: registrationId ? `Domain Renewal: ${domain}` : `Domain Registration: ${domain}`,
              description: `${years} year${years > 1 ? 's' : ''}`,
              tax_code: taxEnabled ? 'txcd_10103001' : undefined,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      metadata,
      success_url: successUrl,
      cancel_url: cancelUrl,
      ...(taxEnabled && {
        automatic_tax: { enabled: true },
        customer_update: { address: 'auto' },
        billing_address_collection: 'required',
      }),
    });
  }

  /**
   * Create a Stripe Product.
   */
  async createProduct(
    name: string,
    description?: string,
    metadata?: Record<string, string>,
  ): Promise<Stripe.Product> {
    return (await getStripe()).products.create({
      name,
      description,
      metadata,
    });
  }

  /**
   * Update a Stripe Product.
   */
  async updateProduct(
    productId: string,
    data: { name?: string; description?: string; metadata?: Record<string, string> },
  ): Promise<Stripe.Product> {
    return (await getStripe()).products.update(productId, data);
  }

  /**
   * Create a Stripe Price on a Product.
   */
  async createPrice(
    productId: string,
    unitAmount: number,
    currency: string,
    recurring?: { interval: 'day' | 'week' | 'month' | 'year'; interval_count?: number; usage_type?: 'licensed' | 'metered' },
    metadata?: Record<string, string>,
  ): Promise<Stripe.Price> {
    return (await getStripe()).prices.create({
      product: productId,
      unit_amount: unitAmount,
      currency,
      recurring,
      metadata,
    });
  }

  /**
   * List prices for a Product.
   */
  async listPrices(productId: string): Promise<Stripe.ApiList<Stripe.Price>> {
    return (await getStripe()).prices.list({ product: productId, active: true, limit: 100 });
  }

  /**
   * Update a Stripe subscription (e.g. change items).
   */
  async updateSubscription(
    subscriptionId: string,
    params: Stripe.SubscriptionUpdateParams,
  ): Promise<Stripe.Subscription> {
    return (await getStripe()).subscriptions.update(subscriptionId, params);
  }

  /**
   * Cancel a subscription at period end (instead of immediately).
   */
  async cancelSubscriptionAtPeriodEnd(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    return (await getStripe()).subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  }

  /**
   * Create a Stripe Checkout session with flexible line items.
   */
  async createFlexibleCheckoutSession(
    customerId: string,
    lineItems: Stripe.Checkout.SessionCreateParams.LineItem[],
    metadata: Record<string, string>,
    successUrl: string,
    cancelUrl: string,
    mode: 'subscription' | 'payment' = 'subscription',
  ): Promise<Stripe.Checkout.Session> {
    const taxEnabled = await isStripeTaxEnabled();
    return (await getStripe()).checkout.sessions.create({
      customer: customerId,
      mode,
      line_items: lineItems,
      metadata,
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: mode === 'subscription' ? { metadata } : undefined,
      ...(taxEnabled && {
        automatic_tax: { enabled: true },
        customer_update: { address: 'auto' },
        billing_address_collection: 'required',
      }),
    });
  }

  /**
   * List payment methods for a customer.
   */
  async listPaymentMethods(
    customerId: string,
  ): Promise<Stripe.ApiList<Stripe.PaymentMethod>> {
    return (await getStripe()).paymentMethods.list({ customer: customerId, type: 'card' });
  }

  /**
   * Get the default payment method for a customer.
   */
  async getDefaultPaymentMethod(
    customerId: string,
  ): Promise<string | null> {
    const customer = await (await getStripe()).customers.retrieve(customerId) as Stripe.Customer;
    if (customer.deleted) return null;
    const defaultPm = customer.invoice_settings?.default_payment_method;
    return typeof defaultPm === 'string' ? defaultPm : defaultPm?.id ?? null;
  }

  /**
   * Set the default payment method for a customer.
   */
  async setDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string,
  ): Promise<void> {
    await (await getStripe()).customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  /**
   * Create a setup intent so the customer can add a payment method.
   */
  async createSetupIntent(
    customerId: string,
  ): Promise<Stripe.SetupIntent> {
    return (await getStripe()).setupIntents.create({
      customer: customerId,
      automatic_payment_methods: { enabled: true },
    });
  }

  /**
   * Detach a payment method from a customer.
   */
  async detachPaymentMethod(
    paymentMethodId: string,
  ): Promise<Stripe.PaymentMethod> {
    return (await getStripe()).paymentMethods.detach(paymentMethodId);
  }

  /**
   * Capture a previously authorized payment intent (e.g., after domain registration succeeds).
   */
  async capturePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return (await getStripe()).paymentIntents.capture(paymentIntentId);
  }

  /**
   * Cancel a previously authorized payment intent (e.g., when domain registration fails).
   * Releases the hold on the customer's card — no charge, no refund fees.
   */
  async cancelPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return (await getStripe()).paymentIntents.cancel(paymentIntentId);
  }

  /**
   * Create and finalize a Stripe invoice for automatic domain renewal.
   * Uses the customer's default payment method to charge off-session.
   * Returns the invoice object (check invoice.status for payment result).
   */
  async createDomainRenewalInvoice(
    customerId: string,
    domain: string,
    amountCents: number,
    currency: string,
    years: number,
    accountId: string,
    registrationId: string,
  ): Promise<Stripe.Invoice> {
    const stripe = await getStripe();

    // Create an invoice item (automatically attached to the next invoice)
    await stripe.invoiceItems.create({
      customer: customerId,
      amount: amountCents,
      currency: currency.toLowerCase(),
      description: `Domain Renewal: ${domain} (${years} year${years > 1 ? 's' : ''})`,
      metadata: {
        type: 'domain_renewal',
        domain,
        years: String(years),
        accountId,
        registrationId,
      },
    });

    // Create and finalize the invoice (auto-charges the default payment method)
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'charge_automatically',
      auto_advance: true, // Stripe will attempt to charge immediately
      metadata: {
        type: 'domain_renewal',
        domain,
        years: String(years),
        accountId,
        registrationId,
      },
    });

    // Finalize it so Stripe attempts payment
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    return finalized;
  }

  /**
   * Find an open/paid domain renewal invoice for a specific registration.
   * Used to avoid creating duplicate invoices for the same renewal period.
   */
  async findDomainRenewalInvoice(
    customerId: string,
    registrationId: string,
  ): Promise<Stripe.Invoice | null> {
    const stripe = await getStripe();
    // Search for recent invoices with matching metadata
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 10,
    });

    for (const inv of invoices.data) {
      if (
        inv.metadata?.type === 'domain_renewal' &&
        inv.metadata?.registrationId === registrationId &&
        (inv.status === 'open' || inv.status === 'paid')
      ) {
        return inv;
      }
    }
    return null;
  }

  // ── Stripe Connect methods ──────────────────────────────────────────────────

  /**
   * Create a Stripe Express connected account for a reseller.
   */
  async createConnectAccount(
    email: string,
    metadata: Record<string, string>,
  ): Promise<Stripe.Account> {
    return (await getStripe()).accounts.create({
      type: 'express',
      email,
      metadata,
      capabilities: {
        transfers: { requested: true },
      },
    });
  }

  /**
   * Create an Account Link for Stripe Connect onboarding.
   */
  async createAccountLink(
    connectAccountId: string,
    refreshUrl: string,
    returnUrl: string,
  ): Promise<Stripe.AccountLink> {
    return (await getStripe()).accountLinks.create({
      account: connectAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
  }

  /**
   * Retrieve a connected Stripe account to check onboarding status.
   */
  async getConnectAccount(
    connectAccountId: string,
  ): Promise<Stripe.Account> {
    return (await getStripe()).accounts.retrieve(connectAccountId);
  }

  /**
   * Create a one-time payment checkout with destination charge for reseller markup.
   * Used for domain purchases where reseller markup applies.
   */
  async createPaymentWithConnect(params: {
    customerId: string;
    lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    connectAccountId: string;
    applicationFeeAmount: number;
  }): Promise<Stripe.Checkout.Session> {
    const taxEnabled = await isStripeTaxEnabled();
    return (await getStripe()).checkout.sessions.create({
      customer: params.customerId,
      mode: 'payment',
      line_items: params.lineItems,
      metadata: params.metadata,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      payment_intent_data: {
        application_fee_amount: params.applicationFeeAmount,
        transfer_data: {
          destination: params.connectAccountId,
        },
      },
      ...(taxEnabled && {
        automatic_tax: {
          enabled: true,
          liability: { type: 'account' as const, account: params.connectAccountId },
        },
        customer_update: { address: 'auto' },
        billing_address_collection: 'required',
      }),
    });
  }

  /**
   * Create a subscription checkout with Stripe Connect destination charges.
   * Each invoice payment transfers funds to the reseller's Connect account,
   * minus the platform's application fee.
   */
  async createSubscriptionWithConnect(params: {
    customerId: string;
    lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    connectAccountId: string;
    applicationFeePercent: number;
  }): Promise<Stripe.Checkout.Session> {
    const taxEnabled = await isStripeTaxEnabled();
    return (await getStripe()).checkout.sessions.create({
      customer: params.customerId,
      mode: 'subscription',
      line_items: params.lineItems,
      metadata: params.metadata,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      subscription_data: {
        metadata: params.metadata,
        application_fee_percent: params.applicationFeePercent,
        transfer_data: {
          destination: params.connectAccountId,
        },
        ...(taxEnabled && {
          invoice_settings: {
            issuer: { type: 'account' as const, account: params.connectAccountId },
          },
        }),
      },
      ...(taxEnabled && {
        automatic_tax: {
          enabled: true,
          liability: { type: 'account' as const, account: params.connectAccountId },
        },
        customer_update: { address: 'auto' },
        billing_address_collection: 'required',
      }),
    });
  }

  /**
   * Create a Stripe subscription directly using the customer's default payment method.
   * Used for "parent pays for child" billing where checkout redirect is not needed.
   */
  async createDirectSubscription(params: {
    customerId: string;
    priceId: string;
    metadata: Record<string, string>;
  }): Promise<Stripe.Subscription> {
    return (await getStripe()).subscriptions.create({
      customer: params.customerId,
      items: [{ price: params.priceId }],
      metadata: params.metadata,
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });
  }

  /**
   * Create a Stripe Express login link so a reseller can view their Connect dashboard.
   */
  async createConnectLoginLink(
    connectAccountId: string,
  ): Promise<Stripe.LoginLink> {
    return (await getStripe()).accounts.createLoginLink(connectAccountId);
  }

  /**
   * Update the default payment method for a specific subscription.
   */
  async updateSubscriptionPaymentMethod(
    subscriptionId: string,
    paymentMethodId: string,
  ): Promise<Stripe.Subscription> {
    return (await getStripe()).subscriptions.update(subscriptionId, {
      default_payment_method: paymentMethodId,
    });
  }

  /**
   * Change the plan/price on an existing subscription (upgrade/downgrade).
   * Prorates automatically so the customer pays the difference immediately.
   */
  async updateSubscriptionPlan(
    subscriptionId: string,
    newPriceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData,
  ): Promise<Stripe.Subscription> {
    const stripe = await getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const existingItem = sub.items.data[0];
    if (!existingItem) throw new Error('Subscription has no items');

    // Create an ad-hoc price for the new plan
    const price = await stripe.prices.create({
      currency: newPriceData.currency!,
      product_data: newPriceData.product_data as Stripe.PriceCreateParams.ProductData,
      unit_amount: newPriceData.unit_amount!,
      recurring: newPriceData.recurring as Stripe.PriceCreateParams.Recurring,
    });

    return stripe.subscriptions.update(subscriptionId, {
      items: [{ id: existingItem.id, price: price.id }],
      proration_behavior: 'always_invoice',
    });
  }

  /**
   * Construct and verify a Stripe webhook event from the raw payload and signature.
   */
  async constructWebhookEvent(
    payload: string | Buffer,
    signature: string,
  ): Promise<Stripe.Event> {
    let webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];

    if (!webhookSecret) {
      const row = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, 'stripe:webhookSecret'),
      });
      if (row?.value && typeof row.value === 'string' && row.value.length > 0) {
        try {
          webhookSecret = decrypt(row.value);
        } catch { /* decryption failed */ }
      }
    }

    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured. Set it in your environment or admin settings.');
    }
    return (await getStripe()).webhooks.constructEvent(payload, signature, webhookSecret);
  }
}

export const stripeService = new StripeService();
