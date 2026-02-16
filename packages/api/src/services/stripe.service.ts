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
