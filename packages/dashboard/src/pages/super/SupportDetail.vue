<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { renderMarkdown } from '@/utils/markdown'
import {
  ArrowLeft,
  Loader2,
  Send,
  MessageSquare,
  Lock,
} from 'lucide-vue-next'

interface Message {
  id: string
  ticketId: string
  authorId: string
  body: string
  isInternal: boolean
  authorName: string | null
  authorEmail: string | null
  createdAt: string
  updatedAt: string
}

interface TicketDetail {
  id: string
  subject: string
  status: string
  priority: string
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
  messages: Message[]
}

const props = defineProps<{ id: string }>()

const router = useRouter()
const api = useApi()
const toast = useToast()

const ticket = ref<TicketDetail | null>(null)
const loading = ref(true)
const replyBody = ref('')
const isInternal = ref(false)
const sending = ref(false)
const updatingStatus = ref(false)
const updatingPriority = ref(false)
const updatingAssignee = ref(false)
const assignees = ref<{ id: string; name: string | null; email: string | null; avatarUrl: string | null }[]>([])
const messagesContainer = ref<HTMLElement | null>(null)

const statusOptions = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
]

const priorityOptions = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

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
    case 'in_progress': return 'In Progress'
    case 'open': return 'Open'
    case 'resolved': return 'Resolved'
    case 'closed': return 'Closed'
    default: return status
  }
}

function formatPriority(priority: string): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1)
}

function formatDate(ts: string | null): string {
  if (!ts) return '--'
  return new Date(ts).toLocaleString()
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

function authorInitial(msg: Message): string {
  if (msg.authorName) return msg.authorName.charAt(0).toUpperCase()
  if (msg.authorEmail) return msg.authorEmail.charAt(0).toUpperCase()
  return '?'
}

function authorDisplayName(msg: Message): string {
  return msg.authorName || msg.authorEmail || 'Unknown'
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

async function fetchAssignees() {
  try {
    const data = await api.get<{ id: string; name: string | null; email: string | null; avatarUrl: string | null }[]>('/admin/support/assignees')
    assignees.value = data
  } catch {
    // Non-critical
  }
}

async function updateAssignee(userId: string | null) {
  if (!ticket.value) return
  updatingAssignee.value = true
  try {
    await api.patch(`/admin/support/tickets/${props.id}`, { assignedTo: userId })
    ticket.value.assignedTo = userId
    const matched = assignees.value.find(a => a.id === userId)
    ticket.value.assigneeName = matched?.name ?? null
    ticket.value.assigneeEmail = matched?.email ?? null
    toast.success('Assignee updated')
  } catch {
    // Error handled by useApi toast
  } finally {
    updatingAssignee.value = false
  }
}

async function fetchTicket() {
  loading.value = true
  try {
    const data = await api.get<TicketDetail>(`/admin/support/tickets/${props.id}`)
    ticket.value = data
    scrollToBottom()
  } catch {
    ticket.value = null
  } finally {
    loading.value = false
  }
}

async function updateStatus(newStatus: string) {
  if (!ticket.value || ticket.value.status === newStatus) return
  updatingStatus.value = true
  try {
    await api.patch(`/admin/support/tickets/${props.id}`, { status: newStatus })
    ticket.value.status = newStatus
    toast.success(`Status updated to ${formatStatus(newStatus)}`)
  } catch {
    // Error handled by useApi toast
  } finally {
    updatingStatus.value = false
  }
}

async function updatePriority(newPriority: string) {
  if (!ticket.value || ticket.value.priority === newPriority) return
  updatingPriority.value = true
  try {
    await api.patch(`/admin/support/tickets/${props.id}`, { priority: newPriority })
    ticket.value.priority = newPriority
    toast.success(`Priority updated to ${formatPriority(newPriority)}`)
  } catch {
    // Error handled by useApi toast
  } finally {
    updatingPriority.value = false
  }
}

async function sendReply() {
  if (!replyBody.value.trim() || !ticket.value) return
  sending.value = true
  try {
    const msg = await api.post<Message>(`/admin/support/tickets/${props.id}/messages`, {
      body: replyBody.value,
      isInternal: isInternal.value,
    })
    ticket.value.messages.push(msg)
    replyBody.value = ''
    isInternal.value = false
    scrollToBottom()
  } catch {
    // Error handled by useApi toast
  } finally {
    sending.value = false
  }
}

onMounted(() => {
  fetchTicket()
  fetchAssignees()
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Back button -->
    <div class="flex items-center gap-4 mb-6">
      <router-link
        to="/admin/support"
        class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <ArrowLeft class="w-4 h-4" />
        Back to Tickets
      </router-link>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <!-- Not found -->
    <div v-else-if="!ticket" class="text-center py-20">
      <p class="text-gray-500 dark:text-gray-400">Ticket not found</p>
    </div>

    <template v-else>
      <!-- Ticket header -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 mb-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-3 mb-2">
              <h1 class="text-xl font-bold text-gray-900 dark:text-white">{{ ticket.subject }}</h1>
              <span :class="['inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', statusBadgeClasses(ticket.status)]">
                {{ formatStatus(ticket.status) }}
              </span>
              <span :class="['inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', priorityBadgeClasses(ticket.priority)]">
                {{ formatPriority(ticket.priority) }}
              </span>
            </div>
            <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600 dark:text-gray-400">
              <span>
                <span class="font-medium text-gray-700 dark:text-gray-300">Account:</span>
                {{ ticket.accountName || '--' }}
              </span>
              <span>
                <span class="font-medium text-gray-700 dark:text-gray-300">Created by:</span>
                {{ ticket.creatorName || ticket.creatorEmail || '--' }}
              </span>
              <span>
                <span class="font-medium text-gray-700 dark:text-gray-300">Created:</span>
                {{ formatDate(ticket.createdAt) }}
              </span>
              <span>
                <span class="font-medium text-gray-700 dark:text-gray-300">Updated:</span>
                {{ timeAgo(ticket.updatedAt) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Main content: Messages + Sidebar -->
      <div class="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        <!-- Messages column -->
        <div class="flex-1 flex flex-col min-h-0 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <!-- Messages header -->
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <MessageSquare class="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <h2 class="text-sm font-semibold text-gray-900 dark:text-white">
              Messages ({{ ticket.messages.length }})
            </h2>
          </div>

          <!-- Messages list -->
          <div
            ref="messagesContainer"
            class="flex-1 overflow-y-auto p-6 space-y-6 max-h-[600px]"
          >
            <div v-if="ticket.messages.length === 0" class="text-center py-12">
              <p class="text-sm text-gray-400 dark:text-gray-500">No messages yet.</p>
            </div>

            <div
              v-for="msg in ticket.messages"
              :key="msg.id"
              :class="[
                'flex gap-4',
                msg.isInternal ? 'pl-3 border-l-4 border-amber-400 dark:border-amber-500' : '',
              ]"
            >
              <!-- Author avatar -->
              <div
                :class="[
                  'w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0',
                  msg.isInternal
                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                    : 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300',
                ]"
              >
                {{ authorInitial(msg) }}
              </div>

              <!-- Message content -->
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2 mb-1">
                  <span class="text-sm font-semibold text-gray-900 dark:text-white">
                    {{ authorDisplayName(msg) }}
                  </span>
                  <span v-if="msg.isInternal" class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                    <Lock class="w-3 h-3" />
                    Internal Note
                  </span>
                  <span class="text-xs text-gray-400 dark:text-gray-500">
                    {{ formatDate(msg.createdAt) }}
                  </span>
                </div>
                <div
                  class="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:bg-gray-100 [&_code]:dark:bg-gray-900 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_a]:text-primary-600 [&_a]:dark:text-primary-400"
                  v-html="renderMarkdown(msg.body)"
                />
              </div>
            </div>
          </div>

          <!-- Reply form -->
          <div class="border-t border-gray-200 dark:border-gray-700 p-6">
            <textarea
              v-model="replyBody"
              rows="4"
              placeholder="Write a reply... (Markdown supported)"
              class="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm resize-y"
              @keydown.meta.enter="sendReply"
              @keydown.ctrl.enter="sendReply"
            />
            <div class="flex items-center justify-between mt-3">
              <label class="flex items-center gap-2 cursor-pointer select-none">
                <input
                  v-model="isInternal"
                  type="checkbox"
                  class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-amber-500 focus:ring-amber-500 dark:bg-gray-900"
                />
                <span class="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
                  <Lock class="w-3.5 h-3.5" />
                  Internal note
                </span>
              </label>
              <button
                @click="sendReply"
                :disabled="!replyBody.trim() || sending"
                class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Loader2 v-if="sending" class="w-4 h-4 animate-spin" />
                <Send v-else class="w-4 h-4" />
                Send Reply
              </button>
            </div>
          </div>
        </div>

        <!-- Sidebar -->
        <div class="lg:w-72 shrink-0 space-y-4">
          <!-- Status control -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Status
            </label>
            <select
              :value="ticket.status"
              @change="updateStatus(($event.target as HTMLSelectElement).value)"
              :disabled="updatingStatus"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
            >
              <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>

          <!-- Priority control -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Priority
            </label>
            <select
              :value="ticket.priority"
              @change="updatePriority(($event.target as HTMLSelectElement).value)"
              :disabled="updatingPriority"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
            >
              <option v-for="opt in priorityOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>

          <!-- Assigned to -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Assigned To
            </label>
            <select
              :value="ticket.assignedTo ?? ''"
              @change="updateAssignee(($event.target as HTMLSelectElement).value || null)"
              :disabled="updatingAssignee"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
            >
              <option value="">Unassigned</option>
              <option v-for="a in assignees" :key="a.id" :value="a.id">
                {{ a.name || a.email }}
              </option>
            </select>
          </div>

          <!-- Ticket info -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              Details
            </label>
            <div class="space-y-3 text-sm">
              <div class="flex items-center justify-between">
                <span class="text-gray-500 dark:text-gray-400">Ticket ID</span>
                <span class="font-mono text-xs text-gray-700 dark:text-gray-300 truncate max-w-[140px]" :title="ticket.id">
                  {{ ticket.id }}
                </span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-gray-500 dark:text-gray-400">Account</span>
                <span class="text-gray-700 dark:text-gray-300">{{ ticket.accountName || '--' }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-gray-500 dark:text-gray-400">Created</span>
                <span class="text-gray-700 dark:text-gray-300">{{ timeAgo(ticket.createdAt) }}</span>
              </div>
              <div v-if="ticket.closedAt" class="flex items-center justify-between">
                <span class="text-gray-500 dark:text-gray-400">Closed</span>
                <span class="text-gray-700 dark:text-gray-300">{{ formatDate(ticket.closedAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
