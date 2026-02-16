// ---------------------------------------------------------------------------
// Email types
// ---------------------------------------------------------------------------

export type EmailStatus = 'queued' | 'sent' | 'failed' | 'bounced';

export type EmailProvider = 'smtp' | 'resend' | 'postmark' | 'sendgrid';

export interface EmailTemplate {
  id: string;
  slug: string;
  subject: string;
  bodyHtml: string;
  variables: string[];
  accountId: string | null;
  enabled: boolean;
  updatedAt: Date;
}

export interface EmailLog {
  id: string;
  templateSlug: string;
  toEmail: string;
  subject: string;
  accountId: string;
  status: EmailStatus;
  sentAt: Date;
  error?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  fromName?: string;
}

export interface ResendConfig {
  apiKey: string;
  fromAddress: string;
  fromName?: string;
}

export interface PostmarkConfig {
  serverToken: string;
  fromAddress: string;
  fromName?: string;
}

export interface SendGridConfig {
  apiKey: string;
  fromAddress: string;
  fromName?: string;
}
