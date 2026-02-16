<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Box, Play, RotateCw, Trash2, Loader2, ArrowLeft, Radio } from 'lucide-vue-next'
import { useApi, ApiError } from '@/composables/useApi'
import { useLogStream } from '@/composables/useLogStream'

const route = useRoute()
const router = useRouter()
const api = useApi()
const serviceId = route.params.id as string
const logStream = useLogStream()

const activeTab = ref('overview')
const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'logs', label: 'Logs' },
  { id: 'deployments', label: 'Deployments' },
  { id: 'settings', label: 'Settings' },
]

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

const displayedLogs = computed(() => liveMode.value ? logStream.logs.value : logs.value)

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
  } catch {
    logs.value = 'Failed to fetch logs.'
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

async function restartService() {
  actionLoading.value = 'restart'
  try {
    await api.post(`/services/${serviceId}/restart`, {})
    await fetchService()
  } catch {
    // ignore
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
    // ignore
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
    // ignore
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
    // ignore
  } finally {
    settingsLoading.value = false
  }
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

function onTabChange(tabId: string) {
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
  }
}

const dockerStatus = computed(() => service.value?.dockerStatus)

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
        <div class="flex items-center gap-3">
          <router-link to="/panel/services" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <ArrowLeft class="w-5 h-5" />
          </router-link>
          <Box class="w-7 h-7 text-primary-600 dark:text-primary-400" />
          <div>
            <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ service.name }}</h1>
            <p class="text-sm text-gray-500 dark:text-gray-400 font-mono">{{ service.image }}</p>
          </div>
          <span
            :class="[
              'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ml-2',
              service.status === 'running' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
              service.status === 'stopped' || service.status === 'failed' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
              'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
            ]"
          >
            {{ service.status }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="redeployService"
            :disabled="!!actionLoading"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
          >
            <Play class="w-4 h-4" />
            Redeploy
          </button>
          <button
            @click="restartService"
            :disabled="!!actionLoading"
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
          >
            <RotateCw class="w-4 h-4" />
            Restart
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
        <nav class="flex gap-6 -mb-px">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            @click="onTabChange(tab.id)"
            :class="[
              'pb-3 text-sm font-medium border-b-2 transition-colors',
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
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">SSL</p>
              <p class="text-lg font-bold text-gray-900 dark:text-white">{{ service.sslEnabled ? 'Enabled' : 'Disabled' }}</p>
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

        <!-- Deployments -->
        <div v-if="activeTab === 'deployments'">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
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
                <tr v-if="deploymentsLoading">
                  <td colspan="4" class="px-6 py-12 text-center">
                    <Loader2 class="w-6 h-6 text-gray-400 animate-spin mx-auto" />
                  </td>
                </tr>
                <tr v-else-if="deployments.length === 0">
                  <td colspan="4" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                    No deployments yet.
                  </td>
                </tr>
                <tr
                  v-for="deploy in deployments"
                  :key="deploy.id"
                  class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
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
                <div v-for="(v, i) in envVars" :key="i" class="flex items-center gap-3">
                  <input v-model="v.key" type="text" placeholder="KEY" class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                  <input v-model="v.value" type="text" placeholder="value" class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                  <button @click="removeEnvVar(i)" class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-sm">Remove</button>
                </div>
              </div>
            </div>
            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button @click="saveSettings" :disabled="settingsLoading" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {{ settingsLoading ? 'Saving...' : 'Save Environment' }}
              </button>
            </div>
          </div>

          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Service Configuration</h3>
            </div>
            <div class="p-6">
              <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt class="text-gray-500 dark:text-gray-400">Update Parallelism</dt>
                  <dd class="text-gray-900 dark:text-white mt-0.5">{{ service.updateParallelism ?? 1 }}</dd>
                </div>
                <div>
                  <dt class="text-gray-500 dark:text-gray-400">Update Delay</dt>
                  <dd class="text-gray-900 dark:text-white mt-0.5">{{ service.updateDelay ?? '10s' }}</dd>
                </div>
                <div>
                  <dt class="text-gray-500 dark:text-gray-400">Rollback on Failure</dt>
                  <dd class="text-gray-900 dark:text-white mt-0.5">{{ service.rollbackOnFailure ? 'Yes' : 'No' }}</dd>
                </div>
                <div>
                  <dt class="text-gray-500 dark:text-gray-400">Auto Deploy</dt>
                  <dd class="text-gray-900 dark:text-white mt-0.5">{{ service.autoDeploy ? 'Enabled' : 'Disabled' }}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
