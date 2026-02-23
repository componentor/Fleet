<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, RefreshCw, Loader2, Check, AlertTriangle, RotateCcw, Database, Sprout, Terminal, XCircle } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { updateVersion } from '@/composables/useVersionInfo'

const { t } = useI18n()
const api = useApi()
const logContainer = ref<HTMLElement | null>(null)

const loading = ref(true)
const checking = ref(false)
const updating = ref(false)
const rollingBack = ref(false)
const migrating = ref(false)
const seeding = ref(false)
const resetting = ref(false)
const error = ref('')
const success = ref('')

// Update check result
const updateAvailable = ref(false)
const currentVersion = ref('')
const latestVersion = ref('')
const changelog = ref('')

// Releases
const releases = ref<any[]>([])
const rcEnabled = ref(false)

// Settings
const includeRcReleases = ref(false)
const autoCheckEnabled = ref(true)

// Update state
const updateState = ref<any>({ status: 'idle' })

// DB status
const dbStatus = ref<any>(null)

// Backup toggle (loaded from platform settings, default: true)
const backupBeforeUpdate = ref(true)

const statusLabels: Record<string, string> = {
  'checking': 'Checking for updates...',
  'backing-up': 'Creating pre-update backup...',
  'pulling': 'Snapshotting current images...',
  'verifying-images': 'Verifying image checksums...',
  'migrating': 'Running database migrations...',
  'updating': 'Updating services (rolling)...',
  'seeding': 'Running database seeders...',
  'verifying': 'Verifying service health...',
  'rolling-back': 'Rolling back to previous version...',
  'completed': 'Update completed successfully',
  'failed': 'Update failed',
}

const activeStates = ['checking', 'backing-up', 'pulling', 'verifying-images', 'migrating', 'updating', 'seeding', 'verifying', 'rolling-back']

function isActiveState(status: string) {
  return activeStates.includes(status)
}

// Auto-scroll log viewer when new content arrives
watch(() => updateState.value?.log, async () => {
  await nextTick()
  if (logContainer.value) {
    logContainer.value.scrollTop = logContainer.value.scrollHeight
  }
})

let statusPollInterval: ReturnType<typeof setInterval> | null = null

async function fetchAll() {
  loading.value = true
  try {
    const [settingsData, statusData, releasesData, notif, dbResult] = await Promise.all([
      api.get<any>('/updates/settings'),
      api.get<any>('/updates/status'),
      api.get<any>('/updates/releases?limit=10'),
      api.get<any>('/updates/notification'),
      api.get<any>('/updates/db-status').catch(() => null),
    ])
    includeRcReleases.value = settingsData.includeRcReleases ?? false
    autoCheckEnabled.value = settingsData.autoCheckEnabled ?? true
    backupBeforeUpdate.value = settingsData.backupBeforeUpdate !== false
    updateState.value = statusData
    releases.value = releasesData.releases ?? []
    rcEnabled.value = releasesData.rcEnabled ?? false
    updateAvailable.value = notif.available ?? false
    latestVersion.value = notif.latest?.tag ?? ''
    dbStatus.value = dbResult
    // Use the most recent version source: status response (persisted in DB) or notification cache
    const statusVersion = statusData?.currentVersion?.replace(/^v/, '') ?? ''
    const notifVersion = notif.current?.replace(/^v/, '') ?? ''
    currentVersion.value = statusVersion || notifVersion || currentVersion.value
    // Sync to shared store so SuperLayout sidebar stays in sync
    if (currentVersion.value) {
      updateVersion(currentVersion.value, latestVersion.value, updateAvailable.value)
    }
  } catch {
    // partial failure ok
  } finally {
    loading.value = false
  }
}

async function checkForUpdates() {
  checking.value = true
  error.value = ''
  try {
    const result = await api.get<any>('/updates/check')
    updateAvailable.value = result.available ?? false
    currentVersion.value = result.current ?? currentVersion.value
    latestVersion.value = result.latest?.tag ?? latestVersion.value
    changelog.value = result.latest?.body ?? ''
    updateVersion(currentVersion.value, latestVersion.value, updateAvailable.value)
    if (!result.available) {
      success.value = 'Already on the latest version'
      setTimeout(() => { success.value = '' }, 3000)
    }
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to check for updates'
  } finally {
    checking.value = false
  }
}

async function performUpdate(version: string) {
  const backupNote = backupBeforeUpdate.value ? '' : '\n\nWARNING: Pre-update backup is DISABLED in settings.'
  if (!confirm(`Are you sure you want to update to ${version}? This will perform a rolling update.${backupNote}`)) return
  updating.value = true
  error.value = ''
  try {
    await api.post<any>('/updates/perform', { version })
    success.value = `Update to ${version} started. Monitoring progress...`
    startPolling()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to start update'
  } finally {
    updating.value = false
  }
}

async function rollback() {
  const target = updateState.value?.rollbackTarget
  const msg = target
    ? `Are you sure you want to rollback to version ${target}? This will revert all Docker services to their previous images.`
    : 'Are you sure you want to rollback to the previous version?'
  if (!confirm(msg)) return
  rollingBack.value = true
  error.value = ''
  try {
    await api.post<any>('/updates/rollback', {})
    success.value = 'Rollback started. Monitoring progress...'
    startPolling()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to start rollback'
  } finally {
    rollingBack.value = false
  }
}

async function runMigrations() {
  if (!confirm('Are you sure you want to run database migrations? This will apply any pending schema changes.')) return
  migrating.value = true
  error.value = ''
  try {
    const result = await api.post<any>('/updates/migrate', {})
    success.value = result.message
    setTimeout(() => { success.value = '' }, 5000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Migration failed'
  } finally {
    migrating.value = false
  }
}

async function runSeeders() {
  if (!confirm('Are you sure you want to run database seeders? This will insert default data.')) return
  seeding.value = true
  error.value = ''
  try {
    const result = await api.post<any>('/updates/seed', {})
    success.value = result.message
    setTimeout(() => { success.value = '' }, 5000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Seeding failed'
  } finally {
    seeding.value = false
  }
}

async function resetUpdateState() {
  if (!confirm('Force-reset the update state? This clears any stuck lock and returns the system to idle. Only use if an update is truly stuck.')) return
  resetting.value = true
  error.value = ''
  try {
    const result = await api.post<any>('/updates/reset', {})
    success.value = result.message
    setTimeout(() => { success.value = '' }, 5000)
    await fetchAll()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to reset update state'
  } finally {
    resetting.value = false
  }
}

async function saveSettings() {
  try {
    await api.patch('/updates/settings', {
      includeRcReleases: includeRcReleases.value,
      autoCheckEnabled: autoCheckEnabled.value,
      backupBeforeUpdate: backupBeforeUpdate.value,
    })
    success.value = 'Update settings saved'
    setTimeout(() => { success.value = '' }, 3000)
    // Refresh releases list to reflect RC toggle
    const releasesData = await api.get<any>('/updates/releases?limit=10')
    releases.value = releasesData.releases ?? []
    rcEnabled.value = releasesData.rcEnabled ?? false
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save settings'
  }
}

// Grace period: after triggering an update, don't stop polling on 'idle' for 15s.
// With multiple API replicas, polls may hit a replica that isn't running the update
// and would see 'idle' even though the update is actively running on another replica.
let pollStartedAt = 0

function startPolling() {
  if (statusPollInterval) clearInterval(statusPollInterval)
  pollStartedAt = Date.now()
  statusPollInterval = setInterval(async () => {
    try {
      const state = await api.get<any>('/updates/status')
      // Only update local state if we got a non-idle response, OR the grace period expired
      if (state.status !== 'idle' || Date.now() - pollStartedAt > 15000) {
        updateState.value = state
      }
      if (state.status === 'completed' || state.status === 'failed') {
        stopPolling()
        // Use version from the completed status directly (more reliable than notification during API restart)
        if (state.status === 'completed' && state.currentVersion) {
          const ver = state.currentVersion.replace(/^v/, '')
          currentVersion.value = ver
          // Also update latestVersion so rollback target doesn't match current
          if (latestVersion.value && latestVersion.value.replace(/^v/, '') === ver) {
            updateAvailable.value = false
          }
          // Push to shared store so SuperLayout sidebar updates immediately
          updateVersion(ver, latestVersion.value, false)
        }
        // Retry fetchAll with backoff to handle API restart window
        const retryFetch = async (delay: number, retries: number) => {
          await new Promise(r => setTimeout(r, delay))
          try {
            await fetchAll()
          } catch {
            if (retries > 0) await retryFetch(delay * 2, retries - 1)
          }
        }
        retryFetch(3000, 2)
      }
    } catch { /* ignore — API may be restarting */ }
  }, 2000)
}

function stopPolling() {
  if (statusPollInterval) {
    clearInterval(statusPollInterval)
    statusPollInterval = null
  }
}

onMounted(() => {
  fetchAll()
})

onUnmounted(() => {
  if (statusPollInterval) {
    clearInterval(statusPollInterval)
    statusPollInterval = null
  }
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Download class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Platform Updates</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else class="space-y-6">
      <!-- Alerts -->
      <div v-if="error" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>
      <div v-if="success" class="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
        <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
      </div>

      <!-- Update Status Banner -->
      <div v-if="updateState.status !== 'idle'" class="border rounded-lg overflow-hidden" :class="updateState.status === 'failed' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : updateState.status === 'completed' ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'">
        <div class="flex items-center gap-3 p-4">
          <Loader2 v-if="isActiveState(updateState.status)" class="w-5 h-5 animate-spin text-blue-600 dark:text-blue-400 shrink-0" />
          <AlertTriangle v-else-if="updateState.status === 'failed'" class="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
          <Check v-else-if="updateState.status === 'completed'" class="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium" :class="updateState.status === 'failed' ? 'text-red-700 dark:text-red-300' : updateState.status === 'completed' ? 'text-green-700 dark:text-green-300' : 'text-blue-700 dark:text-blue-300'">
              {{ statusLabels[updateState.status] ?? updateState.status }}
            </p>
            <p v-if="updateState.targetVersion" class="text-xs mt-0.5 text-gray-600 dark:text-gray-400">
              {{ updateState.currentVersion }} &rarr; {{ updateState.targetVersion }}
            </p>
          </div>
          <button
            v-if="updateState.status === 'completed'"
            @click="updateState = { status: 'idle' }"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors shrink-0 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/30"
          >
            <XCircle class="w-3.5 h-3.5" />
            Dismiss
          </button>
          <button
            v-if="updateState.status === 'failed' || isActiveState(updateState.status)"
            @click="resetUpdateState"
            :disabled="resetting"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors shrink-0"
            :class="updateState.status === 'failed'
              ? 'border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30'
              : 'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30'"
          >
            <Loader2 v-if="resetting" class="w-3.5 h-3.5 animate-spin" />
            <XCircle v-else class="w-3.5 h-3.5" />
            Reset
          </button>
        </div>

        <!-- Live log viewer -->
        <div v-if="updateState.log" class="border-t" :class="updateState.status === 'failed' ? 'border-red-200 dark:border-red-800' : updateState.status === 'completed' ? 'border-green-200 dark:border-green-800' : 'border-blue-200 dark:border-blue-800'">
          <div class="flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-950 text-gray-400 text-xs">
            <Terminal class="w-3.5 h-3.5" />
            Update Log
          </div>
          <div ref="logContainer" class="bg-gray-900 dark:bg-gray-950 px-4 py-3 max-h-64 overflow-y-auto">
            <pre class="text-xs text-gray-300 dark:text-gray-400 font-mono whitespace-pre-wrap break-words leading-relaxed">{{ updateState.log }}</pre>
          </div>
        </div>
      </div>

      <!-- Current Version + Check -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Current Version</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ currentVersion || 'Unknown' }}</p>
          </div>
          <div class="flex items-center gap-3">
            <button
              v-if="updateState.canRollback"
              @click="rollback"
              :disabled="rollingBack"
              class="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300 text-sm font-medium transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
              :title="updateState.rollbackTarget ? `Rollback to ${updateState.rollbackTarget}` : 'Rollback to previous version'"
            >
              <Loader2 v-if="rollingBack" class="w-4 h-4 animate-spin" />
              <RotateCcw v-else class="w-4 h-4" />
              Rollback{{ updateState.rollbackTarget ? ` to ${updateState.rollbackTarget}` : '' }}
            </button>
            <button
              @click="checkForUpdates"
              :disabled="checking"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Loader2 v-if="checking" class="w-4 h-4 animate-spin" />
              <RefreshCw v-else class="w-4 h-4" />
              Check for Updates
            </button>
          </div>
        </div>

        <div v-if="updateAvailable" class="px-6 py-4 bg-green-50 dark:bg-green-900/10 border-b border-green-200 dark:border-green-800">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-green-700 dark:text-green-300">Update available: {{ latestVersion }}</p>
              <p v-if="changelog" class="text-xs text-green-600 dark:text-green-400 mt-1">{{ changelog }}</p>
            </div>
            <button
              @click="performUpdate(latestVersion)"
              :disabled="updating"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Loader2 v-if="updating" class="w-4 h-4 animate-spin" />
              <Download v-else class="w-4 h-4" />
              Update Now
            </button>
          </div>
        </div>
      </div>

      <!-- Releases -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Available Releases</h2>
        </div>

        <div v-if="releases.length === 0" class="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
          No releases found. Click "Check for Updates" to fetch releases.
        </div>

        <div v-else class="divide-y divide-gray-200 dark:divide-gray-700">
          <div v-for="release in releases" :key="release.tag" class="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750">
            <div>
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ release.tag }}</span>
                <span v-if="release.prerelease" class="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">RC</span>
                <span v-if="release.tag === currentVersion" class="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">Current</span>
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ new Date(release.publishedAt).toLocaleDateString() }}</p>
            </div>
            <button
              v-if="release.tag !== currentVersion"
              @click="performUpdate(release.tag)"
              :disabled="updating"
              class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50"
            >
              Install
            </button>
          </div>
        </div>
      </div>

      <!-- Database Tools -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Database Tools</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Run migrations and seeders independently</p>
        </div>
        <div class="px-6 py-4 flex flex-wrap items-center gap-3">
          <button
            @click="runMigrations"
            :disabled="migrating"
            class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <Loader2 v-if="migrating" class="w-4 h-4 animate-spin" />
            <Database v-else class="w-4 h-4" />
            Run Migrations
          </button>
          <button
            @click="runSeeders"
            :disabled="seeding"
            class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <Loader2 v-if="seeding" class="w-4 h-4 animate-spin" />
            <Sprout v-else class="w-4 h-4" />
            Run Seeders
          </button>
          <div v-if="dbStatus" class="ml-auto flex items-center gap-1.5 text-sm">
            <Check v-if="dbStatus.ok" class="w-4 h-4 text-green-600" />
            <AlertTriangle v-else class="w-4 h-4 text-red-600" />
            <span :class="dbStatus.ok ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'">
              DB: {{ dbStatus.ok ? 'Connected' : dbStatus.error }}
            </span>
          </div>
        </div>
      </div>

      <!-- Settings -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Update Settings</h2>
        </div>
        <div class="px-6 py-4 space-y-4">
          <label class="flex items-center gap-3">
            <input v-model="backupBeforeUpdate" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" @change="saveSettings" />
            <div>
              <span class="text-sm text-gray-700 dark:text-gray-300">Create backup before updating</span>
              <p class="text-xs text-gray-500 dark:text-gray-400">Takes a database backup before each update for safe rollback</p>
            </div>
          </label>
          <label class="flex items-center gap-3">
            <input v-model="autoCheckEnabled" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" @change="saveSettings" />
            <span class="text-sm text-gray-700 dark:text-gray-300">Automatically check for updates</span>
          </label>
          <label class="flex items-center gap-3">
            <input v-model="includeRcReleases" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" @change="saveSettings" />
            <span class="text-sm text-gray-700 dark:text-gray-300">Include release candidate (RC) versions</span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>
