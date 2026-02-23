<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import {
  ScrollText,
  Search,
  Loader2,
  Filter,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const api = useApi()

const logs = ref<any[]>([])
const loading = ref(true)
const page = ref(1)
const totalPages = ref(1)
const total = ref(0)
const expandedRow = ref<string | null>(null)
const showFilters = ref(false)

const filters = reactive({
  search: '',
  resourceType: '',
  eventType: '',
  dateRange: '',
  dateFrom: '',
  dateTo: '',
})

let searchTimeout: ReturnType<typeof setTimeout> | null = null

const resourceTypes = [
  { value: '', label: 'All types' },
  { value: 'service', label: 'Services' },
  { value: 'deployment', label: 'Deployments' },
  { value: 'dns', label: 'DNS / Domains' },
  { value: 'backup', label: 'Backups' },
  { value: 'user', label: 'Users' },
  { value: 'account', label: 'Accounts' },
  { value: 'ssh', label: 'SSH Keys' },
  { value: 'api_key', label: 'API Keys' },
  { value: 'settings', label: 'Settings' },
  { value: 'stack', label: 'Stacks' },
]

const dateRanges = [
  { value: '', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
]

function applyDateRange(range: string) {
  filters.dateRange = range
  const now = new Date()
  if (range === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    filters.dateFrom = start.toISOString()
    filters.dateTo = ''
  } else if (range === '7d') {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    filters.dateFrom = start.toISOString()
    filters.dateTo = ''
  } else if (range === '30d') {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    filters.dateFrom = start.toISOString()
    filters.dateTo = ''
  } else if (range === '') {
    filters.dateFrom = ''
    filters.dateTo = ''
  }
}

function clearFilters() {
  filters.search = ''
  filters.resourceType = ''
  filters.eventType = ''
  filters.dateRange = ''
  filters.dateFrom = ''
  filters.dateTo = ''
  page.value = 1
  fetchLogs()
}

const hasActiveFilters = () =>
  filters.resourceType || filters.eventType || filters.dateFrom || filters.dateTo || filters.search

async function fetchLogs() {
  loading.value = true
  try {
    const params = new URLSearchParams({ page: page.value.toString(), limit: '50' })
    if (filters.resourceType) params.set('resourceType', filters.resourceType)
    if (filters.eventType) params.set('eventType', filters.eventType)
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
    if (filters.dateTo) params.set('dateTo', filters.dateTo)
    if (filters.search) params.set('search', filters.search)

    const data = await api.get<any>(`/admin/audit-log?${params}`)
    logs.value = data.data ?? []
    totalPages.value = data.pagination?.totalPages ?? 1
    total.value = data.pagination?.total ?? 0
  } catch {
    logs.value = []
  } finally {
    loading.value = false
  }
}

function onSearchInput() {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    page.value = 1
    fetchLogs()
  }, 300)
}

function onFilterChange() {
  page.value = 1
  fetchLogs()
}

function toggleRow(id: string) {
  expandedRow.value = expandedRow.value === id ? null : id
}

function formatDate(ts: any) {
  if (!ts) return '--'
  return new Date(ts).toLocaleString()
}

function getBadgeClasses(eventType: string | null) {
  if (!eventType) return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  if (eventType.includes('created') || eventType.includes('added') || eventType.includes('registered'))
    return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  if (eventType.includes('deleted') || eventType.includes('removed') || eventType.includes('revoked') || eventType.includes('scheduled'))
    return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  if (eventType.includes('updated') || eventType.includes('changed'))
    return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
  if (eventType.includes('login') || eventType.includes('started'))
    return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
  if (eventType.includes('stopped') || eventType.includes('logout'))
    return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
  if (eventType.includes('failed'))
    return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
  if (eventType.includes('triggered') || eventType.includes('redeployed') || eventType.includes('restarted'))
    return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
  if (eventType.includes('impersonated'))
    return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
  return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
}

function formatEventType(eventType: string | null) {
  if (!eventType) return 'HTTP request'
  return eventType.replace(/[._]/g, ' ')
}

function getSourceLabel(source: string | null) {
  if (source === 'webhook') return 'Webhook'
  if (source === 'api-key') return 'API Key'
  if (source === 'system') return 'System'
  return 'User'
}

watch(() => filters.dateRange, (range) => {
  if (range !== 'custom') {
    applyDateRange(range)
    onFilterChange()
  }
})

onMounted(() => {
  fetchLogs()
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-6">
      <div class="flex items-center gap-3">
        <ScrollText class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('nav.events') }}</h1>
          <p v-if="!loading" class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{{ total.toLocaleString() }} events</p>
        </div>
      </div>
      <button
        @click="showFilters = !showFilters"
        :class="[
          'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
          hasActiveFilters()
            ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
            : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
        ]"
      >
        <Filter class="w-4 h-4" />
        Filters
        <span v-if="hasActiveFilters()" class="w-2 h-2 rounded-full bg-primary-500" />
      </button>
    </div>

    <!-- Filters panel -->
    <div v-if="showFilters" class="mb-6 p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <!-- Search -->
        <div class="sm:col-span-2">
          <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Search</label>
          <div class="relative">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              v-model="filters.search"
              type="text"
              :placeholder="t('super.auditLog.search')"
              class="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              @input="onSearchInput"
            />
          </div>
        </div>

        <!-- Resource type -->
        <div>
          <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Resource Type</label>
          <select
            v-model="filters.resourceType"
            @change="onFilterChange"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option v-for="rt in resourceTypes" :key="rt.value" :value="rt.value">{{ rt.label }}</option>
          </select>
        </div>

        <!-- Date range -->
        <div>
          <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Date Range</label>
          <select
            v-model="filters.dateRange"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option v-for="dr in dateRanges" :key="dr.value" :value="dr.value">{{ dr.label }}</option>
          </select>
        </div>

        <!-- Custom date inputs -->
        <template v-if="filters.dateRange === 'custom'">
          <div>
            <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">From</label>
            <input
              v-model="filters.dateFrom"
              type="date"
              @change="onFilterChange"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">To</label>
            <input
              v-model="filters.dateTo"
              type="date"
              @change="onFilterChange"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </template>
      </div>

      <div v-if="hasActiveFilters()" class="mt-3 flex justify-end">
        <button
          @click="clearFilters"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <X class="w-3 h-3" />
          Clear filters
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <!-- Table -->
    <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.auditLog.time') }}</th>
              <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actor</th>
              <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Event</th>
              <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.auditLog.resource') }}</th>
              <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.auditLog.account') }}</th>
              <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.auditLog.ip') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="logs.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                {{ hasActiveFilters() ? 'No events match your filters.' : $t('super.auditLog.noEntries') }}
              </td>
            </tr>
            <template v-for="log in logs" :key="log.id">
              <tr
                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer"
                @click="toggleRow(log.id)"
              >
                <td class="px-5 py-3.5 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{{ formatDate(log.createdAt) }}</td>
                <td class="px-5 py-3.5 text-sm">
                  <span v-if="log.actorEmail" class="font-medium text-gray-900 dark:text-white">{{ log.actorEmail }}</span>
                  <span v-else-if="log.userId" class="font-mono text-xs text-gray-500">{{ log.userId.slice(0, 8) }}...</span>
                  <span v-else class="text-gray-400">--</span>
                </td>
                <td class="px-5 py-3.5 text-sm">
                  <div class="flex items-center gap-2">
                    <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', getBadgeClasses(log.eventType)]">
                      {{ formatEventType(log.eventType) }}
                    </span>
                    <component :is="expandedRow === log.id ? ChevronUp : ChevronDown" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  </div>
                  <p v-if="log.description" class="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">{{ log.description }}</p>
                </td>
                <td class="px-5 py-3.5 text-sm text-gray-600 dark:text-gray-400">
                  <span v-if="log.resourceName" class="font-medium">{{ log.resourceName }}</span>
                  <span v-else-if="log.resourceType" class="capitalize">{{ log.resourceType }}</span>
                  <span v-else>--</span>
                  <span v-if="log.resourceId" class="font-mono text-xs ml-1 text-gray-400">{{ log.resourceId.slice(0, 8) }}</span>
                </td>
                <td class="px-5 py-3.5 text-sm text-gray-600 dark:text-gray-400 font-mono text-xs">{{ log.accountId?.slice(0, 8) || '--' }}</td>
                <td class="px-5 py-3.5 text-sm text-gray-600 dark:text-gray-400 font-mono text-xs">{{ log.ipAddress || '--' }}</td>
              </tr>
              <!-- Expanded details -->
              <tr v-if="expandedRow === log.id">
                <td colspan="6" class="px-5 py-4 bg-gray-50 dark:bg-gray-900/50">
                  <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Raw Action</p>
                      <code class="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded font-mono text-gray-700 dark:text-gray-300">{{ log.action }}</code>
                    </div>
                    <div>
                      <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Source</p>
                      <span class="text-gray-700 dark:text-gray-300">{{ getSourceLabel(log.source) }}</span>
                    </div>
                    <div>
                      <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">User ID</p>
                      <code class="text-xs font-mono text-gray-500">{{ log.userId || '--' }}</code>
                    </div>
                    <div>
                      <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Account ID</p>
                      <code class="text-xs font-mono text-gray-500">{{ log.accountId || '--' }}</code>
                    </div>
                  </div>
                  <div v-if="log.details && Object.keys(log.details).length > 0" class="mt-3">
                    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Details</p>
                    <pre class="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded-lg overflow-x-auto font-mono text-gray-700 dark:text-gray-300">{{ JSON.stringify(log.details, null, 2) }}</pre>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('super.auditLog.pageOf', { page, total: totalPages }) }}</p>
        <div class="flex gap-2">
          <button @click="page--; fetchLogs()" :disabled="page <= 1" class="px-3 py-1.5 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">{{ $t('super.auditLog.previous') }}</button>
          <button @click="page++; fetchLogs()" :disabled="page >= totalPages" class="px-3 py-1.5 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">{{ $t('super.auditLog.next') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
