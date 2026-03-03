<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Server, ArrowLeft, Cpu, MemoryStick, HardDrive, Container,
  SquareTerminal, Activity, RefreshCw, Loader2, MapPin,
  Play, Pause, Trash2, Network, Crown, Shield
} from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useTerminal } from '@/composables/useTerminal'
import { useI18n } from 'vue-i18n'
import '@xterm/xterm/css/xterm.css'

const route = useRoute()
const router = useRouter()
const api = useApi()
const { t } = useI18n()
const nodeId = route.params.id as string

// Tab system
const activeTab = ref('overview')
const tabs = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'containers', label: 'Containers', icon: Container },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
]

// Node data
const node = ref<any>(null)
const loading = ref(true)
const error = ref('')

// Latest metrics
const latestMetrics = ref<any>(null)

// Containers
const containers = ref<any[]>([])
const containersSummary = ref({ total: 0, running: 0, stopped: 0 })
const containersLoading = ref(false)

// Node terminal
const {
  createTerminal: createNodeTerminal,
  connect: nodeTerminalConnect,
  disconnect: nodeTerminalDisconnect,
  connectionState: nodeTerminalState,
  refit: nodeTerminalRefit,
} = useTerminal()
const nodeTerminalEl = ref<HTMLElement | null>(null)
const nodeTerminalCreated = ref(false)

// Container terminal (inline on containers tab)
const {
  createTerminal: createContainerTerminal,
  connect: containerTerminalConnect,
  disconnect: containerTerminalDisconnect,
  connectionState: containerTerminalState,
  refit: containerTerminalRefit,
} = useTerminal()
const containerTerminalEl = ref<HTMLElement | null>(null)
const containerTerminalCreated = ref(false)
const selectedContainer = ref<any>(null)

// Polling
let containersInterval: ReturnType<typeof setInterval> | null = null

// ── Fetch node details ──
async function fetchNode() {
  loading.value = true
  try {
    node.value = await api.get<any>(`/nodes/${nodeId}`)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to load node'
  } finally {
    loading.value = false
  }
}

// ── Fetch latest metrics ──
async function fetchMetrics() {
  try {
    const data = await api.get<any>(`/nodes/${nodeId}/metrics?hours=1`)
    if (Array.isArray(data) && data.length > 0) {
      latestMetrics.value = data[data.length - 1]
    }
  } catch { /* metrics unavailable */ }
}

// ── Fetch containers ──
async function fetchContainers() {
  containersLoading.value = true
  try {
    const data = await api.get<any>(`/nodes/${nodeId}/containers?stats=true`)
    containers.value = data?.containers ?? []
    containersSummary.value = data?.summary ?? { total: 0, running: 0, stopped: 0 }
  } catch {
    containers.value = []
  } finally {
    containersLoading.value = false
  }
}

// ── Polling ──
function startContainersPolling() {
  stopContainersPolling()
  containersInterval = setInterval(fetchContainers, 15_000)
}

function stopContainersPolling() {
  if (containersInterval) {
    clearInterval(containersInterval)
    containersInterval = null
  }
}

// ── Tab switching ──
function onTabChange(tabId: string) {
  activeTab.value = tabId

  if (tabId === 'containers') {
    fetchContainers()
    startContainersPolling()
  } else {
    stopContainersPolling()
  }

  if (tabId === 'terminal') {
    nextTick(() => initNodeTerminal())
  }
}

// ── Node terminal ──
function initNodeTerminal() {
  if (nodeTerminalCreated.value) {
    nodeTerminalRefit()
    return
  }
  if (!nodeTerminalEl.value) return

  createNodeTerminal(nodeTerminalEl.value)
  nodeTerminalCreated.value = true

  // Find agent container for this node
  const agentContainer = containers.value.find(
    (c) => c.dockerServiceName?.includes('agent') && c.state === 'running' && c.containerId,
  )

  if (agentContainer) {
    nodeTerminalConnect(
      '',
      undefined,
      undefined,
      `/api/v1/terminal/admin/${agentContainer.containerId}?nodeId=${agentContainer.nodeId}`,
    )
  } else {
    // Fetch containers first if not yet loaded, then connect
    fetchContainers().then(() => {
      const agent = containers.value.find(
        (c) => c.dockerServiceName?.includes('agent') && c.state === 'running' && c.containerId,
      )
      if (agent) {
        nodeTerminalConnect(
          '',
          undefined,
          undefined,
          `/api/v1/terminal/admin/${agent.containerId}?nodeId=${agent.nodeId}`,
        )
      }
    })
  }
}

// ── Container terminal ──
function openContainerTerminal(container: any) {
  if (selectedContainer.value?.containerId === container.containerId) {
    // Toggle off
    selectedContainer.value = null
    containerTerminalDisconnect()
    return
  }

  selectedContainer.value = container

  nextTick(() => {
    if (!containerTerminalCreated.value && containerTerminalEl.value) {
      createContainerTerminal(containerTerminalEl.value)
      containerTerminalCreated.value = true
    }

    containerTerminalConnect(
      '',
      undefined,
      undefined,
      `/api/v1/terminal/admin/${container.containerId}?nodeId=${container.nodeId}`,
    )
  })
}

// ── Node actions ──
async function drainNode() {
  if (!confirm('Drain this node? Running tasks will be moved to other nodes.')) return
  try {
    await api.post(`/nodes/${nodeId}/drain`, {})
    await fetchNode()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to drain node'
  }
}

async function activateNode() {
  try {
    await api.post(`/nodes/${nodeId}/activate`, {})
    await fetchNode()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to activate node'
  }
}

async function removeNode() {
  if (!confirm('Remove this node from the cluster? This cannot be undone.')) return
  try {
    await api.del(`/nodes/${nodeId}`)
    router.push({ name: 'super-nodes' })
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to remove node'
  }
}

// ── Computed ──
const healthStatus = computed(() => {
  if (!node.value?.lastHeartbeat) return 'red'
  const elapsed = Date.now() - new Date(node.value.lastHeartbeat).getTime()
  if (elapsed <= 60_000) return 'green'
  if (elapsed <= 300_000) return 'yellow'
  return 'red'
})

const memoryPercent = computed(() => {
  if (!latestMetrics.value?.memTotal) return 0
  return Math.round((latestMetrics.value.memUsed / latestMetrics.value.memTotal) * 100)
})

const diskPercent = computed(() => {
  if (!latestMetrics.value?.diskTotal) return 0
  return Math.round((latestMetrics.value.diskUsed / latestMetrics.value.diskTotal) * 100)
})

const dockerVersion = computed(() => {
  return node.value?.dockerInfo?.Description?.Engine?.EngineVersion ?? null
})

const osArch = computed(() => {
  const desc = node.value?.dockerInfo?.Description
  if (!desc?.Platform) return null
  return `${desc.Platform.OS}/${desc.Platform.Architecture}`
})

const managerStatus = computed(() => {
  const ms = node.value?.dockerInfo?.ManagerStatus
  if (!ms) return null
  return ms.Leader ? 'Leader' : ms.Reachability ?? 'Reachable'
})

const nodeLabels = computed(() => {
  const spec = node.value?.dockerInfo?.Spec
  return spec?.Labels ?? {}
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatBytesShort(bytes: number): string {
  if (bytes === 0) return '0'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(0)} MB`
  const kb = bytes / 1024
  return `${kb.toFixed(0)} KB`
}

// ── Lifecycle ──
onMounted(async () => {
  await fetchNode()
  await Promise.allSettled([fetchMetrics(), fetchContainers()])
})

onUnmounted(() => {
  stopContainersPolling()
  nodeTerminalDisconnect()
  containerTerminalDisconnect()
})
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <template v-else-if="node">
      <!-- Header -->
      <div class="mb-6">
        <button
          @click="router.push({ name: 'super-nodes' })"
          class="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors mb-4"
        >
          <ArrowLeft class="w-4 h-4" />
          Back to Nodes
        </button>

        <div class="flex flex-wrap items-center justify-between gap-y-3">
          <div class="flex items-center gap-3">
            <Server class="w-7 h-7 text-primary-600 dark:text-primary-400" />
            <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ node.hostname }}</h1>
            <span
              :class="['w-2.5 h-2.5 rounded-full shrink-0', {
                'bg-green-500': healthStatus === 'green',
                'bg-yellow-500': healthStatus === 'yellow',
                'bg-red-500': healthStatus === 'red',
              }]"
              :title="`Heartbeat: ${node.lastHeartbeat ? new Date(node.lastHeartbeat).toLocaleString() : 'never'}`"
            ></span>
            <span
              :class="[
                'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                node.status === 'active' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                node.status === 'draining' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' :
                'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
              ]"
            >
              {{ node.status }}
            </span>
            <span
              :class="[
                'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium',
                node.role === 'manager'
                  ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              ]"
            >
              <Crown v-if="node.role === 'manager'" class="w-3 h-3" />
              {{ node.role }}
            </span>
            <span class="text-sm text-gray-500 dark:text-gray-400 font-mono">{{ node.ipAddress }}</span>
          </div>

          <div class="flex items-center gap-2">
            <button
              v-if="node.status === 'active'"
              @click="drainNode"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 text-sm font-medium transition-colors"
            >
              <Pause class="w-4 h-4" />
              Drain
            </button>
            <button
              v-if="node.status === 'draining'"
              @click="activateNode"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 text-sm font-medium transition-colors"
            >
              <Play class="w-4 h-4" />
              Activate
            </button>
            <button
              @click="removeNode"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors"
            >
              <Trash2 class="w-4 h-4" />
              Remove
            </button>
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>

      <!-- Tabs -->
      <div class="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav class="flex gap-6">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            @click="onTabChange(tab.id)"
            :class="[
              'flex items-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.id
                ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
            ]"
          >
            <component :is="tab.icon" class="w-4 h-4" />
            {{ tab.label }}
            <span v-if="tab.id === 'containers' && containersSummary.running > 0" class="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
              {{ containersSummary.running }}
            </span>
          </button>
        </nav>
      </div>

      <!-- Overview Tab -->
      <div v-if="activeTab === 'overview'" class="space-y-6">
        <!-- Resource gauges -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <!-- CPU -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <div class="flex items-center gap-2 mb-3">
              <Cpu class="w-4 h-4 text-blue-500" />
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">CPU</span>
            </div>
            <div class="text-2xl font-bold text-gray-900 dark:text-white">
              {{ latestMetrics?.cpuCount ?? '--' }}
              <span class="text-sm font-normal text-gray-500 dark:text-gray-400">cores</span>
            </div>
          </div>

          <!-- Memory -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <MemoryStick class="w-4 h-4 text-purple-500" />
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Memory</span>
              </div>
              <span class="text-xs text-gray-500 dark:text-gray-400">{{ memoryPercent }}%</span>
            </div>
            <div class="h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
              <div
                class="h-full rounded-full transition-all"
                :class="memoryPercent > 80 ? 'bg-red-500' : memoryPercent > 50 ? 'bg-yellow-500' : 'bg-purple-500'"
                :style="{ width: `${memoryPercent}%` }"
              ></div>
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              <template v-if="latestMetrics?.memTotal">
                {{ formatBytesShort(latestMetrics.memUsed) }} / {{ formatBytesShort(latestMetrics.memTotal) }}
              </template>
              <template v-else>--</template>
            </div>
          </div>

          <!-- Disk -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <HardDrive class="w-4 h-4 text-green-500" />
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Disk</span>
              </div>
              <span class="text-xs text-gray-500 dark:text-gray-400">{{ diskPercent }}%</span>
            </div>
            <div class="h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
              <div
                class="h-full rounded-full transition-all"
                :class="diskPercent > 80 ? 'bg-red-500' : diskPercent > 50 ? 'bg-yellow-500' : 'bg-green-500'"
                :style="{ width: `${diskPercent}%` }"
              ></div>
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              <template v-if="latestMetrics?.diskTotal">
                {{ formatBytesShort(latestMetrics.diskUsed) }} / {{ formatBytesShort(latestMetrics.diskTotal) }}
              </template>
              <template v-else>--</template>
            </div>
          </div>
        </div>

        <!-- Node info card -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Node Information</h3>
          <dl class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Hostname</dt>
              <dd class="font-medium text-gray-900 dark:text-white mt-0.5">{{ node.hostname }}</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">IP Address</dt>
              <dd class="font-mono text-gray-900 dark:text-white mt-0.5">{{ node.ipAddress }}</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Role</dt>
              <dd class="text-gray-900 dark:text-white mt-0.5 capitalize">{{ node.role }}</dd>
            </div>
            <div v-if="osArch">
              <dt class="text-gray-500 dark:text-gray-400">OS / Architecture</dt>
              <dd class="text-gray-900 dark:text-white mt-0.5">{{ osArch }}</dd>
            </div>
            <div v-if="dockerVersion">
              <dt class="text-gray-500 dark:text-gray-400">Docker Version</dt>
              <dd class="text-gray-900 dark:text-white mt-0.5">{{ dockerVersion }}</dd>
            </div>
            <div v-if="managerStatus">
              <dt class="text-gray-500 dark:text-gray-400">Manager Status</dt>
              <dd class="mt-0.5">
                <span
                  :class="[
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                    managerStatus === 'Leader'
                      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                      : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  ]"
                >
                  <Crown v-if="managerStatus === 'Leader'" class="w-3 h-3" />
                  {{ managerStatus }}
                </span>
              </dd>
            </div>
            <div v-if="node.location">
              <dt class="text-gray-500 dark:text-gray-400">Region</dt>
              <dd class="mt-0.5">
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                  <MapPin class="w-3 h-3" />
                  {{ node.location }}
                </span>
              </dd>
            </div>
            <div v-if="node.dockerNodeId">
              <dt class="text-gray-500 dark:text-gray-400">Swarm Node ID</dt>
              <dd class="font-mono text-xs text-gray-700 dark:text-gray-300 mt-0.5">{{ node.dockerNodeId }}</dd>
            </div>
            <div v-if="latestMetrics?.containerCount != null">
              <dt class="text-gray-500 dark:text-gray-400">Containers</dt>
              <dd class="text-gray-900 dark:text-white mt-0.5">{{ latestMetrics.containerCount }}</dd>
            </div>
            <div v-if="latestMetrics?.diskType && latestMetrics.diskType !== 'unknown'">
              <dt class="text-gray-500 dark:text-gray-400">Disk Type</dt>
              <dd class="text-gray-900 dark:text-white mt-0.5 uppercase">{{ latestMetrics.diskType }}</dd>
            </div>
          </dl>

          <!-- Labels -->
          <div v-if="Object.keys(nodeLabels).length > 0" class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Labels</h4>
            <div class="flex flex-wrap gap-2">
              <span
                v-for="(value, key) in nodeLabels"
                :key="key"
                class="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
              >
                {{ key }}={{ value }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Containers Tab -->
      <div v-if="activeTab === 'containers'" class="space-y-4">
        <!-- Summary & refresh -->
        <div class="flex items-center justify-between">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            <span class="font-medium text-gray-900 dark:text-white">{{ containersSummary.running }}</span> running of
            <span class="font-medium text-gray-900 dark:text-white">{{ containersSummary.total }}</span> total
          </p>
          <button
            @click="fetchContainers"
            :disabled="containersLoading"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
          >
            <RefreshCw :class="['w-3.5 h-3.5', containersLoading && 'animate-spin']" />
            Refresh
          </button>
        </div>

        <!-- Containers table -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div v-if="containersLoading && containers.length === 0" class="flex items-center justify-center py-12">
            <Loader2 class="w-6 h-6 text-gray-400 animate-spin" />
          </div>
          <div v-else-if="containers.length === 0" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
            No containers running on this node.
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700">
                  <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Container</th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Service</th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Image</th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">State</th>
                  <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">CPU</th>
                  <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Memory</th>
                  <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Net I/O</th>
                  <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr
                  v-for="container in containers"
                  :key="container.taskId"
                  class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                >
                  <td class="px-4 py-3 text-sm font-mono text-gray-700 dark:text-gray-300">
                    {{ container.containerId?.slice(0, 12) || container.taskId }}
                  </td>
                  <td class="px-4 py-3 text-sm">
                    <router-link
                      v-if="container.fleetServiceId"
                      :to="{ name: 'service-detail', params: { id: container.fleetServiceId } }"
                      class="text-primary-600 dark:text-primary-400 hover:underline font-medium"
                    >
                      {{ container.fleetServiceName }}
                    </router-link>
                    <span v-else class="text-gray-700 dark:text-gray-300">{{ container.dockerServiceName }}</span>
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 max-w-[200px] truncate" :title="container.image">
                    {{ container.image?.split('/').pop() }}
                  </td>
                  <td class="px-4 py-3 text-sm">
                    <span
                      :class="[
                        'inline-flex items-center gap-1',
                        container.state === 'running' ? 'text-green-600 dark:text-green-400' :
                        container.state === 'starting' || container.state === 'ready' ? 'text-yellow-600 dark:text-yellow-400' :
                        'text-red-600 dark:text-red-400'
                      ]"
                    >
                      <span
                        :class="[
                          'w-1.5 h-1.5 rounded-full',
                          container.state === 'running' ? 'bg-green-500' :
                          container.state === 'starting' || container.state === 'ready' ? 'bg-yellow-500' :
                          'bg-red-500'
                        ]"
                      ></span>
                      {{ container.state }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-sm text-right font-mono text-gray-700 dark:text-gray-300">
                    {{ container.stats?.cpuPercent != null ? `${container.stats.cpuPercent.toFixed(1)}%` : '--' }}
                  </td>
                  <td class="px-4 py-3 text-sm text-right">
                    <template v-if="container.stats?.memoryUsageBytes != null">
                      <span class="font-mono text-gray-700 dark:text-gray-300">{{ formatBytesShort(container.stats.memoryUsageBytes) }}</span>
                      <span v-if="container.stats.memoryLimitBytes" class="text-gray-400 dark:text-gray-500 text-xs"> / {{ formatBytesShort(container.stats.memoryLimitBytes) }}</span>
                    </template>
                    <span v-else class="text-gray-400">--</span>
                  </td>
                  <td class="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400 font-mono text-xs">
                    <template v-if="container.stats?.networkRxBytes != null">
                      {{ formatBytesShort(container.stats.networkRxBytes) }} / {{ formatBytesShort(container.stats.networkTxBytes) }}
                    </template>
                    <span v-else>--</span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <button
                      v-if="container.state === 'running' && container.containerId"
                      @click="openContainerTerminal(container)"
                      :class="[
                        'p-1.5 rounded-lg transition-colors',
                        selectedContainer?.containerId === container.containerId
                          ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                          : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      ]"
                      title="Open terminal"
                    >
                      <SquareTerminal class="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Inline container terminal -->
        <div v-if="selectedContainer" class="bg-[#1a1b26] rounded-xl border border-gray-700 shadow-sm overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-red-500"></span>
              <span class="w-3 h-3 rounded-full bg-yellow-500"></span>
              <span class="w-3 h-3 rounded-full bg-green-500"></span>
              <span class="ml-2 text-xs text-gray-400">Terminal - {{ selectedContainer.dockerServiceName }} ({{ selectedContainer.containerId?.slice(0, 12) }})</span>
            </div>
            <div class="flex items-center gap-3">
              <span
                :class="[
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                  containerTerminalState === 'connected'
                    ? 'bg-green-900/40 text-green-400'
                    : containerTerminalState === 'connecting' || containerTerminalState === 'reconnecting'
                      ? 'bg-yellow-900/40 text-yellow-400'
                      : 'bg-gray-700 text-gray-400'
                ]"
              >
                <span :class="['w-1.5 h-1.5 rounded-full', containerTerminalState === 'connected' ? 'bg-green-400' : containerTerminalState === 'connecting' || containerTerminalState === 'reconnecting' ? 'bg-yellow-400 animate-pulse' : 'bg-gray-500']"></span>
                {{ containerTerminalState === 'connected' ? 'Connected' : containerTerminalState === 'connecting' ? 'Connecting...' : containerTerminalState === 'reconnecting' ? 'Reconnecting...' : 'Disconnected' }}
              </span>
              <button
                @click="selectedContainer = null; containerTerminalDisconnect()"
                class="text-gray-500 hover:text-gray-300 transition-colors"
              >
                &times;
              </button>
            </div>
          </div>
          <div class="h-[350px] pt-2 px-2 pb-4 bg-[#1a1b26]">
            <div ref="containerTerminalEl" class="h-full"></div>
          </div>
        </div>
      </div>

      <!-- Terminal Tab (v-show to keep xterm canvas alive across tab switches) -->
      <div v-show="activeTab === 'terminal'">
        <div class="bg-[#1a1b26] rounded-xl border border-gray-700 shadow-sm overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-red-500"></span>
              <span class="w-3 h-3 rounded-full bg-yellow-500"></span>
              <span class="w-3 h-3 rounded-full bg-green-500"></span>
              <span class="ml-2 text-xs text-gray-400">Terminal - {{ node.hostname }} (Fleet Agent)</span>
            </div>
            <span
              :class="[
                'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                nodeTerminalState === 'connected'
                  ? 'bg-green-900/40 text-green-400'
                  : nodeTerminalState === 'connecting' || nodeTerminalState === 'reconnecting'
                    ? 'bg-yellow-900/40 text-yellow-400'
                    : 'bg-gray-700 text-gray-400'
              ]"
            >
              <span :class="['w-1.5 h-1.5 rounded-full', nodeTerminalState === 'connected' ? 'bg-green-400' : nodeTerminalState === 'connecting' || nodeTerminalState === 'reconnecting' ? 'bg-yellow-400 animate-pulse' : 'bg-gray-500']"></span>
              {{ nodeTerminalState === 'connected' ? 'Connected' : nodeTerminalState === 'connecting' ? 'Connecting...' : nodeTerminalState === 'reconnecting' ? 'Reconnecting...' : 'Disconnected' }}
            </span>
          </div>
          <div class="h-[500px] pt-2 px-2 pb-4 bg-[#1a1b26]">
            <div ref="nodeTerminalEl" class="h-full"></div>
          </div>
        </div>
      </div>
    </template>

    <!-- Node not found -->
    <div v-else class="text-center py-20">
      <Server class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Node not found</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">{{ error || 'The requested node could not be found.' }}</p>
      <button
        @click="router.push({ name: 'super-nodes' })"
        class="text-sm text-primary-600 dark:text-primary-400 hover:underline"
      >
        Back to Nodes
      </button>
    </div>
  </div>
</template>
