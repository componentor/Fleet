<script setup lang="ts">
import { LayoutDashboard, Users, Server, Activity, DollarSign } from 'lucide-vue-next'

const stats = [
  { label: 'Total Accounts', value: '0', icon: Users, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  { label: 'Active Services', value: '0', icon: Activity, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
  { label: 'Nodes Online', value: '0', icon: Server, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  { label: 'Revenue', value: '$0', icon: DollarSign, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
]
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <LayoutDashboard class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
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

    <!-- Recent activity + Quick actions -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Recent Activity</h2>
        </div>
        <div class="p-6">
          <p class="text-gray-500 dark:text-gray-400 text-sm text-center py-8">No recent activity</p>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">System Health</h2>
        </div>
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-600 dark:text-gray-400">CPU Usage</span>
            <div class="flex items-center gap-2">
              <div class="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full bg-green-500 rounded-full" style="width: 0%"></div>
              </div>
              <span class="text-sm font-medium text-gray-900 dark:text-white">0%</span>
            </div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-600 dark:text-gray-400">Memory Usage</span>
            <div class="flex items-center gap-2">
              <div class="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full bg-blue-500 rounded-full" style="width: 0%"></div>
              </div>
              <span class="text-sm font-medium text-gray-900 dark:text-white">0%</span>
            </div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-600 dark:text-gray-400">Disk Usage</span>
            <div class="flex items-center gap-2">
              <div class="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full bg-purple-500 rounded-full" style="width: 0%"></div>
              </div>
              <span class="text-sm font-medium text-gray-900 dark:text-white">0%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
