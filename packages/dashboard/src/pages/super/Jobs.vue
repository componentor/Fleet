<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import {
  Clock,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Pause,
  Play,
  Trash2,
  RefreshCw,
  Eye,
  ListFilter,
  Timer,
  Zap,
  Mail,
  Database,
  Server,
} from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'

const { t } = useI18n()
const api = useApi()
const router = useRouter()
const toast = useToast()

// --- Queue overview ---
const queues = ref<any[]>([])
const queuesLoading = ref(true)

// --- Jobs table ---
const jobs = ref<any[]>([])
const jobsLoading = ref(true)
const page = ref(1)
const totalPages = ref(1)
const total = ref(0)

const filters = reactive({
  queue: '',
  status: '',
})

const queueOptions = [
  { value: '', labelKey: 'jobs.allQueues' },
  { value: 'deployment', labelKey: 'jobs.deployment' },
  { value: 'backup', labelKey: 'jobs.backup' },
  { value: 'maintenance', labelKey: 'jobs.maintenance' },
  { value: 'email', labelKey: 'jobs.email' },
]

const statusOptions = [
  { value: '', labelKey: 'jobs.allStatuses' },
  { value: 'waiting', labelKey: 'jobs.waiting' },
  { value: 'active', labelKey: 'jobs.active' },
  { value: 'completed', labelKey: 'jobs.completed' },
  { value: 'failed', labelKey: 'jobs.failed' },
  { value: 'delayed', labelKey: 'jobs.delayed' },
]

function queueIcon(name: string) {
  switch (name) {
    case 'deployment': return Zap
    case 'backup': return Database
    case 'maintenance': return Server
    case 'email': return Mail
    default: return Clock
  }
}

function queueIconColor(name: string) {
  switch (name) {
    case 'deployment': return 'text-blue-600 dark:text-blue-400'
    case 'backup': return 'text-green-600 dark:text-green-400'
    case 'maintenance': return 'text-purple-600 dark:text-purple-400'
    case 'email': return 'text-amber-600 dark:text-amber-400'
    default: return 'text-gray-600 dark:text-gray-400'
  }
}

function queueIconBg(name: string) {
  switch (name) {
    case 'deployment': return 'bg-blue-50 dark:bg-blue-900/20'
    case 'backup': return 'bg-green-50 dark:bg-green-900/20'
    case 'maintenance': return 'bg-purple-50 dark:bg-purple-900/20'
    case 'email': return 'bg-amber-50 dark:bg-amber-900/20'
    default: return 'bg-gray-50 dark:bg-gray-900/20'
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'waiting':
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
    case 'active':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    case 'completed':
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    case 'failed':
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    case 'delayed':
      return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
    default:
      return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
  }
}

function statusIcon(status: string) {
  switch (status) {
    case 'waiting': return Clock
    case 'active': return PlayCircle
    case 'completed': return CheckCircle2
    case 'failed': return XCircle
    case 'delayed': return Timer
    default: return Clock
  }
}

function formatDate(ts: any) {
  if (!ts) return '--'
  return new Date(ts).toLocaleString()
}

function formatDuration(ms: number | null | undefined) {
  if (!ms && ms !== 0) return '--'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

// --- Fetch queues ---
async function fetchQueues() {
  try {
    const data = await api.get<any>('/admin/jobs/queues')
    const raw = data?.data ?? data?.queues ?? (Array.isArray(data) ? data : [])
    // Flatten nested counts to top-level so the template can use queue.waiting, queue.active, etc.
    const incoming = raw.map((q: any) => ({
      ...q,
      waiting: q.counts?.waiting ?? q.waiting ?? 0,
      active: q.counts?.active ?? q.active ?? 0,
      completed: q.counts?.completed ?? q.completed ?? 0,
      failed: q.counts?.failed ?? q.failed ?? 0,
      delayed: q.counts?.delayed ?? q.delayed ?? 0,
    }))
    // Merge: update existing queue cards in-place, avoiding full re-render
    if (queues.value.length === 0) {
      queues.value = incoming
    } else {
      for (const q of incoming) {
        const existing = queues.value.find((e: any) => e.name === q.name)
        if (existing) {
          Object.assign(existing, q)
        } else {
          queues.value.push(q)
        }
      }
      // Remove queues that no longer exist
      queues.value = queues.value.filter((e: any) => incoming.some((q: any) => q.name === e.name))
    }
  } catch {
    // Don't wipe on poll failure
    if (queues.value.length === 0) queues.value = []
  } finally {
    queuesLoading.value = false
  }
}

// --- Fetch jobs ---
async function fetchJobs(silent = false) {
  if (!silent) jobsLoading.value = true
  try {
    const params = new URLSearchParams({ page: page.value.toString(), limit: '25' })
    if (filters.queue) params.set('queue', filters.queue)
    if (filters.status) params.set('status', filters.status)

    const data = await api.get<any>(`/admin/jobs?${params}`)
    const incoming: any[] = data?.data ?? data?.jobs ?? []
    totalPages.value = data?.pagination?.totalPages ?? 1
    total.value = data?.pagination?.total ?? 0

    if (!silent || jobs.value.length === 0) {
      // Full replace on initial load or filter change
      jobs.value = incoming
    } else {
      // Graceful merge: update existing, add new, remove stale
      const incomingKeys = new Set(incoming.map((j: any) => `${j.queue}-${j.id}`))
      const existingKeys = new Set(jobs.value.map((j: any) => `${j.queue}-${j.id}`))

      // Update existing jobs in-place
      for (const job of incoming) {
        const key = `${job.queue}-${job.id}`
        if (existingKeys.has(key)) {
          const idx = jobs.value.findIndex((j: any) => `${j.queue}-${j.id}` === key)
          if (idx !== -1) Object.assign(jobs.value[idx], job)
        }
      }

      // Prepend new jobs that weren't in the previous list
      const newJobs = incoming.filter((j: any) => !existingKeys.has(`${j.queue}-${j.id}`))
      if (newJobs.length > 0) {
        jobs.value.unshift(...newJobs)
      }

      // Remove jobs no longer in the response
      jobs.value = jobs.value.filter((j: any) => incomingKeys.has(`${j.queue}-${j.id}`))
    }
  } catch {
    // Don't wipe on poll failure
    if (jobs.value.length === 0) jobs.value = []
  } finally {
    jobsLoading.value = false
  }
}

function onFilterChange() {
  page.value = 1
  fetchJobs()
}

// --- Actions ---
async function retryJob(job: any) {
  try {
    await api.post(`/admin/jobs/${job.queue}/${job.id}/retry`, {})
    toast.success(t('jobs.jobRetried'))
    fetchJobs()
    fetchQueues()
  } catch {
    // Error is handled by useApi toast
  }
}

async function removeJob(job: any) {
  if (!confirm(t('jobs.confirmRemove'))) return
  try {
    await api.del(`/admin/jobs/${job.queue}/${job.id}`)
    toast.success(t('jobs.jobRemoved'))
    fetchJobs()
    fetchQueues()
  } catch {
    // Error is handled by useApi toast
  }
}

async function toggleQueuePause(queue: any) {
  try {
    if (queue.isPaused) {
      await api.post(`/admin/jobs/queues/${queue.name}/resume`, {})
      toast.success(t('jobs.queueResumed'))
    } else {
      await api.post(`/admin/jobs/queues/${queue.name}/pause`, {})
      toast.success(t('jobs.queuePaused'))
    }
    fetchQueues()
  } catch {
    // Error is handled by useApi toast
  }
}

async function cleanQueue(queue: any, status: string = 'completed') {
  const msg = t('jobs.confirmClean', { status })
  if (!confirm(msg)) return
  try {
    await api.post(`/admin/jobs/queues/${queue.name}/clean`, { status })
    toast.success(t('jobs.cleanCompleted'))
    fetchJobs()
    fetchQueues()
  } catch {
    // Error is handled by useApi toast
  }
}

function viewJob(job: any) {
  router.push({ name: 'super-job-detail', params: { queue: job.queue, id: job.id } })
}

// --- Auto-refresh ---
let refreshInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  fetchQueues()
  fetchJobs()
  refreshInterval = setInterval(() => {
    fetchQueues()
    fetchJobs(true)
  }, 5000)
})

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
})
</script>

<template>
  <div>
    <!-- Page header -->
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-6">
      <div class="flex items-center gap-3">
        <ListFilter class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('jobs.title') }}</h1>
          <p v-if="!jobsLoading" class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{{ total.toLocaleString() }} {{ t('jobs.title').toLowerCase() }}</p>
        </div>
      </div>
      <button
        @click="fetchQueues(); fetchJobs()"
        class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <RefreshCw class="w-4 h-4" />
        {{ t('common.refresh') }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="queuesLoading && jobsLoading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <template v-else>
      <!-- Queue overview cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div
          v-for="queue in queues"
          :key="queue.name"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
        >
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <div :class="[queueIconBg(queue.name), 'p-2.5 rounded-lg']">
                <component :is="queueIcon(queue.name)" :class="[queueIconColor(queue.name), 'w-5 h-5']" />
              </div>
              <div>
                <p class="text-sm font-semibold text-gray-900 dark:text-white capitalize">{{ queue.name }}</p>
                <p v-if="queue.isPaused" class="text-xs text-amber-600 dark:text-amber-400 font-medium">{{ t('jobs.paused') }}</p>
              </div>
            </div>
            <div class="flex items-center gap-1">
              <button
                @click="toggleQueuePause(queue)"
                class="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                :title="queue.isPaused ? t('jobs.resumeQueue') : t('jobs.pauseQueue')"
              >
                <Play v-if="queue.isPaused" class="w-4 h-4" />
                <Pause v-else class="w-4 h-4" />
              </button>
            </div>
          </div>

          <div class="grid grid-cols-5 gap-1 text-center">
            <div>
              <p class="text-lg font-bold text-yellow-600 dark:text-yellow-400 tabular-nums">{{ queue.waiting ?? 0 }}</p>
              <p class="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('jobs.waiting') }}</p>
            </div>
            <div>
              <p class="text-lg font-bold text-blue-600 dark:text-blue-400 tabular-nums">{{ queue.active ?? 0 }}</p>
              <p class="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('jobs.active') }}</p>
            </div>
            <div>
              <p class="text-lg font-bold text-green-600 dark:text-green-400 tabular-nums">{{ queue.completed ?? 0 }}</p>
              <p class="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('jobs.completed') }}</p>
            </div>
            <div>
              <p class="text-lg font-bold text-red-600 dark:text-red-400 tabular-nums">{{ queue.failed ?? 0 }}</p>
              <p class="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('jobs.failed') }}</p>
            </div>
            <div>
              <p class="text-lg font-bold text-gray-500 dark:text-gray-400 tabular-nums">{{ queue.delayed ?? 0 }}</p>
              <p class="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('jobs.delayed') }}</p>
            </div>
          </div>

          <div class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex gap-2">
            <button
              @click="cleanQueue(queue, 'completed')"
              class="flex-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-md px-2 py-1.5 transition-colors"
            >
              {{ t('jobs.cleanCompleted') }}
            </button>
            <button
              @click="cleanQueue(queue, 'failed')"
              class="flex-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md px-2 py-1.5 transition-colors"
            >
              {{ t('jobs.cleanFailed') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="mb-6 flex flex-wrap items-center gap-4">
        <div>
          <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">{{ t('jobs.queue') }}</label>
          <select
            v-model="filters.queue"
            @change="onFilterChange"
            class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option v-for="opt in queueOptions" :key="opt.value" :value="opt.value">{{ t(opt.labelKey) }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">{{ t('jobs.status') }}</label>
          <select
            v-model="filters.status"
            @change="onFilterChange"
            class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">{{ t(opt.labelKey) }}</option>
          </select>
        </div>
      </div>

      <!-- Jobs table -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <!-- Loading spinner only on initial load (no data yet) -->
        <div v-if="jobsLoading && jobs.length === 0" class="flex items-center justify-center py-12">
          <CompassSpinner />
        </div>

        <template v-else>
          <div v-if="jobs.length === 0" class="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
            {{ t('jobs.noJobs') }}
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700">
                  <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('jobs.jobId') }}</th>
                  <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('jobs.queue') }}</th>
                  <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('jobs.jobName') }}</th>
                  <th class="px-5 py-3.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('jobs.status') }}</th>
                  <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('jobs.created') }}</th>
                  <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('jobs.scheduledAt') }}</th>
                  <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('jobs.duration') }}</th>
                  <th class="px-5 py-3.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('jobs.actions') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr
                  v-for="job in jobs"
                  :key="`${job.queue}-${job.id}`"
                  class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer"
                  @click="viewJob(job)"
                >
                  <td class="px-5 py-3.5 text-sm font-mono text-gray-600 dark:text-gray-400">{{ job.id }}</td>
                  <td class="px-5 py-3.5">
                    <span class="text-sm font-medium text-gray-900 dark:text-white capitalize">{{ job.queue }}</span>
                  </td>
                  <td class="px-5 py-3.5 text-sm text-gray-700 dark:text-gray-300">{{ job.name ?? '--' }}</td>
                  <td class="px-5 py-3.5 text-center">
                    <span :class="['inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full', statusColor(job.status)]">
                      <component :is="statusIcon(job.status)" class="w-3 h-3" />
                      {{ job.status }}
                    </span>
                  </td>
                  <td class="px-5 py-3.5 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">{{ formatDate(job.createdAt ?? job.timestamp) }}</td>
                  <td class="px-5 py-3.5 text-sm whitespace-nowrap">
                    <span v-if="job.timestamps?.scheduledAt" class="text-amber-600 dark:text-amber-400">{{ formatDate(job.timestamps.scheduledAt) }}</span>
                    <span v-else class="text-gray-400 dark:text-gray-500">--</span>
                  </td>
                  <td class="px-5 py-3.5 text-sm text-gray-500 dark:text-gray-400 font-mono">{{ formatDuration(job.duration ?? job.processedTime) }}</td>
                  <td class="px-5 py-3.5 text-center" @click.stop>
                    <div class="flex items-center justify-center gap-1">
                      <button
                        @click="viewJob(job)"
                        class="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        :title="t('common.details')"
                      >
                        <Eye class="w-4 h-4" />
                      </button>
                      <button
                        v-if="job.status === 'failed'"
                        @click="retryJob(job)"
                        class="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        :title="t('jobs.retry')"
                      >
                        <RefreshCw class="w-4 h-4" />
                      </button>
                      <button
                        @click="removeJob(job)"
                        class="p-1.5 rounded-lg text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        :title="t('jobs.remove')"
                      >
                        <Trash2 class="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div v-if="totalPages > 1" class="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('super.auditLog.pageOf', { page, total: totalPages }) }}</p>
            <div class="flex gap-2">
              <button
                @click="page--; fetchJobs()"
                :disabled="page <= 1"
                class="px-3 py-1.5 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {{ t('common.previous') }}
              </button>
              <button
                @click="page++; fetchJobs()"
                :disabled="page >= totalPages"
                class="px-3 py-1.5 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {{ t('common.next') }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
