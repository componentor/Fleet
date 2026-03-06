import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { db, appTemplates, services, deployments, storageVolumes, stacks, billingPlans, accountBillingOverrides, insertReturning, updateReturning, deleteReturning, eq, and, or, isNull } from '@fleet/db';
import { orchestrator } from './orchestrator.js';
import { getRegistryAuthForImage, isStatefulImage } from './docker.service.js';
import { storageManager } from './storage/storage-manager.js';
import { buildTraefikLabels, ensureIngressRoute } from './traefik.js';
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
  user?: string;
  resources?: { cpuLimit?: number; memoryLimit?: number };
  updateOrder?: 'start-first' | 'stop-first';
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
    const templateServices: TemplateServiceDefinition[] = rawServices.map((s) => {
      const res = s['resources'] as Record<string, unknown> | undefined;
      return {
        name: String(s['name'] ?? ''),
        image: String(s['image'] ?? ''),
        ports: s['ports'] as TemplateServiceDefinition['ports'],
        env: s['env'] as Record<string, string> | undefined,
        volumes: s['volumes'] as TemplateServiceDefinition['volumes'],
        domain: s['domain'] as string | undefined,
        user: s['user'] as string | undefined,
        resources: res ? {
          cpuLimit: typeof res['cpu_limit'] === 'number' ? res['cpu_limit'] : undefined,
          memoryLimit: typeof res['memory_limit'] === 'number' ? res['memory_limit'] : undefined,
        } : undefined,
        updateOrder: s['update_order'] as 'start-first' | 'stop-first' | undefined,
      };
    });

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
    options?: {
      composeOverride?: string;
      imageOverrides?: Record<string, string>;
      domainOverrides?: Record<string, string>;
      resourceOverrides?: Record<string, { replicas?: number; cpuLimit?: number; memoryLimit?: number }>;
      volumeOverrides?: Record<string, { mode: 'create' | 'existing'; sizeGb?: number; existingVolumeName?: string }>;
      volumeGroups?: Array<{
        name: string;
        volumes: string[];
        mode: 'create' | 'existing';
        sizeGb?: number;
        existingVolumeName?: string;
      }>;
      planId?: string;
      skipDeploy?: boolean;
    },
  ): Promise<{
    services: Array<{ id: string; name: string; dockerServiceId: string | null }>;
    stackId: string;
  }> {
    const template = await db.query.appTemplates.findFirst({
      where: eq(appTemplates.slug, slug),
    });

    if (!template) {
      throw new Error(`Template "${slug}" not found`);
    }

    const composeYaml = options?.composeOverride ?? template.composeTemplate;
    const parsed = this.parseTemplate(composeYaml);

    // Create a proper stacks table row instead of a bare UUID
    const [stackRow] = await insertReturning(stacks, {
      accountId,
      name: template.name ?? slug,
      templateSlug: slug,
      status: 'active',
    });
    const stackId = stackRow!.id;

    // Look up plan resource limits if planId is provided
    let planCpuLimit: number | null = null;
    let planMemoryLimit: number | null = null;
    if (options?.planId) {
      const plan = await db.query.billingPlans.findFirst({
        where: eq(billingPlans.id, options.planId),
      });
      if (plan) {
        planCpuLimit = plan.cpuLimit;
        planMemoryLimit = plan.memoryLimit;
        // Apply per-account overrides
        if (accountId) {
          const billingOverride = await db.query.accountBillingOverrides.findFirst({
            where: eq(accountBillingOverrides.accountId, accountId),
          });
          if (billingOverride) {
            // Free tier: direct replacement
            if (plan.isFree) {
              if (billingOverride.freeTierCpuLimit != null) planCpuLimit = billingOverride.freeTierCpuLimit;
              if (billingOverride.freeTierMemoryLimit != null) planMemoryLimit = billingOverride.freeTierMemoryLimit;
            }
            // Boost: all tiers, only increases
            if (billingOverride.boostCpuLimit != null) planCpuLimit = Math.max(planCpuLimit!, billingOverride.boostCpuLimit);
            if (billingOverride.boostMemoryLimit != null) planMemoryLimit = Math.max(planMemoryLimit!, billingOverride.boostMemoryLimit);
          }
        }
      }
    }

    // Build the variable values: use provided config, fall back to defaults, generate passwords
    // Empty strings from the UI are treated as "not provided" so defaults can kick in
    const resolvedVars: Record<string, string> = {};
    for (const variable of parsed.variables) {
      const configValue = config[variable.name];
      if (configValue !== undefined && configValue !== '') {
        resolvedVars[variable.name] = configValue;
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

    // Build a map of service names to their Swarm service names for cross-references.
    // Include a short stack suffix so deploying the same template multiple times
    // produces unique Docker service names (e.g. fleet-a1b2c3d4-wordpress-e5f6g7h8).
    // Use short account ID (12 chars) to stay under Docker's 63-char name limit.
    const accountShort = accountId.replace(/-/g, '').substring(0, 12);
    const swarmNamePrefix = `fleet-${accountShort}`;
    const stackShort = stackId.substring(0, 8);
    const stackNamespace = `${swarmNamePrefix}-${slug}-${stackShort}`;
    const serviceNameMap: Record<string, string> = {};
    for (const svcDef of parsed.services) {
      serviceNameMap[svcDef.name] = `${swarmNamePrefix}-${svcDef.name}-${stackShort}`.toLowerCase();
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

    // Create overlay network so services can resolve each other via DNS
    const networkName = `fleet-account-${accountId}`;
    const networkId = await orchestrator.ensureNetwork(networkName);
    const publicNetId = await orchestrator.ensureNetwork('fleet_fleet_public');

    // Build volume resolution map from volumeGroups so grouped template volumes
    // resolve to the same physical Docker volume name.
    const volumeResolutionMap = new Map<string, string>();
    const groupVolumeConfigs = new Map<string, {
      mode: 'create' | 'existing';
      sizeGb?: number;
      existingVolumeName?: string;
    }>();

    for (const group of options?.volumeGroups ?? []) {
      if (group.volumes.length === 0) continue;
      const primaryVolName = group.volumes[0]!;
      const dockerVolName = (group.mode === 'existing' && group.existingVolumeName)
        ? group.existingVolumeName
        : `${swarmNamePrefix}-${primaryVolName}-${stackShort}`;

      for (const volName of group.volumes) {
        volumeResolutionMap.set(volName, dockerVolName);
      }
      groupVolumeConfigs.set(primaryVolName, {
        mode: group.mode,
        sizeGb: group.sizeGb,
        existingVolumeName: group.existingVolumeName,
      });
    }

    // Create template volumes BEFORE deploying services so that bind-mount
    // paths exist on the host when Docker tries to start containers.
    const hasStorageProvider = storageManager.volumes.isReady();
    if (hasStorageProvider) {
      // Collect volumes that need creation and their sizes
      const volumesToCreate: Array<{ dockerName: string; displayName: string; sizeGb: number }> = [];
      const createdDockerVolumes = new Set<string>();

      for (const volName of parsed.volumes ?? []) {
        let dockerVolName: string;
        let volumeMode: 'create' | 'existing';
        let volumeSizeGb: number;

        if (volumeResolutionMap.has(volName)) {
          // This volume is part of a group — use the shared Docker volume name
          dockerVolName = volumeResolutionMap.get(volName)!;
          if (createdDockerVolumes.has(dockerVolName)) continue; // already handled by group primary

          const groupConfig = groupVolumeConfigs.get(volName);
          volumeMode = groupConfig?.mode ?? 'create';
          volumeSizeGb = groupConfig?.sizeGb ?? 5;
          if (volumeMode === 'existing') {
            createdDockerVolumes.add(dockerVolName);
            continue;
          }
        } else {
          // Individual volume — use volumeOverrides as before
          const override = options?.volumeOverrides?.[volName];
          if (override?.mode === 'existing') continue;
          dockerVolName = `${swarmNamePrefix}-${volName}-${stackShort}`;
          volumeMode = override?.mode ?? 'create';
          volumeSizeGb = override?.sizeGb ?? 5;
        }

        const existing = await db.query.storageVolumes.findFirst({
          where: and(
            eq(storageVolumes.name, dockerVolName),
            eq(storageVolumes.accountId, accountId),
            isNull(storageVolumes.deletedAt),
          ),
        });
        if (!existing) {
          volumesToCreate.push({
            dockerName: dockerVolName,
            displayName: volName,
            sizeGb: volumeSizeGb,
          });
        }
        createdDockerVolumes.add(dockerVolName);
      }

      // Single quota check for total requested storage
      if (volumesToCreate.length > 0) {
        const totalRequestedGb = volumesToCreate.reduce((sum, v) => sum + v.sizeGb, 0);
        await storageManager.enforceStorageQuota(accountId, totalRequestedGb);

        for (const vol of volumesToCreate) {
          try {
            await storageManager.createVolume(
              accountId, vol.dockerName, vol.displayName, vol.sizeGb,
              undefined, undefined, { skipQuotaCheck: true },
            );
          } catch (err) {
            // Surface volume creation errors — silent failures cause bind mount errors later
            if ((err as Error).message?.includes('quota exceeded')) {
              throw err;
            }
            logger.error({ err, volume: vol.dockerName }, 'Failed to create storage volume for template — service may fail to start');
            throw new Error(`Failed to create volume "${vol.displayName}": ${(err as Error).message}`);
          }
        }
      }

      // Brief pause after volume creation to allow GlusterFS to begin replication
      // before Docker tries to schedule tasks on other nodes.
      if (volumesToCreate.length > 0) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    const createdServices: Array<{
      id: string;
      name: string;
      dockerServiceId: string | null;
    }> = [];

    for (const svcDef of parsed.services) {
      // Apply image override if provided (e.g., user selected a different version)
      const image = options?.imageOverrides?.[svcDef.name] ?? svcDef.image;

      // Interpolate env vars
      const resolvedEnv: Record<string, string> = {};
      if (svcDef.env) {
        for (const [key, val] of Object.entries(svcDef.env)) {
          resolvedEnv[key] = interpolate(val);
        }
      }

      // Resolve domain — user override takes precedence over template default
      const resolvedDomain = options?.domainOverrides?.[svcDef.name]
        ?? (svcDef.domain ? interpolate(svcDef.domain) : null);

      // Resolve volumes — grouped volumes share a physical volume, others use overrides
      const resolvedVolumes = (svcDef.volumes ?? []).map((v) => {
        // Check volume groups first
        if (volumeResolutionMap.has(v.source)) {
          return { source: volumeResolutionMap.get(v.source)!, target: v.target, readonly: v.readonly ?? false };
        }
        const override = options?.volumeOverrides?.[v.source];
        const source = (override?.mode === 'existing' && override.existingVolumeName)
          ? override.existingVolumeName
          : `${swarmNamePrefix}-${v.source}-${stackShort}`;
        return { source, target: v.target, readonly: v.readonly ?? false };
      });

      // Apply per-service resource overrides if provided (override > template > null → docker.service defaults)
      // Plan limits take priority when a plan is selected
      const overrides = options?.resourceOverrides?.[svcDef.name];
      const replicas = overrides?.replicas ?? 1;
      const cpuLimit = planCpuLimit ?? overrides?.cpuLimit ?? svcDef.resources?.cpuLimit ?? null;
      const memoryLimit = planMemoryLimit ?? overrides?.memoryLimit ?? svcDef.resources?.memoryLimit ?? null;

      // Insert service record into DB
      const [svc] = await insertReturning(services, {
        accountId,
        name: svcDef.name,
        image,
        replicas,
        env: resolvedEnv,
        ports: svcDef.ports ?? [],
        volumes: resolvedVolumes,
        domain: resolvedDomain || null,
        sslEnabled: true,
        status: options?.skipDeploy ? 'pending_payment' : 'deploying',
        stackId,
        sourceType: 'marketplace',
        cpuLimit,
        memoryLimit,
        planId: options?.planId ?? null,
      });

      if (!svc) {
        throw new Error(`Failed to create service record for ${svcDef.name}`);
      }

      // Deploy to Docker Swarm (skip if waiting for payment)
      let dockerServiceId: string | null = null;
      if (!options?.skipDeploy) {
        try {
          const swarmName = serviceNameMap[svcDef.name]!;

          // Port management: domain services use Traefik, others get auto-allocated ports
          const svcPorts = svcDef.ports ?? [];
          const ingressPorts = resolvedDomain
            ? []
            : await orchestrator.allocateIngressPorts(
                svcPorts.map((p) => ({ target: p.target, protocol: p.protocol ?? 'tcp' })),
              );

          // Build Traefik routing labels for domain services
          const primaryPort = svcDef.ports?.[0]?.target ?? 80;
          const traefikLabels = buildTraefikLabels(swarmName, resolvedDomain, true, primaryPort);

          const templateAuth = await getRegistryAuthForImage(accountId, image);
          const result = await orchestrator.createService({
            name: swarmName,
            image,
            replicas,
            env: resolvedEnv,
            ports: ingressPorts,
            volumes: resolvedVolumes,
            labels: {
              'fleet.account-id': accountId,
              'fleet.service-id': svc.id,
              'fleet.template': slug,
              'fleet.stack-id': stackId,
              'com.docker.compose.project': stackNamespace,
              'com.docker.compose.service': svcDef.name,
              ...traefikLabels,
            },
            constraints: [],
            networkIds: resolvedDomain ? [networkId, publicNetId] : [networkId],
            updateParallelism: 1,
            updateDelay: '10s',
            rollbackOnFailure: true,
            updateOrder: svcDef.updateOrder ?? (isStatefulImage(image) ? 'stop-first' : 'start-first'),
            ...(svcDef.user ? { user: svcDef.user } : {}),
            registryAuth: templateAuth,
          });

          dockerServiceId = result.id;

          await ensureIngressRoute(`fleet-account-${accountId}`, swarmName, resolvedDomain, true, primaryPort).catch(() => {});

          await db
            .update(services)
            .set({
              dockerServiceId,
              status: 'deploying',
              ports: ingressPorts.length > 0 ? ingressPorts : svcPorts,
              updatedAt: new Date(),
            })
            .where(eq(services.id, svc.id));
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error({ err, service: svcDef.name }, `Failed to deploy template service ${svcDef.name}`);
          await db
            .update(services)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(eq(services.id, svc.id));
          // Create a deployment record so the error is visible in the UI
          try {
            await db.insert(deployments).values({
              serviceId: svc.id,
              status: 'failed',
              log: errMsg,
              imageTag: image,
              trigger: 'template',
              completedAt: new Date(),
            });
          } catch { /* best-effort */ }
        }
      }

      createdServices.push({
        id: svc.id,
        name: svcDef.name,
        dockerServiceId,
      });
    }

    return { services: createdServices, stackId };
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
