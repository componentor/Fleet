<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { LayoutDashboard, Users, Server, Activity, Loader2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const api = useApi()
const loading = ref(true)
const stats = ref<any>(null)
const recentLogs = ref<any[]>([])

async function fetchStats() {
  loading.value = true
  try {
    const [statsData, logData] = await Promise.all([
      api.get<any>('/admin/stats'),
      api.get<any>('/admin/audit-log?limit=10').catch(() => ({ data: [] })),
    ])
    stats.value = statsData
    recentLogs.value = logData?.data ?? []
  } catch {
    stats.value = null
  } finally {
    loading.value = false
  }
}

const statCards = computed(() => [
  { label: t('super.dashboard.totalAccounts'), value: stats.value?.accounts ?? 0, icon: Users, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  { label: t('super.dashboard.activeServices'), value: `${stats.value?.runningServices ?? 0} / ${stats.value?.services ?? 0}`, icon: Activity, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
  { label: t('super.dashboard.nodes'), value: stats.value?.nodes ?? 0, icon: Server, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  { label: t('super.dashboard.users'), value: stats.value?.users ?? 0, icon: Users, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
])

function formatDate(ts: any) {
  if (!ts) return '--'
  const d = new Date(ts)
  return d.toLocaleString()
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
        <div
          v-for="stat in statCards"
          :key="stat.label"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6"
        >
          <div class="flex items-center gap-4">
            <div :class="[stat.bg, 'p-3 rounded-lg']">
              <component :is="stat.icon" :class="[stat.color, 'w-6 h-6']" />
            </div>
            <div>
              <p class="text-sm font-medium text-gray-600 dark:text-gray-400">{{ stat.label }}</p>
              <p class="text-2xl font-bold text-gray-900 dark:text-white">{{ stat.value }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Swarm info + Recent activity -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Swarm info -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.dashboard.swarmStatus') }}</h2>
          </div>
          <div class="p-6">
            <div v-if="stats?.swarm" class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('super.dashboard.status') }}</span>
                <span class="inline-flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-green-500"></span>
                  <span class="text-sm font-medium text-gray-900 dark:text-white">{{ $t('super.dashboard.connected') }}</span>
                </span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('super.dashboard.swarmId') }}</span>
                <span class="text-sm font-mono text-gray-900 dark:text-white">{{ stats.swarm.id?.slice(0, 12) }}...</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('super.dashboard.created') }}</span>
                <span class="text-sm text-gray-900 dark:text-white">{{ formatDate(stats.swarm.createdAt) }}</span>
              </div>
            </div>
            <div v-else class="text-center py-4">
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('super.dashboard.swarmNotConnected') }}</p>
            </div>
          </div>
        </div>

        <!-- Recent activity -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.dashboard.recentActivity') }}</h2>
          </div>
          <div class="p-6">
            <div v-if="recentLogs.length === 0" class="text-center py-4">
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('super.dashboard.noRecentActivity') }}</p>
            </div>
            <div v-else class="space-y-3">
              <div v-for="log in recentLogs" :key="log.id" class="flex items-start gap-3 text-sm">
                <span
                  :class="[
                    'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium shrink-0 mt-0.5',
                    log.action === 'create' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                    log.action === 'delete' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                    'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  ]"
                >
                  {{ log.action }}
                </span>
                <div class="min-w-0 flex-1">
                  <p class="text-gray-900 dark:text-white truncate">{{ log.resourceType }} {{ log.resourceId?.slice(0, 8) }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ formatDate(log.createdAt) }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Update notification -->
      <div v-if="stats?.updateAvailable" class="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <p class="text-sm text-blue-700 dark:text-blue-300">{{ stats.updateAvailable }}</p>
      </div>
    </template>
  </div>
</template>
