<script setup lang="ts">
import { ref, onMounted, computed, nextTick } from 'vue'
import { LayoutDashboard, Users, Server, Activity, Loader2, ArrowRight, AlertTriangle, Bug, Download, ArrowUpCircle } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const api = useApi()
const loading = ref(true)
const stats = ref<any>(null)
const recentLogs = ref<any[]>([])
const versionInfo = ref<{ current: string; latest: string | null; updateAvailable: boolean; checkedAt: string | null } | null>(null)

// Animated count-up values
const animatedAccounts = ref(0)
const animatedNodes = ref(0)
const animatedUsers = ref(0)
const animatedRunning = ref(0)
const animatedServices = ref(0)

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

async function fetchStats() {
  loading.value = true
  try {
    const [statsData, logData] = await Promise.all([
      api.get<any>('/admin/stats'),
      api.get<any>('/admin/audit-log?limit=10').catch(() => ({ data: [] })),
    ])
    stats.value = statsData
    recentLogs.value = logData?.data ?? []
    versionInfo.value = statsData?.version ?? null
    // Trigger count-up animations
    await nextTick()
    animateValue(animatedAccounts, statsData?.accounts ?? 0)
    animateValue(animatedRunning, statsData?.runningServices ?? 0, 900)
    animateValue(animatedServices, statsData?.services ?? 0, 900)
    animateValue(animatedNodes, statsData?.nodes ?? 0, 1000)
    animateValue(animatedUsers, statsData?.users ?? 0, 1100)
  } catch {
    stats.value = null
  } finally {
    loading.value = false
  }
}

const errorStats = computed(() => stats.value?.errors ?? { unresolved: 0, last24h: 0, fatal: 0 })

const statCards = computed(() => [
  { label: t('super.dashboard.totalAccounts'), value: String(animatedAccounts.value), icon: Users, color: 'text-white', bg: 'bg-gradient-to-br from-orange-500 to-red-600', link: '/admin/accounts' },
  { label: t('super.dashboard.activeServices'), value: `${animatedRunning.value} / ${animatedServices.value}`, icon: Activity, color: 'text-white', bg: 'bg-gradient-to-br from-green-500 to-emerald-600', link: '/admin/services' },
  { label: t('super.dashboard.nodes'), value: String(animatedNodes.value), icon: Server, color: 'text-white', bg: 'bg-gradient-to-br from-slate-700 to-gray-900', link: '/admin/nodes' },
  { label: t('super.dashboard.users'), value: String(animatedUsers.value), icon: Users, color: 'text-white', bg: 'bg-gradient-to-br from-amber-500 to-orange-600', link: '/admin/users' },
])

function formatDate(ts: any) {
  if (!ts) return '--'
  const d = new Date(ts)
  return d.toLocaleString()
}

function timeAgo(ts: any) {
  if (!ts) return ''
  const now = Date.now()
  const diff = now - new Date(ts).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

function eventColor(eventType: string | null | undefined) {
  if (!eventType) return 'border-gray-300 dark:border-gray-600'
  if (eventType.includes('deleted') || eventType.includes('removed')) return 'border-red-400 dark:border-red-500'
  if (eventType.startsWith('service.') || eventType.startsWith('deployment.')) return 'border-blue-400 dark:border-blue-500'
  if (eventType.startsWith('user.') || eventType.startsWith('account.')) return 'border-purple-400 dark:border-purple-500'
  if (eventType.startsWith('dns.') || eventType.startsWith('backup.')) return 'border-green-400 dark:border-green-500'
  return 'border-gray-300 dark:border-gray-600'
}

onMounted(() => {
  fetchStats()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <LayoutDashboard class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('super.dashboard.title') }}</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <template v-else>
      <!-- Stat cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <RouterLink
          v-for="stat in statCards"
          :key="stat.label"
          :to="stat.link"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
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
        </RouterLink>
      </div>

      <!-- Swarm status -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8 transition-all duration-200 hover:shadow-md">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.dashboard.swarmStatus') }}</h2>
        </div>
        <div class="p-6">
          <div v-if="stats?.swarm" class="flex flex-wrap gap-x-10 gap-y-3 min-w-0">
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('super.dashboard.status') }}:</span>
              <span class="inline-flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-green-500"></span>
                <span class="text-sm font-medium text-gray-900 dark:text-white">{{ $t('super.dashboard.connected') }}</span>
              </span>
            </div>
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <span class="text-sm text-gray-600 dark:text-gray-400 shrink-0">{{ $t('super.dashboard.swarmId') }}:</span>
              <span class="text-sm font-mono text-gray-900 dark:text-white truncate" :title="stats.swarm.id">{{ stats.swarm.id }}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('super.dashboard.created') }}:</span>
              <span class="text-sm text-gray-900 dark:text-white">{{ formatDate(stats.swarm.createdAt) }}</span>
            </div>
          </div>
          <div v-else class="text-center py-4">
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('super.dashboard.swarmNotConnected') }}</p>
          </div>
        </div>
      </div>

      <!-- Version + Issues row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <!-- Version / Update card -->
        <div v-if="versionInfo" class="bg-white dark:bg-gray-800 rounded-xl border shadow-sm p-5 transition-all duration-200 hover:shadow-md"
          :class="versionInfo.updateAvailable
            ? 'border-primary-300 dark:border-primary-700'
            : 'border-gray-200 dark:border-gray-700'"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
              <div :class="[versionInfo.updateAvailable ? 'bg-primary-50 dark:bg-primary-900/20' : 'bg-gray-50 dark:bg-gray-700', 'p-3 rounded-lg']">
                <ArrowUpCircle v-if="versionInfo.updateAvailable" class="w-6 h-6 text-primary-600 dark:text-primary-400" />
                <Download v-else class="w-6 h-6 text-gray-500 dark:text-gray-400" />
              </div>
              <div>
                <p class="text-sm font-semibold text-gray-900 dark:text-white">
                  Fleet v{{ versionInfo.current }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  <template v-if="versionInfo.updateAvailable">
                    <span class="text-primary-600 dark:text-primary-400 font-medium">{{ versionInfo.latest }} available</span>
                  </template>
                  <template v-else>
                    Up to date
                  </template>
                </p>
              </div>
            </div>
            <RouterLink
              to="/admin/updates"
              class="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="versionInfo.updateAvailable
                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/40'
                : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'"
            >
              <Download class="w-4 h-4" />
              {{ versionInfo.updateAvailable ? 'Update Now' : 'Updates' }}
            </RouterLink>
          </div>
        </div>

        <!-- Error/Issues card -->
        <div v-if="errorStats.unresolved > 0" class="bg-white dark:bg-gray-800 rounded-xl border shadow-sm p-5 transition-all duration-200 hover:shadow-md"
          :class="errorStats.fatal > 0
            ? 'border-red-300 dark:border-red-700'
            : 'border-yellow-300 dark:border-yellow-700'"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
              <div :class="[errorStats.fatal > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-yellow-50 dark:bg-yellow-900/20', 'p-3 rounded-lg']">
                <AlertTriangle :class="[errorStats.fatal > 0 ? 'text-red-600 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400', 'w-6 h-6']" />
              </div>
              <div>
                <p class="text-sm font-semibold text-gray-900 dark:text-white">
                  {{ t('super.dashboard.unresolvedIssues', { count: errorStats.unresolved }) }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  <span v-if="errorStats.fatal > 0" class="text-red-600 dark:text-red-400 font-medium mr-2">{{ t('super.dashboard.fatalCount', { count: errorStats.fatal }) }}</span>
                  {{ t('super.dashboard.last24h', { count: errorStats.last24h }) }}
                </p>
              </div>
            </div>
            <RouterLink to="/admin/errors" class="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="errorStats.fatal > 0
                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40'
                : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-900/40'"
            >
              <Bug class="w-4 h-4" />
              {{ t('super.dashboard.viewErrors') }}
            </RouterLink>
          </div>
        </div>
      </div>

      <!-- Recent activity -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.dashboard.recentActivity') }}</h2>
          <RouterLink to="/admin/events" class="text-sm text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 shrink-0">
            {{ $t('super.dashboard.viewAll') }}
            <ArrowRight class="w-3.5 h-3.5" />
          </RouterLink>
        </div>
        <div v-if="recentLogs.length === 0" class="text-center py-8">
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('super.dashboard.noRecentActivity') }}</p>
        </div>
        <ul v-else class="divide-y divide-gray-100 dark:divide-gray-700/50">
          <li v-for="log in recentLogs" :key="log.id" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
            <div :class="['px-5 py-3 border-l-3', eventColor(log.eventType)]">
            <div class="flex items-baseline justify-between gap-3 min-w-0">
              <span class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 truncate min-w-0">
                {{ log.eventType?.split('.').pop() ?? log.action }}
              </span>
              <span class="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap shrink-0" :title="formatDate(log.createdAt)">{{ timeAgo(log.createdAt) }}</span>
            </div>
            <p class="text-sm text-gray-900 dark:text-white mt-0.5 truncate" :title="log.description ?? `${log.resourceType} ${log.resourceName || log.resourceId?.slice(0, 8) || ''}`">{{ log.description ?? `${log.resourceType} ${log.resourceName || log.resourceId?.slice(0, 8) || ''}` }}</p>
            <p v-if="log.actorEmail" class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{{ log.actorEmail }}</p>
            </div>
          </li>
        </ul>
      </div>

    </template>
  </div>
</template>
