<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { Bug, CheckCircle, XCircle, RefreshCw, Filter, Loader2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const api = useApi()
const loading = ref(true)
const errors = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(25)
const levelFilter = ref('')
const resolvedFilter = ref<'' | 'true' | 'false'>('false')
const expandedRow = ref<string | null>(null)
const autoRefresh = ref(false)
const resolvingId = ref<string | null>(null)
const resolvingAll = ref(false)

let autoRefreshInterval: ReturnType<typeof setInterval> | null = null

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))

async function fetchErrors() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    params.set('page', String(page.value))
    params.set('limit', String(limit.value))
    if (levelFilter.value) params.set('level', levelFilter.value)
    if (resolvedFilter.value) params.set('resolved', resolvedFilter.value)
    const data = await api.get<any>(`/errors?${params.toString()}`)
    errors.value = data?.data ?? []
    total.value = data?.total ?? 0
  } catch {
    errors.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function resolveError(id: string) {
  resolvingId.value = id
  try {
    await api.patch(`/errors/${id}/resolve`, {})
    const item = errors.value.find((e) => e.id === id)
    if (item) item.resolved = true
  } finally {
    resolvingId.value = null
  }
}

async function resolveAll() {
  resolvingAll.value = true
  try {
    await api.post('/errors/resolve-all', {})
    errors.value.forEach((e) => (e.resolved = true))
  } finally {
    resolvingAll.value = false
  }
}

function toggleExpand(id: string) {
  expandedRow.value = expandedRow.value === id ? null : id
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value
  if (autoRefresh.value) {
    autoRefreshInterval = setInterval(fetchErrors, 10000)
  } else if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval)
    autoRefreshInterval = null
  }
}

function applyFilters() {
  page.value = 1
  fetchErrors()
}

function goToPage(p: number) {
  if (p < 1 || p > totalPages.value) return
  page.value = p
  fetchErrors()
}

function levelBadgeClass(level: string) {
  switch (level) {
    case 'fatal':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
    case 'error':
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    case 'warn':
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
    default:
      return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }
}

function formatDate(ts: any) {
  if (!ts) return '--'
  return new Date(ts).toLocaleString()
}

function truncate(str: string, len = 80) {
  if (!str) return '--'
  return str.length > len ? str.slice(0, len) + '...' : str
}

function formatJson(obj: any) {
  if (!obj) return 'null'
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

onMounted(() => {
  fetchErrors()
})

onUnmounted(() => {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval)
  }
})
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <Bug class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('super.errors.title') }}</h1>
      </div>
      <div class="flex items-center gap-3">
        <button
          @click="resolveAll"
          :disabled="resolvingAll"
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          <CheckCircle class="w-4 h-4" />
          <span v-if="resolvingAll">{{ $t('super.errors.resolving') }}</span>
          <span v-else>{{ $t('super.errors.resolveAll') }}</span>
        </button>
        <button
          @click="toggleAutoRefresh"
          :class="[
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border',
            autoRefresh
              ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
              : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
          ]"
        >
          <RefreshCw :class="['w-4 h-4', autoRefresh ? 'animate-spin' : '']" />
          {{ $t('super.errors.autoRefresh') }}
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 mb-6">
      <div class="flex items-center gap-4 flex-wrap">
        <div class="flex items-center gap-2">
          <Filter class="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('super.errors.filters') }}</span>
        </div>
        <select
          v-model="levelFilter"
          @change="applyFilters"
          class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        >
          <option value="">{{ $t('super.errors.allLevels') }}</option>
          <option value="fatal">{{ $t('super.errors.fatal') }}</option>
          <option value="error">{{ $t('super.errors.error') }}</option>
          <option value="warn">{{ $t('super.errors.warning') }}</option>
        </select>
        <select
          v-model="resolvedFilter"
          @change="applyFilters"
          class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        >
          <option value="">{{ $t('super.errors.allStatus') }}</option>
          <option value="false">{{ $t('super.errors.unresolved') }}</option>
          <option value="true">{{ $t('super.errors.resolved') }}</option>
        </select>
        <select
          v-model="limit"
          @change="applyFilters"
          class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        >
          <option :value="10">{{ $t('super.errors.perPage', { count: 10 }) }}</option>
          <option :value="25">{{ $t('super.errors.perPage', { count: 25 }) }}</option>
          <option :value="50">{{ $t('super.errors.perPage', { count: 50 }) }}</option>
          <option :value="100">{{ $t('super.errors.perPage', { count: 100 }) }}</option>
        </select>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <!-- Table -->
    <template v-else>
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div v-if="errors.length === 0" class="text-center py-12">
          <Bug class="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('super.errors.noErrors') }}</p>
        </div>

        <table v-else class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.timestamp') }}</th>
              <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.level') }}</th>
              <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.message') }}</th>
              <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.path') }}</th>
              <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.statusCode') }}</th>
              <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.resolvedCol') }}</th>
              <th class="text-right px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <template v-for="err in errors" :key="err.id">
              <!-- Main row -->
              <tr
                class="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                @click="toggleExpand(err.id)"
              >
                <td class="px-6 py-4 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">{{ formatDate(err.timestamp ?? err.createdAt) }}</td>
                <td class="px-6 py-4">
                  <span :class="['inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', levelBadgeClass(err.level)]">
                    {{ err.level }}
                  </span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-900 dark:text-gray-100 max-w-xs truncate">{{ truncate(err.message) }}</td>
                <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 font-mono whitespace-nowrap">{{ err.path ?? '--' }}</td>
                <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">{{ err.statusCode ?? '--' }}</td>
                <td class="px-6 py-4">
                  <CheckCircle v-if="err.resolved" class="w-5 h-5 text-green-500" />
                  <XCircle v-else class="w-5 h-5 text-red-500" />
                </td>
                <td class="px-6 py-4 text-right">
                  <button
                    v-if="!err.resolved"
                    @click.stop="resolveError(err.id)"
                    :disabled="resolvingId === err.id"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-xs font-medium hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors disabled:opacity-50"
                  >
                    <Loader2 v-if="resolvingId === err.id" class="w-3 h-3 animate-spin" />
                    <CheckCircle v-else class="w-3 h-3" />
                    {{ $t('super.errors.resolve') }}
                  </button>
                  <span v-else class="text-xs text-gray-400 dark:text-gray-500">{{ $t('super.errors.resolved') }}</span>
                </td>
              </tr>

              <!-- Expanded detail row -->
              <tr v-if="expandedRow === err.id">
                <td colspan="7" class="px-6 py-4 bg-gray-50 dark:bg-gray-900/50">
                  <div class="space-y-4">
                    <!-- Full message -->
                    <div>
                      <h4 class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">{{ $t('super.errors.fullMessage') }}</h4>
                      <p class="text-sm text-gray-900 dark:text-gray-100">{{ err.message }}</p>
                    </div>

                    <!-- Stack trace -->
                    <div v-if="err.stack">
                      <h4 class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">{{ $t('super.errors.stackTrace') }}</h4>
                      <pre class="text-xs text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words">{{ err.stack }}</pre>
                    </div>

                    <!-- Metadata -->
                    <div v-if="err.metadata">
                      <h4 class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">{{ $t('super.errors.metadata') }}</h4>
                      <pre class="text-xs text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words">{{ formatJson(err.metadata) }}</pre>
                    </div>

                    <!-- Additional info -->
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div v-if="err.userId || err.user">
                        <h4 class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">{{ $t('super.errors.user') }}</h4>
                        <p class="text-sm text-gray-900 dark:text-gray-100">{{ err.user?.email ?? err.userId ?? '--' }}</p>
                      </div>
                      <div v-if="err.ip">
                        <h4 class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">{{ $t('super.errors.ipAddress') }}</h4>
                        <p class="text-sm font-mono text-gray-900 dark:text-gray-100">{{ err.ip }}</p>
                      </div>
                      <div v-if="err.userAgent">
                        <h4 class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">{{ $t('super.errors.userAgent') }}</h4>
                        <p class="text-sm text-gray-900 dark:text-gray-100 truncate" :title="err.userAgent">{{ err.userAgent }}</p>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="errors.length > 0" class="flex items-center justify-between mt-4">
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ $t('super.errors.showing', { from: (page - 1) * limit + 1, to: Math.min(page * limit, total), total }) }}
        </p>
        <div class="flex items-center gap-2">
          <button
            @click="goToPage(page - 1)"
            :disabled="page <= 1"
            class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {{ $t('super.errors.previous') }}
          </button>
          <span class="text-sm text-gray-700 dark:text-gray-300">
            {{ $t('super.errors.pageOf', { page, total: totalPages }) }}
          </span>
          <button
            @click="goToPage(page + 1)"
            :disabled="page >= totalPages"
            class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {{ $t('super.errors.next') }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
