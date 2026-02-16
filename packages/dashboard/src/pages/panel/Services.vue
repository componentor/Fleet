<script setup lang="ts">
import { ref } from 'vue'
import { Box, Plus, ArrowRight } from 'lucide-vue-next'

const services = ref<any[]>([])
const loading = ref(false)

function statusColor(status: string) {
  switch (status) {
    case 'running': return 'bg-green-500'
    case 'deploying': return 'bg-yellow-500'
    case 'stopped': return 'bg-red-500'
    default: return 'bg-gray-400'
  }
}

function statusBadge(status: string) {
  switch (status) {
    case 'running': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    case 'deploying': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
    case 'stopped': return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    default: return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Box class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Services</h1>
      </div>
      <router-link
        to="/panel/deploy"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        Deploy New
      </router-link>
    </div>

    <!-- Empty state -->
    <div v-if="services.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <Box class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
      <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">No services yet</h3>
      <p class="text-gray-500 dark:text-gray-400 text-sm mb-6">Deploy your first service to get started.</p>
      <router-link
        to="/panel/deploy"
        class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        Deploy New Service
      </router-link>
    </div>

    <!-- Service cards grid -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <router-link
        v-for="service in services"
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
            <span>{{ service.cpu }} CPU / {{ service.memory }} RAM</span>
            <ArrowRight class="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary-600 dark:text-primary-400" />
          </div>
        </div>
      </router-link>
    </div>
  </div>
</template>
