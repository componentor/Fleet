<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { LifeBuoy, Search } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useI18n } from 'vue-i18n'
import { useApi } from '@/composables/useApi'

interface Ticket {
  id: string
  subject: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  accountId: string
  accountName: string | null
  createdBy: string
  creatorName: string | null
  creatorEmail: string | null
  assignedTo: string | null
  assigneeName: string | null
  assigneeEmail: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

interface TicketListResponse {
  data: Ticket[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

interface StatsResponse {
  open: number
  inProgress: number
  total: number
}

const router = useRouter()
const api = useApi()
const { t } = useI18n()

const tickets = ref<Ticket[]>([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const limit = ref(20)
const totalPages = ref(1)
const total = ref(0)

const stats = ref<StatsResponse>({ open: 0, inProgress: 0, total: 0 })
const statsLoading = ref(true)

const filters = reactive({
  status: '',
  priority: '',
  search: '',
})

let searchTimeout: ReturnType<typeof setTimeout> | null = null

const statusOptions = computed(() => [
  { value: '', label: t('support.admin.allStatuses') },
  { value: 'open', label: t('support.status.open') },
  { value: 'in_progress', label: t('support.status.inProgress') },
  { value: 'resolved', label: t('support.status.resolved') },
  { value: 'closed', label: t('support.status.closed') },
])

const priorityOptions = computed(() => [
  { value: '', label: t('support.admin.allPriorities') },
  { value: 'low', label: t('support.priority.low') },
  { value: 'normal', label: t('support.priority.normal') },
  { value: 'high', label: t('support.priority.high') },
  { value: 'urgent', label: t('support.priority.urgent') },
])

function statusBadgeClasses(status: string): string {
  switch (status) {
    case 'open':
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    case 'in_progress':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    case 'resolved':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
    case 'closed':
      return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
    default:
      return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }
}

function priorityBadgeClasses(priority: string): string {
  switch (priority) {
    case 'low':
      return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
    case 'normal':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    case 'high':
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
    case 'urgent':
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    default:
      return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case 'in_progress': return t('support.status.inProgress')
    case 'open': return t('support.status.open')
    case 'resolved': return t('support.status.resolved')
    case 'closed': return t('support.status.closed')
    default: return status
  }
}

function formatPriority(priority: string): string {
  return t('support.priority.' + priority)
}

function timeAgo(ts: string | null): string {
  if (!ts) return '--'
  const now = Date.now()
  const then = new Date(ts).getTime()
  const diff = now - then

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

async function fetchStats() {
  statsLoading.value = true
  try {
    const data = await api.get<StatsResponse>('/admin/support/stats')
    stats.value = data
  } catch {
    // Keep existing stats on failure
  } finally {
    statsLoading.value = false
  }
}

async function fetchTickets() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({
      page: page.value.toString(),
      limit: limit.value.toString(),
    })
    if (filters.status) params.set('status', filters.status)
    if (filters.priority) params.set('priority', filters.priority)
    if (filters.search) params.set('search', filters.search)

    const data = await api.get<TicketListResponse>(`/admin/support/tickets?${params}`)
    tickets.value = data.data ?? []
    totalPages.value = data.pagination?.totalPages ?? 1
    total.value = data.pagination?.total ?? 0
  } catch (err: any) {
    error.value = err?.body?.error || t('support.admin.loadError')
    tickets.value = []
  } finally {
    loading.value = false
  }
}

function onFilterChange() {
  page.value = 1
  fetchTickets()
}

function onSearchInput() {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    page.value = 1
    fetchTickets()
  }, 300)
}

function viewTicket(ticket: Ticket) {
  router.push(`/admin/support/${ticket.id}`)
}

onMounted(() => {
  fetchStats()
  fetchTickets()
})
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-6">
      <div class="flex items-center gap-3">
        <LifeBuoy class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('support.admin.title') }}</h1>
          <p v-if="!loading" class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{{ t('support.admin.ticketCount', { count: total.toLocaleString() }) }}</p>
        </div>
      </div>
      <div v-if="!statsLoading" class="flex items-center gap-2">
        <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
          {{ t('support.admin.openCount', { count: stats.open }) }}
        </span>
        <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
          {{ t('support.admin.inProgressCount', { count: stats.inProgress }) }}
        </span>
      </div>
    </div>

    <!-- Error alert -->
    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- Filters -->
    <div class="mb-6 flex flex-wrap items-end gap-4">
      <div>
        <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">{{ t('support.admin.filterStatus') }}</label>
        <select
          v-model="filters.status"
          @change="onFilterChange"
          class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        >
          <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">{{ t('support.admin.filterPriority') }}</label>
        <select
          v-model="filters.priority"
          @change="onFilterChange"
          class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        >
          <option v-for="opt in priorityOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <div class="flex-1 min-w-[200px]">
        <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">{{ t('support.admin.filterSearch') }}</label>
        <div class="relative">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            v-model="filters.search"
            type="text"
            :placeholder="t('support.admin.searchPlaceholder')"
            class="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            @input="onSearchInput"
          />
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <!-- Table -->
    <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('support.admin.tableSubject') }}</th>
              <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('support.admin.tableAccount') }}</th>
              <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('support.admin.tableCreatedBy') }}</th>
              <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('support.admin.tableStatus') }}</th>
              <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('support.admin.tablePriority') }}</th>
              <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('support.admin.tableAssignedTo') }}</th>
              <th class="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('support.admin.tableUpdated') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="tickets.length === 0">
              <td colspan="7" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                {{ t('support.admin.noTickets') }}
              </td>
            </tr>
            <tr
              v-for="ticket in tickets"
              :key="ticket.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer"
              @click="viewTicket(ticket)"
            >
              <td class="px-5 py-3.5">
                <span class="text-sm font-medium text-gray-900 dark:text-white">{{ ticket.subject }}</span>
              </td>
              <td class="px-5 py-3.5 text-sm text-gray-600 dark:text-gray-400">
                {{ ticket.accountName || '--' }}
              </td>
              <td class="px-5 py-3.5 text-sm">
                <span v-if="ticket.creatorName" class="text-gray-900 dark:text-white">{{ ticket.creatorName }}</span>
                <span v-else-if="ticket.creatorEmail" class="text-gray-600 dark:text-gray-400">{{ ticket.creatorEmail }}</span>
                <span v-else class="text-gray-400 dark:text-gray-500">--</span>
              </td>
              <td class="px-5 py-3.5">
                <span :class="['inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', statusBadgeClasses(ticket.status)]">
                  {{ formatStatus(ticket.status) }}
                </span>
              </td>
              <td class="px-5 py-3.5">
                <span :class="['inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', priorityBadgeClasses(ticket.priority)]">
                  {{ formatPriority(ticket.priority) }}
                </span>
              </td>
              <td class="px-5 py-3.5 text-sm text-gray-600 dark:text-gray-400">
                {{ ticket.assigneeName || t('support.admin.unassigned') }}
              </td>
              <td class="px-5 py-3.5 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {{ timeAgo(ticket.updatedAt) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('support.admin.pageOf', { page, total: totalPages }) }}</p>
        <div class="flex gap-2">
          <button
            @click="page--; fetchTickets()"
            :disabled="page <= 1"
            class="px-3 py-1.5 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {{ t('common.previous') }}
          </button>
          <button
            @click="page++; fetchTickets()"
            :disabled="page >= totalPages"
            class="px-3 py-1.5 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {{ t('common.next') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
