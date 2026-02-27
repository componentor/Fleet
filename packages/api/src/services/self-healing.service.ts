import { randomBytes } from 'node:crypto';
import { db, selfHealingJobs, eq } from '@fleet/db';
import { encrypt, decrypt } from './crypto.service.js';
import { dockerService } from './docker.service.js';
import { getValkey } from './valkey.service.js';
import { logger } from './logger.js';

// ── Types ──

export interface SelfHealingConfig {
  anthropicApiKey: string;
  githubPat: string;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
}

export interface SelfHealingOptions {
  autoMerge: boolean;
  autoRelease: boolean;
  autoUpdate: boolean;
  releaseType: 'alpha' | 'release';
}

// ── Config helpers ──

let configCache: { config: SelfHealingConfig | null; ts: number } | null = null;
const CONFIG_TTL = 60_000;

async function getSetting(key: string): Promise<string | null> {
  const row = await db.query.platformSettings.findFirst({
    where: (s: any, { eq: e }: any) => e(s.key, key),
  });
  return row?.value != null ? String(row.value) : null;
}

export function invalidateConfigCache(): void {
  configCache = null;
}

export async function getSelfHealingConfig(): Promise<SelfHealingConfig | null> {
  if (configCache && Date.now() - configCache.ts < CONFIG_TTL) {
    return configCache.config;
  }

  const [apiKey, pat, owner, name, branch] = await Promise.all([
    getSetting('selfhealing:anthropic_api_key'),
    getSetting('selfhealing:github_pat'),
    getSetting('selfhealing:repo_owner'),
    getSetting('selfhealing:repo_name'),
    getSetting('selfhealing:default_branch'),
  ]);

  if (!apiKey || !pat || !owner || !name) {
    configCache = { config: null, ts: Date.now() };
    return null;
  }

  const config: SelfHealingConfig = {
    anthropicApiKey: decrypt(apiKey),
    githubPat: decrypt(pat),
    repoOwner: owner,
    repoName: name,
    defaultBranch: branch || 'main',
  };

  configCache = { config, ts: Date.now() };
  return config;
}

// ── Callback token management ──

async function storeCallbackToken(jobId: string, token: string): Promise<void> {
  const valkey = await getValkey();
  if (valkey) {
    await valkey.set(`selfhealing:callback:${jobId}`, token, 'EX', 14400); // 4h TTL
  }
}

export async function verifyCallbackToken(jobId: string, token: string): Promise<boolean> {
  const valkey = await getValkey();
  if (!valkey) return false;
  const stored = await valkey.get(`selfhealing:callback:${jobId}`);
  return stored === token;
}

// ── Orchestrator script ──

const ORCHESTRATOR_SCRIPT = `#!/bin/bash
set -euo pipefail

# ── Helpers ──
callback() {
  curl -sf -X POST "$FLEET_CALLBACK_URL" \\
    -H "Authorization: Bearer $FLEET_CALLBACK_TOKEN" \\
    -H "Content-Type: application/json" \\
    -d "$1" 2>/dev/null || true
}

report() {
  local status="$1"
  local msg="$2"
  callback "{\\"status\\":\\"$status\\",\\"log\\":\\"$msg\\"}"
}

on_error() {
  report "failed" "Job failed at line $1"
  # Keep container alive for 120s so admin can inspect via terminal
  sleep 120
  exit 1
}
trap 'on_error $LINENO' ERR

# ── Phase 0: Install tools ──
report "running" "Installing tools..."
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq git curl jq >/dev/null 2>&1

# Install GitHub CLI
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq gh >/dev/null 2>&1

# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code@latest >/dev/null 2>&1

report "running" "Tools installed. Cloning repository..."

# ── Phase 1: Clone repo ──
WORK_DIR="/workspace"
BRANCH_NAME="self-heal/$(date +%s)-$(echo $FLEET_JOB_ID | head -c 8)"

git config --global user.name "Fleet Self-Healing"
git config --global user.email "fleet-bot@noreply"
git config --global credential.helper store
echo "https://x-access-token:\${GITHUB_PAT}@github.com" > ~/.git-credentials

git clone "https://x-access-token:\${GITHUB_PAT}@github.com/\${REPO_OWNER}/\${REPO_NAME}.git" "$WORK_DIR" 2>&1
cd "$WORK_DIR"
git checkout "$BASE_BRANCH"
git checkout -b "$BRANCH_NAME"

callback "{\\"status\\":\\"running\\",\\"workingBranch\\":\\"$BRANCH_NAME\\"}"
report "running" "Repository cloned. Running Claude Code..."

# ── Phase 2: Run Claude Code ──
PROMPT_TEXT=$(echo "$PROMPT" | base64 -d)
claude -p "$PROMPT_TEXT" --dangerously-skip-permissions 2>&1 || true

# ── Phase 3: Commit and push ──
if [ -z "$(git status --porcelain)" ]; then
  report "completed" "No changes needed — code looks fine."
  sleep 30
  exit 0
fi

git add -A
COMMIT_MSG="fix: self-healing — $(echo "$PROMPT_TEXT" | head -c 72)"
git commit -m "$COMMIT_MSG"
git push origin "$BRANCH_NAME" 2>&1

COMMIT_SHA=$(git rev-parse HEAD)
callback "{\\"status\\":\\"running\\",\\"commitSha\\":\\"$COMMIT_SHA\\"}"
report "running" "Changes pushed. Creating PR..."

# ── Phase 4: Create PR ──
export GH_TOKEN="$GITHUB_PAT"

PR_URL=$(gh pr create \\
  --repo "\${REPO_OWNER}/\${REPO_NAME}" \\
  --base "$BASE_BRANCH" \\
  --head "$BRANCH_NAME" \\
  --title "$COMMIT_MSG" \\
  --body "Automated fix by Fleet Self-Healing Loop.

## Prompt
$PROMPT_TEXT

## Changes
$(git log --oneline \${BASE_BRANCH}..HEAD)" 2>&1)

PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$' || echo "0")
callback "{\\"status\\":\\"pr_created\\",\\"prUrl\\":\\"$PR_URL\\",\\"prNumber\\":$PR_NUMBER}"

# ── Phase 5: CI monitoring + auto-merge ──
OPTIONS_JSON="$OPTIONS"
AUTO_MERGE=$(echo "$OPTIONS_JSON" | jq -r '.autoMerge // false')
AUTO_RELEASE=$(echo "$OPTIONS_JSON" | jq -r '.autoRelease // false')
AUTO_UPDATE=$(echo "$OPTIONS_JSON" | jq -r '.autoUpdate // false')
RELEASE_TYPE=$(echo "$OPTIONS_JSON" | jq -r '.releaseType // "release"')

if [ "$AUTO_MERGE" = "true" ] && [ "$PR_NUMBER" != "0" ]; then
  callback "{\\"status\\":\\"monitoring_ci\\",\\"ciStatus\\":\\"running\\"}"
  report "monitoring_ci" "Waiting for CI checks to pass..."

  CI_PASSED=false
  for i in $(seq 1 180); do
    sleep 10
    CI_CONCLUSION=$(gh pr checks "$PR_NUMBER" --repo "\${REPO_OWNER}/\${REPO_NAME}" --json conclusion -q '.[].conclusion' 2>/dev/null | sort -u || echo "pending")

    if echo "$CI_CONCLUSION" | grep -qi "failure\\|cancelled\\|timed_out"; then
      callback "{\\"status\\":\\"failed\\",\\"ciStatus\\":\\"failed\\",\\"error\\":\\"CI checks failed\\"}"
      report "failed" "CI checks failed"
      sleep 120
      exit 1
    fi

    if echo "$CI_CONCLUSION" | grep -qi "success" && ! echo "$CI_CONCLUSION" | grep -qi "pending\\|null\\|queued\\|in_progress"; then
      CI_PASSED=true
      break
    fi
  done

  if [ "$CI_PASSED" = "false" ]; then
    callback "{\\"status\\":\\"failed\\",\\"ciStatus\\":\\"failed\\",\\"error\\":\\"CI timed out after 30 minutes\\"}"
    sleep 60
    exit 1
  fi

  callback "{\\"status\\":\\"merging\\",\\"ciStatus\\":\\"passed\\"}"
  report "merging" "CI passed. Merging PR..."

  gh pr merge "$PR_NUMBER" --repo "\${REPO_OWNER}/\${REPO_NAME}" --squash --delete-branch 2>&1
  report "merging" "PR merged successfully."
fi

# ── Phase 6: Auto-release ──
if [ "$AUTO_RELEASE" = "true" ]; then
  callback "{\\"status\\":\\"releasing\\"}"
  report "releasing" "Creating release..."

  LATEST_TAG=$(gh release list --repo "\${REPO_OWNER}/\${REPO_NAME}" --limit 1 --json tagName -q '.[0].tagName' 2>/dev/null || echo "v0.0.0")
  CURRENT=$(echo "$LATEST_TAG" | sed 's/^v//' | sed 's/-.*//')
  MAJOR=$(echo "$CURRENT" | cut -d. -f1)
  MINOR=$(echo "$CURRENT" | cut -d. -f2)
  PATCH=$(echo "$CURRENT" | cut -d. -f3)
  NEW_PATCH=$((PATCH + 1))

  if [ "$RELEASE_TYPE" = "alpha" ]; then
    NEW_TAG="v\${MAJOR}.\${MINOR}.\${NEW_PATCH}-alpha.1"
    PRERELEASE="--prerelease"
  else
    NEW_TAG="v\${MAJOR}.\${MINOR}.\${NEW_PATCH}"
    PRERELEASE=""
  fi

  CHANGELOG=$(gh pr list --repo "\${REPO_OWNER}/\${REPO_NAME}" --state merged --base "$BASE_BRANCH" --limit 10 --json title,number -q '.[] | "- #\\(.number) \\(.title)"' 2>/dev/null || echo "- Self-healing fix")

  gh release create "$NEW_TAG" \\
    --repo "\${REPO_OWNER}/\${REPO_NAME}" \\
    --title "$NEW_TAG" \\
    --notes "## Changes
$CHANGELOG" \\
    $PRERELEASE 2>&1

  callback "{\\"status\\":\\"releasing\\",\\"releaseTag\\":\\"$NEW_TAG\\"}"
  report "releasing" "Release $NEW_TAG created."
fi

# ── Phase 7: Auto-update ──
if [ "$AUTO_UPDATE" = "true" ] && [ -n "\${NEW_TAG:-}" ]; then
  callback "{\\"status\\":\\"updating\\"}"
  report "updating" "Triggering Fleet platform update to $NEW_TAG..."
  # The callback handler on the Fleet API side will trigger the update
fi

# ── Done ──
callback "{\\"status\\":\\"completed\\"}"
report "completed" "Self-healing job completed successfully."

# Keep alive briefly for terminal viewing
sleep 30
`;

// ── Container launch ──

export async function launchWorkerContainer(jobId: string): Promise<string> {
  const config = await getSelfHealingConfig();
  if (!config) throw new Error('Self-healing not configured');

  const job = await db.query.selfHealingJobs.findFirst({
    where: eq(selfHealingJobs.id, jobId),
  });
  if (!job) throw new Error('Job not found');

  const callbackToken = randomBytes(32).toString('hex');
  await storeCallbackToken(jobId, callbackToken);

  // Determine callback URL — use the platform domain if configured
  const domainRow = await db.query.platformSettings.findFirst({
    where: (s: any, { eq: e }: any) => e(s.key, 'platform:domain'),
  });
  const platformDomain = domainRow?.value
    ? String(domainRow.value).replace(/^"/, '').replace(/"$/, '')
    : null;

  const callbackUrl = platformDomain
    ? `https://${platformDomain}/api/v1/admin/self-healing/${jobId}/callback`
    : `http://fleet_api:3000/api/v1/admin/self-healing/${jobId}/callback`;

  const serviceName = `fleet-heal-${jobId.slice(0, 12)}`;
  const promptB64 = Buffer.from(job.prompt).toString('base64');

  const docker = dockerService.getDockerClient();

  const svc = await docker.createService({
    Name: serviceName,
    Labels: {
      'fleet.internal': 'true',
      'fleet.self-healing': 'true',
      'fleet.self-healing.job-id': jobId,
    },
    TaskTemplate: {
      ContainerSpec: {
        Image: 'node:20-bookworm',
        Env: [
          `FLEET_JOB_ID=${jobId}`,
          `FLEET_CALLBACK_URL=${callbackUrl}`,
          `FLEET_CALLBACK_TOKEN=${callbackToken}`,
          `ANTHROPIC_API_KEY=${config.anthropicApiKey}`,
          `GITHUB_PAT=${config.githubPat}`,
          `REPO_OWNER=${config.repoOwner}`,
          `REPO_NAME=${config.repoName}`,
          `BASE_BRANCH=${job.baseBranch || config.defaultBranch}`,
          `PROMPT=${promptB64}`,
          `OPTIONS=${JSON.stringify(job.options || {})}`,
        ],
        Args: ['bash', '-c', ORCHESTRATOR_SCRIPT],
      },
      RestartPolicy: {
        Condition: 'none' as const,
        MaxAttempts: 0,
      },
      Resources: {
        Limits: {
          MemoryBytes: 4 * 1024 * 1024 * 1024,
          NanoCPUs: 2_000_000_000,
        },
      },
    },
    Mode: { Replicated: { Replicas: 1 } },
  } as any);

  const serviceId = svc.id;

  // Update DB with Docker service ID
  await db
    .update(selfHealingJobs)
    .set({ dockerServiceId: serviceId, status: 'provisioning', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(selfHealingJobs.id, jobId));

  return serviceId;
}

// ── Container polling ──

export async function waitForContainerRunning(jobId: string, serviceId: string, timeoutMs = 120_000): Promise<string | null> {
  const docker = dockerService.getDockerClient();
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));

    try {
      const tasks = await docker.listTasks({
        filters: { service: [serviceId] },
      });
      const running = tasks.find((t: any) => t.Status?.State === 'running');
      if (running?.Status?.ContainerStatus?.ContainerID) {
        const containerId = running.Status.ContainerStatus.ContainerID;
        await db
          .update(selfHealingJobs)
          .set({ containerId, status: 'running', updatedAt: new Date() })
          .where(eq(selfHealingJobs.id, jobId));
        return containerId;
      }

      // Check if task already failed/completed
      const failed = tasks.find((t: any) =>
        t.Status?.State === 'failed' || t.Status?.State === 'rejected',
      );
      if (failed) {
        const error = failed.Status?.Err || failed.Status?.Message || 'Container failed to start';
        await db
          .update(selfHealingJobs)
          .set({ status: 'failed', error, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(selfHealingJobs.id, jobId));
        return null;
      }
    } catch (err) {
      logger.warn({ err, jobId }, 'Error polling self-healing container status');
    }
  }

  // Timeout
  await db
    .update(selfHealingJobs)
    .set({ status: 'failed', error: 'Container start timed out', completedAt: new Date(), updatedAt: new Date() })
    .where(eq(selfHealingJobs.id, jobId));
  return null;
}

// ── Callback handler ──

export async function handleCallback(
  jobId: string,
  payload: Record<string, any>,
): Promise<void> {
  const updates: Record<string, any> = { updatedAt: new Date() };

  if (payload.status) updates.status = payload.status;
  if (payload.workingBranch) updates.workingBranch = payload.workingBranch;
  if (payload.commitSha) updates.commitSha = payload.commitSha;
  if (payload.prUrl) updates.prUrl = payload.prUrl;
  if (payload.prNumber != null) updates.prNumber = payload.prNumber;
  if (payload.ciStatus) updates.ciStatus = payload.ciStatus;
  if (payload.releaseTag) updates.releaseTag = payload.releaseTag;
  if (payload.error) updates.error = payload.error;

  // Append log line
  if (payload.log) {
    const job = await db.query.selfHealingJobs.findFirst({
      where: eq(selfHealingJobs.id, jobId),
    });
    const existingLog = job?.log || '';
    updates.log = existingLog + (existingLog ? '\n' : '') + payload.log;
  }

  // Set completedAt for terminal statuses
  if (payload.status === 'completed' || payload.status === 'failed' || payload.status === 'cancelled') {
    updates.completedAt = new Date();
  }

  await db
    .update(selfHealingJobs)
    .set(updates)
    .where(eq(selfHealingJobs.id, jobId));

  // Publish to Valkey for real-time updates
  try {
    const valkey = await getValkey();
    if (valkey) {
      await valkey.publish(`selfhealing:${jobId}`, JSON.stringify(payload));
    }
  } catch { /* ignore */ }

  // If auto-update triggered, kick off Fleet update via the update API
  if (payload.status === 'updating' && payload.releaseTag) {
    try {
      // Trigger update through the internal HTTP endpoint so it goes through
      // the proper update flow (backup, migrations, seeders, restart).
      const platformUrl = (await db.query.platformSettings.findFirst({
        where: (s: any, { eq: e }: any) => e(s.key, 'platform:url'),
      }))?.value as string | undefined;
      const baseUrl = platformUrl || 'http://localhost:3000';
      await fetch(`${baseUrl}/api/v1/admin/update/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: payload.releaseTag }),
      }).catch((err: Error) => {
        logger.error({ err }, 'Self-healing auto-update request failed');
      });
    } catch (err) {
      logger.error({ err }, 'Failed to trigger auto-update from self-healing');
    }
  }
}

// ── Cleanup ──

export async function cleanupContainer(dockerServiceId: string): Promise<void> {
  try {
    const docker = dockerService.getDockerClient();
    const service = docker.getService(dockerServiceId);
    await service.remove();
  } catch { /* ignore cleanup failures */ }
}

export async function cancelJob(jobId: string): Promise<void> {
  const job = await db.query.selfHealingJobs.findFirst({
    where: eq(selfHealingJobs.id, jobId),
  });
  if (!job) throw new Error('Job not found');

  // Kill the container
  if (job.dockerServiceId) {
    await cleanupContainer(job.dockerServiceId);
  }

  // Update status
  await db
    .update(selfHealingJobs)
    .set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
    .where(eq(selfHealingJobs.id, jobId));
}
