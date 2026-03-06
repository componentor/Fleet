#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { join, resolve, basename, relative } from 'node:path';
import { createReadStream } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';

// ── Config resolution ────────────────────────────────────────────────────

interface SiglarConfig {
  apiKey?: string;
  url?: string;
  serviceId?: string;
  name?: string;
}

const CONFIG_FILE = '.siglar.json';
const ENV_PREFIX = 'SIGLAR_';

function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== '/') {
    if (existsSync(join(dir, CONFIG_FILE)) || existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

function loadConfig(): SiglarConfig {
  const root = findProjectRoot();

  // 1. Read .siglar.json
  let fileConfig: SiglarConfig = {};
  const configPath = join(root, CONFIG_FILE);
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      console.error(`Warning: Failed to parse ${CONFIG_FILE}`);
    }
  }

  // 2. Read .env files (project .env, then home .env)
  const envVars = {
    ...parseEnvFile(join(root, '.env')),
    ...parseEnvFile(join(root, '.env.local')),
  };

  // 3. Merge: CLI env > process.env > .env files > .siglar.json
  const apiKey = process.env.SIGLAR_API_KEY ?? envVars.SIGLAR_API_KEY ?? fileConfig.apiKey;
  const url = process.env.SIGLAR_URL ?? envVars.SIGLAR_URL ?? fileConfig.url;
  const serviceId = process.env.SIGLAR_SERVICE_ID ?? envVars.SIGLAR_SERVICE_ID ?? fileConfig.serviceId;
  const name = fileConfig.name;

  return { apiKey, url, serviceId, name };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function ensureAuth(config: SiglarConfig): { apiKey: string; url: string } {
  if (!config.apiKey) die('No API key found. Run `siglar login` or set SIGLAR_API_KEY.');
  if (!config.url) die('No API URL found. Set "url" in .siglar.json or SIGLAR_URL.');
  return { apiKey: config.apiKey, url: config.url.replace(/\/+$/, '') };
}

async function apiRequest(
  url: string,
  apiKey: string,
  method: string,
  path: string,
  body?: FormData | Record<string, unknown>,
): Promise<any> {
  const headers: Record<string, string> = { 'X-API-Key': apiKey };
  let fetchBody: any;

  if (body instanceof FormData) {
    fetchBody = body;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(`${url}${path}`, { method, headers, body: fetchBody });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const json = await res.json() as any;
      msg = json.error || json.message || msg;
    } catch {}
    die(`API ${res.status}: ${msg}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

function createTarball(dir: string): string {
  // Create a tar.gz of the project directory, respecting .gitignore
  const outPath = join(dir, '.siglar-publish.tar.gz');

  // Use git archive if in a git repo (respects .gitignore automatically)
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: dir, stdio: 'pipe' });
    // git archive includes only tracked + staged files
    execSync(`git archive --format=tar.gz -o "${outPath}" HEAD`, { cwd: dir, stdio: 'pipe' });
    return outPath;
  } catch {
    // Fall back to tar, excluding common dirs
    const excludes = [
      'node_modules', '.git', '.siglar-publish.tar.gz',
      'dist', '.next', '.nuxt', '__pycache__', '.venv', 'venv',
    ].map(e => `--exclude='${e}'`).join(' ');
    execSync(`tar czf "${outPath}" ${excludes} -C "${dir}" .`, { stdio: 'pipe' });
    return outPath;
  }
}

// ── Commands ─────────────────────────────────────────────────────────────

async function cmdInit() {
  const root = findProjectRoot();
  const configPath = join(root, CONFIG_FILE);

  if (existsSync(configPath)) {
    console.log(`${CONFIG_FILE} already exists. Edit it directly or delete to re-init.`);
    return;
  }

  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  const url = await ask('API URL (e.g. https://yoursiglar.com/api/v1): ');
  const name = await ask('Service name (leave empty to prompt on publish): ');
  rl.close();

  const config: SiglarConfig = { url: url.trim() || undefined, name: name.trim() || undefined };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`Created ${CONFIG_FILE}`);

  // Ensure .siglar.json is gitignored
  ensureGitignore(root);

  console.log('');
  console.log('Next steps:');
  console.log('  1. Run `siglar login` to save your API key');
  console.log('  2. Run `siglar publish` to deploy');
}

function ensureGitignore(root: string) {
  const gitignorePath = join(root, '.gitignore');
  const entries = ['.siglar.json', '.siglar-publish.tar.gz'];

  let content = '';
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf-8');
  }

  const toAdd = entries.filter(e => !content.split('\n').some(line => line.trim() === e));
  if (toAdd.length > 0) {
    const suffix = content.endsWith('\n') ? '' : '\n';
    appendFileSync(gitignorePath, `${suffix}\n# Siglar CLI\n${toAdd.join('\n')}\n`);
    console.log(`Added ${toAdd.join(', ')} to .gitignore`);
  }
}

async function cmdLogin() {
  const root = findProjectRoot();
  const configPath = join(root, CONFIG_FILE);

  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  const apiKey = await ask('API key: ');
  rl.close();

  if (!apiKey.trim()) die('API key cannot be empty.');

  let config: SiglarConfig = {};
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch {}
  }

  config.apiKey = apiKey.trim();
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  ensureGitignore(root);
  console.log('API key saved to .siglar.json');
}

async function cmdPublish() {
  const config = loadConfig();
  const { apiKey, url } = ensureAuth(config);
  const root = findProjectRoot();

  console.log(`Packaging ${basename(root)}...`);
  const archivePath = createTarball(root);

  try {
    const fileBuffer = readFileSync(archivePath);
    const blob = new Blob([fileBuffer]);

    if (config.serviceId) {
      // Rebuild existing service
      console.log(`Publishing to existing service ${config.serviceId}...`);
      const form = new FormData();
      form.append('file', blob, 'source.tar.gz');

      const result = await apiRequest(url, apiKey, 'POST', `/upload/${config.serviceId}/rebuild`, form);
      console.log(`Rebuild triggered (deployment: ${result.deploymentId})`);
    } else {
      // Find service by name or create new
      let serviceName = config.name;
      if (!serviceName) {
        // Try package.json name
        const pkgPath = join(root, 'package.json');
        if (existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            serviceName = pkg.name?.replace(/^@[^/]+\//, '').replace(/[^a-zA-Z0-9._-]/g, '-');
          } catch {}
        }
      }

      if (!serviceName) {
        serviceName = basename(root).replace(/[^a-zA-Z0-9._-]/g, '-');
      }

      const finalName: string = serviceName;

      // Check if service already exists
      const servicesList = await apiRequest(url, apiKey, 'GET', '/services');
      const existing = (servicesList as any[]).find((s: any) => s.name === finalName && s.sourceType === 'upload');

      if (existing) {
        console.log(`Found existing service "${serviceName}", rebuilding...`);
        const form = new FormData();
        form.append('file', blob, 'source.tar.gz');

        const result = await apiRequest(url, apiKey, 'POST', `/upload/${existing.id}/rebuild`, form);

        // Save serviceId for faster subsequent publishes
        const configPath = join(root, CONFIG_FILE);
        let fileConfig: SiglarConfig = {};
        if (existsSync(configPath)) {
          try { fileConfig = JSON.parse(readFileSync(configPath, 'utf-8')); } catch {}
        }
        fileConfig.serviceId = existing.id;
        fileConfig.name = finalName;
        writeFileSync(configPath, JSON.stringify(fileConfig, null, 2) + '\n');

        console.log(`Rebuild triggered (deployment: ${result.deploymentId})`);
      } else {
        console.log(`Creating new service "${finalName}"...`);
        const form = new FormData();
        form.append('file', blob, 'source.tar.gz');
        form.append('name', finalName);

        const result = await apiRequest(url, apiKey, 'POST', '/upload/deploy', form);

        // Save serviceId for subsequent publishes
        const configPath = join(root, CONFIG_FILE);
        let fileConfig: SiglarConfig = {};
        if (existsSync(configPath)) {
          try { fileConfig = JSON.parse(readFileSync(configPath, 'utf-8')); } catch {}
        }
        fileConfig.serviceId = result.service.id;
        fileConfig.name = finalName;
        writeFileSync(configPath, JSON.stringify(fileConfig, null, 2) + '\n');

        console.log(`Service created (deployment: ${result.deploymentId})`);
        console.log(`Build method: ${result.buildMethod}`);
        if (result.detectedRuntime) console.log(`Detected runtime: ${result.detectedRuntime}`);
      }
    }

    console.log('Done.');
  } finally {
    // Clean up archive
    try { execSync(`rm -f "${archivePath}"`, { stdio: 'pipe' }); } catch {}
  }
}

async function cmdStatus() {
  const config = loadConfig();
  const { apiKey, url } = ensureAuth(config);

  if (!config.serviceId) die('No serviceId configured. Run `siglar publish` first.');

  const svc = await apiRequest(url, apiKey, 'GET', `/services/${config.serviceId}`);
  console.log(`Service: ${svc.name}`);
  console.log(`Status:  ${svc.status}`);
  console.log(`Image:   ${svc.image}`);
  if (svc.domain) console.log(`Domain:  ${svc.domain}`);
  console.log(`Replicas: ${svc.replicas}`);
}

async function cmdLogs() {
  const config = loadConfig();
  const { apiKey, url } = ensureAuth(config);

  if (!config.serviceId) die('No serviceId configured. Run `siglar publish` first.');

  const tail = process.argv[3] || '100';
  const result = await apiRequest(url, apiKey, 'GET', `/services/${config.serviceId}/logs?tail=${tail}`);
  if (result.logs) {
    console.log(result.logs);
  } else {
    console.log('No logs available.');
  }
}

function cmdHelp() {
  console.log(`
siglar - Deploy to Siglar from your terminal

Usage:
  siglar <command>

Commands:
  init      Create a .siglar.json config file
  login     Save your API key to .siglar.json
  publish   Package and deploy your project
  status    Show service status
  logs [n]  Show last n log lines (default: 100)
  help      Show this help

Configuration (priority: env vars > .env > .siglar.json):
  SIGLAR_API_KEY       Your API key
  SIGLAR_URL           API base URL (e.g. https://yoursiglar.com/api/v1)
  SIGLAR_SERVICE_ID    Target service ID (auto-saved after first publish)

Files:
  .siglar.json         Project config (auto-gitignored)
  .env / .env.local    Environment variables (reads SIGLAR_* keys)
`);
}

// ── Main ─────────────────────────────────────────────────────────────────

const command = process.argv[2];

switch (command) {
  case 'init':    cmdInit().catch(e => die(e.message)); break;
  case 'login':   cmdLogin().catch(e => die(e.message)); break;
  case 'publish': cmdPublish().catch(e => die(e.message)); break;
  case 'deploy':  cmdPublish().catch(e => die(e.message)); break; // alias
  case 'status':  cmdStatus().catch(e => die(e.message)); break;
  case 'logs':    cmdLogs().catch(e => die(e.message)); break;
  case 'help':
  case '--help':
  case '-h':      cmdHelp(); break;
  case undefined:  cmdHelp(); break;
  default:         die(`Unknown command: ${command}. Run \`siglar help\` for usage.`);
}
