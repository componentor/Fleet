<script setup lang="ts">
import { ref } from 'vue'
import { ScrollText, Search, Filter } from 'lucide-vue-next'

const logs = ref<any[]>([])
const search = ref('')
const loading = ref(false)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <ScrollText class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Audit Log</h1>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-col sm:flex-row gap-3 mb-6">
      <div class="relative flex-1 max-w-md">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="search"
          type="text"
          placeholder="Search audit log..."
          class="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
        />
      </div>
      <button class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium">
        <Filter class="w-4 h-4" />
        Filters
      </button>
    </div>

    <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Time</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Account</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Resource</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">IP</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="logs.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                No audit log entries yet.
              </td>
            </tr>
            <tr
              v-for="log in logs"
              :key="log.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
            >
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{{ log.timestamp }}</td>
              <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ log.userName }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ log.accountName }}</td>
              <td class="px-6 py-4 text-sm">
                <span
                  :class="[
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    log.action === 'create' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                    log.action === 'delete' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                    log.action === 'update' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                    'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  ]"
                >
                  {{ log.action }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 font-mono">{{ log.resource }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 font-mono">{{ log.ip }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
