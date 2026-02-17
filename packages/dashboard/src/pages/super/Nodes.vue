<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Server, Plus, RefreshCw, Loader2, Cpu, MemoryStick } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const api = useApi()

const nodes = ref<any[]>([])
const loading = ref(true)
const showAdd = ref(false)
const addHostname = ref('')
const addIp = ref('')
const addRole = ref<'worker' | 'manager'>('worker')
const adding = ref(false)
const error = ref('')
const joinToken = ref('')
const nodeMetrics = ref<Record<string, { cpuPercent: number; memoryPercent: number }>>({})

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
    if (data && typeof data.cpuPercent === 'number') {
      nodeMetrics.value[nodeId] = {
        cpuPercent: data.cpuPercent,
        memoryPercent: data.memoryPercent,
      }
    } else if (Array.isArray(data) && data.length > 0) {
      const latest = data[data.length - 1]
      nodeMetrics.value[nodeId] = {
        cpuPercent: latest.cpuPercent ?? 0,
        memoryPercent: latest.memoryPercent ?? 0,
      }
    }
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
    })
    if (result.joinToken) {
      joinToken.value = result.joinToken
    }
    addHostname.value = ''
    addIp.value = ''
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
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Server class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Swarm Nodes</h1>
      </div>
      <div class="flex items-center gap-3">
        <button
          @click="fetchNodes"
          :disabled="loading"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
        >
          <RefreshCw :class="['w-4 h-4', loading && 'animate-spin']" />
          Refresh
        </button>
        <button
          @click="showAdd = true"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Plus class="w-4 h-4" />
          Add Node
        </button>
      </div>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <div v-if="joinToken" class="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
      <p class="text-sm font-medium text-green-700 dark:text-green-300 mb-2">Node registered. Run this on the new node to join the swarm:</p>
      <code class="block bg-gray-900 text-green-400 p-3 rounded-lg text-xs overflow-x-auto">docker swarm join --token {{ joinToken }} &lt;manager-ip&gt;:2377</code>
      <button @click="joinToken = ''" class="mt-2 text-xs text-green-600 dark:text-green-400 hover:underline">Dismiss</button>
    </div>

    <!-- Add node form -->
    <div v-if="showAdd" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Register New Node</h3>
      <form @submit.prevent="addNode" class="flex items-end gap-3 flex-wrap">
        <div class="flex-1 min-w-48">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Hostname</label>
          <input v-model="addHostname" type="text" placeholder="node-01" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
        </div>
        <div class="flex-1 min-w-48">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">IP Address</label>
          <input v-model="addIp" type="text" placeholder="10.0.0.1" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
        </div>
        <div class="w-36">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Role</label>
          <select v-model="addRole" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm">
            <option value="worker">Worker</option>
            <option value="manager">Manager</option>
          </select>
        </div>
        <button type="submit" :disabled="adding" class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
          {{ adding ? 'Adding...' : 'Add' }}
        </button>
        <button type="button" @click="showAdd = false" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
          Cancel
        </button>
      </form>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Hostname</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">IP</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Role</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Resources</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Docker</th>
              <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="nodes.length === 0">
              <td colspan="7" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                No nodes registered yet. Add your first node to get started.
              </td>
            </tr>
            <tr
              v-for="node in nodes"
              :key="node.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
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
                <span class="flex items-center gap-1.5">
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
                <div v-if="nodeMetrics[node.id]" class="space-y-1.5 min-w-[120px]">
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] font-medium text-gray-500 dark:text-gray-400 w-8">CPU</span>
                    <div class="flex-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                      <div
                        class="h-full rounded-full transition-all"
                        :class="(nodeMetrics[node.id]?.cpuPercent ?? 0) > 80 ? 'bg-red-500' : (nodeMetrics[node.id]?.cpuPercent ?? 0) > 50 ? 'bg-yellow-500' : 'bg-green-500'"
                        :style="{ width: `${Math.min(100, nodeMetrics[node.id]?.cpuPercent ?? 0)}%` }"
                      ></div>
                    </div>
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 w-8 text-right">{{ Math.round(nodeMetrics[node.id]?.cpuPercent ?? 0) }}%</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] font-medium text-gray-500 dark:text-gray-400 w-8">MEM</span>
                    <div class="flex-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                      <div
                        class="h-full rounded-full transition-all"
                        :class="(nodeMetrics[node.id]?.memoryPercent ?? 0) > 80 ? 'bg-red-500' : (nodeMetrics[node.id]?.memoryPercent ?? 0) > 50 ? 'bg-yellow-500' : 'bg-blue-500'"
                        :style="{ width: `${Math.min(100, nodeMetrics[node.id]?.memoryPercent ?? 0)}%` }"
                      ></div>
                    </div>
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 w-8 text-right">{{ Math.round(nodeMetrics[node.id]?.memoryPercent ?? 0) }}%</span>
                  </div>
                </div>
                <span v-else class="text-xs text-gray-400 dark:text-gray-500">No data</span>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                <span v-if="node.docker" class="text-green-600 dark:text-green-400">{{ node.docker.Status?.State || 'linked' }}</span>
                <span v-else class="text-gray-400">not linked</span>
              </td>
              <td class="px-6 py-4 text-right">
                <div class="flex items-center justify-end gap-2">
                  <button
                    v-if="node.status === 'active'"
                    @click="drainNode(node.id)"
                    class="text-xs font-medium text-yellow-600 dark:text-yellow-400 hover:underline"
                  >
                    Drain
                  </button>
                  <button
                    v-if="node.status === 'draining'"
                    @click="activateNode(node.id)"
                    class="text-xs font-medium text-green-600 dark:text-green-400 hover:underline"
                  >
                    Activate
                  </button>
                  <button
                    @click="removeNode(node.id)"
                    class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                  >
                    Remove
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
