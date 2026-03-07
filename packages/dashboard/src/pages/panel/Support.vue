<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { LifeBuoy, Plus, X, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'

interface Ticket {
  id: string
  subject: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  accountId: string
  createdBy: string
  assignedTo: string | null
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

const { t } = useI18n()
const router = useRouter()
const api = useApi()

const tickets = ref<Ticket[]>([])
const loading = ref(true)
const page = ref(1)
const limit = ref(20)
const totalPages = ref(1)
const total = ref(0)

// New ticket form
const showForm = ref(false)
const showSubmittedModal = ref(false)
const creating = ref(false)
const error = ref('')
const newTicket = ref({
  subject: '',
  priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
  body: '',
})

const statusColors: Record<string, string> = {
  open: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  in_progress: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  resolved: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  closed: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
}

const priorityColors: Record<string, string> = {
  low: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  normal: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  high: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  urgent: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
}

const statusLabels = computed(() => ({
  open: t('support.status.open'),
  in_progress: t('support.status.inProgress'),
  resolved: t('support.status.resolved'),
  closed: t('support.status.closed'),
}))

const priorityLabels = computed(() => ({
  low: t('support.priority.low'),
  normal: t('support.priority.normal'),
  high: t('support.priority.high'),
  urgent: t('support.priority.urgent'),
}))

async function fetchTickets() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: page.value.toString(),
      limit: limit.value.toString(),
    })
    const data = await api.get<TicketListResponse>(`/support/tickets?${params}`)
    tickets.value = data.data ?? []
    totalPages.value = data.pagination?.totalPages ?? 1
    total.value = data.pagination?.total ?? 0
  } catch {
    tickets.value = []
  } finally {
    loading.value = false
  }
}

async function createTicket() {
  if (!newTicket.value.subject.trim() || !newTicket.value.body.trim()) return
  creating.value = true
  error.value = ''
  try {
    const created = await api.post<Ticket>('/support/tickets', {
      subject: newTicket.value.subject.trim(),
      body: newTicket.value.body.trim(),
      priority: newTicket.value.priority,
    })
    // Prepend to list and close form
    tickets.value.unshift(created)
    total.value++
    showForm.value = false
    newTicket.value = { subject: '', priority: 'normal', body: '' }
    showSubmittedModal.value = true
  } catch (err: any) {
    error.value = err?.body?.error || t('support.panel.createError')
  } finally {
    creating.value = false
  }
}

function goToTicket(id: string) {
  router.push(`/panel/support/${id}`)
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const seconds = Math.floor((now - then) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(months / 12)
  return `${years}y ago`
}

function prevPage() {
  if (page.value > 1) {
    page.value--
    fetchTickets()
  }
}

function nextPage() {
  if (page.value < totalPages.value) {
    page.value++
    fetchTickets()
  }
}

onMounted(() => {
  fetchTickets()
})
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <LifeBuoy class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('support.panel.title') }}</h1>
          <p v-if="!loading" class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {{ total === 1 ? t('support.panel.ticketCountSingular', { count: total }) : t('support.panel.ticketCount', { count: total.toLocaleString() }) }}
          </p>
        </div>
      </div>
      <button
        v-if="!showForm"
        @click="showForm = true"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        {{ t('support.panel.newTicket') }}
      </button>
    </div>

    <!-- Error alert -->
    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- New Ticket Form -->
    <div v-if="showForm" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
      <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('support.panel.createTitle') }}</h3>
        <button
          @click="showForm = false"
          class="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <X class="w-4 h-4" />
        </button>
      </div>
      <form @submit.prevent="createTicket" class="p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('support.panel.subjectLabel') }}</label>
          <input
            v-model="newTicket.subject"
            type="text"
            :placeholder="t('support.panel.subjectPlaceholder')"
            required
            class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('support.panel.priorityLabel') }}</label>
          <select
            v-model="newTicket.priority"
            class="w-full max-w-xs px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          >
            <option value="low">{{ t('support.priority.low') }}</option>
            <option value="normal">{{ t('support.priority.normal') }}</option>
            <option value="high">{{ t('support.priority.high') }}</option>
            <option value="urgent">{{ t('support.priority.urgent') }}</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('support.panel.descriptionLabel') }}</label>
          <textarea
            v-model="newTicket.body"
            rows="5"
            :placeholder="t('support.panel.descriptionPlaceholder')"
            required
            class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm resize-y"
          />
        </div>

        <div class="flex items-center gap-3">
          <button
            type="submit"
            :disabled="creating || !newTicket.subject.trim() || !newTicket.body.trim()"
            class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            <CompassSpinner v-if="creating" size="w-4 h-4" />
            <Plus v-else class="w-4 h-4" />
            {{ creating ? t('support.panel.creating') : t('support.panel.submitTicket') }}
          </button>
          <button
            type="button"
            @click="showForm = false"
            class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </form>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <!-- Ticket List -->
    <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('support.panel.tableSubject') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('support.panel.tableStatus') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('support.panel.tablePriority') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('support.panel.tableUpdated') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <!-- Empty state -->
            <tr v-if="tickets.length === 0">
              <td colspan="4" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                {{ t('support.panel.noTickets') }}
              </td>
            </tr>
            <!-- Ticket rows -->
            <tr
              v-for="ticket in tickets"
              :key="ticket.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer"
              @click="goToTicket(ticket.id)"
            >
              <td class="px-6 py-4">
                <span class="text-sm font-medium text-gray-900 dark:text-white">{{ ticket.subject }}</span>
              </td>
              <td class="px-6 py-4">
                <span
                  :class="['inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', statusColors[ticket.status]]"
                >
                  {{ statusLabels[ticket.status] }}
                </span>
              </td>
              <td class="px-6 py-4">
                <span
                  :class="['inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', priorityColors[ticket.priority]]"
                >
                  {{ priorityLabels[ticket.priority] }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                {{ timeAgo(ticket.updatedAt) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <p class="text-xs text-gray-500 dark:text-gray-400">
          {{ t('support.panel.pageOf', { page, total: totalPages }) }}
        </p>
        <div class="flex gap-2">
          <button
            @click="prevPage"
            :disabled="page <= 1"
            class="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft class="w-3.5 h-3.5" />
            {{ t('common.previous') }}
          </button>
          <button
            @click="nextPage"
            :disabled="page >= totalPages"
            class="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {{ t('common.next') }}
            <ChevronRight class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- Ticket Submitted Modal -->
    <Teleport to="body">
      <div v-if="showSubmittedModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="fixed inset-0 bg-black/50" @click="showSubmittedModal = false" />
        <div class="relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-full max-w-md">
          <div class="p-6 text-center">
            <div class="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
              <svg class="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ t('support.panel.submittedTitle') }}</h2>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">{{ t('support.panel.submittedMessage') }}</p>
            <button
              @click="showSubmittedModal = false"
              class="px-6 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
            >
              {{ t('support.panel.submittedClose') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
