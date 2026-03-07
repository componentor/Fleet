<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { Bug, CheckCircle, RefreshCw, Filter, Archive, Copy, Check, Bot, Clock, X } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import LogArchiveList from '@/components/LogArchiveList.vue'

const { t } = useI18n()
const router = useRouter()
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
const viewMode = ref<'errors' | 'archives'>('errors')

// Self-heal modal
const showSelfHealModal = ref(false)
const selfHealErrorId = ref<string | null>(null)
const selfHealError = ref<any>(null)
const selfHealContext = ref('')
const selfHealAutoMerge = ref(false)
const selfHealAutoRelease = ref(false)
const selfHealAutoUpdate = ref(false)
const selfHealReleaseType = ref<'alpha' | 'release'>('release')
const selfHealing = ref(false)

let autoRefreshInterval: ReturnType<typeof setInterval> | null = null

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))

/** Client-side filtered errors — hides resolved rows reactively when filter is active. */
const filteredErrors = computed(() => {
  if (resolvedFilter.value === 'false') {
    return errors.value.filter((e) => !e.resolved)
  }
  if (resolvedFilter.value === 'true') {
    return errors.value.filter((e) => e.resolved)
  }
  return errors.value
})

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

const copiedId = ref<string | null>(null)

function formatJson(obj: any) {
  if (!obj) return 'null'
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

function copyErrorData(err: any) {
  const data = {
    level: err.level,
    message: err.message,
    method: err.method ?? null,
    path: err.path ?? null,
    statusCode: err.statusCode ?? null,
    stack: err.stack ?? null,
    timestamp: err.timestamp ?? err.createdAt,
    userId: err.userId ?? null,
    ip: err.ip ?? null,
    userAgent: err.userAgent ?? null,
    metadata: err.metadata ?? null,
  }
  navigator.clipboard.writeText(JSON.stringify(data, null, 2))
  copiedId.value = err.id
  setTimeout(() => { copiedId.value = null }, 2000)
}

function openSelfHealModal(err: any) {
  selfHealErrorId.value = err.id
  selfHealError.value = err
  selfHealContext.value = ''
  showSelfHealModal.value = true
}

function closeSelfHealModal() {
  showSelfHealModal.value = false
  selfHealErrorId.value = null
  selfHealError.value = null
  selfHealContext.value = ''
}

async function confirmSelfHeal() {
  if (!selfHealErrorId.value) return
  selfHealing.value = true
  try {
    await api.post(`/errors/${selfHealErrorId.value}/self-heal`, {
      context: selfHealContext.value || undefined,
      options: {
        autoMerge: selfHealAutoMerge.value,
        autoRelease: selfHealAutoRelease.value,
        autoUpdate: selfHealAutoUpdate.value,
        releaseType: selfHealReleaseType.value,
      },
    })
    const item = errors.value.find((e) => e.id === selfHealErrorId.value)
    if (item) item.status = 'self_healing'
    closeSelfHealModal()
  } finally {
    selfHealing.value = false
  }
}

async function setErrorPending(id: string) {
  try {
    await api.patch(`/errors/${id}/pending`, {})
    const item = errors.value.find((e) => e.id === id)
    if (item) item.status = 'pending'
  } catch {
    // handled by useApi toast
  }
}

function errorStatusBadge(err: any) {
  const status = err.status || (err.resolved ? 'resolved' : 'open')
  switch (status) {
    case 'self_healing':
      return { class: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300', label: t('super.settings.selfHealing.selfHeal') }
    case 'pending':
      return { class: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300', label: t('super.errors.pending') }
    case 'resolved':
      return { class: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300', label: t('super.errors.resolved') }
    default:
      return { class: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300', label: t('super.errors.unresolved') }
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
          @click="viewMode = viewMode === 'errors' ? 'archives' : 'errors'"
          :class="[
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border',
            viewMode === 'archives'
              ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
              : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
          ]"
        >
          <Archive class="w-4 h-4" />
          {{ $t('logArchives.title') }}
        </button>
        <button
          v-if="viewMode === 'errors'"
          @click="resolveAll"
          :disabled="resolvingAll"
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          <CheckCircle class="w-4 h-4" />
          <span v-if="resolvingAll">{{ $t('super.errors.resolving') }}</span>
          <span v-else>{{ $t('super.errors.resolveAll') }}</span>
        </button>
        <button
          v-if="viewMode === 'errors'"
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

    <!-- Archives view -->
    <LogArchiveList
      v-if="viewMode === 'archives'"
      api-base-path="/log-archives?logType=error"
      :show-type="false"
      :show-delete="true"
    />

    <!-- Errors view -->
    <template v-else>
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
        <CompassSpinner size="w-16 h-16" />
      </div>

      <!-- Table -->
      <template v-else>
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-x-auto">
          <div v-if="filteredErrors.length === 0" class="text-center py-12">
            <Bug class="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('super.errors.noErrors') }}</p>
          </div>

          <table v-else class="w-full min-w-[900px]">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.timestamp') }}</th>
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.level') }}</th>
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.message') }}</th>
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.path') }}</th>
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.statusCode') }}</th>
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.statusCol') }}</th>
                <th class="text-right px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.errors.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <template v-for="err in filteredErrors" :key="err.id">
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
                  <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 font-mono whitespace-nowrap">
                    <span v-if="err.method" class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold mr-1.5" :class="{
                      'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300': err.method === 'GET',
                      'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300': err.method === 'POST',
                      'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300': err.method === 'PATCH' || err.method === 'PUT',
                      'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300': err.method === 'DELETE',
                      'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300': !['GET','POST','PATCH','PUT','DELETE'].includes(err.method),
                    }">{{ err.method }}</span>{{ err.path ?? '--' }}
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">{{ err.statusCode ?? '--' }}</td>
                  <td class="px-6 py-4">
                    <span :class="['inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', errorStatusBadge(err).class]">
                      {{ errorStatusBadge(err).label }}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-right">
                    <div class="flex items-center justify-end gap-2">
                      <button
                        @click.stop="copyErrorData(err)"
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                        :title="$t('common.copy')"
                      >
                        <Check v-if="copiedId === err.id" class="w-3 h-3 text-green-500" />
                        <Copy v-else class="w-3 h-3" />
                      </button>
                      <button
                        v-if="!err.resolved && err.status !== 'self_healing'"
                        @click.stop="openSelfHealModal(err)"
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                      >
                        <Bot class="w-3 h-3" />
                        {{ $t('super.settings.selfHealing.selfHeal') }}
                      </button>
                      <button
                        v-if="!err.resolved && err.status !== 'pending' && err.status !== 'self_healing'"
                        @click.stop="setErrorPending(err.id)"
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 text-xs font-medium hover:bg-yellow-100 dark:hover:bg-yellow-900/40 transition-colors"
                      >
                        <Clock class="w-3 h-3" />
                        {{ $t('super.errors.pending') }}
                      </button>
                      <button
                        v-if="!err.resolved"
                        @click.stop="resolveError(err.id)"
                        :disabled="resolvingId === err.id"
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-xs font-medium hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors disabled:opacity-50"
                      >
                        <CompassSpinner v-if="resolvingId === err.id" size="w-3 h-3" />
                        <CheckCircle v-else class="w-3 h-3" />
                        {{ $t('super.errors.resolve') }}
                      </button>
                      <span v-if="err.resolved" class="text-xs text-gray-400 dark:text-gray-500">{{ $t('super.errors.resolved') }}</span>
                    </div>
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

                      <!-- HTTP Headers -->
                      <div v-if="err.metadata?.headers && Object.keys(err.metadata.headers).length > 0">
                        <h4 class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">HTTP Headers</h4>
                        <div class="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto">
                          <table class="text-xs font-mono">
                            <tr v-for="(value, key) in err.metadata.headers" :key="key" class="align-top">
                              <td class="pr-3 py-0.5 text-gray-500 dark:text-gray-400 whitespace-nowrap select-all">{{ key }}</td>
                              <td class="py-0.5 text-gray-800 dark:text-gray-200 break-all select-all">{{ value }}</td>
                            </tr>
                          </table>
                        </div>
                      </div>

                      <!-- Request Body -->
                      <div v-if="err.metadata?.body && Object.keys(err.metadata.body).length > 0">
                        <h4 class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Request Body</h4>
                        <pre class="text-xs text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words">{{ formatJson(err.metadata.body) }}</pre>
                      </div>

                      <!-- Metadata (excluding headers and body which are shown above) -->
                      <div v-if="err.metadata && Object.keys(err.metadata).filter(k => k !== 'headers' && k !== 'body').length > 0">
                        <h4 class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">{{ $t('super.errors.metadata') }}</h4>
                        <pre class="text-xs text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-words">{{ formatJson(Object.fromEntries(Object.entries(err.metadata).filter(([k]) => k !== 'headers' && k !== 'body'))) }}</pre>
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
        <div v-if="filteredErrors.length > 0" class="flex items-center justify-between mt-4">
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
    </template>
    <!-- Self-Heal Confirmation Modal -->
    <Teleport to="body">
      <div v-if="showSelfHealModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50" @click="closeSelfHealModal" />
        <div class="relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl max-w-lg w-full">
          <!-- Modal header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-2">
              <Bot class="w-5 h-5 text-primary-600 dark:text-primary-400" />
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.selfHealing.confirmSelfHeal') }}</h3>
            </div>
            <button @click="closeSelfHealModal" class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
              <X class="w-5 h-5" />
            </button>
          </div>

          <!-- Modal body -->
          <div class="px-6 py-4 space-y-4">
            <p class="text-sm text-gray-600 dark:text-gray-400">{{ $t('super.settings.selfHealing.confirmSelfHealDesc') }}</p>

            <!-- Error preview -->
            <div v-if="selfHealError" class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <div class="flex items-center gap-2 mb-1">
                <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium', levelBadgeClass(selfHealError.level)]">{{ selfHealError.level }}</span>
                <span v-if="selfHealError.path" class="text-xs text-gray-500 dark:text-gray-400 font-mono">{{ selfHealError.path }}</span>
              </div>
              <p class="text-sm text-red-700 dark:text-red-300">{{ truncate(selfHealError.message, 200) }}</p>
            </div>

            <!-- Additional context -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Additional context (optional)</label>
              <textarea
                v-model="selfHealContext"
                rows="3"
                placeholder="Add any extra context to help the AI fix this issue..."
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
              />
            </div>

            <!-- Options -->
            <div class="space-y-3">
              <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input v-model="selfHealAutoMerge" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                {{ $t('super.settings.selfHealing.autoMerge') }}
                <span class="text-xs text-gray-500">— {{ $t('super.settings.selfHealing.autoMergeDesc') }}</span>
              </label>
              <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input v-model="selfHealAutoRelease" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                {{ $t('super.settings.selfHealing.autoRelease') }}
                <span class="text-xs text-gray-500">— {{ $t('super.settings.selfHealing.autoReleaseDesc') }}</span>
              </label>
              <div v-if="selfHealAutoRelease" class="flex items-center gap-3 pl-6">
                <label class="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
                  <input v-model="selfHealReleaseType" type="radio" value="alpha" class="text-primary-600 focus:ring-primary-500" />
                  {{ $t('super.settings.selfHealing.alpha') }}
                </label>
                <label class="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
                  <input v-model="selfHealReleaseType" type="radio" value="release" class="text-primary-600 focus:ring-primary-500" />
                  {{ $t('super.settings.selfHealing.release') }}
                </label>
              </div>
              <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input v-model="selfHealAutoUpdate" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                {{ $t('super.settings.selfHealing.autoUpdate') }}
                <span class="text-xs text-gray-500">— {{ $t('super.settings.selfHealing.autoUpdateDesc') }}</span>
              </label>
            </div>
          </div>

          <!-- Modal footer -->
          <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
            <button
              @click="closeSelfHealModal"
              class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {{ $t('common.cancel') }}
            </button>
            <button
              @click="confirmSelfHeal"
              :disabled="selfHealing"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <CompassSpinner v-if="selfHealing" size="w-4 h-4" />
              <Bot v-else class="w-4 h-4" />
              {{ $t('super.settings.selfHealing.selfHeal') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
