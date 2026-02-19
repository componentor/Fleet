<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  Layers, Search, Loader2, Play, Square, RotateCw, Trash2,
  ChevronDown, ChevronRight, ArrowRight, AlertTriangle, Box,
  CheckCircle2, XCircle, Clock
} from 'lucide-vue-next'
import { useServicesStore } from '@/stores/services'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { useRole } from '@/composables/useRole'

const { t } = useI18n()
const router = useRouter()
const store = useServicesStore()
const api = useApi()
const toast = useToast()
const { canWrite } = useRole()

const searchQuery = ref('')
const actionLoading = ref<string | null>(null)
const expandedStacks = ref<Set<string>>(new Set())
const confirmDelete = ref<string | null>(null)

interface StackGroup {
  stackId: string
  services: any[]
  name: string
  status: string
  serviceCount: number
  runningCount: number
  images: string[]
  createdAt: Date | null
}

const stacks = computed<StackGroup[]>(() => {
  const stackMap = new Map<string, any[]>()

  for (const svc of store.services) {
    if (svc.stackId) {
      const group = stackMap.get(svc.stackId) || []
      group.push(svc)
      stackMap.set(svc.stackId, group)
    }
  }

  const result: StackGroup[] = []
  for (const [stackId, svcs] of stackMap) {
    const statuses = svcs.map(s => s.status)
    let status = 'running'
    if (statuses.some(s => s === 'deploying')) status = 'deploying'
    else if (statuses.every(s => s === 'running')) status = 'running'
    else if (statuses.every(s => s === 'stopped')) status = 'stopped'
    else if (statuses.every(s => s === 'failed')) status = 'failed'
    else if (statuses.some(s => s === 'failed')) status = 'partial'
    else if (statuses.some(s => s === 'stopped') && statuses.some(s => s === 'running')) status = 'partial'

    const images = [...new Set(svcs.map(s => s.image))]
    const runningCount = svcs.filter(s => s.status === 'running').length
    const createdAt = svcs.reduce((earliest: Date | null, s: any) => {
      const d = s.createdAt ? new Date(s.createdAt) : null
      if (!d) return earliest
      if (!earliest) return d
      return d < earliest ? d : earliest
    }, null as Date | null)

    result.push({
      stackId,
      services: svcs,
      name: svcs.map(s => s.name).join(' + '),
      status,
      serviceCount: svcs.length,
      runningCount,
      images,
      createdAt,
    })
  }

  return result.sort((a, b) => {
    if (a.createdAt && b.createdAt) return b.createdAt.getTime() - a.createdAt.getTime()
    return 0
  })
})

const filteredStacks = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return stacks.value
  return stacks.value.filter(stack =>
    stack.name.toLowerCase().includes(q) ||
    stack.images.some(img => img.toLowerCase().includes(q)) ||
    stack.status.toLowerCase().includes(q)
  )
})

function toggleExpand(stackId: string) {
  if (expandedStacks.value.has(stackId)) {
    expandedStacks.value.delete(stackId)
  } else {
    expandedStacks.value.add(stackId)
  }
}

function statusBadge(status: string) {
  switch (status) {
    case 'running': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    case 'deploying': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
    case 'stopped': return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
    case 'failed': return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    case 'partial': return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
    default: return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }
}

function statusColor(status: string) {
  switch (status) {
    case 'running': return 'bg-green-500'
    case 'deploying': return 'bg-yellow-500'
    case 'stopped': return 'bg-gray-400'
    case 'failed': return 'bg-red-500'
    case 'partial': return 'bg-orange-500'
    default: return 'bg-gray-400'
  }
}

function statusIcon(status: string) {
  switch (status) {
    case 'running': return CheckCircle2
    case 'deploying': return Clock
    case 'stopped': return Square
    case 'failed': return XCircle
    case 'partial': return AlertTriangle
    default: return Box
  }
}

function formatDate(date: Date | null) {
  if (!date) return ''
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

async function startStack(stack: StackGroup) {
  const stopped = stack.services.filter(s => s.status === 'stopped')
  if (stopped.length === 0) return
  actionLoading.value = stack.stackId
  try {
    await Promise.all(stopped.map(s => api.post(`/services/${s.id}/start`, {})))
    await store.fetchServices()
    toast.success(t('stacks.startSuccess'))
  } catch {
    toast.error(t('stacks.startFailed'))
  } finally {
    actionLoading.value = null
  }
}

async function stopStack(stack: StackGroup) {
  const running = stack.services.filter(s => s.status === 'running')
  if (running.length === 0) return
  actionLoading.value = stack.stackId
  try {
    await Promise.all(running.map(s => api.post(`/services/${s.id}/stop`, {})))
    await store.fetchServices()
    toast.success(t('stacks.stopSuccess'))
  } catch {
    toast.error(t('stacks.stopFailed'))
  } finally {
    actionLoading.value = null
  }
}

async function restartStack(stack: StackGroup) {
  actionLoading.value = stack.stackId
  try {
    await api.post(`/services/stack/${stack.stackId}/restart`, {})
    await store.fetchServices()
    toast.success(t('stacks.restartSuccess'))
  } catch {
    toast.error(t('stacks.restartFailed'))
  } finally {
    actionLoading.value = null
  }
}

async function deleteStack(stack: StackGroup) {
  actionLoading.value = stack.stackId
  try {
    await api.del(`/services/stack/${stack.stackId}`)
    confirmDelete.value = null
    await store.fetchServices()
    toast.success(t('stacks.deleteSuccess'))
  } catch {
    toast.error(t('stacks.deleteFailed'))
  } finally {
    actionLoading.value = null
  }
}

onMounted(() => {
  store.fetchServices()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Layers class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('stacks.title') }}</h1>
      </div>
      <router-link
        v-if="canWrite"
        to="/panel/marketplace"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        {{ $t('stacks.deployStack') }}
      </router-link>
    </div>

    <!-- Search -->
    <div v-if="stacks.length > 0" class="mb-6">
      <div class="relative max-w-md">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="$t('stacks.searchPlaceholder')"
          class="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
        />
      </div>
    </div>

    <!-- Loading -->
    <div v-if="store.loading && store.services.length === 0" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <!-- Empty state -->
    <div v-else-if="stacks.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <Layers class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
      <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">{{ $t('stacks.noStacks') }}</h3>
      <p class="text-gray-500 dark:text-gray-400 text-sm mb-6">{{ $t('stacks.noStacksDesc') }}</p>
      <router-link
        v-if="canWrite"
        to="/panel/marketplace"
        class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        {{ $t('stacks.deployStack') }}
      </router-link>
    </div>

    <!-- No search results -->
    <div v-else-if="filteredStacks.length === 0 && searchQuery" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <Search class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
      <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">{{ $t('stacks.noResults') }}</h3>
      <p class="text-gray-500 dark:text-gray-400 text-sm">{{ $t('stacks.noResultsDesc', { query: searchQuery }) }}</p>
    </div>

    <!-- Stack list -->
    <div v-else class="space-y-4">
      <div
        v-for="stack in filteredStacks"
        :key="stack.stackId"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
      >
        <!-- Stack header -->
        <div class="px-5 py-4">
          <div class="flex items-center justify-between gap-4">
            <button
              @click="toggleExpand(stack.stackId)"
              class="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
            >
              <div :class="['w-10 h-10 rounded-lg flex items-center justify-center shrink-0', statusBadge(stack.status)]">
                <component :is="statusIcon(stack.status)" class="w-5 h-5" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-white truncate">{{ stack.name }}</h3>
                  <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0', statusBadge(stack.status)]">
                    {{ stack.status }}
                  </span>
                </div>
                <div class="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                  <span>{{ stack.serviceCount }} {{ stack.serviceCount === 1 ? $t('stacks.service') : $t('stacks.services') }}</span>
                  <span>&middot;</span>
                  <span>{{ stack.runningCount }} {{ $t('stacks.running') }}</span>
                  <span v-if="stack.createdAt">&middot;</span>
                  <span v-if="stack.createdAt">{{ formatDate(stack.createdAt) }}</span>
                </div>
              </div>
              <component :is="expandedStacks.has(stack.stackId) ? ChevronDown : ChevronRight" class="w-5 h-5 text-gray-400 shrink-0" />
            </button>

            <!-- Actions -->
            <div v-if="canWrite" class="flex items-center gap-1.5 shrink-0">
              <button
                v-if="stack.services.some(s => s.status === 'stopped')"
                @click="startStack(stack)"
                :disabled="actionLoading === stack.stackId"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 border border-green-200 dark:border-green-800 transition-colors disabled:opacity-50"
                :title="$t('stacks.startAll')"
              >
                <Loader2 v-if="actionLoading === stack.stackId" class="w-3.5 h-3.5 animate-spin" />
                <Play v-else class="w-3.5 h-3.5" />
                <span class="hidden sm:inline">{{ $t('stacks.startAll') }}</span>
              </button>
              <button
                v-if="stack.services.some(s => s.status === 'running')"
                @click="stopStack(stack)"
                :disabled="actionLoading === stack.stackId"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 border border-orange-200 dark:border-orange-800 transition-colors disabled:opacity-50"
                :title="$t('stacks.stopAll')"
              >
                <Loader2 v-if="actionLoading === stack.stackId" class="w-3.5 h-3.5 animate-spin" />
                <Square v-else class="w-3.5 h-3.5" />
                <span class="hidden sm:inline">{{ $t('stacks.stopAll') }}</span>
              </button>
              <button
                @click="restartStack(stack)"
                :disabled="actionLoading === stack.stackId"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-blue-200 dark:border-blue-800 transition-colors disabled:opacity-50"
                :title="$t('stacks.restartAll')"
              >
                <Loader2 v-if="actionLoading === stack.stackId" class="w-3.5 h-3.5 animate-spin" />
                <RotateCw v-else class="w-3.5 h-3.5" />
                <span class="hidden sm:inline">{{ $t('stacks.restartAll') }}</span>
              </button>
              <button
                v-if="confirmDelete !== stack.stackId"
                @click="confirmDelete = stack.stackId"
                :disabled="actionLoading === stack.stackId"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 transition-colors disabled:opacity-50"
                :title="$t('stacks.deleteStack')"
              >
                <Trash2 class="w-3.5 h-3.5" />
                <span class="hidden sm:inline">{{ $t('stacks.deleteStack') }}</span>
              </button>
              <template v-else>
                <button
                  @click="deleteStack(stack)"
                  :disabled="actionLoading === stack.stackId"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
                >
                  <Loader2 v-if="actionLoading === stack.stackId" class="w-3.5 h-3.5 animate-spin" />
                  <Trash2 v-else class="w-3.5 h-3.5" />
                  {{ $t('stacks.confirmDelete') }}
                </button>
                <button
                  @click="confirmDelete = null"
                  class="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 transition-colors"
                >
                  {{ $t('stacks.cancel') }}
                </button>
              </template>
            </div>
          </div>

          <!-- Image tags -->
          <div class="flex items-center gap-2 mt-3 flex-wrap">
            <span
              v-for="img in stack.images"
              :key="img"
              class="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
            >
              {{ img }}
            </span>
          </div>
        </div>

        <!-- Expanded: service list -->
        <div v-if="expandedStacks.has(stack.stackId)" class="border-t border-gray-200 dark:border-gray-700">
          <div class="divide-y divide-gray-100 dark:divide-gray-700">
            <router-link
              v-for="svc in stack.services"
              :key="svc.id"
              :to="`/panel/services/${svc.id}`"
              class="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group"
            >
              <div class="flex items-center gap-3 min-w-0">
                <span :class="[statusColor(svc.status), 'w-2 h-2 rounded-full shrink-0']"></span>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ svc.name }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">{{ svc.image }}</p>
                </div>
              </div>
              <div class="flex items-center gap-3 shrink-0">
                <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', statusBadge(svc.status)]">
                  {{ svc.status }}
                </span>
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  {{ svc.replicas ?? 1 }} {{ (svc.replicas ?? 1) !== 1 ? $t('services.replicas') : $t('services.replica') }}
                </span>
                <ArrowRight class="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary-600 dark:text-primary-400" />
              </div>
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
