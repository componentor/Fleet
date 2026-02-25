<script setup lang="ts">
import { ref, onMounted, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Box, Globe, HardDrive, DollarSign, Activity, Loader2, Clock,
  Rocket, Sun, Moon, Sunset, CheckCircle, Wifi, Container,
  Sparkles, ArrowRight, Cpu, MemoryStick,
} from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useServicesStore } from '@/stores/services'
import { useAccount } from '@/composables/useAccount'
import { useAuth } from '@/composables/useAuth'
import ResourceGauge from '@/components/ResourceGauge.vue'

const { t } = useI18n()
const api = useApi()
const servicesStore = useServicesStore()
const { currentAccount } = useAccount()
const { user } = useAuth()

const domains = ref<any[]>([])
const activityFeed = ref<any[]>([])
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

// Resource gauges — always shown, 0% when no limit configured
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
    // Services uptime
    {
      label: t('dashboard.servicesUptime'),
      value: hb.total > 0 ? Math.round((hb.running / hb.total) * 100) : 0,
      icon: Activity,
      highIsGood: true,
      detail: `${hb.running} / ${hb.total}`,
    },
    // Containers
    {
      label: t('dashboard.containers'),
      value: pctOf(usage?.runningContainers ?? 0, limits?.maxContainers),
      icon: Container,
      detail: detailStr(usage?.runningContainers ?? 0, limits?.maxContainers, ''),
    },
    // CPU allocated
    {
      label: t('dashboard.cpuAllocated'),
      value: pctOf(allocatedCpu.value, limits?.maxTotalCpuCores),
      icon: Cpu,
      detail: detailStr(allocatedCpu.value, limits?.maxTotalCpuCores, 'cores'),
    },
    // Memory allocated
    {
      label: t('dashboard.memoryAllocated'),
      value: pctOf(allocatedMemoryMb.value, limits?.maxTotalMemoryMb),
      icon: MemoryStick,
      detail: detailStr(allocatedMemoryMb.value, limits?.maxTotalMemoryMb, 'MB'),
    },
    // Storage
    {
      label: t('dashboard.storage'),
      value: quota && quota.limitGb > 0 ? pctOf(quota.usedGb, quota.limitGb) : 0,
      icon: HardDrive,
      detail: detailStr(quota?.usedGb ?? 0, quota?.limitGb, 'GB'),
    },
    // Bandwidth
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
  { label: t('dashboard.runningServices'), value: String(animatedRunning.value), icon: Box, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', to: '/panel/services' },
  { label: t('dashboard.totalServices'), value: String(animatedTotal.value), icon: HardDrive, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20', to: '/panel/services' },
  { label: t('dashboard.domains'), value: String(animatedDomains.value), icon: Globe, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', to: '/panel/domains' },
  { label: t('dashboard.estimatedCost'), value: formattedCost.value, icon: DollarSign, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20', to: '/panel/billing' },
])

const recentServices = computed(() =>
  [...servicesStore.services].sort((a: any, b: any) => {
    const ta = a.updatedAt ?? a.createdAt ?? 0
    const tb = b.updatedAt ?? b.createdAt ?? 0
    return (typeof tb === 'number' ? tb : new Date(tb).getTime()) - (typeof ta === 'number' ? ta : new Date(ta).getTime())
  }).slice(0, 5)
)

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

// Health bar segment width
function healthWidth(count: number) {
  if (healthBreakdown.value.total === 0) return '0%'
  return `${(count / healthBreakdown.value.total) * 100}%`
}

onMounted(async () => {
  // Check for welcome flag (stays visible for the session)
  if (sessionStorage.getItem('fleet_just_logged_in')) {
    sessionStorage.removeItem('fleet_just_logged_in')
    showWelcome.value = true
  }

  loading.value = true
  try {
    await Promise.all([
      servicesStore.fetchServices(),
      api.get<any[]>('/dns/zones').then(data => { domains.value = data }).catch(() => {}),
      currentAccount.value?.id
        ? api.get<any>(`/accounts/${currentAccount.value.id}/activity?limit=20`)
            .then(data => {
              // Only show semantic events (with eventType), not raw HTTP audit entries
              const entries = (data?.data ?? []) as any[]
              activityFeed.value = entries.filter((e: any) => e.eventType).slice(0, 10)
            })
            .catch(() => {})
        : Promise.resolve(),
      // Real resource usage data
      api.get<{ usedGb: number; limitGb: number }>('/storage/volumes/quota')
        .then(data => { storageQuota.value = data })
        .catch(() => {}),
      api.get<any>('/billing/usage')
        .then(data => { billingUsage.value = data })
        .catch(() => {}),
      api.get<any>('/billing/resource-limits')
        .then(data => { resourceLimits.value = data })
        .catch(() => {}),
    ])
    // Trigger count-up animations after data loads
    await nextTick()
    animateValue(animatedRunning, runningCount.value)
    animateValue(animatedDomains, domains.value.length, 900)
    animateValue(animatedTotal, servicesStore.services.length, 1000)
    animateValue(animatedCost, billingUsage.value?.estimatedCostCents ?? 0, 1100)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="stagger-children">
    <!-- Greeting -->
    <div class="flex items-center gap-3 mb-6">
      <component :is="greetingIcon" class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ greeting }}</h1>
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

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <template v-else>
      <!-- Empty state (no services at all) -->
      <div v-if="servicesStore.services.length === 0 && domains.length === 0" class="text-center py-16">
        <div class="mx-auto w-16 h-16 rounded-2xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center mb-4">
          <Rocket class="w-8 h-8 text-primary-500" />
        </div>
        <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">{{ $t('dashboard.deployFirst') }}</h2>
        <p class="text-gray-500 dark:text-gray-400 text-sm mb-6 max-w-md mx-auto">{{ $t('dashboard.getStarted') }}</p>
        <router-link
          to="/panel/deploy"
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors shadow-sm"
        >
          <Rocket class="w-4 h-4" />
          {{ $t('services.deployNew') }}
          <ArrowRight class="w-4 h-4" />
        </router-link>
      </div>

      <template v-else>
        <!-- Stat cards (clickable) -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <router-link
            v-for="stat in stats"
            :key="stat.label"
            :to="stat.to"
            class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:border-primary-200 dark:hover:border-primary-800 block"
          >
            <div class="flex items-center gap-4">
              <div :class="[stat.bg, 'p-3 rounded-lg']">
                <component :is="stat.icon" :class="[stat.color, 'w-6 h-6']" />
              </div>
              <div>
                <p class="text-sm font-medium text-gray-600 dark:text-gray-400">{{ stat.label }}</p>
                <p class="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{{ stat.value }}</p>
              </div>
            </div>
          </router-link>
        </div>

        <!-- Services health bar -->
        <div v-if="healthBreakdown.total > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 mb-8 transition-all duration-200 hover:shadow-md">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ $t('dashboard.servicesHealth') }}</h3>
            <div v-if="allHealthy" class="flex items-center gap-1.5 text-green-600 dark:text-green-400">
              <CheckCircle class="w-4 h-4" />
              <span class="text-xs font-medium">{{ $t('dashboard.allHealthy') }}</span>
            </div>
          </div>
          <!-- Segmented bar -->
          <div class="h-3 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden flex">
            <div
              v-if="healthBreakdown.running > 0"
              class="bg-green-500 transition-all duration-700 ease-out"
              :style="{ width: healthWidth(healthBreakdown.running) }"
            />
            <div
              v-if="healthBreakdown.deploying > 0"
              class="bg-yellow-500 transition-all duration-700 ease-out"
              :style="{ width: healthWidth(healthBreakdown.deploying) }"
            />
            <div
              v-if="healthBreakdown.stopped > 0"
              class="bg-gray-400 dark:bg-gray-500 transition-all duration-700 ease-out"
              :style="{ width: healthWidth(healthBreakdown.stopped) }"
            />
            <div
              v-if="healthBreakdown.failed > 0"
              class="bg-red-500 transition-all duration-700 ease-out"
              :style="{ width: healthWidth(healthBreakdown.failed) }"
            />
          </div>
          <!-- Legend -->
          <div class="flex flex-wrap gap-4 mt-3">
            <div v-if="healthBreakdown.running > 0" class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-green-500"></span>
              <span class="text-xs text-gray-600 dark:text-gray-400">{{ $t('dashboard.running') }} ({{ healthBreakdown.running }})</span>
            </div>
            <div v-if="healthBreakdown.deploying > 0" class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-yellow-500"></span>
              <span class="text-xs text-gray-600 dark:text-gray-400">{{ $t('dashboard.deploying') }} ({{ healthBreakdown.deploying }})</span>
            </div>
            <div v-if="healthBreakdown.stopped > 0" class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-gray-400 dark:bg-gray-500"></span>
              <span class="text-xs text-gray-600 dark:text-gray-400">{{ $t('dashboard.stopped') }} ({{ healthBreakdown.stopped }})</span>
            </div>
            <div v-if="healthBreakdown.failed > 0" class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-red-500"></span>
              <span class="text-xs text-gray-600 dark:text-gray-400">{{ $t('dashboard.failed') }} ({{ healthBreakdown.failed }})</span>
            </div>
          </div>
        </div>

        <!-- Resource usage gauges -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 mb-8 transition-all duration-200 hover:shadow-md">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">{{ $t('dashboard.resourceUsage') }}</h3>
          <div class="flex flex-wrap justify-center sm:justify-start gap-8">
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

        <!-- Quick actions -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <router-link
            to="/panel/deploy"
            class="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-sm transition-all duration-200 group"
          >
            <Rocket class="w-5 h-5 text-gray-400 group-hover:text-primary-500 transition-colors" />
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">{{ $t('services.deployNew', 'Deploy') }}</span>
          </router-link>
          <router-link
            to="/panel/services"
            class="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-sm transition-all duration-200 group"
          >
            <Box class="w-5 h-5 text-gray-400 group-hover:text-primary-500 transition-colors" />
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">{{ $t('nav.services', 'Services') }}</span>
          </router-link>
          <router-link
            to="/panel/domains"
            class="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-sm transition-all duration-200 group"
          >
            <Globe class="w-5 h-5 text-gray-400 group-hover:text-primary-500 transition-colors" />
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">{{ $t('nav.domains', 'Domains') }}</span>
          </router-link>
          <router-link
            to="/panel/marketplace"
            class="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-sm transition-all duration-200 group"
          >
            <Container class="w-5 h-5 text-gray-400 group-hover:text-primary-500 transition-colors" />
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">{{ $t('nav.marketplace', 'Marketplace') }}</span>
          </router-link>
        </div>

        <!-- Recent services -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm transition-all duration-200 hover:shadow-md">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Activity class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('dashboard.recentServices') }}</h2>
          </div>
          <div class="divide-y divide-gray-200 dark:divide-gray-700">
            <div v-if="recentServices.length === 0" class="px-6 py-12 text-center">
              <p class="text-gray-500 dark:text-gray-400 text-sm">{{ $t('dashboard.noServicesYet') }}</p>
            </div>
            <router-link
              v-for="svc in recentServices"
              :key="svc.id"
              :to="`/panel/services/${svc.id}`"
              class="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors block"
            >
              <div class="flex items-center gap-3">
                <span
                  :class="[
                    'w-2.5 h-2.5 rounded-full shrink-0',
                    svc.status === 'running' ? 'bg-green-500 animate-pulse' :
                    svc.status === 'stopped' || svc.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'
                  ]"
                ></span>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ svc.name }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ svc.image }}</p>
                </div>
              </div>
              <div class="flex items-center gap-3 shrink-0 ml-4">
                <span
                  :class="[
                    'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                    svc.status === 'running' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                    svc.status === 'stopped' || svc.status === 'failed' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                    'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                  ]"
                >
                  {{ svc.status }}
                </span>
                <span class="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{{ formatDate(svc.updatedAt || svc.createdAt) }}</span>
              </div>
            </router-link>
          </div>
        </div>

        <!-- Recent Activity -->
        <div class="mt-8 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm transition-all duration-200 hover:shadow-md">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Clock class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('dashboard.recentActivity') }}</h2>
          </div>
          <div class="divide-y divide-gray-200 dark:divide-gray-700">
            <div v-if="activityFeed.length === 0" class="px-6 py-12 text-center">
              <p class="text-gray-500 dark:text-gray-400 text-sm">{{ $t('dashboard.noActivity') }}</p>
            </div>
            <div
              v-for="(entry, idx) in activityFeed"
              :key="entry.id || idx"
              class="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
            >
              <div class="flex items-center gap-3 min-w-0">
                <span
                  :class="[
                    'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0',
                    eventBadgeClasses(entry.eventType)
                  ]"
                >
                  {{ formatEventType(entry.eventType) }}
                </span>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ entry.resourceName || entry.description || entry.action }}</p>
                  <p v-if="entry.actorEmail" class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{{ entry.actorEmail }}</p>
                </div>
              </div>
              <span class="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap ml-4">{{ formatTimestamp(entry.createdAt) }}</span>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
