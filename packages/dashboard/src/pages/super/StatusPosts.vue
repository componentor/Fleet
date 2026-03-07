<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Save,
  Trash2,
  Plus,
  AlertTriangle,
  Wrench,
  CheckCircle,
  Info,
  AlertOctagon,
  TrendingDown,
  Eye,
  Bold,
  Italic,
  Heading,
  Link,
  List,
  Code,
  Quote,
  Languages,
  Megaphone,
} from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { renderMarkdown } from '@/utils/markdown'
import { useAdminPermissions } from '@/composables/useAdminPermissions'

const { t } = useI18n()
const api = useApi()
const adminPerms = useAdminPermissions()
const canWrite = computed(() => adminPerms.can('statusPosts', 'write'))

// ── Types ────────────────────────────────────────────────────────────────────

interface StatusPostTranslation {
  id: string
  postId: string
  locale: string
  title: string
  body: string
}

interface StatusPost {
  id: string
  icon: string
  severity: string
  status: string
  affectedServices: string[]
  publishedAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  translations: StatusPostTranslation[]
}

interface PaginatedResponse {
  data: StatusPost[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

// ── State ────────────────────────────────────────────────────────────────────

const loading = ref(true)
const saving = ref(false)
const deleting = ref(false)
const creating = ref(false)
const autoTranslating = ref(false)
const translationConfigured = ref(false)
const error = ref('')
const success = ref('')

const posts = ref<StatusPost[]>([])
const pagination = ref({ page: 1, limit: 20, total: 0, totalPages: 1 })
const filterStatus = ref<'all' | 'published' | 'draft'>('all')
const selectedPostId = ref<string | null>(null)

// Editor state
const editIcon = ref('incident')
const editSeverity = ref('info')
const editAffectedServices = ref<string[]>([])
const editStatus = ref('draft')
const editLocale = ref('en')
const editTranslations = ref<Record<string, { title: string; body: string }>>({})
const previewMode = ref(false)

const bodyTextareaRef = ref<HTMLTextAreaElement | null>(null)

// ── Constants ────────────────────────────────────────────────────────────────

const LOCALES = ['en', 'no', 'de', 'zh'] as const
const SERVICES = ['api', 'docker', 'storage', 'queue'] as const

const ICON_OPTIONS = [
  { key: 'incident', icon: AlertTriangle, color: 'text-amber-500' },
  { key: 'maintenance', icon: Wrench, color: 'text-blue-500' },
  { key: 'resolved', icon: CheckCircle, color: 'text-green-500' },
  { key: 'info', icon: Info, color: 'text-sky-500' },
  { key: 'outage', icon: AlertOctagon, color: 'text-red-500' },
  { key: 'degraded', icon: TrendingDown, color: 'text-orange-500' },
] as const

const SEVERITY_OPTIONS = ['info', 'warning', 'critical'] as const

// ── Computed ─────────────────────────────────────────────────────────────────

const selectedPost = computed(() =>
  posts.value.find((p) => p.id === selectedPostId.value) ?? null,
)

const currentTranslation = computed({
  get: () => {
    if (!editTranslations.value[editLocale.value]) {
      editTranslations.value[editLocale.value] = { title: '', body: '' }
    }
    return editTranslations.value[editLocale.value]!
  },
  set: (val: { title: string; body: string }) => {
    editTranslations.value[editLocale.value] = val
  },
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPostTitle(post: StatusPost): string {
  const en = post.translations.find((tr) => tr.locale === 'en')
  if (en?.title) return en.title
  if (post.translations.length > 0 && post.translations[0]?.title) return post.translations[0]!.title
  return t('super.statusPosts.untitled')
}

function getPostIconOption(post: StatusPost) {
  return ICON_OPTIONS.find((o) => o.key === post.icon) ?? ICON_OPTIONS[3]
}

function translationCount(post: StatusPost): number {
  return post.translations.length
}

function severityClass(severity: string): string {
  switch (severity) {
    case 'critical': return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    case 'warning': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
    default: return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
  }
}

function statusClass(status: string): string {
  return status === 'published'
    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return t('super.statusPosts.notPublished')
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffSec = Math.round((then - now) / 1000)

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  const absDiff = Math.abs(diffSec)
  if (absDiff < 60) return rtf.format(diffSec, 'second')
  if (absDiff < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (absDiff < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  if (absDiff < 2592000) return rtf.format(Math.round(diffSec / 86400), 'day')
  return rtf.format(Math.round(diffSec / 2592000), 'month')
}

function hasTranslation(locale: string): boolean {
  const tr = editTranslations.value[locale]
  return !!(tr && (tr.title.trim() || tr.body.trim()))
}

function clearMessages() {
  error.value = ''
  success.value = ''
}

function showSuccess(msg: string) {
  success.value = msg
  setTimeout(() => { success.value = '' }, 3000)
}

// ── API calls ────────────────────────────────────────────────────────────────

async function fetchPosts() {
  loading.value = true
  clearMessages()
  try {
    const statusParam = filterStatus.value === 'all' ? 'all' : filterStatus.value
    const res = await api.get<PaginatedResponse>(
      `/admin/status-posts?page=${pagination.value.page}&limit=${pagination.value.limit}&status=${statusParam}`,
    )
    posts.value = res.data
    pagination.value = res.pagination
  } catch {
    posts.value = []
  } finally {
    loading.value = false
  }
}

function selectPost(post: StatusPost) {
  selectedPostId.value = post.id
  editIcon.value = post.icon
  editSeverity.value = post.severity
  editAffectedServices.value = [...post.affectedServices]
  editStatus.value = post.status
  editLocale.value = 'en'
  previewMode.value = false
  clearMessages()

  // Build translations map from existing data
  const trMap: Record<string, { title: string; body: string }> = {}
  for (const locale of LOCALES) {
    const existing = post.translations.find((tr) => tr.locale === locale)
    trMap[locale] = existing
      ? { title: existing.title, body: existing.body }
      : { title: '', body: '' }
  }
  editTranslations.value = trMap
}

async function createPost() {
  creating.value = true
  clearMessages()
  try {
    const newPost = await api.post<StatusPost>('/admin/status-posts', {
      icon: 'incident',
      severity: 'info',
      affectedServices: [],
      status: 'draft',
      locale: 'en',
      title: t('super.statusPosts.newPostTitle'),
      body: '',
    })
    await fetchPosts()
    // Select the newly created post
    const found = posts.value.find((p) => p.id === newPost.id)
    if (found) selectPost(found)
    showSuccess(t('super.statusPosts.created'))
  } catch (err: any) {
    error.value = err?.body?.error || t('super.statusPosts.createFailed')
  } finally {
    creating.value = false
  }
}

async function savePost() {
  if (!selectedPostId.value) return
  saving.value = true
  clearMessages()
  try {
    // 1) Update metadata
    await api.patch(`/admin/status-posts/${selectedPostId.value}`, {
      icon: editIcon.value,
      severity: editSeverity.value,
      affectedServices: editAffectedServices.value,
      status: editStatus.value,
    })

    // 2) Upsert each translation that has content
    for (const locale of LOCALES) {
      const tr = editTranslations.value[locale]
      if (tr && (tr.title.trim() || tr.body.trim())) {
        await api.put(`/admin/status-posts/${selectedPostId.value}/translations/${locale}`, {
          title: tr.title,
          body: tr.body,
        })
      }
    }

    showSuccess(t('super.statusPosts.saved'))
    await fetchPosts()
    // Re-select to pick up any server-side changes
    const updated = posts.value.find((p) => p.id === selectedPostId.value)
    if (updated) selectPost(updated)
  } catch (err: any) {
    error.value = err?.body?.error || t('super.statusPosts.saveFailed')
  } finally {
    saving.value = false
  }
}

async function deletePost() {
  if (!selectedPostId.value) return
  if (!confirm(t('super.statusPosts.confirmDelete'))) return
  deleting.value = true
  clearMessages()
  try {
    await api.del(`/admin/status-posts/${selectedPostId.value}`)
    selectedPostId.value = null
    showSuccess(t('super.statusPosts.deleted'))
    await fetchPosts()
  } catch (err: any) {
    error.value = err?.body?.error || t('super.statusPosts.deleteFailed')
  } finally {
    deleting.value = false
  }
}

async function deleteTranslation(locale: string) {
  if (!selectedPostId.value) return
  if (!confirm(t('super.statusPosts.deleteTranslationConfirm', { locale: locale.toUpperCase() }))) return
  clearMessages()
  try {
    await api.del(`/admin/status-posts/${selectedPostId.value}/translations/${locale}`)
    editTranslations.value[locale] = { title: '', body: '' }
    showSuccess(t('super.statusPosts.translationDeleted'))
    await fetchPosts()
    const updated = posts.value.find((p) => p.id === selectedPostId.value)
    if (updated) {
      // Update translations map without resetting everything
      const existing = updated.translations.find((tr) => tr.locale === locale)
      editTranslations.value[locale] = existing
        ? { title: existing.title, body: existing.body }
        : { title: '', body: '' }
    }
  } catch (err: any) {
    error.value = err?.body?.error || t('super.statusPosts.deleteTranslationFailed')
  }
}

async function autoTranslate() {
  if (!selectedPostId.value) return
  autoTranslating.value = true
  clearMessages()
  try {
    const res = await api.post<{ translated: string[]; failed: string[] }>(
      `/admin/status-posts/${selectedPostId.value}/auto-translate`,
      { sourceLocale: editLocale.value },
    )
    showSuccess(t('super.statusPosts.translated', { count: res.translated.length }))
    await fetchPosts()
    const updated = posts.value.find((p) => p.id === selectedPostId.value)
    if (updated) selectPost(updated)
  } catch (err: any) {
    error.value = err?.body?.error || t('super.statusPosts.translateFailed')
  } finally {
    autoTranslating.value = false
  }
}

// ── Markdown toolbar ─────────────────────────────────────────────────────────

function insertMarkdown(before: string, after: string = '') {
  const textarea = bodyTextareaRef.value
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

// ── Watchers ─────────────────────────────────────────────────────────────────

watch(filterStatus, () => {
  pagination.value.page = 1
  fetchPosts()
})

// ── Lifecycle ────────────────────────────────────────────────────────────────

async function fetchTranslationStatus() {
  try {
    const data = await api.get<any>('/settings/translation')
    const provider = data.provider ?? 'deepl'
    translationConfigured.value = provider === 'deepl' ? !!data.deeplConfigured : !!data.claudeConfigured
  } catch {
    translationConfigured.value = false
  }
}

onMounted(() => {
  fetchPosts()
  fetchTranslationStatus()
  adminPerms.fetch()
})
</script>

<template>
  <div>
    <!-- Page header -->
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Megaphone class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('super.statusPosts.title') }}</h1>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading && posts.length === 0" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <!-- Main two-panel layout -->
    <div v-else class="flex flex-col lg:flex-row gap-6">

      <!-- ═══════════ Left panel — Post list ═══════════ -->
      <div class="lg:w-80 shrink-0">
        <!-- Status filter tabs -->
        <div class="flex items-center gap-1 mb-4">
          <button
            v-for="tab in (['all', 'published', 'draft'] as const)"
            :key="tab"
            @click="filterStatus = tab"
            :class="[
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              filterStatus === tab
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700',
            ]"
          >
            {{ t(`super.statusPosts.${tab}`) }}
          </button>
        </div>

        <!-- New post button -->
        <button
          v-if="canWrite"
          @click="createPost"
          :disabled="creating"
          class="w-full flex items-center justify-center gap-2 px-4 py-2.5 mb-4 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          <CompassSpinner v-if="creating" size="w-4 h-4" />
          <Plus v-else class="w-4 h-4" />
          {{ t('super.statusPosts.newPost') }}
        </button>

        <!-- Post cards -->
        <nav class="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
          <div
            v-if="posts.length === 0"
            class="text-center py-8 text-sm text-gray-500 dark:text-gray-400"
          >
            {{ t('super.statusPosts.noPostsYet') }}
          </div>

          <button
            v-for="post in posts"
            :key="post.id"
            @click="selectPost(post)"
            :class="[
              'w-full text-left px-4 py-3 rounded-lg border transition-colors',
              selectedPostId === post.id
                ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750',
            ]"
          >
            <div class="flex items-start gap-2.5">
              <component :is="getPostIconOption(post).icon" :class="['w-5 h-5 shrink-0 mt-0.5', getPostIconOption(post).color]" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {{ getPostTitle(post) }}
                </p>
                <div class="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span :class="['inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium', severityClass(post.severity)]">
                    {{ post.severity }}
                  </span>
                  <span :class="['inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium', statusClass(post.status)]">
                    {{ post.status }}
                  </span>
                </div>
                <div class="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                  <span>{{ relativeTime(post.publishedAt ?? post.createdAt) }}</span>
                  <span>{{ t('super.statusPosts.localesCount', { count: translationCount(post), total: LOCALES.length }) }}</span>
                </div>
              </div>
            </div>
          </button>
        </nav>

        <!-- Pagination -->
        <div v-if="pagination.totalPages > 1" class="flex items-center justify-between mt-4 text-xs text-gray-500 dark:text-gray-400">
          <button
            :disabled="pagination.page <= 1"
            @click="pagination.page--; fetchPosts()"
            class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {{ t('super.statusPosts.prev') }}
          </button>
          <span>{{ pagination.page }} / {{ pagination.totalPages }}</span>
          <button
            :disabled="pagination.page >= pagination.totalPages"
            @click="pagination.page++; fetchPosts()"
            class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {{ t('super.statusPosts.next') }}
          </button>
        </div>
      </div>

      <!-- ═══════════ Right panel — Editor ═══════════ -->
      <div class="flex-1 min-w-0">

        <!-- Empty state -->
        <div
          v-if="!selectedPostId"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400 text-sm"
        >
          {{ t('super.statusPosts.selectPost') }}
        </div>

        <template v-else>
          <!-- Alerts -->
          <div v-if="error" class="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
          </div>
          <div v-if="success" class="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
          </div>

          <!-- ── Metadata card ── -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-6">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('super.statusPosts.metadata') }}</h2>
            </div>
            <div class="p-6 space-y-5">

              <!-- Icon selector -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {{ t('super.statusPosts.icon') }}
                </label>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="opt in ICON_OPTIONS"
                    :key="opt.key"
                    @click="editIcon = opt.key"
                    :class="[
                      'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors',
                      editIcon === opt.key
                        ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                        : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-650',
                    ]"
                  >
                    <component :is="opt.icon" :class="['w-4 h-4', opt.color]" />
                    <span class="text-xs">{{ t(`super.statusPosts.icons.${opt.key}`) }}</span>
                  </button>
                </div>
              </div>

              <!-- Severity -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {{ t('super.statusPosts.severity') }}
                </label>
                <select
                  v-model="editSeverity"
                  class="w-full max-w-xs px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                >
                  <option v-for="sev in SEVERITY_OPTIONS" :key="sev" :value="sev">
                    {{ t(`super.statusPosts.severities.${sev}`) }}
                  </option>
                </select>
              </div>

              <!-- Affected services -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {{ t('super.statusPosts.affectedServices') }}
                </label>
                <div class="flex flex-wrap gap-3">
                  <label
                    v-for="svc in SERVICES"
                    :key="svc"
                    class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                  >
                    <input
                      type="checkbox"
                      :value="svc"
                      v-model="editAffectedServices"
                      class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                    />
                    {{ svc }}
                  </label>
                </div>
              </div>

              <!-- Status toggle -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {{ t('super.statusPosts.status') }}
                </label>
                <div class="flex items-center gap-2">
                  <button
                    @click="editStatus = 'draft'"
                    :class="[
                      'px-3.5 py-2 rounded-lg text-sm font-medium transition-colors border',
                      editStatus === 'draft'
                        ? 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-500 text-gray-900 dark:text-white'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-750',
                    ]"
                  >
                    {{ t('super.statusPosts.draft') }}
                  </button>
                  <button
                    @click="editStatus = 'published'"
                    :class="[
                      'px-3.5 py-2 rounded-lg text-sm font-medium transition-colors border',
                      editStatus === 'published'
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-750',
                    ]"
                  >
                    {{ t('super.statusPosts.published') }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Translations card ── -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-6">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('super.statusPosts.translations') }}</h2>
            </div>

            <!-- Locale tabs -->
            <div class="px-6 pt-4 flex items-center gap-1 border-b border-gray-200 dark:border-gray-700">
              <button
                v-for="locale in LOCALES"
                :key="locale"
                @click="editLocale = locale; if (!editTranslations[locale]) editTranslations[locale] = { title: '', body: '' }; previewMode = false"
                :class="[
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                  editLocale === locale
                    ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
                ]"
              >
                <span
                  :class="[
                    'w-2 h-2 rounded-full',
                    hasTranslation(locale) ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600',
                  ]"
                ></span>
                {{ locale.toUpperCase() }}
              </button>
            </div>

            <div class="p-6 space-y-4">
              <!-- Title -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {{ t('super.statusPosts.translationTitle') }}
                </label>
                <input
                  v-model="currentTranslation.title"
                  type="text"
                  :placeholder="t('super.statusPosts.titlePlaceholder')"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>

              <!-- Markdown toolbar -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {{ t('super.statusPosts.body') }}
                </label>
                <div class="flex items-center gap-1 mb-2 p-1 bg-gray-50 dark:bg-gray-750 rounded-lg border border-gray-200 dark:border-gray-600">
                  <button
                    v-for="btn in toolbarButtons"
                    :key="btn.label"
                    @click="insertMarkdown(btn.before, btn.after)"
                    :title="btn.label"
                    class="p-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                  >
                    <component :is="btn.icon" class="w-4 h-4" />
                  </button>
                  <div class="flex-1"></div>
                  <button
                    @click="previewMode = !previewMode"
                    :class="[
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                      previewMode
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600',
                    ]"
                  >
                    <Eye class="w-3.5 h-3.5" />
                    {{ t('super.statusPosts.preview') }}
                  </button>
                </div>

                <!-- Textarea -->
                <textarea
                  v-if="!previewMode"
                  ref="bodyTextareaRef"
                  v-model="currentTranslation.body"
                  rows="12"
                  :placeholder="t('super.statusPosts.bodyPlaceholder')"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                />

                <!-- Markdown preview -->
                <div
                  v-else
                  class="min-h-[300px] px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 prose prose-sm dark:prose-invert max-w-none"
                  v-html="renderMarkdown(currentTranslation.body ?? '')"
                ></div>
              </div>

              <!-- Auto-translate + delete translation row -->
              <div class="flex items-center gap-3 pt-2">
                <div class="relative group">
                  <button
                    @click="autoTranslate"
                    :disabled="autoTranslating || !hasTranslation(editLocale) || !translationConfigured"
                    class="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    <CompassSpinner v-if="autoTranslating" size="w-4 h-4" />
                    <Languages v-else class="w-4 h-4" />
                    {{ t('super.statusPosts.autoTranslate') }}
                  </button>
                  <div v-if="!translationConfigured" class="absolute bottom-full left-0 mb-1 hidden group-hover:block w-64 p-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg z-10">
                    {{ t('super.statusPosts.noApiKey') }}
                  </div>
                </div>
                <button
                  v-if="canWrite && hasTranslation(editLocale)"
                  @click="deleteTranslation(editLocale)"
                  class="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-sm font-medium transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 class="w-4 h-4" />
                  {{ t('super.statusPosts.deleteTranslation') }}
                </button>
              </div>
            </div>
          </div>

          <!-- ── Action buttons ── -->
          <div v-if="canWrite" class="flex items-center gap-3">
            <button
              @click="savePost"
              :disabled="saving"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <CompassSpinner v-if="saving" size="w-4 h-4" />
              <Save v-else class="w-4 h-4" />
              {{ t('super.statusPosts.save') }}
            </button>
            <button
              @click="deletePost"
              :disabled="deleting"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-sm font-medium transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
            >
              <CompassSpinner v-if="deleting" size="w-4 h-4" />
              <Trash2 v-else class="w-4 h-4" />
              {{ t('super.statusPosts.delete') }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
