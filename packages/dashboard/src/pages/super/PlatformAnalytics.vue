<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { BarChart3, ArrowUpRight, ArrowDownRight, Globe, Activity, TrendingUp, Users, Eye, MonitorSmartphone, Link2, FileText, Wrench, Play, CheckCircle, XCircle, RefreshCw } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import InteractiveChart from '@/components/InteractiveChart.vue'
import Sparkline from '@/components/Sparkline.vue'
import { useApi } from '@/composables/useApi'

const api = useApi()

// ── Types ────────────────────────────────────────────────────────────────

interface AnalyticsDataPoint {
  timestamp: string
  requests: number
  bytesIn: number
  bytesOut: number
  avgResponseTimeMs: number
  p95ResponseTimeMs: number
  statusBreakdown: Record<string, number>
}

interface TopService {
  serviceId: string
  serviceName: string | null
  accountName: string | null
  requests: number
  bytesIn: number
  bytesOut: number
}

interface PlatformAnalytics {
  data: AnalyticsDataPoint[]
  summary: {
    totalRequests: number
    totalBytesIn: number
    totalBytesOut: number
    avgResponseTimeMs: number
    p95ResponseTimeMs: number
    activeServices: number
    topServices: TopService[]
  }
  previousPeriod?: {
    totalRequests: number
    totalBytesIn: number
    totalBytesOut: number
    avgResponseTimeMs: number
  }
}

interface VisitorDataPoint {
  timestamp: string
  uniqueVisitors: number
  pageViews: number
}

interface VisitorTopService {
  serviceId: string
  serviceName: string | null
  accountName: string | null
  uniqueVisitors: number
  pageViews: number
}

interface VisitorAnalytics {
  data: VisitorDataPoint[]
  summary: {
    totalUniqueVisitors: number
    totalPageViews: number
    activeServices: number
    topPaths: Array<{ path: string; count: number }>
    topReferrers: Array<{ referrer: string; count: number }>
    browsers: Record<string, number>
    devices: Record<string, number>
    countries: Record<string, number>
    topServices: VisitorTopService[]
  }
}

// ── State ────────────────────────────────────────────────────────────────

const activeTab = ref<'traffic' | 'visitors' | 'diagnostics'>('traffic')
const period = ref<'24h' | '7d' | '30d'>('24h')
const loading = ref(true)

const analytics = ref<PlatformAnalytics | null>(null)
const visitors = ref<VisitorAnalytics | null>(null)

async function fetchAnalytics() {
  loading.value = true
  try {
    analytics.value = await api.get<PlatformAnalytics>(
      `/admin/analytics/platform?period=${period.value}`
    )
  } catch { analytics.value = null }
  finally { loading.value = false }
}

const visitorsLoading = ref(false)
async function fetchVisitors() {
  visitorsLoading.value = true
  try {
    visitors.value = await api.get<VisitorAnalytics>(
      `/admin/analytics/visitors?period=${period.value}`
    )
  } catch { visitors.value = null }
  finally { visitorsLoading.value = false }
}

watch(period, () => {
  if (activeTab.value === 'traffic') fetchAnalytics()
  else fetchVisitors()
})

// ── Diagnostics ──────────────────────────────────────────────────────────

const diagnostics = ref<any>(null)
const diagLoading = ref(false)
const diagError = ref('')
const collecting = ref(false)
const collectMessage = ref('')

async function fetchDiagnostics() {
  diagLoading.value = true
  diagError.value = ''
  try {
    diagnostics.value = await api.get<any>('/admin/analytics/diagnostics')
  } catch (err: any) {
    diagError.value = err?.body?.error || 'Failed to fetch diagnostics'
    diagnostics.value = null
  } finally {
    diagLoading.value = false
  }
}

async function forceCollect() {
  collecting.value = true
  collectMessage.value = ''
  try {
    const result = await api.post<any>('/admin/analytics/collect', {})
    collectMessage.value = result.message || 'Collection complete'
    // Refresh diagnostics and analytics after collection
    await fetchDiagnostics()
    await fetchAnalytics()
  } catch (err: any) {
    collectMessage.value = err?.body?.error || 'Collection failed'
  } finally {
    collecting.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'visitors' && !visitors.value && !visitorsLoading.value) fetchVisitors()
  if (tab === 'traffic' && !analytics.value && !loading.value) fetchAnalytics()
  if (tab === 'diagnostics' && !diagnostics.value && !diagLoading.value) fetchDiagnostics()
})

onMounted(fetchAnalytics)

// ── Chart helpers ────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function formatTimeLabel(d: Date): string {
  return period.value === '24h'
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// Sparkline data extractors
const requestsSparkline = computed(() => analytics.value?.data.map(d => d.requests) ?? [])
const bytesInSparkline = computed(() => analytics.value?.data.map(d => d.bytesIn) ?? [])
const bytesOutSparkline = computed(() => analytics.value?.data.map(d => d.bytesOut) ?? [])
const responseTimeSparkline = computed(() => analytics.value?.data.map(d => d.avgResponseTimeMs) ?? [])
const visitorSparkline = computed(() => visitors.value?.data.map(d => d.uniqueVisitors) ?? [])
const pageViewSparkline = computed(() => visitors.value?.data.map(d => d.pageViews) ?? [])

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

function percentChange(current: number, previous: number): { label: string; positive: boolean } | null {
  if (!previous) return null
  const pct = ((current - previous) / previous) * 100
  return { label: `${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(1)}%`, positive: pct <= 0 }
}

const sortedCountries = computed(() => {
  if (!visitors.value?.summary?.countries) return []
  return Object.entries(visitors.value.summary.countries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
})

const statusBreakdown = computed(() => {
  if (!analytics.value?.data.length) return { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
  const totals: Record<string, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
  for (const point of analytics.value.data) {
    for (const [key, val] of Object.entries(point.statusBreakdown)) {
      if (key in totals) totals[key] = (totals[key] ?? 0) + val
    }
  }
  return totals
})

const statusBarSegments = computed(() => {
  const b = statusBreakdown.value
  const total = Object.values(b).reduce((a, c) => a + c, 0)
  if (total === 0) return []
  return [
    { key: '2xx', pct: ((b['2xx'] ?? 0) / total) * 100, color: '#22c55e', label: '2xx' },
    { key: '3xx', pct: ((b['3xx'] ?? 0) / total) * 100, color: '#3b82f6', label: '3xx' },
    { key: '4xx', pct: ((b['4xx'] ?? 0) / total) * 100, color: '#eab308', label: '4xx' },
    { key: '5xx', pct: ((b['5xx'] ?? 0) / total) * 100, color: '#ef4444', label: '5xx' },
  ].filter(s => s.pct > 0)
})

const errorRate = computed(() => {
  const b = statusBreakdown.value
  const total = Object.values(b).reduce((a, c) => a + c, 0)
  if (total === 0) return 0
  return (((b['4xx'] ?? 0) + (b['5xx'] ?? 0)) / total) * 100
})

// ── Visitor computed ─────────────────────────────────────────────────────

const browserSegments = computed(() => {
  if (!visitors.value?.summary.browsers) return []
  const b = visitors.value.summary.browsers
  const total = Object.values(b).reduce((a, c) => a + c, 0)
  if (total === 0) return []
  const colors: Record<string, string> = {
    Chrome: '#4285F4', Firefox: '#FF7139', Safari: '#006CFF', Edge: '#0078D7',
    Opera: '#FF1B2D', Bot: '#6b7280', CLI: '#9ca3af', Other: '#d1d5db',
  }
  return Object.entries(b)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      name, count, pct: (count / total) * 100,
      color: colors[name] ?? '#9ca3af',
    }))
})

const deviceSegments = computed(() => {
  if (!visitors.value?.summary.devices) return []
  const d = visitors.value.summary.devices
  const total = Object.values(d).reduce((a, c) => a + c, 0)
  if (total === 0) return []
  const colors: Record<string, string> = {
    desktop: '#3b82f6', mobile: '#22c55e', tablet: '#f59e0b', bot: '#6b7280',
  }
  return Object.entries(d)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      name, count, pct: (count / total) * 100,
      color: colors[name] ?? '#9ca3af',
    }))
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <BarChart3 class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Platform Analytics</h1>
      </div>
    </div>

    <!-- Tab selector + Period selector -->
    <div class="flex flex-wrap items-center gap-4 mb-6">
      <div class="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
        <button
          v-for="tab in [{ id: 'traffic' as const, label: 'Traffic' }, { id: 'visitors' as const, label: 'Visitors' }, { id: 'diagnostics' as const, label: 'Diagnostics' }]"
          :key="tab.id"
          @click="activeTab = tab.id"
          :class="[
            'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
            activeTab === tab.id
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          ]"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
        <button
          v-for="p in (['24h', '7d', '30d'] as const)"
          :key="p"
          @click="period = p"
          :class="[
            'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            period === p
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          ]"
        >
          {{ p }}
        </button>
      </div>
    </div>

    <!-- ═══════════════════ TRAFFIC TAB ═══════════════════ -->
    <template v-if="activeTab === 'traffic'">
      <div v-if="loading" class="flex items-center justify-center py-20">
        <CompassSpinner size="w-16 h-16" />
      </div>

      <template v-else-if="analytics">
        <!-- Summary stat cards with sparklines and % change -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-3">
                <div class="p-2 rounded-lg bg-primary-50 dark:bg-primary-900/20"><Globe class="w-5 h-5 text-primary-600 dark:text-primary-400" /></div>
                <p class="text-sm text-gray-500 dark:text-gray-400">Requests</p>
              </div>
              <span v-if="analytics.previousPeriod && percentChange(analytics.summary.totalRequests, analytics.previousPeriod.totalRequests)"
                :class="['text-xs font-medium px-1.5 py-0.5 rounded-full', percentChange(analytics.summary.totalRequests, analytics.previousPeriod.totalRequests)!.positive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400']"
              >{{ percentChange(analytics.summary.totalRequests, analytics.previousPeriod.totalRequests)!.label }}</span>
            </div>
            <div class="flex items-center justify-between">
              <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ formatNumber(analytics.summary.totalRequests) }}</p>
              <Sparkline v-if="requestsSparkline.length >= 2" :values="requestsSparkline" color="#6366f1" />
            </div>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-3">
                <div class="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20"><ArrowDownRight class="w-5 h-5 text-blue-600 dark:text-blue-400" /></div>
                <p class="text-sm text-gray-500 dark:text-gray-400">Bandwidth In</p>
              </div>
              <span v-if="analytics.previousPeriod && percentChange(analytics.summary.totalBytesIn, analytics.previousPeriod.totalBytesIn)"
                :class="['text-xs font-medium px-1.5 py-0.5 rounded-full', percentChange(analytics.summary.totalBytesIn, analytics.previousPeriod.totalBytesIn)!.positive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400']"
              >{{ percentChange(analytics.summary.totalBytesIn, analytics.previousPeriod.totalBytesIn)!.label }}</span>
            </div>
            <div class="flex items-center justify-between">
              <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ formatBytes(analytics.summary.totalBytesIn) }}</p>
              <Sparkline v-if="bytesInSparkline.length >= 2" :values="bytesInSparkline" color="#3b82f6" />
            </div>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-3">
                <div class="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20"><ArrowUpRight class="w-5 h-5 text-emerald-600 dark:text-emerald-400" /></div>
                <p class="text-sm text-gray-500 dark:text-gray-400">Bandwidth Out</p>
              </div>
              <span v-if="analytics.previousPeriod && percentChange(analytics.summary.totalBytesOut, analytics.previousPeriod.totalBytesOut)"
                :class="['text-xs font-medium px-1.5 py-0.5 rounded-full', percentChange(analytics.summary.totalBytesOut, analytics.previousPeriod.totalBytesOut)!.positive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400']"
              >{{ percentChange(analytics.summary.totalBytesOut, analytics.previousPeriod.totalBytesOut)!.label }}</span>
            </div>
            <div class="flex items-center justify-between">
              <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ formatBytes(analytics.summary.totalBytesOut) }}</p>
              <Sparkline v-if="bytesOutSparkline.length >= 2" :values="bytesOutSparkline" color="#10b981" />
            </div>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-3">
                <div class="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20"><TrendingUp class="w-5 h-5 text-amber-600 dark:text-amber-400" /></div>
                <p class="text-sm text-gray-500 dark:text-gray-400">Avg Response</p>
              </div>
              <span v-if="analytics.previousPeriod && percentChange(analytics.summary.avgResponseTimeMs, analytics.previousPeriod.avgResponseTimeMs)"
                :class="['text-xs font-medium px-1.5 py-0.5 rounded-full', percentChange(analytics.summary.avgResponseTimeMs, analytics.previousPeriod.avgResponseTimeMs)!.positive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400']"
              >{{ percentChange(analytics.summary.avgResponseTimeMs, analytics.previousPeriod.avgResponseTimeMs)!.label }}</span>
            </div>
            <div class="flex items-center justify-between">
              <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ formatMs(analytics.summary.avgResponseTimeMs) }}</p>
              <Sparkline v-if="responseTimeSparkline.length >= 2" :values="responseTimeSparkline" color="#f59e0b" />
            </div>
            <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">p95: {{ formatMs(analytics.summary.p95ResponseTimeMs) }}</p>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-3 mb-2">
              <div class="p-2 rounded-lg bg-violet-50 dark:bg-violet-900/20"><Activity class="w-5 h-5 text-violet-600 dark:text-violet-400" /></div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Active Services</p>
            </div>
            <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ analytics.summary.activeServices }}</p>
          </div>
        </div>

        <!-- Requests chart -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Requests Over Time</h3>
          <div v-if="analytics.data.length === 0" class="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No analytics data yet. Data is collected every 5 minutes.</div>
          <InteractiveChart
            v-else
            :data="analytics.data"
            :series="[{ key: 'requests', label: 'Requests', color: '#6366f1' }]"
            :format-value="formatNumber"
            :format-time="formatTimeLabel"
          />
        </div>

        <!-- Bandwidth chart -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Bandwidth</h3>
            <div class="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-blue-500 inline-block"></span> In</span>
              <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span> Out</span>
            </div>
          </div>
          <div v-if="analytics.data.length === 0" class="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No data yet.</div>
          <InteractiveChart
            v-else
            :data="analytics.data"
            :series="[
              { key: 'bytesIn', label: 'In', color: '#3b82f6' },
              { key: 'bytesOut', label: 'Out', color: '#10b981' },
            ]"
            :format-value="formatBytes"
            :format-time="formatTimeLabel"
            :format-bytes="true"
          />
        </div>

        <!-- Response Time chart -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Response Time</h3>
            <div class="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-500 inline-block"></span> Avg</span>
              <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-red-400 inline-block"></span> p95</span>
            </div>
          </div>
          <div v-if="analytics.data.length === 0" class="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No data yet.</div>
          <InteractiveChart
            v-else
            :data="analytics.data"
            :series="[
              { key: 'avgResponseTimeMs', label: 'Avg', color: '#f59e0b' },
              { key: 'p95ResponseTimeMs', label: 'p95', color: '#f87171', dashed: true },
            ]"
            :format-value="formatMs"
            :format-time="formatTimeLabel"
          />
        </div>

        <!-- Status codes + Error rate -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Status Code Distribution</h3>
            <div v-if="statusBarSegments.length === 0" class="text-sm text-gray-500 dark:text-gray-400">No request data yet.</div>
            <template v-else>
              <div class="h-6 rounded-full overflow-hidden flex">
                <div v-for="seg in statusBarSegments" :key="seg.key" :style="{ width: seg.pct + '%', backgroundColor: seg.color }" class="h-full transition-all duration-300" />
              </div>
              <div class="flex flex-wrap items-center gap-4 mt-3 text-xs text-gray-600 dark:text-gray-400">
                <span v-for="seg in statusBarSegments" :key="'l'+seg.key" class="flex items-center gap-1.5">
                  <span class="w-2.5 h-2.5 rounded-full" :style="{ backgroundColor: seg.color }" />
                  {{ seg.label }}: {{ formatNumber(statusBreakdown[seg.key] ?? 0) }} ({{ seg.pct.toFixed(1) }}%)
                </span>
              </div>
            </template>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Error Rate</h3>
            <div class="flex items-end gap-4">
              <div>
                <p class="text-4xl font-bold tabular-nums" :class="errorRate > 5 ? 'text-red-600 dark:text-red-400' : errorRate > 1 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'">{{ errorRate.toFixed(1) }}%</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">4xx + 5xx responses</p>
              </div>
              <div class="flex-1 grid grid-cols-2 gap-3 text-sm">
                <div class="bg-amber-50 dark:bg-amber-900/10 rounded-lg px-3 py-2">
                  <p class="text-xs text-amber-600 dark:text-amber-400 font-medium">4xx</p>
                  <p class="text-lg font-semibold text-amber-700 dark:text-amber-300 tabular-nums">{{ formatNumber(statusBreakdown['4xx'] ?? 0) }}</p>
                </div>
                <div class="bg-red-50 dark:bg-red-900/10 rounded-lg px-3 py-2">
                  <p class="text-xs text-red-600 dark:text-red-400 font-medium">5xx</p>
                  <p class="text-lg font-semibold text-red-700 dark:text-red-300 tabular-nums">{{ formatNumber(statusBreakdown['5xx'] ?? 0) }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Top services table -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <TrendingUp class="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Top Services by Requests</h3>
          </div>
          <div v-if="!analytics.summary.topServices.length" class="p-8 text-center text-sm text-gray-500 dark:text-gray-400">No service traffic recorded for this period.</div>
          <div v-else class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead><tr class="border-b border-gray-100 dark:border-gray-700">
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">#</th>
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Service</th>
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Account</th>
                <th class="text-right px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Requests</th>
                <th class="text-right px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">BW In</th>
                <th class="text-right px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">BW Out</th>
              </tr></thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-700/50">
                <tr v-for="(svc, idx) in analytics.summary.topServices" :key="svc.serviceId" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                  <td class="px-6 py-3 text-gray-400 tabular-nums">{{ idx + 1 }}</td>
                  <td class="px-6 py-3"><span class="font-medium text-gray-900 dark:text-white">{{ svc.serviceName || svc.serviceId.slice(0, 8) }}</span></td>
                  <td class="px-6 py-3 text-gray-600 dark:text-gray-400">{{ svc.accountName || '--' }}</td>
                  <td class="px-6 py-3 text-right font-medium text-gray-900 dark:text-white tabular-nums">{{ formatNumber(svc.requests) }}</td>
                  <td class="px-6 py-3 text-right text-gray-600 dark:text-gray-400 tabular-nums">{{ formatBytes(svc.bytesIn) }}</td>
                  <td class="px-6 py-3 text-right text-gray-600 dark:text-gray-400 tabular-nums">{{ formatBytes(svc.bytesOut) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <div v-else class="text-center py-20">
        <BarChart3 class="w-10 h-10 mx-auto mb-3 text-gray-400 dark:text-gray-500" />
        <p class="text-sm text-gray-500 dark:text-gray-400">Unable to load platform analytics.</p>
        <button @click="fetchAnalytics" class="mt-2 text-primary-600 dark:text-primary-400 hover:underline text-sm">Try again</button>
      </div>
    </template>

    <!-- ═══════════════════ VISITORS TAB ═══════════════════ -->
    <template v-if="activeTab === 'visitors'">
      <div v-if="visitorsLoading" class="flex items-center justify-center py-20">
        <CompassSpinner size="w-16 h-16" />
      </div>

      <template v-else-if="visitors">
        <!-- Summary cards with sparklines -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-3 mb-2">
              <div class="p-2 rounded-lg bg-violet-50 dark:bg-violet-900/20"><Users class="w-5 h-5 text-violet-600 dark:text-violet-400" /></div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Unique Visitors</p>
            </div>
            <div class="flex items-center justify-between">
              <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ formatNumber(visitors.summary.totalUniqueVisitors) }}</p>
              <Sparkline v-if="visitorSparkline.length >= 2" :values="visitorSparkline" color="#8b5cf6" />
            </div>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-3 mb-2">
              <div class="p-2 rounded-lg bg-primary-50 dark:bg-primary-900/20"><Eye class="w-5 h-5 text-primary-600 dark:text-primary-400" /></div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Page Views</p>
            </div>
            <div class="flex items-center justify-between">
              <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ formatNumber(visitors.summary.totalPageViews) }}</p>
              <Sparkline v-if="pageViewSparkline.length >= 2" :values="pageViewSparkline" color="#6366f1" />
            </div>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-3 mb-2">
              <div class="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20"><Activity class="w-5 h-5 text-amber-600 dark:text-amber-400" /></div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Active Services</p>
            </div>
            <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ visitors.summary.activeServices }}</p>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-3 mb-2">
              <div class="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20"><Eye class="w-5 h-5 text-emerald-600 dark:text-emerald-400" /></div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Views/Visitor</p>
            </div>
            <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
              {{ visitors.summary.totalUniqueVisitors > 0 ? (visitors.summary.totalPageViews / visitors.summary.totalUniqueVisitors).toFixed(1) : '0' }}
            </p>
          </div>
        </div>

        <!-- Visitors chart -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Visitors Over Time</h3>
            <div class="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-violet-500 inline-block"></span> Unique Visitors</span>
              <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-primary-500 inline-block"></span> Page Views</span>
            </div>
          </div>
          <div v-if="visitors.data.length === 0" class="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No visitor data yet. Data is collected every 5 minutes from Traefik access logs.</div>
          <InteractiveChart
            v-else
            :data="visitors.data"
            :series="[
              { key: 'uniqueVisitors', label: 'Unique Visitors', color: '#8b5cf6' },
              { key: 'pageViews', label: 'Page Views', color: '#6366f1', dashed: true },
            ]"
            :format-value="formatNumber"
            :format-time="formatTimeLabel"
          />
        </div>

        <!-- Countries breakdown -->
        <div v-if="sortedCountries.length > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div class="flex items-center gap-2 mb-4">
            <Globe class="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Visitor Countries</h3>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            <div v-for="([code, count], i) in sortedCountries" :key="code" class="relative flex items-center justify-between gap-2 px-3 py-2 rounded-lg">
              <div class="absolute inset-0 bg-primary-50 dark:bg-primary-900/10 rounded-lg" :style="{ width: `${(count / (sortedCountries[0]?.[1] || 1)) * 100}%` }" />
              <span class="relative text-sm font-medium text-gray-700 dark:text-gray-300">{{ code }}</span>
              <span class="relative text-xs text-gray-500 dark:text-gray-400 tabular-nums">{{ formatNumber(count) }}</span>
            </div>
          </div>
        </div>

        <!-- Browsers + Devices + Top Paths + Top Referrers -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <!-- Browsers -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div class="flex items-center gap-2 mb-4">
              <MonitorSmartphone class="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Browsers</h3>
            </div>
            <div v-if="browserSegments.length === 0" class="text-sm text-gray-500 dark:text-gray-400">No data yet.</div>
            <template v-else>
              <div class="h-5 rounded-full overflow-hidden flex mb-3">
                <div v-for="seg in browserSegments" :key="seg.name" :style="{ width: seg.pct + '%', backgroundColor: seg.color }" class="h-full" />
              </div>
              <div class="space-y-1.5">
                <div v-for="seg in browserSegments" :key="'b'+seg.name" class="flex items-center justify-between text-sm">
                  <span class="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                    <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ backgroundColor: seg.color }" />
                    {{ seg.name }}
                  </span>
                  <span class="text-gray-500 dark:text-gray-400 tabular-nums">{{ formatNumber(seg.count) }} ({{ seg.pct.toFixed(1) }}%)</span>
                </div>
              </div>
            </template>
          </div>

          <!-- Devices -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div class="flex items-center gap-2 mb-4">
              <MonitorSmartphone class="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Devices</h3>
            </div>
            <div v-if="deviceSegments.length === 0" class="text-sm text-gray-500 dark:text-gray-400">No data yet.</div>
            <template v-else>
              <div class="h-5 rounded-full overflow-hidden flex mb-3">
                <div v-for="seg in deviceSegments" :key="seg.name" :style="{ width: seg.pct + '%', backgroundColor: seg.color }" class="h-full" />
              </div>
              <div class="space-y-1.5">
                <div v-for="seg in deviceSegments" :key="'d'+seg.name" class="flex items-center justify-between text-sm">
                  <span class="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                    <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ backgroundColor: seg.color }" />
                    {{ seg.name }}
                  </span>
                  <span class="text-gray-500 dark:text-gray-400 tabular-nums">{{ formatNumber(seg.count) }} ({{ seg.pct.toFixed(1) }}%)</span>
                </div>
              </div>
            </template>
          </div>

          <!-- Top Pages -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div class="flex items-center gap-2 mb-4">
              <FileText class="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Top Pages</h3>
            </div>
            <div v-if="!visitors.summary.topPaths.length" class="text-sm text-gray-500 dark:text-gray-400">No page data yet.</div>
            <div v-else class="space-y-1.5 max-h-[300px] overflow-y-auto">
              <div v-for="(p, i) in visitors.summary.topPaths" :key="i" class="relative flex items-center justify-between gap-3 px-2 py-1.5 rounded">
                <div class="absolute inset-0 bg-primary-50 dark:bg-primary-900/10 rounded" :style="{ width: `${(p.count / (visitors.summary.topPaths[0]?.count || 1)) * 100}%` }" />
                <span class="relative text-sm text-gray-700 dark:text-gray-300 truncate min-w-0 flex-1 font-mono">{{ p.path }}</span>
                <span class="relative text-sm font-medium text-gray-600 dark:text-gray-400 tabular-nums shrink-0">{{ formatNumber(p.count) }}</span>
              </div>
            </div>
          </div>

          <!-- Top Referrers -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div class="flex items-center gap-2 mb-4">
              <Link2 class="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Top Referrers</h3>
            </div>
            <div v-if="!visitors.summary.topReferrers.length" class="text-sm text-gray-500 dark:text-gray-400">No referrer data yet.</div>
            <div v-else class="space-y-1.5 max-h-[300px] overflow-y-auto">
              <div v-for="(r, i) in visitors.summary.topReferrers" :key="i" class="relative flex items-center justify-between gap-3 px-2 py-1.5 rounded">
                <div class="absolute inset-0 bg-emerald-50 dark:bg-emerald-900/10 rounded" :style="{ width: `${(r.count / (visitors.summary.topReferrers[0]?.count || 1)) * 100}%` }" />
                <span class="relative text-sm text-gray-700 dark:text-gray-300 truncate min-w-0 flex-1">{{ r.referrer }}</span>
                <span class="relative text-sm font-medium text-gray-600 dark:text-gray-400 tabular-nums shrink-0">{{ formatNumber(r.count) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Top services by visitors -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <TrendingUp class="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Top Services by Page Views</h3>
          </div>
          <div v-if="!visitors.summary.topServices.length" class="p-8 text-center text-sm text-gray-500 dark:text-gray-400">No visitor data for this period.</div>
          <div v-else class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead><tr class="border-b border-gray-100 dark:border-gray-700">
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">#</th>
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Service</th>
                <th class="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Account</th>
                <th class="text-right px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Unique Visitors</th>
                <th class="text-right px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Page Views</th>
              </tr></thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-700/50">
                <tr v-for="(svc, idx) in visitors.summary.topServices" :key="svc.serviceId" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                  <td class="px-6 py-3 text-gray-400 tabular-nums">{{ idx + 1 }}</td>
                  <td class="px-6 py-3"><span class="font-medium text-gray-900 dark:text-white">{{ svc.serviceName || svc.serviceId.slice(0, 8) }}</span></td>
                  <td class="px-6 py-3 text-gray-600 dark:text-gray-400">{{ svc.accountName || '--' }}</td>
                  <td class="px-6 py-3 text-right font-medium text-gray-900 dark:text-white tabular-nums">{{ formatNumber(svc.uniqueVisitors) }}</td>
                  <td class="px-6 py-3 text-right text-gray-600 dark:text-gray-400 tabular-nums">{{ formatNumber(svc.pageViews) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <div v-else class="text-center py-20">
        <Users class="w-10 h-10 mx-auto mb-3 text-gray-400 dark:text-gray-500" />
        <p class="text-sm text-gray-500 dark:text-gray-400">Unable to load visitor analytics.</p>
        <button @click="fetchVisitors" class="mt-2 text-primary-600 dark:text-primary-400 hover:underline text-sm">Try again</button>
      </div>
    </template>

    <!-- ═══════════════════ DIAGNOSTICS TAB ═══════════════════ -->
    <template v-if="activeTab === 'diagnostics'">
      <div class="space-y-6">
        <!-- Actions bar -->
        <div class="flex flex-wrap items-center gap-3">
          <button
            @click="fetchDiagnostics"
            :disabled="diagLoading"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors disabled:opacity-50"
          >
            <RefreshCw :class="['w-4 h-4', diagLoading && 'animate-spin']" />
            Run Diagnostics
          </button>
          <button
            @click="forceCollect"
            :disabled="collecting"
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Play v-if="!collecting" class="w-4 h-4" />
            <CompassSpinner v-else size="w-4 h-4" />
            {{ collecting ? 'Collecting...' : 'Force Collection' }}
          </button>
          <span v-if="collectMessage" class="text-sm text-gray-600 dark:text-gray-400">{{ collectMessage }}</span>
        </div>

        <div v-if="diagLoading" class="flex items-center justify-center py-12">
          <CompassSpinner size="w-12 h-12" />
        </div>

        <div v-else-if="diagError" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6">
          <p class="text-sm text-red-700 dark:text-red-300">{{ diagError }}</p>
          <button @click="fetchDiagnostics" class="mt-2 text-sm text-red-600 hover:underline">Retry</button>
        </div>

        <template v-else-if="diagnostics">
          <!-- Overall health -->
          <div :class="[
            'rounded-xl border p-5 flex items-center gap-4',
            diagnostics.healthy
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          ]">
            <CheckCircle v-if="diagnostics.healthy" class="w-6 h-6 text-green-600 dark:text-green-400 shrink-0" />
            <XCircle v-else class="w-6 h-6 text-red-600 dark:text-red-400 shrink-0" />
            <div>
              <p :class="['font-semibold', diagnostics.healthy ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300']">
                {{ diagnostics.healthy ? 'All pipeline steps healthy' : 'Pipeline has issues' }}
              </p>
              <p v-if="diagnostics.failedSteps" class="text-sm mt-0.5" :class="diagnostics.healthy ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'">
                Failed: {{ diagnostics.failedSteps.join(', ') }}
              </p>
            </div>
          </div>

          <!-- Step cards -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <!-- Service Map -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">1. Service Map</h3>
                <span :class="['inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', diagnostics.steps.serviceMap?.ok ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300']">
                  <CheckCircle v-if="diagnostics.steps.serviceMap?.ok" class="w-3 h-3" />
                  <XCircle v-else class="w-3 h-3" />
                  {{ diagnostics.steps.serviceMap?.ok ? 'OK' : 'FAIL' }}
                </span>
              </div>
              <div v-if="diagnostics.steps.serviceMap?.error" class="text-sm text-red-600 dark:text-red-400 mb-2">{{ diagnostics.steps.serviceMap.error }}</div>
              <div v-else class="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                <p>Docker services with <code class="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">fleet.service-id</code>: <span class="font-medium text-gray-900 dark:text-white">{{ diagnostics.steps.serviceMap?.count ?? 0 }}</span></p>
                <div v-if="diagnostics.steps.serviceMap?.dockerNames?.length" class="mt-2">
                  <p class="text-xs text-gray-500 dark:text-gray-500 mb-1">Docker names:</p>
                  <div class="flex flex-wrap gap-1">
                    <span v-for="name in diagnostics.steps.serviceMap.dockerNames" :key="name" class="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded font-mono">{{ name }}</span>
                  </div>
                </div>
                <div v-if="Object.keys(diagnostics.steps.serviceMap?.traefikAliases ?? {}).length" class="mt-2">
                  <p class="text-xs text-gray-500 dark:text-gray-500 mb-1">Traefik aliases:</p>
                  <div class="flex flex-wrap gap-1">
                    <span v-for="(docker, traefik) in diagnostics.steps.serviceMap.traefikAliases" :key="traefik" class="text-xs bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded font-mono">{{ traefik }} → {{ docker }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Traefik Tasks -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">2. Traefik Tasks</h3>
                <span :class="['inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', diagnostics.steps.traefikTasks?.ok ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300']">
                  <CheckCircle v-if="diagnostics.steps.traefikTasks?.ok" class="w-3 h-3" />
                  <XCircle v-else class="w-3 h-3" />
                  {{ diagnostics.steps.traefikTasks?.ok ? 'OK' : 'FAIL' }}
                </span>
              </div>
              <div v-if="diagnostics.steps.traefikTasks?.error" class="text-sm text-red-600 dark:text-red-400">{{ diagnostics.steps.traefikTasks.error }}</div>
              <div v-else class="space-y-2">
                <p class="text-sm text-gray-600 dark:text-gray-400">Running tasks: <span class="font-medium text-gray-900 dark:text-white">{{ diagnostics.steps.traefikTasks?.count ?? 0 }}</span></p>
                <div v-for="task in (diagnostics.steps.traefikTasks?.tasks ?? [])" :key="task.id" class="text-xs bg-gray-50 dark:bg-gray-750 rounded-lg p-3 space-y-1">
                  <p class="font-mono text-gray-700 dark:text-gray-300">Task {{ task.id }} — {{ task.state }}</p>
                  <div v-for="net in task.networks" :key="net.name" class="text-gray-500 dark:text-gray-400">
                    {{ net.name }}: {{ net.addresses.join(', ') || 'no addresses' }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Metrics Fetch (DNS) -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">3. Metrics Fetch (DNS)</h3>
                <span :class="['inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', diagnostics.steps.metricsFetchDns?.ok ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300']">
                  <CheckCircle v-if="diagnostics.steps.metricsFetchDns?.ok" class="w-3 h-3" />
                  <XCircle v-else class="w-3 h-3" />
                  {{ diagnostics.steps.metricsFetchDns?.ok ? 'OK' : 'FAIL' }}
                </span>
              </div>
              <div v-if="diagnostics.steps.metricsFetchDns?.error" class="text-sm text-red-600 dark:text-red-400">{{ diagnostics.steps.metricsFetchDns.error }}</div>
              <div v-else class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <p>HTTP {{ diagnostics.steps.metricsFetchDns?.status }} — {{ ((diagnostics.steps.metricsFetchDns?.totalBytes ?? 0) / 1024).toFixed(1) }} KB</p>
                <p>Service request metric lines: <span class="font-medium text-gray-900 dark:text-white">{{ diagnostics.steps.metricsFetchDns?.serviceRequestLines ?? 0 }}</span></p>
                <div v-if="diagnostics.steps.metricsFetchDns?.uniqueServiceNames?.length">
                  <p class="text-xs text-gray-500 dark:text-gray-500 mb-1">Services in Prometheus metrics:</p>
                  <div class="flex flex-wrap gap-1">
                    <span v-for="name in diagnostics.steps.metricsFetchDns.uniqueServiceNames" :key="name" class="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded font-mono">{{ name }}</span>
                  </div>
                </div>
                <div v-if="diagnostics.steps.metricsFetchDns?.sampleLines?.length" class="mt-2">
                  <p class="text-xs text-gray-500 dark:text-gray-500 mb-1">Sample lines:</p>
                  <div class="text-xs font-mono bg-gray-50 dark:bg-gray-750 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto space-y-0.5">
                    <p v-for="(line, i) in diagnostics.steps.metricsFetchDns.sampleLines" :key="i" class="text-gray-600 dark:text-gray-400 whitespace-nowrap">{{ line }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Metrics Fetch (Task IPs) -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">4. Metrics Fetch (Task IPs)</h3>
                <span :class="['inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', diagnostics.steps.metricsFetchTaskIp?.ok ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300']">
                  <CheckCircle v-if="diagnostics.steps.metricsFetchTaskIp?.ok" class="w-3 h-3" />
                  <XCircle v-else class="w-3 h-3" />
                  {{ diagnostics.steps.metricsFetchTaskIp?.ok ? 'OK' : 'FAIL' }}
                </span>
              </div>
              <div v-if="diagnostics.steps.metricsFetchTaskIp?.error" class="text-sm text-red-600 dark:text-red-400">{{ diagnostics.steps.metricsFetchTaskIp.error }}</div>
              <div v-else class="text-sm text-gray-600 dark:text-gray-400">
                <p>Instances scraped: <span class="font-medium text-gray-900 dark:text-white">{{ diagnostics.steps.metricsFetchTaskIp?.instanceCount ?? 0 }}</span></p>
                <p>Total data: {{ ((diagnostics.steps.metricsFetchTaskIp?.totalBytes ?? 0) / 1024).toFixed(1) }} KB</p>
              </div>
            </div>

            <!-- Valkey State -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">5. Valkey (Previous Values)</h3>
                <span :class="['inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', diagnostics.steps.valkey?.ok ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300']">
                  <CheckCircle v-if="diagnostics.steps.valkey?.ok" class="w-3 h-3" />
                  <XCircle v-else class="w-3 h-3" />
                  {{ diagnostics.steps.valkey?.ok ? 'OK' : 'FAIL' }}
                </span>
              </div>
              <div v-if="diagnostics.steps.valkey?.error" class="text-sm text-red-600 dark:text-red-400">{{ diagnostics.steps.valkey.error }}</div>
              <div v-else class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <p>Cached analytics keys: <span class="font-medium text-gray-900 dark:text-white">{{ diagnostics.steps.valkey?.analyticsKeyCount ?? 0 }}</span></p>
                <p v-if="diagnostics.steps.valkey?.analyticsKeyCount === 0" class="text-yellow-600 dark:text-yellow-400 text-xs">No cached values = first scrape will be baseline only (no data inserted). Second scrape (5 min later) will produce data.</p>
                <div v-if="diagnostics.steps.valkey?.sampleValues && Object.keys(diagnostics.steps.valkey.sampleValues).length" class="mt-2">
                  <p class="text-xs text-gray-500 dark:text-gray-500 mb-1">Sample cached values:</p>
                  <div class="text-xs font-mono bg-gray-50 dark:bg-gray-750 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto space-y-1">
                    <div v-for="(val, key) in diagnostics.steps.valkey.sampleValues" :key="key" class="text-gray-600 dark:text-gray-400">
                      <span class="text-gray-500">{{ key }}:</span> {{ JSON.stringify(val) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Database -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">6. Database</h3>
                <span :class="['inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', diagnostics.steps.database?.ok ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300']">
                  <CheckCircle v-if="diagnostics.steps.database?.ok" class="w-3 h-3" />
                  <XCircle v-else class="w-3 h-3" />
                  {{ diagnostics.steps.database?.ok ? 'OK' : 'FAIL' }}
                </span>
              </div>
              <div v-if="diagnostics.steps.database?.error" class="text-sm text-red-600 dark:text-red-400">{{ diagnostics.steps.database.error }}</div>
              <div v-else class="text-sm text-gray-600 dark:text-gray-400">
                <p>Total analytics rows: <span class="font-medium text-gray-900 dark:text-white">{{ (diagnostics.steps.database?.totalRows ?? 0).toLocaleString() }}</span></p>
                <p v-if="diagnostics.steps.database?.totalRows === 0" class="text-yellow-600 dark:text-yellow-400 text-xs mt-1">No rows = analytics has never successfully collected data. Use "Force Collection" twice (first run establishes baseline, second inserts data).</p>
              </div>
            </div>
          </div>

          <!-- Raw JSON (collapsible) -->
          <details class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <summary class="px-5 py-3 cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">
              Raw JSON Response
            </summary>
            <pre class="px-5 pb-5 text-xs font-mono text-gray-600 dark:text-gray-400 overflow-x-auto whitespace-pre-wrap">{{ JSON.stringify(diagnostics, null, 2) }}</pre>
          </details>
        </template>

        <div v-else class="text-center py-20">
          <Wrench class="w-10 h-10 mx-auto mb-3 text-gray-400 dark:text-gray-500" />
          <p class="text-sm text-gray-500 dark:text-gray-400">Click "Run Diagnostics" to test the analytics pipeline.</p>
        </div>
      </div>
    </template>
  </div>
</template>
