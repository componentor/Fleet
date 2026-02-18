<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Box, Plus, ArrowRight, Loader2, ChevronDown, ChevronRight, Layers } from 'lucide-vue-next'
import { useServicesStore } from '@/stores/services'
import { useRole } from '@/composables/useRole'

const { t } = useI18n()

const store = useServicesStore()
const { canWrite } = useRole()

const collapsedStacks = ref<Set<string>>(new Set())

function statusColor(status: string) {
  switch (status) {
    case 'running': return 'bg-green-500'
    case 'deploying': return 'bg-yellow-500'
    case 'stopped': return 'bg-gray-400'
    case 'failed': return 'bg-red-500'
    default: return 'bg-gray-400'
  }
}

function statusBadge(status: string) {
  switch (status) {
    case 'running': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    case 'deploying': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
    case 'stopped': return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
    case 'failed': return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    default: return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }
}

// Group services by stackId
const groupedServices = computed(() => {
  const stacks = new Map<string, any[]>()
  const standalone: any[] = []

  for (const svc of store.services) {
    if (svc.stackId) {
      const group = stacks.get(svc.stackId) || []
      group.push(svc)
      stacks.set(svc.stackId, group)
    } else {
      standalone.push(svc)
    }
  }

  const groups: { stackId: string; services: any[] }[] = []
  for (const [stackId, svcs] of stacks) {
    groups.push({ stackId, services: svcs })
  }

  return { groups, standalone }
})

function toggleStack(stackId: string) {
  if (collapsedStacks.value.has(stackId)) {
    collapsedStacks.value.delete(stackId)
  } else {
    collapsedStacks.value.add(stackId)
  }
}

function stackName(svcs: any[]) {
  if (svcs.length === 1) return svcs[0].name
  return svcs.map(s => s.name).join(' + ')
}

function stackStatus(svcs: any[]) {
  if (svcs.some(s => s.status === 'failed')) return 'failed'
  if (svcs.some(s => s.status === 'deploying')) return 'deploying'
  if (svcs.every(s => s.status === 'running')) return 'running'
  if (svcs.every(s => s.status === 'stopped')) return 'stopped'
  return 'running'
}

onMounted(() => {
  store.fetchServices()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Box class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('services.title') }}</h1>
      </div>
      <router-link
        v-if="canWrite"
        to="/panel/deploy"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        {{ $t('services.deployNew') }}
      </router-link>
    </div>

    <!-- Loading state -->
    <div v-if="store.loading && store.services.length === 0" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <!-- Empty state -->
    <div v-else-if="store.services.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <Box class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
      <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">{{ $t('services.noServices') }}</h3>
      <p class="text-gray-500 dark:text-gray-400 text-sm mb-6">{{ $t('services.noServicesDesc') }}</p>
      <router-link
        v-if="canWrite"
        to="/panel/deploy"
        class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        {{ $t('services.deployNewService') }}
      </router-link>
    </div>

    <div v-else class="space-y-6">
      <!-- Stack groups -->
      <div
        v-for="group in groupedServices.groups"
        :key="group.stackId"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
      >
        <!-- Stack header -->
        <button
          @click="toggleStack(group.stackId)"
          class="flex items-center justify-between w-full px-5 py-3.5 bg-gray-50 dark:bg-gray-750 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <div class="flex items-center gap-3">
            <Layers class="w-4 h-4 text-primary-600 dark:text-primary-400" />
            <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ stackName(group.services) }}</span>
            <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', statusBadge(stackStatus(group.services))]">
              {{ stackStatus(group.services) }}
            </span>
            <span class="text-xs text-gray-400 dark:text-gray-500">{{ group.services.length }} {{ $t('services.servicesInStack') }}</span>
          </div>
          <component :is="collapsedStacks.has(group.stackId) ? ChevronRight : ChevronDown" class="w-4 h-4 text-gray-400" />
        </button>

        <!-- Stack services -->
        <div v-if="!collapsedStacks.has(group.stackId)" class="divide-y divide-gray-100 dark:divide-gray-700">
          <router-link
            v-for="service in group.services"
            :key="service.id"
            :to="`/panel/services/${service.id}`"
            class="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors group"
          >
            <div class="flex items-center gap-3 min-w-0">
              <span :class="[statusColor(service.status), 'w-2 h-2 rounded-full shrink-0']"></span>
              <div class="min-w-0">
                <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ service.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">{{ service.image }}</p>
              </div>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', statusBadge(service.status)]">
                {{ service.status }}
              </span>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ service.replicas ?? 1 }} {{ (service.replicas ?? 1) !== 1 ? $t('services.replicas') : $t('services.replica') }}
              </span>
              <ArrowRight class="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary-600 dark:text-primary-400" />
            </div>
          </router-link>
        </div>
      </div>

      <!-- Standalone services (no stack) -->
      <div v-if="groupedServices.standalone.length > 0" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <router-link
          v-for="service in groupedServices.standalone"
          :key="service.id"
          :to="`/panel/services/${service.id}`"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow overflow-hidden group"
        >
          <div class="p-6">
            <div class="flex items-start justify-between mb-3">
              <div class="flex items-center gap-3">
                <div class="flex items-center gap-2">
                  <span :class="[statusColor(service.status), 'w-2.5 h-2.5 rounded-full']"></span>
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ service.name }}</h3>
                </div>
              </div>
              <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', statusBadge(service.status)]">
                {{ service.status }}
              </span>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 font-mono mb-3">{{ service.image }}</p>
            <div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <div>
                <span>{{ service.replicas ?? 1 }} {{ (service.replicas ?? 1) !== 1 ? $t('services.replicas') : $t('services.replica') }}</span>
                <span v-if="service.status === 'stopped'" class="ml-2 text-gray-400 dark:text-gray-500">{{ $t('services.notBilled') }}</span>
              </div>
              <ArrowRight class="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary-600 dark:text-primary-400" />
            </div>
          </div>
        </router-link>
      </div>
    </div>
  </div>
</template>
