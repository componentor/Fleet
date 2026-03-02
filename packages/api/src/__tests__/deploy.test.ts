import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import './setup.js';
import { app } from '../app.js';
import { createTestUser } from './setup.js';
import { db, appTemplates, services, deployments, eq } from '@fleet/db';

// ── Real TemplateService (uses mocked Docker + storage, real in-memory DB) ──
const realModule = await vi.importActual('../services/template.service.js') as any;
const realTemplateService = new realModule.TemplateService();

// ── Mocked services for assertions ──
const { orchestrator: dockerService } = await import('../services/orchestrator.js') as any;
const { storageManager } = await import('../services/storage/storage-manager.js') as any;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Inline YAML Templates ──

const SINGLE_SERVICE_YAML = [
  'slug: test-single',
  'name: Test Single',
  'description: Simple nginx',
  'category: web',
  '',
  'services:',
  '  - name: nginx',
  '    image: nginx:latest',
  '    ports:',
  '      - target: 80',
  '        published: 80',
].join('\n');

const WORDPRESS_YAML = [
  'slug: test-wordpress',
  'name: WordPress',
  'description: WordPress with MySQL',
  'category: cms',
  '',
  'variables:',
  '  - name: MYSQL_ROOT_PASSWORD',
  '    label: MySQL Root Password',
  '    type: password',
  '    required: true',
  '    generate: true',
  '  - name: MYSQL_DATABASE',
  '    label: Database Name',
  '    type: string',
  '    default: wordpress',
  '  - name: MYSQL_USER',
  '    label: Database User',
  '    type: string',
  '    default: wordpress',
  '  - name: MYSQL_PASSWORD',
  '    label: Database Password',
  '    type: password',
  '    required: true',
  '    generate: true',
  '  - name: WORDPRESS_DOMAIN',
  '    label: Domain',
  '    type: string',
  '    required: false',
  '    default: localhost',
  '',
  'services:',
  '  - name: wordpress',
  '    image: wordpress:6.7-apache',
  '    ports:',
  '      - target: 80',
  '        published: 8080',
  '    env:',
  '      WORDPRESS_DB_HOST: "{{service:wordpress-db}}:3306"',
  '      WORDPRESS_DB_NAME: "{{MYSQL_DATABASE}}"',
  '      WORDPRESS_DB_USER: "{{MYSQL_USER}}"',
  '      WORDPRESS_DB_PASSWORD: "{{MYSQL_PASSWORD}}"',
  '    volumes:',
  '      - source: wordpress_data',
  '        target: /var/www/html',
  '    domain: "{{WORDPRESS_DOMAIN}}"',
  '',
  '  - name: wordpress-db',
  '    image: mysql:8.4',
  '    env:',
  '      MYSQL_ROOT_PASSWORD: "{{MYSQL_ROOT_PASSWORD}}"',
  '      MYSQL_DATABASE: "{{MYSQL_DATABASE}}"',
  '      MYSQL_USER: "{{MYSQL_USER}}"',
  '      MYSQL_PASSWORD: "{{MYSQL_PASSWORD}}"',
  '    volumes:',
  '      - source: wordpress_db_data',
  '        target: /var/lib/mysql',
  '    resources:',
  '      memory_limit: 1024',
  '',
  'volumes:',
  '  - wordpress_data',
  '  - wordpress_db_data',
].join('\n');

const MULTI_VOLUME_YAML = [
  'slug: test-multi-vol',
  'name: Multi Volume',
  'description: 4 volumes across 2 services',
  'category: test',
  '',
  'services:',
  '  - name: app',
  '    image: app:latest',
  '    volumes:',
  '      - source: vol_a',
  '        target: /data/a',
  '      - source: vol_b',
  '        target: /data/b',
  '  - name: worker',
  '    image: worker:latest',
  '    volumes:',
  '      - source: vol_c',
  '        target: /data/c',
  '      - source: vol_d',
  '        target: /data/d',
  '',
  'volumes:',
  '  - vol_a',
  '  - vol_b',
  '  - vol_c',
  '  - vol_d',
].join('\n');

const NO_DOMAIN_YAML = [
  'slug: test-no-domain',
  'name: No Domain',
  'description: Ports but no domain',
  'category: test',
  '',
  'services:',
  '  - name: api',
  '    image: api:latest',
  '    ports:',
  '      - target: 3000',
  '        published: 3000',
].join('\n');

const REQUIRED_VAR_YAML = [
  'slug: test-required-var',
  'name: Required Var',
  'description: Has a required variable',
  'category: test',
  '',
  'variables:',
  '  - name: API_KEY',
  '    label: API Key',
  '    type: string',
  '    required: true',
  '',
  'services:',
  '  - name: api',
  '    image: api:latest',
  '    env:',
  '      API_KEY: "{{API_KEY}}"',
].join('\n');

// ── Helpers ──

async function seedTemplate(slug: string, yaml: string) {
  await db.insert(appTemplates).values({
    id: crypto.randomUUID(),
    slug,
    name: slug,
    description: '',
    composeTemplate: yaml,
    variables: '[]',
    isBuiltin: true,
  } as any);
}

async function deploy(
  slug: string,
  accountId: string,
  config: Record<string, string> = {},
  options?: any,
) {
  return realTemplateService.deployTemplate(slug, accountId, config, options);
}

// ── Tests ──

describe('Template Deployment E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Happy Path: Single Service ───────────────────────────────

  describe('Happy Path: Single Service', () => {
    it('deploys template and creates DB records', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-single', SINGLE_SERVICE_YAML);

      const result = await deploy('test-single', account.id);

      expect(result.services).toHaveLength(1);
      expect(result.services[0].name).toBe('nginx');
      expect(result.services[0].dockerServiceId).toBe('docker-svc-123');

      const dbSvcs = await db.query.services.findMany({
        where: eq(services.accountId, account.id),
      });
      expect(dbSvcs).toHaveLength(1);
      expect(dbSvcs[0]!.name).toBe('nginx');
      expect(dbSvcs[0]!.status).toBe('deploying');
      expect(dbSvcs[0]!.stackId).toBeTruthy();
    });

    it('returns valid UUID stackId', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-single', SINGLE_SERVICE_YAML);

      const result = await deploy('test-single', account.id);

      expect(result.stackId).toMatch(UUID_RE);
    });

    it('calls dockerService.createService with correct params', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-single', SINGLE_SERVICE_YAML);

      const result = await deploy('test-single', account.id);

      expect(dockerService.createService).toHaveBeenCalledOnce();
      const args = dockerService.createService.mock.calls[0][0];
      expect(args.image).toBe('nginx:latest');
      expect(args.name).toContain('nginx');
      expect(args.labels['fleet.account-id']).toBe(account.id);
      expect(args.labels['fleet.template']).toBe('test-single');
      expect(args.labels['fleet.stack-id']).toBe(result.stackId);
    });
  });

  // ─── Multi-Service Stack ──────────────────────────────────────

  describe('Multi-Service Stack', () => {
    it('deploys both wordpress and wordpress-db services', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-wordpress', WORDPRESS_YAML);

      const result = await deploy('test-wordpress', account.id);

      expect(result.services).toHaveLength(2);
      const names = result.services.map((s: any) => s.name).sort();
      expect(names).toEqual(['wordpress', 'wordpress-db']);
    });

    it('resolves {{service:wordpress-db}} to Swarm name in env', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-wordpress', WORDPRESS_YAML);

      await deploy('test-wordpress', account.id);

      const wpCall = dockerService.createService.mock.calls.find(
        (c: any) => c[0].name.includes('wordpress') && !c[0].name.includes('wordpress-db'),
      );
      expect(wpCall).toBeDefined();
      const env = wpCall[0].env;
      expect(env.WORDPRESS_DB_HOST).not.toContain('{{');
      expect(env.WORDPRESS_DB_HOST).toContain('wordpress-db');
      expect(env.WORDPRESS_DB_HOST).toMatch(/:3306$/);
    });

    it('generates passwords for generate:true variables', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-wordpress', WORDPRESS_YAML);

      await deploy('test-wordpress', account.id);

      const dbCall = dockerService.createService.mock.calls.find(
        (c: any) => c[0].name.includes('wordpress-db'),
      );
      const env = dbCall[0].env;
      expect(env.MYSQL_ROOT_PASSWORD).toBeTruthy();
      expect(env.MYSQL_ROOT_PASSWORD.length).toBeGreaterThanOrEqual(16);
      expect(env.MYSQL_PASSWORD).toBeTruthy();
      expect(env.MYSQL_PASSWORD.length).toBeGreaterThanOrEqual(16);
    });

    it('uses user-provided config over defaults', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-wordpress', WORDPRESS_YAML);

      await deploy('test-wordpress', account.id, {
        MYSQL_DATABASE: 'custom_db',
        MYSQL_USER: 'custom_user',
      });

      const dbCall = dockerService.createService.mock.calls.find(
        (c: any) => c[0].name.includes('wordpress-db'),
      );
      expect(dbCall[0].env.MYSQL_DATABASE).toBe('custom_db');
      expect(dbCall[0].env.MYSQL_USER).toBe('custom_user');
    });
  });

  // ─── Domain Routing [Regression #4] ──────────────────────────

  describe('Domain Routing', () => {
    it('adds public network for domain services', async () => {
      dockerService.ensureNetwork
        .mockResolvedValueOnce('acct-net')
        .mockResolvedValueOnce('public-net');

      const { account } = await createTestUser();
      await seedTemplate('test-wordpress', WORDPRESS_YAML);

      await deploy('test-wordpress', account.id, { WORDPRESS_DOMAIN: 'test.example.com' });

      const wpCall = dockerService.createService.mock.calls.find(
        (c: any) => c[0].name.includes('wordpress') && !c[0].name.includes('wordpress-db'),
      );
      expect(wpCall[0].networkIds).toHaveLength(2);
      expect(wpCall[0].networkIds).toContain('acct-net');
      expect(wpCall[0].networkIds).toContain('public-net');
    });

    it('single network for non-domain services', async () => {
      dockerService.ensureNetwork
        .mockResolvedValueOnce('acct-net')
        .mockResolvedValueOnce('public-net');

      const { account } = await createTestUser();
      await seedTemplate('test-wordpress', WORDPRESS_YAML);

      await deploy('test-wordpress', account.id, { WORDPRESS_DOMAIN: 'test.example.com' });

      const dbCall = dockerService.createService.mock.calls.find(
        (c: any) => c[0].name.includes('wordpress-db'),
      );
      expect(dbCall[0].networkIds).toHaveLength(1);
      expect(dbCall[0].networkIds).toContain('acct-net');
    });

    it('builds Traefik labels with Host rule for domain', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-wordpress', WORDPRESS_YAML);

      await deploy('test-wordpress', account.id, { WORDPRESS_DOMAIN: 'wp.example.com' });

      const wpCall = dockerService.createService.mock.calls.find(
        (c: any) => c[0].name.includes('wordpress') && !c[0].name.includes('wordpress-db'),
      );
      const labels = wpCall[0].labels;
      expect(labels['traefik.enable']).toBe('true');
      const hostRule = Object.values(labels).find(
        (v: any) => typeof v === 'string' && v.includes('Host('),
      );
      expect(hostRule).toContain('wp.example.com');
    });

    it('disables Traefik for non-domain services', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-wordpress', WORDPRESS_YAML);

      await deploy('test-wordpress', account.id);

      const dbCall = dockerService.createService.mock.calls.find(
        (c: any) => c[0].name.includes('wordpress-db'),
      );
      expect(dbCall[0].labels['traefik.enable']).toBe('false');
    });

    it('allocates ingress ports for non-domain services', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-no-domain', NO_DOMAIN_YAML);

      await deploy('test-no-domain', account.id);

      expect(dockerService.allocateIngressPorts).toHaveBeenCalledOnce();
      expect(dockerService.allocateIngressPorts.mock.calls[0][0]).toEqual([
        { target: 3000, protocol: 'tcp' },
      ]);
    });
  });

  // ─── Domain Overrides [Regression #7] ─────────────────────────

  describe('Domain Overrides', () => {
    it('domainOverrides wins over template variable domain', async () => {
      dockerService.ensureNetwork
        .mockResolvedValueOnce('acct-net')
        .mockResolvedValueOnce('public-net');

      const { account } = await createTestUser();
      await seedTemplate('test-wordpress', WORDPRESS_YAML);

      await deploy('test-wordpress', account.id, { WORDPRESS_DOMAIN: 'original.com' }, {
        domainOverrides: { wordpress: 'override.com' },
      });

      const wpCall = dockerService.createService.mock.calls.find(
        (c: any) => c[0].name.includes('wordpress') && !c[0].name.includes('wordpress-db'),
      );
      const hostRule = Object.values(wpCall[0].labels).find(
        (v: any) => typeof v === 'string' && v.includes('Host('),
      ) as string;
      expect(hostRule).toContain('override.com');
      expect(hostRule).not.toContain('original.com');

      // DB record also reflects the override
      const dbSvcs = await db.query.services.findMany({
        where: eq(services.accountId, account.id),
      });
      const wpSvc = dbSvcs.find((s: any) => s.name === 'wordpress');
      expect(wpSvc!.domain).toBe('override.com');
    });
  });

  // ─── Volume Creation Order [Regression #6] ───────────────────

  describe('Volume Creation Order', () => {
    afterEach(() => {
      // Restore default implementations overridden by call-order tracking
      dockerService.createService.mockResolvedValue({ id: 'docker-svc-123' });
      storageManager.createVolume.mockResolvedValue({
        name: 'test-vol', path: '/test/vol', driver: 'local', driverOptions: {},
      });
    });

    it('all createVolume calls precede any createService call', async () => {
      const callOrder: string[] = [];
      storageManager.createVolume.mockImplementation(async (_aid: any, name: string) => {
        callOrder.push(`createVolume:${name}`);
        return { name, path: `/test/${name}`, driver: 'local', driverOptions: {} };
      });
      dockerService.createService.mockImplementation(async (opts: any) => {
        callOrder.push(`createService:${opts.name}`);
        return { id: `docker-${opts.name}` };
      });

      const { account } = await createTestUser();
      await seedTemplate('test-wordpress', WORDPRESS_YAML);

      await deploy('test-wordpress', account.id);

      const volumeCalls = callOrder.filter((c) => c.startsWith('createVolume:'));
      const serviceCalls = callOrder.filter((c) => c.startsWith('createService:'));
      expect(volumeCalls).toHaveLength(2);
      expect(serviceCalls).toHaveLength(2);

      const lastVolumeIdx = callOrder.lastIndexOf(volumeCalls[volumeCalls.length - 1]!);
      const firstServiceIdx = callOrder.indexOf(serviceCalls[0]!);
      expect(lastVolumeIdx).toBeLessThan(firstServiceIdx);
    });

    it('skips volumes when storage not ready', async () => {
      storageManager.volumes.isReady.mockReturnValueOnce(false);

      const { account } = await createTestUser();
      await seedTemplate('test-wordpress', WORDPRESS_YAML);

      await deploy('test-wordpress', account.id);

      expect(storageManager.createVolume).not.toHaveBeenCalled();
      expect(storageManager.enforceStorageQuota).not.toHaveBeenCalled();
    });
  });

  // ─── Multi-Volume Quota [Regression #2] ──────────────────────

  describe('Multi-Volume Quota', () => {
    it('enforceStorageQuota called once with total GB', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-multi-vol', MULTI_VOLUME_YAML);

      await deploy('test-multi-vol', account.id);

      expect(storageManager.enforceStorageQuota).toHaveBeenCalledOnce();
      // 4 volumes × 5 GB default = 20 GB
      expect(storageManager.enforceStorageQuota).toHaveBeenCalledWith(account.id, 20);
    });

    it('rejects when quota exceeded', async () => {
      storageManager.enforceStorageQuota.mockRejectedValueOnce(
        new Error('Storage quota exceeded: using 90 GB of 100 GB limit, requested 20 GB'),
      );

      const { account } = await createTestUser();
      await seedTemplate('test-multi-vol', MULTI_VOLUME_YAML);

      await expect(deploy('test-multi-vol', account.id)).rejects.toThrow('quota exceeded');
    });

    it('individual createVolume calls use skipQuotaCheck: true', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-multi-vol', MULTI_VOLUME_YAML);

      await deploy('test-multi-vol', account.id);

      expect(storageManager.createVolume).toHaveBeenCalledTimes(4);
      for (const call of storageManager.createVolume.mock.calls) {
        // 7th argument (index 6) is { skipQuotaCheck: true }
        expect(call[6]).toEqual({ skipQuotaCheck: true });
      }
    });
  });

  // ─── stackId Route Integration [Regression #1] ───────────────

  describe('stackId Route Integration', () => {
    it('GET /stack/:stackId/status accepts deployed stackId', async () => {
      const { account, token } = await createTestUser();
      await seedTemplate('test-single', SINGLE_SERVICE_YAML);

      const result = await deploy('test-single', account.id);
      expect(result.stackId).toMatch(UUID_RE);

      const res = await app.request(`/api/v1/services/stack/${result.stackId}/status`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Account-Id': account.id,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.stackId).toBe(result.stackId);
      expect(body.services).toHaveLength(1);
    });

    it('DELETE /stack/:stackId accepts deployed stackId', async () => {
      const { account, token } = await createTestUser();
      await seedTemplate('test-single', SINGLE_SERVICE_YAML);

      const result = await deploy('test-single', account.id);

      const res = await app.request(`/api/v1/services/stack/${result.stackId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Account-Id': account.id,
        },
      });

      expect(res.status).toBe(200);
    });
  });

  // ─── Resource & Image Overrides ───────────────────────────────

  describe('Resource & Image Overrides', () => {
    it('applies imageOverrides per service', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-wordpress', WORDPRESS_YAML);

      await deploy('test-wordpress', account.id, {}, {
        imageOverrides: { wordpress: 'wordpress:6.8-apache' },
      });

      const wpCall = dockerService.createService.mock.calls.find(
        (c: any) => c[0].name.includes('wordpress') && !c[0].name.includes('wordpress-db'),
      );
      expect(wpCall[0].image).toBe('wordpress:6.8-apache');

      const dbCall = dockerService.createService.mock.calls.find(
        (c: any) => c[0].name.includes('wordpress-db'),
      );
      expect(dbCall[0].image).toBe('mysql:8.4');
    });

    it('applies resourceOverrides (replicas, CPU, memory)', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-single', SINGLE_SERVICE_YAML);

      await deploy('test-single', account.id, {}, {
        resourceOverrides: {
          nginx: { replicas: 3, cpuLimit: 2, memoryLimit: 2048 },
        },
      });

      const args = dockerService.createService.mock.calls[0][0];
      expect(args.replicas).toBe(3);

      const dbSvcs = await db.query.services.findMany({
        where: eq(services.accountId, account.id),
      });
      expect(dbSvcs[0]!.replicas).toBe(3);
      expect(dbSvcs[0]!.cpuLimit).toBe(2);
      expect(dbSvcs[0]!.memoryLimit).toBe(2048);
    });
  });

  // ─── Error Paths ──────────────────────────────────────────────

  describe('Error Paths', () => {
    it('throws for non-existent template', async () => {
      const { account } = await createTestUser();

      await expect(deploy('non-existent', account.id)).rejects.toThrow('not found');
    });

    it('throws for missing required variable', async () => {
      const { account } = await createTestUser();
      await seedTemplate('test-required-var', REQUIRED_VAR_YAML);

      await expect(deploy('test-required-var', account.id)).rejects.toThrow(
        'Missing required variable',
      );
    });

    it('propagates storage quota error', async () => {
      storageManager.enforceStorageQuota.mockRejectedValueOnce(
        new Error('Storage quota exceeded: using 95 GB of 100 GB limit, requested 10 GB'),
      );

      const { account } = await createTestUser();
      await seedTemplate('test-wordpress', WORDPRESS_YAML);

      await expect(deploy('test-wordpress', account.id)).rejects.toThrow('quota exceeded');
    });

    it('sets service status to failed when Docker throws', async () => {
      dockerService.createService.mockRejectedValueOnce(new Error('Docker daemon unreachable'));

      const { account } = await createTestUser();
      await seedTemplate('test-single', SINGLE_SERVICE_YAML);

      const result = await deploy('test-single', account.id);

      expect(result.services[0].dockerServiceId).toBeNull();
      const svc = await db.query.services.findFirst({
        where: eq(services.id, result.services[0].id),
      });
      expect(svc!.status).toBe('failed');
    });

    it('creates deployment record with error message on failure', async () => {
      dockerService.createService.mockRejectedValueOnce(new Error('image not found'));

      const { account } = await createTestUser();
      await seedTemplate('test-single', SINGLE_SERVICE_YAML);

      const result = await deploy('test-single', account.id);

      const deploys = await db.query.deployments.findMany({
        where: eq(deployments.serviceId, result.services[0].id),
      });
      expect(deploys).toHaveLength(1);
      expect(deploys[0]!.status).toBe('failed');
      expect(deploys[0]!.log).toContain('image not found');
    });

    it('deploy route returns 401 without auth', async () => {
      const res = await app.request('/api/v1/marketplace/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'test', config: {} }),
      });

      expect(res.status).toBe(401);
    });
  });
});
