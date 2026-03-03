<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import { ScrollText, RefreshCw, Search, Loader2, Copy, Check, X } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const api = useApi()

const loading = ref(true)
const logs = ref('')
const warning = ref('')
const service = ref('fleet_api')
const availableServices = ref<string[]>(['fleet_api', 'fleet_dashboard', 'fleet_traefik'])
const tail = ref(500)
const searchQuery = ref('')
const clientFilter = ref('')
const autoRefresh = ref(false)
const copied = ref(false)

const logContainer = ref<HTMLPreElement | null>(null)

let autoRefreshInterval: ReturnType<typeof setInterval> | null = null
let fetchAbort: AbortController | null = null

const tailOptions = [100, 500, 1000, 5000]

const filteredLogs = computed(() => {
  if (!clientFilter.value.trim()) return logs.value
  const filter = clientFilter.value.toLowerCase()
  return logs.value
    .split('\n')
    .filter((line) => line.toLowerCase().includes(filter))
    .join('\n')
})

const lineCount = computed(() => {
  const text = filteredLogs.value.trim()
  return text ? text.split('\n').length : 0
})

async function fetchLogs() {
  // Abort any in-flight request
  if (fetchAbort) fetchAbort.abort()
  fetchAbort = new AbortController()

  loading.value = true
  logs.value = ''
  warning.value = ''

  try {
    const params = new URLSearchParams()
    params.set('service', service.value)
    params.set('tail', String(tail.value))
    if (searchQuery.value.trim()) params.set('search', searchQuery.value.trim())

    const response = await api.getStream(
      `/admin/logs?${params.toString()}`,
      (chunk) => {
        logs.value += chunk
        nextTick(() => scrollToBottom())
      },
      fetchAbort.signal,
    )

    // Read metadata from response headers
    const svcHeader = response.headers.get('X-Fleet-Available-Services')
    if (svcHeader) availableServices.value = svcHeader.split(',')
  } catch (err: any) {
    if (err?.name === 'AbortError') return
    // Fallback: endpoint may have returned JSON (e.g. warning / not found)
    if (err?.body) {
      const body = err.body as Record<string, any>
      logs.value = body?.logs ?? ''
      warning.value = body?.warning ?? 'Failed to fetch logs'
      if (body?.availableServices) availableServices.value = body.availableServices
    } else {
      warning.value = 'Failed to fetch logs'
    }
  } finally {
    loading.value = false
  }
}

function scrollToBottom() {
  if (logContainer.value) {
    logContainer.value.scrollTop = logContainer.value.scrollHeight
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

async function copyLogs() {
  try {
    await navigator.clipboard.writeText(filteredLogs.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch { /* clipboard not available */ }
}

watch(service, () => {
  fetchLogs()
})

watch(tail, () => {
  fetchLogs()
})

onMounted(() => {
  fetchLogs()
})

onUnmounted(() => {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval)
  if (fetchAbort) fetchAbort.abort()
})
</script>

<template>
  <div class="p-6 max-w-full">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30">
          <ScrollText class="w-6 h-6 text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('nav.logs') }}</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400">Docker container logs for fleet infrastructure</p>
        </div>
      </div>
    </div>

    <!-- Controls -->
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <!-- Service selector -->
      <select
        v-model="service"
        class="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
      >
        <option v-for="svc in availableServices" :key="svc" :value="svc">{{ svc }}</option>
      </select>

      <!-- Tail count -->
      <select
        v-model="tail"
        class="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
      >
        <option v-for="opt in tailOptions" :key="opt" :value="opt">{{ opt }} lines</option>
      </select>

      <!-- Server-side search -->
      <div class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Server filter..."
          class="pl-9 pr-8 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 w-48"
          @keydown.enter="fetchLogs()"
        />
        <button v-if="searchQuery" @click="searchQuery = ''; fetchLogs()" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Client-side filter -->
      <div class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="clientFilter"
          type="text"
          placeholder="Highlight filter..."
          class="pl-9 pr-8 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 w-48"
        />
        <button v-if="clientFilter" @click="clientFilter = ''" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <div class="flex items-center gap-2 ml-auto">
        <!-- Line count -->
        <span class="text-xs text-gray-500 dark:text-gray-400">{{ lineCount }} lines</span>

        <!-- Copy -->
        <button
          @click="copyLogs"
          class="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          :title="copied ? 'Copied!' : 'Copy logs'"
        >
          <Check v-if="copied" class="w-4 h-4 text-green-500" />
          <Copy v-else class="w-4 h-4" />
        </button>

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

    <!-- Warning -->
    <div v-if="warning" class="mb-4 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-sm text-yellow-700 dark:text-yellow-300">
      {{ warning }}
    </div>

    <!-- Log output -->
    <pre
      ref="logContainer"
      class="w-full h-[calc(100vh-280px)] overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-950 text-gray-200 text-xs font-mono p-4 leading-5 whitespace-pre-wrap break-all"
    >{{ filteredLogs || (loading ? 'Loading...' : 'No logs available') }}</pre>
  </div>
</template>
