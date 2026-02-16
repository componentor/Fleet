<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { LayoutDashboard, Box, Globe, HardDrive, DollarSign, Activity, Loader2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useServicesStore } from '@/stores/services'

const api = useApi()
const servicesStore = useServicesStore()

const domains = ref<any[]>([])
const loading = ref(true)

const runningCount = computed(() =>
  servicesStore.services.filter((s: any) => s.status === 'running').length
)

const stats = computed(() => [
  { label: 'Running Services', value: String(runningCount.value), icon: Box, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
  { label: 'Domains', value: String(domains.value.length), icon: Globe, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  { label: 'Total Services', value: String(servicesStore.services.length), icon: HardDrive, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  { label: 'Monthly Cost', value: '$0', icon: DollarSign, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
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

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([
      servicesStore.fetchServices(),
      api.get<any[]>('/dns/zones').then(data => { domains.value = data }).catch(() => {}),
    ])
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <LayoutDashboard class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <template v-else>
      <!-- Stat cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div
          v-for="stat in stats"
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

      <!-- Recent services -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <Activity class="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Recent Services</h2>
        </div>
        <div class="divide-y divide-gray-200 dark:divide-gray-700">
          <div v-if="recentServices.length === 0" class="px-6 py-12 text-center">
            <p class="text-gray-500 dark:text-gray-400 text-sm">No services yet. Deploy your first service to get started.</p>
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
                  'w-2.5 h-2.5 rounded-full',
                  svc.status === 'running' ? 'bg-green-500' :
                  svc.status === 'stopped' || svc.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'
                ]"
              ></span>
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">{{ svc.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ svc.image }}</p>
              </div>
            </div>
            <div class="flex items-center gap-3">
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
    </template>
  </div>
</template>
