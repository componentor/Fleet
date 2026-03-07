<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Cpu, MemoryStick, HardDrive, Server, Container, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import ResourceGauge from '@/components/ResourceGauge.vue'
import { useApi } from '@/composables/useApi'

const api = useApi()

// ── Types ────────────────────────────────────────────────────────────────

interface NodeResource {
  id: string
  hostname: string
  ipAddress: string
  role: string
  status: string
  isOnline: boolean
  lastHeartbeat: string | null
  diskType: string
  cpu: { cores: number }
  memory: { totalMb: number; usedMb: number; freeMb: number; usedPercent: number }
  disk: { totalGb: number; usedGb: number; freeGb: number; usedPercent: number }
  containers: number
}

interface ClusterSummary {
  cpu: { totalCores: number; allocatedMilli: number; allocatedCores: number; allocatedPercent: number }
  memory: { totalMb: number; usedMb: number; allocatedMb: number; usedPercent: number; allocatedPercent: number; freeMb: number }
  disk: { totalGb: number; usedGb: number; freeGb: number; usedPercent: number }
  containers: { running: number; allocated: number }
  nodeCount: number
  onlineNodes: number
}

interface ResourceData {
  cluster: ClusterSummary
  nodes: NodeResource[]
}

// ── State ────────────────────────────────────────────────────────────────

const data = ref<ResourceData | null>(null)
const loading = ref(true)
const error = ref('')

async function fetchResources() {
  loading.value = true
  error.value = ''
  try {
    data.value = await api.get<ResourceData>('/nodes/resources')
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to load resources'
    data.value = null
  } finally {
    loading.value = false
  }
}

onMounted(fetchResources)

// ── Helpers ──────────────────────────────────────────────────────────────

function formatGb(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`
  return `${gb.toFixed(1)} GB`
}

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}

function statusColor(pct: number): string {
  if (pct >= 90) return 'text-red-600 dark:text-red-400'
  if (pct >= 70) return 'text-amber-600 dark:text-amber-400'
  return 'text-green-600 dark:text-green-400'
}

function statusBg(pct: number): string {
  if (pct >= 90) return 'bg-red-500'
  if (pct >= 70) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function statusBgLight(pct: number): string {
  if (pct >= 90) return 'bg-red-100 dark:bg-red-900/20'
  if (pct >= 70) return 'bg-amber-100 dark:bg-amber-900/20'
  return 'bg-emerald-100 dark:bg-emerald-900/20'
}

const warnings = computed(() => {
  if (!data.value) return []
  const w: Array<{ severity: 'critical' | 'warning'; message: string }> = []
  const c = data.value.cluster

  if (c.disk.usedPercent >= 90) w.push({ severity: 'critical', message: `Disk usage at ${c.disk.usedPercent}% — only ${formatGb(c.disk.freeGb)} free across cluster` })
  else if (c.disk.usedPercent >= 75) w.push({ severity: 'warning', message: `Disk usage at ${c.disk.usedPercent}% — ${formatGb(c.disk.freeGb)} free` })

  if (c.memory.usedPercent >= 90) w.push({ severity: 'critical', message: `Memory usage at ${c.memory.usedPercent}% — only ${formatMb(c.memory.freeMb)} free` })
  else if (c.memory.usedPercent >= 75) w.push({ severity: 'warning', message: `Memory usage at ${c.memory.usedPercent}% — consider adding nodes` })

  if (c.cpu.allocatedPercent >= 90) w.push({ severity: 'critical', message: `CPU allocation at ${c.cpu.allocatedPercent}% — ${c.cpu.allocatedCores}/${c.cpu.totalCores} cores allocated` })
  else if (c.cpu.allocatedPercent >= 75) w.push({ severity: 'warning', message: `CPU allocation at ${c.cpu.allocatedPercent}% — nearing capacity` })

  if (c.memory.allocatedPercent >= 90) w.push({ severity: 'critical', message: `Memory allocation at ${c.memory.allocatedPercent}% — services may not scale` })
  else if (c.memory.allocatedPercent >= 75) w.push({ severity: 'warning', message: `Memory allocation at ${c.memory.allocatedPercent}% — nearing capacity` })

  const offlineNodes = data.value.nodes.filter(n => !n.isOnline)
  if (offlineNodes.length > 0) w.push({ severity: 'critical', message: `${offlineNodes.length} node${offlineNodes.length > 1 ? 's' : ''} offline: ${offlineNodes.map(n => n.hostname).join(', ')}` })

  return w
})

const sortedNodes = computed(() => {
  if (!data.value) return []
  return [...data.value.nodes].sort((a, b) => {
    // Online first, then by hostname
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1
    return a.hostname.localeCompare(b.hostname)
  })
})
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Cluster Resources</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Available, allocated, and used resources across all nodes</p>
      </div>
      <button
        @click="fetchResources"
        :disabled="loading"
        class="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
      >
        <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />
        Refresh
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading && !data" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/50 rounded-xl p-6 text-center">
      <p class="text-red-700 dark:text-red-400">{{ error }}</p>
    </div>

    <template v-else-if="data">
      <!-- Warnings -->
      <div v-if="warnings.length > 0" class="space-y-2">
        <div
          v-for="(w, i) in warnings" :key="i"
          :class="[
            'flex items-center gap-3 px-4 py-3 rounded-xl border',
            w.severity === 'critical'
              ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/50'
              : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/50'
          ]"
        >
          <AlertTriangle :class="['w-5 h-5 shrink-0', w.severity === 'critical' ? 'text-red-500' : 'text-amber-500']" />
          <p :class="['text-sm font-medium', w.severity === 'critical' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400']">{{ w.message }}</p>
        </div>
      </div>

      <!-- Cluster Overview Gauges -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-white mb-6">Cluster Overview</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6">
          <ResourceGauge
            label="CPU Used"
            :value="data.cluster.cpu.allocatedPercent"
            :icon="Cpu"
            :detail="`${data.cluster.cpu.allocatedCores} / ${data.cluster.cpu.totalCores} cores`"
          />
          <ResourceGauge
            label="Memory Used"
            :value="data.cluster.memory.usedPercent"
            :icon="MemoryStick"
            :detail="`${formatMb(data.cluster.memory.usedMb)} / ${formatMb(data.cluster.memory.totalMb)}`"
          />
          <ResourceGauge
            label="Memory Allocated"
            :value="data.cluster.memory.allocatedPercent"
            :icon="MemoryStick"
            :detail="`${formatMb(data.cluster.memory.allocatedMb)} reserved`"
          />
          <ResourceGauge
            label="Disk Used"
            :value="data.cluster.disk.usedPercent"
            :icon="HardDrive"
            :detail="`${formatGb(data.cluster.disk.usedGb)} / ${formatGb(data.cluster.disk.totalGb)}`"
          />
          <ResourceGauge
            label="Nodes Online"
            :value="data.cluster.nodeCount > 0 ? Math.round((data.cluster.onlineNodes / data.cluster.nodeCount) * 100) : 0"
            :icon="Server"
            :high-is-good="true"
            :detail="`${data.cluster.onlineNodes} / ${data.cluster.nodeCount}`"
          />
          <ResourceGauge
            label="Containers"
            :value="0"
            :icon="Container"
            :detail="`${data.cluster.containers.running} running`"
          />
        </div>
      </div>

      <!-- Resource Bars (visual breakdown) -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- CPU Bar -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <Cpu class="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">CPU</h3>
            </div>
            <span :class="['text-sm font-bold tabular-nums', statusColor(data.cluster.cpu.allocatedPercent)]">
              {{ data.cluster.cpu.allocatedPercent }}% allocated
            </span>
          </div>
          <div class="h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
            <div :class="['h-full rounded-full transition-all duration-500', statusBg(data.cluster.cpu.allocatedPercent)]" :style="{ width: `${Math.min(data.cluster.cpu.allocatedPercent, 100)}%` }" />
          </div>
          <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{{ data.cluster.cpu.allocatedCores }} cores allocated</span>
            <span>{{ data.cluster.cpu.totalCores }} cores total</span>
          </div>
        </div>

        <!-- Memory Bar -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <MemoryStick class="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Memory</h3>
            </div>
            <span :class="['text-sm font-bold tabular-nums', statusColor(data.cluster.memory.usedPercent)]">
              {{ data.cluster.memory.usedPercent }}% used
            </span>
          </div>
          <div class="h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-2 relative">
            <!-- Actually used -->
            <div :class="['h-full rounded-full transition-all duration-500 absolute inset-y-0 left-0', statusBg(data.cluster.memory.usedPercent)]" :style="{ width: `${Math.min(data.cluster.memory.usedPercent, 100)}%` }" />
            <!-- Allocated overlay (lighter, behind used) -->
            <div class="h-full rounded-full transition-all duration-500 absolute inset-y-0 left-0 opacity-30 bg-blue-500" :style="{ width: `${Math.min(data.cluster.memory.allocatedPercent, 100)}%` }" />
          </div>
          <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{{ formatMb(data.cluster.memory.usedMb) }} used · {{ formatMb(data.cluster.memory.allocatedMb) }} allocated</span>
            <span>{{ formatMb(data.cluster.memory.totalMb) }} total</span>
          </div>
        </div>

        <!-- Disk Bar -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <HardDrive class="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Disk</h3>
            </div>
            <span :class="['text-sm font-bold tabular-nums', statusColor(data.cluster.disk.usedPercent)]">
              {{ data.cluster.disk.usedPercent }}% used
            </span>
          </div>
          <div class="h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
            <div :class="['h-full rounded-full transition-all duration-500', statusBg(data.cluster.disk.usedPercent)]" :style="{ width: `${Math.min(data.cluster.disk.usedPercent, 100)}%` }" />
          </div>
          <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{{ formatGb(data.cluster.disk.usedGb) }} used</span>
            <span>{{ formatGb(data.cluster.disk.freeGb) }} free of {{ formatGb(data.cluster.disk.totalGb) }}</span>
          </div>
        </div>
      </div>

      <!-- Per-Node Breakdown -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">Per-Node Breakdown</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-100 dark:border-gray-700">
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Node</th>
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th class="text-center px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">CPU</th>
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Memory</th>
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Disk</th>
                <th class="text-center px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Containers</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-700/50">
              <tr v-for="node in sortedNodes" :key="node.id" class="hover:bg-gray-50 dark:hover:bg-gray-750">
                <!-- Node info -->
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3">
                    <Server class="w-4 h-4 text-gray-400" />
                    <div>
                      <p class="font-medium text-gray-900 dark:text-white">{{ node.hostname }}</p>
                      <p class="text-xs text-gray-500 dark:text-gray-400">{{ node.ipAddress }} · {{ node.role }}</p>
                    </div>
                  </div>
                </td>
                <!-- Status -->
                <td class="px-6 py-4">
                  <span :class="[
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                    node.isOnline
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  ]">
                    <span :class="['w-1.5 h-1.5 rounded-full', node.isOnline ? 'bg-green-500' : 'bg-red-500']" />
                    {{ node.isOnline ? 'Online' : 'Offline' }}
                  </span>
                </td>
                <!-- CPU -->
                <td class="px-6 py-4 text-center">
                  <span class="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{{ node.cpu.cores }}</span>
                  <span class="text-xs text-gray-500 dark:text-gray-400 ml-1">cores</span>
                </td>
                <!-- Memory -->
                <td class="px-6 py-4">
                  <div class="min-w-[140px]">
                    <div class="flex items-center justify-between text-xs mb-1">
                      <span class="text-gray-700 dark:text-gray-300 tabular-nums">{{ formatMb(node.memory.usedMb) }}</span>
                      <span :class="['font-medium tabular-nums', statusColor(node.memory.usedPercent)]">{{ node.memory.usedPercent }}%</span>
                    </div>
                    <div class="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div :class="['h-full rounded-full', statusBg(node.memory.usedPercent)]" :style="{ width: `${Math.min(node.memory.usedPercent, 100)}%` }" />
                    </div>
                    <p class="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 tabular-nums">{{ formatMb(node.memory.totalMb) }} total</p>
                  </div>
                </td>
                <!-- Disk -->
                <td class="px-6 py-4">
                  <div class="min-w-[140px]">
                    <div class="flex items-center justify-between text-xs mb-1">
                      <span class="text-gray-700 dark:text-gray-300 tabular-nums">{{ formatGb(node.disk.usedGb) }}</span>
                      <span :class="['font-medium tabular-nums', statusColor(node.disk.usedPercent)]">{{ node.disk.usedPercent }}%</span>
                    </div>
                    <div class="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div :class="['h-full rounded-full', statusBg(node.disk.usedPercent)]" :style="{ width: `${Math.min(node.disk.usedPercent, 100)}%` }" />
                    </div>
                    <p class="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 tabular-nums">{{ formatGb(node.disk.totalGb) }} total · {{ node.diskType }}</p>
                  </div>
                </td>
                <!-- Containers -->
                <td class="px-6 py-4 text-center">
                  <span class="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{{ node.containers }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Capacity Planning Tips -->
      <div v-if="warnings.length === 0" class="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/50 rounded-xl p-5">
        <div class="flex items-center gap-3">
          <CheckCircle2 class="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
          <div>
            <p class="text-sm font-medium text-green-700 dark:text-green-400">Cluster resources are healthy</p>
            <p class="text-xs text-green-600 dark:text-green-500 mt-0.5">All metrics are within safe thresholds. No immediate action needed.</p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
