<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { BarChart3, ArrowUpRight, ArrowDownRight, Globe, Activity, TrendingUp, Users, Eye, MonitorSmartphone, Link2, FileText } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'

const api = useApi()

// ── Types ────────────────────────────────────────────────────────────────

interface AnalyticsDataPoint {
  timestamp: string
  requests: number
  bytesIn: number
  bytesOut: number
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
    activeServices: number
    topServices: TopService[]
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
    topServices: VisitorTopService[]
  }
}

// ── State ────────────────────────────────────────────────────────────────

const activeTab = ref<'traffic' | 'visitors'>('traffic')
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

watch(activeTab, (tab) => {
  if (tab === 'visitors' && !visitors.value && !visitorsLoading.value) fetchVisitors()
  if (tab === 'traffic' && !analytics.value && !loading.value) fetchAnalytics()
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

const chartWidth = 700
const chartHeight = 200
const pad = { top: 10, right: 10, bottom: 20, left: 55 }

function polyline(values: number[]): string {
  if (!values.length) return ''
  const maxVal = Math.max(...values, 1)
  const w = chartWidth - pad.left - pad.right
  const h = chartHeight - pad.top - pad.bottom
  return values.map((v, i) => {
    const x = pad.left + (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w)
    const y = pad.top + h - (v / maxVal) * h
    return `${x},${y}`
  }).join(' ')
}

function gridLines(values: number[], isBytes = false): { y: number; label: string }[] {
  const maxVal = Math.max(...values, 1)
  const h = chartHeight - pad.top - pad.bottom
  const steps = 4
  return Array.from({ length: steps + 1 }, (_, i) => {
    const val = (maxVal / steps) * i
    const y = pad.top + h - (val / maxVal) * h
    return { y, label: isBytes ? formatBytes(val) : formatNumber(Math.round(val)) }
  })
}

function buildTimeLabels(data: Array<{ timestamp: string }>): { x: number; label: string }[] {
  if (!data.length) return []
  const w = chartWidth - pad.left - pad.right
  const count = Math.min(data.length, 8)
  const step = Math.max(1, Math.floor(data.length / count))
  const labels: { x: number; label: string }[] = []
  for (let i = 0; i < data.length; i += step) {
    const point = data[i]
    if (!point) continue
    const d = new Date(point.timestamp)
    const x = pad.left + (data.length === 1 ? w / 2 : (i / (data.length - 1)) * w)
    const label = period.value === '24h'
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    labels.push({ x, label })
  }
  return labels
}

const bottomY = computed(() => chartHeight - pad.bottom)

// ── Traffic computed ─────────────────────────────────────────────────────

const requestsPoints = computed(() => analytics.value ? polyline(analytics.value.data.map(d => d.requests)) : '')
const bytesInPoints = computed(() => analytics.value ? polyline(analytics.value.data.map(d => d.bytesIn)) : '')
const bytesOutPoints = computed(() => analytics.value ? polyline(analytics.value.data.map(d => d.bytesOut)) : '')
const requestsGrid = computed(() => analytics.value ? gridLines(analytics.value.data.map(d => d.requests)) : [])
const bandwidthGrid = computed(() => {
  if (!analytics.value) return []
  return gridLines(analytics.value.data.map(d => Math.max(d.bytesIn, d.bytesOut)), true)
})
const tLabels = computed(() => analytics.value ? buildTimeLabels(analytics.value.data) : [])

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

const visitorPoints = computed(() => visitors.value ? polyline(visitors.value.data.map(d => d.uniqueVisitors)) : '')
const pageViewPoints = computed(() => visitors.value ? polyline(visitors.value.data.map(d => d.pageViews)) : '')
const visitorGrid = computed(() => visitors.value ? gridLines(visitors.value.data.map(d => d.uniqueVisitors)) : [])
const pageViewGrid = computed(() => visitors.value ? gridLines(visitors.value.data.map(d => d.pageViews)) : [])
const vLabels = computed(() => visitors.value ? buildTimeLabels(visitors.value.data) : [])

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
          v-for="tab in [{ id: 'traffic' as const, label: 'Traffic' }, { id: 'visitors' as const, label: 'Visitors' }]"
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
        <!-- Summary stat cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-3 mb-2">
              <div class="p-2 rounded-lg bg-primary-50 dark:bg-primary-900/20"><Globe class="w-5 h-5 text-primary-600 dark:text-primary-400" /></div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Total Requests</p>
            </div>
            <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ formatNumber(analytics.summary.totalRequests) }}</p>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-3 mb-2">
              <div class="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20"><ArrowDownRight class="w-5 h-5 text-blue-600 dark:text-blue-400" /></div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Bandwidth In</p>
            </div>
            <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ formatBytes(analytics.summary.totalBytesIn) }}</p>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-3 mb-2">
              <div class="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20"><ArrowUpRight class="w-5 h-5 text-emerald-600 dark:text-emerald-400" /></div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Bandwidth Out</p>
            </div>
            <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ formatBytes(analytics.summary.totalBytesOut) }}</p>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-3 mb-2">
              <div class="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20"><Activity class="w-5 h-5 text-amber-600 dark:text-amber-400" /></div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Active Services</p>
            </div>
            <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ analytics.summary.activeServices }}</p>
          </div>
        </div>

        <!-- Requests chart -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Requests Over Time</h3>
          <div v-if="analytics.data.length === 0" class="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No analytics data yet. Data is collected every 5 minutes.</div>
          <svg v-else :viewBox="`0 0 ${chartWidth} ${chartHeight}`" class="w-full h-auto" preserveAspectRatio="xMidYMid meet">
            <line v-for="(g, i) in requestsGrid" :key="'rg'+i" :x1="pad.left" :y1="g.y" :x2="chartWidth - pad.right" :y2="g.y" stroke="currentColor" class="text-gray-200 dark:text-gray-700" stroke-width="0.5" />
            <text v-for="(g, i) in requestsGrid" :key="'rl'+i" :x="pad.left - 4" :y="g.y + 3" text-anchor="end" class="fill-gray-400 dark:fill-gray-500" font-size="9">{{ g.label }}</text>
            <text v-for="(tl, i) in tLabels" :key="'tl'+i" :x="tl.x" :y="chartHeight - 2" text-anchor="middle" class="fill-gray-400 dark:fill-gray-500" font-size="9">{{ tl.label }}</text>
            <polygon v-if="requestsPoints" :points="`${pad.left},${bottomY} ${requestsPoints} ${chartWidth - pad.right},${bottomY}`" class="fill-primary-500/10 dark:fill-primary-400/10" />
            <polyline v-if="requestsPoints" :points="requestsPoints" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="stroke-primary-500 dark:stroke-primary-400" />
          </svg>
        </div>

        <!-- Bandwidth chart -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Bandwidth</h3>
            <div class="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span class="flex items-center gap-1"><span class="w-3 h-0.5 bg-blue-500 inline-block rounded"></span> In</span>
              <span class="flex items-center gap-1"><span class="w-3 h-0.5 bg-emerald-500 inline-block rounded"></span> Out</span>
            </div>
          </div>
          <div v-if="analytics.data.length === 0" class="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No data yet.</div>
          <svg v-else :viewBox="`0 0 ${chartWidth} ${chartHeight}`" class="w-full h-auto" preserveAspectRatio="xMidYMid meet">
            <line v-for="(g, i) in bandwidthGrid" :key="'bg'+i" :x1="pad.left" :y1="g.y" :x2="chartWidth - pad.right" :y2="g.y" stroke="currentColor" class="text-gray-200 dark:text-gray-700" stroke-width="0.5" />
            <text v-for="(g, i) in bandwidthGrid" :key="'bl'+i" :x="pad.left - 4" :y="g.y + 3" text-anchor="end" class="fill-gray-400 dark:fill-gray-500" font-size="9">{{ g.label }}</text>
            <text v-for="(tl, i) in tLabels" :key="'btl'+i" :x="tl.x" :y="chartHeight - 2" text-anchor="middle" class="fill-gray-400 dark:fill-gray-500" font-size="9">{{ tl.label }}</text>
            <polyline v-if="bytesInPoints" :points="bytesInPoints" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="stroke-blue-500" />
            <polyline v-if="bytesOutPoints" :points="bytesOutPoints" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="stroke-emerald-500" />
          </svg>
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
        <!-- Summary cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-3 mb-2">
              <div class="p-2 rounded-lg bg-violet-50 dark:bg-violet-900/20"><Users class="w-5 h-5 text-violet-600 dark:text-violet-400" /></div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Unique Visitors</p>
            </div>
            <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ formatNumber(visitors.summary.totalUniqueVisitors) }}</p>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center gap-3 mb-2">
              <div class="p-2 rounded-lg bg-primary-50 dark:bg-primary-900/20"><Eye class="w-5 h-5 text-primary-600 dark:text-primary-400" /></div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Page Views</p>
            </div>
            <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ formatNumber(visitors.summary.totalPageViews) }}</p>
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

        <!-- Unique visitors chart -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Visitors Over Time</h3>
            <div class="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span class="flex items-center gap-1"><span class="w-3 h-0.5 bg-violet-500 inline-block rounded"></span> Unique Visitors</span>
              <span class="flex items-center gap-1"><span class="w-3 h-0.5 bg-primary-500 inline-block rounded"></span> Page Views</span>
            </div>
          </div>
          <div v-if="visitors.data.length === 0" class="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No visitor data yet. Data is collected every 5 minutes from Traefik access logs.</div>
          <svg v-else :viewBox="`0 0 ${chartWidth} ${chartHeight}`" class="w-full h-auto" preserveAspectRatio="xMidYMid meet">
            <line v-for="(g, i) in pageViewGrid" :key="'vg'+i" :x1="pad.left" :y1="g.y" :x2="chartWidth - pad.right" :y2="g.y" stroke="currentColor" class="text-gray-200 dark:text-gray-700" stroke-width="0.5" />
            <text v-for="(g, i) in pageViewGrid" :key="'vl'+i" :x="pad.left - 4" :y="g.y + 3" text-anchor="end" class="fill-gray-400 dark:fill-gray-500" font-size="9">{{ g.label }}</text>
            <text v-for="(tl, i) in vLabels" :key="'vtl'+i" :x="tl.x" :y="chartHeight - 2" text-anchor="middle" class="fill-gray-400 dark:fill-gray-500" font-size="9">{{ tl.label }}</text>
            <polygon v-if="pageViewPoints" :points="`${pad.left},${bottomY} ${pageViewPoints} ${chartWidth - pad.right},${bottomY}`" class="fill-primary-500/5 dark:fill-primary-400/5" />
            <polyline v-if="pageViewPoints" :points="pageViewPoints" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="stroke-primary-400 dark:stroke-primary-500" stroke-dasharray="4 2" />
            <polygon v-if="visitorPoints" :points="`${pad.left},${bottomY} ${visitorPoints} ${chartWidth - pad.right},${bottomY}`" class="fill-violet-500/10 dark:fill-violet-400/10" />
            <polyline v-if="visitorPoints" :points="visitorPoints" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="stroke-violet-500 dark:stroke-violet-400" />
          </svg>
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
            <div v-else class="space-y-2 max-h-[300px] overflow-y-auto">
              <div v-for="(p, i) in visitors.summary.topPaths" :key="i" class="flex items-center justify-between gap-3">
                <span class="text-sm text-gray-700 dark:text-gray-300 truncate min-w-0 flex-1 font-mono">{{ p.path }}</span>
                <span class="text-sm text-gray-500 dark:text-gray-400 tabular-nums shrink-0">{{ formatNumber(p.count) }}</span>
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
            <div v-else class="space-y-2 max-h-[300px] overflow-y-auto">
              <div v-for="(r, i) in visitors.summary.topReferrers" :key="i" class="flex items-center justify-between gap-3">
                <span class="text-sm text-gray-700 dark:text-gray-300 truncate min-w-0 flex-1">{{ r.referrer }}</span>
                <span class="text-sm text-gray-500 dark:text-gray-400 tabular-nums shrink-0">{{ formatNumber(r.count) }}</span>
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
  </div>
</template>
