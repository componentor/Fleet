<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, RefreshCw, Loader2, Check, AlertTriangle, RotateCcw, Database, Sprout, Terminal, XCircle, X, ChevronDown, ChevronUp, Settings } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { updateVersion, versionInfo } from '@/composables/useVersionInfo'

const { t } = useI18n()
const api = useApi()

/** Compare two semver strings. Returns true if a >= b (ignoring prerelease suffixes). */
function isNewerOrEqual(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').replace(/-.*$/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').replace(/-.*$/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false
  }
  return true
}

/** Set currentVersion only if it's >= the current value (never downgrade during rolling restart). */
function setCurrentVersion(v: string) {
  if (!v) return
  if (currentVersion.value && !isNewerOrEqual(v, currentVersion.value)) return
  currentVersion.value = v
}
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

// Restart waiting state
const waitingForRestart = ref(false)
const restartPingCount = ref(0)

// DB status
const dbStatus = ref<any>(null)

// Backup toggle (loaded from platform settings, default: true)
const backupBeforeUpdate = ref(true)

// Expandable log viewer
const showLogExpanded = ref(false)

// Inline confirmation modal
const showConfirm = ref(false)
const confirmTitle = ref('')
const confirmDesc = ref('')
const confirmDanger = ref(false)
let confirmCallback: (() => void) | null = null
const confirmVersion = ref('')

function requestConfirm(title: string, desc: string, danger: boolean, callback: () => void) {
  confirmTitle.value = title
  confirmDesc.value = desc
  confirmDanger.value = danger
  confirmCallback = callback
  showConfirm.value = true
}

function executeConfirm() {
  showConfirm.value = false
  confirmCallback?.()
}

function cancelConfirm() {
  showConfirm.value = false
  confirmCallback = null
}

// Progress stepper — order MUST match the backend execution order in update.service.ts
const PROGRESS_STEPS = [
  { key: 'starting', label: 'updates.stepStarting' },
  { key: 'migrating', label: 'updates.stepMigrate' },
  { key: 'backing-up', label: 'updates.stepBackup' },
  { key: 'pulling', label: 'updates.stepSnapshot' },
  { key: 'verifying-images', label: 'updates.stepVerifyImages' },
  { key: 'updating', label: 'updates.stepUpdate' },
  { key: 'seeding', label: 'updates.stepSeed' },
  { key: 'verifying', label: 'updates.stepVerify' },
]

const currentStepIndex = computed(() => {
  let status = updateState.value?.status
  // 'checking' is the lock-acquisition phase — map it to 'starting' for the stepper
  if (status === 'checking') status = 'starting'
  if (status === 'completed') return PROGRESS_STEPS.length
  if (status === 'rolling-back' || status === 'failed') return -1
  return PROGRESS_STEPS.findIndex(s => s.key === status)
})

const activeStates = ['starting', 'checking', 'backing-up', 'pulling', 'verifying-images', 'migrating', 'updating', 'seeding', 'verifying', 'rolling-back']

function isActiveState(status: string) {
  return activeStates.includes(status)
}

const logLineCount = computed(() => {
  const log = updateState.value?.log
  if (!log) return 0
  return log.split('\n').filter((l: string) => l.trim()).length
})

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
    // Don't overwrite a local failed/completed state with 'idle' from server — user must dismiss first
    const localStatus = updateState.value?.status
    if (statusData.status === 'idle' && (localStatus === 'failed' || localStatus === 'completed')) {
      // Keep the local state — user hasn't dismissed yet
    } else {
      updateState.value = statusData
    }
    releases.value = releasesData.releases ?? []
    rcEnabled.value = releasesData.rcEnabled ?? false
    updateAvailable.value = notif.available ?? false
    latestVersion.value = notif.latest?.tag ?? ''
    dbStatus.value = dbResult
    // Use the most recent version source: status response (persisted in DB) or notification cache.
    // Also consider the sidebar's version — it has a "never downgrade" guard and may be more
    // up-to-date than a stale API response during rolling restart.
    const statusVersion = statusData?.currentVersion?.replace(/^v/, '') ?? ''
    const notifVersion = notif.current?.replace(/^v/, '') ?? ''
    const sidebarVersion = versionInfo.value?.current?.replace(/^v/, '') ?? ''
    setCurrentVersion(statusVersion || notifVersion || sidebarVersion || currentVersion.value)
    // Final guard: never show "update available" if current version matches latest
    // This catches any stale cache, multi-replica inconsistency, or race condition.
    if (updateAvailable.value && latestVersion.value && currentVersion.value) {
      const cleanCurrent = currentVersion.value.replace(/^v/, '').replace(/-.*$/, '')
      const cleanLatest = latestVersion.value.replace(/^v/, '').replace(/-.*$/, '')
      if (cleanCurrent === cleanLatest) {
        updateAvailable.value = false
      }
    }
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
    setCurrentVersion(result.current ?? '')
    latestVersion.value = result.latest?.tag ?? latestVersion.value
    changelog.value = result.latest?.body ?? ''
    updateVersion(currentVersion.value, latestVersion.value, updateAvailable.value)
    if (!result.available) {
      success.value = t('updates.upToDate')
      setTimeout(() => { success.value = '' }, 3000)
    }
  } catch (err: any) {
    error.value = err?.body?.error || t('updates.failed')
  } finally {
    checking.value = false
  }
}

async function performUpdate(version: string) {
  const backupNote = backupBeforeUpdate.value ? '' : '\n\n' + t('updates.backupDisabledWarning')
  confirmVersion.value = version
  requestConfirm(
    t('updates.confirmUpdate'),
    t('updates.confirmUpdateDesc', { version }) + backupNote,
    false,
    async () => {
      updating.value = true
      error.value = ''
      try {
        await api.post<any>('/updates/perform', { version })
        // Optimistic: show progress immediately instead of waiting for polling
        updateState.value = {
          status: 'starting',
          currentVersion: currentVersion.value,
          targetVersion: version,
          log: '',
        }
        showLogExpanded.value = true
        success.value = ''
        startPolling()
      } catch (err: any) {
        error.value = err?.body?.error || t('updates.failed')
      } finally {
        updating.value = false
      }
    },
  )
}

async function rollback() {
  const target = updateState.value?.rollbackTarget
  requestConfirm(
    t('updates.confirmRollback'),
    t('updates.confirmRollbackDesc', { version: target || '' }),
    true,
    async () => {
      rollingBack.value = true
      error.value = ''
      try {
        await api.post<any>('/updates/rollback', {})
        success.value = t('updates.rollbackStarted')
        startPolling()
      } catch (err: any) {
        error.value = err?.body?.error || t('updates.failed')
      } finally {
        rollingBack.value = false
      }
    },
  )
}

async function runMigrations() {
  requestConfirm(
    t('updates.confirmMigrate'),
    t('updates.confirmMigrateDesc'),
    false,
    async () => {
      migrating.value = true
      error.value = ''
      try {
        const result = await api.post<any>('/updates/migrate', {})
        success.value = result.message
        setTimeout(() => { success.value = '' }, 5000)
      } catch (err: any) {
        error.value = err?.body?.error || t('updates.failed')
      } finally {
        migrating.value = false
      }
    },
  )
}

async function runSeeders() {
  requestConfirm(
    t('updates.confirmSeed'),
    t('updates.confirmSeedDesc'),
    false,
    async () => {
      seeding.value = true
      error.value = ''
      try {
        const result = await api.post<any>('/updates/seed', {})
        success.value = result.message
        setTimeout(() => { success.value = '' }, 5000)
      } catch (err: any) {
        error.value = err?.body?.error || t('updates.failed')
      } finally {
        seeding.value = false
      }
    },
  )
}

async function resetUpdateState() {
  requestConfirm(
    t('updates.confirmReset'),
    t('updates.confirmResetDesc'),
    true,
    async () => {
      resetting.value = true
      error.value = ''
      try {
        const result = await api.post<any>('/updates/reset', {})
        success.value = result.message
        setTimeout(() => { success.value = '' }, 5000)
        await fetchAll()
      } catch (err: any) {
        error.value = err?.body?.error || t('updates.failed')
      } finally {
        resetting.value = false
      }
    },
  )
}

async function saveSettings() {
  try {
    await api.patch('/updates/settings', {
      includeRcReleases: includeRcReleases.value,
      autoCheckEnabled: autoCheckEnabled.value,
      backupBeforeUpdate: backupBeforeUpdate.value,
    })
    success.value = t('updates.settingsSaved')
    setTimeout(() => { success.value = '' }, 3000)
    // Refresh releases list to reflect RC toggle
    const releasesData = await api.get<any>('/updates/releases?limit=10')
    releases.value = releasesData.releases ?? []
    rcEnabled.value = releasesData.rcEnabled ?? false
  } catch (err: any) {
    error.value = err?.body?.error || t('updates.failed')
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
      // Accept real progress from server; keep optimistic 'starting' state while server still idle
      if (state.status !== 'idle') {
        updateState.value = state
      } else if (Date.now() - pollStartedAt > 15000) {
        // Grace period expired but server still idle — update failed to start
        updateState.value = state
      }
      if (state.status === 'completed' || state.status === 'failed') {
        stopPolling()
        // Use the target version as the definitive "current" after a successful update.
        // This is more reliable than state.currentVersion which might come from an old replica.
        const completedVersion = state.status === 'completed'
          ? (state.targetVersion ?? state.currentVersion ?? '').replace(/^v/, '')
          : ''
        if (completedVersion) {
          setCurrentVersion(completedVersion)
          updateAvailable.value = false
          updateVersion(completedVersion, latestVersion.value, false)
        }
        // On success: show "restarting" state and ping until the NEW API comes back
        if (state.status === 'completed') {
          waitingForRestart.value = true
          restartPingCount.value = 0
          const expectedVersion = completedVersion
          // Wait a moment for containers to begin restarting, then start pinging
          await new Promise(r => setTimeout(r, 3000))
          const pingInterval = setInterval(async () => {
            restartPingCount.value++
            try {
              const pingStatus = await api.get<any>('/updates/status')
              // Verify this is the NEW container, not the old one still alive during
              // Docker Swarm's rolling update. Check the notification endpoint which
              // reflects the container's actual FLEET_VERSION.
              if (expectedVersion) {
                const notif = await api.get<any>('/updates/notification').catch(() => null)
                const reportedVersion = (notif?.current ?? '').replace(/^v/, '')
                if (reportedVersion && !isNewerOrEqual(reportedVersion, expectedVersion)) {
                  // Old container still responding — keep pinging
                  return
                }
              }
              // API is back up with the new version — refresh data
              clearInterval(pingInterval)
              const savedState = { ...updateState.value }
              await fetchAll()
              // After fetchAll, force updateAvailable=false since we just completed
              updateAvailable.value = false
              if (currentVersion.value) {
                updateVersion(currentVersion.value, latestVersion.value, false)
              }
              updateState.value = savedState
              waitingForRestart.value = false
            } catch {
              // API still down — keep pinging (up to 60 attempts = ~2 minutes)
              if (restartPingCount.value >= 60) {
                clearInterval(pingInterval)
                waitingForRestart.value = false
              }
            }
          }, 2000)
        }
      }
    } catch { /* ignore -- API may be restarting */ }
  }, 2000)
}

function stopPolling() {
  if (statusPollInterval) {
    clearInterval(statusPollInterval)
    statusPollInterval = null
  }
}

/** Dismiss the completed/failed banner and refresh all data to clear stale state. */
async function dismissState() {
  // If this was a successful update, lock in the target version before clearing
  if (updateState.value?.status === 'completed' && updateState.value.targetVersion) {
    setCurrentVersion(updateState.value.targetVersion.replace(/^v/, ''))
  }
  updateState.value = { status: 'idle' }
  updateAvailable.value = false
  // Re-fetch to get fresh data from the (hopefully) new API
  await fetchAll()
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
    <!-- 1. Header -->
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
      <div class="flex items-center gap-3">
        <Download class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('updates.title') }}</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400">v{{ currentVersion || '...' }}</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button
          v-if="updateState.canRollback"
          @click="rollback"
          :disabled="rollingBack"
          class="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300 text-sm font-medium transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
        >
          <Loader2 v-if="rollingBack" class="w-4 h-4 animate-spin" />
          <RotateCcw v-else class="w-4 h-4" />
          {{ t('updates.rollbackTo', { version: updateState.rollbackTarget || '' }) }}
        </button>
        <button
          @click="checkForUpdates"
          :disabled="checking"
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          <Loader2 v-if="checking" class="w-4 h-4 animate-spin" />
          <RefreshCw v-else class="w-4 h-4" />
          {{ checking ? t('updates.checking') : t('updates.checkForUpdates') }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else class="space-y-6">
      <!-- 2. Error/Success alerts -->
      <div v-if="error" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
        <AlertTriangle class="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <p class="text-sm text-red-700 dark:text-red-300 flex-1">{{ error }}</p>
        <button @click="error = ''" class="text-red-400 hover:text-red-600 dark:hover:text-red-300">
          <X class="w-4 h-4" />
        </button>
      </div>
      <div v-if="success" class="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-start gap-3">
        <Check class="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
        <p class="text-sm text-green-700 dark:text-green-300 flex-1">{{ success }}</p>
        <button @click="success = ''" class="text-green-400 hover:text-green-600 dark:hover:text-green-300">
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- 3. Active Operation Card -->
      <div
        v-if="updateState.status !== 'idle'"
        class="bg-white dark:bg-gray-800 rounded-xl border shadow-sm overflow-hidden"
        :class="
          updateState.status === 'failed' ? 'border-red-300 dark:border-red-700' :
          updateState.status === 'completed' ? 'border-green-300 dark:border-green-700' :
          'border-blue-300 dark:border-blue-700'
        "
      >
        <!-- Status header -->
        <div class="px-6 py-4 flex items-center gap-3" :class="
          updateState.status === 'failed' ? 'bg-red-50 dark:bg-red-900/20' :
          updateState.status === 'completed' ? 'bg-green-50 dark:bg-green-900/20' :
          'bg-blue-50 dark:bg-blue-900/20'
        ">
          <Loader2 v-if="isActiveState(updateState.status)" class="w-5 h-5 animate-spin text-blue-600 dark:text-blue-400 shrink-0" />
          <AlertTriangle v-else-if="updateState.status === 'failed'" class="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
          <Check v-else-if="updateState.status === 'completed'" class="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold" :class="
              updateState.status === 'failed' ? 'text-red-700 dark:text-red-300' :
              updateState.status === 'completed' ? 'text-green-700 dark:text-green-300' :
              'text-blue-700 dark:text-blue-300'
            ">
              {{ updateState.status === 'completed' ? t('updates.completed') : updateState.status === 'failed' ? t('updates.failed') : updateState.status === 'rolling-back' ? t('updates.rollingBack') : updateState.status === 'starting' ? t('updates.starting') : t('updates.title') }}
            </p>
            <p v-if="updateState.targetVersion" class="text-xs mt-0.5 text-gray-600 dark:text-gray-400">
              {{ t('updates.versionTransition') }}: {{ updateState.currentVersion }} &rarr; {{ updateState.targetVersion }}
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              v-if="updateState.status === 'completed' || updateState.status === 'failed'"
              @click="dismissState"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              :class="updateState.status === 'failed'
                ? 'border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30'
                : 'border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/30'"
            >
              <XCircle class="w-3.5 h-3.5" />
              {{ t('updates.dismiss') }}
            </button>
            <button
              v-if="updateState.status === 'failed' || isActiveState(updateState.status)"
              @click="resetUpdateState"
              :disabled="resetting"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              :class="updateState.status === 'failed'
                ? 'border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30'
                : 'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30'"
            >
              <Loader2 v-if="resetting" class="w-3.5 h-3.5 animate-spin" />
              <XCircle v-else class="w-3.5 h-3.5" />
              {{ t('updates.reset') }}
            </button>
          </div>
        </div>

        <!-- Progress stepper -->
        <div class="px-6 py-5">
          <div class="flex items-start justify-between">
            <div v-for="(step, idx) in PROGRESS_STEPS" :key="step.key" class="flex flex-col items-center flex-1 relative">
              <!-- Connecting line (before circle, except first step) -->
              <div v-if="idx > 0" class="absolute top-3.5 right-1/2 w-full h-0.5 -translate-y-1/2"
                :class="
                  updateState.status === 'completed' ? 'bg-green-400 dark:bg-green-500' :
                  updateState.status === 'rolling-back' || updateState.status === 'failed' ? (
                    currentStepIndex === -1 && idx <= PROGRESS_STEPS.findIndex(s => s.key === updateState.failedAt) ? 'bg-red-300 dark:bg-red-600' :
                    'bg-gray-200 dark:bg-gray-700'
                  ) :
                  idx <= currentStepIndex ? 'bg-primary-400 dark:bg-primary-500' :
                  'bg-gray-200 dark:bg-gray-700'
                "
              ></div>
              <!-- Circle -->
              <div class="relative z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-all duration-300"
                :class="
                  updateState.status === 'completed' ? 'bg-green-100 dark:bg-green-900/40 border-green-400 dark:border-green-500 text-green-700 dark:text-green-300' :
                  updateState.status === 'rolling-back' ? 'bg-red-100 dark:bg-red-900/40 border-red-400 dark:border-red-500 text-red-700 dark:text-red-300' :
                  updateState.status === 'failed' && step.key === updateState.failedAt ? 'bg-red-100 dark:bg-red-900/40 border-red-400 dark:border-red-500 text-red-700 dark:text-red-300' :
                  idx < currentStepIndex ? 'bg-green-100 dark:bg-green-900/40 border-green-400 dark:border-green-500 text-green-700 dark:text-green-300' :
                  idx === currentStepIndex ? 'bg-primary-100 dark:bg-primary-900/40 border-primary-400 dark:border-primary-500 text-primary-700 dark:text-primary-300 ring-4 ring-primary-100 dark:ring-primary-900/30' :
                  'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400'
                "
              >
                <Check v-if="updateState.status === 'completed' || (idx < currentStepIndex && updateState.status !== 'rolling-back' && updateState.status !== 'failed')" class="w-3.5 h-3.5" />
                <X v-else-if="updateState.status === 'failed' && step.key === updateState.failedAt" class="w-3.5 h-3.5" />
                <AlertTriangle v-else-if="updateState.status === 'rolling-back'" class="w-3 h-3" />
                <Loader2 v-else-if="idx === currentStepIndex && isActiveState(updateState.status)" class="w-3.5 h-3.5 animate-spin" />
                <span v-else>{{ idx + 1 }}</span>
              </div>
              <!-- Label -->
              <span class="mt-2 text-xs text-center leading-tight px-1"
                :class="
                  idx === currentStepIndex ? 'text-gray-900 dark:text-white font-medium' :
                  idx < currentStepIndex || updateState.status === 'completed' ? 'text-green-700 dark:text-green-300' :
                  'text-gray-500 dark:text-gray-400'
                "
              >
                {{ t(step.label) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Collapsible log viewer -->
        <div v-if="updateState.log" class="border-t border-gray-200 dark:border-gray-700">
          <button
            @click="showLogExpanded = !showLogExpanded"
            class="w-full flex items-center justify-between px-6 py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors text-sm"
          >
            <div class="flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <Terminal class="w-4 h-4" />
              <span class="font-medium">{{ t('updates.updateLog') }}</span>
              <span class="text-xs text-gray-500 dark:text-gray-400">({{ t('updates.linesCount', { count: logLineCount }) }})</span>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="isActiveState(updateState.status)" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                <span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                Live
              </span>
              <ChevronUp v-if="showLogExpanded" class="w-4 h-4 text-gray-400" />
              <ChevronDown v-else class="w-4 h-4 text-gray-400" />
            </div>
          </button>
          <div v-if="showLogExpanded">
            <div ref="logContainer" class="bg-gray-900 dark:bg-gray-950 px-4 py-3 max-h-80 overflow-y-auto">
              <div v-for="(line, idx) in (updateState.log || '').split('\n')" :key="idx" class="flex gap-3 font-mono text-xs leading-relaxed">
                <span class="text-gray-600 dark:text-gray-500 select-none w-8 text-right shrink-0">{{ idx + 1 }}</span>
                <span class="text-gray-300 dark:text-gray-400 whitespace-pre-wrap break-words">{{ line }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 3b. Restart waiting banner -->
      <div v-if="waitingForRestart" class="bg-white dark:bg-gray-800 rounded-xl border border-amber-300 dark:border-amber-700 shadow-sm overflow-hidden">
        <div class="px-6 py-5 bg-amber-50 dark:bg-amber-900/10">
          <div class="flex items-center gap-4">
            <div class="shrink-0">
              <Loader2 class="w-6 h-6 text-amber-600 dark:text-amber-400 animate-spin" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold text-amber-700 dark:text-amber-300">
                {{ t('updates.restarting') }}
              </p>
              <p class="text-xs text-amber-600 dark:text-amber-400 mt-1">
                {{ t('updates.restartingDesc') }}
              </p>
            </div>
            <div class="shrink-0">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                {{ t('updates.pinging') }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. Update Available Banner -->
      <div v-if="updateAvailable && updateState.status === 'idle'" class="bg-white dark:bg-gray-800 rounded-xl border border-green-300 dark:border-green-700 shadow-sm overflow-hidden">
        <div class="px-6 py-5 bg-green-50 dark:bg-green-900/10">
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <Download class="w-5 h-5 text-green-600 dark:text-green-400" />
                <p class="text-sm font-semibold text-green-700 dark:text-green-300">
                  {{ t('updates.updateAvailable') }}: {{ latestVersion }}
                </p>
              </div>
              <p v-if="changelog" class="text-xs text-green-600 dark:text-green-400 mt-2 ml-7">
                {{ t('updates.changelog') }}: {{ changelog }}
              </p>
            </div>
            <button
              @click="performUpdate(latestVersion)"
              :disabled="updating"
              class="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium transition-colors shrink-0"
            >
              <Loader2 v-if="updating" class="w-4 h-4 animate-spin" />
              <Download v-else class="w-4 h-4" />
              {{ t('updates.updateNow') }}
            </button>
          </div>
        </div>
      </div>

      <!-- 5. Available Releases -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('updates.releases') }}</h2>
        </div>

        <div v-if="releases.length === 0" class="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
          {{ t('updates.noReleases') }}
        </div>

        <div v-else>
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tag</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('updates.publishedAt') }}</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-for="release in releases" :key="release.tag" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ release.tag }}</span>
                    <span v-if="release.prerelease" class="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded font-medium">
                      {{ t('updates.rc') }}
                    </span>
                    <span v-if="release.tag === currentVersion" class="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded font-medium">
                      {{ t('updates.current') }}
                    </span>
                  </div>
                </td>
                <td class="px-6 py-4">
                  <span class="text-sm text-gray-500 dark:text-gray-400">{{ new Date(release.publishedAt).toLocaleDateString() }}</span>
                </td>
                <td class="px-6 py-4 text-right">
                  <button
                    v-if="release.tag !== currentVersion"
                    @click="performUpdate(release.tag)"
                    :disabled="updating"
                    class="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 disabled:opacity-50 transition-colors"
                  >
                    {{ t('updates.install') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 6. Two-column grid: Database Tools + Settings -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- DB Tools card -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('updates.dbTools') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('updates.dbToolsDesc') }}</p>
          </div>
          <div class="px-6 py-4 space-y-3">
            <div class="flex flex-wrap items-center gap-3">
              <button
                @click="runMigrations"
                :disabled="migrating"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                <Loader2 v-if="migrating" class="w-4 h-4 animate-spin" />
                <Database v-else class="w-4 h-4" />
                {{ t('updates.runMigrations') }}
              </button>
              <button
                @click="runSeeders"
                :disabled="seeding"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                <Loader2 v-if="seeding" class="w-4 h-4 animate-spin" />
                <Sprout v-else class="w-4 h-4" />
                {{ t('updates.runSeeders') }}
              </button>
            </div>
            <div v-if="dbStatus" class="flex items-center gap-1.5 text-sm pt-1">
              <Check v-if="dbStatus.ok" class="w-4 h-4 text-green-600 dark:text-green-400" />
              <AlertTriangle v-else class="w-4 h-4 text-red-600 dark:text-red-400" />
              <span :class="dbStatus.ok ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'">
                {{ dbStatus.ok ? t('updates.dbConnected') : t('updates.dbError') + ': ' + dbStatus.error }}
              </span>
            </div>
          </div>
        </div>

        <!-- Settings card -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-2">
              <Settings class="w-5 h-5 text-gray-500 dark:text-gray-400" />
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('updates.settings') }}</h2>
            </div>
          </div>
          <div class="px-6 py-4 space-y-4">
            <label class="flex items-start gap-3 cursor-pointer">
              <input v-model="backupBeforeUpdate" type="checkbox" class="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" @change="saveSettings" />
              <div>
                <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('updates.backupBefore') }}</span>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('updates.backupBeforeDesc') }}</p>
              </div>
            </label>
            <label class="flex items-center gap-3 cursor-pointer">
              <input v-model="autoCheckEnabled" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" @change="saveSettings" />
              <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('updates.autoCheck') }}</span>
            </label>
            <label class="flex items-center gap-3 cursor-pointer">
              <input v-model="includeRcReleases" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" @change="saveSettings" />
              <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('updates.rcVersions') }}</span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- 7. Inline Confirmation Modal -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showConfirm" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="cancelConfirm"></div>
          <div class="relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-full max-w-md p-6">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ confirmTitle }}</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400 mt-2 whitespace-pre-line">{{ confirmDesc }}</p>
            <div class="flex items-center justify-end gap-3 mt-6">
              <button
                @click="cancelConfirm"
                class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                {{ t('updates.cancel') }}
              </button>
              <button
                @click="executeConfirm"
                class="px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors"
                :class="confirmDanger
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-primary-600 hover:bg-primary-700'"
              >
                {{ t('updates.confirm') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
