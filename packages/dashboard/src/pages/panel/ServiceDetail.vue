<script setup lang="ts">
defineOptions({ inheritAttrs: false })
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Box, Play, Square, Power, RotateCw, RefreshCcw, Trash2, Loader2, ArrowLeft, Radio, SquareTerminal, FolderOpen, Github, Webhook, Archive, Clock, Database, XCircle, Eye, EyeOff, Upload, Download, Search, Filter, FileDown, Code2, Activity, MapPin, HardDrive, FileCode, RotateCcw } from 'lucide-vue-next'
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal.vue'
import FileExplorer from '@/components/FileExplorer.vue'
import DatabaseManager from '@/components/DatabaseManager.vue'
import DomainPicker from '@/components/DomainPicker.vue'
import { useServicesStore } from '@/stores/services'
import { useDomainPicker } from '@/composables/useDomainPicker'
import { useApi, ApiError } from '@/composables/useApi'
import { useLogStream } from '@/composables/useLogStream'
import { useDeployStream } from '@/composables/useDeployStream'
import { useTerminal } from '@/composables/useTerminal'
import { useToast } from '@/composables/useToast'
import { useVolumeManager } from '@/composables/useVolumeManager'
import InlineVolumeCreator from '@/components/InlineVolumeCreator.vue'
import TierSelector from '@/components/TierSelector.vue'
import { useServiceBilling, usePlanLocale, type ServiceSubscription, type ResourceConflict } from '@/composables/useServiceBilling'
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
const { fetchDomains: fetchAccountDomains } = useDomainPicker()
const volumeManager = useVolumeManager()
const serviceBilling = useServiceBilling()
const { planName } = usePlanLocale()

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
  if (isNginxBased(service.value)) {
    base.push({ id: 'nginx', label: 'Nginx' })
  }
  base.push(
    { id: 'analytics', label: 'Analytics' },
    { id: 'billing', label: 'Billing' },
    { id: 'logs', label: 'Logs' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'deployments', label: 'Deployments' },
    { id: 'backups', label: 'Backups' },
  )
  if (service.value?.volumes?.length > 0) {
    base.push({ id: 'volumes', label: 'Volumes' })
  }
  base.push(
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
const showDeleteModal = ref(false)
const error = ref('')
const logs = ref('')
const logsLoading = ref(false)
const liveMode = ref(false)
const deployments = ref<any[]>([])
const deploymentsLoading = ref(false)
const logsContainer = ref<HTMLElement | null>(null)

const envVars = ref<{ key: string; value: string }[]>([])
const settingsLoading = ref(false)

// Billing tab state
const serviceSubscription = ref<ServiceSubscription | null>(null)
const billingLoading = ref(false)
const showChangePlan = ref(false)
const changePlanId = ref<string | null>(null)
const billingContactEmail = ref('')
const billingContactName = ref('')

async function fetchServiceBilling() {
  billingLoading.value = true
  try {
    serviceSubscription.value = await serviceBilling.fetchServiceSubscription(serviceId)
    if (serviceSubscription.value) {
      billingContactEmail.value = serviceSubscription.value.paymentContactEmail ?? ''
      billingContactName.value = serviceSubscription.value.paymentContactName ?? ''
    }
  } finally {
    billingLoading.value = false
  }
}

const downgradeConflicts = ref<ResourceConflict[]>([])
const showDowngradeConfirm = ref(false)
const downgradeError = ref('')

async function handleChangePlan(opts?: { confirm?: boolean }) {
  if (!changePlanId.value) return
  downgradeError.value = ''

  // No existing subscription — create a new one via checkout
  if (!serviceSubscription.value) {
    const url = await serviceBilling.createCheckout({
      serviceId,
      planId: changePlanId.value,
      billingCycle: 'monthly',
    })
    if (url) window.location.href = url
    return
  }

  const result = await serviceBilling.changePlan(serviceSubscription.value.id, changePlanId.value, opts)
  if (result.ok) {
    showChangePlan.value = false
    showDowngradeConfirm.value = false
    downgradeConflicts.value = []
    await fetchServiceBilling()
    return
  }
  if (result.status === 409 && result.conflicts?.length) {
    downgradeConflicts.value = result.conflicts
    showDowngradeConfirm.value = true
    return
  }
  if (result.status === 403) {
    downgradeError.value = result.message ?? 'Downgrade is not allowed. You can only upgrade or cancel.'
    return
  }
}

function confirmDowngrade() {
  handleChangePlan({ confirm: true })
}

function cancelDowngrade() {
  showDowngradeConfirm.value = false
  downgradeConflicts.value = []
}

function formatConflictField(field: string): string {
  if (field === 'cpu') return 'CPU'
  if (field === 'memory') return 'Memory'
  if (field === 'replicas') return 'Replicas'
  return field
}

function formatConflictValue(field: string, val: number): string {
  if (field === 'cpu') return `${val} vCPU${val !== 1 ? 's' : ''}`
  if (field === 'memory') return val >= 1024 ? `${(val / 1024).toFixed(val % 1024 === 0 ? 0 : 1)} GB` : `${val} MB`
  return String(val)
}

async function handleUpdateContact() {
  if (!serviceSubscription.value) return
  await serviceBilling.updateContact(serviceSubscription.value.id, {
    billingContactEmail: billingContactEmail.value || undefined,
    billingContactName: billingContactName.value || undefined,
  })
}

async function handleCancelSubscription() {
  if (!serviceSubscription.value) return
  const ok = await serviceBilling.cancelSubscription(serviceSubscription.value.id)
  if (ok) await fetchServiceBilling()
}

// Analytics tab state
interface AnalyticsDataPoint {
  timestamp: string
  requests: number
  bytesIn: number
  bytesOut: number
  statusBreakdown: Record<string, number>
}
interface AnalyticsResponse {
  data: AnalyticsDataPoint[]
  summary: { totalRequests: number; totalBytesIn: number; totalBytesOut: number }
}
const analyticsData = ref<AnalyticsResponse | null>(null)
const analyticsPeriod = ref<'24h' | '7d' | '30d'>('24h')
const analyticsLoading = ref(false)

async function fetchAnalytics() {
  analyticsLoading.value = true
  try {
    analyticsData.value = await api.get<AnalyticsResponse>(
      `/analytics/services/${serviceId}?period=${analyticsPeriod.value}`
    )
  } catch {
    analyticsData.value = null
  } finally {
    analyticsLoading.value = false
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

const chartWidth = 600
const chartHeight = 180
const chartPadding = { top: 10, right: 10, bottom: 20, left: 50 }

function buildPolylinePoints(values: number[]): string {
  if (!values.length) return ''
  const maxVal = Math.max(...values, 1)
  const innerW = chartWidth - chartPadding.left - chartPadding.right
  const innerH = chartHeight - chartPadding.top - chartPadding.bottom
  return values.map((v, i) => {
    const x = chartPadding.left + (values.length === 1 ? innerW / 2 : (i / (values.length - 1)) * innerW)
    const y = chartPadding.top + innerH - (v / maxVal) * innerH
    return `${x},${y}`
  }).join(' ')
}

function buildGridLines(values: number[]): { y: number; label: string }[] {
  const maxVal = Math.max(...values, 1)
  const innerH = chartHeight - chartPadding.top - chartPadding.bottom
  const steps = 4
  return Array.from({ length: steps + 1 }, (_, i) => {
    const val = (maxVal / steps) * i
    const y = chartPadding.top + innerH - (val / maxVal) * innerH
    return { y, label: val >= 1024 ? formatBytes(val) : formatNumber(Math.round(val)) }
  })
}

function buildTimeLabels(data: AnalyticsDataPoint[]): { x: number; label: string }[] {
  if (!data.length) return []
  const innerW = chartWidth - chartPadding.left - chartPadding.right
  const count = Math.min(data.length, 6)
  const step = Math.max(1, Math.floor(data.length / count))
  const labels: { x: number; label: string }[] = []
  for (let i = 0; i < data.length; i += step) {
    const point = data[i]
    if (!point) continue
    const d = new Date(point.timestamp)
    const x = chartPadding.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
    const label = analyticsPeriod.value === '24h'
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    labels.push({ x, label })
  }
  return labels
}

const requestsPoints = computed(() =>
  analyticsData.value ? buildPolylinePoints(analyticsData.value.data.map(d => d.requests)) : ''
)
const bytesOutPoints = computed(() =>
  analyticsData.value ? buildPolylinePoints(analyticsData.value.data.map(d => d.bytesOut)) : ''
)
const bytesInPoints = computed(() =>
  analyticsData.value ? buildPolylinePoints(analyticsData.value.data.map(d => d.bytesIn)) : ''
)
const requestsGrid = computed(() =>
  analyticsData.value ? buildGridLines(analyticsData.value.data.map(d => d.requests)) : []
)
const bandwidthGrid = computed(() => {
  if (!analyticsData.value) return []
  const combined = analyticsData.value.data.map(d => Math.max(d.bytesIn, d.bytesOut))
  return buildGridLines(combined)
})
const timeLabels = computed(() =>
  analyticsData.value ? buildTimeLabels(analyticsData.value.data) : []
)

const statusBreakdown = computed(() => {
  if (!analyticsData.value?.data.length) return { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
  const totals: Record<string, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
  for (const point of analyticsData.value.data) {
    for (const [key, val] of Object.entries(point.statusBreakdown)) {
      if (key in totals) totals[key] = (totals[key] ?? 0) + val
    }
  }
  return totals
})

const statusBarSegments = computed(() => {
  const b = statusBreakdown.value
  const total = Object.values(b).reduce((a, c) => a + c, 0)
  if (total === 0) return []
  return [
    { key: '2xx', pct: ((b['2xx'] ?? 0) / total) * 100, color: '#22c55e', label: '2xx' },
    { key: '3xx', pct: ((b['3xx'] ?? 0) / total) * 100, color: '#3b82f6', label: '3xx' },
    { key: '4xx', pct: ((b['4xx'] ?? 0) / total) * 100, color: '#eab308', label: '4xx' },
    { key: '5xx', pct: ((b['5xx'] ?? 0) / total) * 100, color: '#ef4444', label: '5xx' },
  ].filter(s => s.pct > 0)
})

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

// Tier limit computeds
const tierPlan = computed(() => serviceSubscription.value?.plan ?? null)
const tierCpuPercent = computed(() => {
  if (!tierPlan.value?.cpuLimit) return 0
  return Math.min(100, ((configCpuLimit.value ?? service.value?.cpuLimit ?? 0) / tierPlan.value.cpuLimit) * 100)
})
const tierMemoryPercent = computed(() => {
  if (!tierPlan.value?.memoryLimit) return 0
  return Math.min(100, ((configMemoryLimit.value ?? service.value?.memoryLimit ?? 0) / tierPlan.value.memoryLimit) * 100)
})
const tierReplicasPercent = computed(() => {
  if (!tierPlan.value?.containerLimit) return 0
  return Math.min(100, (configReplicas.value / tierPlan.value.containerLimit) * 100)
})
function formatMbForTier(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`
  return `${mb} MB`
}
const configLoading = ref(false)

// Domain settings
const configDomain = ref('')
const configSslEnabled = ref(true)
const domainLoading = ref(false)

// Robots.txt settings
const robotsMode = ref<'default' | 'custom' | 'disabled'>('default')
const robotsContent = ref('')
const robotsLoading = ref(false)

// Volume settings
const configVolumes = ref<Array<{ source: string; target: string; readonly: boolean }>>([])
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
    await refreshService()
    await fetchDeployments()
  } catch (err: any) {
    toast.error(err?.body?.error || 'Rollback failed')
  }
}

// Deployment notes
const editingNotes = ref<string | null>(null)
const editNotesValue = ref('')
// Expanded build log in deployments tab
const expandedDeployLog = ref<string | null>(null)

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
  // Skip generic wrapper lines added by the deployment worker
  const skipPatterns = [
    /Build\/deploy failed/i,
    /^Build failed$/i,
    /^\[error\]\s*Error:\s*Build\s+(failed|cancelled)/i,
  ]
  // Look for common error patterns
  const patterns = [
    /failed to solve:?\s*(.+)/i,
    /Module not found:\s*(.+)/i,
    /Cannot find module\s+'([^']+)'/,
    /npm ERR!\s+(.+)/,
    /FATAL:\s*(.+)/i,
    /error:\s*(.+)/i,
    /Error:\s*(.+)/,
    /exited with code (\d+)/i,
  ]
  const lines = log.split('\n').reverse()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length < 5) continue
    // Skip generic wrapper error lines
    if (skipPatterns.some((sp) => sp.test(trimmed))) continue
    for (const pat of patterns) {
      const m = trimmed.match(pat)
      if (m) return m[0].trim().slice(0, 300)
    }
  }
  // Fallback: last meaningful [error] line that isn't a wrapper
  const errorLine = lines.find((l: string) => {
    const t = l.trim()
    return t.length > 10 && t.includes('[error]') && !skipPatterns.some((sp) => sp.test(t))
  })
  if (errorLine) return errorLine.trim().slice(0, 300)
  // Last resort: last meaningful line
  const lastLine = lines.find((l: string) => l.trim().length > 10)
  return lastLine?.trim().slice(0, 300) || null
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

// Nginx config tab
const nginxConfig = ref('')
const nginxDefaultConfig = ref('')
const nginxIsCustom = ref(false)
const nginxLoading = ref(false)
const nginxSaving = ref(false)
const nginxError = ref('')

async function fetchNginxConfig() {
  nginxLoading.value = true
  nginxError.value = ''
  try {
    const data = await api.get<{ config: string; isCustom: boolean; defaultConfig: string }>(`/services/${serviceId}/nginx-config`)
    nginxConfig.value = data.config
    nginxDefaultConfig.value = data.defaultConfig
    nginxIsCustom.value = data.isCustom
  } catch (err: any) {
    nginxError.value = err?.body?.error || 'Failed to load nginx config'
  } finally {
    nginxLoading.value = false
  }
}

async function saveNginxConfig(applyNow: boolean = false) {
  nginxSaving.value = true
  nginxError.value = ''
  try {
    const result = await api.put<{ message: string; applied: boolean; validationError?: string }>(`/services/${serviceId}/nginx-config`, {
      config: nginxConfig.value,
      applyNow,
    })
    nginxIsCustom.value = true
    if (result.validationError) {
      nginxError.value = `Config saved but could not apply: ${result.validationError}`
      toast.error('Config saved but live reload failed')
    } else {
      toast.success(result.applied ? 'Nginx config saved and applied' : 'Nginx config saved')
    }
  } catch (err: any) {
    nginxError.value = err?.body?.error || 'Failed to save nginx config'
  } finally {
    nginxSaving.value = false
  }
}

async function resetNginxConfig() {
  if (!confirm('Reset to the default nginx config?')) return
  nginxSaving.value = true
  nginxError.value = ''
  try {
    await api.post(`/services/${serviceId}/nginx-config/reset`, {})
    nginxConfig.value = nginxDefaultConfig.value
    nginxIsCustom.value = false
    toast.success('Nginx config reset to default')
  } catch (err: any) {
    nginxError.value = err?.body?.error || 'Failed to reset config'
  } finally {
    nginxSaving.value = false
  }
}

async function rebuildService() {
  if (!confirm('Rebuild the service with the current Dockerfile?')) return

  // Optimistic update
  if (service.value) {
    service.value = { ...service.value, status: 'deploying' }
  }
  activeTab.value = 'overview'

  try {
    let result: any
    if (service.value?.sourceType === 'upload') {
      result = await api.post(`/upload/${serviceId}/rebuild`, new FormData())
    } else {
      result = await api.post('/deployments/trigger', { serviceId })
    }
    toast.success('Rebuild triggered')
    // Don't refreshService() here — it races with the inline build and can
    // overwrite the deploying status before the progress UI is visible.
    // The deployment poller will track state transitions.
    const newDeploymentId = result?.deploymentId
    if (newDeploymentId) {
      latestDeployment.value = { id: newDeploymentId, status: 'building', log: '', progressStep: 'queued' }
      deployStream.start(newDeploymentId)
    }
    startDeploymentPolling()
  } catch (err: any) {
    toast.error(err?.body?.error || 'Failed to trigger rebuild')
    await refreshService()
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
const backupQuota = ref<{ usedBytes: number; limitBytes: number; usedGb: number; limitGb: number; percentUsed: number } | null>(null)

async function fetchServiceBackups() {
  backupsLoading.value = true
  try {
    const [b, s] = await Promise.all([
      api.get<any[]>(`/backups?serviceId=${serviceId}`),
      api.get<any[]>(`/backups/schedules?serviceId=${serviceId}`),
      api.get('/backups/quota').then((q: any) => { backupQuota.value = q }).catch(() => {}),
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
    const msg = err?.body?.error || 'Failed to create backup'
    backupError.value = msg
  } finally {
    creatingBackup.value = false
  }
}

function backupTypeLabel(backup: any) {
  const level = backup.level ?? 0
  if (level === 0) return 'Full'
  return `Incremental (L${level})`
}

function quotaBarColor(percent: number) {
  if (percent >= 90) return 'bg-red-500'
  if (percent >= 70) return 'bg-yellow-500'
  return 'bg-primary-500'
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

function isNginxBased(svc: any): boolean {
  if (!svc) return false
  if (/^nginx(:|$)/i.test(svc.image)) return true
  if (svc.dockerfile && /^FROM\s+nginx/mi.test(svc.dockerfile)) return true
  return false
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

/** Silent refresh — updates service data without showing the full-page loader */
async function refreshService() {
  try {
    service.value = await api.get(`/services/${serviceId}`)
  } catch { /* silent */ }
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
    await refreshService()
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
    await refreshService()
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
    await refreshService()
    if (service.value?.status === 'deploying') startStatusPolling()
  } catch {
    toast.error(t('service.restartFailed', 'Failed to restart service'))
  } finally {
    actionLoading.value = ''
  }
}

async function redeployService() {
  actionLoading.value = 'redeploy'

  // Optimistic update: immediately show deploying state and switch to overview
  // so the progress stepper is visible before the API responds
  const hasBuildSource = service.value?.sourceType === 'github' || service.value?.sourceType === 'upload'
  if (service.value) {
    service.value = { ...service.value, status: 'deploying' }
  }
  if (hasBuildSource) {
    activeTab.value = 'overview'
  }

  try {
    const result: any = await api.post(`/services/${serviceId}/redeploy`, {})
    // For build-source redeploys, don't refreshService() — it can race with the
    // inline build and overwrite the deploying status before the UI has a chance
    // to show progress. The deployment poller will track state transitions.
    if (!hasBuildSource) {
      await refreshService()
    }
    // For image-only redeploys, the deployment completes immediately (no build step).
    // Only start deploy stream for services with a build source (github/upload).
    if (hasBuildSource) {
      const newDeploymentId = result?.deploymentId
      if (newDeploymentId) {
        latestDeployment.value = { id: newDeploymentId, status: 'building', log: '', progressStep: 'queued' }
        deployStream.start(newDeploymentId)
      }
      startDeploymentPolling()
    }
    // For image-only redeploys, use status polling to track Docker convergence.
    // Don't start both pollers — deploymentPolling already handles the lifecycle
    // for build-source services and statusPolling would race with it, clearing
    // the deploying state before the deployment record transitions to succeeded.
    if (!hasBuildSource && service.value?.status === 'deploying') {
      startStatusPolling()
    }
  } catch {
    toast.error(t('service.redeployFailed', 'Failed to redeploy service'))
    // Revert optimistic update on failure
    await refreshService()
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
    await refreshService()
  } catch {
    toast.error('Failed to sync service status')
  } finally {
    actionLoading.value = ''
  }
}

async function confirmDeleteService(deleteVolumeNames: string[]) {
  actionLoading.value = 'delete'
  try {
    await store.deleteService(serviceId, { deleteVolumeNames })
    showDeleteModal.value = false
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
    await refreshService()
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
    await refreshService()
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
    await refreshService()
    toast.success('Domain settings saved')
  } catch {
    toast.error('Failed to save domain settings')
  } finally {
    domainLoading.value = false
  }
}

async function saveRobots() {
  robotsLoading.value = true
  try {
    const config = robotsMode.value === 'custom'
      ? { mode: robotsMode.value, content: robotsContent.value }
      : { mode: robotsMode.value }
    await api.patch(`/services/${serviceId}`, { robotsConfig: config })
    await refreshService()
    toast.success(t('service.robots.saved'))
  } catch {
    toast.error(t('service.robots.saveFailed'))
  } finally {
    robotsLoading.value = false
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
    await refreshService()
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

async function handleVolumeCreated(index: number, vol: { name: string; displayName: string; sizeGb: number }) {
  try {
    const created = await volumeManager.createVolume(vol.name, vol.sizeGb)
    configVolumes.value[index]!.source = created.name
  } catch {
    // Toast already shown by useApi
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
    await refreshService()
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
    await refreshService()
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
  if (tabId === 'nginx') fetchNginxConfig()
  if (tabId === 'deployments') fetchDeployments()
  if (tabId === 'settings' && service.value) {
    // Fetch subscription for tier limits display
    if (!serviceSubscription.value) fetchServiceBilling()
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
    robotsMode.value = (service.value.robotsConfig as any)?.mode ?? 'default'
    robotsContent.value = (service.value.robotsConfig as any)?.content ?? ''
    configVolumes.value = ((service.value.volumes as any[]) ?? []).map((v: any) => ({
      source: v.source ?? '',
      target: v.target ?? '',
      readonly: v.readonly ?? false,
    }))
    // Fetch account volumes for the dropdown
    volumeManager.fetchAll()
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

watch(activeTab, (tab) => {
  if (tab === 'billing' && !serviceSubscription.value && !billingLoading.value) {
    serviceBilling.fetchTiers()
    fetchServiceBilling()
  }
  if (tab === 'analytics' && !analyticsData.value && !analyticsLoading.value) {
    fetchAnalytics()
  }
})

watch(analyticsPeriod, () => {
  fetchAnalytics()
})

onMounted(async () => {
  fetchAccountDomains()
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
        <div class="flex flex-wrap items-center gap-2">
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
            v-if="service.status !== 'stopped' && service.status !== 'deploying'"
            @click="redeployService"
            :disabled="!!actionLoading"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
          >
            <Loader2 v-if="actionLoading === 'redeploy'" class="w-4 h-4 animate-spin" />
            <Play v-else class="w-4 h-4" />
            {{ actionLoading === 'redeploy' ? 'Deploying...' : 'Redeploy' }}
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
            @click="showDeleteModal = true"
            :disabled="!!actionLoading"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm font-medium disabled:opacity-50"
          >
            <Trash2 class="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      <!-- Deploying banner (always visible regardless of tab) -->
      <div
        v-if="service.status === 'deploying' && activeTab !== 'overview'"
        class="mb-4 flex items-center gap-3 rounded-xl border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 px-4 py-3 cursor-pointer hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
        @click="activeTab = 'overview'"
      >
        <Loader2 class="w-5 h-5 text-primary-600 dark:text-primary-400 animate-spin shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-primary-800 dark:text-primary-200">Deployment in progress</p>
          <p class="text-xs text-primary-600 dark:text-primary-400">Click to view progress</p>
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
            <a
              v-if="service.domain"
              :href="`${service.sslEnabled ? 'https' : 'http'}://${service.domain}`"
              target="_blank"
              rel="noopener noreferrer"
              class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 block hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all group cursor-pointer"
            >
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Domain</p>
              <p class="text-lg font-bold text-primary-600 dark:text-primary-400 group-hover:underline truncate">{{ service.domain }}</p>
            </a>
            <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Domain</p>
              <p class="text-lg font-bold text-gray-900 dark:text-white">None</p>
            </div>
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Replicas</p>
              <p class="text-lg font-bold text-gray-900 dark:text-white">
                <template v-if="dockerStatus">{{ dockerStatus.runningTasks }}/{{ dockerStatus.desiredTasks }}</template>
                <template v-else>{{ service.replicas ?? 1 }}</template>
              </p>
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
              <div class="flex items-center gap-2 mb-2">
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
              <div v-for="vol in (service.volumes as any[])" :key="vol.source" class="mt-1.5">
                <div v-if="volumeManager.accountVolumes.value.find(v => v.name === vol.source)" class="text-xs">
                  <div class="flex items-baseline justify-between mb-0.5">
                    <span class="text-gray-500 dark:text-gray-400 font-mono truncate">{{ vol.source }}</span>
                    <span class="text-gray-400 dark:text-gray-500 shrink-0 ml-1">{{ (volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.usedGb ?? 0).toFixed(1) }}/{{ volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.sizeGb ?? 0 }} GB</span>
                  </div>
                  <div class="h-1 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden">
                    <div
                      class="h-full rounded-full bg-primary-500 transition-all duration-500"
                      :style="{ width: (volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.sizeGb ?? 0) > 0 ? `${Math.min(100, ((volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.usedGb ?? 0) / (volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.sizeGb ?? 1)) * 100)}%` : '0%' }"
                    />
                  </div>
                </div>
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
                <p class="text-xs font-mono text-red-700 dark:text-red-300 mt-1 break-all whitespace-pre-wrap">{{ buildErrorSummary || latestDeployment.log.slice(-500) }}</p>
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
              <div v-if="service.dockerServiceId">
                <dt class="text-gray-500 dark:text-gray-400">Docker Service</dt>
                <dd class="font-mono text-xs text-gray-900 dark:text-white mt-0.5">{{ service.dockerServiceId }}</dd>
              </div>
              <div v-if="(service as any).dockerStatus?.networks?.length">
                <dt class="text-gray-500 dark:text-gray-400">Networks</dt>
                <dd class="text-gray-900 dark:text-white mt-0.5">
                  <div v-for="net in (service as any).dockerStatus.networks" :key="net.name" class="text-xs">
                    <span class="font-mono">{{ net.name }}</span>
                    <span v-if="net.virtualIP" class="text-gray-400 ml-1">({{ net.virtualIP }})</span>
                  </div>
                </dd>
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

                <!-- Volumes -->
                <div v-if="(service.volumes as any[])?.length" class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 space-y-3">
                  <div class="flex items-center gap-1.5">
                    <HardDrive class="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                    <span class="text-xs font-medium text-gray-700 dark:text-gray-300">Volumes</span>
                  </div>
                  <div v-for="vol in (service.volumes as any[])" :key="vol.source" class="space-y-1">
                    <template v-if="volumeManager.accountVolumes.value.find(v => v.name === vol.source)">
                      <div class="flex items-center justify-between text-xs">
                        <span class="text-gray-500 dark:text-gray-400 font-mono truncate">{{ vol.source }}</span>
                        <span class="font-medium text-gray-700 dark:text-gray-300 shrink-0 ml-2">
                          {{ (volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.usedGb ?? 0).toFixed(1) }} / {{ volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.sizeGb ?? 0 }} GB
                        </span>
                      </div>
                      <div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          :class="['h-full rounded-full transition-all',
                            ((volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.usedGb ?? 0) / (volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.sizeGb || 1)) < 0.7 ? 'bg-blue-500' :
                            ((volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.usedGb ?? 0) / (volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.sizeGb || 1)) < 0.9 ? 'bg-yellow-500' : 'bg-red-500']"
                          :style="{ width: (volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.sizeGb ?? 0) > 0 ? `${Math.min(100, ((volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.usedGb ?? 0) / (volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.sizeGb ?? 1)) * 100)}%` : '0%' }"
                        />
                      </div>
                      <div class="flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500">
                        <span>{{ vol.target }}</span>
                        <span>{{ (volumeManager.accountVolumes.value.find(v => v.name === vol.source)?.availableGb ?? 0).toFixed(1) }} GB free</span>
                      </div>
                    </template>
                    <template v-else>
                      <div class="flex items-center justify-between text-xs">
                        <span class="text-gray-500 dark:text-gray-400 font-mono truncate">{{ vol.source }}</span>
                        <span class="text-gray-400 dark:text-gray-500 text-[10px]">{{ vol.target }}</span>
                      </div>
                    </template>
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

        <!-- Nginx Config -->
        <div v-if="activeTab === 'nginx'">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Nginx Configuration</h3>
                <p class="text-xs mt-0.5" :class="nginxIsCustom ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'">
                  {{ nginxIsCustom ? 'Custom configuration' : 'Default configuration — edit to customize' }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  v-if="nginxIsCustom"
                  @click="resetNginxConfig"
                  :disabled="nginxSaving"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <RotateCcw class="w-3.5 h-3.5" />
                  Reset
                </button>
                <button
                  @click="saveNginxConfig(false)"
                  :disabled="nginxSaving || !nginxConfig.trim()"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  <Loader2 v-if="nginxSaving" class="w-3.5 h-3.5 animate-spin" />
                  Save
                </button>
                <button
                  v-if="service?.status === 'running'"
                  @click="saveNginxConfig(true)"
                  :disabled="nginxSaving || !nginxConfig.trim()"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  <Loader2 v-if="nginxSaving" class="w-3.5 h-3.5 animate-spin" />
                  Save & Apply
                </button>
              </div>
            </div>
            <div v-if="nginxLoading" class="p-12 flex items-center justify-center">
              <Loader2 class="w-6 h-6 text-primary-500 animate-spin" />
            </div>
            <div v-else>
              <textarea
                v-model="nginxConfig"
                spellcheck="false"
                class="w-full min-h-[500px] p-4 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono text-sm leading-relaxed resize-y border-0 focus:outline-none focus:ring-0"
                placeholder="server { ... }"
              />
            </div>
            <div v-if="nginxError" class="px-6 py-3 border-t border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10">
              <p class="text-sm text-red-600 dark:text-red-400">{{ nginxError }}</p>
            </div>
            <div class="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <p class="text-xs text-gray-500 dark:text-gray-400">
                This config is written to <code class="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs">/etc/nginx/conf.d/default.conf</code> inside the container.
                <strong>Save</strong> persists for the next deploy. <strong>Save &amp; Apply</strong> also reloads the running container immediately.
              </p>
            </div>
          </div>
        </div>

        <!-- Analytics -->
        <div v-if="activeTab === 'analytics'" class="space-y-6">
          <div v-if="analyticsLoading" class="flex items-center justify-center py-12">
            <Loader2 class="w-6 h-6 text-primary-600 animate-spin" />
          </div>

          <template v-else-if="analyticsData">
            <!-- Period selector -->
            <div class="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
              <button
                v-for="p in (['24h', '7d', '30d'] as const)"
                :key="p"
                @click="analyticsPeriod = p"
                :class="[
                  'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                  analyticsPeriod === p
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                ]"
              >
                {{ p }}
              </button>
            </div>

            <!-- Summary cards -->
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">Total Requests</p>
                <p class="text-2xl font-bold text-gray-900 dark:text-white">{{ formatNumber(analyticsData.summary.totalRequests) }}</p>
              </div>
              <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">Bandwidth In</p>
                <p class="text-2xl font-bold text-gray-900 dark:text-white">{{ formatBytes(analyticsData.summary.totalBytesIn) }}</p>
              </div>
              <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">Bandwidth Out</p>
                <p class="text-2xl font-bold text-gray-900 dark:text-white">{{ formatBytes(analyticsData.summary.totalBytesOut) }}</p>
              </div>
            </div>

            <!-- Requests chart -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Requests</h3>
              <div v-if="analyticsData.data.length === 0" class="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
                No data yet. Analytics are collected every 5 minutes.
              </div>
              <svg v-else :viewBox="`0 0 ${chartWidth} ${chartHeight}`" class="w-full h-auto" preserveAspectRatio="xMidYMid meet">
                <!-- Grid lines -->
                <line v-for="(g, i) in requestsGrid" :key="'rg'+i"
                  :x1="chartPadding.left" :y1="g.y" :x2="chartWidth - chartPadding.right" :y2="g.y"
                  stroke="currentColor" class="text-gray-200 dark:text-gray-700" stroke-width="0.5" />
                <!-- Y-axis labels -->
                <text v-for="(g, i) in requestsGrid" :key="'rl'+i"
                  :x="chartPadding.left - 4" :y="g.y + 3"
                  text-anchor="end" class="fill-gray-400 dark:fill-gray-500" font-size="9">{{ g.label }}</text>
                <!-- X-axis labels -->
                <text v-for="(tl, i) in timeLabels" :key="'tl'+i"
                  :x="tl.x" :y="chartHeight - 2"
                  text-anchor="middle" class="fill-gray-400 dark:fill-gray-500" font-size="9">{{ tl.label }}</text>
                <!-- Area fill -->
                <polygon
                  v-if="requestsPoints"
                  :points="`${chartPadding.left},${chartHeight - chartPadding.bottom} ${requestsPoints} ${chartWidth - chartPadding.right},${chartHeight - chartPadding.bottom}`"
                  class="fill-primary-500/10 dark:fill-primary-400/10"
                />
                <!-- Line -->
                <polyline
                  v-if="requestsPoints"
                  :points="requestsPoints"
                  fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                  class="stroke-primary-500 dark:stroke-primary-400"
                />
              </svg>
            </div>

            <!-- Bandwidth chart -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Bandwidth</h3>
              <div class="flex items-center gap-4 mb-3 text-xs text-gray-500 dark:text-gray-400">
                <span class="flex items-center gap-1"><span class="w-3 h-0.5 bg-blue-500 inline-block rounded"></span> In</span>
                <span class="flex items-center gap-1"><span class="w-3 h-0.5 bg-emerald-500 inline-block rounded"></span> Out</span>
              </div>
              <div v-if="analyticsData.data.length === 0" class="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
                No data yet.
              </div>
              <svg v-else :viewBox="`0 0 ${chartWidth} ${chartHeight}`" class="w-full h-auto" preserveAspectRatio="xMidYMid meet">
                <!-- Grid lines -->
                <line v-for="(g, i) in bandwidthGrid" :key="'bg'+i"
                  :x1="chartPadding.left" :y1="g.y" :x2="chartWidth - chartPadding.right" :y2="g.y"
                  stroke="currentColor" class="text-gray-200 dark:text-gray-700" stroke-width="0.5" />
                <!-- Y-axis labels -->
                <text v-for="(g, i) in bandwidthGrid" :key="'bl'+i"
                  :x="chartPadding.left - 4" :y="g.y + 3"
                  text-anchor="end" class="fill-gray-400 dark:fill-gray-500" font-size="9">{{ g.label }}</text>
                <!-- X-axis labels -->
                <text v-for="(tl, i) in timeLabels" :key="'btl'+i"
                  :x="tl.x" :y="chartHeight - 2"
                  text-anchor="middle" class="fill-gray-400 dark:fill-gray-500" font-size="9">{{ tl.label }}</text>
                <!-- In line -->
                <polyline
                  v-if="bytesInPoints"
                  :points="bytesInPoints"
                  fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                  class="stroke-blue-500"
                />
                <!-- Out line -->
                <polyline
                  v-if="bytesOutPoints"
                  :points="bytesOutPoints"
                  fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                  class="stroke-emerald-500"
                />
              </svg>
            </div>

            <!-- Status breakdown -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Status Codes</h3>
              <div v-if="statusBarSegments.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
                No request data yet.
              </div>
              <template v-else>
                <!-- Stacked bar -->
                <div class="h-6 rounded-full overflow-hidden flex">
                  <div
                    v-for="seg in statusBarSegments"
                    :key="seg.key"
                    :style="{ width: seg.pct + '%', backgroundColor: seg.color }"
                    class="h-full transition-all duration-300"
                  />
                </div>
                <!-- Legend -->
                <div class="flex flex-wrap items-center gap-4 mt-3 text-xs text-gray-600 dark:text-gray-400">
                  <span v-for="seg in statusBarSegments" :key="'l'+seg.key" class="flex items-center gap-1.5">
                    <span class="w-2.5 h-2.5 rounded-full" :style="{ backgroundColor: seg.color }" />
                    {{ seg.label }}: {{ formatNumber(statusBreakdown[seg.key] ?? 0) }} ({{ seg.pct.toFixed(1) }}%)
                  </span>
                </div>
              </template>
            </div>
          </template>

          <div v-else class="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
            <Activity class="w-8 h-8 mx-auto mb-3 text-gray-400 dark:text-gray-500" />
            <p>Unable to load analytics data.</p>
            <button @click="fetchAnalytics" class="mt-2 text-primary-600 dark:text-primary-400 hover:underline text-sm">Try again</button>
          </div>
        </div>

        <!-- Billing -->
        <div v-if="activeTab === 'billing'" class="space-y-6">
          <div v-if="billingLoading" class="flex items-center justify-center py-12">
            <Loader2 class="w-6 h-6 text-primary-600 animate-spin" />
          </div>

          <template v-else>
            <!-- Current Plan -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Current Plan</h3>
                <button
                  v-if="serviceSubscription"
                  @click="showChangePlan = !showChangePlan; changePlanId = serviceSubscription?.planId ?? null"
                  class="text-sm text-primary-600 dark:text-primary-400 hover:underline"
                >
                  {{ showChangePlan ? 'Cancel' : 'Change Plan' }}
                </button>
              </div>

              <div v-if="serviceSubscription?.plan" class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <span class="text-gray-500 dark:text-gray-400 block">Plan</span>
                  <span class="font-medium text-gray-900 dark:text-white">{{ planName(serviceSubscription.plan) }}</span>
                </div>
                <div>
                  <span class="text-gray-500 dark:text-gray-400 block">Price</span>
                  <span class="font-medium text-gray-900 dark:text-white">
                    {{ serviceSubscription.plan.isFree ? 'Free' : serviceBilling.formatCents(serviceSubscription.plan.priceCents) + '/mo' }}
                  </span>
                </div>
                <div>
                  <span class="text-gray-500 dark:text-gray-400 block">Status</span>
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    :class="{
                      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400': serviceSubscription.status === 'active',
                      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400': serviceSubscription.status === 'past_due',
                      'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400': serviceSubscription.status === 'cancelled',
                      'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400': !['active', 'past_due', 'cancelled'].includes(serviceSubscription.status),
                    }"
                  >
                    {{ serviceSubscription.status }}
                  </span>
                </div>
                <div>
                  <span class="text-gray-500 dark:text-gray-400 block">Cycle</span>
                  <span class="font-medium text-gray-900 dark:text-white capitalize">{{ serviceSubscription.billingCycle }}</span>
                </div>
              </div>
              <div v-else class="flex items-center justify-between">
                <span class="text-sm text-gray-500 dark:text-gray-400">
                  No plan assigned. This service is running on the free tier or an account-level subscription.
                </span>
                <button
                  @click="showChangePlan = !showChangePlan; changePlanId = null"
                  class="text-sm text-primary-600 dark:text-primary-400 hover:underline"
                >
                  {{ showChangePlan ? 'Cancel' : 'Upgrade' }}
                </button>
              </div>

              <!-- Period info -->
              <div v-if="serviceSubscription?.currentPeriodStart && serviceSubscription?.currentPeriodEnd" class="mt-4 text-xs text-gray-500 dark:text-gray-400">
                Current period: {{ new Date(serviceSubscription.currentPeriodStart).toLocaleDateString() }} &ndash; {{ new Date(serviceSubscription.currentPeriodEnd).toLocaleDateString() }}
              </div>
            </div>

            <!-- Change Plan -->
            <div v-if="showChangePlan" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Select New Plan</h3>
              <TierSelector v-model="changePlanId" :current-plan="serviceSubscription?.plan ?? undefined" />

              <!-- Downgrade error (403) -->
              <div v-if="downgradeError" class="mt-4 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
                {{ downgradeError }}
              </div>

              <!-- Downgrade conflict confirmation (409) -->
              <div v-if="showDowngradeConfirm && downgradeConflicts.length" class="mt-4 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <h4 class="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">Resource adjustment required</h4>
                <p class="text-sm text-amber-700 dark:text-amber-400 mb-3">The new plan has lower limits than your current configuration. The following resources will be automatically adjusted:</p>
                <ul class="space-y-1 text-sm text-amber-700 dark:text-amber-400 mb-4">
                  <li v-for="c in downgradeConflicts" :key="c.field">
                    {{ formatConflictField(c.field) }}: {{ formatConflictValue(c.field, c.current) }} &rarr; {{ formatConflictValue(c.field, c.limit) }}
                  </li>
                </ul>
                <div class="flex gap-3">
                  <button @click="confirmDowngrade" class="px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700">
                    Confirm Downgrade
                  </button>
                  <button @click="cancelDowngrade" class="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:underline">
                    Cancel
                  </button>
                </div>
              </div>

              <div v-if="!showDowngradeConfirm" class="mt-4 flex gap-3">
                <button
                  @click="handleChangePlan()"
                  :disabled="!changePlanId || changePlanId === serviceSubscription?.planId"
                  class="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {{ serviceSubscription ? 'Confirm Change' : 'Subscribe' }}
                </button>
                <button @click="showChangePlan = false" class="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:underline">
                  Cancel
                </button>
              </div>
            </div>

            <!-- Billing Contact -->
            <div v-if="serviceSubscription" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Billing Contact</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                  <input
                    v-model="billingContactName"
                    type="text"
                    placeholder="Billing contact name"
                    class="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                  <input
                    v-model="billingContactEmail"
                    type="email"
                    placeholder="billing@example.com"
                    class="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400"
                  />
                </div>
              </div>
              <div class="mt-4">
                <button
                  @click="handleUpdateContact"
                  class="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700"
                >
                  Save Contact
                </button>
              </div>
            </div>

            <!-- Cancel Subscription -->
            <div v-if="serviceSubscription && serviceSubscription.status === 'active' && !serviceSubscription.plan?.isFree" class="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-900/50 p-6">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Cancel Subscription</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Your service will continue until the end of the current billing period, then be suspended.
              </p>
              <button
                @click="handleCancelSubscription"
                class="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
              >
                Cancel Subscription
              </button>
            </div>
          </template>
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
                  <template v-for="deploy in deployments" :key="deploy.id">
                  <tr
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
                        <!-- Build Log -->
                        <button
                          v-if="deploy.log"
                          @click="expandedDeployLog = expandedDeployLog === deploy.id ? null : deploy.id"
                          class="text-xs font-medium hover:underline transition-colors"
                          :class="[
                            deploy.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-primary-600 dark:text-primary-400',
                            expandedDeployLog === deploy.id || deploy.status === 'failed' ? '' : 'opacity-0 group-hover:opacity-100'
                          ]"
                        >
                          {{ expandedDeployLog === deploy.id ? 'Hide Log' : 'Build Log' }}
                        </button>
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
                  <!-- Expanded build log row -->
                  <tr v-if="expandedDeployLog === deploy.id && deploy.log" :key="'log-' + deploy.id">
                    <td colspan="7" class="px-5 py-3 bg-gray-50 dark:bg-gray-900/50">
                      <pre class="p-3 rounded-lg bg-gray-950 text-gray-200 text-xs font-mono leading-5 whitespace-pre-wrap break-all max-h-96 overflow-auto border border-gray-700">{{ deploy.log }}</pre>
                    </td>
                  </tr>
                  </template>
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
                    v-if="deploy.log"
                    @click="expandedDeployLog = expandedDeployLog === deploy.id ? null : deploy.id"
                    class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    {{ expandedDeployLog === deploy.id ? 'Hide Build Log' : 'View Build Log' }}
                  </button>
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
                <!-- Expanded build log -->
                <pre
                  v-if="expandedDeployLog === deploy.id && deploy.log"
                  class="mt-2 p-3 rounded-lg bg-gray-950 text-gray-200 text-xs font-mono leading-5 whitespace-pre-wrap break-all max-h-96 overflow-auto border border-gray-700"
                >{{ deploy.log }}</pre>
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
          <!-- Quota bar -->
          <div v-if="backupQuota" class="mb-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <HardDrive class="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Backup Storage</span>
              </div>
              <span class="text-sm text-gray-500 dark:text-gray-400">
                {{ backupQuota.usedGb.toFixed(2) }} GB / {{ backupQuota.limitGb }} GB ({{ Math.round(backupQuota.percentUsed) }}%)
              </span>
            </div>
            <div class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                :class="['h-full rounded-full transition-all', quotaBarColor(backupQuota.percentUsed)]"
                :style="{ width: Math.min(backupQuota.percentUsed, 100) + '%' }"
              />
            </div>
          </div>

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
                      <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                      <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Size</th>
                      <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                      <th class="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr v-for="backup in serviceBackups" :key="backup.id" class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td class="px-6 py-3.5 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{{ formatDate(backup.createdAt) }}</td>
                      <td class="px-6 py-3.5 text-sm">
                        <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', (backup.level ?? 0) === 0 ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300']">
                          {{ backupTypeLabel(backup) }}
                        </span>
                      </td>
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
                    <div class="flex items-center gap-2">
                      <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', (backup.level ?? 0) === 0 ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300']">
                        {{ backupTypeLabel(backup) }}
                      </span>
                      <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', backup.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : backup.status === 'in_progress' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300']">
                        {{ backup.status }}
                      </span>
                    </div>
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

        <!-- Volumes -->
        <div v-if="activeTab === 'volumes'" class="space-y-4">
          <div
            v-for="vol in (service?.volumes ?? [])"
            :key="vol.source"
            class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
          >
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <HardDrive class="w-5 h-5 text-primary-600 dark:text-primary-400" />
                <div>
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ vol.source }}</h3>
                  <p class="text-xs text-gray-500 dark:text-gray-400 font-mono">→ {{ vol.target }}</p>
                </div>
              </div>
              <span v-if="vol.readonly" class="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">Read-only</span>
            </div>
            <div class="p-4">
              <FileExplorer :volumeName="vol.source" />
            </div>
          </div>
          <div v-if="!service?.volumes?.length" class="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
            <HardDrive class="w-8 h-8 mx-auto mb-3 text-gray-400 dark:text-gray-500" />
            <p>No volumes attached to this service.</p>
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
                <DomainPicker
                  v-model="configDomain"
                  placeholder="app.example.com"
                  :exclude-service-id="serviceId"
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

          <!-- Robots.txt — only shown when service has a domain -->
          <div v-if="service?.domain" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('service.robots.title') }}</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ $t('service.robots.desc') }}</p>
            </div>
            <div class="p-6 space-y-4">
              <div class="space-y-3">
                <label class="flex items-center gap-3 cursor-pointer">
                  <input v-model="robotsMode" type="radio" value="default" name="robotsMode" class="text-primary-600 focus:ring-primary-500" />
                  <div>
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('service.robots.useDefault') }}</span>
                    <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('service.robots.useDefaultDesc') }}</p>
                  </div>
                </label>
                <label class="flex items-center gap-3 cursor-pointer">
                  <input v-model="robotsMode" type="radio" value="custom" name="robotsMode" class="text-primary-600 focus:ring-primary-500" />
                  <div>
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('service.robots.custom') }}</span>
                    <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('service.robots.customDesc') }}</p>
                  </div>
                </label>
                <label class="flex items-center gap-3 cursor-pointer">
                  <input v-model="robotsMode" type="radio" value="disabled" name="robotsMode" class="text-primary-600 focus:ring-primary-500" />
                  <div>
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('service.robots.disabled') }}</span>
                    <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('service.robots.disabledDesc') }}</p>
                  </div>
                </label>
              </div>

              <div v-if="robotsMode === 'custom'">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ $t('service.robots.contentLabel') }}</label>
                <textarea
                  v-model="robotsContent"
                  rows="10"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  :placeholder="$t('service.robots.placeholder')"
                />
              </div>
            </div>
            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button @click="saveRobots" :disabled="robotsLoading" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {{ robotsLoading ? $t('service.saving') : $t('service.robots.save') }}
              </button>
            </div>
          </div>

          <!-- DB without volume warning -->
          <div
            v-if="service?.image && volumeManager.isDatabaseImage(service.image) && configVolumes.length === 0"
            class="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800"
          >
            <div class="flex items-start gap-2">
              <svg class="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
              <div>
                <p class="text-sm font-medium text-amber-800 dark:text-amber-200">{{ $t('deploy.dbWithoutVolume') }}</p>
                <p class="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{{ $t('deploy.dbWithoutVolumeDesc', { path: volumeManager.suggestedVolumePath(service.image) }) }}</p>
              </div>
            </div>
          </div>

          <!-- Volumes -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Volumes</h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Attach persistent storage volumes to this service</p>
              </div>
              <div class="flex items-center gap-3">
                <span v-if="volumeManager.storageQuota.value" class="text-xs text-gray-400 dark:text-gray-500">
                  {{ volumeManager.storageQuota.value.usedGb }} / {{ volumeManager.storageQuota.value.limitGb }} GB used
                </span>
                <button @click="addVolume" class="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors">
                  + Add Volume
                </button>
              </div>
            </div>
            <div class="p-6">
              <div v-if="configVolumes.length === 0" class="text-center py-6 text-sm text-gray-500 dark:text-gray-400">
                No volumes attached. Click "Add Volume" to mount a storage volume.
              </div>
              <div v-else class="space-y-3">
                <InlineVolumeCreator
                  v-for="(vol, idx) in configVolumes"
                  :key="idx"
                  :model-value="vol"
                  :account-volumes="volumeManager.accountVolumes.value"
                  :storage-quota="volumeManager.storageQuota.value"
                  :create-loading="volumeManager.createLoading.value"
                  :suggested-target="service?.image ? volumeManager.suggestedVolumePath(service.image) ?? undefined : undefined"
                  @update:model-value="configVolumes[idx] = $event"
                  @volume-created="handleVolumeCreated(idx, $event)"
                  @remove="removeVolume(idx)"
                  @browse="browsingVolumeName = $event"
                />
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

          <!-- Resource Usage & Tier Limits -->
          <div :class="tierPlan ? 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800' : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'" class="border rounded-xl p-5 mb-6">
            <div class="flex items-center justify-between mb-3">
              <h4 v-if="tierPlan" class="text-sm font-semibold text-blue-900 dark:text-blue-200">{{ tierPlan.name }} Tier</h4>
              <h4 v-else class="text-sm font-semibold text-gray-700 dark:text-gray-300">Resource Usage</h4>
              <button v-if="tierPlan" @click="onTabChange('billing')" class="text-xs text-blue-600 dark:text-blue-400 hover:underline">Change Plan</button>
              <button v-else @click="onTabChange('billing')" class="text-xs text-primary-600 dark:text-primary-400 hover:underline">Upgrade to set limits</button>
            </div>
            <div class="grid grid-cols-3 gap-4">
              <!-- CPU -->
              <div>
                <div class="flex items-center justify-between text-xs mb-1">
                  <span :class="tierPlan ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-400'">CPU</span>
                  <span :class="tierPlan ? 'font-medium text-blue-900 dark:text-blue-100' : 'font-medium text-gray-900 dark:text-gray-100'">
                    {{ configCpuLimit ?? service.cpuLimit ?? '-' }}{{ tierPlan ? ` / ${tierPlan.cpuLimit}` : '' }} cores
                  </span>
                </div>
                <div v-if="tierPlan" class="h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                  <div class="h-full rounded-full transition-all" :class="tierCpuPercent > 90 ? 'bg-red-500' : tierCpuPercent > 70 ? 'bg-yellow-500' : 'bg-blue-500'" :style="{ width: tierCpuPercent + '%' }" />
                </div>
                <div v-else class="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div class="h-full rounded-full bg-gray-400 dark:bg-gray-500" style="width: 100%" />
                </div>
              </div>
              <!-- Memory -->
              <div>
                <div class="flex items-center justify-between text-xs mb-1">
                  <span :class="tierPlan ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-400'">Memory</span>
                  <span :class="tierPlan ? 'font-medium text-blue-900 dark:text-blue-100' : 'font-medium text-gray-900 dark:text-gray-100'">
                    {{ formatMbForTier(configMemoryLimit ?? service.memoryLimit ?? 0) }}{{ tierPlan ? ` / ${formatMbForTier(tierPlan.memoryLimit)}` : '' }}
                  </span>
                </div>
                <div v-if="tierPlan" class="h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                  <div class="h-full rounded-full transition-all" :class="tierMemoryPercent > 90 ? 'bg-red-500' : tierMemoryPercent > 70 ? 'bg-yellow-500' : 'bg-blue-500'" :style="{ width: tierMemoryPercent + '%' }" />
                </div>
                <div v-else class="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div class="h-full rounded-full bg-gray-400 dark:bg-gray-500" style="width: 100%" />
                </div>
              </div>
              <!-- Replicas -->
              <div>
                <div class="flex items-center justify-between text-xs mb-1">
                  <span :class="tierPlan ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-400'">Replicas</span>
                  <span :class="tierPlan ? 'font-medium text-blue-900 dark:text-blue-100' : 'font-medium text-gray-900 dark:text-gray-100'">
                    {{ configReplicas }}{{ tierPlan ? ` / ${tierPlan.containerLimit}` : '' }}
                  </span>
                </div>
                <div v-if="tierPlan" class="h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                  <div class="h-full rounded-full transition-all" :class="tierReplicasPercent > 90 ? 'bg-red-500' : tierReplicasPercent > 70 ? 'bg-yellow-500' : 'bg-blue-500'" :style="{ width: tierReplicasPercent + '%' }" />
                </div>
                <div v-else class="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div class="h-full rounded-full bg-gray-400 dark:bg-gray-500" style="width: 100%" />
                </div>
              </div>
            </div>
            <p v-if="!tierPlan" class="mt-3 text-xs text-gray-500 dark:text-gray-400">No plan limits applied. Upgrade to a plan to enforce resource limits.</p>
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
                  <input v-model.number="configReplicas" type="number" min="0" :max="tierPlan?.containerLimit ?? 100" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  <p v-if="tierPlan" class="mt-1 text-xs text-blue-600 dark:text-blue-400">Plan limit: {{ tierPlan.containerLimit }}</p>
                </div>

                <!-- CPU Limit -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPU Limit (cores)</label>
                  <input v-model.number="configCpuLimit" type="number" min="0.01" :max="tierPlan?.cpuLimit ?? 64" step="0.01" :placeholder="String(service.cpuLimit ?? 1)" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Number of CPU cores allocated to each container</p>
                  <p v-if="tierPlan" class="text-xs text-blue-600 dark:text-blue-400">Plan limit: {{ tierPlan.cpuLimit }} cores</p>
                </div>

                <!-- Memory Limit -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Memory Limit (MB)</label>
                  <input v-model.number="configMemoryLimit" type="number" min="64" :max="tierPlan?.memoryLimit ?? 131072" step="64" :placeholder="String(service.memoryLimit ?? 1024)" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Memory allocated to each container in megabytes</p>
                  <p v-if="tierPlan" class="text-xs text-blue-600 dark:text-blue-400">Plan limit: {{ formatMbForTier(tierPlan.memoryLimit) }}</p>
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

  <!-- Delete confirmation modal -->
  <ConfirmDeleteModal
    :show="showDeleteModal"
    :title="t('confirmDelete.title', 'Delete Service')"
    :message="t('confirmDelete.message', 'Are you sure you want to delete')"
    :item-name="service?.name || ''"
    :volumes="(service?.volumes as any[]) ?? []"
    :loading="actionLoading === 'delete'"
    @confirm="confirmDeleteService"
    @cancel="showDeleteModal = false"
  />
</template>

