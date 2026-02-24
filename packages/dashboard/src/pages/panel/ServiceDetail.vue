<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Box, Play, Square, Power, RotateCw, RefreshCcw, Trash2, Loader2, ArrowLeft, Radio, SquareTerminal, FolderOpen, Github, Webhook, Archive, Clock, Database, XCircle, Eye, EyeOff, Upload, Download, Search, Filter, FileDown, Code2, Activity, MapPin } from 'lucide-vue-next'
import FileExplorer from '@/components/FileExplorer.vue'
import DatabaseManager from '@/components/DatabaseManager.vue'
import { useServicesStore } from '@/stores/services'
import { useApi, ApiError } from '@/composables/useApi'
import { useLogStream } from '@/composables/useLogStream'
import { useDeployStream } from '@/composables/useDeployStream'
import { useTerminal } from '@/composables/useTerminal'
import { useToast } from '@/composables/useToast'
import { useI18n } from 'vue-i18n'
import '@xterm/xterm/css/xterm.css'

const route = useRoute()
const router = useRouter()
const api = useApi()
const store = useServicesStore()
const toast = useToast()
const { t } = useI18n()
const serviceId = route.params.id as string
const logStream = useLogStream()
const deployStream = useDeployStream()

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
  if (service.value?.sourceType === 'upload' || service.value?.sourceType === 'github') {
    base.push({ id: 'docker', label: 'Docker' })
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

// Service stats (health dashboard)
const serviceStats = ref<any>(null)
const statsLoading = ref(false)
let statsInterval: ReturnType<typeof setInterval> | null = null

async function fetchServiceStats() {
  statsLoading.value = true
  try {
    serviceStats.value = await api.get(`/services/${serviceId}/stats`)
  } catch {
    serviceStats.value = null
  } finally {
    statsLoading.value = false
  }
}

function formatUptime(since: string | null) {
  if (!since) return '--'
  const ms = Date.now() - new Date(since).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

function startStatsPolling() {
  stopStatsPolling()
  fetchServiceStats()
  statsInterval = setInterval(fetchServiceStats, 10_000)
}

function stopStatsPolling() {
  if (statsInterval) {
    clearInterval(statsInterval)
    statsInterval = null
  }
}

// Auto-deploy settings
const autoDeployEnabled = ref(false)
const autoDeployBranch = ref('')
const autoDeployLoading = ref(false)
const autoDeployError = ref('')

// Service configuration settings
const configReplicas = ref(1)
const configCpuLimit = ref<number | null>(null)
const configMemoryLimit = ref<number | null>(null)
const configRestartCondition = ref<'none' | 'on-failure' | 'any'>('on-failure')
const configRestartMaxAttempts = ref(3)
const configRestartDelay = ref('10s')
const configUpdateParallelism = ref(1)
const configUpdateDelay = ref('10s')
const configRollbackOnFailure = ref(true)
const configLoading = ref(false)

// Domain settings
const configDomain = ref('')
const configSslEnabled = ref(true)
const domainLoading = ref(false)

// Volume settings
const configVolumes = ref<Array<{ source: string; target: string; readonly: boolean }>>([])
const accountVolumes = ref<Array<{ name: string; displayName: string; sizeGb: number }>>([])
const volumeLoading = ref(false)
const migrationFailures = ref<Array<{ source: string; target: string; mountPath: string; error: string }>>([])
const migrateRetryLoading = ref(false)
const browsingVolumeName = ref<string | null>(null)

/** Get the volume driver info for a given volume source from Docker status */
function getVolumeDriver(source: string): { driver: string; type: string | null } | null {
  const drivers = (service.value as any)?.dockerStatus?.volumeDrivers
  if (!drivers) return null
  const match = drivers.find((d: any) => d.source === source)
  if (!match) return null
  return { driver: match.driver, type: match.driverType }
}

/** Human-readable label for the volume driver */
function volumeDriverLabel(source: string): string {
  const info = getVolumeDriver(source)
  if (!info) return ''
  if (info.type) return info.type
  return info.driver
}

const restartPolicyLabel = computed(() => {
  const condition = service.value?.restartCondition ?? 'on-failure'
  if (condition === 'none') return 'Never'
  if (condition === 'any') return 'Always'
  const attempts = service.value?.restartMaxAttempts ?? 3
  const delay = service.value?.restartDelay ?? '10s'
  return `On failure (${attempts}x, ${delay})`
})

// Deployment progress tracking
const latestDeployment = ref<any>(null)
const deploymentPolling = ref<ReturnType<typeof setInterval> | null>(null)
const showSuccessBanner = ref(false)

// Service status polling — polls service detail while deploying to track Docker task state
let statusPolling: ReturnType<typeof setInterval> | null = null

function startStatusPolling() {
  stopStatusPolling()
  statusPolling = setInterval(async () => {
    try {
      service.value = await api.get(`/services/${serviceId}`)
      const s = service.value as any
      if (s?.status !== 'deploying' && s?.status !== 'building') {
        stopStatusPolling()
        if (s?.status === 'running') {
          toast.success('Service is now running')
          if (activeTab.value === 'overview') startStatsPolling()
        } else if (s?.status === 'failed') {
          toast.error('Service deployment failed')
        }
      }
    } catch { /* ignore */ }
  }, 4000)
}

function stopStatusPolling() {
  if (statusPolling) {
    clearInterval(statusPolling)
    statusPolling = null
  }
}

const progressSteps = [
  { key: 'queued', label: 'Queued' },
  { key: 'cloning', label: 'Cloning' },
  { key: 'building', label: 'Building' },
  { key: 'pushing', label: 'Pushing' },
  { key: 'deploying', label: 'Deploying' },
  { key: 'health_check', label: 'Health Check' },
  { key: 'succeeded', label: 'Live' },
]

function getStepStatus(stepKey: string): 'done' | 'active' | 'pending' {
  if (!latestDeployment.value?.progressStep) return 'pending'
  const current = latestDeployment.value.progressStep
  if (current === 'failed') {
    const idx = progressSteps.findIndex(s => s.key === stepKey)
    const failedIdx = progressSteps.findIndex(s => s.key === latestDeployment.value._lastActiveStep || 'building')
    if (idx < failedIdx) return 'done'
    if (idx === failedIdx) return 'active'
    return 'pending'
  }
  const currentIdx = progressSteps.findIndex(s => s.key === current)
  const stepIdx = progressSteps.findIndex(s => s.key === stepKey)
  if (stepIdx < currentIdx) return 'done'
  if (stepIdx === currentIdx) return current === 'succeeded' ? 'done' : 'active'
  return 'pending'
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return '--'
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const seconds = Math.floor((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m ${secs}s`
}

async function pollLatestDeployment() {
  try {
    const deploys = await api.get<any[]>(`/services/${serviceId}/deployments`)
    if (deploys.length > 0) {
      const prev = latestDeployment.value
      latestDeployment.value = deploys[0]
      const wasActive = prev && (prev.status === 'building' || prev.status === 'deploying')
      // Check if deployment just succeeded
      if (wasActive && deploys[0].status === 'succeeded') {
        showSuccessBanner.value = true
        setTimeout(() => { showSuccessBanner.value = false }, 10000)
        toast.success('Deployment succeeded!')
        deployStream.stop()
        stopDeploymentPolling()
        // Gracefully update service status without full page refresh
        if (service.value) {
          service.value = { ...service.value, status: 'running', image: deploys[0].imageTag || service.value.image }
        }
      } else if (wasActive && deploys[0].status === 'failed') {
        toast.error('Deployment failed')
        deployStream.stop()
        stopDeploymentPolling()
        // Gracefully update service status without full page refresh
        if (service.value) {
          service.value = { ...service.value, status: 'failed' }
        }
      }
    }
  } catch { /* ignore */ }
}

function startDeploymentPolling() {
  stopDeploymentPolling()
  pollLatestDeployment()
  deploymentPolling.value = setInterval(pollLatestDeployment, 3000)
}

function stopDeploymentPolling() {
  if (deploymentPolling.value) {
    clearInterval(deploymentPolling.value)
    deploymentPolling.value = null
  }
}

// Rollback
async function rollbackToDeployment(deploymentId: string) {
  if (!confirm('Roll back to this deployment? This will replace the current running version.')) return
  try {
    await api.post(`/deployments/${deploymentId}/rollback`, {})
    toast.success('Rollback initiated')
    await fetchService()
    await fetchDeployments()
  } catch (err: any) {
    toast.error(err?.body?.error || 'Rollback failed')
  }
}

// Deployment notes
const editingNotes = ref<string | null>(null)
const editNotesValue = ref('')

async function saveDeploymentNotes(deploymentId: string) {
  try {
    await api.patch(`/deployments/${deploymentId}/notes`, { notes: editNotesValue.value })
    editingNotes.value = null
    await fetchDeployments()
    toast.success('Notes saved')
  } catch (err: any) {
    toast.error(err?.body?.error || 'Failed to save notes')
  }
}

// Auto-scroll log
const userScrolledUp = ref(false)
function onLogsScroll() {
  if (!logsContainer.value) return
  const el = logsContainer.value
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
  userScrolledUp.value = !atBottom
}
function scrollToBottom() {
  if (logsContainer.value) {
    logsContainer.value.scrollTop = logsContainer.value.scrollHeight
    userScrolledUp.value = false
  }
}

// Build output panel scroll
const buildOutputContainer = ref<HTMLElement | null>(null)
const buildOutputScrolledUp = ref(false)

function onBuildOutputScroll() {
  if (!buildOutputContainer.value) return
  const el = buildOutputContainer.value
  buildOutputScrolledUp.value = el.scrollHeight - el.scrollTop - el.clientHeight >= 50
}

// Auto-scroll build output
watch(() => deployStream.logLines.value.length, () => {
  if (buildOutputContainer.value && !buildOutputScrolledUp.value) {
    nextTick(() => {
      if (buildOutputContainer.value) {
        buildOutputContainer.value.scrollTop = buildOutputContainer.value.scrollHeight
      }
    })
  }
})

// Extracting build error summary from log
const buildErrorSummary = computed(() => {
  if (!latestDeployment.value || latestDeployment.value.status !== 'failed') return null
  const log = latestDeployment.value.log || ''
  // Look for common error patterns
  const patterns = [
    /error:\s*(.+)/i,
    /Error:\s*(.+)/,
    /FATAL:\s*(.+)/i,
    /Module not found:\s*(.+)/i,
    /Cannot find module\s+'([^']+)'/,
    /failed to solve:?\s*(.+)/i,
    /npm ERR!\s+(.+)/,
    /exited with code (\d+)/i,
  ]
  const lines = log.split('\n').reverse()
  for (const line of lines) {
    for (const pat of patterns) {
      const m = line.match(pat)
      if (m) return m[0].trim()
    }
  }
  // Fallback: last meaningful line
  const lastLine = lines.find((l: string) => l.trim().length > 10)
  return lastLine?.trim().slice(0, 200) || null
})

// Docker tab
const dockerfileContent = ref('')
const dockerfileSource = ref<'generated' | 'file' | 'none'>('none')
const dockerfileLoading = ref(false)
const dockerfileSaving = ref(false)
const dockerfileError = ref('')

async function fetchDockerfile() {
  dockerfileLoading.value = true
  dockerfileError.value = ''
  try {
    const data = await api.get<{ content: string | null; source: string }>(`/services/${serviceId}/dockerfile`)
    dockerfileContent.value = data.content ?? ''
    dockerfileSource.value = (data.source as 'generated' | 'file' | 'none') ?? 'none'
  } catch (err: any) {
    dockerfileError.value = err?.body?.error || 'Failed to load Dockerfile'
  } finally {
    dockerfileLoading.value = false
  }
}

async function saveDockerfile() {
  if (!dockerfileContent.value.trim()) return
  dockerfileSaving.value = true
  dockerfileError.value = ''
  try {
    await api.put(`/services/${serviceId}/dockerfile`, { content: dockerfileContent.value })
    dockerfileSource.value = 'generated'
    toast.success('Dockerfile saved')
  } catch (err: any) {
    dockerfileError.value = err?.body?.error || 'Failed to save Dockerfile'
  } finally {
    dockerfileSaving.value = false
  }
}

function insertDockerfileTemplate() {
  dockerfileContent.value = 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["npm", "start"]\n'
}

async function rebuildService() {
  if (!confirm('Rebuild the service with the current Dockerfile?')) return
  try {
    let result: any
    if (service.value?.sourceType === 'upload') {
      result = await api.post(`/upload/${serviceId}/rebuild`, new FormData())
    } else {
      result = await api.post('/deployments/trigger', { serviceId })
    }
    toast.success('Rebuild triggered')
    await fetchService()
    // Auto-start deployment tracking and deploy stream
    startDeploymentPolling()
    const newDeploymentId = result?.deploymentId
    if (newDeploymentId) {
      latestDeployment.value = { id: newDeploymentId, status: 'building', log: '' }
      deployStream.start(newDeploymentId)
    }
  } catch (err: any) {
    toast.error(err?.body?.error || 'Failed to trigger rebuild')
  }
}

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
  return /^(postgres|mysql|mariadb|mongo|bitnami\/(postgresql|mysql|mariadb|mongodb))/i.test(image)
}

const isDeployStreaming = computed(() => liveMode.value && deployStream.state.value !== 'disconnected')
const displayedLogs = computed(() => liveMode.value ? logStream.logs.value : logs.value)

function logLevelColor(level: string): string {
  switch (level) {
    case 'error': return 'text-red-400'
    case 'warn': return 'text-yellow-400'
    case 'debug': return 'text-gray-500'
    default: return 'text-gray-300'
  }
}

function logLevelBadgeClass(level: string): string {
  switch (level) {
    case 'error': return 'bg-red-900/50 text-red-400'
    case 'warn': return 'bg-yellow-900/50 text-yellow-400'
    case 'debug': return 'bg-gray-700 text-gray-400'
    default: return 'bg-gray-700 text-gray-400'
  }
}

const dockerStatus = computed(() => service.value?.dockerStatus ?? null)

const servicePorts = computed(() => {
  const ports = service.value?.ports as any[] ?? []
  return ports.map((p: any) => ({
    target: p.target,
    published: p.published || null,
    protocol: p.protocol || 'tcp',
  }))
})

const failedTasks = computed(() => {
  if (!dockerStatus.value?.tasks) return []
  return dockerStatus.value.tasks
    .filter((t: any) => t.status === 'failed' || t.status === 'rejected')
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
})

const pendingTasks = computed(() => {
  if (!dockerStatus.value?.tasks) return []
  return dockerStatus.value.tasks
    .filter((t: any) => ['pending', 'assigned', 'accepted', 'preparing', 'starting', 'new'].includes(t.status))
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
})

const failureReason = computed(() => {
  if (failedTasks.value.length === 0) return null
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
    startLiveForCurrentState()
  } else {
    logStream.stop()
    deployStream.stop()
    fetchLogs()
  }
}

function startLiveForCurrentState() {
  const svc = service.value
  if (!svc) return

  if ((svc.status === 'deploying' || svc.status === 'building') && latestDeployment.value?.id) {
    // During build/deploy — stream deployment logs
    logStream.stop()
    deployStream.start(latestDeployment.value.id)
  } else if (svc.status === 'running' || svc.dockerServiceId) {
    // Running — stream Docker service logs
    deployStream.stop()
    logStream.start(serviceId)
  } else if (svc.status === 'failed' && latestDeployment.value?.log) {
    // Failed — show deployment build log as static content
    deployStream.stop()
    logStream.stop()
    liveMode.value = false
    logs.value = latestDeployment.value.log
    logStream.parseStaticLogs(latestDeployment.value.log)
  }
}

// Auto-scroll logs when new content arrives in live mode (only if user hasn't scrolled up)
watch(() => logStream.logs.value, () => {
  if (liveMode.value && logsContainer.value && !userScrolledUp.value) {
    nextTick(() => {
      logsContainer.value!.scrollTop = logsContainer.value!.scrollHeight
    })
  }
})

// Also auto-scroll when deploy stream lines arrive in logs tab
watch(() => deployStream.logLines.value.length, () => {
  if (liveMode.value && logsContainer.value && !userScrolledUp.value) {
    nextTick(() => {
      if (logsContainer.value) {
        logsContainer.value.scrollTop = logsContainer.value.scrollHeight
      }
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
    logStream.parseStaticLogs(data.logs || '')
  } catch (err: any) {
    if (err instanceof ApiError && err.status === 404) {
      // No Docker logs available — show deployment build log if we have one
      if (latestDeployment.value?.log) {
        logs.value = latestDeployment.value.log
        logStream.parseStaticLogs(latestDeployment.value.log)
      } else {
        logs.value = 'No logs available yet. The service needs to be deployed first.'
      }
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
    if (service.value?.status === 'deploying') startStatusPolling()
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
    if (service.value?.status === 'deploying') startStatusPolling()
  } catch {
    toast.error(t('service.restartFailed', 'Failed to restart service'))
  } finally {
    actionLoading.value = ''
  }
}

async function redeployService() {
  actionLoading.value = 'redeploy'
  try {
    const result: any = await api.post(`/services/${serviceId}/redeploy`, {})
    await fetchService()
    // For image-only redeploys, the deployment completes immediately (no build step).
    // Only start deploy stream for services with a build source (github/upload).
    const hasBuildSource = service.value?.sourceType === 'github' || service.value?.sourceType === 'upload'
    if (hasBuildSource) {
      startDeploymentPolling()
      const newDeploymentId = result?.deploymentId
      if (newDeploymentId) {
        latestDeployment.value = { id: newDeploymentId, status: 'building', log: '' }
        deployStream.start(newDeploymentId)
      }
    }
    // Always start status polling to track Docker task state transitions
    if (service.value?.status === 'deploying') {
      startStatusPolling()
    }
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
    deployStream.stop()
    stopDeploymentPolling()
    toast.success('Deployment cancelled')
    // Gracefully update service status
    if (service.value) {
      service.value = { ...service.value, status: service.value.dockerServiceId ? 'running' : 'stopped' }
    }
    if (latestDeployment.value) {
      latestDeployment.value = { ...latestDeployment.value, status: 'failed', log: (latestDeployment.value.log || '') + 'Deployment cancelled by user.\n' }
    }
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
    await store.deleteService(serviceId)
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
      cpuLimit: configCpuLimit.value || undefined,
      memoryLimit: configMemoryLimit.value || undefined,
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

async function saveDomain() {
  domainLoading.value = true
  try {
    await api.patch(`/services/${serviceId}`, {
      domain: configDomain.value || null,
      sslEnabled: configSslEnabled.value,
    })
    await fetchService()
    toast.success('Domain settings saved')
  } catch {
    toast.error('Failed to save domain settings')
  } finally {
    domainLoading.value = false
  }
}

async function saveVolumes() {
  volumeLoading.value = true
  migrationFailures.value = []
  try {
    // Filter out incomplete volume entries
    const validVolumes = configVolumes.value.filter(v => v.source && v.target)
    const result = await api.patch(`/services/${serviceId}`, {
      volumes: validVolumes,
    }) as any
    await fetchService()
    if (result?.migrationFailures?.length) {
      migrationFailures.value = result.migrationFailures
      toast.error('Volume saved but data migration failed — you can retry below')
    } else {
      toast.success('Volume settings saved')
    }
  } catch {
    toast.error('Failed to save volume settings')
  } finally {
    volumeLoading.value = false
  }
}

async function retryVolumeMigration(failure: { source: string; target: string; mountPath: string }, clean: boolean) {
  migrateRetryLoading.value = true
  try {
    await api.post(`/services/${serviceId}/volume-migrate`, {
      sourceVolume: failure.source,
      targetVolume: failure.target,
      clean,
    })
    migrationFailures.value = migrationFailures.value.filter(
      f => !(f.source === failure.source && f.target === failure.target)
    )
    toast.success('Volume data migrated successfully')
  } catch (err: any) {
    toast.error(err?.body?.error || 'Volume migration failed')
  } finally {
    migrateRetryLoading.value = false
  }
}

function addVolume() {
  configVolumes.value.push({ source: '', target: '', readonly: false })
}

function removeVolume(index: number) {
  configVolumes.value.splice(index, 1)
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

function getReplicaLabel(containerId?: string): string | undefined {
  if (terminalContainers.value.length <= 1) return undefined
  const idx = terminalContainers.value.findIndex((c) => c.containerId === containerId)
  return idx >= 0 ? `replica ${idx + 1}` : undefined
}

function switchTerminalContainer(containerId: string) {
  selectedContainerId.value = containerId
  terminalDisconnect()
  terminalConnect(serviceId, containerId, getReplicaLabel(containerId))
}

function addEnvVar() {
  envVars.value.push({ key: '', value: '' })
}

function removeEnvVar(index: number) {
  envVars.value.splice(index, 1)
  maskedVars.value.delete(index)
}

// Tags
const serviceTags = ref<string[]>([])
const newTagInput = ref('')
const tagsLoading = ref(false)

function addTag() {
  const tag = newTagInput.value.trim()
  if (!tag || serviceTags.value.includes(tag) || serviceTags.value.length >= 20) return
  serviceTags.value.push(tag)
  newTagInput.value = ''
}

function removeTag(index: number) {
  serviceTags.value.splice(index, 1)
}

async function saveTags() {
  tagsLoading.value = true
  try {
    await api.patch(`/services/${serviceId}`, { tags: serviceTags.value })
    await fetchService()
    toast.success('Tags saved')
  } catch {
    toast.error('Failed to save tags')
  } finally {
    tagsLoading.value = false
  }
}

// Env var masking
const maskedVars = ref<Set<number>>(new Set())
const showBulkImport = ref(false)
const bulkEnvInput = ref('')
const sensitivePattern = /password|secret|token|key|api_key|apikey|auth|credential|private/i

function initMasking() {
  maskedVars.value.clear()
  envVars.value.forEach((v, i) => {
    if (sensitivePattern.test(v.key)) maskedVars.value.add(i)
  })
}

function toggleMask(index: number) {
  if (maskedVars.value.has(index)) maskedVars.value.delete(index)
  else maskedVars.value.add(index)
}

function parseBulkEnv() {
  const lines = bulkEnvInput.value.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.substring(0, eqIndex).trim()
    const value = trimmed.substring(eqIndex + 1).trim().replace(/^["']|["']$/g, '')
    const existing = envVars.value.findIndex(v => v.key === key)
    if (existing >= 0) envVars.value[existing]!.value = value
    else envVars.value.push({ key, value })
  }
  showBulkImport.value = false
  bulkEnvInput.value = ''
  initMasking()
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
    deployStream.stop()
  }

  // Manage stats polling
  if (tabId === 'overview' && service.value?.status === 'running') {
    startStatsPolling()
  } else {
    stopStatsPolling()
  }

  activeTab.value = tabId
  if (tabId === 'logs') {
    fetchLogs()
    // Auto-start live mode if service is running or deploying
    const svc = service.value
    if (svc && (svc.status === 'running' || svc.status === 'deploying' || svc.status === 'building')) {
      nextTick(() => {
        liveMode.value = true
        startLiveForCurrentState()
      })
    }
    // If service failed and we have build logs, show them as static logs
    if (svc?.status === 'failed' && latestDeployment.value?.log && !logs.value) {
      logs.value = latestDeployment.value.log
      logStream.parseStaticLogs(latestDeployment.value.log)
    }
  }
  if (tabId === 'docker') fetchDockerfile()
  if (tabId === 'deployments') fetchDeployments()
  if (tabId === 'settings' && service.value) {
    const env = service.value.env ?? {}
    envVars.value = Object.entries(env).map(([key, value]) => ({ key, value: String(value) }))
    initMasking()
    serviceTags.value = [...(service.value.tags ?? [])]
    autoDeployEnabled.value = service.value.autoDeploy ?? false
    autoDeployBranch.value = service.value.githubBranch ?? ''
    autoDeployError.value = ''
    configReplicas.value = service.value.replicas ?? 1
    configCpuLimit.value = service.value.cpuLimit ?? null
    configMemoryLimit.value = service.value.memoryLimit ?? null
    configRestartCondition.value = service.value.restartCondition ?? 'on-failure'
    configRestartMaxAttempts.value = service.value.restartMaxAttempts ?? 3
    configRestartDelay.value = service.value.restartDelay ?? '10s'
    configUpdateParallelism.value = service.value.updateParallelism ?? 1
    configUpdateDelay.value = service.value.updateDelay ?? '10s'
    configRollbackOnFailure.value = service.value.rollbackOnFailure ?? true
    configDomain.value = service.value.domain ?? ''
    configSslEnabled.value = service.value.sslEnabled ?? true
    configVolumes.value = ((service.value.volumes as any[]) ?? []).map((v: any) => ({
      source: v.source ?? '',
      target: v.target ?? '',
      readonly: v.readonly ?? false,
    }))
    // Fetch account volumes for the dropdown
    try {
      const vols = await api.get<any[]>('/storage/volumes')
      accountVolumes.value = (vols ?? []).map((v: any) => ({
        name: v.name,
        displayName: v.name.replace(/^vol-[a-f0-9-]+-/, ''),
        sizeGb: v.sizeGb ?? 0,
      }))
    } catch { /* ignore */ }
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
        terminalConnect(serviceId, selectedContainerId.value || undefined, getReplicaLabel(selectedContainerId.value))
      } else {
        // Terminal already exists — just refit the canvas (v-show resize)
        terminalRefit()
      }
    })
  }
}

onMounted(async () => {
  await fetchService()
  // Start stats polling if we're on the overview tab and service is running
  if (activeTab.value === 'overview' && service.value?.status === 'running') {
    startStatsPolling()
  }
  // Start deployment polling if service is deploying
  if (service.value?.status === 'deploying' || service.value?.status === 'building') {
    startDeploymentPolling()
    startStatusPolling()
  }
  // Load latest deployment for progress stepper
  await pollLatestDeployment()
  // Fallback: if pollLatestDeployment didn't find anything, use embedded deployments from service response
  if (!latestDeployment.value && service.value?.deployments?.length) {
    latestDeployment.value = service.value.deployments[0]
  }
  // Auto-start deploy stream for build output panel if deploying
  if (service.value?.status === 'deploying' && latestDeployment.value?.id) {
    deployStream.start(latestDeployment.value.id)
  }
})

onUnmounted(() => {
  stopStatsPolling()
  stopDeploymentPolling()
  stopStatusPolling()
  deployStream.stop()
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
            <span v-if="service.region" class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
              <MapPin class="w-3 h-3" />
              {{ service.region }}
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
            <div v-if="service.region" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Region</p>
              <p class="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                <MapPin class="w-4 h-4 text-blue-500" />
                {{ service.region }}
              </p>
            </div>
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Restart Policy</p>
              <p class="text-lg font-bold text-gray-900 dark:text-white capitalize">
                {{ restartPolicyLabel }}
              </p>
            </div>
            <div v-if="(service.volumes as any[])?.length" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Storage</p>
              <div class="flex items-center gap-2">
                <p class="text-lg font-bold text-gray-900 dark:text-white">{{ (service.volumes as any[]).length }} vol{{ (service.volumes as any[]).length !== 1 ? 's' : '' }}</p>
                <span
                  v-if="(service as any).dockerStatus?.volumeDrivers?.length"
                  class="px-1.5 py-0.5 rounded text-[10px] font-medium"
                  :class="(service as any).dockerStatus.volumeDrivers[0].driverType
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                    : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'"
                >
                  {{ (service as any).dockerStatus.volumeDrivers[0].driverType || (service as any).dockerStatus.volumeDrivers[0].driver }}
                </span>
              </div>
            </div>
          </div>

          <!-- Success banner -->
          <div v-if="showSuccessBanner" class="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-5 transition-all">
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
              </div>
              <div class="flex-1">
                <h3 class="text-sm font-semibold text-green-800 dark:text-green-200">Deployment Succeeded!</h3>
                <p class="text-sm text-green-700 dark:text-green-300 mt-1">Your service is now live and running.</p>
                <div class="flex items-center gap-3 mt-3">
                  <a v-if="service.domain" :href="'https://' + service.domain" target="_blank" class="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-300 hover:underline">
                    Visit Site &rarr;
                  </a>
                  <button @click="onTabChange('logs')" class="text-xs font-medium text-green-600 dark:text-green-400 hover:underline">View Logs</button>
                  <button @click="showSuccessBanner = false" class="text-xs text-green-500 dark:text-green-500 hover:underline ml-auto">Dismiss</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Deployment Progress Stepper -->
          <div v-if="service.status === 'deploying' && latestDeployment" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Deployment Progress</h3>
              <span class="text-xs text-gray-500 dark:text-gray-400">{{ formatDuration(latestDeployment.startedAt, latestDeployment.completedAt) }}</span>
            </div>
            <div class="flex items-center gap-1">
              <template v-for="(step, idx) in progressSteps" :key="step.key">
                <div class="flex flex-col items-center flex-1 min-w-0">
                  <div :class="[
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all',
                    getStepStatus(step.key) === 'done' ? 'bg-green-500 text-white' :
                    getStepStatus(step.key) === 'active' ? 'bg-primary-500 text-white animate-pulse' :
                    'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                  ]">
                    <svg v-if="getStepStatus(step.key) === 'done'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                    <Loader2 v-else-if="getStepStatus(step.key) === 'active'" class="w-4 h-4 animate-spin" />
                    <span v-else>{{ idx + 1 }}</span>
                  </div>
                  <span :class="['text-[10px] mt-1 text-center truncate w-full', getStepStatus(step.key) === 'active' ? 'text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-400 dark:text-gray-500']">{{ step.label }}</span>
                </div>
                <div v-if="idx < progressSteps.length - 1" :class="['h-0.5 flex-1 -mt-4 rounded', getStepStatus(progressSteps[idx + 1]!.key) !== 'pending' ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700']" />
              </template>
            </div>
          </div>

          <!-- Build Output Panel (only during active builds, not image-only deploys) -->
          <div v-if="(service.status === 'deploying' || service.status === 'building') && latestDeployment && latestDeployment.status !== 'succeeded' && latestDeployment.status !== 'deploying'" class="bg-gray-900 rounded-xl border border-gray-700 shadow-sm overflow-hidden">
            <div class="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Code2 class="w-4 h-4 text-gray-400" />
                <span class="text-sm font-medium text-gray-300">Build Output</span>
                <span
                  v-if="deployStream.state.value === 'connected'"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/40 text-green-400"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  Live
                </span>
              </div>
              <span class="text-xs text-gray-500">{{ deployStream.logLines.value.length }} lines</span>
            </div>
            <div
              ref="buildOutputContainer"
              @scroll="onBuildOutputScroll"
              class="h-80 overflow-y-auto font-mono text-xs leading-relaxed p-4"
            >
              <div v-if="deployStream.logLines.value.length > 0">
                <div
                  v-for="(line, idx) in deployStream.logLines.value"
                  :key="idx"
                  class="text-gray-300 py-px hover:bg-gray-800/50"
                >{{ line }}</div>
              </div>
              <div v-else class="flex items-center justify-center h-full text-gray-500">
                <Loader2 class="w-5 h-5 animate-spin mr-2" />
                Waiting for build output...
              </div>
            </div>
          </div>

          <!-- Deployment Error Banner — shows for any failed deployment with a log -->
          <div v-if="latestDeployment?.status === 'failed' && latestDeployment?.log" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
            <div class="flex items-start gap-3">
              <XCircle class="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div class="min-w-0 flex-1">
                <h4 class="text-sm font-semibold text-red-800 dark:text-red-200">Deployment Failed</h4>
                <p class="text-xs font-mono text-red-700 dark:text-red-300 mt-1 break-all whitespace-pre-wrap">{{ buildErrorSummary || latestDeployment.log.slice(0, 500) }}</p>
                <div class="flex items-center gap-3 mt-2">
                  <button @click="onTabChange('deployments')" class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">View Deployments</button>
                  <button @click="onTabChange('logs')" class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">View Logs</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Generic failure banner — service failed but no deployment log and no Docker tasks -->
          <div v-else-if="service.status === 'failed' && failedTasks.length === 0 && !latestDeployment?.log" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
            <div class="flex items-start gap-3">
              <XCircle class="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div class="min-w-0 flex-1">
                <h4 class="text-sm font-semibold text-red-800 dark:text-red-200">Service Failed</h4>
                <p class="text-sm text-red-700 dark:text-red-300 mt-1">The service failed to deploy. Check the server logs for details or try redeploying.</p>
                <div class="flex items-center gap-3 mt-2">
                  <button @click="redeployService" :disabled="!!actionLoading" class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">Redeploy</button>
                  <button @click="onTabChange('logs')" class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">View Logs</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Deploying progress -->
          <div v-if="service.status === 'deploying' && failedTasks.length === 0" class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-5">
            <div class="flex items-start gap-3">
              <Loader2 class="w-5 h-5 text-yellow-500 dark:text-yellow-400 shrink-0 mt-0.5 animate-spin" />
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-yellow-800 dark:text-yellow-200">Service is deploying</h3>
                <p class="text-sm text-yellow-700 dark:text-yellow-300 mt-1">Waiting for containers to start...</p>
                <div v-if="pendingTasks.length > 0" class="mt-3 space-y-2">
                  <div v-for="task in pendingTasks.slice(0, 5)" :key="task.id" class="flex items-center gap-3 text-xs text-yellow-700 dark:text-yellow-300 bg-yellow-100/50 dark:bg-yellow-900/30 rounded-lg px-3 py-2">
                    <span class="font-mono shrink-0">{{ task.id.slice(0, 12) }}</span>
                    <span class="capitalize">{{ task.status }}</span>
                    <span v-if="task.message" class="truncate text-yellow-600 dark:text-yellow-400">{{ task.message }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Failure alert -->
          <div v-if="failedTasks.length > 0" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-5">
            <div class="flex items-start gap-3">
              <XCircle class="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-red-800 dark:text-red-200">{{ service.status === 'failed' ? 'Service failed to start' : 'Task failures detected' }}</h3>
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
              <div v-if="servicePorts.length > 0">
                <dt class="text-gray-500 dark:text-gray-400">Ports</dt>
                <dd class="text-gray-900 dark:text-white mt-0.5">
                  <div v-for="(p, i) in servicePorts" :key="i" class="font-mono text-xs">
                    <span v-if="p.published" class="text-primary-600 dark:text-primary-400">:{{ p.published }}</span>
                    <span v-if="p.published"> → </span>
                    <span>:{{ p.target }}</span>
                    <span class="text-gray-400 ml-1">/{{ p.protocol || 'tcp' }}</span>
                  </div>
                </dd>
              </div>
              <div v-if="service.domain">
                <dt class="text-gray-500 dark:text-gray-400">Routing</dt>
                <dd class="text-gray-900 dark:text-white mt-0.5 text-xs">
                  <span class="font-medium text-green-600 dark:text-green-400">Traefik</span>
                  <span class="text-gray-400"> → :{{ servicePorts[0]?.target || 80 }}</span>
                </dd>
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

          <!-- Resource Usage -->
          <div v-if="service.status === 'running'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Activity class="w-4 h-4 text-primary-600 dark:text-primary-400" />
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Resource Usage</h3>
              </div>
              <div class="flex items-center gap-2">
                <span v-if="serviceStats" class="text-xs text-gray-500 dark:text-gray-400">
                  Uptime: {{ formatUptime(serviceStats.uptimeSince) }}
                </span>
                <button @click="fetchServiceStats" class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                  <RefreshCcw :class="['w-3.5 h-3.5', statsLoading ? 'animate-spin' : '']" />
                </button>
              </div>
            </div>
            <div class="p-6">
              <div v-if="statsLoading && !serviceStats" class="flex items-center justify-center py-8">
                <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
              </div>
              <div v-else-if="!serviceStats" class="text-center py-6 text-sm text-gray-500 dark:text-gray-400">
                Stats unavailable. Service may still be starting.
              </div>
              <div v-else class="space-y-4">
                <div class="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  {{ serviceStats.taskCount.running }} / {{ serviceStats.taskCount.total }} tasks running
                </div>
                <div v-for="(ctr, idx) in serviceStats.containers" :key="ctr.containerId" class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 space-y-3">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-medium text-gray-700 dark:text-gray-300">
                      Container {{ serviceStats.containers.length > 1 ? idx + 1 : '' }}
                      <span class="text-gray-400 font-mono ml-1">{{ ctr.containerId.slice(0, 12) }}</span>
                    </span>
                    <span class="text-[10px] text-gray-400">{{ ctr.pids }} processes</span>
                  </div>

                  <!-- CPU -->
                  <div>
                    <div class="flex items-center justify-between text-xs mb-1">
                      <span class="text-gray-500 dark:text-gray-400">CPU</span>
                      <span class="font-medium text-gray-700 dark:text-gray-300">{{ ctr.cpuPercent.toFixed(1) }}%</span>
                    </div>
                    <div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        :class="['h-full rounded-full transition-all', ctr.cpuPercent < 70 ? 'bg-green-500' : ctr.cpuPercent < 90 ? 'bg-yellow-500' : 'bg-red-500']"
                        :style="{ width: Math.min(ctr.cpuPercent, 100) + '%' }"
                      />
                    </div>
                  </div>

                  <!-- Memory -->
                  <div>
                    <div class="flex items-center justify-between text-xs mb-1">
                      <span class="text-gray-500 dark:text-gray-400">Memory</span>
                      <span class="font-medium text-gray-700 dark:text-gray-300">
                        {{ formatSize(ctr.memoryUsageBytes) }} / {{ formatSize(ctr.memoryLimitBytes) }}
                        <span :class="[ctr.memoryPercent > 90 ? 'text-red-500' : ctr.memoryPercent > 70 ? 'text-yellow-500' : 'text-gray-400']">({{ ctr.memoryPercent.toFixed(1) }}%)</span>
                      </span>
                    </div>
                    <div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        :class="['h-full rounded-full transition-all', ctr.memoryPercent < 70 ? 'bg-purple-500' : ctr.memoryPercent < 90 ? 'bg-yellow-500' : 'bg-red-500']"
                        :style="{ width: Math.min(ctr.memoryPercent, 100) + '%' }"
                      />
                    </div>
                  </div>

                  <!-- Network I/O -->
                  <div class="flex gap-4 text-xs">
                    <div>
                      <span class="text-gray-500 dark:text-gray-400">Net RX:</span>
                      <span class="ml-1 text-gray-700 dark:text-gray-300 font-medium">{{ formatSize(ctr.networkRxBytes) }}</span>
                    </div>
                    <div>
                      <span class="text-gray-500 dark:text-gray-400">Net TX:</span>
                      <span class="ml-1 text-gray-700 dark:text-gray-300 font-medium">{{ formatSize(ctr.networkTxBytes) }}</span>
                    </div>
                    <div>
                      <span class="text-gray-500 dark:text-gray-400">Disk R:</span>
                      <span class="ml-1 text-gray-700 dark:text-gray-300 font-medium">{{ formatSize(ctr.blockReadBytes) }}</span>
                    </div>
                    <div>
                      <span class="text-gray-500 dark:text-gray-400">Disk W:</span>
                      <span class="ml-1 text-gray-700 dark:text-gray-300 font-medium">{{ formatSize(ctr.blockWriteBytes) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
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

        <!-- Docker -->
        <div v-if="activeTab === 'docker'">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Dockerfile</h3>
                <p v-if="dockerfileSource === 'generated'" class="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  Auto-generated from runtime detection. Edit below to customize.
                </p>
                <p v-else-if="dockerfileSource === 'file'" class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Dockerfile from project source files.
                </p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  @click="saveDockerfile"
                  :disabled="dockerfileSaving || !dockerfileContent.trim()"
                  class="px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  {{ dockerfileSaving ? 'Saving...' : 'Save' }}
                </button>
                <button
                  @click="rebuildService"
                  :disabled="service.status === 'deploying'"
                  class="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Rebuild
                </button>
              </div>
            </div>
            <div v-if="dockerfileLoading" class="p-12 flex items-center justify-center">
              <Loader2 class="w-6 h-6 text-primary-500 animate-spin" />
            </div>
            <div v-else-if="dockerfileSource === 'none' && !dockerfileContent" class="p-12 text-center">
              <p class="text-gray-500 dark:text-gray-400 text-sm">No Dockerfile found. The system will auto-detect your runtime on the next deploy, or you can write one below.</p>
              <button
                @click="insertDockerfileTemplate"
                class="mt-4 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
              >
                Start with template
              </button>
            </div>
            <div v-else>
              <textarea
                v-model="dockerfileContent"
                spellcheck="false"
                class="w-full min-h-[400px] p-4 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono text-sm leading-relaxed resize-y border-0 focus:outline-none focus:ring-0"
                placeholder="# Write your Dockerfile here..."
              />
            </div>
            <div v-if="dockerfileError" class="px-6 py-3 border-t border-gray-200 dark:border-gray-700">
              <p class="text-sm text-red-600 dark:text-red-400">{{ dockerfileError }}</p>
            </div>
          </div>
        </div>

        <!-- Logs -->
        <div v-if="activeTab === 'logs'">
          <div class="bg-gray-900 rounded-xl border border-gray-700 shadow-sm overflow-hidden relative">
            <!-- Header -->
            <div class="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <span class="text-sm font-medium text-gray-300">{{ liveMode && deployStream.state.value !== 'disconnected' ? 'Build Logs' : 'Service Logs' }}</span>
                <span
                  v-if="liveMode"
                  :class="[
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                    (logStream.state.value === 'connected' || deployStream.state.value === 'connected')
                      ? 'bg-green-900/40 text-green-400'
                      : 'bg-yellow-900/40 text-yellow-400'
                  ]"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  {{ (logStream.state.value === 'connected' || deployStream.state.value === 'connected') ? 'Live' : 'Connecting...' }}
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

            <!-- Toolbar -->
            <div class="px-4 py-2 border-b border-gray-700/50 flex flex-wrap items-center gap-2">
              <!-- Level filter -->
              <select
                v-model="logStream.filterLevel.value"
                class="px-2 py-1 rounded-md bg-gray-800 border border-gray-600 text-gray-300 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="all">All Levels</option>
                <option value="error">Error</option>
                <option value="warn">Warning</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
              </select>

              <!-- Search -->
              <div class="relative flex-1 min-w-[120px] max-w-[240px]">
                <Search class="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
                <input
                  v-model="logStream.searchQuery.value"
                  type="text"
                  placeholder="Filter logs..."
                  class="w-full pl-7 pr-2 py-1 rounded-md bg-gray-800 border border-gray-600 text-gray-300 text-xs placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              <!-- JSON toggle -->
              <button
                @click="logStream.jsonPrettyPrint.value = !logStream.jsonPrettyPrint.value"
                :class="[
                  'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors',
                  logStream.jsonPrettyPrint.value
                    ? 'bg-primary-900/40 text-primary-400'
                    : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
                ]"
              >
                <Code2 class="w-3 h-3" />
                JSON
              </button>

              <!-- Export -->
              <button
                @click="logStream.exportLogs()"
                class="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-gray-400 hover:text-gray-300 hover:bg-gray-800 transition-colors"
              >
                <FileDown class="w-3 h-3" />
                Export
              </button>

              <!-- Count -->
              <span class="text-[10px] text-gray-500 ml-auto">
                {{ isDeployStreaming ? deployStream.logLines.value.length : logStream.filteredLogs.value.length }} / {{ isDeployStreaming ? deployStream.logLines.value.length : logStream.rawLogs.value.length }} lines
              </span>
            </div>

            <!-- Log entries -->
            <div ref="logsContainer" @scroll="onLogsScroll" class="h-96 overflow-y-auto font-mono text-xs leading-relaxed">
              <div v-if="logsLoading && !liveMode" class="flex items-center justify-center h-full">
                <Loader2 class="w-6 h-6 text-gray-500 animate-spin" />
              </div>
              <!-- Deploy stream mode: show build/deploy output -->
              <template v-else-if="isDeployStreaming && deployStream.logLines.value.length > 0">
                <div
                  v-for="(line, idx) in deployStream.logLines.value"
                  :key="idx"
                  class="px-4 py-0.5 hover:bg-gray-800/50 text-gray-300"
                >{{ line }}</div>
              </template>
              <!-- Normal service log mode -->
              <template v-else-if="!isDeployStreaming && logStream.filteredLogs.value.length > 0">
                <div
                  v-for="(entry, idx) in logStream.filteredLogs.value"
                  :key="idx"
                  :class="['px-4 py-0.5 hover:bg-gray-800/50 border-l-2', entry.level === 'error' ? 'border-red-500/60' : entry.level === 'warn' ? 'border-yellow-500/60' : 'border-transparent']"
                >
                  <span v-if="entry.timestamp" class="text-gray-500 mr-2">{{ entry.timestamp }}</span>
                  <span v-if="entry.level !== 'info'" :class="['inline-flex px-1 py-0 rounded text-[10px] font-semibold uppercase mr-1.5', logLevelBadgeClass(entry.level)]">{{ entry.level }}</span>
                  <template v-if="entry.isJson && logStream.jsonPrettyPrint.value && entry.parsedJson">
                    <pre class="inline text-gray-300 whitespace-pre-wrap">{{ JSON.stringify(entry.parsedJson, null, 2) }}</pre>
                  </template>
                  <span v-else :class="logLevelColor(entry.level)">{{ entry.message }}</span>
                </div>
              </template>
              <div v-else-if="isDeployStreaming" class="flex items-center justify-center h-full text-gray-500">
                <Loader2 class="w-5 h-5 animate-spin mr-2" />
                Waiting for deployment logs...
              </div>
              <div v-else class="flex items-center justify-center h-full text-gray-500">
                {{ logStream.rawLogs.value.length > 0 ? 'No logs match your filters.' : 'No logs available.' }}
              </div>
            </div>
            <!-- Scroll to bottom button -->
            <div v-if="userScrolledUp && liveMode" class="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
              <button
                @click="scrollToBottom"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium shadow-lg transition-all"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>
                Scroll to bottom
              </button>
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
            <div class="h-[500px] pt-2 px-2 pb-4 bg-[#1a1b26]">
              <div ref="terminalContainer" class="h-full"></div>
            </div>
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
                    <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Image Tag</th>
                    <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                    <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Trigger</th>
                    <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
                    <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Deployed At</th>
                    <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Commit</th>
                    <th class="px-5 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                  <tr
                    v-for="deploy in deployments"
                    :key="deploy.id"
                    class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group"
                  >
                    <td class="px-5 py-3.5 text-sm font-mono text-gray-900 dark:text-white">{{ deploy.imageTag || '--' }}</td>
                    <td class="px-5 py-3.5 text-sm">
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
                    <td class="px-5 py-3.5 text-xs text-gray-500 dark:text-gray-400">
                      <span v-if="deploy.trigger === 'webhook'" class="inline-flex items-center gap-1">
                        <Webhook class="w-3 h-3" /> Auto
                      </span>
                      <span v-else-if="deploy.trigger === 'manual'" class="inline-flex items-center gap-1">
                        <Play class="w-3 h-3" /> Manual
                      </span>
                      <span v-else>--</span>
                    </td>
                    <td class="px-5 py-3.5 text-xs font-mono text-gray-500 dark:text-gray-400">
                      {{ formatDuration(deploy.startedAt, deploy.completedAt) }}
                    </td>
                    <td class="px-5 py-3.5 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(deploy.createdAt) }}</td>
                    <td class="px-5 py-3.5 text-sm text-gray-600 dark:text-gray-400 font-mono">{{ deploy.commitSha ? deploy.commitSha.slice(0, 7) : '--' }}</td>
                    <td class="px-5 py-3.5 text-right">
                      <div class="flex items-center justify-end gap-2">
                        <!-- Notes -->
                        <button
                          v-if="editingNotes !== deploy.id"
                          @click="editingNotes = deploy.id; editNotesValue = deploy.notes || ''"
                          class="text-xs text-gray-400 hover:text-primary-500 transition-colors opacity-0 group-hover:opacity-100"
                          :title="deploy.notes ? 'Edit note' : 'Add note'"
                        >
                          {{ deploy.notes ? 'Edit note' : '+ Note' }}
                        </button>
                        <!-- Rollback -->
                        <button
                          v-if="deploy.status === 'succeeded' && deploy.imageTag && deployments[0]?.id !== deploy.id"
                          @click="rollbackToDeployment(deploy.id)"
                          class="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Rollback
                        </button>
                      </div>
                    </td>
                  </tr>
                  <!-- Notes editing row -->
                  <tr v-if="editingNotes" v-for="deploy in deployments.filter(d => d.id === editingNotes)" :key="'notes-' + deploy.id">
                    <td colspan="7" class="px-5 py-3 bg-gray-50 dark:bg-gray-900/50">
                      <div class="flex items-center gap-2">
                        <input
                          v-model="editNotesValue"
                          type="text"
                          placeholder="Add a note about this deployment..."
                          maxlength="500"
                          class="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          @keydown.enter="saveDeploymentNotes(deploy.id)"
                          @keydown.escape="editingNotes = null"
                        />
                        <button @click="saveDeploymentNotes(deploy.id)" class="px-2.5 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors">Save</button>
                        <button @click="editingNotes = null" class="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">Cancel</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- Notes display under table -->
            <div v-if="deployments.some(d => d.notes)" class="hidden sm:block mt-2">
              <div v-for="deploy in deployments.filter(d => d.notes)" :key="'note-display-' + deploy.id" class="flex items-center gap-2 px-5 py-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span class="font-mono text-gray-400">{{ deploy.imageTag?.slice(0, 12) || deploy.id.slice(0, 8) }}</span>
                <span class="text-gray-300 dark:text-gray-600">—</span>
                <span class="italic">{{ deploy.notes }}</span>
              </div>
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
                  <div class="flex items-center gap-3">
                    <span>{{ formatDate(deploy.createdAt) }}</span>
                    <span class="font-mono">{{ formatDuration(deploy.startedAt, deploy.completedAt) }}</span>
                  </div>
                  <span v-if="deploy.commitSha" class="font-mono">{{ deploy.commitSha.slice(0, 7) }}</span>
                </div>
                <div v-if="deploy.trigger" class="text-xs text-gray-400 dark:text-gray-500">
                  Trigger: {{ deploy.trigger === 'webhook' ? 'Auto (webhook)' : 'Manual' }}
                </div>
                <div v-if="deploy.notes" class="text-xs text-gray-500 dark:text-gray-400 italic">{{ deploy.notes }}</div>
                <div class="flex items-center gap-3 pt-1">
                  <button
                    v-if="deploy.status === 'succeeded' && deploy.imageTag && deployments[0]?.id !== deploy.id"
                    @click="rollbackToDeployment(deploy.id)"
                    class="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline"
                  >
                    Rollback
                  </button>
                  <button
                    @click="editingNotes = deploy.id; editNotesValue = deploy.notes || ''"
                    class="text-xs text-gray-400 hover:text-primary-500"
                  >
                    {{ deploy.notes ? 'Edit note' : '+ Note' }}
                  </button>
                </div>
                <!-- Mobile notes editing -->
                <div v-if="editingNotes === deploy.id" class="flex items-center gap-2">
                  <input
                    v-model="editNotesValue"
                    type="text"
                    placeholder="Add a note..."
                    maxlength="500"
                    class="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    @keydown.enter="saveDeploymentNotes(deploy.id)"
                    @keydown.escape="editingNotes = null"
                  />
                  <button @click="saveDeploymentNotes(deploy.id)" class="px-2 py-1.5 rounded bg-primary-600 text-white text-xs font-medium">Save</button>
                  <button @click="editingNotes = null" class="text-xs text-gray-400">Cancel</button>
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
          <!-- Tags -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Tags</h3>
            </div>
            <div class="p-6">
              <div class="flex flex-wrap gap-2 mb-3">
                <span
                  v-for="(tag, idx) in serviceTags"
                  :key="idx"
                  class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300"
                >
                  {{ tag }}
                  <button @click="removeTag(idx)" class="hover:text-red-500 transition-colors">
                    <XCircle class="w-3 h-3" />
                  </button>
                </span>
                <span v-if="serviceTags.length === 0" class="text-sm text-gray-500 dark:text-gray-400">No tags. Add tags to organize your services.</span>
              </div>
              <div class="flex gap-2">
                <input
                  v-model="newTagInput"
                  @keydown.enter.prevent="addTag"
                  type="text"
                  placeholder="Add a tag..."
                  maxlength="50"
                  class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                <button @click="addTag" :disabled="!newTagInput.trim()" class="px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                  Add
                </button>
              </div>
            </div>
            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button @click="saveTags" :disabled="tagsLoading" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {{ tagsLoading ? 'Saving...' : 'Save Tags' }}
              </button>
            </div>
          </div>

          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Environment Variables</h3>
              <div class="flex items-center gap-3">
                <button @click="showBulkImport = !showBulkImport" class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1">
                  <Upload class="w-3 h-3" /> Import .env
                </button>
                <button @click="addEnvVar" class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">+ Add Variable</button>
              </div>
            </div>
            <div class="p-6">
              <!-- Bulk Import -->
              <div v-if="showBulkImport" class="mb-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">Paste .env file contents. Lines starting with # are ignored.</p>
                <textarea v-model="bulkEnvInput" rows="6" placeholder="KEY=value&#10;ANOTHER_KEY=value&#10;# comment lines are ignored" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                <div class="flex gap-2 mt-2">
                  <button @click="parseBulkEnv" class="px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors">Import</button>
                  <button @click="showBulkImport = false" class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                </div>
              </div>

              <div v-if="envVars.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
                No environment variables configured. Click "Add Variable" to add one.
              </div>
              <div v-else class="space-y-3">
                <div v-for="(v, i) in envVars" :key="i" class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <input v-model="v.key" type="text" placeholder="KEY" class="w-full sm:flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                  <div class="relative w-full sm:flex-1">
                    <input v-model="v.value" :type="maskedVars.has(i) ? 'password' : 'text'" placeholder="value" class="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                    <button
                      @click="toggleMask(i)"
                      type="button"
                      class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      :title="maskedVars.has(i) ? 'Show value' : 'Hide value'"
                    >
                      <EyeOff v-if="maskedVars.has(i)" class="w-4 h-4" />
                      <Eye v-else class="w-4 h-4" />
                    </button>
                  </div>
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

          <!-- Domain Settings -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Domain</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Route a domain to this service via Traefik reverse proxy</p>
            </div>
            <div class="p-6 space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Domain Name</label>
                <input
                  v-model="configDomain"
                  type="text"
                  placeholder="app.example.com"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Traffic will be routed to container port {{ servicePorts[0]?.target || 80 }}. Leave empty to remove domain.
                </p>
              </div>
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-700 dark:text-gray-300">SSL / HTTPS</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">Auto-provision Let's Encrypt certificate</p>
                </div>
                <button
                  @click="configSslEnabled = !configSslEnabled"
                  :class="[
                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800',
                    configSslEnabled ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'
                  ]"
                >
                  <span
                    :class="[
                      'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                      configSslEnabled ? 'translate-x-5' : 'translate-x-0'
                    ]"
                  />
                </button>
              </div>
            </div>
            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button @click="saveDomain" :disabled="domainLoading" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {{ domainLoading ? 'Saving...' : 'Save Domain' }}
              </button>
            </div>
          </div>

          <!-- Volumes -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Volumes</h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Attach persistent storage volumes to this service</p>
              </div>
              <button @click="addVolume" class="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors">
                + Add Volume
              </button>
            </div>
            <div class="p-6">
              <div v-if="configVolumes.length === 0" class="text-center py-6 text-sm text-gray-500 dark:text-gray-400">
                No volumes attached. Click "Add Volume" to mount a storage volume.
              </div>
              <div v-else class="space-y-3">
                <div v-for="(vol, idx) in configVolumes" :key="idx" class="flex items-start gap-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                  <div class="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Volume</label>
                      <select
                        v-model="vol.source"
                        class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="">Select volume...</option>
                        <option v-for="av in accountVolumes" :key="av.name" :value="av.name">
                          {{ av.displayName }} ({{ av.sizeGb }}GB)
                        </option>
                        <option v-if="vol.source && !accountVolumes.find(v => v.name === vol.source)" :value="vol.source">
                          {{ vol.source }}
                        </option>
                      </select>
                      <span
                        v-if="vol.source && volumeDriverLabel(vol.source)"
                        class="inline-flex items-center mt-1.5 px-2 py-0.5 rounded text-[10px] font-medium"
                        :class="volumeDriverLabel(vol.source) === 'local'
                          ? 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                          : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'"
                      >
                        {{ volumeDriverLabel(vol.source) }}
                      </span>
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Mount Path</label>
                      <input
                        v-model="vol.target"
                        type="text"
                        placeholder="/var/data"
                        class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </div>
                  <div class="flex items-center gap-2 mt-5">
                    <button v-if="vol.source" @click="browsingVolumeName = vol.source" class="p-1 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors" title="Browse files">
                      <FolderOpen class="w-4 h-4" />
                    </button>
                    <label class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                      <input type="checkbox" v-model="vol.readonly" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                      RO
                    </label>
                    <button @click="removeVolume(idx)" class="p-1 text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors" title="Remove">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <!-- Migration failure banner -->
            <div v-if="migrationFailures.length > 0" class="px-6 py-4 border-t border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
              <p class="text-sm font-medium text-red-800 dark:text-red-300 mb-2">Volume data migration failed</p>
              <div v-for="(fail, fi) in migrationFailures" :key="fi" class="flex items-center justify-between gap-3 py-2">
                <div class="text-xs text-red-700 dark:text-red-400">
                  <span class="font-mono">{{ fail.source }}</span> → <span class="font-mono">{{ fail.target }}</span>
                  <span class="text-red-500 dark:text-red-500 ml-1">({{ fail.error }})</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <button @click="retryVolumeMigration(fail, false)" :disabled="migrateRetryLoading" class="px-2.5 py-1 rounded text-xs font-medium bg-red-100 dark:bg-red-800 text-red-700 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-700 disabled:opacity-50 transition-colors">
                    Retry
                  </button>
                  <button @click="retryVolumeMigration(fail, true)" :disabled="migrateRetryLoading" class="px-2.5 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                    Clean &amp; Retry
                  </button>
                </div>
              </div>
            </div>
            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <p class="text-xs text-gray-500 dark:text-gray-400">Service will need a redeploy after changing volumes</p>
              <button @click="saveVolumes" :disabled="volumeLoading" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {{ volumeLoading ? 'Saving...' : 'Save Volumes' }}
              </button>
            </div>
          </div>

          <!-- Volume File Browser Modal -->
          <Teleport to="body">
            <Transition name="modal">
              <div v-if="browsingVolumeName" class="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" @click="browsingVolumeName = null"></div>
                <div class="relative w-full max-w-6xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden">
                  <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0">
                    <div class="flex items-center gap-3">
                      <FolderOpen class="w-5 h-5 text-primary-600 dark:text-primary-400" />
                      <div>
                        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Volume Browser</h3>
                        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono">{{ browsingVolumeName }}</p>
                      </div>
                    </div>
                    <button @click="browsingVolumeName = null" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                  <div class="flex-1 overflow-y-auto p-6">
                    <FileExplorer :volumeName="browsingVolumeName" />
                  </div>
                </div>
              </div>
            </Transition>
          </Teleport>

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

                <!-- CPU Limit -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPU Limit (cores)</label>
                  <input v-model.number="configCpuLimit" type="number" min="0.1" max="64" step="0.1" :placeholder="String(service.cpuLimit ?? 1)" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Number of CPU cores allocated to each container</p>
                </div>

                <!-- Memory Limit -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Memory Limit (MB)</label>
                  <input v-model.number="configMemoryLimit" type="number" min="64" max="131072" step="64" :placeholder="String(service.memoryLimit ?? 1024)" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Memory allocated to each container in megabytes</p>
                </div>

                <!-- Restart Condition -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Restart Policy</label>
                  <select v-model="configRestartCondition" class="w-full min-w-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
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

