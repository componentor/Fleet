<script setup lang="ts">
import { ref } from 'vue'
import { Archive, RotateCw, Trash2, Plus, Clock } from 'lucide-vue-next'

const activeTab = ref<'backups' | 'schedules'>('backups')
const backups = ref<any[]>([])
const schedules = ref<any[]>([])
const loading = ref(false)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Archive class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Backups</h1>
      </div>
      <button
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        Create Backup
      </button>
    </div>

    <!-- Tabs -->
    <div class="border-b border-gray-200 dark:border-gray-700 mb-6">
      <nav class="flex gap-6 -mb-px">
        <button
          @click="activeTab = 'backups'"
          :class="[
            'pb-3 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'backups'
              ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
          ]"
        >
          Backups
        </button>
        <button
          @click="activeTab = 'schedules'"
          :class="[
            'pb-3 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'schedules'
              ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
          ]"
        >
          Schedules
        </button>
      </nav>
    </div>

    <!-- Backups list -->
    <div v-if="activeTab === 'backups'">
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Service</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Size</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-if="backups.length === 0">
                <td colspan="5" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No backups created yet.
                </td>
              </tr>
              <tr
                v-for="backup in backups"
                :key="backup.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
              >
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{{ backup.date }}</td>
                <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ backup.serviceName }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ backup.size }}</td>
                <td class="px-6 py-4 text-sm">
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      backup.status === 'completed'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        : backup.status === 'in-progress'
                        ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    ]"
                  >
                    {{ backup.status }}
                  </span>
                </td>
                <td class="px-6 py-4 text-right">
                  <div class="flex items-center justify-end gap-2">
                    <button class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors">
                      <RotateCw class="w-3.5 h-3.5" />
                      Restore
                    </button>
                    <button class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <Trash2 class="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Schedules -->
    <div v-if="activeTab === 'schedules'">
      <div class="mb-4 flex justify-end">
        <button class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors">
          <Clock class="w-4 h-4" />
          Add Schedule
        </button>
      </div>
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Service</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Frequency</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Retention</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Run</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-if="schedules.length === 0">
                <td colspan="6" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No backup schedules configured.
                </td>
              </tr>
              <tr
                v-for="schedule in schedules"
                :key="schedule.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
              >
                <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ schedule.serviceName }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ schedule.frequency }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ schedule.retention }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ schedule.lastRun || 'Never' }}</td>
                <td class="px-6 py-4 text-sm">
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      schedule.enabled
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                    ]"
                  >
                    {{ schedule.enabled ? 'Active' : 'Paused' }}
                  </span>
                </td>
                <td class="px-6 py-4 text-right">
                  <button class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
