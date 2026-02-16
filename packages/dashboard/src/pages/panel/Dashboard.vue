<script setup lang="ts">
import { LayoutDashboard, Box, Globe, HardDrive, DollarSign, Activity } from 'lucide-vue-next'

const stats = [
  { label: 'Running Services', value: '0', icon: Box, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
  { label: 'Domains', value: '0', icon: Globe, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  { label: 'Storage Used', value: '0 GB', icon: HardDrive, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  { label: 'Monthly Cost', value: '$0', icon: DollarSign, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
]

const recentActivity = <{ id: number; action: string; resource: string; time: string }[]>[]
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <LayoutDashboard class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
    </div>

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

    <!-- Recent activity -->
    <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
      <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
        <Activity class="w-5 h-5 text-gray-500 dark:text-gray-400" />
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Recent Activity</h2>
      </div>
      <div class="divide-y divide-gray-200 dark:divide-gray-700">
        <div v-if="recentActivity.length === 0" class="px-6 py-12 text-center">
          <p class="text-gray-500 dark:text-gray-400 text-sm">No recent activity to show.</p>
        </div>
        <div
          v-for="event in recentActivity"
          :key="event.id"
          class="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
        >
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">{{ event.action }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ event.resource }}</p>
          </div>
          <span class="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{{ event.time }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
