<script setup lang="ts">
import { ref } from 'vue'
import { Shield, Plus, Trash2 } from 'lucide-vue-next'

const superUsers = ref<any[]>([])
const loading = ref(false)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Shield class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Super Users</h1>
      </div>
      <button
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        Add Super User
      </button>
    </div>

    <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Email</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Added</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Login</th>
              <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="superUsers.length === 0">
              <td colspan="5" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                No super users configured.
              </td>
            </tr>
            <tr
              v-for="user in superUsers"
              :key="user.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
            >
              <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ user.name }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ user.email }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ user.createdAt }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ user.lastLogin || 'Never' }}</td>
              <td class="px-6 py-4 text-right">
                <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <Trash2 class="w-3.5 h-3.5" />
                  Remove
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
