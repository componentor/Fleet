<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Layers, Search, ExternalLink } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const api = useApi()
const router = useRouter()

const loading = ref(true)
const searchQuery = ref('')
const allServices = ref<any[]>([])

const filteredServices = computed(() => {
  if (!searchQuery.value) return allServices.value
  const q = searchQuery.value.toLowerCase()
  return allServices.value.filter(
    (s) =>
      s.name?.toLowerCase().includes(q) ||
      s.image?.toLowerCase().includes(q) ||
      s.accountName?.toLowerCase().includes(q) ||
      s.domain?.toLowerCase().includes(q),
  )
})

const stats = computed(() => ({
  total: allServices.value.length,
  running: allServices.value.filter((s) => s.status === 'running').length,
  stopped: allServices.value.filter((s) => s.status === 'stopped').length,
  failed: allServices.value.filter((s) => s.status === 'failed').length,
  deploying: allServices.value.filter((s) => s.status === 'deploying').length,
}))

async function fetchServices() {
  loading.value = true
  try {
    const res = await api.get<{ data: any[]; pagination: any }>('/admin/services?limit=100')
    allServices.value = res.data.map((svc: any) => ({
      ...svc,
      accountName: svc.account?.name ?? svc.account?.slug ?? svc.accountId,
    }))
  } catch {
    allServices.value = []
  } finally {
    loading.value = false
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'running':
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    case 'stopped':
      return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
    case 'failed':
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    case 'deploying':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    default:
      return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
  }
}

onMounted(() => {
  fetchServices()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Layers class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('super.services.title') }}</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <div v-else class="space-y-6">
      <!-- Stats -->
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
          <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('super.services.total') }}</p>
          <p class="text-2xl font-bold text-gray-900 dark:text-white mt-1">{{ stats.total }}</p>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
          <p class="text-xs font-medium text-green-600 dark:text-green-400 uppercase">{{ t('super.services.running') }}</p>
          <p class="text-2xl font-bold text-gray-900 dark:text-white mt-1">{{ stats.running }}</p>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
          <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('super.services.stopped') }}</p>
          <p class="text-2xl font-bold text-gray-900 dark:text-white mt-1">{{ stats.stopped }}</p>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
          <p class="text-xs font-medium text-red-600 dark:text-red-400 uppercase">{{ t('super.services.failed') }}</p>
          <p class="text-2xl font-bold text-gray-900 dark:text-white mt-1">{{ stats.failed }}</p>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
          <p class="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase">{{ t('super.services.deploying') }}</p>
          <p class="text-2xl font-bold text-gray-900 dark:text-white mt-1">{{ stats.deploying }}</p>
        </div>
      </div>

      <!-- Search -->
      <div class="relative max-w-md">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('super.services.searchPlaceholder')"
          class="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
        />
      </div>

      <!-- Services table -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div v-if="filteredServices.length === 0" class="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
          {{ searchQuery ? t('super.services.noMatch') : t('super.services.noServices') }}
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('super.services.service') }}</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('super.services.account') }}</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('super.services.image') }}</th>
                <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('super.services.status') }}</th>
                <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('super.services.replicas') }}</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('super.services.domain') }}</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('super.services.created') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-for="svc in filteredServices" :key="svc.id" class="hover:bg-gray-50 dark:hover:bg-gray-750">
                <td class="px-4 py-3">
                  <span class="text-sm font-medium text-gray-900 dark:text-white">{{ svc.name }}</span>
                </td>
                <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{{ svc.accountName }}</td>
                <td class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 font-mono truncate max-w-[200px]">{{ svc.image }}</td>
                <td class="px-4 py-3 text-center">
                  <span :class="['text-xs font-medium px-2 py-0.5 rounded-full', statusColor(svc.status)]">
                    {{ svc.status }}
                  </span>
                </td>
                <td class="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-400">{{ svc.replicas ?? 1 }}</td>
                <td class="px-4 py-3">
                  <a v-if="svc.domain" :href="`https://${svc.domain}`" target="_blank" class="text-sm text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1">
                    {{ svc.domain }}
                    <ExternalLink class="w-3 h-3" />
                  </a>
                  <span v-else class="text-sm text-gray-400 dark:text-gray-500">-</span>
                </td>
                <td class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                  {{ svc.createdAt ? new Date(svc.createdAt).toLocaleDateString() : '-' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
