// ---------------------------------------------------------------------------
// Marketplace / App Template types
// ---------------------------------------------------------------------------

export type AppCategory =
  | 'cms'
  | 'database'
  | 'monitoring'
  | 'storage'
  | 'dev-tools'
  | 'other';

export interface TemplateVariable {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'password';
  defaultValue?: string;
  required: boolean;
}

export interface AppTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconUrl: string | null;
  category: AppCategory;
  composeTemplate: string;
  variables: TemplateVariable[];
  isBuiltin: boolean;
  accountId: string | null;
}

export interface DeployTemplateInput {
  templateSlug: string;
  name: string;
  domain: string;
  variables: Record<string, string>;
}
