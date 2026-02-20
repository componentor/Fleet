import Stripe from 'stripe';

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env['STRIPE_SECRET_KEY'];
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not configured. Set it in your environment or admin settings.');
    }
    _stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
  }
  return _stripe;
}

export class StripeService {
  /**
   * Create a Stripe customer for an account.
   */
  async createCustomer(
    email: string,
    name: string,
  ): Promise<Stripe.Customer> {
    return getStripe().customers.create({ email, name });
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
    return getStripe().checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  }

  /**
   * Create a billing portal session so the customer can manage their subscription.
   */
  async createPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<Stripe.BillingPortal.Session> {
    return getStripe().billingPortal.sessions.create({
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
    return getStripe().subscriptions.retrieve(subscriptionId);
  }

  /**
   * Cancel a subscription at period end.
   */
  async cancelSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    return getStripe().subscriptions.cancel(subscriptionId);
  }

  /**
   * Report metered usage for a subscription item.
   */
  async reportUsage(
    subscriptionItemId: string,
    quantity: number,
  ): Promise<Stripe.Billing.MeterEvent | Stripe.UsageRecord> {
    return getStripe().subscriptionItems.createUsageRecord(subscriptionItemId, {
      quantity,
      timestamp: Math.floor(Date.now() / 1000),
      action: 'increment',
    });
  }

  /**
   * List invoices for a Stripe customer.
   */
  async listInvoices(
    customerId: string,
    limit = 20,
  ): Promise<Stripe.ApiList<Stripe.Invoice>> {
    return getStripe().invoices.list({ customer: customerId, limit });
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

    return getStripe().checkout.sessions.create({
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
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      metadata,
      success_url: successUrl,
      cancel_url: cancelUrl,
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
    return getStripe().products.create({
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
    return getStripe().products.update(productId, data);
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
    return getStripe().prices.create({
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
    return getStripe().prices.list({ product: productId, active: true, limit: 100 });
  }

  /**
   * Update a Stripe subscription (e.g. change items).
   */
  async updateSubscription(
    subscriptionId: string,
    params: Stripe.SubscriptionUpdateParams,
  ): Promise<Stripe.Subscription> {
    return getStripe().subscriptions.update(subscriptionId, params);
  }

  /**
   * Cancel a subscription at period end (instead of immediately).
   */
  async cancelSubscriptionAtPeriodEnd(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    return getStripe().subscriptions.update(subscriptionId, {
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
    return getStripe().checkout.sessions.create({
      customer: customerId,
      mode,
      line_items: lineItems,
      metadata,
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: mode === 'subscription' ? { metadata } : undefined,
    });
  }

  /**
   * List payment methods for a customer.
   */
  async listPaymentMethods(
    customerId: string,
  ): Promise<Stripe.ApiList<Stripe.PaymentMethod>> {
    return getStripe().paymentMethods.list({ customer: customerId, type: 'card' });
  }

  /**
   * Get the default payment method for a customer.
   */
  async getDefaultPaymentMethod(
    customerId: string,
  ): Promise<string | null> {
    const customer = await getStripe().customers.retrieve(customerId) as Stripe.Customer;
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
    await getStripe().customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  /**
   * Create a setup intent so the customer can add a payment method.
   */
  async createSetupIntent(
    customerId: string,
  ): Promise<Stripe.SetupIntent> {
    return getStripe().setupIntents.create({
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
    return getStripe().paymentMethods.detach(paymentMethodId);
  }

  /**
   * Capture a previously authorized payment intent (e.g., after domain registration succeeds).
   */
  async capturePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return getStripe().paymentIntents.capture(paymentIntentId);
  }

  /**
   * Cancel a previously authorized payment intent (e.g., when domain registration fails).
   * Releases the hold on the customer's card — no charge, no refund fees.
   */
  async cancelPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return getStripe().paymentIntents.cancel(paymentIntentId);
  }

  /**
   * Construct and verify a Stripe webhook event from the raw payload and signature.
   */
  constructWebhookEvent(
    payload: string | Buffer,
    signature: string,
  ): Stripe.Event {
    const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET environment variable is not set');
    }
    return getStripe().webhooks.constructEvent(payload, signature, webhookSecret);
  }
}

export const stripeService = new StripeService();
