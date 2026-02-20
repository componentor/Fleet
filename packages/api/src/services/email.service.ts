import { db, emailTemplates, emailLog, insertReturning, eq, and } from '@fleet/db';
import { createTransport, type Transporter } from 'nodemailer';
import { getValkey } from './valkey.service.js';

export interface EmailProvider {
  name: string;
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<{ messageId: string }>;
}

/**
 * SMTP provider using nodemailer.
 * Configured via environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
class SmtpProvider implements EmailProvider {
  name = 'smtp';
  private transporter: Transporter;
  private from: string;

  constructor() {
    const host = process.env['SMTP_HOST'] ?? 'localhost';
    const port = parseInt(process.env['SMTP_PORT'] ?? '587', 10);
    const user = process.env['SMTP_USER'];
    const pass = process.env['SMTP_PASS'];
    this.from = process.env['SMTP_FROM'] ?? 'noreply@fleet.app';

    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,
      ...(user && pass
        ? {
            auth: {
              user,
              pass,
            },
          }
        : {}),
    });
  }

  async sendMail(options: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<{ messageId: string }> {
    const info = await this.transporter.sendMail({
      from: options.from || this.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    return { messageId: info.messageId };
  }
}

/**
 * Resend provider using the Resend HTTP API.
 * Configured via environment variables:
 *   RESEND_API_KEY, RESEND_FROM
 */
class ResendProvider implements EmailProvider {
  name = 'resend';
  private apiKey: string;
  private from: string;

  constructor() {
    this.apiKey = process.env['RESEND_API_KEY'] ?? '';
    this.from = process.env['RESEND_FROM'] ?? 'noreply@fleet.app';
  }

  async sendMail(options: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<{ messageId: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: options.from || this.from,
        to: [options.to],
        subject: options.subject,
        html: options.html,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Resend API error: ${response.status} ${errorBody}`);
    }

    const data = (await response.json()) as { id: string };
    return { messageId: data.id };
  }
}

// Default email templates that ship with the platform
const DEFAULT_TEMPLATES: Record<
  string,
  { subject: string; bodyHtml: string; variables: string[] }
> = {
  'email-verification': {
    subject: 'Verify your email address',
    bodyHtml: `<h1>Verify Your Email</h1>
<p>Hi {{userName}},</p>
<p>Please verify your email address by clicking the link below:</p>
<p><a href="{{verifyUrl}}">Verify Email</a></p>
<p>This link expires in 24 hours.</p>`,
    variables: ['userName', 'verifyUrl'],
  },
  'welcome': {
    subject: 'Welcome to {{platformName}}',
    bodyHtml: `<h1>Welcome, {{userName}}!</h1>
<p>Your account on <strong>{{platformName}}</strong> has been created successfully.</p>
<p>You can log in at <a href="{{loginUrl}}">{{loginUrl}}</a>.</p>`,
    variables: ['userName', 'platformName', 'loginUrl'],
  },
  'password-reset': {
    subject: 'Reset your password',
    bodyHtml: `<h1>Password Reset</h1>
<p>Hi {{userName}},</p>
<p>Click the link below to reset your password:</p>
<p><a href="{{resetUrl}}">{{resetUrl}}</a></p>
<p>This link expires in {{expiresIn}}.</p>`,
    variables: ['userName', 'resetUrl', 'expiresIn'],
  },
  'invite': {
    subject: 'You have been invited to {{accountName}}',
    bodyHtml: `<h1>Account Invitation</h1>
<p>Hi {{userName}},</p>
<p>You have been invited to join <strong>{{accountName}}</strong> on {{platformName}}.</p>
<p>Click below to accept the invitation:</p>
<p><a href="{{inviteUrl}}">Accept Invitation</a></p>`,
    variables: ['userName', 'accountName', 'platformName', 'inviteUrl'],
  },
  'deploy-success': {
    subject: 'Deployment succeeded: {{serviceName}}',
    bodyHtml: `<h1>Deployment Successful</h1>
<p>Your service <strong>{{serviceName}}</strong> has been deployed successfully.</p>
<p>Image: {{imageTag}}</p>`,
    variables: ['serviceName', 'imageTag'],
  },
  'deploy-failed': {
    subject: 'Deployment failed: {{serviceName}}',
    bodyHtml: `<h1>Deployment Failed</h1>
<p>The deployment of <strong>{{serviceName}}</strong> has failed.</p>
<p>Error: {{errorMessage}}</p>
<p>Please check the deployment logs for more details.</p>`,
    variables: ['serviceName', 'errorMessage'],
  },
  'domain-expiry': {
    subject: 'Domain expiring soon: {{domain}}',
    bodyHtml: `<h1>Domain Expiration Notice</h1>
<p>Your domain <strong>{{domain}}</strong> will expire on <strong>{{expiryDate}}</strong>.</p>
<p>Please renew it before expiration to avoid losing it.</p>
<p><a href="{{renewUrl}}">Renew Now</a></p>`,
    variables: ['domain', 'expiryDate', 'renewUrl'],
  },
  'domain-renewal-upcoming': {
    subject: 'Upcoming auto-renewal: {{domain}}',
    bodyHtml: `<h1>Domain Auto-Renewal Notice</h1>
<p>Your domain <strong>{{domain}}</strong> will auto-renew on <strong>{{chargeDate}}</strong>.</p>
<p>You will be charged <strong>{{amount}}</strong> for a 1-year renewal.</p>
<p>If you do not wish to renew, disable auto-renewal before the charge date.</p>
<p><a href="{{manageUrl}}">Manage Domain</a></p>`,
    variables: ['domain', 'chargeDate', 'amount', 'manageUrl'],
  },
  'domain-renewal-charged': {
    subject: 'Domain renewal payment received: {{domain}}',
    bodyHtml: `<h1>Domain Renewal Confirmed</h1>
<p>Your domain <strong>{{domain}}</strong> has been renewed successfully.</p>
<p>Amount charged: <strong>{{amount}}</strong></p>
<p>New expiry date: <strong>{{newExpiryDate}}</strong></p>
<p><a href="{{manageUrl}}">View Domain</a></p>`,
    variables: ['domain', 'amount', 'newExpiryDate', 'manageUrl'],
  },
  'domain-renewal-failed': {
    subject: 'Domain renewal payment failed: {{domain}}',
    bodyHtml: `<h1>Domain Renewal Payment Failed</h1>
<p>We were unable to charge your payment method for the renewal of <strong>{{domain}}</strong>.</p>
<p>Your domain expires on <strong>{{expiryDate}}</strong>. Please update your payment method to avoid losing it.</p>
<p><a href="{{billingUrl}}">Update Payment Method</a></p>`,
    variables: ['domain', 'expiryDate', 'billingUrl'],
  },
  'payment-failed': {
    subject: 'Payment failed for your subscription',
    bodyHtml: `<h1>Payment Failed</h1>
<p>We were unable to process the payment for your <strong>{{planName}}</strong> subscription.</p>
<p>Please update your payment method to avoid service interruption.</p>
<p><a href="{{billingUrl}}">Update Payment</a></p>`,
    variables: ['planName', 'billingUrl'],
  },
  'service-down': {
    subject: 'Service alert: {{serviceName}} is down',
    bodyHtml: `<h1>Service Down</h1>
<p>Your service <strong>{{serviceName}}</strong> has no running containers.</p>
<p>Last status: {{lastStatus}}</p>
<p><a href="{{dashboardUrl}}">View Dashboard</a></p>`,
    variables: ['serviceName', 'lastStatus', 'dashboardUrl'],
  },
};

// Per-recipient rate limiting: max emails per time window
const EMAIL_RATE_LIMIT_WINDOW_S = 3600; // 1 hour in seconds
const EMAIL_RATE_LIMIT_MAX = 10; // max 10 emails per recipient per hour

// In-memory fallback when Valkey is unavailable
const emailRateMap = new Map<string, { count: number; resetAt: number }>();

function checkEmailRateLimitLocal(key: string): boolean {
  const now = Date.now();
  const entry = emailRateMap.get(key);
  if (!entry || now >= entry.resetAt) {
    emailRateMap.set(key, { count: 1, resetAt: now + EMAIL_RATE_LIMIT_WINDOW_S * 1000 });
    return true;
  }
  if (entry.count >= EMAIL_RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

async function checkEmailRateLimit(to: string): Promise<boolean> {
  const key = `fleet:email:rate:${to.toLowerCase()}`;
  try {
    const valkey = await getValkey();
    if (valkey) {
      // Use single SET NX EX + INCR to avoid race where crash between INCR and EXPIRE
      // leaves a key with no TTL, permanently blocking emails to this recipient
      await valkey.set(key, '0', 'EX', EMAIL_RATE_LIMIT_WINDOW_S, 'NX');
      const count = await valkey.incr(key);
      return count <= EMAIL_RATE_LIMIT_MAX;
    }
  } catch {
    // Valkey error — fall through to in-memory
  }
  return checkEmailRateLimitLocal(to.toLowerCase());
}

export class EmailService {
  private provider: EmailProvider | null = null;

  /**
   * Get or create the configured email provider.
   */
  getProvider(): EmailProvider {
    if (this.provider) return this.provider;

    const providerName = process.env['EMAIL_PROVIDER'] ?? 'smtp';

    switch (providerName.toLowerCase()) {
      case 'resend':
        this.provider = new ResendProvider();
        break;
      case 'smtp':
      default:
        this.provider = new SmtpProvider();
        break;
    }

    return this.provider;
  }

  /**
   * Reset the cached provider so the next call picks up new config.
   */
  resetProvider(): void {
    this.provider = null;
  }

  /**
   * Render an email template by substituting {{variable}} placeholders.
   */
  async renderTemplate(
    slug: string,
    variables: Record<string, string>,
    accountId?: string | null,
  ): Promise<{ subject: string; html: string }> {
    // Look for an account-specific override first, then a global template
    let template = accountId
      ? await db.query.emailTemplates.findFirst({
          where: and(
            eq(emailTemplates.slug, slug),
            eq(emailTemplates.accountId, accountId),
          ),
        })
      : null;

    if (!template) {
      template = await db.query.emailTemplates.findFirst({
        where: and(
          eq(emailTemplates.slug, slug),
        ),
      });
    }

    // Fall back to built-in default
    const defaultTpl = DEFAULT_TEMPLATES[slug];

    const subject = template?.subject ?? defaultTpl?.subject ?? slug;
    const bodyHtml =
      template?.bodyHtml ?? defaultTpl?.bodyHtml ?? '<p>{{body}}</p>';

    const escapeHtml = (str: string): string =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const interpolate = (text: string): string => {
      return text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
        const value = variables[key] ?? '';
        return escapeHtml(value);
      });
    };

    return {
      subject: interpolate(subject),
      html: interpolate(bodyHtml),
    };
  }

  /**
   * Send an email directly.
   */
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    accountId?: string | null,
  ): Promise<{ messageId: string }> {
    if (!(await checkEmailRateLimit(to))) {
      throw new Error(`Email rate limit exceeded for recipient ${to}`);
    }
    const provider = this.getProvider();
    const from =
      process.env['SMTP_FROM'] ??
      process.env['RESEND_FROM'] ??
      'noreply@fleet.app';

    // Log the email attempt
    const [logEntry] = await insertReturning(emailLog, {
      templateSlug: 'direct',
      toEmail: to,
      subject,
      accountId: accountId ?? null,
      status: 'sending',
    });

    try {
      const result = await provider.sendMail({ from, to, subject, html });

      // Update log with success
      if (logEntry) {
        await db
          .update(emailLog)
          .set({ status: 'sent', sentAt: new Date() })
          .where(eq(emailLog.id, logEntry.id));
      }

      return result;
    } catch (err) {
      // Update log with failure
      if (logEntry) {
        await db
          .update(emailLog)
          .set({
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          })
          .where(eq(emailLog.id, logEntry.id));
      }

      throw err;
    }
  }

  /**
   * Send a templated email.
   */
  async sendTemplateEmail(
    slug: string,
    to: string,
    variables: Record<string, string>,
    accountId?: string | null,
  ): Promise<{ messageId: string }> {
    if (!(await checkEmailRateLimit(to))) {
      throw new Error(`Email rate limit exceeded for recipient ${to}`);
    }
    const { subject, html } = await this.renderTemplate(
      slug,
      variables,
      accountId,
    );

    const provider = this.getProvider();
    const from =
      process.env['SMTP_FROM'] ??
      process.env['RESEND_FROM'] ??
      'noreply@fleet.app';

    // Log the email attempt
    const [logEntry] = await insertReturning(emailLog, {
      templateSlug: slug,
      toEmail: to,
      subject,
      accountId: accountId ?? null,
      status: 'sending',
    });

    try {
      const result = await provider.sendMail({ from, to, subject, html });

      if (logEntry) {
        await db
          .update(emailLog)
          .set({ status: 'sent', sentAt: new Date() })
          .where(eq(emailLog.id, logEntry.id));
      }

      return result;
    } catch (err) {
      if (logEntry) {
        await db
          .update(emailLog)
          .set({
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          })
          .where(eq(emailLog.id, logEntry.id));
      }

      throw err;
    }
  }

  /**
   * Get the default templates bundled with the platform.
   */
  getDefaultTemplates(): Record<
    string,
    { subject: string; bodyHtml: string; variables: string[] }
  > {
    return DEFAULT_TEMPLATES;
  }
}

export const emailService = new EmailService();
