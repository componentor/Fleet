<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { FileText, RefreshCw, Search, Loader2, X } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const api = useApi()

interface LogEntry {
  serviceName: string
  serviceId: string
  line: string
  timestamp: string
}

interface ServiceInfo {
  id: string
  name: string
  hasDocker: boolean
}

const loading = ref(true)
const logEntries = ref<LogEntry[]>([])
const serviceList = ref<ServiceInfo[]>([])
const selectedService = ref('')
const tail = ref(100)
const clientFilter = ref('')
const autoRefresh = ref(false)

let autoRefreshInterval: ReturnType<typeof setInterval> | null = null

const tailOptions = [50, 100, 500, 1000]

// Assign consistent colors to services
const serviceColors: Record<string, string> = {}
const colorPalette = [
  'text-blue-400',
  'text-green-400',
  'text-yellow-400',
  'text-purple-400',
  'text-pink-400',
  'text-cyan-400',
  'text-orange-400',
  'text-red-400',
]

function getServiceColor(name: string): string {
  if (!serviceColors[name]) {
    const idx = Object.keys(serviceColors).length % colorPalette.length
    serviceColors[name] = colorPalette[idx] ?? 'text-blue-400'
  }
  return serviceColors[name] ?? 'text-blue-400'
}

const filteredLogs = computed(() => {
  if (!clientFilter.value.trim()) return logEntries.value
  const filter = clientFilter.value.toLowerCase()
  return logEntries.value.filter(
    (entry) =>
      entry.line.toLowerCase().includes(filter) ||
      entry.serviceName.toLowerCase().includes(filter),
  )
})

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ts.slice(11, 19)
  }
}

async function fetchLogs() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    params.set('tail', String(tail.value))
    if (selectedService.value) params.set('serviceId', selectedService.value)
    const data = await api.get<any>(`/services/logs?${params.toString()}`)
    logEntries.value = data?.logs ?? []
    serviceList.value = data?.services ?? []
  } catch {
    logEntries.value = []
  } finally {
    loading.value = false
  }
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value
  if (autoRefresh.value) {
    autoRefreshInterval = setInterval(fetchLogs, 5000)
  } else if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval)
    autoRefreshInterval = null
  }
}

watch(selectedService, () => fetchLogs())
watch(tail, () => fetchLogs())

onMounted(() => fetchLogs())
onUnmounted(() => {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval)
})
</script>

<template>
  <div class="p-6 max-w-full">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30">
          <FileText class="w-6 h-6 text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('nav.logs') }}</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400">Container logs across your services</p>
        </div>
      </div>
    </div>

    <!-- Controls -->
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <!-- Service filter -->
      <select
        v-model="selectedService"
        class="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
      >
        <option value="">All services</option>
        <option v-for="svc in serviceList.filter((s) => s.hasDocker)" :key="svc.id" :value="svc.id">
          {{ svc.name }}
        </option>
      </select>

      <!-- Tail count -->
      <select
        v-model="tail"
        class="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
      >
        <option v-for="opt in tailOptions" :key="opt" :value="opt">{{ opt }} lines/svc</option>
      </select>

      <!-- Client-side filter -->
      <div class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="clientFilter"
          type="text"
          placeholder="Filter logs..."
          class="pl-9 pr-8 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 w-56"
        />
        <button v-if="clientFilter" @click="clientFilter = ''" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <div class="flex items-center gap-2 ml-auto">
        <span class="text-xs text-gray-500 dark:text-gray-400">{{ filteredLogs.length }} entries</span>

        <!-- Auto-refresh -->
        <button
          @click="toggleAutoRefresh"
          :class="[
            'flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors',
            autoRefresh
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600',
          ]"
        >
          <RefreshCw :class="['w-4 h-4', autoRefresh && 'animate-spin']" />
          {{ autoRefresh ? 'Live' : 'Auto' }}
        </button>

        <!-- Manual refresh -->
        <button
          @click="fetchLogs()"
          :disabled="loading"
          class="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
          <RefreshCw v-else class="w-4 h-4" />
          Refresh
        </button>
      </div>
    </div>

    <!-- Log entries -->
    <div class="w-full h-[calc(100vh-280px)] overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-950 text-xs font-mono">
      <div v-if="loading && !logEntries.length" class="flex items-center justify-center h-full text-gray-400">
        <Loader2 class="w-5 h-5 animate-spin mr-2" />
        Loading logs...
      </div>
      <div v-else-if="!filteredLogs.length" class="flex items-center justify-center h-full text-gray-500">
        {{ logEntries.length ? 'No logs match your filter' : 'No logs available' }}
      </div>
      <table v-else class="w-full">
        <tbody>
          <tr
            v-for="(entry, idx) in filteredLogs"
            :key="idx"
            class="hover:bg-gray-900/50 border-b border-gray-800/30"
          >
            <td class="px-3 py-1 text-gray-500 whitespace-nowrap align-top select-none w-[70px]">
              {{ formatTimestamp(entry.timestamp) }}
            </td>
            <td :class="['px-2 py-1 whitespace-nowrap align-top font-semibold w-[120px]', getServiceColor(entry.serviceName)]">
              {{ entry.serviceName }}
            </td>
            <td class="px-3 py-1 text-gray-200 whitespace-pre-wrap break-all">
              {{ entry.line }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
