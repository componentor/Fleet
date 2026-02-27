<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue'
import { ArrowLeft, Send, Loader2, Lock, Unlock } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { renderMarkdown } from '@/utils/markdown'

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
  createdAt: string
  updatedAt: string
  messages: Message[]
}

const props = defineProps<{ id: string }>()

const api = useApi()

const ticket = ref<TicketDetail | null>(null)
const loading = ref(true)
const error = ref('')
const replyBody = ref('')
const sending = ref(false)
const toggling = ref(false)

const messagesEnd = ref<HTMLDivElement | null>(null)

const statusLabel = computed(() => {
  if (!ticket.value) return ''
  const s = ticket.value.status
  if (s === 'open') return 'Open'
  if (s === 'in_progress') return 'In Progress'
  if (s === 'closed') return 'Closed'
  return s.charAt(0).toUpperCase() + s.slice(1)
})

const statusClasses = computed(() => {
  if (!ticket.value) return ''
  const s = ticket.value.status
  if (s === 'open') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  if (s === 'in_progress') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
  if (s === 'closed') return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
  return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
})

const priorityLabel = computed(() => {
  if (!ticket.value) return ''
  const p = ticket.value.priority
  if (p === 'low') return 'Low'
  if (p === 'medium') return 'Medium'
  if (p === 'high') return 'High'
  if (p === 'urgent') return 'Urgent'
  return p.charAt(0).toUpperCase() + p.slice(1)
})

const priorityClasses = computed(() => {
  if (!ticket.value) return ''
  const p = ticket.value.priority
  if (p === 'low') return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
  if (p === 'medium') return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
  if (p === 'high') return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
  if (p === 'urgent') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
})

const isClosed = computed(() => ticket.value?.status === 'closed')

function formatDate(ts: string) {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function timeAgo(ts: string): string {
  const now = Date.now()
  const then = new Date(ts).getTime()
  const seconds = Math.floor((now - then) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(ts)
}

function getInitial(name: string | null): string {
  if (!name) return '?'
  return name.charAt(0).toUpperCase()
}

/**
 * Determine if a message is from a support agent.
 * Agent messages have authorName set and typically differ from the ticket creator.
 * Since we don't have the current user ID on the ticket response, we use a heuristic:
 * the first message author is the ticket creator (user), anyone else is an agent.
 */
function isAgentMessage(msg: Message): boolean {
  if (!ticket.value || ticket.value.messages.length === 0) return false
  const firstAuthorId = ticket.value.messages[0]!.authorId
  return msg.authorId !== firstAuthorId
}

async function scrollToBottom() {
  await nextTick()
  messagesEnd.value?.scrollIntoView({ behavior: 'smooth' })
}

async function fetchTicket() {
  loading.value = true
  error.value = ''
  try {
    const data = await api.get<TicketDetail>(`/support/tickets/${props.id}`)
    ticket.value = data
    await scrollToBottom()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to load ticket'
  } finally {
    loading.value = false
  }
}

async function sendReply() {
  const body = replyBody.value.trim()
  if (!body || sending.value) return

  sending.value = true
  try {
    const msg = await api.post<Message>(`/support/tickets/${props.id}/messages`, { body })
    ticket.value?.messages.push(msg)
    replyBody.value = ''
    await scrollToBottom()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to send reply'
  } finally {
    sending.value = false
  }
}

async function closeTicket() {
  toggling.value = true
  try {
    const updated = await api.patch<TicketDetail>(`/support/tickets/${props.id}/close`, {})
    if (ticket.value) {
      ticket.value.status = updated.status ?? 'closed'
    }
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to close ticket'
  } finally {
    toggling.value = false
  }
}

async function reopenTicket() {
  toggling.value = true
  try {
    const updated = await api.patch<TicketDetail>(`/support/tickets/${props.id}/reopen`, {})
    if (ticket.value) {
      ticket.value.status = updated.status ?? 'open'
    }
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to reopen ticket'
  } finally {
    toggling.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    sendReply()
  }
}

onMounted(() => {
  fetchTicket()
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Back link -->
    <div class="mb-6">
      <router-link
        to="/panel/support"
        class="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        <ArrowLeft class="w-4 h-4" />
        Back to Support
      </router-link>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <!-- Error (when no ticket loaded) -->
    <div v-else-if="!ticket && error" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- Ticket content -->
    <template v-else-if="ticket">
      <!-- Header -->
      <div class="mb-6">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h1 class="text-2xl font-bold text-gray-900 dark:text-white truncate">
              {{ ticket.subject }}
            </h1>
            <div class="flex flex-wrap items-center gap-2.5 mt-2">
              <span
                :class="['inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', statusClasses]"
              >
                {{ statusLabel }}
              </span>
              <span
                :class="['inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', priorityClasses]"
              >
                {{ priorityLabel }}
              </span>
              <span class="text-xs text-gray-400 dark:text-gray-500">
                Opened {{ formatDate(ticket.createdAt) }}
              </span>
            </div>
          </div>

          <!-- Close / Reopen button -->
          <button
            v-if="isClosed"
            @click="reopenTicket"
            :disabled="toggling"
            class="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            <Loader2 v-if="toggling" class="w-4 h-4 animate-spin" />
            <Unlock v-else class="w-4 h-4" />
            Reopen Ticket
          </button>
          <button
            v-else
            @click="closeTicket"
            :disabled="toggling"
            class="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            <Loader2 v-if="toggling" class="w-4 h-4 animate-spin" />
            <Lock v-else class="w-4 h-4" />
            Close Ticket
          </button>
        </div>
      </div>

      <!-- Inline error -->
      <div v-if="error" class="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>

      <!-- Messages thread -->
      <div class="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col overflow-hidden">
        <!-- Message list -->
        <div class="flex-1 overflow-y-auto p-6 space-y-6">
          <div v-if="ticket.messages.length === 0" class="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
            No messages yet.
          </div>

          <div
            v-for="msg in ticket.messages"
            :key="msg.id"
            :class="[
              'rounded-lg p-4',
              isAgentMessage(msg)
                ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40'
                : 'bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700',
            ]"
          >
            <div class="flex items-center gap-3 mb-3">
              <!-- Avatar -->
              <div
                :class="[
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0',
                  isAgentMessage(msg)
                    ? 'bg-blue-200 dark:bg-blue-800 text-blue-700 dark:text-blue-200'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
                ]"
              >
                {{ getInitial(msg.authorName) }}
              </div>

              <!-- Name + time -->
              <div class="min-w-0 flex-1">
                <span class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ msg.authorName || 'Unknown' }}
                </span>
                <span
                  v-if="isAgentMessage(msg)"
                  class="ml-2 text-xs text-blue-600 dark:text-blue-400 font-medium"
                >
                  Support
                </span>
              </div>
              <span class="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                {{ timeAgo(msg.createdAt) }}
              </span>
            </div>

            <!-- Body -->
            <div
              class="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300 [&_a]:text-primary-600 dark:[&_a]:text-primary-400 [&_code]:bg-gray-200 dark:[&_code]:bg-gray-700 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs"
              v-html="renderMarkdown(msg.body)"
            />
          </div>

          <!-- Scroll anchor -->
          <div ref="messagesEnd" />
        </div>

        <!-- Reply form -->
        <div class="border-t border-gray-200 dark:border-gray-700 p-4">
          <div v-if="isClosed" class="text-center py-2 text-sm text-gray-500 dark:text-gray-400">
            This ticket is closed. Reopen it to reply.
          </div>
          <div v-else class="flex gap-3">
            <textarea
              v-model="replyBody"
              @keydown="handleKeydown"
              rows="3"
              placeholder="Type your reply... (Ctrl+Enter to send)"
              class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm resize-none"
            />
            <button
              @click="sendReply"
              :disabled="sending || !replyBody.trim()"
              class="self-end px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              <Loader2 v-if="sending" class="w-4 h-4 animate-spin" />
              <Send v-else class="w-4 h-4" />
              Send
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
