<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LandingNavbar from '@/components/landing/LandingNavbar.vue'
import type { NavLink } from '@/components/landing/LandingNavbar.vue'
import LandingFooter from '@/components/landing/LandingFooter.vue'
import { renderMarkdown } from '@/utils/markdown'
import { useBranding } from '@/composables/useBranding'
import { AlertTriangle, Wrench, CheckCircle, Info, AlertOctagon, TrendingDown } from 'lucide-vue-next'

const ICON_MAP: Record<string, { icon: any; color: string }> = {
  incident: { icon: AlertTriangle, color: 'text-amber-500' },
  maintenance: { icon: Wrench, color: 'text-blue-500' },
  resolved: { icon: CheckCircle, color: 'text-green-500' },
  info: { icon: Info, color: 'text-sky-500' },
  outage: { icon: AlertOctagon, color: 'text-red-500' },
  degraded: { icon: TrendingDown, color: 'text-orange-500' },
}

const { t, locale } = useI18n()
const { brandGithubUrl } = useBranding()

// ── Types ────────────────────────────────────────────────────────────
interface ServiceHealth {
  key: string
  name: string
  status: string
  responseMs: number
}

interface HealthResponse {
  services: ServiceHealth[]
  overall: string
}

interface UptimeDay {
  date: string
  uptimePercent: number
  status: string
}

interface UptimeService {
  key: string
  days: UptimeDay[]
}

interface UptimeResponse {
  services: UptimeService[]
}

interface IncidentPost {
  id: string
  icon: string
  severity: string
  affectedServices: string[]
  publishedAt: string
  createdAt: string
  updatedAt: string
  title: string
  body: string
}

interface PostsPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

interface PostsResponse {
  data: IncidentPost[]
  pagination: PostsPagination
}

// ── Reactive state ───────────────────────────────────────────────────
const health = ref<HealthResponse | null>(null)
const uptime = ref<UptimeResponse | null>(null)
const posts = ref<IncidentPost[]>([])
const pagination = ref<PostsPagination | null>(null)

const loading = ref(true)
const postsLoading = ref(false)

const searchQuery = ref('')
const currentPage = ref(1)
const postsLimit = 10

// Tooltip state for uptime heatmap
const hoveredDay = ref<{ date: string; uptimePercent: number; x: number; y: number } | null>(null)

// Responsive: track window width for heatmap day count
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024)
const daysToShow = computed(() => (windowWidth.value < 640 ? 30 : 90))

let resizeHandler: (() => void) | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
const POLL_INTERVAL = 5_000

// ── Nav links ────────────────────────────────────────────────────────
const navLinks = computed<NavLink[]>(() => {
  const links: NavLink[] = [
    { label: t('landing.nav.home'), href: '/', routerLink: true },
  ]
  if (brandGithubUrl.value) {
    links.push({ label: t('landing.nav.github'), href: brandGithubUrl.value, external: true })
  }
  return links
})

// ── Helpers ───────────────────────────────────────────────────────────
// Only update a ref if the JSON payload actually changed — prevents
// unnecessary Vue re-renders and the visual flicker they cause.
let _lastHealthJson = ''
let _lastUptimeJson = ''
let _lastPostsJson = ''

// ── API fetching ─────────────────────────────────────────────────────
async function fetchHealth() {
  try {
    const res = await fetch('/api/v1/status-page/health')
    if (res.ok) {
      const text = await res.text()
      if (text !== _lastHealthJson) {
        _lastHealthJson = text
        health.value = JSON.parse(text)
      }
    }
  } catch {
    // silently fail
  }
}

async function fetchUptime() {
  try {
    const res = await fetch('/api/v1/status-page/uptime?days=90')
    if (res.ok) {
      const text = await res.text()
      if (text !== _lastUptimeJson) {
        _lastUptimeJson = text
        uptime.value = JSON.parse(text)
      }
    }
  } catch {
    // silently fail
  }
}

async function fetchPosts(showLoading = true) {
  if (showLoading) postsLoading.value = true
  try {
    const params = new URLSearchParams({
      locale: locale.value,
      page: String(currentPage.value),
      limit: String(postsLimit),
      search: searchQuery.value,
    })
    const res = await fetch(`/api/v1/status-page/posts?${params}`)
    if (res.ok) {
      const text = await res.text()
      if (text !== _lastPostsJson) {
        _lastPostsJson = text
        const data: PostsResponse = JSON.parse(text)
        posts.value = data.data
        pagination.value = data.pagination
      }
    }
  } catch {
    // silently fail
  } finally {
    postsLoading.value = false
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────
let uptimePollCount = 0

onMounted(async () => {
  resizeHandler = () => {
    windowWidth.value = window.innerWidth
  }
  window.addEventListener('resize', resizeHandler)

  await Promise.all([fetchHealth(), fetchUptime(), fetchPosts()])
  loading.value = false

  // Poll health + posts every 5s, uptime every ~5 min (every 60th poll)
  pollTimer = setInterval(async () => {
    uptimePollCount++
    const promises: Promise<void>[] = [fetchHealth(), fetchPosts(false)]
    if (uptimePollCount % 60 === 0) {
      promises.push(fetchUptime())
    }
    await Promise.all(promises)
  }, POLL_INTERVAL)
})

onUnmounted(() => {
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})

// ── Watchers ─────────────────────────────────────────────────────────
watch(currentPage, () => {
  fetchPosts()
})

watch(searchQuery, () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    currentPage.value = 1
    fetchPosts()
  }, 300)
})

// ── Computed helpers ─────────────────────────────────────────────────
const overallStatus = computed(() => health.value?.overall ?? 'unknown')

const overallBannerClass = computed(() => {
  switch (overallStatus.value) {
    case 'healthy':
      return 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400'
    case 'degraded':
      return 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
    case 'down':
      return 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400'
    default:
      return 'bg-surface-500/10 border-surface-500/30 text-surface-700 dark:text-surface-400'
  }
})

const overallLabel = computed(() => {
  switch (overallStatus.value) {
    case 'healthy':
      return t('statusPage.allOperational')
    case 'degraded':
      return t('statusPage.partialDegradation')
    case 'down':
      return t('statusPage.majorOutage')
    default:
      return t('statusPage.unknown')
  }
})

const overallIcon = computed(() => {
  switch (overallStatus.value) {
    case 'healthy':
      return 'check'
    case 'degraded':
      return 'warning'
    case 'down':
      return 'error'
    default:
      return 'unknown'
  }
})

// ── Helper functions ─────────────────────────────────────────────────
function statusDotClass(status: string): string {
  switch (status) {
    case 'healthy':
      return 'bg-green-500'
    case 'degraded':
      return 'bg-amber-500'
    case 'down':
      return 'bg-red-500'
    default:
      return 'bg-surface-400'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'healthy':
      return t('statusPage.healthy')
    case 'degraded':
      return t('statusPage.degraded')
    case 'down':
      return t('statusPage.down')
    case 'not_configured':
      return t('statusPage.notConfigured')
    default:
      return t('statusPage.unknown')
  }
}

function uptimeDayBarClass(day: UptimeDay | undefined): string {
  if (!day) return 'bg-surface-200 dark:bg-surface-700'
  if (day.uptimePercent === 100) return 'bg-green-500'
  if (day.uptimePercent >= 95) return 'bg-amber-400'
  return 'bg-red-500'
}

function uptimePercentClass(percent: number): string {
  if (percent >= 99.9) return 'text-green-600 dark:text-green-400'
  if (percent >= 95) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

function averageUptime(days: UptimeDay[]): number {
  if (!days.length) return 0
  const sum = days.reduce((acc, d) => acc + d.uptimePercent, 0)
  return Math.round((sum / days.length) * 100) / 100
}

function visibleDays(days: UptimeDay[]): UptimeDay[] {
  return days.slice(-daysToShow.value)
}

function getIconOption(icon: string) {
  return ICON_MAP[icon] ?? ICON_MAP.info!
}

function severityBadgeClass(severity: string): string {
  switch (severity) {
    case 'info':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    case 'warning':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
    case 'critical':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    default:
      return 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-400'
  }
}

function formatDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat(locale.value, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateStr))
  } catch {
    return dateStr
  }
}

function formatShortDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat(locale.value, {
      month: 'short',
      day: 'numeric',
    }).format(new Date(dateStr))
  } catch {
    return dateStr
  }
}

function onHeatmapHover(event: MouseEvent, day: UptimeDay) {
  hoveredDay.value = {
    date: day.date,
    uptimePercent: day.uptimePercent,
    x: event.clientX,
    y: event.clientY,
  }
}

function onHeatmapLeave() {
  hoveredDay.value = null
}

function prevPage() {
  if (currentPage.value > 1) {
    currentPage.value--
  }
}

function nextPage() {
  if (pagination.value && currentPage.value < pagination.value.totalPages) {
    currentPage.value++
  }
}

</script>

<template>
  <div class="min-h-screen bg-white dark:bg-surface-950 text-surface-700 dark:text-surface-200">
    <LandingNavbar :nav-links="navLinks" />

    <main class="pt-32 pb-16 sm:pt-40">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">

        <!-- Loading state -->
        <div v-if="loading" class="flex items-center justify-center py-32">
          <svg class="h-8 w-8 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>

        <template v-else>
          <!-- A. Overall Status Banner -->
          <section class="mb-8">
            <div
              :class="[
                'flex items-center justify-center gap-3 rounded-xl border px-6 py-4 transition-colors',
                overallBannerClass,
              ]"
            >
              <div v-if="overallIcon === 'check'" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/20">
                <svg class="h-4.5 w-4.5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div v-else-if="overallIcon === 'warning'" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
                <svg class="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div v-else-if="overallIcon === 'error'" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/20">
                <svg class="h-4.5 w-4.5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div v-else class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-500/20">
                <svg class="h-4.5 w-4.5 text-surface-600 dark:text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01" />
                </svg>
              </div>
              <h1 class="text-lg font-bold sm:text-xl">{{ overallLabel }}</h1>
            </div>
          </section>

          <!-- B. Service Health Grid -->
          <section v-if="health" class="mb-12">
            <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div
                v-for="service in health.services"
                :key="service.key"
                class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900/50 p-5 transition-colors"
              >
                <div class="flex items-center justify-between">
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
                    {{ t(`statusPage.services.${service.key}`) }}
                  </h3>
                  <span
                    :class="['inline-block h-3 w-3 rounded-full', statusDotClass(service.status)]"
                  />
                </div>
                <p class="mt-2 text-sm font-medium" :class="{
                  'text-green-600 dark:text-green-400': service.status === 'healthy',
                  'text-amber-600 dark:text-amber-400': service.status === 'degraded',
                  'text-red-600 dark:text-red-400': service.status === 'down',
                  'text-surface-500 dark:text-surface-400': !['healthy', 'degraded', 'down'].includes(service.status),
                }">
                  {{ statusLabel(service.status) }}
                </p>
                <p v-if="service.responseMs != null" class="mt-1 text-xs text-surface-400 dark:text-surface-500">
                  {{ t('statusPage.responseTime', { ms: service.responseMs }) }}
                </p>
              </div>
            </div>
          </section>

          <!-- C. Uptime History -->
          <section v-if="uptime" class="mb-12">
            <h2 class="mb-6 text-xl font-bold text-gray-900 dark:text-white">
              {{ t('statusPage.uptime.title') }}
            </h2>

            <div class="space-y-3">
              <div
                v-for="service in uptime.services"
                :key="service.key"
                class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900/50 px-5 py-4"
              >
                <!-- Header: service name + uptime % -->
                <div class="mb-3 flex items-center justify-between">
                  <span class="text-sm font-semibold text-gray-900 dark:text-white">
                    {{ t(`statusPage.services.${service.key}`) }}
                  </span>
                  <span class="text-sm font-bold tabular-nums" :class="uptimePercentClass(averageUptime(service.days))">
                    {{ averageUptime(service.days) }}%
                  </span>
                </div>

                <!-- Bar chart -->
                <div class="flex items-stretch gap-[2px]" style="height: 34px">
                  <div
                    v-for="(day, i) in visibleDays(service.days)"
                    :key="day.date"
                    class="flex-1 min-w-0 cursor-pointer transition-opacity hover:opacity-70"
                    :class="[
                      uptimeDayBarClass(day),
                      i === 0 ? 'rounded-l-full' : '',
                      i === visibleDays(service.days).length - 1 ? 'rounded-r-full' : '',
                    ]"
                    @mouseenter="onHeatmapHover($event, day)"
                    @mousemove="onHeatmapHover($event, day)"
                    @mouseleave="onHeatmapLeave"
                  />
                </div>

                <!-- Date range labels -->
                <div class="mt-2 flex items-center justify-between">
                  <span class="text-xs text-surface-400 dark:text-surface-500">
                    {{ t('statusPage.uptime.days', { count: daysToShow }) }}
                  </span>
                  <span class="text-xs text-surface-400 dark:text-surface-500">
                    {{ t('statusPage.uptime.today') }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Tooltip -->
            <Teleport to="body">
              <div
                v-if="hoveredDay"
                class="pointer-events-none fixed z-[100] rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 text-xs shadow-xl"
                :style="{
                  left: hoveredDay.x + 12 + 'px',
                  top: hoveredDay.y - 48 + 'px',
                }"
              >
                <p class="font-semibold text-gray-900 dark:text-white">{{ formatShortDate(hoveredDay.date) }}</p>
                <p class="mt-0.5 tabular-nums" :class="uptimePercentClass(hoveredDay.uptimePercent)">
                  {{ t('statusPage.uptime.percent', { value: hoveredDay.uptimePercent }) }}
                </p>
              </div>
            </Teleport>
          </section>

          <!-- D. Incident Timeline -->
          <section>
            <h2 class="mb-6 text-xl font-bold text-gray-900 dark:text-white">
              {{ t('statusPage.timeline.title') }}
            </h2>

            <!-- Search bar (only show when there are posts) -->
            <div v-if="pagination && pagination.total > 0" class="mx-auto mb-8 max-w-3xl">
              <div class="relative">
                <svg
                  class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-surface-400 dark:text-surface-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  v-model="searchQuery"
                  type="text"
                  :placeholder="t('statusPage.timeline.search')"
                  class="w-full rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 py-2.5 pl-10 pr-4 text-sm text-gray-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500 outline-none transition-colors focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                />
              </div>
            </div>

            <!-- Timeline -->
            <div class="mx-auto max-w-3xl">
              <!-- Loading posts -->
              <div v-if="postsLoading" class="flex items-center justify-center py-12">
                <svg class="h-6 w-6 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>

              <!-- Empty state -->
              <div v-else-if="!posts.length" class="py-16 text-center">
                <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                  <svg class="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p class="text-lg font-medium text-gray-900 dark:text-white">
                  {{ t('statusPage.timeline.empty') }}
                </p>
                <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">
                  {{ t('statusPage.timeline.noResults') }}
                </p>
              </div>

              <!-- Timeline entries -->
              <div v-else class="relative">
                <!-- Vertical connecting line -->
                <div class="absolute left-5 top-0 bottom-0 w-0.5 bg-surface-200 dark:bg-surface-800" />

                <div v-for="(post, index) in posts" :key="post.id" class="relative pb-8 last:pb-0">
                  <div class="flex gap-4">
                    <!-- Icon circle on the line -->
                    <div class="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">
                      <component :is="getIconOption(post.icon).icon" :class="['w-5 h-5', getIconOption(post.icon).color]" />
                    </div>

                    <!-- Card content -->
                    <div class="flex-1 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900/50 p-5 transition-colors">
                      <!-- Timestamps -->
                      <div class="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-surface-400 dark:text-surface-500">
                        <span>{{ formatDate(post.createdAt) }}</span>
                        <span v-if="post.updatedAt !== post.createdAt" class="italic">
                          {{ t('statusPage.timeline.updated') }} {{ formatDate(post.updatedAt) }}
                        </span>
                      </div>

                      <!-- Title -->
                      <h3 class="text-base font-bold text-gray-900 dark:text-white">
                        {{ post.title }}
                      </h3>

                      <!-- Severity badge + affected services -->
                      <div class="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          :class="[
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                            severityBadgeClass(post.severity),
                          ]"
                        >
                          {{ post.severity }}
                        </span>
                        <span
                          v-for="svc in post.affectedServices"
                          :key="svc"
                          class="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2.5 py-0.5 text-xs font-medium text-surface-600 dark:text-surface-400"
                        >
                          {{ t(`statusPage.services.${svc}`) }}
                        </span>
                      </div>

                      <!-- Body (rendered markdown) -->
                      <div
                        v-if="post.body"
                        class="mt-3 prose prose-sm dark:prose-invert max-w-none text-sm text-surface-600 dark:text-surface-300"
                        v-html="renderMarkdown(post.body)"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <!-- Pagination -->
              <div
                v-if="pagination && pagination.totalPages > 1"
                class="mt-8 flex items-center justify-between"
              >
                <button
                  :disabled="currentPage <= 1"
                  class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-300 transition-colors hover:bg-surface-50 dark:hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-50"
                  @click="prevPage"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  {{ t('statusPage.timeline.prev') }}
                </button>

                <span class="text-sm text-surface-500 dark:text-surface-400">
                  {{ t('statusPage.timeline.page', { page: pagination.page, total: pagination.totalPages }) }}
                </span>

                <button
                  :disabled="currentPage >= pagination.totalPages"
                  class="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-300 transition-colors hover:bg-surface-50 dark:hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-50"
                  @click="nextPage"
                >
                  {{ t('statusPage.timeline.next') }}
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </section>
        </template>
      </div>
    </main>

    <LandingFooter />
  </div>
</template>
