<script setup lang="ts">
import { ref, onMounted, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Box, Globe, HardDrive, DollarSign, Activity, Clock,
  Rocket, Sun, Moon, Sunset, CheckCircle, Wifi, Container,
  Sparkles, ArrowRight, Cpu, MemoryStick, ExternalLink, Shield,
  Ship, Terminal, Plus, ArrowUpRight, Zap, ChevronRight,
  LayoutGrid, TrendingUp,
} from 'lucide-vue-next'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useApi } from '@/composables/useApi'
import { useServicesStore } from '@/stores/services'
import { useAccount } from '@/composables/useAccount'
import { useAuth } from '@/composables/useAuth'
import { useDomainPicker } from '@/composables/useDomainPicker'
import ResourceGauge from '@/components/ResourceGauge.vue'

const { t } = useI18n()
const api = useApi()
const servicesStore = useServicesStore()
const { currentAccount } = useAccount()
const { user } = useAuth()
const domainPicker = useDomainPicker()

const activityFeed = ref<any[]>([])
const volumesList = ref<any[]>([])
const loading = ref(true)
const showWelcome = ref(false)

// Real API data
const storageQuota = ref<{ usedGb: number; limitGb: number } | null>(null)
const billingUsage = ref<{ bandwidthGb: number; storageGb: number; estimatedCostCents: number; runningContainers: number; totalContainers: number } | null>(null)
const resourceLimits = ref<{ maxContainers: number | null; maxStorageGb: number | null; maxBandwidthGb: number | null; maxTotalCpuCores: number | null; maxTotalMemoryMb: number | null } | null>(null)

// Animated count-up values
const animatedRunning = ref(0)
const animatedDomains = ref(0)
const animatedTotal = ref(0)
const animatedCost = ref(0)

function animateValue(target: ReturnType<typeof ref<number>>, end: number, duration = 800) {
  if (end === 0) { target.value = 0; return }
  const start = performance.now()
  const step = (now: number) => {
    const progress = Math.min((now - start) / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3)
    target.value = Math.round(eased * end)
    if (progress < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// Time-aware greeting — localized
const greetingIcon = computed(() => {
  const h = new Date().getHours()
  if (h < 12) return Sun
  if (h < 18) return Sunset
  return Moon
})

const greeting = computed(() => {
  const h = new Date().getHours()
  const name = user.value?.name?.split(' ')[0] ?? ''
  if (h < 12) return t('dashboard.goodMorning', { name })
  if (h < 18) return t('dashboard.goodAfternoon', { name })
  return t('dashboard.goodEvening', { name })
})

// Services health breakdown
const healthBreakdown = computed(() => {
  const services = servicesStore.services
  return {
    running: services.filter((s: any) => s.status === 'running').length,
    deploying: services.filter((s: any) => s.status === 'deploying' || s.status === 'starting').length,
    stopped: services.filter((s: any) => s.status === 'stopped').length,
    failed: services.filter((s: any) => s.status === 'failed' || s.status === 'error').length,
    total: services.length,
  }
})

const allHealthy = computed(() =>
  healthBreakdown.value.total > 0 &&
  healthBreakdown.value.failed === 0 &&
  healthBreakdown.value.stopped === 0 &&
  healthBreakdown.value.running === healthBreakdown.value.total
)

// Allocated CPU and memory from services
const allocatedCpu = computed(() =>
  servicesStore.services.reduce((sum: number, s: any) => sum + ((s.cpuLimit || 0) * (s.replicas || 1)), 0)
)
const allocatedMemoryMb = computed(() =>
  servicesStore.services.reduce((sum: number, s: any) => sum + ((s.memoryLimit || 0) * (s.replicas || 1)), 0)
)

// Resource gauges
function pctOf(used: number, limit: number | null | undefined): number {
  if (!limit || limit <= 0) return 0
  return Math.min(Math.round((used / limit) * 100), 100)
}

function fmtNum(n: number, decimals = 1): string {
  return n % 1 === 0 ? String(n) : n.toFixed(decimals)
}

function detailStr(used: number, limit: number | null | undefined, unit: string): string {
  if (!limit || limit <= 0) return `${fmtNum(used)} ${unit}`
  return `${fmtNum(used)} / ${fmtNum(limit)} ${unit}`
}

const gauges = computed(() => {
  const limits = resourceLimits.value
  const usage = billingUsage.value
  const quota = storageQuota.value
  const hb = healthBreakdown.value

  return [
    {
      label: t('dashboard.servicesUptime'),
      value: hb.total > 0 ? Math.round((hb.running / hb.total) * 100) : 0,
      icon: Activity,
      highIsGood: true,
      detail: `${hb.running} / ${hb.total}`,
    },
    {
      label: t('dashboard.containers'),
      value: pctOf(usage?.runningContainers ?? 0, limits?.maxContainers),
      icon: Container,
      detail: detailStr(usage?.runningContainers ?? 0, limits?.maxContainers, ''),
    },
    {
      label: t('dashboard.cpuAllocated'),
      value: pctOf(allocatedCpu.value, limits?.maxTotalCpuCores),
      icon: Cpu,
      detail: detailStr(allocatedCpu.value, limits?.maxTotalCpuCores, 'cores'),
    },
    {
      label: t('dashboard.memoryAllocated'),
      value: pctOf(allocatedMemoryMb.value, limits?.maxTotalMemoryMb),
      icon: MemoryStick,
      detail: detailStr(allocatedMemoryMb.value, limits?.maxTotalMemoryMb, 'MB'),
    },
    {
      label: t('dashboard.storage'),
      value: quota && quota.limitGb > 0 ? pctOf(quota.usedGb, quota.limitGb) : 0,
      icon: HardDrive,
      detail: detailStr(quota?.usedGb ?? 0, quota?.limitGb, 'GB'),
    },
    {
      label: t('dashboard.bandwidth'),
      value: pctOf(usage?.bandwidthGb ?? 0, limits?.maxBandwidthGb),
      icon: Wifi,
      detail: detailStr(usage?.bandwidthGb ?? 0, limits?.maxBandwidthGb, 'GB'),
    },
  ]
})

const runningCount = computed(() =>
  servicesStore.services.filter((s: any) => s.status === 'running').length
)

// Monthly cost formatted
const formattedCost = computed(() => {
  if (!billingUsage.value) return '$0'
  const cents = animatedCost.value
  if (cents === 0) return '$0'
  return `$${(cents / 100).toFixed(2)}`
})

const stats = computed(() => [
  { label: t('dashboard.domains'), value: String(animatedDomains.value), icon: Globe, color: 'text-white', bg: 'bg-gradient-to-br from-orange-500 to-red-600', to: '/panel/domains' },
  { label: t('dashboard.runningServices'), value: String(animatedRunning.value), icon: Box, color: 'text-white', bg: 'bg-gradient-to-br from-green-500 to-emerald-600', to: '/panel/services' },
  { label: t('dashboard.totalServices'), value: String(animatedTotal.value), icon: HardDrive, color: 'text-white', bg: 'bg-gradient-to-br from-slate-700 to-gray-900', to: '/panel/services' },
  { label: t('dashboard.estimatedCost'), value: formattedCost.value, icon: DollarSign, color: 'text-white', bg: 'bg-gradient-to-br from-amber-500 to-orange-600', to: '/panel/billing' },
])

// Top domains for the dashboard overview
const myDomains = computed(() => domainPicker.domains.value.slice(0, 6))
const domainTypeLabel = (type: string) => {
  if (type === 'purchased') return t('dashboard.domainPurchased', 'Registered')
  if (type === 'external') return t('dashboard.domainExternal', 'External')
  return t('dashboard.domainSubdomain', 'Subdomain')
}
const domainTypeBadge = (type: string) => {
  if (type === 'purchased') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  if (type === 'external') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
  return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
}

const recentServices = computed(() =>
  [...servicesStore.services].sort((a: any, b: any) => {
    const ta = a.updatedAt ?? a.createdAt ?? 0
    const tb = b.updatedAt ?? b.createdAt ?? 0
    return (typeof tb === 'number' ? tb : new Date(tb).getTime()) - (typeof ta === 'number' ? ta : new Date(ta).getTime())
  }).slice(0, 5)
)

function openDomain(domain: string) {
  window.open(`https://${domain}`, '_blank', 'noopener,noreferrer')
}

function formatDate(ts: any) {
  if (!ts) return ''
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  return d.toLocaleDateString()
}

function formatTimestamp(ts: any) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleString()
}

function relativeTime(ts: any) {
  if (!ts) return ''
  const d = new Date(ts)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('dashboard.justNow', 'just now')
  if (mins < 60) return t('dashboard.minutesAgo', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('dashboard.hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  return t('dashboard.daysAgo', { n: days })
}

function eventBadgeClasses(eventType: string | null) {
  if (!eventType) return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  if (eventType.includes('created') || eventType.includes('added') || eventType.includes('registered'))
    return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  if (eventType.includes('deleted') || eventType.includes('removed') || eventType.includes('revoked'))
    return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  if (eventType.includes('updated') || eventType.includes('changed'))
    return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
  if (eventType.includes('started') || eventType.includes('login'))
    return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
  if (eventType.includes('stopped') || eventType.includes('logout'))
    return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
  if (eventType.includes('failed'))
    return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
  if (eventType.includes('restarted') || eventType.includes('redeployed'))
    return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
  return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
}

function formatEventType(eventType: string | null) {
  if (!eventType) return 'action'
  return eventType.replace(/[._]/g, ' ')
}

function eventIcon(eventType: string | null) {
  if (!eventType) return Zap
  if (eventType.includes('deploy') || eventType.includes('started')) return Rocket
  if (eventType.includes('created') || eventType.includes('added')) return Plus
  if (eventType.includes('updated') || eventType.includes('changed')) return TrendingUp
  return Zap
}

// Health bar segment width
function healthWidth(count: number) {
  if (healthBreakdown.value.total === 0) return '0%'
  return `${(count / healthBreakdown.value.total) * 100}%`
}

// Quick actions
const quickActions = computed(() => [
  { label: t('dashboard.quickDeploy', 'Deploy Service'), icon: Ship, to: '/panel/deploy', color: 'text-primary-600 dark:text-primary-400', bg: 'bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/30' },
  { label: t('dashboard.quickDomain', 'Add Domain'), icon: Globe, to: '/panel/domains', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30' },
  { label: t('dashboard.quickMarketplace', 'Marketplace'), icon: LayoutGrid, to: '/panel/marketplace', color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/30' },
  { label: t('dashboard.quickTerminal', 'Terminal'), icon: Terminal, to: '/panel/terminal', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30' },
])

// Has any data at all
const hasData = computed(() => servicesStore.services.length > 0 || domainPicker.domains.value.length > 0)

onMounted(async () => {
  if (sessionStorage.getItem('fleet_just_logged_in')) {
    sessionStorage.removeItem('fleet_just_logged_in')
    showWelcome.value = true
  }

  loading.value = true
  try {
    await Promise.all([
      servicesStore.fetchServices(),
      domainPicker.fetchDomains(true),
      currentAccount.value?.id
        ? api.get<any>(`/accounts/${currentAccount.value.id}/activity?limit=20`)
            .then(data => {
              const entries = (data?.data ?? []) as any[]
              activityFeed.value = entries.filter((e: any) => e.eventType).slice(0, 10)
            })
            .catch(() => {})
        : Promise.resolve(),
      api.get<{ usedGb: number; limitGb: number }>('/storage/volumes/quota')
        .then(data => { storageQuota.value = data })
        .catch(() => {}),
      api.get<any[]>('/storage/volumes')
        .then(data => { volumesList.value = data ?? [] })
        .catch(() => {}),
      api.get<any>('/billing/usage')
        .then(data => { billingUsage.value = data })
        .catch(() => {}),
      api.get<any>('/billing/resource-limits')
        .then(data => { resourceLimits.value = data })
        .catch(() => {}),
    ])
    await nextTick()
    animateValue(animatedRunning, runningCount.value)
    animateValue(animatedDomains, domainPicker.domains.value.length, 900)
    animateValue(animatedTotal, servicesStore.services.length, 1000)
    animateValue(animatedCost, billingUsage.value?.estimatedCostCents ?? 0, 1100)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <!-- Skeleton loading state -->
  <div v-if="loading" class="space-y-6">
    <!-- Greeting skeleton -->
    <div class="flex items-center gap-3 animate-pulse">
      <div class="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-700" />
      <div class="h-7 w-56 bg-gray-200 dark:bg-gray-700 rounded-lg" />
    </div>

    <!-- Quick actions skeleton -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div v-for="i in 4" :key="i" class="h-[72px] rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
    </div>

    <!-- Stat cards skeleton -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <SkeletonLoader type="stat" :count="4" />
    </div>

    <!-- Content skeletons side by side -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SkeletonLoader type="list" :count="5" />
      <SkeletonLoader type="list" :count="5" />
    </div>

    <!-- Gauges skeleton -->
    <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 animate-pulse">
      <div class="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-6" />
      <div class="grid grid-cols-3 sm:grid-cols-6 gap-6">
        <SkeletonLoader type="gauge" :count="6" />
      </div>
    </div>
  </div>

  <div v-else class="stagger-children">
    <!-- Greeting -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-3">
        <component :is="greetingIcon" class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ greeting }}</h1>
      </div>
    </div>

    <!-- Welcome banner -->
    <Transition
      enter-active-class="transition-all duration-500 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      leave-active-class="transition-all duration-300 ease-in"
      leave-to-class="opacity-0 translate-y-1"
    >
      <div
        v-if="showWelcome"
        class="mb-6 rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 p-4 flex items-center gap-3 shadow-lg"
      >
        <Sparkles class="w-5 h-5 text-white/80 shrink-0" />
        <p class="text-white font-medium text-sm">
          {{ $t('dashboard.welcomeBack', { name: user?.name?.split(' ')[0] ?? '' }) }}
        </p>
      </div>
    </Transition>

    <!-- Quick Actions Bar -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <router-link
        v-for="action in quickActions"
        :key="action.to"
        :to="action.to"
        :class="[action.bg, 'flex items-center gap-3 px-4 py-3.5 rounded-xl border border-transparent transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md group']"
      >
        <div :class="[action.color, 'shrink-0']">
          <component :is="action.icon" class="w-5 h-5" />
        </div>
        <span :class="[action.color, 'text-sm font-semibold truncate']">{{ action.label }}</span>
        <ArrowUpRight :class="[action.color, 'w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity shrink-0']" />
      </router-link>
    </div>

    <!-- Empty state (no services and no domains) -->
    <div v-if="!hasData" class="text-center py-16">
      <div class="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-900/20 dark:to-primary-800/20 flex items-center justify-center mb-6 shadow-sm">
        <Rocket class="w-10 h-10 text-primary-500" />
      </div>
      <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-2">{{ $t('dashboard.getStartedTitle', 'Ready to launch?') }}</h2>
      <p class="text-gray-500 dark:text-gray-400 text-sm mb-8 max-w-md mx-auto">{{ $t('dashboard.getStartedDomains', 'Start by registering a domain or deploying a service to bring your dashboard to life.') }}</p>
      <div class="flex items-center justify-center gap-3">
        <router-link
          to="/panel/domains"
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors shadow-sm hover:shadow-md"
        >
          <Globe class="w-4 h-4" />
          {{ $t('dashboard.addDomain') }}
        </router-link>
        <router-link
          to="/panel/deploy"
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors"
        >
          <Rocket class="w-4 h-4" />
          {{ $t('services.deployNew') }}
        </router-link>
      </div>
    </div>

    <template v-else>
      <!-- Stat cards (clickable) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <router-link
          v-for="stat in stats"
          :key="stat.label"
          :to="stat.to"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:border-primary-200 dark:hover:border-primary-800 block group"
        >
          <div class="flex items-center gap-4">
            <div :class="[stat.bg, 'p-2.5 rounded-lg shadow-sm group-hover:shadow-md transition-shadow']">
              <component :is="stat.icon" :class="[stat.color, 'w-5 h-5']" />
            </div>
            <div>
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">{{ stat.label }}</p>
              <p class="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{{ stat.value }}</p>
            </div>
          </div>
        </router-link>
      </div>

      <!-- Two-column layout: Domains + Services side by side -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <!-- My Domains -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm transition-all duration-200 hover:shadow-md flex flex-col">
          <div class="px-5 py-3.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Globe class="w-4.5 h-4.5 text-blue-500" />
              <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('dashboard.myDomains', 'My Domains') }}</h2>
              <span class="text-xs text-gray-400 dark:text-gray-500 tabular-nums">({{ domainPicker.domains.value.length }})</span>
            </div>
            <router-link to="/panel/domains" class="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 font-medium">
              {{ $t('dashboard.viewAll') }}
              <ChevronRight class="w-3 h-3" />
            </router-link>
          </div>
          <div v-if="myDomains.length === 0" class="px-6 py-10 text-center flex-1 flex flex-col items-center justify-center">
            <Globe class="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p class="text-gray-500 dark:text-gray-400 text-sm mb-3">{{ $t('dashboard.noDomainsYet', 'No domains yet.') }}</p>
            <router-link
              to="/panel/domains"
              class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors"
            >
              <Globe class="w-3.5 h-3.5" />
              {{ $t('dashboard.addDomain') }}
            </router-link>
          </div>
          <div v-else class="divide-y divide-gray-100 dark:divide-gray-700/50 flex-1">
            <router-link
              v-for="d in myDomains"
              :key="d.domain"
              to="/panel/domains"
              class="px-5 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors block group/domain"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  :class="d.type === 'purchased' ? 'bg-green-50 dark:bg-green-900/20' : d.type === 'external' ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-purple-50 dark:bg-purple-900/20'"
                >
                  <Shield v-if="d.type === 'purchased'" class="w-3.5 h-3.5 text-green-500" />
                  <ExternalLink v-else-if="d.type === 'external'" class="w-3.5 h-3.5 text-blue-500" />
                  <Globe v-else class="w-3.5 h-3.5 text-purple-500" />
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ d.domain }}</p>
                  <p v-if="d.assignedServiceName" class="text-[11px] text-gray-400 dark:text-gray-500 truncate">{{ d.assignedServiceName }}</p>
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0 ml-3">
                <span
                  :class="['w-1.5 h-1.5 rounded-full shrink-0', d.status === 'active' ? 'bg-green-500' : 'bg-yellow-500']"
                ></span>
                <button
                  v-if="d.status === 'active'"
                  @click.prevent="openDomain(d.domain)"
                  class="p-1 rounded text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors opacity-0 group-hover/domain:opacity-100"
                  :title="$t('domains.openInNewTab', 'Open site')"
                >
                  <ExternalLink class="w-3 h-3" />
                </button>
              </div>
            </router-link>
          </div>
        </div>

        <!-- My Services -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm transition-all duration-200 hover:shadow-md flex flex-col">
          <div class="px-5 py-3.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Box class="w-4.5 h-4.5 text-green-500" />
              <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('dashboard.myServices', 'My Services') }}</h2>
              <span class="text-xs text-gray-400 dark:text-gray-500 tabular-nums">({{ servicesStore.services.length }})</span>
            </div>
            <router-link to="/panel/services" class="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 font-medium">
              {{ $t('dashboard.viewAll') }}
              <ChevronRight class="w-3 h-3" />
            </router-link>
          </div>
          <!-- Health bar (inline) -->
          <div v-if="healthBreakdown.total > 0" class="px-5 pt-3 pb-2">
            <div class="flex items-center justify-between mb-1.5">
              <div class="flex flex-wrap gap-3">
                <div v-if="healthBreakdown.running > 0" class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                  <span class="text-[11px] text-gray-500 dark:text-gray-400">{{ healthBreakdown.running }} {{ $t('dashboard.running') }}</span>
                </div>
                <div v-if="healthBreakdown.deploying > 0" class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
                  <span class="text-[11px] text-gray-500 dark:text-gray-400">{{ healthBreakdown.deploying }} {{ $t('dashboard.deploying') }}</span>
                </div>
                <div v-if="healthBreakdown.stopped > 0" class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                  <span class="text-[11px] text-gray-500 dark:text-gray-400">{{ healthBreakdown.stopped }} {{ $t('dashboard.stopped') }}</span>
                </div>
                <div v-if="healthBreakdown.failed > 0" class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                  <span class="text-[11px] text-gray-500 dark:text-gray-400">{{ healthBreakdown.failed }} {{ $t('dashboard.failed') }}</span>
                </div>
              </div>
              <div v-if="allHealthy" class="flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircle class="w-3 h-3" />
                <span class="text-[11px] font-medium">{{ $t('dashboard.allHealthy') }}</span>
              </div>
            </div>
            <div class="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden flex">
              <div v-if="healthBreakdown.running > 0" class="bg-green-500 transition-all duration-700" :style="{ width: healthWidth(healthBreakdown.running) }" />
              <div v-if="healthBreakdown.deploying > 0" class="bg-yellow-500 transition-all duration-700" :style="{ width: healthWidth(healthBreakdown.deploying) }" />
              <div v-if="healthBreakdown.stopped > 0" class="bg-gray-400 transition-all duration-700" :style="{ width: healthWidth(healthBreakdown.stopped) }" />
              <div v-if="healthBreakdown.failed > 0" class="bg-red-500 transition-all duration-700" :style="{ width: healthWidth(healthBreakdown.failed) }" />
            </div>
          </div>
          <div class="divide-y divide-gray-100 dark:divide-gray-700/50 flex-1">
            <div v-if="recentServices.length === 0" class="px-6 py-10 text-center flex-1 flex flex-col items-center justify-center">
              <Box class="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p class="text-gray-500 dark:text-gray-400 text-sm mb-3">{{ $t('dashboard.noServicesYet') }}</p>
              <router-link
                to="/panel/deploy"
                class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors"
              >
                <Rocket class="w-3.5 h-3.5" />
                {{ $t('services.deployNew', 'Deploy') }}
              </router-link>
            </div>
            <router-link
              v-for="svc in recentServices"
              :key="svc.id"
              :to="`/panel/services/${svc.id}`"
              class="px-5 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors block group/svc"
            >
              <div class="flex items-center gap-2.5">
                <span
                  :class="[
                    'w-2 h-2 rounded-full shrink-0',
                    svc.status === 'running' ? 'bg-green-500' :
                    svc.status === 'deploying' ? 'bg-yellow-500 animate-pulse' :
                    svc.status === 'failed' ? 'bg-red-500' : 'bg-gray-400'
                  ]"
                ></span>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ svc.name }}</p>
                  <p class="text-[11px] text-gray-400 dark:text-gray-500 truncate font-mono">{{ svc.image }}</p>
                </div>
              </div>
              <div class="flex items-center gap-2.5 shrink-0 ml-3">
                <span
                  :class="[
                    'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold',
                    svc.status === 'running' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                    svc.status === 'failed' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                    svc.status === 'deploying' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' :
                    'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                  ]"
                >
                  {{ svc.status }}
                </span>
                <ArrowRight class="w-3.5 h-3.5 opacity-0 group-hover/svc:opacity-100 transition-opacity text-gray-400" />
              </div>
            </router-link>
          </div>
        </div>
      </div>

      <!-- Resource usage gauges -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 mb-6 transition-all duration-200 hover:shadow-md">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('dashboard.resourceUsage') }}</h3>
          <router-link to="/panel/billing" class="text-[11px] text-primary-600 dark:text-primary-400 hover:underline font-medium">{{ $t('dashboard.viewDetails', 'View details') }}</router-link>
        </div>
        <div class="grid grid-cols-3 sm:grid-cols-6 gap-6">
          <ResourceGauge
            v-for="gauge in gauges"
            :key="gauge.label"
            :label="gauge.label"
            :value="gauge.value"
            :icon="gauge.icon"
            :high-is-good="gauge.highIsGood"
            :detail="gauge.detail"
          />
        </div>
      </div>

      <!-- Volume usage breakdown -->
      <div v-if="volumesList.length > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 mb-6 transition-all duration-200 hover:shadow-md">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('dashboard.volumeUsage') }}</h3>
          <router-link to="/panel/storage" class="text-[11px] text-primary-600 dark:text-primary-400 hover:underline font-medium">{{ $t('dashboard.viewAll') }}</router-link>
        </div>
        <div class="space-y-3">
          <div v-for="vol in volumesList" :key="vol.name" class="flex items-center gap-4">
            <div class="w-28 sm:w-36 shrink-0 truncate">
              <span class="text-sm font-mono text-gray-900 dark:text-white truncate">{{ vol.displayName || vol.name }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="h-1.5 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-700"
                  :class="vol.sizeGb > 0 && (vol.usedGb ?? 0) / vol.sizeGb > 0.9
                    ? 'bg-red-500'
                    : vol.sizeGb > 0 && (vol.usedGb ?? 0) / vol.sizeGb > 0.7
                      ? 'bg-amber-500'
                      : 'bg-primary-500'"
                  :style="{ width: vol.sizeGb > 0 ? `${Math.min(100, ((vol.usedGb ?? 0) / vol.sizeGb) * 100)}%` : '0%' }"
                />
              </div>
            </div>
            <div class="w-24 sm:w-28 text-right shrink-0">
              <span class="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{{ (vol.usedGb ?? 0).toFixed(1) }} / {{ vol.sizeGb }} GB</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm transition-all duration-200 hover:shadow-md">
        <div class="px-5 py-3.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Clock class="w-4.5 h-4.5 text-gray-400 dark:text-gray-500" />
            <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('dashboard.recentActivity') }}</h2>
          </div>
          <router-link to="/panel/activity" class="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 font-medium">
            {{ $t('dashboard.viewAll') }}
            <ChevronRight class="w-3 h-3" />
          </router-link>
        </div>
        <div class="divide-y divide-gray-100 dark:divide-gray-700/50">
          <div v-if="activityFeed.length === 0" class="px-6 py-12 text-center">
            <Clock class="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p class="text-gray-500 dark:text-gray-400 text-sm">{{ $t('dashboard.noActivity') }}</p>
          </div>
          <div
            v-for="(entry, idx) in activityFeed"
            :key="entry.id || idx"
            class="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
          >
            <!-- Event icon -->
            <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              :class="eventBadgeClasses(entry.eventType).replace('text-', 'bg-').split(' ').filter((c: string) => c.startsWith('bg-')).join(' ')"
              style="opacity: 0.6;"
            >
              <component :is="eventIcon(entry.eventType)" class="w-3.5 h-3.5" :class="eventBadgeClasses(entry.eventType).split(' ').filter((c: string) => c.startsWith('text-')).join(' ')" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm text-gray-900 dark:text-white truncate">
                <span class="font-medium">{{ entry.resourceName || entry.action }}</span>
                <span v-if="entry.description" class="text-gray-500 dark:text-gray-400"> &mdash; {{ entry.description }}</span>
              </p>
              <div class="flex items-center gap-2 mt-0.5">
                <span
                  :class="['inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider', eventBadgeClasses(entry.eventType)]"
                >
                  {{ formatEventType(entry.eventType) }}
                </span>
                <span v-if="entry.actorEmail" class="text-[11px] text-gray-400 dark:text-gray-500 truncate">{{ entry.actorEmail }}</span>
              </div>
            </div>
            <span class="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap shrink-0">{{ relativeTime(entry.createdAt) }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
