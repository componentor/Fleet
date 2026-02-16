<script setup lang="ts">
import { ref } from 'vue'
import { Server, Plus, RefreshCw } from 'lucide-vue-next'

const nodes = ref<any[]>([])
const loading = ref(false)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Server class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Swarm Nodes</h1>
      </div>
      <div class="flex items-center gap-3">
        <button
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
        >
          <RefreshCw class="w-4 h-4" />
          Refresh
        </button>
        <button
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Plus class="w-4 h-4" />
          Add Node
        </button>
      </div>
    </div>

    <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Hostname</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">IP</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Role</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Containers</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Heartbeat</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="nodes.length === 0">
              <td colspan="6" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                No nodes registered yet. Add your first node to get started.
              </td>
            </tr>
            <tr
              v-for="node in nodes"
              :key="node.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
            >
              <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ node.hostname }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 font-mono">{{ node.ip }}</td>
              <td class="px-6 py-4 text-sm">
                <span
                  :class="[
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    node.role === 'manager'
                      ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  ]"
                >
                  {{ node.role }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm">
                <span class="flex items-center gap-1.5">
                  <span
                    :class="[
                      'w-2 h-2 rounded-full',
                      node.status === 'ready' ? 'bg-green-500' : 'bg-red-500'
                    ]"
                  ></span>
                  {{ node.status }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ node.containers }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ node.lastHeartbeat }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
