<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Box, Play, Square, Power, RotateCw, RefreshCcw, Trash2, Loader2, ArrowLeft, Radio, SquareTerminal, FolderOpen, Github, Webhook, Archive, Clock, Database, XCircle } from 'lucide-vue-next'
import FileExplorer from '@/components/FileExplorer.vue'
import DatabaseManager from '@/components/DatabaseManager.vue'
import { useApi, ApiError } from '@/composables/useApi'
import { useLogStream } from '@/composables/useLogStream'
import { useTerminal } from '@/composables/useTerminal'
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'
import '@xterm/xterm/css/xterm.css'

const route = useRoute()
const router = useRouter()
const api = useApi()
const toast = useToast()
const { t } = useI18n()
const serviceId = route.params.id as string
const logStream = useLogStream()

const activeTab = ref('overview')
const tabs = computed(() => {
  const base = [
    { id: 'overview', label: 'Overview' },
  ]
  if (service.value?.sourceType === 'upload') {
    base.push({ id: 'files', label: 'Files' })
  }
  if (service.value?.image && isDatabaseImage(service.value.image)) {
    base.push({ id: 'database', label: 'Database' })
  }
  base.push(
    { id: 'logs', label: 'Logs' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'deployments', label: 'Deployments' },
    { id: 'backups', label: 'Backups' },
    { id: 'settings', label: 'Settings' },
  )
  return base
})

const { createTerminal, connect: terminalConnect, disconnect: terminalDisconnect, connectionState: terminalState, refit: terminalRefit } = useTerminal()
const terminalContainer = ref<HTMLElement | null>(null)
const terminalCreated = ref(false)
const terminalContainers = ref<{ containerId: string; nodeId: string; taskId: string }[]>([])
const selectedContainerId = ref('')

const service = ref<any>(null)
const loading = ref(true)
const actionLoading = ref('')
const error = ref('')
const logs = ref('')
const logsLoading = ref(false)
const liveMode = ref(false)
const deployments = ref<any[]>([])
const deploymentsLoading = ref(false)
const logsContainer = ref<HTMLElement | null>(null)

const envVars = ref<{ key: string; value: string }[]>([])
const settingsLoading = ref(false)

// Auto-deploy settings
const autoDeployEnabled = ref(false)
const autoDeployBranch = ref('')
const autoDeployLoading = ref(false)
const autoDeployError = ref('')

// Service configuration settings
const configReplicas = ref(1)
const configRestartCondition = ref<'none' | 'on-failure' | 'any'>('on-failure')
const configRestartMaxAttempts = ref(3)
const configRestartDelay = ref('10s')
const configUpdateParallelism = ref(1)
const configUpdateDelay = ref('10s')
const configRollbackOnFailure = ref(true)
const configLoading = ref(false)

const restartPolicyLabel = computed(() => {
  const condition = service.value?.restartCondition ?? 'on-failure'
  if (condition === 'none') return 'Never'
  if (condition === 'any') return 'Always'
  const attempts = service.value?.restartMaxAttempts ?? 3
  const delay = service.value?.restartDelay ?? '10s'
  return `On failure (${attempts}x, ${delay})`
})

// Backups
const serviceBackups = ref<any[]>([])
const serviceSchedules = ref<any[]>([])
const backupsLoading = ref(false)
const backupSubTab = ref<'backups' | 'schedules'>('backups')
const creatingBackup = ref(false)
const showAddSchedule = ref(false)
const scheduleCron = ref('0 2 * * *')
const scheduleRetentionDays = ref(30)
const scheduleRetentionCount = ref(10)
const addingSchedule = ref(false)
const backupError = ref('')

async function fetchServiceBackups() {
  backupsLoading.value = true
  try {
    const [b, s] = await Promise.all([
      api.get<any[]>(`/backups?serviceId=${serviceId}`),
      api.get<any[]>(`/backups/schedules?serviceId=${serviceId}`),
    ])
    serviceBackups.value = b
    serviceSchedules.value = s
  } catch {
    serviceBackups.value = []
    serviceSchedules.value = []
  } finally {
    backupsLoading.value = false
  }
}

async function createServiceBackup() {
  creatingBackup.value = true
  backupError.value = ''
  try {
    await api.post('/backups', { serviceId, storageBackend: 'nfs' })
    await fetchServiceBackups()
  } catch (err: any) {
    backupError.value = err?.body?.error || 'Failed to create backup'
  } finally {
    creatingBackup.value = false
  }
}

async function restoreServiceBackup(backupId: string) {
  if (!confirm('Restore from this backup? This will overwrite current data.')) return
  backupError.value = ''
  try {
    await api.post(`/backups/${backupId}/restore`, {})
    await fetchServiceBackups()
  } catch (err: any) {
    backupError.value = err?.body?.error || 'Failed to restore backup'
  }
}

async function deleteServiceBackup(backupId: string) {
  if (!confirm('Delete this backup?')) return
  try {
    await api.del(`/backups/${backupId}`)
    await fetchServiceBackups()
  } catch (err: any) {
    backupError.value = err?.body?.error || 'Failed to delete backup'
  }
}

async function addServiceSchedule() {
  if (!scheduleCron.value) return
  addingSchedule.value = true
  backupError.value = ''
  try {
    await api.post('/backups/schedules', {
      serviceId,
      cron: scheduleCron.value,
      retentionDays: scheduleRetentionDays.value,
      retentionCount: scheduleRetentionCount.value,
      storageBackend: 'nfs',
    })
    scheduleCron.value = '0 2 * * *'
    scheduleRetentionDays.value = 30
    scheduleRetentionCount.value = 10
    showAddSchedule.value = false
    await fetchServiceBackups()
  } catch (err: any) {
    backupError.value = err?.body?.error || 'Failed to create schedule'
  } finally {
    addingSchedule.value = false
  }
}

async function runServiceSchedule(scheduleId: string) {
  backupError.value = ''
  try {
    await api.post(`/backups/schedules/${scheduleId}/run`, {})
    await fetchServiceBackups()
  } catch (err: any) {
    backupError.value = err?.body?.error || 'Failed to run schedule'
  }
}

async function deleteServiceSchedule(scheduleId: string) {
  if (!confirm('Delete this backup schedule?')) return
  try {
    await api.del(`/backups/schedules/${scheduleId}`)
    await fetchServiceBackups()
  } catch (err: any) {
    backupError.value = err?.body?.error || 'Failed to delete schedule'
  }
}

function formatSize(bytes: any) {
  const b = Number(bytes) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function isDatabaseImage(image: string): boolean {
  return /^(postgres|mysql|mariadb|bitnami\/(postgresql|mysql|mariadb))/i.test(image)
}

const displayedLogs = computed(() => liveMode.value ? logStream.logs.value : logs.value)

const dockerStatus = computed(() => service.value?.dockerStatus ?? null)

const failedTasks = computed(() => {
  if (!dockerStatus.value?.tasks) return []
  return dockerStatus.value.tasks
    .filter((t: any) => t.status === 'failed')
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
})

const failureReason = computed(() => {
  if (service.value?.status !== 'failed' || failedTasks.value.length === 0) return null
  const latest = failedTasks.value[0]
  const parts: string[] = []
  if (latest.error) {
    parts.push(latest.error)
  }
  if (latest.containerStatus?.exitCode !== undefined && latest.containerStatus.exitCode !== 0) {
    parts.push(`Container exited with code ${latest.containerStatus.exitCode}`)
  }
  if (parts.length === 0 && latest.message) {
    parts.push(`Task state: ${latest.message}`)
  }
  return parts.length > 0 ? parts.join(' — ') : 'Unknown failure reason. Check logs for details.'
})

function toggleLiveMode() {
  liveMode.value = !liveMode.value
  if (liveMode.value) {
    logStream.start(serviceId)
  } else {
    logStream.stop()
    fetchLogs()
  }
}

// Auto-scroll logs when new content arrives in live mode
watch(() => logStream.logs.value, () => {
  if (liveMode.value && logsContainer.value) {
    nextTick(() => {
      logsContainer.value!.scrollTop = logsContainer.value!.scrollHeight
    })
  }
})

async function fetchService() {
  loading.value = true
  error.value = ''
  try {
    service.value = await api.get(`/services/${serviceId}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      error.value = 'Service not found'
    } else {
      error.value = 'Failed to load service'
    }
  } finally {
    loading.value = false
  }
}

async function fetchLogs() {
  logsLoading.value = true
  try {
    const data = await api.get<{ logs: string }>(`/services/${serviceId}/logs?tail=200`)
    logs.value = data.logs || 'No logs available.'
  } catch (err: any) {
    if (err instanceof ApiError && err.status === 404) {
      logs.value = 'No logs available yet. The service needs to be deployed first.'
    } else {
      logs.value = 'Failed to fetch logs.'
    }
  } finally {
    logsLoading.value = false
  }
}

async function fetchDeployments() {
  deploymentsLoading.value = true
  try {
    deployments.value = await api.get(`/services/${serviceId}/deployments`)
  } catch {
    deployments.value = []
  } finally {
    deploymentsLoading.value = false
  }
}

async function stopService() {
  actionLoading.value = 'stop'
  try {
    await api.post(`/services/${serviceId}/stop`, {})
    await fetchService()
  } catch {
    toast.error(t('service.stopFailed', 'Failed to stop service'))
  } finally {
    actionLoading.value = ''
  }
}

async function startService() {
  actionLoading.value = 'start'
  try {
    await api.post(`/services/${serviceId}/start`, {})
    await fetchService()
  } catch {
    toast.error(t('service.startFailed', 'Failed to start service'))
  } finally {
    actionLoading.value = ''
  }
}

async function restartService() {
  actionLoading.value = 'restart'
  try {
    await api.post(`/services/${serviceId}/restart`, {})
    await fetchService()
  } catch {
    toast.error(t('service.restartFailed', 'Failed to restart service'))
  } finally {
    actionLoading.value = ''
  }
}

async function redeployService() {
  actionLoading.value = 'redeploy'
  try {
    await api.post(`/services/${serviceId}/redeploy`, {})
    await fetchService()
  } catch {
    toast.error(t('service.redeployFailed', 'Failed to redeploy service'))
  } finally {
    actionLoading.value = ''
  }
}

async function cancelDeploy() {
  actionLoading.value = 'cancel'
  try {
    await api.post(`/services/${serviceId}/cancel-deploy`, {})
    await fetchService()
  } catch {
    toast.error('Failed to cancel deployment')
  } finally {
    actionLoading.value = ''
  }
}

async function syncStatus() {
  actionLoading.value = 'sync'
  try {
    const result = await api.post<{ status: string; synced: boolean }>(`/services/${serviceId}/sync`, {})
    if (result.synced && service.value) {
      service.value.status = result.status
    }
    await fetchService()
  } catch {
    toast.error('Failed to sync service status')
  } finally {
    actionLoading.value = ''
  }
}

async function deleteService() {
  if (!confirm('Are you sure you want to delete this service? This action cannot be undone.')) return
  actionLoading.value = 'delete'
  try {
    await api.del(`/services/${serviceId}`)
    router.push('/panel/services')
  } catch {
    toast.error(t('service.deleteFailed', 'Failed to delete service'))
  } finally {
    actionLoading.value = ''
  }
}

async function saveSettings() {
  settingsLoading.value = true
  try {
    const envObj: Record<string, string> = {}
    for (const v of envVars.value) {
      if (v.key.trim()) envObj[v.key.trim()] = v.value
    }
    await api.patch(`/services/${serviceId}`, { env: envObj })
    await fetchService()
  } catch {
    toast.error(t('service.saveSettingsFailed', 'Failed to save settings'))
  } finally {
    settingsLoading.value = false
  }
}

async function saveConfig() {
  configLoading.value = true
  try {
    await api.patch(`/services/${serviceId}`, {
      replicas: configReplicas.value,
      restartCondition: configRestartCondition.value,
      restartMaxAttempts: configRestartMaxAttempts.value,
      restartDelay: configRestartDelay.value,
      updateParallelism: configUpdateParallelism.value,
      updateDelay: configUpdateDelay.value,
      rollbackOnFailure: configRollbackOnFailure.value,
    })
    await fetchService()
    toast.success('Configuration saved')
  } catch {
    toast.error('Failed to save configuration')
  } finally {
    configLoading.value = false
  }
}

async function saveAutoDeploy() {
  autoDeployLoading.value = true
  autoDeployError.value = ''
  try {
    await api.patch(`/services/${serviceId}`, {
      autoDeploy: autoDeployEnabled.value,
      githubBranch: autoDeployBranch.value || undefined,
    })
    await fetchService()
  } catch (err: any) {
    autoDeployError.value = err?.body?.error || err?.message || 'Failed to update auto-deploy settings'
  } finally {
    autoDeployLoading.value = false
  }
}

function switchTerminalContainer(containerId: string) {
  selectedContainerId.value = containerId
  terminalDisconnect()
  terminalConnect(serviceId, containerId)
}

function addEnvVar() {
  envVars.value.push({ key: '', value: '' })
}

function removeEnvVar(index: number) {
  envVars.value.splice(index, 1)
}

function formatDate(ts: any) {
  if (!ts) return '--'
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  return d.toLocaleString()
}

async function onTabChange(tabId: string) {
  // Stop live mode when leaving logs tab
  if (activeTab.value === 'logs' && tabId !== 'logs' && liveMode.value) {
    liveMode.value = false
    logStream.stop()
  }

  activeTab.value = tabId
  if (tabId === 'logs') fetchLogs()
  if (tabId === 'deployments') fetchDeployments()
  if (tabId === 'settings' && service.value) {
    const env = service.value.env ?? {}
    envVars.value = Object.entries(env).map(([key, value]) => ({ key, value: String(value) }))
    autoDeployEnabled.value = service.value.autoDeploy ?? false
    autoDeployBranch.value = service.value.githubBranch ?? ''
    autoDeployError.value = ''
    configReplicas.value = service.value.replicas ?? 1
    configRestartCondition.value = service.value.restartCondition ?? 'on-failure'
    configRestartMaxAttempts.value = service.value.restartMaxAttempts ?? 3
    configRestartDelay.value = service.value.restartDelay ?? '10s'
    configUpdateParallelism.value = service.value.updateParallelism ?? 1
    configUpdateDelay.value = service.value.updateDelay ?? '10s'
    configRollbackOnFailure.value = service.value.rollbackOnFailure ?? true
  }
  if (tabId === 'backups') fetchServiceBackups()
  if (tabId === 'terminal' && service.value?.status === 'running') {
    // Fetch container list for replica picker
    try {
      const info = await api.get<{ containers: { containerId: string; nodeId: string; taskId: string }[] }>(`/terminal/info/${serviceId}`)
      terminalContainers.value = info.containers ?? []
      // Pre-select first container if none selected
      if (!selectedContainerId.value && terminalContainers.value.length > 0) {
        selectedContainerId.value = terminalContainers.value[0]!.containerId
      }
    } catch {
      terminalContainers.value = []
    }

    nextTick(() => {
      if (!terminalCreated.value && terminalContainer.value) {
        createTerminal(terminalContainer.value)
        terminalCreated.value = true
        terminalConnect(serviceId, selectedContainerId.value || undefined)
      } else {
        // Terminal already exists — just refit the canvas (v-show resize)
        terminalRefit()
      }
    })
  }
}

onMounted(() => {
  fetchService()
})
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="text-center py-20">
      <p class="text-gray-500 dark:text-gray-400 mb-4">{{ error }}</p>
      <router-link to="/panel/services" class="text-primary-600 dark:text-primary-400 text-sm hover:underline">
        &larr; Back to Services
      </router-link>
    </div>

    <template v-else-if="service">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div class="flex items-start gap-3">
          <router-link to="/panel/services" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors mt-1.5">
            <ArrowLeft class="w-5 h-5" />
          </router-link>
          <Box class="w-7 h-7 text-primary-600 dark:text-primary-400 shrink-0 mt-0.5" />
          <div>
            <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ service.name }}</h1>
            <p class="text-sm text-gray-500 dark:text-gray-400 font-mono mt-1">{{ service.image }}</p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0 mt-1 sm:ml-0 ml-auto">
            <span
              :class="[
                'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                service.status === 'running' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                service.status === 'stopped' ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' :
                service.status === 'failed' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
              ]"
            >
              {{ service.status }}
            </span>
            <span v-if="service.status === 'stopped'" class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
              Not billed
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="service.status === 'stopped'"
            @click="startService"
            :disabled="!!actionLoading"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-green-300 dark:border-green-600 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors text-sm font-medium disabled:opacity-50"
          >
            <Power class="w-4 h-4" />
            Start
          </button>
          <button
            v-if="service.status === 'running'"
            @click="stopService"
            :disabled="!!actionLoading"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-orange-300 dark:border-orange-600 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors text-sm font-medium disabled:opacity-50"
          >
            <Square class="w-4 h-4" />
            Stop
          </button>
          <button
            v-if="service.status === 'deploying'"
            @click="cancelDeploy"
            :disabled="!!actionLoading"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm font-medium disabled:opacity-50"
          >
            <XCircle class="w-4 h-4" />
            Cancel Deploy
          </button>
          <button
            v-if="service.status !== 'stopped'"
            @click="redeployService"
            :disabled="!!actionLoading"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
          >
            <Play class="w-4 h-4" />
            Redeploy
          </button>
          <button
            v-if="service.status !== 'stopped'"
            @click="restartService"
            :disabled="!!actionLoading"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
          >
            <RotateCw class="w-4 h-4" />
            Restart
          </button>
          <button
            @click="syncStatus"
            :disabled="!!actionLoading"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
            title="Sync status with Docker"
          >
            <RefreshCcw :class="['w-4 h-4', actionLoading === 'sync' ? 'animate-spin' : '']" />
            Sync
          </button>
          <button
            @click="deleteService"
            :disabled="!!actionLoading"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm font-medium disabled:opacity-50"
          >
            <Trash2 class="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      <!-- Tabs -->
      <div class="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav class="flex flex-wrap gap-x-6 gap-y-3 -mb-px">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            @click="onTabChange(tab.id)"
            :class="[
              'pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              activeTab === tab.id
                ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
            ]"
          >
            {{ tab.label }}
          </button>
        </nav>
      </div>

      <!-- Tab content -->
      <div>
        <!-- Overview -->
        <div v-if="activeTab === 'overview'" class="space-y-6">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Status</p>
              <p class="text-lg font-bold text-gray-900 dark:text-white capitalize">{{ service.status }}</p>
            </div>
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Replicas</p>
              <p class="text-lg font-bold text-gray-900 dark:text-white">
                <template v-if="dockerStatus">{{ dockerStatus.runningTasks }}/{{ dockerStatus.desiredTasks }}</template>
                <template v-else>{{ service.replicas ?? 1 }}</template>
              </p>
            </div>
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Domain</p>
              <p class="text-lg font-bold text-gray-900 dark:text-white">{{ service.domain || 'None' }}</p>
            </div>
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Restart Policy</p>
              <p class="text-lg font-bold text-gray-900 dark:text-white capitalize">
                {{ restartPolicyLabel }}
              </p>
            </div>
          </div>

          <!-- Failure alert -->
          <div v-if="service.status === 'failed' && failedTasks.length > 0" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-5">
            <div class="flex items-start gap-3">
              <XCircle class="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-red-800 dark:text-red-200">Service failed to start</h3>
                <p class="text-sm text-red-700 dark:text-red-300 mt-1">{{ failureReason }}</p>
                <div class="mt-3 space-y-2">
                  <p class="text-xs font-medium text-red-600 dark:text-red-400 uppercase">Recent failed tasks ({{ failedTasks.length }})</p>
                  <div v-for="task in failedTasks.slice(0, 5)" :key="task.id" class="flex items-center gap-3 text-xs text-red-600 dark:text-red-400 bg-red-100/50 dark:bg-red-900/30 rounded-lg px-3 py-2">
                    <span class="font-mono shrink-0">{{ task.id.slice(0, 12) }}</span>
                    <span v-if="task.error" class="truncate">{{ task.error }}</span>
                    <span v-else-if="task.containerStatus?.exitCode !== undefined" class="truncate">Exit code {{ task.containerStatus.exitCode }}</span>
                    <span v-else class="truncate text-red-500 dark:text-red-500">{{ task.message || 'No error details' }}</span>
                    <span class="ml-auto shrink-0 text-red-500 dark:text-red-500">{{ formatDate(task.createdAt) }}</span>
                  </div>
                </div>
                <p class="text-xs text-red-600 dark:text-red-400 mt-3">Check the <button class="underline font-medium" @click="onTabChange('logs')">Logs</button> tab for detailed error output.</p>
              </div>
            </div>
          </div>

          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Service Info</h3>
            <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt class="text-gray-500 dark:text-gray-400">Image</dt>
                <dd class="font-mono text-gray-900 dark:text-white mt-0.5">{{ service.image }}</dd>
              </div>
              <div>
                <dt class="text-gray-500 dark:text-gray-400">Replicas</dt>
                <dd class="text-gray-900 dark:text-white mt-0.5">{{ service.replicas ?? 1 }}</dd>
              </div>
              <div>
                <dt class="text-gray-500 dark:text-gray-400">Created</dt>
                <dd class="text-gray-900 dark:text-white mt-0.5">{{ formatDate(service.createdAt) }}</dd>
              </div>
              <div>
                <dt class="text-gray-500 dark:text-gray-400">Last Updated</dt>
                <dd class="text-gray-900 dark:text-white mt-0.5">{{ formatDate(service.updatedAt) }}</dd>
              </div>
              <div v-if="service.stoppedAt">
                <dt class="text-gray-500 dark:text-gray-400">Stopped At</dt>
                <dd class="text-gray-900 dark:text-white mt-0.5">{{ formatDate(service.stoppedAt) }}</dd>
              </div>
              <div v-if="service.githubRepo">
                <dt class="text-gray-500 dark:text-gray-400">GitHub Repo</dt>
                <dd class="text-gray-900 dark:text-white mt-0.5">{{ service.githubRepo }}</dd>
              </div>
              <div v-if="service.githubBranch">
                <dt class="text-gray-500 dark:text-gray-400">Branch</dt>
                <dd class="text-gray-900 dark:text-white mt-0.5">{{ service.githubBranch }}</dd>
              </div>
            </dl>
          </div>
        </div>

        <!-- Files -->
        <div v-if="activeTab === 'files' && service.sourceType === 'upload'">
          <FileExplorer :serviceId="serviceId" />
        </div>

        <!-- Database -->
        <div v-if="activeTab === 'database'">
          <DatabaseManager :serviceId="serviceId" />
        </div>

        <!-- Logs -->
        <div v-if="activeTab === 'logs'">
          <div class="bg-gray-900 rounded-xl border border-gray-700 shadow-sm overflow-hidden">
            <div class="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <span class="text-sm font-medium text-gray-300">Service Logs</span>
                <span
                  v-if="liveMode"
                  :class="[
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                    logStream.state.value === 'connected'
                      ? 'bg-green-900/40 text-green-400'
                      : 'bg-yellow-900/40 text-yellow-400'
                  ]"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  {{ logStream.state.value === 'connected' ? 'Live' : 'Connecting...' }}
                </span>
              </div>
              <div class="flex items-center gap-3">
                <button
                  @click="toggleLiveMode"
                  :class="[
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
                    liveMode
                      ? 'bg-green-900/40 text-green-400 hover:bg-green-900/60'
                      : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
                  ]"
                >
                  <Radio class="w-3.5 h-3.5" />
                  {{ liveMode ? 'Stop Live' : 'Live' }}
                </button>
                <button v-if="!liveMode" @click="fetchLogs" class="text-xs text-gray-400 hover:text-gray-300 transition-colors">Refresh</button>
              </div>
            </div>
            <div ref="logsContainer" class="p-4 h-96 overflow-y-auto font-mono text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
              <div v-if="logsLoading && !liveMode" class="flex items-center justify-center h-full">
                <Loader2 class="w-6 h-6 text-gray-500 animate-spin" />
              </div>
              <template v-else>{{ displayedLogs || 'No logs available.' }}</template>
            </div>
          </div>
        </div>

        <!-- Terminal (v-show to keep xterm canvas alive across tab switches) -->
        <div v-show="activeTab === 'terminal'">
          <div v-if="service.status !== 'running'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
            <SquareTerminal class="w-10 h-10 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
            <p class="text-gray-500 dark:text-gray-400 text-sm">Service must be running to open a terminal session.</p>
            <button
              v-if="service.status === 'stopped'"
              @click="startService"
              :disabled="!!actionLoading"
              class="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Power class="w-4 h-4" />
              Start Service
            </button>
          </div>
          <div v-else class="bg-[#1a1b26] rounded-xl border border-gray-700 shadow-sm overflow-hidden">
            <div class="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-red-500"></span>
                <span class="w-3 h-3 rounded-full bg-yellow-500"></span>
                <span class="w-3 h-3 rounded-full bg-green-500"></span>
                <span class="ml-2 text-xs text-gray-400">Terminal - {{ service.name }}</span>
                <select
                  v-if="terminalContainers.length > 1"
                  :value="selectedContainerId"
                  @change="switchTerminalContainer(($event.target as HTMLSelectElement).value)"
                  class="ml-2 px-2 py-0.5 rounded border border-gray-600 bg-gray-800 text-gray-300 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option v-for="(ctr, idx) in terminalContainers" :key="ctr.containerId" :value="ctr.containerId">
                    Replica {{ idx + 1 }} ({{ ctr.containerId.slice(0, 12) }})
                  </option>
                </select>
              </div>
              <span
                :class="[
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                  terminalState === 'connected'
                    ? 'bg-green-900/40 text-green-400'
                    : terminalState === 'connecting' || terminalState === 'reconnecting'
                      ? 'bg-yellow-900/40 text-yellow-400'
                      : 'bg-gray-700 text-gray-400'
                ]"
              >
                <span :class="['w-1.5 h-1.5 rounded-full', terminalState === 'connected' ? 'bg-green-400' : terminalState === 'connecting' || terminalState === 'reconnecting' ? 'bg-yellow-400 animate-pulse' : 'bg-gray-500']"></span>
                {{ terminalState === 'connected' ? 'Connected' : terminalState === 'connecting' ? 'Connecting...' : terminalState === 'reconnecting' ? 'Reconnecting...' : 'Disconnected' }}
              </span>
            </div>
            <div ref="terminalContainer" class="h-[500px] pt-2 px-2 pb-5"></div>
          </div>
        </div>

        <!-- Deployments -->
        <div v-if="activeTab === 'deployments'">
          <div v-if="deploymentsLoading" class="flex items-center justify-center py-12">
            <Loader2 class="w-6 h-6 text-gray-400 animate-spin" />
          </div>
          <div v-else-if="deployments.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
            No deployments yet.
          </div>
          <template v-else>
            <!-- Desktop table -->
            <div class="hidden sm:block bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <table class="w-full">
                <thead>
                  <tr class="border-b border-gray-200 dark:border-gray-700">
                    <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Image Tag</th>
                    <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                    <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Deployed At</th>
                    <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Commit</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                  <tr
                    v-for="deploy in deployments"
                    :key="deploy.id"
                    class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <td class="px-6 py-4 text-sm font-mono text-gray-900 dark:text-white">{{ deploy.imageTag || '--' }}</td>
                    <td class="px-6 py-4 text-sm">
                      <span
                        :class="[
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          deploy.status === 'succeeded' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                          deploy.status === 'failed' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                          'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                        ]"
                      >
                        {{ deploy.status }}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(deploy.createdAt) }}</td>
                    <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 font-mono">{{ deploy.commitSha ? deploy.commitSha.slice(0, 7) : '--' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- Mobile cards -->
            <div class="sm:hidden space-y-3">
              <div v-for="deploy in deployments" :key="deploy.id" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 space-y-2.5">
                <div class="flex items-center justify-between">
                  <span class="text-sm font-mono font-medium text-gray-900 dark:text-white truncate mr-2">{{ deploy.imageTag || '--' }}</span>
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0',
                      deploy.status === 'succeeded' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                      deploy.status === 'failed' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                      'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                    ]"
                  >
                    {{ deploy.status }}
                  </span>
                </div>
                <div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>{{ formatDate(deploy.createdAt) }}</span>
                  <span v-if="deploy.commitSha" class="font-mono">{{ deploy.commitSha.slice(0, 7) }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Backups -->
        <div v-if="activeTab === 'backups'">
          <div v-if="backupError" class="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p class="text-sm text-red-700 dark:text-red-300">{{ backupError }}</p>
          </div>

          <!-- Sub-tabs -->
          <div class="flex items-center justify-between mb-4">
            <div class="flex gap-4">
              <button
                @click="backupSubTab = 'backups'"
                :class="['text-sm font-medium pb-1 border-b-2 transition-colors', backupSubTab === 'backups' ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']"
              >
                Backups
              </button>
              <button
                @click="backupSubTab = 'schedules'"
                :class="['text-sm font-medium pb-1 border-b-2 transition-colors', backupSubTab === 'schedules' ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']"
              >
                Schedules
              </button>
            </div>
            <button
              v-if="backupSubTab === 'backups'"
              @click="createServiceBackup"
              :disabled="creatingBackup"
              class="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              <Loader2 v-if="creatingBackup" class="w-3.5 h-3.5 animate-spin" />
              <Archive v-else class="w-3.5 h-3.5" />
              {{ creatingBackup ? 'Creating...' : 'Create Backup' }}
            </button>
            <button
              v-if="backupSubTab === 'schedules'"
              @click="showAddSchedule = true"
              class="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors"
            >
              <Clock class="w-3.5 h-3.5" />
              Add Schedule
            </button>
          </div>

          <!-- Add schedule form -->
          <div v-if="showAddSchedule && backupSubTab === 'schedules'" class="mb-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <h4 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">New Backup Schedule</h4>
            <form @submit.prevent="addServiceSchedule" class="flex items-end gap-3 flex-wrap">
              <div class="flex-1 min-w-40">
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Cron Expression</label>
                <input v-model="scheduleCron" type="text" placeholder="0 2 * * *" required class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
              </div>
              <div class="w-32">
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Retention (days)</label>
                <input v-model.number="scheduleRetentionDays" type="number" min="1" max="365" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
              </div>
              <div class="w-32">
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Max Backups</label>
                <input v-model.number="scheduleRetentionCount" type="number" min="1" max="100" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
              </div>
              <button type="submit" :disabled="addingSchedule" class="px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {{ addingSchedule ? 'Adding...' : 'Add' }}
              </button>
              <button type="button" @click="showAddSchedule = false" class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancel
              </button>
            </form>
          </div>

          <!-- Backups list -->
          <div v-if="backupSubTab === 'backups'">
            <div v-if="backupsLoading" class="flex items-center justify-center py-12">
              <Loader2 class="w-6 h-6 text-primary-600 dark:text-primary-400 animate-spin" />
            </div>
            <div v-else-if="serviceBackups.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
              No backups for this service yet.
            </div>
            <template v-else>
              <!-- Desktop table -->
              <div class="hidden sm:block bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                <table class="w-full">
                  <thead>
                    <tr class="border-b border-gray-200 dark:border-gray-700">
                      <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                      <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Size</th>
                      <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                      <th class="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr v-for="backup in serviceBackups" :key="backup.id" class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td class="px-6 py-3.5 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{{ formatDate(backup.createdAt) }}</td>
                      <td class="px-6 py-3.5 text-sm text-gray-600 dark:text-gray-400">{{ formatSize(backup.sizeBytes) }}</td>
                      <td class="px-6 py-3.5 text-sm">
                        <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', backup.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : backup.status === 'in_progress' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300']">
                          {{ backup.status }}
                        </span>
                      </td>
                      <td class="px-6 py-3.5 text-right">
                        <div class="flex items-center justify-end gap-2">
                          <button v-if="backup.status === 'completed'" @click="restoreServiceBackup(backup.id)" class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">Restore</button>
                          <button @click="deleteServiceBackup(backup.id)" class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">Delete</button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!-- Mobile cards -->
              <div class="sm:hidden space-y-3">
                <div v-for="backup in serviceBackups" :key="backup.id" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 space-y-2.5">
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-gray-900 dark:text-white">{{ formatDate(backup.createdAt) }}</span>
                    <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', backup.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : backup.status === 'in_progress' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300']">
                      {{ backup.status }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-xs text-gray-500 dark:text-gray-400">{{ formatSize(backup.sizeBytes) }}</span>
                    <div class="flex items-center gap-3">
                      <button v-if="backup.status === 'completed'" @click="restoreServiceBackup(backup.id)" class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">Restore</button>
                      <button @click="deleteServiceBackup(backup.id)" class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">Delete</button>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Schedules list -->
          <div v-if="backupSubTab === 'schedules'">
            <div v-if="serviceSchedules.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
              No backup schedules for this service.
            </div>
            <template v-else>
              <!-- Desktop table -->
              <div class="hidden sm:block bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                <table class="w-full">
                  <thead>
                    <tr class="border-b border-gray-200 dark:border-gray-700">
                      <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cron</th>
                      <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Retention</th>
                      <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                      <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Run</th>
                      <th class="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr v-for="schedule in serviceSchedules" :key="schedule.id" class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td class="px-6 py-3.5 text-sm font-mono text-gray-900 dark:text-white">{{ schedule.cron }}</td>
                      <td class="px-6 py-3.5 text-sm text-gray-600 dark:text-gray-400">{{ schedule.retentionDays }}d / {{ schedule.retentionCount }} max</td>
                      <td class="px-6 py-3.5 text-sm">
                        <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', schedule.enabled ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300']">
                          {{ schedule.enabled ? 'Active' : 'Paused' }}
                        </span>
                      </td>
                      <td class="px-6 py-3.5 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(schedule.lastRunAt) }}</td>
                      <td class="px-6 py-3.5 text-right">
                        <div class="flex items-center justify-end gap-2">
                          <button @click="runServiceSchedule(schedule.id)" class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">Run Now</button>
                          <button @click="deleteServiceSchedule(schedule.id)" class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">Delete</button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!-- Mobile cards -->
              <div class="sm:hidden space-y-3">
                <div v-for="schedule in serviceSchedules" :key="schedule.id" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 space-y-2.5">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-mono font-medium text-gray-900 dark:text-white">{{ schedule.cron }}</span>
                    <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', schedule.enabled ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300']">
                      {{ schedule.enabled ? 'Active' : 'Paused' }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>{{ schedule.retentionDays }}d / {{ schedule.retentionCount }} max</span>
                    <span>{{ formatDate(schedule.lastRunAt) }}</span>
                  </div>
                  <div class="flex items-center gap-3 pt-1">
                    <button @click="runServiceSchedule(schedule.id)" class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">Run Now</button>
                    <button @click="deleteServiceSchedule(schedule.id)" class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">Delete</button>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Settings -->
        <div v-if="activeTab === 'settings'" class="space-y-6">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Environment Variables</h3>
              <button @click="addEnvVar" class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">+ Add Variable</button>
            </div>
            <div class="p-6">
              <div v-if="envVars.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
                No environment variables configured. Click "Add Variable" to add one.
              </div>
              <div v-else class="space-y-3">
                <div v-for="(v, i) in envVars" :key="i" class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <input v-model="v.key" type="text" placeholder="KEY" class="w-full sm:flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                  <input v-model="v.value" type="text" placeholder="value" class="w-full sm:flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                  <button @click="removeEnvVar(i)" class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm self-end sm:self-auto">Remove</button>
                </div>
              </div>
            </div>
            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button @click="saveSettings" :disabled="settingsLoading" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {{ settingsLoading ? 'Saving...' : 'Save Environment' }}
              </button>
            </div>
          </div>

          <!-- GitHub Auto-Deploy -->
          <div v-if="service.sourceType === 'github'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <Github class="w-5 h-5 text-gray-900 dark:text-white" />
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('service.githubSettings') }}</h3>
            </div>
            <div class="p-6 space-y-5">
              <!-- Repository (read-only) -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ $t('service.githubRepo') }}</label>
                <p class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white text-sm font-mono">{{ service.githubRepo }}</p>
              </div>

              <!-- Branch -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ $t('service.githubBranch') }}</label>
                <input
                  v-model="autoDeployBranch"
                  type="text"
                  :placeholder="service.githubBranch || 'main'"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ $t('service.githubBranchHint') }}</p>
              </div>

              <!-- Auto-deploy toggle -->
              <div class="flex items-center justify-between">
                <div>
                  <label class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('service.autoDeploy') }}</label>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ $t('service.autoDeployDesc') }}</p>
                </div>
                <button
                  @click="autoDeployEnabled = !autoDeployEnabled"
                  :class="[
                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800',
                    autoDeployEnabled ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'
                  ]"
                >
                  <span
                    :class="[
                      'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                      autoDeployEnabled ? 'translate-x-5' : 'translate-x-0'
                    ]"
                  />
                </button>
              </div>

              <!-- Webhook status -->
              <div class="flex items-center gap-2 text-sm">
                <Webhook class="w-4 h-4 text-gray-400" />
                <span class="text-gray-500 dark:text-gray-400">{{ $t('service.webhookStatus') }}:</span>
                <span v-if="service.githubWebhookId" class="text-green-600 dark:text-green-400 font-medium">{{ $t('service.webhookRegistered') }}</span>
                <span v-else class="text-gray-500 dark:text-gray-400">{{ $t('service.webhookNotRegistered') }}</span>
              </div>

              <!-- Error -->
              <div v-if="autoDeployError" class="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                {{ autoDeployError }}
              </div>
            </div>
            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button @click="saveAutoDeploy" :disabled="autoDeployLoading" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {{ autoDeployLoading ? $t('service.saving') : $t('service.saveGithubSettings') }}
              </button>
            </div>
          </div>

          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Service Configuration</h3>
            </div>
            <div class="p-6 space-y-5">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <!-- Replicas -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Replicas</label>
                  <input v-model.number="configReplicas" type="number" min="0" max="100" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>

                <!-- Restart Condition -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Restart Policy</label>
                  <select v-model="configRestartCondition" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                    <option value="none">Never</option>
                    <option value="on-failure">On Failure</option>
                    <option value="any">Always</option>
                  </select>
                </div>

                <!-- Max Restart Attempts (hidden when 'none') -->
                <div v-if="configRestartCondition !== 'none'">
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max Restart Attempts</label>
                  <input v-model.number="configRestartMaxAttempts" type="number" min="0" max="100" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>

                <!-- Restart Delay (hidden when 'none') -->
                <div v-if="configRestartCondition !== 'none'">
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Restart Delay</label>
                  <input v-model="configRestartDelay" type="text" placeholder="10s" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>

                <!-- Update Parallelism -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Update Parallelism</label>
                  <input v-model.number="configUpdateParallelism" type="number" min="1" max="100" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>

                <!-- Update Delay -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Update Delay</label>
                  <input v-model="configUpdateDelay" type="text" placeholder="10s" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              </div>

              <!-- Rollback on Failure toggle -->
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-700 dark:text-gray-300">Rollback on Failure</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">Automatically rollback to the previous version if an update fails</p>
                </div>
                <button
                  @click="configRollbackOnFailure = !configRollbackOnFailure"
                  :class="[
                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800',
                    configRollbackOnFailure ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'
                  ]"
                >
                  <span
                    :class="[
                      'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                      configRollbackOnFailure ? 'translate-x-5' : 'translate-x-0'
                    ]"
                  />
                </button>
              </div>
            </div>
            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button @click="saveConfig" :disabled="configLoading" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {{ configLoading ? 'Saving...' : 'Save Configuration' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

