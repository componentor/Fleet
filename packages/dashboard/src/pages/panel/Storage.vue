<script setup lang="ts">
import { ref } from 'vue'
import { HardDrive, Plus } from 'lucide-vue-next'

const volumes = ref<any[]>([])
const loading = ref(false)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <HardDrive class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Storage</h1>
      </div>
      <button
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        Create Volume
      </button>
    </div>

    <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Size</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Node</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Mount Path</th>
              <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="volumes.length === 0">
              <td colspan="5" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                No storage volumes created yet.
              </td>
            </tr>
            <tr
              v-for="volume in volumes"
              :key="volume.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
            >
              <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ volume.name }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ volume.size }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ volume.node }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 font-mono">{{ volume.mountPath }}</td>
              <td class="px-6 py-4 text-right">
                <button class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
