<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import {
  ArrowLeft,
  Clock,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Timer,
  RefreshCw,
  Trash2,
  FastForward,
} from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'

const props = defineProps<{
  queue: string
  id: string
}>()

const { t } = useI18n()
const api = useApi()
const router = useRouter()
const toast = useToast()

const job = ref<any>(null)
const loading = ref(true)

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

const progressPercent = computed(() => {
  if (!job.value?.progress) return null
  if (typeof job.value.progress === 'number') return job.value.progress
  if (typeof job.value.progress === 'object' && job.value.progress.percentage != null) return job.value.progress.percentage
  return null
})

async function fetchJob() {
  loading.value = true
  try {
    const data = await api.get<any>(`/admin/jobs/${props.queue}/${props.id}`)
    job.value = data
  } catch {
    job.value = null
  } finally {
    loading.value = false
  }
}

async function retryJob() {
  try {
    await api.post(`/admin/jobs/${props.queue}/${props.id}/retry`, {})
    toast.success(t('jobs.jobRetried'))
    fetchJob()
  } catch {
    // Error is handled by useApi toast
  }
}

async function removeJob() {
  if (!confirm(t('jobs.confirmRemove'))) return
  try {
    await api.del(`/admin/jobs/${props.queue}/${props.id}`)
    toast.success(t('jobs.jobRemoved'))
    router.push({ name: 'super-jobs' })
  } catch {
    // Error is handled by useApi toast
  }
}

async function promoteJob() {
  try {
    await api.post(`/admin/jobs/${props.queue}/${props.id}/promote`, {})
    toast.success(t('jobs.jobPromoted'))
    fetchJob()
  } catch {
    // Error is handled by useApi toast
  }
}

onMounted(() => {
  fetchJob()
})
</script>

<template>
  <div>
    <!-- Back button and header -->
    <div class="flex items-center gap-4 mb-6">
      <button
        @click="router.push({ name: 'super-jobs' })"
        class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <ArrowLeft class="w-4 h-4" />
        {{ t('jobs.backToJobs') }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <!-- Not found -->
    <div v-else-if="!job" class="text-center py-20">
      <p class="text-gray-500 dark:text-gray-400">Job not found</p>
    </div>

    <template v-else>
      <!-- Job header card -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 mb-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-3 mb-2">
              <h1 class="text-xl font-bold text-gray-900 dark:text-white">{{ t('jobs.jobDetail') }}</h1>
              <span :class="['inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full', statusColor(job.status)]">
                <component :is="statusIcon(job.status)" class="w-3.5 h-3.5" />
                {{ job.status }}
              </span>
            </div>
            <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600 dark:text-gray-400">
              <span class="break-all"><span class="font-medium text-gray-700 dark:text-gray-300">{{ t('jobs.jobId') }}:</span> {{ job.id }}</span>
              <span><span class="font-medium text-gray-700 dark:text-gray-300">{{ t('jobs.queue') }}:</span> <span class="capitalize">{{ job.queue ?? queue }}</span></span>
              <span v-if="job.name"><span class="font-medium text-gray-700 dark:text-gray-300">{{ t('jobs.jobName') }}:</span> {{ job.name }}</span>
              <span v-if="job.attempts != null"><span class="font-medium text-gray-700 dark:text-gray-300">{{ t('jobs.attempts') }}:</span> {{ job.attempts }}</span>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 shrink-0">
            <button
              v-if="job.status === 'failed'"
              @click="retryJob"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
            >
              <RefreshCw class="w-4 h-4" />
              {{ t('jobs.retry') }}
            </button>
            <button
              v-if="job.status === 'delayed'"
              @click="promoteJob"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
            >
              <FastForward class="w-4 h-4" />
              {{ t('jobs.promote') }}
            </button>
            <button
              @click="removeJob"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
            >
              <Trash2 class="w-4 h-4" />
              {{ t('jobs.remove') }}
            </button>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Timestamps -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('jobs.timestamps') }}</h2>
          </div>
          <div class="p-6 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('jobs.created') }}</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">{{ formatDate(job.createdAt ?? job.timestamp) }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('jobs.processedAt') }}</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">{{ formatDate(job.processedOn ?? job.processedAt) }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('jobs.finishedAt') }}</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">{{ formatDate(job.finishedOn ?? job.finishedAt) }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('jobs.duration') }}</span>
              <span class="text-sm font-mono font-medium text-gray-900 dark:text-white">{{ formatDuration(job.duration ?? job.processedTime) }}</span>
            </div>
            <div v-if="job.attempts != null" class="flex items-center justify-between">
              <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('jobs.attempts') }}</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">{{ job.attempts }}</span>
            </div>
          </div>
        </div>

        <!-- Progress -->
        <div v-if="progressPercent !== null" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('jobs.progress') }}</h2>
          </div>
          <div class="p-6">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('jobs.progress') }}</span>
              <span class="text-sm font-bold text-gray-900 dark:text-white">{{ progressPercent }}%</span>
            </div>
            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
              <div
                class="bg-primary-600 dark:bg-primary-500 h-3 rounded-full transition-all duration-500"
                :style="{ width: `${progressPercent}%` }"
              />
            </div>
          </div>
        </div>

        <!-- Payload -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm" :class="{ 'lg:col-span-2': progressPercent === null }">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('jobs.payload') }}</h2>
          </div>
          <div class="p-6">
            <pre v-if="job.data && Object.keys(job.data).length > 0" class="text-xs bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg overflow-x-auto font-mono text-gray-700 dark:text-gray-300 max-h-80 overflow-y-auto">{{ JSON.stringify(job.data, null, 2) }}</pre>
            <p v-else class="text-sm text-gray-400 dark:text-gray-500">--</p>
          </div>
        </div>

        <!-- Result (completed jobs) -->
        <div v-if="job.status === 'completed' && job.returnvalue != null" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('jobs.result') }}</h2>
          </div>
          <div class="p-6">
            <pre class="text-xs bg-green-50 dark:bg-green-900/20 p-4 rounded-lg overflow-x-auto font-mono text-green-800 dark:text-green-300 max-h-80 overflow-y-auto">{{ typeof job.returnvalue === 'string' ? job.returnvalue : JSON.stringify(job.returnvalue, null, 2) }}</pre>
          </div>
        </div>

        <!-- Error (failed jobs) -->
        <div v-if="job.status === 'failed'" class="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-800 shadow-sm lg:col-span-2">
          <div class="px-6 py-4 border-b border-red-200 dark:border-red-800">
            <h2 class="text-lg font-semibold text-red-700 dark:text-red-400">{{ t('jobs.error') }}</h2>
          </div>
          <div class="p-6 space-y-4">
            <div v-if="job.failedReason">
              <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">{{ t('jobs.error') }}</p>
              <p class="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 px-4 py-3 rounded-lg">{{ job.failedReason }}</p>
            </div>
            <div v-if="job.stacktrace && job.stacktrace.length > 0">
              <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">{{ t('jobs.stacktrace') }}</p>
              <pre class="text-xs bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg overflow-x-auto font-mono text-gray-700 dark:text-gray-300 max-h-80 overflow-y-auto whitespace-pre-wrap">{{ Array.isArray(job.stacktrace) ? job.stacktrace.join('\n') : job.stacktrace }}</pre>
            </div>
          </div>
        </div>

        <!-- Logs -->
        <div v-if="job.logs && job.logs.length > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm lg:col-span-2">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('jobs.logs') }}</h2>
          </div>
          <div class="p-6">
            <pre class="text-xs bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg overflow-x-auto font-mono text-gray-700 dark:text-gray-300 max-h-80 overflow-y-auto whitespace-pre-wrap">{{ Array.isArray(job.logs) ? job.logs.join('\n') : job.logs }}</pre>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
