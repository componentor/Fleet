<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  Activity,
  RefreshCw,
  Server,
  Database,
  Container,
  Cpu,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Zap,
  HardDrive,
  GitCommit,
  BarChart3,
  Download,
} from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const api = useApi()
const loading = ref(true)
const status = ref<any>(null)
const error = ref('')
const autoRefresh = ref(true)
let refreshInterval: ReturnType<typeof setInterval> | null = null

async function fetchStatus() {
  try {
    status.value = await api.get<any>('/admin/status')
    error.value = ''
  } catch {
    error.value = 'Failed to fetch system status'
  } finally {
    loading.value = false
  }
}

function startAutoRefresh() {
  stopAutoRefresh()
  if (autoRefresh.value) {
    refreshInterval = setInterval(fetchStatus, 15000)
  }
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value
  if (autoRefresh.value) {
    startAutoRefresh()
  } else {
    stopAutoRefresh()
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function formatDate(ts: string | null): string {
  if (!ts) return 'Never'
  return new Date(ts).toLocaleString()
}

function timeSince(ts: string | null): string {
  if (!ts) return 'never'
  const diff = Date.now() - new Date(ts).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const overallHealth = computed(() => {
  if (!status.value) return 'unknown'
  const apiOk = status.value.api?.status === 'healthy'
  const dockerOk = status.value.docker?.status === 'connected'
  const nodesHealthy = status.value.nodes?.every((n: any) => n.healthy) ?? true
  if (apiOk && dockerOk && nodesHealthy) return 'healthy'
  if (apiOk) return 'degraded'
  return 'unhealthy'
})

const healthColor = computed(() => {
  switch (overallHealth.value) {
    case 'healthy': return 'text-green-600 dark:text-green-400'
    case 'degraded': return 'text-yellow-600 dark:text-yellow-400'
    default: return 'text-red-600 dark:text-red-400'
  }
})

const healthBg = computed(() => {
  switch (overallHealth.value) {
    case 'healthy': return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
    case 'degraded': return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
    default: return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
  }
})

const totalQueueJobs = computed(() => {
  if (!status.value?.queues?.data) return { waiting: 0, active: 0, failed: 0 }
  return status.value.queues.data.reduce(
    (acc: any, q: any) => ({
      waiting: acc.waiting + (q.waiting ?? 0),
      active: acc.active + (q.active ?? 0),
      failed: acc.failed + (q.failed ?? 0),
    }),
    { waiting: 0, active: 0, failed: 0 },
  )
})

const deployStatusColor: Record<string, string> = {
  succeeded: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  failed: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  building: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  deploying: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
}

const isKubernetes = computed(() => status.value?.monitoring?.orchestratorType === 'kubernetes')
const installingMetrics = ref(false)
const installLogs = ref<string[]>([])

async function installMetricsServer() {
  installingMetrics.value = true
  installLogs.value = []
  try {
    const result = await api.post<{ success: boolean; logs: string[]; alreadyInstalled?: boolean }>('/settings/orchestrator/install-metrics-server', {})
    installLogs.value = result.logs ?? []
    if (result.success) {
      // Refresh status to pick up the new monitoring state
      await fetchStatus()
    }
  } catch (err: any) {
    installLogs.value = [err?.message ?? 'Failed to install metrics-server']
  } finally {
    installingMetrics.value = false
  }
}

onMounted(() => {
  fetchStatus()
  startAutoRefresh()
})

onUnmounted(() => {
  stopAutoRefresh()
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <Activity class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('super.status.title') }}</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{{ $t('super.status.subtitle') }}</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button
          @click="toggleAutoRefresh"
          :class="[
            'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors',
            autoRefresh
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600',
          ]"
        >
          <span :class="['w-2 h-2 rounded-full', autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-400']"></span>
          {{ $t('super.status.autoRefresh') }} {{ autoRefresh ? $t('super.status.on') : $t('super.status.off') }}
        </button>
        <button
          @click="fetchStatus"
          :disabled="loading"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
        >
          <RefreshCw :class="['w-4 h-4', loading && 'animate-spin']" />
          {{ $t('super.status.refresh') }}
        </button>
      </div>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <div v-if="loading && !status" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <template v-else-if="status">
      <!-- Overall health banner -->
      <div :class="['mb-6 p-4 rounded-lg border flex items-center justify-between', healthBg]">
        <div class="flex items-center gap-3">
          <CheckCircle v-if="overallHealth === 'healthy'" class="w-6 h-6 text-green-600 dark:text-green-400" />
          <AlertTriangle v-else-if="overallHealth === 'degraded'" class="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
          <XCircle v-else class="w-6 h-6 text-red-600 dark:text-red-400" />
          <div>
            <p :class="['text-sm font-semibold', healthColor]">
              {{ overallHealth === 'healthy' ? $t('super.status.systemHealthy') : overallHealth === 'degraded' ? $t('super.status.systemDegraded') : $t('super.status.systemUnhealthy') }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ $t('super.status.response') }}: {{ status.responseTimeMs }}ms | {{ $t('super.status.lastChecked') }}: {{ formatDate(status.timestamp) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Component status cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <!-- API -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <Zap class="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('super.status.api') }}</span>
            </div>
            <span class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-green-500"></span>
              <span class="text-xs font-medium text-green-600 dark:text-green-400">{{ $t('super.status.healthy') }}</span>
            </span>
          </div>
          <div class="space-y-2 text-xs text-gray-600 dark:text-gray-400">
            <div class="flex justify-between">
              <span>{{ $t('super.status.uptime') }}</span>
              <span class="font-medium text-gray-900 dark:text-white">{{ formatUptime(status.api.uptimeSeconds) }}</span>
            </div>
            <div class="flex justify-between">
              <span>{{ $t('super.status.memory') }}</span>
              <span class="font-medium text-gray-900 dark:text-white">{{ status.api.memoryUsageMb }} MB</span>
            </div>
            <div class="flex justify-between">
              <span>{{ $t('super.status.nodejs') }}</span>
              <span class="font-medium text-gray-900 dark:text-white">{{ status.api.nodeVersion }}</span>
            </div>
          </div>
        </div>

        <!-- Valkey -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <Database class="w-4 h-4 text-red-600 dark:text-red-400" />
              <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('super.status.valkey') }}</span>
            </div>
            <span class="flex items-center gap-1.5">
              <span :class="['w-2 h-2 rounded-full', status.valkey.status === 'connected' ? 'bg-green-500' : 'bg-red-500']"></span>
              <span :class="['text-xs font-medium', status.valkey.status === 'connected' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400']">
                {{ status.valkey.status === 'connected' ? $t('super.status.connected') : $t('super.status.disconnected') }}
              </span>
            </span>
          </div>
          <div class="space-y-2 text-xs text-gray-600 dark:text-gray-400">
            <div class="flex justify-between">
              <span>{{ $t('super.status.latency') }}</span>
              <span class="font-medium text-gray-900 dark:text-white">{{ status.valkey.latencyMs !== null ? `${status.valkey.latencyMs}ms` : '--' }}</span>
            </div>
            <div class="flex justify-between">
              <span>{{ $t('super.status.memory') }}</span>
              <span class="font-medium text-gray-900 dark:text-white">{{ status.valkey.memoryUsage ?? '--' }}</span>
            </div>
            <div class="flex justify-between">
              <span>{{ $t('super.status.queues') }}</span>
              <span class="font-medium text-gray-900 dark:text-white">{{ status.queues.available ? $t('super.status.active') : $t('super.status.disabled') }}</span>
            </div>
          </div>
        </div>

        <!-- Docker -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <Container class="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('super.status.dockerSwarm') }}</span>
            </div>
            <span class="flex items-center gap-1.5">
              <span :class="['w-2 h-2 rounded-full', status.docker?.status === 'connected' ? 'bg-green-500' : 'bg-red-500']"></span>
              <span :class="['text-xs font-medium', status.docker?.status === 'connected' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400']">
                {{ status.docker?.status === 'connected' ? $t('super.status.connected') : $t('super.status.disconnected') }}
              </span>
            </span>
          </div>
          <div class="space-y-2 text-xs text-gray-600 dark:text-gray-400">
            <div class="flex justify-between">
              <span>{{ $t('super.status.totalNodes') }}</span>
              <span class="font-medium text-gray-900 dark:text-white">{{ status.docker?.nodes ?? 0 }}</span>
            </div>
            <div class="flex justify-between">
              <span>{{ $t('super.status.managers') }}</span>
              <span class="font-medium text-gray-900 dark:text-white">{{ status.docker?.managers ?? 0 }}</span>
            </div>
            <div class="flex justify-between">
              <span>{{ $t('super.status.workers') }}</span>
              <span class="font-medium text-gray-900 dark:text-white">{{ status.docker?.workers ?? 0 }}</span>
            </div>
          </div>
        </div>

        <!-- Services -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <HardDrive class="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('super.status.services') }}</span>
            </div>
            <span class="text-xs font-medium text-gray-900 dark:text-white">{{ status.services.total }} {{ $t('super.status.total') }}</span>
          </div>
          <div class="space-y-2 text-xs text-gray-600 dark:text-gray-400">
            <div v-for="(count, st) in status.services.byStatus" :key="st" class="flex justify-between">
              <span class="capitalize">{{ st }}</span>
              <span class="font-medium text-gray-900 dark:text-white">{{ count }}</span>
            </div>
            <div v-if="Object.keys(status.services.byStatus).length === 0" class="text-center py-1">
              <span class="text-gray-400 dark:text-gray-500">{{ $t('super.status.noServices') }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Monitoring (Kubernetes only) -->
      <div v-if="isKubernetes" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-6">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <BarChart3 class="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">Monitoring</h2>
          <span class="ml-auto text-xs text-gray-400 dark:text-gray-500">Kubernetes</span>
        </div>
        <div class="p-5">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <!-- Metrics Server -->
            <div class="flex items-center justify-between px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-750">
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">Metrics Server</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">CPU & memory metrics</p>
              </div>
              <div class="flex items-center gap-2">
                <template v-if="status.monitoring?.metricsServer?.healthy">
                  <span class="w-2 h-2 rounded-full bg-green-500"></span>
                  <span class="text-xs font-medium text-green-600 dark:text-green-400">Healthy</span>
                </template>
                <template v-else-if="status.monitoring?.metricsServer?.installed">
                  <span class="w-2 h-2 rounded-full bg-yellow-500"></span>
                  <span class="text-xs font-medium text-yellow-600 dark:text-yellow-400">Installed</span>
                </template>
                <template v-else>
                  <span class="w-2 h-2 rounded-full bg-red-500"></span>
                  <span class="text-xs font-medium text-red-600 dark:text-red-400">Not Installed</span>
                  <button
                    @click="installMetricsServer"
                    :disabled="installingMetrics"
                    class="ml-2 flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
                  >
                    <CompassSpinner v-if="installingMetrics" size="w-3 h-3" />
                    <Download v-else class="w-3 h-3" />
                    Install
                  </button>
                </template>
              </div>
            </div>

            <!-- Kubelet Stats -->
            <div class="flex items-center justify-between px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-750">
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">Kubelet Stats</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">Network & disk I/O</p>
              </div>
              <div class="flex items-center gap-2">
                <template v-if="status.monitoring?.kubeletStats?.available">
                  <span class="w-2 h-2 rounded-full bg-green-500"></span>
                  <span class="text-xs font-medium text-green-600 dark:text-green-400">Available</span>
                </template>
                <template v-else>
                  <span class="w-2 h-2 rounded-full bg-red-500"></span>
                  <span class="text-xs font-medium text-red-600 dark:text-red-400">Unavailable</span>
                </template>
              </div>
            </div>
          </div>

          <!-- Install logs -->
          <div v-if="installLogs.length > 0" class="mt-4 p-3 bg-gray-900 rounded-lg text-xs text-gray-300 font-mono max-h-40 overflow-y-auto">
            <p v-for="(log, i) in installLogs" :key="i">{{ log }}</p>
          </div>
        </div>
      </div>

      <!-- Nodes + Queues row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <!-- Node health -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Server class="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('super.status.nodeHealth') }}</h2>
          </div>
          <div class="p-4">
            <div v-if="status.nodes.length === 0" class="text-center py-6">
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('super.status.noNodes') }}</p>
            </div>
            <div v-else class="space-y-3">
              <div
                v-for="node in status.nodes"
                :key="node.id"
                class="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-750"
              >
                <div class="flex items-center gap-3">
                  <span
                    :class="['w-2.5 h-2.5 rounded-full shrink-0', node.healthy ? 'bg-green-500' : 'bg-red-500']"
                  ></span>
                  <div>
                    <p class="text-sm font-medium text-gray-900 dark:text-white">{{ node.hostname }}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">{{ node.ipAddress }} &middot; {{ node.role }}</p>
                  </div>
                </div>
                <div class="text-right">
                  <p :class="['text-xs font-medium', node.healthy ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400']">
                    {{ node.status }}
                  </p>
                  <p class="text-[10px] text-gray-400 dark:text-gray-500">{{ timeSince(node.lastHeartbeat) }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Queue stats -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Cpu class="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('super.status.jobQueues') }}</h2>
            <span v-if="!status.queues.available" class="ml-auto text-xs text-yellow-600 dark:text-yellow-400 font-medium">{{ $t('super.status.disabled') }}</span>
          </div>
          <div class="p-4">
            <div v-if="!status.queues.available" class="text-center py-6">
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('super.status.queuesDisabled') }}</p>
            </div>
            <div v-else-if="status.queues.data" class="space-y-4">
              <!-- Summary bar -->
              <div class="flex items-center gap-4 px-3 py-2 bg-gray-50 dark:bg-gray-750 rounded-lg text-xs">
                <span class="text-gray-500 dark:text-gray-400">Total:</span>
                <span class="flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-yellow-500"></span>
                  <span class="font-medium text-gray-900 dark:text-white">{{ totalQueueJobs.waiting }} {{ $t('super.status.waiting').toLowerCase() }}</span>
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                  <span class="font-medium text-gray-900 dark:text-white">{{ totalQueueJobs.active }} {{ $t('super.status.active').toLowerCase() }}</span>
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-red-500"></span>
                  <span class="font-medium text-gray-900 dark:text-white">{{ totalQueueJobs.failed }} {{ $t('super.status.failed').toLowerCase() }}</span>
                </span>
              </div>

              <!-- Per-queue breakdown -->
              <div v-for="q in status.queues.data" :key="q.name" class="px-3">
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-sm font-medium text-gray-900 dark:text-white capitalize">{{ q.name }}</span>
                </div>
                <div class="grid grid-cols-5 gap-2 text-xs">
                  <div class="text-center">
                    <p class="font-medium text-gray-900 dark:text-white">{{ q.waiting }}</p>
                    <p class="text-gray-400">{{ $t('super.status.waiting') }}</p>
                  </div>
                  <div class="text-center">
                    <p class="font-medium text-gray-900 dark:text-white">{{ q.active }}</p>
                    <p class="text-gray-400">{{ $t('super.status.active') }}</p>
                  </div>
                  <div class="text-center">
                    <p class="font-medium text-gray-900 dark:text-white">{{ q.delayed }}</p>
                    <p class="text-gray-400">{{ $t('super.status.delayed') }}</p>
                  </div>
                  <div class="text-center">
                    <p class="font-medium text-green-600 dark:text-green-400">{{ q.completed }}</p>
                    <p class="text-gray-400">{{ $t('super.status.done') }}</p>
                  </div>
                  <div class="text-center">
                    <p :class="['font-medium', q.failed > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white']">{{ q.failed }}</p>
                    <p class="text-gray-400">{{ $t('super.status.failed') }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent deployments -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <GitCommit class="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('super.status.recentDeployments') }}</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.status.service') }}</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.status.status') }}</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.status.commit') }}</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.status.time') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-if="status.recentDeployments.length === 0">
                <td colspan="4" class="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  {{ $t('super.status.noDeployments') }}
                </td>
              </tr>
              <tr
                v-for="dep in status.recentDeployments"
                :key="dep.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
              >
                <td class="px-6 py-3 text-sm font-medium text-gray-900 dark:text-white">{{ dep.serviceName }}</td>
                <td class="px-6 py-3 text-sm">
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      deployStatusColor[dep.status] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                    ]"
                  >
                    {{ dep.status }}
                  </span>
                </td>
                <td class="px-6 py-3 text-sm font-mono text-gray-600 dark:text-gray-400">
                  {{ dep.commitSha ? dep.commitSha.slice(0, 7) : '--' }}
                </td>
                <td class="px-6 py-3 text-sm text-gray-500 dark:text-gray-400">{{ timeSince(dep.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
