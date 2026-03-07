<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  Bot,
  Send,
  Terminal as TerminalIcon,
  Trash2,
  XCircle,
  ExternalLink,
  RefreshCw,
  Settings,
  CheckCircle,
  Clock,
  AlertTriangle,
  GitBranch,
  X,
} from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useTerminal } from '@/composables/useTerminal'

const { t } = useI18n()
const router = useRouter()
const api = useApi()

// Job list
const jobs = ref<any[]>([])
const loading = ref(true)
const totalJobs = ref(0)
const page = ref(1)
const limit = ref(20)

// Create job form
const prompt = ref('')
const autoMerge = ref(false)
const autoRelease = ref(false)
const autoUpdate = ref(false)
const releaseType = ref<'alpha' | 'release'>('release')
const creating = ref(false)
const notConfigured = ref(false)

// Job detail
const selectedJob = ref<any | null>(null)
const loadingDetail = ref(false)

// Terminal modal
const showTerminal = ref(false)
const terminalJobId = ref<string | null>(null)
const {
  terminalRef,
  connectionState,
  createTerminal,
  connect: terminalConnect,
  dispose: terminalDispose,
} = useTerminal()

// Auto-refresh
const autoRefresh = ref(true)
let refreshInterval: ReturnType<typeof setInterval> | null = null

const totalPages = computed(() => Math.max(1, Math.ceil(totalJobs.value / limit.value)))

async function fetchJobs() {
  try {
    const params = new URLSearchParams()
    params.set('page', String(page.value))
    params.set('limit', String(limit.value))
    const data = await api.get<any>(`/admin/self-healing?${params.toString()}`)
    jobs.value = data?.data ?? []
    totalJobs.value = data?.pagination?.total ?? 0
    notConfigured.value = false
  } catch (err: any) {
    if (err?.status === 400 && err?.body?.error?.includes('not configured')) {
      notConfigured.value = true
    }
    jobs.value = []
    totalJobs.value = 0
  } finally {
    loading.value = false
  }
}

async function fetchJobDetail(id: string) {
  loadingDetail.value = true
  try {
    selectedJob.value = await api.get<any>(`/admin/self-healing/${id}`)
  } catch {
    selectedJob.value = null
  } finally {
    loadingDetail.value = false
  }
}

async function createJob() {
  if (!prompt.value.trim()) return
  creating.value = true
  try {
    const job = await api.post<any>('/admin/self-healing', {
      prompt: prompt.value.trim(),
      options: {
        autoMerge: autoMerge.value,
        autoRelease: autoRelease.value,
        autoUpdate: autoUpdate.value,
        releaseType: releaseType.value,
      },
    })
    prompt.value = ''
    await fetchJobs()
    if (job?.id) selectedJob.value = job
  } finally {
    creating.value = false
  }
}

async function cancelJobAction(id: string) {
  try {
    await api.post(`/admin/self-healing/${id}/cancel`, {})
    await fetchJobs()
    if (selectedJob.value?.id === id) {
      await fetchJobDetail(id)
    }
  } catch {
    // handled by useApi toast
  }
}

async function deleteJob(id: string) {
  if (!confirm('Delete this job record?')) return
  try {
    await api.del(`/admin/self-healing/${id}`)
    if (selectedJob.value?.id === id) selectedJob.value = null
    await fetchJobs()
  } catch {
    // handled by useApi toast
  }
}

function openTerminal(jobId: string) {
  terminalJobId.value = jobId
  showTerminal.value = true
  nextTick(() => {
    const el = terminalRef.value
    if (el) {
      createTerminal(el)
      terminalConnect(`self-healing/${jobId}`)
    }
  })
}

function closeTerminal() {
  terminalDispose()
  showTerminal.value = false
  terminalJobId.value = null
}

function statusBadge(status: string) {
  switch (status) {
    case 'pending':
      return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
    case 'provisioning':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    case 'running':
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
    case 'pr_created':
      return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
    case 'monitoring_ci':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
    case 'merging':
      return 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300'
    case 'releasing':
      return 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300'
    case 'updating':
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
    case 'completed':
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    case 'failed':
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    case 'cancelled':
      return 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
    default:
      return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }
}

function statusIcon(status: string) {
  const active = ['provisioning', 'running', 'monitoring_ci', 'merging', 'releasing', 'updating']
  if (active.includes(status)) return 'spinner'
  if (status === 'completed') return 'check'
  if (status === 'failed') return 'error'
  if (status === 'pr_created') return 'branch'
  return 'clock'
}

function isActive(status: string) {
  return ['pending', 'provisioning', 'running', 'pr_created', 'monitoring_ci', 'merging', 'releasing', 'updating'].includes(status)
}

function formatDate(ts: any) {
  if (!ts) return '--'
  return new Date(ts).toLocaleString()
}

function timeAgo(ts: any) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function truncatePrompt(str: string, len = 60) {
  if (!str) return '--'
  return str.length > len ? str.slice(0, len) + '...' : str
}

onMounted(() => {
  fetchJobs()
  refreshInterval = setInterval(() => {
    if (autoRefresh.value) {
      fetchJobs()
      if (selectedJob.value && isActive(selectedJob.value.status)) {
        fetchJobDetail(selectedJob.value.id)
      }
    }
  }, 5000)
})

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
})
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <Bot class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('super.settings.selfHealing.title') }}</h1>
      </div>
      <div class="flex items-center gap-3">
        <button
          @click="autoRefresh = !autoRefresh"
          :class="[
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border',
            autoRefresh
              ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
              : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
          ]"
        >
          <RefreshCw :class="['w-4 h-4', autoRefresh ? 'animate-spin' : '']" />
          Auto-refresh
        </button>
        <button
          @click="router.push({ name: 'super-settings' })"
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors"
        >
          <Settings class="w-4 h-4" />
          {{ t('settings.general') }}
        </button>
      </div>
    </div>

    <!-- Not configured notice -->
    <div v-if="notConfigured" class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-6 text-center mb-6">
      <AlertTriangle class="w-8 h-8 text-yellow-500 mx-auto mb-3" />
      <p class="text-sm text-yellow-700 dark:text-yellow-300">{{ t('super.settings.selfHealing.notConfigured') }}</p>
      <button
        @click="router.push({ name: 'super-settings' })"
        class="mt-3 px-4 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-medium transition-colors"
      >
        {{ t('settings.general') }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <template v-else>
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <!-- Left: Jobs list + input -->
        <div class="xl:col-span-2 space-y-6">
          <!-- Command input -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div class="p-6">
              <!-- Options row -->
              <div class="flex flex-wrap items-center gap-4 mb-4">
                <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input v-model="autoMerge" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                  {{ t('super.settings.selfHealing.autoMerge') }}
                </label>
                <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input v-model="autoRelease" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                  {{ t('super.settings.selfHealing.autoRelease') }}
                </label>
                <div v-if="autoRelease" class="flex items-center gap-2">
                  <label class="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
                    <input v-model="releaseType" type="radio" value="alpha" class="text-primary-600 focus:ring-primary-500" />
                    {{ t('super.settings.selfHealing.alpha') }}
                  </label>
                  <label class="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
                    <input v-model="releaseType" type="radio" value="release" class="text-primary-600 focus:ring-primary-500" />
                    {{ t('super.settings.selfHealing.release') }}
                  </label>
                </div>
                <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input v-model="autoUpdate" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                  {{ t('super.settings.selfHealing.autoUpdate') }}
                </label>
              </div>

              <!-- Textarea + submit -->
              <div class="flex gap-3">
                <textarea
                  v-model="prompt"
                  :placeholder="t('super.settings.selfHealing.prompt')"
                  rows="3"
                  class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                  @keydown.meta.enter="createJob"
                  @keydown.ctrl.enter="createJob"
                />
                <button
                  @click="createJob"
                  :disabled="creating || !prompt.trim() || notConfigured"
                  class="self-end flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  <CompassSpinner v-if="creating" size="w-4 h-4" />
                  <Send v-else class="w-4 h-4" />
                  {{ t('super.settings.selfHealing.sendJob') }}
                </button>
              </div>
            </div>
          </div>

          <!-- Jobs list -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div v-if="jobs.length === 0" class="text-center py-12">
              <Bot class="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('super.settings.selfHealing.noJobs') }}</p>
            </div>

            <div v-else class="divide-y divide-gray-200 dark:divide-gray-700">
              <div
                v-for="job in jobs"
                :key="job.id"
                @click="fetchJobDetail(job.id)"
                :class="[
                  'flex items-center gap-4 px-6 py-4 cursor-pointer transition-colors',
                  selectedJob?.id === job.id
                    ? 'bg-primary-50 dark:bg-primary-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50',
                ]"
              >
                <!-- Status icon -->
                <div class="shrink-0">
                  <CompassSpinner v-if="statusIcon(job.status) === 'spinner'" size="w-5 h-5" color="text-blue-500" />
                  <CheckCircle v-else-if="statusIcon(job.status) === 'check'" class="w-5 h-5 text-green-500" />
                  <XCircle v-else-if="statusIcon(job.status) === 'error'" class="w-5 h-5 text-red-500" />
                  <GitBranch v-else-if="statusIcon(job.status) === 'branch'" class="w-5 h-5 text-indigo-500" />
                  <Clock v-else class="w-5 h-5 text-gray-400" />
                </div>

                <!-- Job info -->
                <div class="flex-1 min-w-0">
                  <p class="text-sm text-gray-900 dark:text-gray-100 truncate">{{ truncatePrompt(job.prompt) }}</p>
                  <div class="flex items-center gap-2 mt-1">
                    <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium', statusBadge(job.status)]">
                      {{ job.status.replace('_', ' ') }}
                    </span>
                    <span v-if="job.workingBranch" class="text-xs text-gray-500 dark:text-gray-400 font-mono">{{ job.workingBranch }}</span>
                  </div>
                </div>

                <!-- Time + actions -->
                <div class="flex items-center gap-2 shrink-0">
                  <span class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{{ timeAgo(job.createdAt) }}</span>
                  <button
                    v-if="isActive(job.status) && job.dockerServiceId"
                    @click.stop="openTerminal(job.id)"
                    class="p-1.5 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                    :title="t('super.settings.selfHealing.openTerminal')"
                  >
                    <TerminalIcon class="w-4 h-4" />
                  </button>
                  <button
                    v-if="isActive(job.status)"
                    @click.stop="cancelJobAction(job.id)"
                    class="p-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    :title="t('super.settings.selfHealing.cancelJob')"
                  >
                    <XCircle class="w-4 h-4" />
                  </button>
                  <button
                    v-if="!isActive(job.status)"
                    @click.stop="deleteJob(job.id)"
                    class="p-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    :title="t('super.settings.selfHealing.deleteJob')"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <!-- Pagination -->
            <div v-if="totalJobs > limit" class="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700">
              <span class="text-xs text-gray-500 dark:text-gray-400">{{ totalJobs }} jobs</span>
              <div class="flex items-center gap-2">
                <button
                  @click="page--; fetchJobs()"
                  :disabled="page <= 1"
                  class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  Prev
                </button>
                <span class="text-xs text-gray-500">{{ page }} / {{ totalPages }}</span>
                <button
                  @click="page++; fetchJobs()"
                  :disabled="page >= totalPages"
                  class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Job detail panel -->
        <div class="xl:col-span-1">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden sticky top-6">
            <div v-if="!selectedJob" class="text-center py-12 px-6">
              <Bot class="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p class="text-sm text-gray-500 dark:text-gray-400">Select a job to view details</p>
            </div>

            <template v-else>
              <!-- Detail header -->
              <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <div class="flex items-center justify-between mb-2">
                  <span :class="['inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', statusBadge(selectedJob.status)]">
                    {{ selectedJob.status.replace('_', ' ') }}
                  </span>
                  <div class="flex items-center gap-1">
                    <button
                      v-if="isActive(selectedJob.status) && selectedJob.dockerServiceId"
                      @click="openTerminal(selectedJob.id)"
                      class="p-1.5 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                    >
                      <TerminalIcon class="w-4 h-4" />
                    </button>
                    <button
                      v-if="isActive(selectedJob.status)"
                      @click="cancelJobAction(selectedJob.id)"
                      class="p-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <XCircle class="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p class="text-sm text-gray-900 dark:text-gray-100">{{ selectedJob.prompt }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {{ selectedJob.creatorName || selectedJob.creatorEmail || 'Unknown' }} &middot; {{ formatDate(selectedJob.createdAt) }}
                </p>
              </div>

              <!-- Detail body -->
              <div class="px-6 py-4 space-y-4">
                <!-- Branches -->
                <div v-if="selectedJob.baseBranch || selectedJob.workingBranch" class="space-y-1">
                  <p v-if="selectedJob.baseBranch" class="text-xs text-gray-500 dark:text-gray-400">
                    Base: <span class="font-mono text-gray-700 dark:text-gray-300">{{ selectedJob.baseBranch }}</span>
                  </p>
                  <p v-if="selectedJob.workingBranch" class="text-xs text-gray-500 dark:text-gray-400">
                    Branch: <span class="font-mono text-gray-700 dark:text-gray-300">{{ selectedJob.workingBranch }}</span>
                  </p>
                </div>

                <!-- PR link -->
                <div v-if="selectedJob.prUrl" class="flex items-center gap-2">
                  <a
                    :href="selectedJob.prUrl"
                    target="_blank"
                    class="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                  >
                    <ExternalLink class="w-3.5 h-3.5" />
                    PR #{{ selectedJob.prNumber }}
                  </a>
                  <span v-if="selectedJob.ciStatus" :class="[
                    'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium',
                    selectedJob.ciStatus === 'success' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                    selectedJob.ciStatus === 'failure' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                    'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                  ]">
                    CI: {{ selectedJob.ciStatus }}
                  </span>
                </div>

                <!-- Release tag -->
                <div v-if="selectedJob.releaseTag" class="text-xs text-gray-500 dark:text-gray-400">
                  Release: <span class="font-mono text-gray-700 dark:text-gray-300">{{ selectedJob.releaseTag }}</span>
                </div>

                <!-- Options -->
                <div class="flex flex-wrap gap-2">
                  <span v-if="selectedJob.options?.autoMerge" class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">auto-merge</span>
                  <span v-if="selectedJob.options?.autoRelease" class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300">auto-release ({{ selectedJob.options?.releaseType || 'release' }})</span>
                  <span v-if="selectedJob.options?.autoUpdate" class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">auto-update</span>
                </div>

                <!-- Error -->
                <div v-if="selectedJob.error" class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <p class="text-xs text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap">{{ selectedJob.error }}</p>
                </div>

                <!-- Log output -->
                <div v-if="selectedJob.log">
                  <h4 class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Log</h4>
                  <pre class="text-xs text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-900 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-80 overflow-y-auto">{{ selectedJob.log }}</pre>
                </div>

                <!-- Timestamps -->
                <div class="space-y-1 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <p v-if="selectedJob.startedAt" class="text-xs text-gray-500 dark:text-gray-400">
                    Started: {{ formatDate(selectedJob.startedAt) }}
                  </p>
                  <p v-if="selectedJob.completedAt" class="text-xs text-gray-500 dark:text-gray-400">
                    Completed: {{ formatDate(selectedJob.completedAt) }}
                  </p>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>

    <!-- Terminal Modal -->
    <Teleport to="body">
      <div v-if="showTerminal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60" @click="closeTerminal" />
        <div class="relative w-full max-w-4xl h-[600px] bg-[#1a1b26] rounded-xl overflow-hidden shadow-2xl flex flex-col">
          <!-- Terminal header -->
          <div class="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
            <div class="flex items-center gap-2">
              <TerminalIcon class="w-4 h-4 text-gray-400" />
              <span class="text-sm text-gray-300">Self-Healing Terminal</span>
              <span :class="[
                'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium',
                connectionState === 'connected' ? 'bg-green-900/40 text-green-400' :
                connectionState === 'connecting' || connectionState === 'reconnecting' ? 'bg-yellow-900/40 text-yellow-400' :
                'bg-red-900/40 text-red-400'
              ]">
                {{ connectionState }}
              </span>
            </div>
            <button @click="closeTerminal" class="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
              <X class="w-4 h-4" />
            </button>
          </div>
          <!-- Terminal body -->
          <div ref="terminalRef" class="flex-1" />
        </div>
      </div>
    </Teleport>
  </div>
</template>
