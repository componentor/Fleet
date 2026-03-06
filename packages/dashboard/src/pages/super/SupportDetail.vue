<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { renderMarkdown } from '@/utils/markdown'
import {
  ArrowLeft,
  Send,
  MessageSquare,
  Lock,
  Bold,
  Italic,
  Heading,
  Link,
  List,
  Code,
  Quote,
  Eye,
} from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'

interface Message {
  id: string
  ticketId: string
  authorId: string
  body: string
  senderRole: string
  isInternal: boolean
  authorName: string | null
  authorEmail: string | null
  authorAvatarUrl: string | null
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
const authStore = useAuthStore()
const { t } = useI18n()

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
const replyTextarea = ref<HTMLTextAreaElement | null>(null)
const previewReply = ref(false)

function isCustomerMessage(msg: Message): boolean {
  return msg.senderRole === 'customer'
}

function insertMarkdown(before: string, after: string = '') {
  const textarea = replyTextarea.value
  if (!textarea) return
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const text = textarea.value
  const selected = text.substring(start, end)
  const replacement = before + (selected || 'text') + after
  textarea.value = text.substring(0, start) + replacement + text.substring(end)
  textarea.selectionStart = start + before.length
  textarea.selectionEnd = start + before.length + (selected || 'text').length
  textarea.dispatchEvent(new Event('input'))
  textarea.focus()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault()
      const ta = replyTextarea.value
      if (ta) {
        const start = ta.selectionStart
        const end = ta.selectionEnd
        replyBody.value = replyBody.value.substring(0, start) + '\n' + replyBody.value.substring(end)
        nextTick(() => { ta.selectionStart = ta.selectionEnd = start + 1 })
      }
    } else if (!e.shiftKey) {
      e.preventDefault()
      sendReply()
    }
  }
}

const toolbarButtons = [
  { label: 'Bold', before: '**', after: '**', icon: Bold },
  { label: 'Italic', before: '*', after: '*', icon: Italic },
  { label: 'Heading', before: '## ', after: '', icon: Heading },
  { label: 'Link', before: '[', after: '](url)', icon: Link },
  { label: 'List', before: '- ', after: '', icon: List },
  { label: 'Code', before: '`', after: '`', icon: Code },
  { label: 'Quote', before: '> ', after: '', icon: Quote },
]

const statusOptions = computed(() => [
  { value: 'open', label: t('support.status.open') },
  { value: 'in_progress', label: t('support.status.inProgress') },
  { value: 'resolved', label: t('support.status.resolved') },
  { value: 'closed', label: t('support.status.closed') },
])

const priorityOptions = computed(() => [
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
  const keyMap: Record<string, string> = {
    in_progress: 'inProgress',
    open: 'open',
    resolved: 'resolved',
    closed: 'closed',
  }
  const key = keyMap[status]
  return key ? t('support.status.' + key) : status
}

function formatPriority(priority: string): string {
  return t('support.priority.' + priority)
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
    nextTick(() => {
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
      }
    })
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
    toast.success(t('support.admin.assigneeUpdated'))
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
  } catch {
    ticket.value = null
  } finally {
    loading.value = false
    scrollToBottom()
  }
}

async function updateStatus(newStatus: string) {
  if (!ticket.value || ticket.value.status === newStatus) return
  updatingStatus.value = true
  try {
    await api.patch(`/admin/support/tickets/${props.id}`, { status: newStatus })
    ticket.value.status = newStatus
    toast.success(t('support.admin.statusUpdated', { status: formatStatus(newStatus) }))
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
    toast.success(t('support.admin.priorityUpdated', { priority: formatPriority(newPriority) }))
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
    previewReply.value = false
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
    <div class="flex items-center gap-4 mb-6 shrink-0">
      <router-link
        to="/admin/support"
        class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <ArrowLeft class="w-4 h-4" />
        {{ t('support.admin.backToTickets') }}
      </router-link>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-8 h-8" />
    </div>

    <!-- Not found -->
    <div v-else-if="!ticket" class="text-center py-20">
      <p class="text-gray-500 dark:text-gray-400">{{ t('support.admin.ticketNotFound') }}</p>
    </div>

    <template v-else>
      <!-- Ticket header -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 mb-6 shrink-0">
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
                <span class="font-medium text-gray-700 dark:text-gray-300">{{ t('support.admin.account') }}:</span>
                {{ ticket.accountName || '--' }}
              </span>
              <span>
                <span class="font-medium text-gray-700 dark:text-gray-300">{{ t('support.admin.createdBy') }}:</span>
                {{ ticket.creatorName || ticket.creatorEmail || '--' }}
              </span>
              <span>
                <span class="font-medium text-gray-700 dark:text-gray-300">{{ t('support.admin.created') }}:</span>
                {{ formatDate(ticket.createdAt) }}
              </span>
              <span>
                <span class="font-medium text-gray-700 dark:text-gray-300">{{ t('support.admin.updated') }}:</span>
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
              {{ t('support.admin.messagesTitle', { count: ticket.messages.length }) }}
            </h2>
          </div>

          <!-- Messages list -->
          <div
            ref="messagesContainer"
            class="flex-1 overflow-y-auto p-6 space-y-4"
          >
            <div v-if="ticket.messages.length === 0" class="text-center py-12">
              <p class="text-sm text-gray-400 dark:text-gray-500">{{ t('support.admin.noMessages') }}</p>
            </div>

            <div
              v-for="msg in ticket.messages"
              :key="msg.id"
              :class="['flex gap-3', isCustomerMessage(msg) ? 'justify-end' : 'justify-start']"
            >
              <!-- Avatar (left side for other's messages) -->
              <div v-if="!isCustomerMessage(msg)" class="w-8 h-8 rounded-full shrink-0 mt-1 overflow-hidden bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-semibold text-gray-600 dark:text-gray-300">
                <img v-if="msg.authorAvatarUrl" :src="msg.authorAvatarUrl" class="w-full h-full object-cover" />
                <span v-else>{{ authorInitial(msg) }}</span>
              </div>

              <!-- Bubble -->
              <div
                :class="[
                  'max-w-[75%] rounded-2xl px-4 py-3',
                  msg.isInternal
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700'
                    : isCustomerMessage(msg)
                      ? 'bg-primary-600 dark:bg-primary-700 text-white rounded-tr-sm'
                      : 'bg-gray-100 dark:bg-gray-700 rounded-tl-sm',
                ]"
              >
                <!-- Author name -->
                <div class="flex items-center gap-2 mb-1">
                  <span :class="[
                    'text-xs font-semibold',
                    msg.isInternal ? 'text-amber-700 dark:text-amber-300'
                      : isCustomerMessage(msg) ? 'text-primary-200 dark:text-primary-300'
                      : 'text-gray-500 dark:text-gray-400',
                  ]">
                    {{ authorDisplayName(msg) }}
                  </span>
                  <span v-if="msg.isInternal" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                    <Lock class="w-2.5 h-2.5" />
                    {{ t('support.admin.internalNote') }}
                  </span>
                </div>

                <!-- Body -->
                <div
                  :class="[
                    'prose prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs',
                    msg.isInternal
                      ? 'text-amber-900 dark:text-amber-100 [&_a]:text-primary-600 dark:[&_a]:text-primary-400 [&_code]:bg-amber-100 dark:[&_code]:bg-amber-800'
                      : isCustomerMessage(msg)
                        ? 'prose-invert text-white [&_a]:text-blue-200 [&_code]:bg-primary-500 dark:[&_code]:bg-primary-600'
                        : 'dark:prose-invert text-gray-800 dark:text-gray-200 [&_a]:text-primary-600 dark:[&_a]:text-primary-400 [&_code]:bg-gray-200 dark:[&_code]:bg-gray-600',
                  ]"
                  v-html="renderMarkdown(msg.body)"
                />

                <!-- Timestamp -->
                <div :class="['text-[10px] mt-1.5 text-right',
                  msg.isInternal ? 'text-amber-500 dark:text-amber-400'
                    : isCustomerMessage(msg) ? 'text-primary-200 dark:text-primary-300'
                    : 'text-gray-400 dark:text-gray-500']">
                  {{ timeAgo(msg.createdAt) }}
                </div>
              </div>

              <!-- Avatar (right side for own messages) -->
              <div v-if="isCustomerMessage(msg)" class="w-8 h-8 rounded-full shrink-0 mt-1 overflow-hidden bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center text-xs font-semibold text-primary-700 dark:text-primary-300">
                <img v-if="msg.authorAvatarUrl" :src="msg.authorAvatarUrl" class="w-full h-full object-cover" />
                <span v-else>{{ authorInitial(msg) }}</span>
              </div>
            </div>
          </div>

          <!-- Reply form -->
          <div class="border-t border-gray-200 dark:border-gray-700 p-6">
            <!-- Markdown toolbar -->
            <div class="flex items-center gap-1 mb-2 p-1 bg-gray-50 dark:bg-gray-750 rounded-lg border border-gray-200 dark:border-gray-600">
              <button
                v-for="btn in toolbarButtons"
                :key="btn.label"
                @click="insertMarkdown(btn.before, btn.after)"
                :title="btn.label"
                class="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 transition-colors"
              >
                <component :is="btn.icon" class="w-4 h-4" />
              </button>
              <div class="flex-1" />
              <button
                @click="previewReply = !previewReply"
                :title="previewReply ? 'Edit' : 'Preview'"
                :class="['p-1.5 rounded transition-colors', previewReply ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400']"
              >
                <Eye class="w-4 h-4" />
              </button>
            </div>

            <!-- Editor / Preview -->
            <div v-if="previewReply && replyBody.trim()" class="min-h-[100px] px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 prose prose-sm dark:prose-invert max-w-none" v-html="renderMarkdown(replyBody)" />
            <textarea
              v-else
              ref="replyTextarea"
              v-model="replyBody"
              rows="4"
              :placeholder="t('support.admin.replyPlaceholder')"
              class="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm resize-y"
              @keydown="handleKeydown"
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
                  {{ t('support.admin.internalNoteLabel') }}
                </span>
              </label>
              <button
                @click="sendReply"
                :disabled="!replyBody.trim() || sending"
                class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <CompassSpinner v-if="sending" size="w-4 h-4" />
                <Send v-else class="w-4 h-4" />
                {{ t('support.admin.sendReply') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Sidebar -->
        <div class="lg:w-72 shrink-0 space-y-4">
          <!-- Status control -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              {{ t('support.admin.statusLabel') }}
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
              {{ t('support.admin.priorityLabel') }}
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
              {{ t('support.admin.assignedTo') }}
            </label>
            <select
              :value="ticket.assignedTo ?? ''"
              @change="updateAssignee(($event.target as HTMLSelectElement).value || null)"
              :disabled="updatingAssignee"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
            >
              <option value="">{{ t('support.admin.unassigned') }}</option>
              <option v-for="a in assignees" :key="a.id" :value="a.id">
                {{ a.name || a.email }}
              </option>
            </select>
          </div>

          <!-- Ticket info -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              {{ t('support.admin.detailsTitle') }}
            </label>
            <div class="space-y-3 text-sm">
              <div class="flex items-center justify-between">
                <span class="text-gray-500 dark:text-gray-400">{{ t('support.admin.ticketId') }}</span>
                <span class="font-mono text-xs text-gray-700 dark:text-gray-300 truncate max-w-[140px]" :title="ticket.id">
                  {{ ticket.id }}
                </span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-gray-500 dark:text-gray-400">{{ t('support.admin.account') }}</span>
                <span class="text-gray-700 dark:text-gray-300">{{ ticket.accountName || '--' }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-gray-500 dark:text-gray-400">{{ t('support.admin.created') }}</span>
                <span class="text-gray-700 dark:text-gray-300">{{ timeAgo(ticket.createdAt) }}</span>
              </div>
              <div v-if="ticket.closedAt" class="flex items-center justify-between">
                <span class="text-gray-500 dark:text-gray-400">{{ t('support.admin.closed') }}</span>
                <span class="text-gray-700 dark:text-gray-300">{{ formatDate(ticket.closedAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
