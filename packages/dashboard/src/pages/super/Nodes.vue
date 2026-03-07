<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Server, Plus, RefreshCw, Cpu, MemoryStick, MapPin, Pencil, Check, X } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import AdminEmptyState from '@/components/AdminEmptyState.vue'

const { t } = useI18n()
const router = useRouter()
const api = useApi()

const nodes = ref<any[]>([])
const loading = ref(true)
const showAdd = ref(false)
const addHostname = ref('')
const addIp = ref('')
const addRole = ref<'worker' | 'manager'>('worker')
const addLocation = ref('')
const adding = ref(false)
const error = ref('')
const joinToken = ref('')
const nodeMetrics = ref<Record<string, { cpuCount: number; memTotal: number; memUsed: number; memFree: number; memoryPercent: number; containerCount: number }>>({})
const locations = ref<Array<{ key: string; label: string }>>([])
const editingRegionNodeId = ref<string | null>(null)
const editingRegionValue = ref('')
const savingRegion = ref(false)

function getHealthStatus(node: any): 'green' | 'yellow' | 'red' {
  if (!node.lastHeartbeat) return 'red'
  const elapsed = Date.now() - new Date(node.lastHeartbeat).getTime()
  if (elapsed <= 60_000) return 'green'
  if (elapsed <= 300_000) return 'yellow'
  return 'red'
}

const healthColorMap = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
}

async function fetchNodeMetrics(nodeId: string) {
  try {
    const data = await api.get<any>(`/nodes/${nodeId}/metrics?hours=1`)
    if (Array.isArray(data) && data.length > 0) {
      const latest = data[data.length - 1]
      const memTotal = latest.memTotal ?? 0
      const memUsed = latest.memUsed ?? 0
      nodeMetrics.value[nodeId] = {
        cpuCount: latest.cpuCount ?? 0,
        memTotal,
        memUsed,
        memFree: latest.memFree ?? 0,
        memoryPercent: memTotal > 0 ? (memUsed / memTotal) * 100 : 0,
        containerCount: latest.containerCount ?? 0,
      }
    }
  } catch {}
}

async function fetchLocations() {
  try {
    const data = await api.get<any[]>('/billing/admin/locations')
    locations.value = data.map((l: any) => ({ key: l.locationKey, label: l.label }))
  } catch {}
}

async function fetchNodes() {
  loading.value = true
  try {
    nodes.value = await api.get<any[]>('/nodes')
    // Fetch metrics for all nodes in parallel
    await Promise.allSettled(
      nodes.value.map(node => fetchNodeMetrics(node.id))
    )
  } catch {
    nodes.value = []
  } finally {
    loading.value = false
  }
}

function startEditRegion(node: any) {
  editingRegionNodeId.value = node.id
  editingRegionValue.value = node.location || ''
}

function cancelEditRegion() {
  editingRegionNodeId.value = null
  editingRegionValue.value = ''
}

async function saveRegion(nodeId: string) {
  savingRegion.value = true
  try {
    await api.patch(`/nodes/${nodeId}`, {
      location: editingRegionValue.value || null,
    })
    editingRegionNodeId.value = null
    await fetchNodes()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to update region'
  } finally {
    savingRegion.value = false
  }
}

async function addNode() {
  if (!addHostname.value || !addIp.value) return
  adding.value = true
  error.value = ''
  joinToken.value = ''
  try {
    const result = await api.post<any>('/nodes', {
      hostname: addHostname.value,
      ipAddress: addIp.value,
      role: addRole.value,
      location: addLocation.value || null,
    })
    if (result.joinToken) {
      joinToken.value = result.joinToken
    }
    addHostname.value = ''
    addIp.value = ''
    addLocation.value = ''
    showAdd.value = false
    await fetchNodes()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to add node'
  } finally {
    adding.value = false
  }
}

async function drainNode(nodeId: string) {
  if (!confirm('Drain this node? Running tasks will be moved to other nodes.')) return
  try {
    await api.post(`/nodes/${nodeId}/drain`, {})
    await fetchNodes()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to drain node'
  }
}

async function activateNode(nodeId: string) {
  try {
    await api.post(`/nodes/${nodeId}/activate`, {})
    await fetchNodes()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to activate node'
  }
}

async function removeNode(nodeId: string) {
  if (!confirm('Remove this node from the cluster? This cannot be undone.')) return
  try {
    await api.del(`/nodes/${nodeId}`)
    await fetchNodes()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to remove node'
  }
}

onMounted(() => {
  fetchNodes()
  fetchLocations()
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <Server class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('super.nodes.swarmNodes') }}</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{{ t('super.nodes.subtitle') }}</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button
          @click="fetchNodes"
          :disabled="loading"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
        >
          <RefreshCw :class="['w-4 h-4', loading && 'animate-spin']" />
          {{ t('super.nodes.refresh') }}
        </button>
        <button
          @click="showAdd = true"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Plus class="w-4 h-4" />
          {{ t('super.nodes.addNode') }}
        </button>
      </div>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <div v-if="joinToken" class="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
      <p class="text-sm font-medium text-green-700 dark:text-green-300 mb-2">{{ t('super.nodes.nodeRegistered') }}</p>
      <code class="block bg-gray-900 text-green-400 p-3 rounded-lg text-xs overflow-x-auto">docker swarm join --token {{ joinToken }} &lt;manager-ip&gt;:2377</code>
      <button @click="joinToken = ''" class="mt-2 text-xs text-green-600 dark:text-green-400 hover:underline">Dismiss</button>
    </div>

    <!-- Add node form -->
    <div v-if="showAdd" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">{{ t('super.nodes.registerNewNode') }}</h3>
      <form @submit.prevent="addNode" class="flex items-end gap-3 flex-wrap">
        <div class="flex-1 min-w-48">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('super.nodes.hostname') }}</label>
          <input v-model="addHostname" type="text" placeholder="node-01" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
        </div>
        <div class="flex-1 min-w-48">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('super.nodes.ipAddress') }}</label>
          <input v-model="addIp" type="text" placeholder="10.0.0.1" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
        </div>
        <div class="w-36">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('super.nodes.role') }}</label>
          <select v-model="addRole" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm">
            <option value="worker">Worker</option>
            <option value="manager">Manager</option>
          </select>
        </div>
        <div class="w-44">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Region</label>
          <select v-model="addLocation" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm">
            <option value="">None</option>
            <option v-for="loc in locations" :key="loc.key" :value="loc.key">{{ loc.label }}</option>
          </select>
        </div>
        <button type="submit" :disabled="adding" class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
          {{ adding ? t('super.nodes.adding') : t('common.add') }}
        </button>
        <button type="button" @click="showAdd = false" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
          {{ t('common.cancel') }}
        </button>
      </form>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full admin-table">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('super.nodes.hostname') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('super.nodes.ip') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('super.nodes.role') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Region</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('super.nodes.status') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('super.nodes.resources') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('super.nodes.docker') }}</th>
              <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('super.nodes.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="nodes.length === 0">
              <td colspan="8">
                <AdminEmptyState
                  :icon="Server"
                  :title="t('super.nodes.noNodes')"
                  :description="t('super.nodes.noNodesDesc')"
                />
              </td>
            </tr>
            <tr
              v-for="node in nodes"
              :key="node.id"
              @click="router.push({ name: 'super-node-detail', params: { id: node.id } })"
              class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer"
            >
              <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                <div class="flex items-center gap-2">
                  <span
                    :class="['w-2.5 h-2.5 rounded-full shrink-0', healthColorMap[getHealthStatus(node)]]"
                    :title="`Heartbeat: ${node.lastHeartbeat ? new Date(node.lastHeartbeat).toLocaleString() : 'never'}`"
                  ></span>
                  {{ node.hostname }}
                </div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 font-mono">{{ node.ipAddress }}</td>
              <td class="px-6 py-4 text-sm">
                <span
                  :class="[
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    node.role === 'manager'
                      ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  ]"
                >
                  {{ node.role }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm">
                <!-- Inline region editing -->
                <div v-if="editingRegionNodeId === node.id" class="flex items-center gap-1.5" @click.stop>
                  <select
                    v-model="editingRegionValue"
                    class="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="">None</option>
                    <option v-for="loc in locations" :key="loc.key" :value="loc.key">{{ loc.label }}</option>
                  </select>
                  <button @click="saveRegion(node.id)" :disabled="savingRegion" class="p-0.5 text-green-600 dark:text-green-400 hover:text-green-700">
                    <Check class="w-3.5 h-3.5" />
                  </button>
                  <button @click="cancelEditRegion()" class="p-0.5 text-gray-400 hover:text-gray-600">
                    <X class="w-3.5 h-3.5" />
                  </button>
                </div>
                <div v-else class="flex items-center gap-1.5 group">
                  <span v-if="node.location" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                    <MapPin class="w-3 h-3" />
                    {{ locations.find(l => l.key === node.location)?.label || node.location }}
                  </span>
                  <span v-else class="text-xs text-gray-400 dark:text-gray-500">--</span>
                  <button @click.stop="startEditRegion(node)" class="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Pencil class="w-3 h-3" />
                  </button>
                </div>
              </td>
              <td class="px-6 py-4 text-sm">
                <span
                  :class="[
                    'inline-flex items-center gap-1.5',
                    node.status === 'active' ? 'text-green-700 dark:text-green-400' :
                    node.status === 'draining' ? 'text-yellow-700 dark:text-yellow-400' : 'text-red-700 dark:text-red-400'
                  ]"
                >
                  <span
                    :class="[
                      'w-2 h-2 rounded-full',
                      node.status === 'active' ? 'bg-green-500' :
                      node.status === 'draining' ? 'bg-yellow-500' : 'bg-red-500'
                    ]"
                  ></span>
                  {{ node.status }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm">
                <div v-if="nodeMetrics[node.id]" class="space-y-1.5 min-w-[160px]">
                  <div class="flex items-center gap-3">
                    <span class="text-[10px] font-medium text-gray-500 dark:text-gray-400 w-12 shrink-0">{{ t('super.nodes.cpu') }}</span>
                    <span class="text-xs text-gray-700 dark:text-gray-300">{{ nodeMetrics[node.id]!.cpuCount }} {{ nodeMetrics[node.id]!.cpuCount === 1 ? 'core' : 'cores' }}</span>
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="text-[10px] font-medium text-gray-500 dark:text-gray-400 w-12 shrink-0">{{ t('super.nodes.memory') }}</span>
                    <div class="flex-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                      <div
                        class="h-full rounded-full transition-all"
                        :class="nodeMetrics[node.id]!.memoryPercent > 80 ? 'bg-red-500' : nodeMetrics[node.id]!.memoryPercent > 50 ? 'bg-yellow-500' : 'bg-blue-500'"
                        :style="{ width: `${Math.min(100, nodeMetrics[node.id]!.memoryPercent)}%` }"
                      ></div>
                    </div>
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 w-10 text-right">{{ Math.round(nodeMetrics[node.id]!.memoryPercent) }}%</span>
                  </div>
                  <div class="text-[10px] text-gray-400 dark:text-gray-500">
                    {{ (nodeMetrics[node.id]!.memUsed / 1073741824).toFixed(1) }} / {{ (nodeMetrics[node.id]!.memTotal / 1073741824).toFixed(1) }} GB
                    · {{ nodeMetrics[node.id]!.containerCount }} {{ nodeMetrics[node.id]!.containerCount === 1 ? 'container' : 'containers' }}
                  </div>
                </div>
                <span v-else class="text-xs text-gray-400 dark:text-gray-500">--</span>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                <span v-if="node.docker" class="text-green-600 dark:text-green-400">{{ node.docker.Status?.State || 'linked' }}</span>
                <span v-else class="text-gray-400">not linked</span>
              </td>
              <td class="px-6 py-4 text-right">
                <div class="flex items-center justify-end gap-2" @click.stop>
                  <button
                    v-if="node.status === 'active'"
                    @click="drainNode(node.id)"
                    class="text-xs font-medium text-yellow-600 dark:text-yellow-400 hover:underline"
                  >
                    {{ t('super.nodes.drain') }}
                  </button>
                  <button
                    v-if="node.status === 'draining'"
                    @click="activateNode(node.id)"
                    class="text-xs font-medium text-green-600 dark:text-green-400 hover:underline"
                  >
                    {{ t('super.nodes.activate') }}
                  </button>
                  <button
                    @click="removeNode(node.id)"
                    class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                  >
                    {{ t('super.nodes.remove') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
