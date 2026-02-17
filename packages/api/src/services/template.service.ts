import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { db, appTemplates, services, insertReturning, updateReturning, deleteReturning, eq, and, or } from '@fleet/db';
import { dockerService } from './docker.service.js';
import { logger } from './logger.js';

// Resolve the templates directory relative to this file
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

export interface TemplateVariable {
  name: string;
  label: string;
  type: 'string' | 'password' | 'number' | 'boolean';
  required?: boolean;
  default?: string;
  generate?: boolean;
}

export interface TemplateServiceDefinition {
  name: string;
  image: string;
  ports?: Array<{ target: number; published?: number; protocol?: string }>;
  env?: Record<string, string>;
  volumes?: Array<{ source: string; target: string; readonly?: boolean }>;
  domain?: string;
}

export interface ParsedTemplate {
  slug: string;
  name: string;
  description: string;
  iconUrl?: string;
  category: string;
  variables: TemplateVariable[];
  services: TemplateServiceDefinition[];
  volumes?: string[];
}

export class TemplateService {
  /**
   * Load built-in templates from YAML files on disk and sync them into the database.
   */
  async syncBuiltinTemplates(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(TEMPLATES_DIR);
    } catch {
      logger.warn({ path: TEMPLATES_DIR }, 'Templates directory not found, skipping sync');
      return;
    }

    const yamlFiles = files.filter(
      (f) => extname(f) === '.yaml' || extname(f) === '.yml',
    );

    for (const file of yamlFiles) {
      const content = await readFile(join(TEMPLATES_DIR, file), 'utf-8');
      const parsed = this.parseTemplate(content);

      const existing = await db.query.appTemplates.findFirst({
        where: eq(appTemplates.slug, parsed.slug),
      });

      if (existing) {
        await db
          .update(appTemplates)
          .set({
            name: parsed.name,
            description: parsed.description,
            iconUrl: parsed.iconUrl ?? null,
            category: parsed.category,
            composeTemplate: content,
            variables: parsed.variables,
            isBuiltin: true,
            updatedAt: new Date(),
          })
          .where(eq(appTemplates.id, existing.id));
      } else {
        await db.insert(appTemplates).values({
          slug: parsed.slug,
          name: parsed.name,
          description: parsed.description,
          iconUrl: parsed.iconUrl ?? null,
          category: parsed.category,
          composeTemplate: content,
          variables: parsed.variables,
          isBuiltin: true,
          accountId: null,
        });
      }
    }
  }

  /**
   * Parse a YAML template string into a structured template object.
   */
  parseTemplate(yamlContent: string): ParsedTemplate {
    const raw = parseYaml(yamlContent) as Record<string, unknown>;

    const variables = ((raw['variables'] as Array<Record<string, unknown>>) ?? []).map(
      (v) => ({
        name: String(v['name'] ?? ''),
        label: String(v['label'] ?? v['name'] ?? ''),
        type: (v['type'] as TemplateVariable['type']) ?? 'string',
        required: v['required'] !== false,
        default: v['default'] !== undefined ? String(v['default']) : undefined,
        generate: v['generate'] === true,
      }),
    );

    const rawServices = (raw['services'] as Array<Record<string, unknown>>) ?? [];
    const templateServices: TemplateServiceDefinition[] = rawServices.map((s) => ({
      name: String(s['name'] ?? ''),
      image: String(s['image'] ?? ''),
      ports: s['ports'] as TemplateServiceDefinition['ports'],
      env: s['env'] as Record<string, string> | undefined,
      volumes: s['volumes'] as TemplateServiceDefinition['volumes'],
      domain: s['domain'] as string | undefined,
    }));

    const volumes = (raw['volumes'] as string[]) ?? [];

    return {
      slug: String(raw['slug'] ?? ''),
      name: String(raw['name'] ?? ''),
      description: String(raw['description'] ?? ''),
      iconUrl: raw['icon_url'] as string | undefined,
      category: String(raw['category'] ?? 'other'),
      variables,
      services: templateServices,
      volumes,
    };
  }

  /**
   * List available templates. Returns both built-in and account-specific templates.
   */
  async listTemplates(filters?: {
    category?: string;
    accountId?: string;
  }): Promise<
    Array<{
      id: string;
      slug: string;
      name: string;
      description: string | null;
      iconUrl: string | null;
      category: string | null;
      variables: unknown;
      isBuiltin: boolean | null;
      createdAt: Date | null;
    }>
  > {
    const conditions = [];

    if (filters?.category) {
      conditions.push(eq(appTemplates.category, filters.category));
    }

    // Show builtin templates + account-specific templates
    if (filters?.accountId) {
      conditions.push(
        or(
          eq(appTemplates.isBuiltin, true),
          eq(appTemplates.accountId, filters.accountId),
        )!,
      );
    } else {
      conditions.push(eq(appTemplates.isBuiltin, true));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const templates = await db.query.appTemplates.findMany({
      where: whereClause,
      orderBy: (t, { asc }) => asc(t.name),
    });

    return templates.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      iconUrl: t.iconUrl,
      category: t.category,
      variables: t.variables,
      isBuiltin: t.isBuiltin,
      createdAt: t.createdAt,
    }));
  }

  /**
   * Get a single template by slug.
   */
  async getTemplate(slug: string): Promise<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    iconUrl: string | null;
    category: string | null;
    variables: unknown;
    isBuiltin: boolean | null;
    composeTemplate: string;
    createdAt: Date | null;
  } | null> {
    const template = await db.query.appTemplates.findFirst({
      where: eq(appTemplates.slug, slug),
    });

    if (!template) return null;

    return {
      id: template.id,
      slug: template.slug,
      name: template.name,
      description: template.description,
      iconUrl: template.iconUrl,
      category: template.category,
      variables: template.variables,
      isBuiltin: template.isBuiltin,
      composeTemplate: template.composeTemplate,
      createdAt: template.createdAt,
    };
  }

  /**
   * Deploy a template by creating Docker Swarm services for each service defined in the template.
   */
  async deployTemplate(
    slug: string,
    accountId: string,
    config: Record<string, string>,
  ): Promise<{
    services: Array<{ id: string; name: string; dockerServiceId: string | null }>;
  }> {
    const template = await db.query.appTemplates.findFirst({
      where: eq(appTemplates.slug, slug),
    });

    if (!template) {
      throw new Error(`Template "${slug}" not found`);
    }

    const parsed = this.parseTemplate(template.composeTemplate);

    // Build the variable values: use provided config, fall back to defaults, generate passwords
    const resolvedVars: Record<string, string> = {};
    for (const variable of parsed.variables) {
      if (config[variable.name] !== undefined) {
        resolvedVars[variable.name] = config[variable.name]!;
      } else if (variable.generate) {
        resolvedVars[variable.name] = randomBytes(16).toString('hex');
      } else if (variable.default !== undefined) {
        resolvedVars[variable.name] = variable.default;
      } else if (variable.required) {
        throw new Error(
          `Missing required variable: ${variable.name} (${variable.label})`,
        );
      }
    }

    // Build a map of service names to their Swarm service names for cross-references
    const swarmNamePrefix = `fleet-${accountId.slice(0, 8)}`;
    const serviceNameMap: Record<string, string> = {};
    for (const svcDef of parsed.services) {
      serviceNameMap[svcDef.name] = `${swarmNamePrefix}-${svcDef.name}`;
    }

    // Helper to interpolate {{variable}} and {{service:name}} placeholders
    const interpolate = (value: string): string => {
      return value.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
        const trimmedKey = key.trim();
        if (trimmedKey.startsWith('service:')) {
          const svcName = trimmedKey.slice('service:'.length);
          return serviceNameMap[svcName] ?? svcName;
        }
        return resolvedVars[trimmedKey] ?? '';
      });
    };

    const createdServices: Array<{
      id: string;
      name: string;
      dockerServiceId: string | null;
    }> = [];

    for (const svcDef of parsed.services) {
      // Interpolate env vars
      const resolvedEnv: Record<string, string> = {};
      if (svcDef.env) {
        for (const [key, val] of Object.entries(svcDef.env)) {
          resolvedEnv[key] = interpolate(val);
        }
      }

      // Resolve domain
      const resolvedDomain = svcDef.domain ? interpolate(svcDef.domain) : null;

      // Resolve volumes — prefix with account to isolate
      const resolvedVolumes = (svcDef.volumes ?? []).map((v) => ({
        source: `${swarmNamePrefix}-${v.source}`,
        target: v.target,
        readonly: v.readonly ?? false,
      }));

      // Insert service record into DB
      const [svc] = await insertReturning(services, {
        accountId,
        name: svcDef.name,
        image: svcDef.image,
        replicas: 1,
        env: resolvedEnv,
        ports: svcDef.ports ?? [],
        volumes: resolvedVolumes,
        domain: resolvedDomain || null,
        sslEnabled: true,
        status: 'deploying',
      });

      if (!svc) {
        throw new Error(`Failed to create service record for ${svcDef.name}`);
      }

      // Deploy to Docker Swarm
      let dockerServiceId: string | null = null;
      try {
        const swarmName = serviceNameMap[svcDef.name]!;

        const result = await dockerService.createService({
          name: swarmName,
          image: svcDef.image,
          replicas: 1,
          env: resolvedEnv,
          ports: (svcDef.ports ?? []).map((p) => ({
            target: p.target,
            published: p.published ?? 0,
            protocol: p.protocol ?? 'tcp',
          })),
          volumes: resolvedVolumes,
          labels: {
            'fleet.account-id': accountId,
            'fleet.service-id': svc.id,
            'fleet.template': slug,
          },
          constraints: [],
          updateParallelism: 1,
          updateDelay: '10s',
          rollbackOnFailure: true,
        });

        dockerServiceId = result.id;

        await db
          .update(services)
          .set({
            dockerServiceId,
            status: 'running',
            updatedAt: new Date(),
          })
          .where(eq(services.id, svc.id));
      } catch (err) {
        logger.error({ err, service: svcDef.name }, `Failed to deploy template service ${svcDef.name}`);
        await db
          .update(services)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(services.id, svc.id));
      }

      createdServices.push({
        id: svc.id,
        name: svcDef.name,
        dockerServiceId,
      });
    }

    return { services: createdServices };
  }

  /**
   * Create a custom template (account-specific or admin builtin).
   */
  async createTemplate(data: {
    slug: string;
    name: string;
    description?: string;
    iconUrl?: string;
    category?: string;
    composeTemplate: string;
    accountId?: string;
    isBuiltin?: boolean;
  }) {
    // Validate and parse the YAML
    const parsed = this.parseTemplate(data.composeTemplate);

    const [template] = await insertReturning(appTemplates, {
      slug: data.slug,
      name: data.name,
      description: data.description ?? '',
      iconUrl: data.iconUrl ?? null,
      category: data.category ?? 'other',
      composeTemplate: data.composeTemplate,
      variables: parsed.variables,
      isBuiltin: data.isBuiltin ?? false,
      accountId: data.accountId ?? null,
    });

    return template;
  }

  /**
   * Update an existing template.
   */
  async updateTemplate(
    templateId: string,
    data: {
      name?: string;
      description?: string;
      iconUrl?: string;
      category?: string;
      composeTemplate?: string;
    },
  ) {
    const updateValues: Record<string, unknown> = { updatedAt: new Date() };

    if (data.name !== undefined) updateValues['name'] = data.name;
    if (data.description !== undefined) updateValues['description'] = data.description;
    if (data.iconUrl !== undefined) updateValues['iconUrl'] = data.iconUrl;
    if (data.category !== undefined) updateValues['category'] = data.category;

    if (data.composeTemplate !== undefined) {
      const parsed = this.parseTemplate(data.composeTemplate);
      updateValues['composeTemplate'] = data.composeTemplate;
      updateValues['variables'] = parsed.variables;
    }

    const [updated] = await updateReturning(
      appTemplates,
      updateValues,
      eq(appTemplates.id, templateId),
    );

    return updated ?? null;
  }

  /**
   * Delete a template.
   */
  async deleteTemplate(templateId: string): Promise<boolean> {
    const result = await deleteReturning(
      appTemplates,
      eq(appTemplates.id, templateId),
    );

    return result.length > 0;
  }

  /**
   * Get all unique template categories.
   */
  async getCategories(): Promise<string[]> {
    const templates = await db.query.appTemplates.findMany({
      columns: { category: true },
    });

    const categories = new Set<string>();
    for (const t of templates) {
      if (t.category) categories.add(t.category);
    }

    return Array.from(categories).sort();
  }
}

export const templateService = new TemplateService();
