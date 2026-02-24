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

// ── Shared email layout ────────────────────────────────────────────
// Wraps template body content in a responsive, styled email shell.
// Uses {{__body__}} as the inner content placeholder.
const EMAIL_LAYOUT = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Email</title></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;">
<tr><td align="center" style="padding:48px 24px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08),0 4px 12px rgba(0,0,0,0.04);">
<tr><td style="padding:40px 48px 36px 48px;">
{{__body__}}
</td></tr>
</table>
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="padding:24px 48px;text-align:center;">
<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">This is an automated message. If you didn't expect this email, you can safely ignore it.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

/** Wrap body content in the email layout (skip if body is already a full HTML document) */
function wrapInEmailLayout(bodyHtml: string): string {
  const trimmed = bodyHtml.trimStart().toLowerCase();
  if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
    return bodyHtml;
  }
  return EMAIL_LAYOUT.replace('{{__body__}}', bodyHtml);
}

// ── Reusable HTML snippets for styled templates ────────────────────
const S = {
  h1: 'style="margin:0 0 8px;font-size:24px;font-weight:700;color:#111827;line-height:1.3;"',
  sub: 'style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.5;"',
  p: 'style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;"',
  muted: 'style="margin:0;font-size:13px;color:#9ca3af;line-height:1.5;"',
  mono: `style="margin:0;font-size:14px;color:#111827;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;"`,
  label: 'style="margin:0 0 4px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;"',
} as const;

function btn(href: string, text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:8px;background-color:#4f46e5;"><a href="${href}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">${text}</a></td></tr></table>`;
}

function infoBox(color: 'green' | 'red' | 'amber' | 'blue', title: string): string {
  const colors = {
    green: { bg: '#f0fdf4', border: '#22c55e', text: '#166534' },
    red:   { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
    amber: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
    blue:  { bg: '#f0f9ff', border: '#3b82f6', text: '#1e40af' },
  };
  const c = colors[color];
  return `<div style="padding:16px 20px;background-color:${c.bg};border-radius:8px;border-left:4px solid ${c.border};margin:0 0 24px;"><p style="margin:0;font-size:14px;font-weight:600;color:${c.text};">${title}</p></div>`;
}

function metaBox(label: string, value: string, opts?: { bg?: string; border?: string; monoColor?: string }): string {
  const bg = opts?.bg ?? '#f9fafb';
  const border = opts?.border ?? '#e5e7eb';
  const monoColor = opts?.monoColor ?? '#111827';
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;"><tr><td style="padding:12px 16px;background-color:${bg};border-radius:8px;border:1px solid ${border};"><p ${S.label}>${label}</p><p style="margin:0;font-size:14px;color:${monoColor};font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;">${value}</p></td></tr></table>`;
}

// Default email templates that ship with the platform
const DEFAULT_TEMPLATES: Record<
  string,
  { subject: string; bodyHtml: string; variables: string[] }
> = {
  'email-verification': {
    subject: 'Verify your email address',
    bodyHtml: `<h1 ${S.h1}>Verify your email</h1>
<p ${S.sub}>Confirm your email address to get started.</p>
<p ${S.p}>Hi <strong>{{userName}}</strong>,</p>
<p ${S.p}>Please verify your email address by clicking the button below.</p>
${btn('{{verifyUrl}}', 'Verify Email Address')}
<p ${S.muted}>This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>`,
    variables: ['userName', 'verifyUrl'],
  },
  'welcome': {
    subject: 'Welcome to {{platformName}}',
    bodyHtml: `<h1 ${S.h1}>Welcome aboard!</h1>
<p ${S.sub}>Your account is ready to go.</p>
<p ${S.p}>Hi <strong>{{userName}}</strong>,</p>
<p ${S.p}>Your account on <strong>{{platformName}}</strong> has been created successfully. You can start deploying services right away.</p>
${btn('{{loginUrl}}', 'Go to Dashboard')}
<p ${S.muted}>If you have any questions, check out the documentation or contact support.</p>`,
    variables: ['userName', 'platformName', 'loginUrl'],
  },
  'password-reset': {
    subject: 'Reset your password',
    bodyHtml: `<h1 ${S.h1}>Reset your password</h1>
<p ${S.sub}>We received a request to reset your password.</p>
<p ${S.p}>Hi <strong>{{userName}}</strong>,</p>
<p ${S.p}>Click the button below to choose a new password. This link will expire in <strong>{{expiresIn}}</strong>.</p>
${btn('{{resetUrl}}', 'Reset Password')}
<p ${S.muted}>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>`,
    variables: ['userName', 'resetUrl', 'expiresIn'],
  },
  'invite': {
    subject: 'You have been invited to {{accountName}}',
    bodyHtml: `<h1 ${S.h1}>You're invited!</h1>
<p ${S.sub}>Join a team on {{platformName}}.</p>
<p ${S.p}>Hi <strong>{{userName}}</strong>,</p>
<p ${S.p}>You've been invited to join <strong>{{accountName}}</strong> on <strong>{{platformName}}</strong>. Click below to accept the invitation and get started.</p>
${btn('{{inviteUrl}}', 'Accept Invitation')}
<p ${S.muted}>If you don't recognize this invitation, you can ignore this email.</p>`,
    variables: ['userName', 'accountName', 'platformName', 'inviteUrl'],
  },
  'deploy-success': {
    subject: 'Deployment succeeded: {{serviceName}}',
    bodyHtml: `${infoBox('green', 'Deployment Successful')}
<p ${S.p}>Your service <strong>{{serviceName}}</strong> has been deployed successfully.</p>
${metaBox('Image', '{{imageTag}}')}`,
    variables: ['serviceName', 'imageTag'],
  },
  'deploy-failed': {
    subject: 'Deployment failed: {{serviceName}}',
    bodyHtml: `${infoBox('red', 'Deployment Failed')}
<p ${S.p}>The deployment of <strong>{{serviceName}}</strong> has failed.</p>
${metaBox('Error', '{{errorMessage}}', { bg: '#fef2f2', border: '#fecaca', monoColor: '#7f1d1d' })}
<p ${S.muted}>Check the deployment logs in your dashboard for more details.</p>`,
    variables: ['serviceName', 'errorMessage'],
  },
  'domain-expiry': {
    subject: 'Domain expiring soon: {{domain}}',
    bodyHtml: `${infoBox('amber', 'Domain Expiring Soon')}
<p ${S.p}>Your domain <strong>{{domain}}</strong> will expire on <strong>{{expiryDate}}</strong>.</p>
<p ${S.p}>Please renew it before expiration to avoid losing access to this domain.</p>
${btn('{{renewUrl}}', 'Renew Domain')}`,
    variables: ['domain', 'expiryDate', 'renewUrl'],
  },
  'domain-renewal-upcoming': {
    subject: 'Upcoming auto-renewal: {{domain}}',
    bodyHtml: `<h1 ${S.h1}>Upcoming auto-renewal</h1>
<p ${S.sub}>Your domain will renew automatically.</p>
<p ${S.p}>Your domain <strong>{{domain}}</strong> will auto-renew on <strong>{{chargeDate}}</strong>.</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;"><tr><td style="padding:12px 16px;background-color:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;"><p ${S.label}>Renewal Amount</p><p style="margin:0;font-size:20px;font-weight:700;color:#111827;">{{amount}}</p><p style="margin:4px 0 0;font-size:12px;color:#9ca3af;">for 1-year renewal</p></td></tr></table>
<p ${S.p}>If you do not wish to renew, disable auto-renewal before the charge date.</p>
${btn('{{manageUrl}}', 'Manage Domain')}`,
    variables: ['domain', 'chargeDate', 'amount', 'manageUrl'],
  },
  'domain-renewal-charged': {
    subject: 'Domain renewal payment received: {{domain}}',
    bodyHtml: `${infoBox('green', 'Domain Renewed Successfully')}
<p ${S.p}>Your domain <strong>{{domain}}</strong> has been renewed.</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;"><tr>
<td style="padding:12px 16px;background-color:#f9fafb;border-radius:8px 0 0 8px;border:1px solid #e5e7eb;border-right:none;width:50%;"><p ${S.label}>Amount Charged</p><p style="margin:0;font-size:16px;font-weight:700;color:#111827;">{{amount}}</p></td>
<td style="padding:12px 16px;background-color:#f9fafb;border-radius:0 8px 8px 0;border:1px solid #e5e7eb;width:50%;"><p ${S.label}>New Expiry</p><p style="margin:0;font-size:16px;font-weight:700;color:#111827;">{{newExpiryDate}}</p></td>
</tr></table>
${btn('{{manageUrl}}', 'View Domain')}`,
    variables: ['domain', 'amount', 'newExpiryDate', 'manageUrl'],
  },
  'domain-renewal-failed': {
    subject: 'Domain renewal payment failed: {{domain}}',
    bodyHtml: `${infoBox('red', 'Renewal Payment Failed')}
<p ${S.p}>We were unable to charge your payment method for the renewal of <strong>{{domain}}</strong>.</p>
<p ${S.p}>Your domain expires on <strong>{{expiryDate}}</strong>. Please update your payment method to avoid losing it.</p>
${btn('{{billingUrl}}', 'Update Payment Method')}`,
    variables: ['domain', 'expiryDate', 'billingUrl'],
  },
  'payment-failed': {
    subject: 'Payment failed for your subscription',
    bodyHtml: `${infoBox('red', 'Payment Failed')}
<p ${S.p}>We were unable to process the payment for your <strong>{{planName}}</strong> subscription.</p>
<p ${S.p}>Please update your payment method to avoid service interruption.</p>
${btn('{{billingUrl}}', 'Update Payment')}`,
    variables: ['planName', 'billingUrl'],
  },
  'service-down': {
    subject: 'Service alert: {{serviceName}} is down',
    bodyHtml: `${infoBox('red', 'Service Down')}
<p ${S.p}>Your service <strong>{{serviceName}}</strong> has no running containers.</p>
${metaBox('Last Status', '{{lastStatus}}')}
${btn('{{dashboardUrl}}', 'View Dashboard')}`,
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

    const interpolate = (text: string, escape: boolean): string => {
      return text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
        const value = variables[key] ?? '';
        return escape ? escapeHtml(value) : value;
      });
    };

    const interpolatedHtml = interpolate(bodyHtml, true);

    return {
      subject: interpolate(subject, false), // plain text — no HTML encoding
      html: wrapInEmailLayout(interpolatedHtml),
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

  /**
   * Get the shared email layout HTML (with {{__body__}} placeholder).
   * Used by the admin UI to preview templates with the same layout as sent emails.
   */
  getEmailLayout(): string {
    return EMAIL_LAYOUT;
  }
}

export const emailService = new EmailService();
