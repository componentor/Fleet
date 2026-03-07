<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Box, Plus, ArrowRight, ChevronDown, ChevronRight, Layers, Search, Play, Square, XCircle, RotateCw, Trash2, Tag, RotateCcw, Clock, AlertTriangle } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.vue'
import { useServicesStore } from '@/stores/services'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { useRole } from '@/composables/useRole'
import { useServiceBilling } from '@/composables/useServiceBilling'

const { t } = useI18n()

const router = useRouter()
const store = useServicesStore()
const api = useApi()
const toast = useToast()
const { canWrite } = useRole()
const { tiers, fetchTiers } = useServiceBilling()

function tierName(planId: string | null | undefined): string | null {
  if (!planId) return null
  return tiers.value.find(t => t.id === planId)?.name ?? null
}

const activeView = ref<'services' | 'trash'>('services')
const stackActionLoading = ref<string | null>(null)
const deletingStackId = ref<string | null>(null)
const deletingStackName = ref('')
const restoreLoading = ref<string | null>(null)
const permanentDeleteLoading = ref<string | null>(null)

const searchQuery = ref('')
const page = ref(1)
const pageSize = 20
const selectedTags = ref<Set<string>>(new Set())

const collapsedStacks = ref<Set<string>>(new Set())

const allTags = computed(() => {
  const tags = new Set<string>()
  for (const svc of store.services) {
    const svcTags = (svc as any).tags as string[] | undefined
    if (svcTags) for (const t of svcTags) tags.add(t)
  }
  return [...tags].sort()
})

function toggleTag(tag: string) {
  if (selectedTags.value.has(tag)) selectedTags.value.delete(tag)
  else selectedTags.value.add(tag)
  page.value = 1
}

const filteredServices = computed(() => {
  let result = store.services
  const q = searchQuery.value.toLowerCase().trim()
  if (q) {
    result = result.filter((svc: any) =>
      svc.name?.toLowerCase().includes(q) ||
      svc.image?.toLowerCase().includes(q) ||
      svc.status?.toLowerCase().includes(q),
    )
  }
  if (selectedTags.value.size > 0) {
    result = result.filter((svc: any) => {
      const svcTags = (svc as any).tags as string[] | undefined
      if (!svcTags) return false
      return [...selectedTags.value].some(t => svcTags.includes(t))
    })
  }
  return result
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredServices.value.length / pageSize)))

const paginatedServices = computed(() => {
  const start = (page.value - 1) * pageSize
  return filteredServices.value.slice(start, start + pageSize)
})

watch(searchQuery, () => { page.value = 1 })

function statusColor(status: string) {
  switch (status) {
    case 'running': return 'bg-green-500'
    case 'deploying': return 'bg-yellow-500'
    case 'stopped': return 'bg-gray-400'
    case 'failed': return 'bg-red-500'
    default: return 'bg-gray-400'
  }
}

function statusBadge(status: string) {
  switch (status) {
    case 'running': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    case 'deploying': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
    case 'stopped': return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
    case 'failed': return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    default: return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }
}

function statusBorderColor(status: string) {
  switch (status) {
    case 'running': return 'border-l-green-500'
    case 'deploying': return 'border-l-yellow-500'
    case 'stopped': return 'border-l-gray-300 dark:border-l-gray-600'
    case 'failed': return 'border-l-red-500'
    default: return 'border-l-gray-300 dark:border-l-gray-600'
  }
}

// Group services by stackId
const groupedServices = computed(() => {
  const stacks = new Map<string, any[]>()
  const standalone: any[] = []

  for (const svc of paginatedServices.value) {
    if (svc.stackId) {
      const group = stacks.get(svc.stackId) || []
      group.push(svc)
      stacks.set(svc.stackId, group)
    } else {
      standalone.push(svc)
    }
  }

  const groups: { stackId: string; services: any[] }[] = []
  for (const [stackId, svcs] of stacks) {
    groups.push({ stackId, services: svcs })
  }

  return { groups, standalone }
})

function toggleStack(stackId: string) {
  if (collapsedStacks.value.has(stackId)) {
    collapsedStacks.value.delete(stackId)
  } else {
    collapsedStacks.value.add(stackId)
  }
}

function stackName(svcs: any[]) {
  if (svcs.length === 1) return svcs[0].name
  return svcs.map(s => s.name).join(' + ')
}

function stackStatus(svcs: any[]) {
  if (svcs.some(s => s.status === 'failed')) return 'failed'
  if (svcs.some(s => s.status === 'deploying')) return 'deploying'
  if (svcs.every(s => s.status === 'running')) return 'running'
  if (svcs.every(s => s.status === 'stopped')) return 'stopped'
  return 'running'
}

async function startStack(svcs: any[]) {
  const stopped = svcs.filter(s => s.status === 'stopped')
  if (stopped.length === 0) return
  stackActionLoading.value = svcs[0].stackId
  try {
    await Promise.all(stopped.map(s => api.post(`/services/${s.id}/start`, {})))
    await store.fetchServices()
  } catch {
    toast.error('Failed to start some services')
  } finally {
    stackActionLoading.value = null
  }
}

async function stopStack(svcs: any[]) {
  const running = svcs.filter(s => s.status === 'running')
  if (running.length === 0) return
  stackActionLoading.value = svcs[0].stackId
  try {
    await Promise.all(running.map(s => api.post(`/services/${s.id}/stop`, {})))
    await store.fetchServices()
  } catch {
    toast.error('Failed to stop some services')
  } finally {
    stackActionLoading.value = null
  }
}

async function cancelDeployStack(svcs: any[]) {
  const deploying = svcs.filter(s => s.status === 'deploying')
  if (deploying.length === 0) return
  stackActionLoading.value = svcs[0].stackId
  try {
    await Promise.all(deploying.map(s => api.post(`/services/${s.id}/cancel-deploy`, {})))
    await store.fetchServices()
  } catch {
    toast.error('Failed to cancel some deployments')
  } finally {
    stackActionLoading.value = null
  }
}

async function restartStack(stackId: string) {
  stackActionLoading.value = stackId
  try {
    await api.post(`/services/stack/${stackId}/restart`, {})
    await store.fetchServices()
    toast.success(t('services.restartSuccess', 'Stack restarted'))
  } catch {
    toast.error(t('services.restartFailed', 'Failed to restart stack'))
  } finally {
    stackActionLoading.value = null
  }
}

const deletingStackVolumes = computed(() => {
  if (!deletingStackId.value) return []
  const stackServices = store.services.filter(s => s.stackId === deletingStackId.value)
  const seen = new Set<string>()
  const volumes: Array<{ source: string; target: string }> = []
  for (const svc of stackServices) {
    const vols = (svc as any).volumes as Array<{ source: string; target: string }> | undefined
    if (vols) {
      for (const v of vols) {
        if (v.source && !seen.has(v.source)) {
          seen.add(v.source)
          volumes.push(v)
        }
      }
    }
  }
  return volumes
})

function promptDeleteStack(stackId: string, name: string) {
  deletingStackId.value = stackId
  deletingStackName.value = name
}

async function confirmDeleteStack(deleteVolumeNames: string[], options: { backupBeforeDelete: boolean }) {
  const stackId = deletingStackId.value
  if (!stackId) return
  stackActionLoading.value = stackId
  try {
    await store.deleteStack(stackId, { deleteVolumeNames, backupBeforeDelete: options.backupBeforeDelete })
    deletingStackId.value = null
    deletingStackName.value = ''
    toast.success(t('services.deleteStackSuccess', 'Stack moved to trash'))
  } catch {
    toast.error(t('services.deleteStackFailed', 'Failed to delete stack'))
  } finally {
    stackActionLoading.value = null
  }
}

async function handleRestoreService(id: string) {
  restoreLoading.value = id
  try {
    await store.restoreService(id)
    toast.success(t('services.restoreSuccess', 'Service restored'))
  } catch {
    toast.error(t('services.restoreFailed', 'Failed to restore service'))
  } finally {
    restoreLoading.value = null
  }
}

async function handlePermanentDelete(id: string) {
  permanentDeleteLoading.value = id
  try {
    await store.permanentlyDeleteService(id)
    toast.success(t('services.permanentDeleteSuccess', 'Service permanently deleted'))
  } catch {
    toast.error(t('services.permanentDeleteFailed', 'Failed to permanently delete service'))
  } finally {
    permanentDeleteLoading.value = null
  }
}

function switchView(view: 'services' | 'trash') {
  activeView.value = view
  if (view === 'trash') {
    store.fetchTrash()
  }
}

// Auto-refresh when any service is deploying
const refreshInterval = ref<ReturnType<typeof setInterval> | null>(null)

const hasDeployingServices = computed(() =>
  store.services.some((s: any) => s.status === 'deploying')
)

function startAutoRefresh() {
  stopAutoRefresh()
  refreshInterval.value = setInterval(() => {
    store.fetchServices()
  }, 5000)
}

function stopAutoRefresh() {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value)
    refreshInterval.value = null
  }
}

watch(hasDeployingServices, (deploying) => {
  if (deploying) startAutoRefresh()
  else stopAutoRefresh()
})

onMounted(() => {
  store.fetchServices()
  store.fetchTrash()
  fetchTiers()
})

onUnmounted(() => {
  stopAutoRefresh()
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-6">
      <div class="flex items-center gap-3">
        <Box class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('services.title') }}</h1>
      </div>
      <router-link
        v-if="canWrite"
        to="/panel/deploy"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        {{ $t('services.deployNew') }}
      </router-link>
    </div>

    <!-- View toggle: Services / Trash -->
    <div class="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg mb-6 w-fit">
      <button
        @click="switchView('services')"
        :class="[
          'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
          activeView === 'services'
            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
        ]"
      >
        <Box class="w-4 h-4" />
        {{ $t('services.activeServices', 'Services') }}
      </button>
      <button
        @click="switchView('trash')"
        :class="[
          'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
          activeView === 'trash'
            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
        ]"
      >
        <Trash2 class="w-4 h-4" />
        {{ $t('services.trash', 'Trash') }}
        <span v-if="store.trashedServices.length > 0" class="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
          {{ store.trashedServices.length }}
        </span>
      </button>
    </div>

    <!-- ═══ TRASH VIEW ═══ -->
    <template v-if="activeView === 'trash'">
      <!-- Loading -->
      <div v-if="store.trashLoading && store.trashedServices.length === 0" class="flex items-center justify-center py-20">
        <CompassSpinner size="w-16 h-16" />
      </div>

      <!-- Empty trash -->
      <div v-else-if="store.trashedServices.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
        <Trash2 class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">{{ $t('services.trashEmpty', 'Trash is empty') }}</h3>
        <p class="text-gray-500 dark:text-gray-400 text-sm">{{ $t('services.trashEmptyDesc', 'Deleted services will appear here for 30 days before being permanently removed.') }}</p>
      </div>

      <!-- Trash items -->
      <div v-else class="space-y-3">
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">
          {{ $t('services.trashHint', 'These services have been deleted. You can restore them or permanently delete them.') }}
        </p>
        <div
          v-for="svc in store.trashedServices"
          :key="svc.id"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0">
                <Box class="w-5 h-5 text-gray-400 dark:text-gray-500" />
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ svc.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">{{ svc.image }}</p>
              </div>
            </div>
            <div class="flex items-center gap-4 shrink-0">
              <!-- Countdown -->
              <div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <Clock class="w-3.5 h-3.5" />
                <span v-if="svc.daysUntilPurge > 0">
                  {{ $t('services.trashDaysLeft', { days: svc.daysUntilPurge }) }}
                </span>
                <span v-else class="text-red-500 dark:text-red-400 font-medium">
                  {{ $t('services.trashExpiring', 'Expiring soon') }}
                </span>
              </div>
              <!-- Actions -->
              <div class="flex items-center gap-2">
                <button
                  @click="handleRestoreService(svc.id)"
                  :disabled="restoreLoading === svc.id || permanentDeleteLoading === svc.id"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors disabled:opacity-50"
                >
                  <CompassSpinner v-if="restoreLoading === svc.id" size="w-3.5 h-3.5" />
                  <RotateCcw v-else class="w-3.5 h-3.5" />
                  {{ $t('services.restore', 'Restore') }}
                </button>
                <button
                  @click="handlePermanentDelete(svc.id)"
                  :disabled="restoreLoading === svc.id || permanentDeleteLoading === svc.id"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  <CompassSpinner v-if="permanentDeleteLoading === svc.id" size="w-3.5 h-3.5" />
                  <AlertTriangle v-else class="w-3.5 h-3.5" />
                  {{ $t('services.deletePermanently', 'Delete permanently') }}
                </button>
              </div>
            </div>
          </div>
          <!-- Deleted date -->
          <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
            {{ $t('services.trashDeletedOn', 'Deleted') }} {{ new Date(svc.deletedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}
          </p>
        </div>
      </div>
    </template>

    <!-- ═══ ACTIVE SERVICES VIEW ═══ -->
    <template v-else>

    <!-- Search & tag filters -->
    <div v-if="store.services.length > 0" class="mb-6 space-y-3">
      <div class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="$t('services.searchPlaceholder', 'Search services...')"
          class="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
        />
      </div>
      <div v-if="allTags.length > 0" class="flex flex-wrap gap-1.5">
        <button
          v-for="tag in allTags"
          :key="tag"
          @click="toggleTag(tag)"
          :class="[
            'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
            selectedTags.has(tag)
              ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 ring-1 ring-primary-300 dark:ring-primary-700'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
          ]"
        >
          <Tag class="w-3 h-3" />
          {{ tag }}
        </button>
      </div>
    </div>

    <!-- Loading state — skeleton cards -->
    <div v-if="store.loading && store.services.length === 0" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div v-for="i in 6" :key="i" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 animate-pulse">
        <div class="flex items-start justify-between mb-4">
          <div class="flex items-center gap-2.5">
            <div class="w-2.5 h-2.5 rounded-full bg-gray-200 dark:bg-gray-700" />
            <div class="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
          <div class="w-16 h-5 bg-gray-200 dark:bg-gray-700 rounded-full" />
        </div>
        <div class="h-3 w-40 bg-gray-100 dark:bg-gray-700/50 rounded mb-3" />
        <div class="flex items-center justify-between">
          <div class="h-3 w-20 bg-gray-100 dark:bg-gray-700/50 rounded" />
          <div class="w-4 h-4 bg-gray-100 dark:bg-gray-700/50 rounded" />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="store.services.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <Box class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
      <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">{{ $t('services.noServices') }}</h3>
      <p class="text-gray-500 dark:text-gray-400 text-sm mb-6">{{ $t('services.noServicesDesc') }}</p>
      <router-link
        v-if="canWrite"
        to="/panel/deploy"
        class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        {{ $t('services.deployNewService') }}
      </router-link>
    </div>

    <!-- No results for search -->
    <div v-else-if="filteredServices.length === 0 && searchQuery" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <Search class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
      <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">No matching services</h3>
      <p class="text-gray-500 dark:text-gray-400 text-sm">No services match "{{ searchQuery }}".</p>
    </div>

    <div v-else class="space-y-6">
      <!-- Stack groups -->
      <div
        v-for="group in groupedServices.groups"
        :key="group.stackId"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
      >
        <!-- Stack header -->
        <div class="flex items-center justify-between w-full px-5 py-3.5 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <div class="flex items-center gap-2 min-w-0">
              <Layers class="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" />
              <router-link :to="`/panel/stacks/${group.stackId}`" class="text-sm font-semibold text-gray-900 dark:text-white truncate hover:text-primary-600 dark:hover:text-primary-400 hover:underline" @click.stop>{{ stackName(group.services) }}</router-link>
            </div>
            <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0', statusBadge(stackStatus(group.services))]">
              {{ stackStatus(group.services) }}
            </span>
            <span class="text-xs text-gray-400 dark:text-gray-500 shrink-0">{{ group.services.length }} {{ $t('services.servicesInStack') }}</span>
            <button @click="toggleStack(group.stackId)" class="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors shrink-0">
              <component :is="collapsedStacks.has(group.stackId) ? ChevronRight : ChevronDown" class="w-4 h-4 text-gray-400" />
            </button>
          </div>
          <div v-if="canWrite" class="flex items-center gap-1.5 ml-3 shrink-0">
            <button
              v-if="group.services.some((s: any) => s.status === 'stopped')"
              @click.stop="startStack(group.services)"
              :disabled="stackActionLoading === group.stackId"
              class="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50"
              :title="$t('services.startAll', 'Start all')"
            >
              <CompassSpinner v-if="stackActionLoading === group.stackId" size="w-3.5 h-3.5" />
              <Play v-else class="w-3.5 h-3.5" />
              <span class="hidden sm:inline">{{ $t('services.startAll', 'Start all') }}</span>
            </button>
            <button
              v-if="group.services.some((s: any) => s.status === 'running')"
              @click.stop="stopStack(group.services)"
              :disabled="stackActionLoading === group.stackId"
              class="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors disabled:opacity-50"
              :title="$t('services.stopAll', 'Stop all')"
            >
              <CompassSpinner v-if="stackActionLoading === group.stackId" size="w-3.5 h-3.5" />
              <Square v-else class="w-3.5 h-3.5" />
              <span class="hidden sm:inline">{{ $t('services.stopAll', 'Stop all') }}</span>
            </button>
            <button
              v-if="group.services.some((s: any) => s.status === 'deploying')"
              @click.stop="cancelDeployStack(group.services)"
              :disabled="stackActionLoading === group.stackId"
              class="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
              :title="$t('services.cancelDeploy', 'Cancel deploy')"
            >
              <CompassSpinner v-if="stackActionLoading === group.stackId" size="w-3.5 h-3.5" />
              <XCircle v-else class="w-3.5 h-3.5" />
              <span class="hidden sm:inline">{{ $t('services.cancelDeploy', 'Cancel deploy') }}</span>
            </button>
            <button
              @click.stop="restartStack(group.stackId)"
              :disabled="stackActionLoading === group.stackId"
              class="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50"
              :title="$t('services.restartAll', 'Restart all')"
            >
              <CompassSpinner v-if="stackActionLoading === group.stackId" size="w-3.5 h-3.5" />
              <RotateCw v-else class="w-3.5 h-3.5" />
              <span class="hidden sm:inline">{{ $t('services.restartAll', 'Restart all') }}</span>
            </button>
            <button
              @click.stop="promptDeleteStack(group.stackId, stackName(group.services))"
              :disabled="stackActionLoading === group.stackId"
              class="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
              :title="$t('services.deleteStack', 'Delete stack')"
            >
              <Trash2 class="w-3.5 h-3.5" />
              <span class="hidden sm:inline">{{ $t('services.deleteStack', 'Delete stack') }}</span>
            </button>
          </div>
        </div>

        <!-- Stack services -->
        <div v-if="!collapsedStacks.has(group.stackId)" class="divide-y divide-gray-100 dark:divide-gray-700">
          <router-link
            v-for="service in group.services"
            :key="service.id"
            :to="`/panel/services/${service.id}`"
            class="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group"
          >
            <div class="flex items-center gap-3 min-w-0">
              <span :class="[statusColor(service.status), 'w-2 h-2 rounded-full shrink-0', service.status === 'deploying' ? 'animate-pulse' : '']"></span>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ service.name }}</p>
                  <span v-if="tierName((service as any).planId)" class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 shrink-0">
                    {{ tierName((service as any).planId) }}
                  </span>
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">{{ service.image }}</p>
                <p v-if="(service as any).lastDeployError" class="text-xs text-red-500 dark:text-red-400 truncate mt-0.5">{{ (service as any).lastDeployError }}</p>
              </div>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', statusBadge(service.status)]">
                {{ service.status }}
              </span>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ service.replicas ?? 1 }} {{ (service.replicas ?? 1) !== 1 ? $t('services.replicas') : $t('services.replica') }}
              </span>
              <ArrowRight class="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary-600 dark:text-primary-400" />
            </div>
          </router-link>
        </div>
      </div>

      <!-- Standalone services (no stack) -->
      <div v-if="groupedServices.standalone.length > 0" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <router-link
          v-for="service in groupedServices.standalone"
          :key="service.id"
          :to="`/panel/services/${service.id}`"
          :class="['bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 overflow-hidden group relative']"
        >
          <!-- Status accent line at top -->
          <div :class="['h-0.5 w-full', statusColor(service.status)]" />
          <div class="p-5">
            <div class="flex items-start justify-between mb-3">
              <div class="flex items-center gap-2.5 min-w-0">
                <span :class="[statusColor(service.status), 'w-2 h-2 rounded-full shrink-0', service.status === 'deploying' ? 'animate-pulse' : '']"></span>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white truncate">{{ service.name }}</h3>
                <span v-if="tierName((service as any).planId)" class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 shrink-0">
                  {{ tierName((service as any).planId) }}
                </span>
              </div>
              <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ml-2', statusBadge(service.status)]">
                {{ service.status }}
              </span>
            </div>
            <p class="text-xs text-gray-400 dark:text-gray-500 font-mono mb-3 truncate">{{ service.image }}</p>
            <p v-if="(service as any).lastDeployError" class="text-xs text-red-500 dark:text-red-400 line-clamp-2 mb-3 bg-red-50 dark:bg-red-900/10 rounded px-2 py-1.5">{{ (service as any).lastDeployError }}</p>
            <div v-if="(service as any).tags?.length" class="flex flex-wrap gap-1 mb-3">
              <span v-for="tag in (service as any).tags" :key="tag" class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                {{ tag }}
              </span>
            </div>
            <div class="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
              <div class="flex items-center gap-3">
                <span>{{ service.replicas ?? 1 }} {{ (service.replicas ?? 1) !== 1 ? $t('services.replicas') : $t('services.replica') }}</span>
                <span v-if="service.status === 'stopped'" class="text-gray-300 dark:text-gray-600">{{ $t('services.notBilled') }}</span>
              </div>
              <ArrowRight class="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-primary-500" />
            </div>
          </div>
        </router-link>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-between pt-2">
        <p class="text-xs text-gray-500 dark:text-gray-400">
          Page {{ page }} of {{ totalPages }} &middot; {{ filteredServices.length }} services
        </p>
        <div class="flex gap-2">
          <button
            @click="page--"
            :disabled="page <= 1"
            class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Previous
          </button>
          <button
            @click="page++"
            :disabled="page >= totalPages"
            class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>

    </template>
  </div>

  <!-- Delete stack confirmation modal -->
  <ConfirmDeleteModal
    :show="!!deletingStackId"
    :title="t('confirmDelete.titleStack', 'Delete Stack')"
    :message="t('confirmDelete.messageStack', 'Are you sure you want to delete stack')"
    :item-name="deletingStackName"
    :volumes="deletingStackVolumes"
    :loading="!!stackActionLoading"
    @confirm="confirmDeleteStack"
    @cancel="deletingStackId = null; deletingStackName = ''"
  />
</template>
