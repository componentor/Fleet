<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue'
import { ArrowLeft, Send, Loader2, Lock, Unlock, Bold, Italic, Heading, Link, List, Code, Quote, Eye } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useApi } from '@/composables/useApi'
import { useAuthStore } from '@/stores/auth'
import { renderMarkdown } from '@/utils/markdown'

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
  createdAt: string
  updatedAt: string
  messages: Message[]
}

const props = defineProps<{ id: string }>()

const { t } = useI18n()
const api = useApi()
const authStore = useAuthStore()

const ticket = ref<TicketDetail | null>(null)
const loading = ref(true)
const error = ref('')
const replyBody = ref('')
const sending = ref(false)
const toggling = ref(false)

const messagesEnd = ref<HTMLDivElement | null>(null)
const messagesContainer = ref<HTMLElement | null>(null)

const statusLabel = computed(() => {
  if (!ticket.value) return ''
  const s = ticket.value.status
  if (s === 'open') return t('support.status.open')
  if (s === 'in_progress') return t('support.status.inProgress')
  if (s === 'closed') return t('support.status.closed')
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
  if (p === 'low') return t('support.priority.low')
  if (p === 'medium') return t('support.priority.medium')
  if (p === 'high') return t('support.priority.high')
  if (p === 'urgent') return t('support.priority.urgent')
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

function isOwnMessage(msg: Message): boolean {
  return msg.senderRole === 'customer'
}

async function scrollToBottom() {
  await nextTick()
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

async function fetchTicket() {
  loading.value = true
  error.value = ''
  try {
    const data = await api.get<TicketDetail>(`/support/tickets/${props.id}`)
    ticket.value = data
  } catch (err: any) {
    error.value = err?.body?.error || t('support.panel.loadError')
  } finally {
    loading.value = false
    await scrollToBottom()
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
    error.value = err?.body?.error || t('support.panel.sendError')
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
    error.value = err?.body?.error || t('support.panel.closeError')
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
    error.value = err?.body?.error || t('support.panel.reopenError')
  } finally {
    toggling.value = false
  }
}

const replyTextarea = ref<HTMLTextAreaElement | null>(null)
const previewReply = ref(false)

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

const toolbarButtons = [
  { label: 'Bold', before: '**', after: '**', icon: Bold },
  { label: 'Italic', before: '*', after: '*', icon: Italic },
  { label: 'Heading', before: '## ', after: '', icon: Heading },
  { label: 'Link', before: '[', after: '](url)', icon: Link },
  { label: 'List', before: '- ', after: '', icon: List },
  { label: 'Code', before: '`', after: '`', icon: Code },
  { label: 'Quote', before: '> ', after: '', icon: Quote },
]

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

onMounted(() => {
  fetchTicket()
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Back link -->
    <div class="mb-6 shrink-0">
      <router-link
        to="/panel/support"
        class="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        <ArrowLeft class="w-4 h-4" />
        {{ t('support.panel.backToSupport') }}
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
      <div class="mb-6 shrink-0">
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
                {{ t('support.panel.opened', { date: formatDate(ticket.createdAt) }) }}
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
            {{ t('support.panel.reopenTicket') }}
          </button>
          <button
            v-else
            @click="closeTicket"
            :disabled="toggling"
            class="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            <Loader2 v-if="toggling" class="w-4 h-4 animate-spin" />
            <Lock v-else class="w-4 h-4" />
            {{ t('support.panel.closeTicket') }}
          </button>
        </div>
      </div>

      <!-- Inline error -->
      <div v-if="error" class="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>

      <!-- Messages thread -->
      <div class="flex-1 min-h-0 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col overflow-hidden">
        <!-- Message list -->
        <div ref="messagesContainer" class="flex-1 overflow-y-auto p-6 space-y-4">
          <div v-if="ticket.messages.length === 0" class="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
            {{ t('support.panel.noMessages') }}
          </div>

          <div
            v-for="msg in ticket.messages"
            :key="msg.id"
            :class="['flex gap-3', isOwnMessage(msg) ? 'justify-end' : 'justify-start']"
          >
            <!-- Avatar (left side for other's messages) -->
            <div v-if="!isOwnMessage(msg)" class="w-8 h-8 rounded-full shrink-0 mt-1 overflow-hidden bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-semibold text-gray-600 dark:text-gray-300">
              <img v-if="msg.authorAvatarUrl" :src="msg.authorAvatarUrl" class="w-full h-full object-cover" />
              <span v-else>{{ getInitial(msg.authorName) }}</span>
            </div>

            <!-- Bubble -->
            <div
              :class="[
                'max-w-[75%] rounded-2xl px-4 py-3',
                isOwnMessage(msg)
                  ? 'bg-primary-600 dark:bg-primary-700 text-white rounded-tr-sm'
                  : 'bg-gray-100 dark:bg-gray-700 rounded-tl-sm',
              ]"
            >
              <!-- Author name -->
              <div class="flex items-center gap-2 mb-1">
                <span :class="['text-xs font-semibold', isOwnMessage(msg) ? 'text-primary-200 dark:text-primary-300' : 'text-blue-600 dark:text-blue-400']">
                  {{ msg.authorName || (isOwnMessage(msg) ? t('support.panel.you') : 'Support') }}
                </span>
              </div>

              <!-- Body -->
              <div
                :class="[
                  'prose prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs',
                  isOwnMessage(msg)
                    ? 'prose-invert text-white [&_a]:text-blue-200 [&_code]:bg-primary-500 dark:[&_code]:bg-primary-600'
                    : 'dark:prose-invert text-gray-800 dark:text-gray-200 [&_a]:text-primary-600 dark:[&_a]:text-primary-400 [&_code]:bg-gray-200 dark:[&_code]:bg-gray-600',
                ]"
                v-html="renderMarkdown(msg.body)"
              />

              <!-- Timestamp -->
              <div :class="['text-[10px] mt-1.5 text-right', isOwnMessage(msg) ? 'text-primary-200 dark:text-primary-300' : 'text-gray-400 dark:text-gray-500']">
                {{ timeAgo(msg.createdAt) }}
              </div>
            </div>

            <!-- Avatar (right side for own messages) -->
            <div v-if="isOwnMessage(msg)" class="w-8 h-8 rounded-full shrink-0 mt-1 overflow-hidden bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center text-xs font-semibold text-primary-700 dark:text-primary-300">
              <img v-if="msg.authorAvatarUrl" :src="msg.authorAvatarUrl" class="w-full h-full object-cover" />
              <span v-else>{{ getInitial(msg.authorName) }}</span>
            </div>
          </div>

        </div>

        <!-- Reply form -->
        <div class="border-t border-gray-200 dark:border-gray-700 p-4">
          <div v-if="isClosed" class="text-center py-2 text-sm text-gray-500 dark:text-gray-400">
            {{ t('support.panel.closedNotice') }}
          </div>
          <div v-else>
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
            <div v-if="previewReply && replyBody.trim()" class="min-h-[80px] px-3.5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 prose prose-sm dark:prose-invert max-w-none mb-3" v-html="renderMarkdown(replyBody)" />
            <textarea
              v-else
              ref="replyTextarea"
              v-model="replyBody"
              @keydown="handleKeydown"
              rows="3"
              :placeholder="t('support.panel.replyPlaceholder')"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm resize-none mb-3"
            />

            <div class="flex justify-end">
              <button
                @click="sendReply"
                :disabled="sending || !replyBody.trim()"
                class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-2"
              >
                <Loader2 v-if="sending" class="w-4 h-4 animate-spin" />
                <Send v-else class="w-4 h-4" />
                {{ t('support.panel.send') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
