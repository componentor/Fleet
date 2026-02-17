<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Archive, RotateCw, Trash2, Plus, Clock, Play, Loader2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useRole } from '@/composables/useRole'

const api = useApi()
const { canWrite } = useRole()

const activeTab = ref<'backups' | 'schedules'>('backups')
const backups = ref<any[]>([])
const schedules = ref<any[]>([])
const loading = ref(true)
const error = ref('')

// Create backup
const creatingBackup = ref(false)

// Add schedule
const showAddSchedule = ref(false)
const scheduleCron = ref('0 2 * * *')
const scheduleRetentionDays = ref(30)
const scheduleRetentionCount = ref(10)
const addingSchedule = ref(false)

async function fetchBackups() {
  loading.value = true
  try {
    backups.value = await api.get<any[]>('/backups')
  } catch {
    backups.value = []
  } finally {
    loading.value = false
  }
}

async function fetchSchedules() {
  try {
    schedules.value = await api.get<any[]>('/backups/schedules')
  } catch {
    schedules.value = []
  }
}

async function createBackup() {
  creatingBackup.value = true
  error.value = ''
  try {
    await api.post('/backups', { storageBackend: 'nfs' })
    await fetchBackups()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to create backup'
  } finally {
    creatingBackup.value = false
  }
}

async function restoreBackup(backupId: string) {
  if (!confirm('Restore from this backup? This will overwrite current data.')) return
  error.value = ''
  try {
    await api.post(`/backups/${backupId}/restore`, {})
    await fetchBackups()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to restore backup'
  }
}

async function deleteBackup(backupId: string) {
  if (!confirm('Delete this backup?')) return
  try {
    await api.del(`/backups/${backupId}`)
    await fetchBackups()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to delete backup'
  }
}

async function addSchedule() {
  if (!scheduleCron.value) return
  addingSchedule.value = true
  error.value = ''
  try {
    await api.post('/backups/schedules', {
      cron: scheduleCron.value,
      retentionDays: scheduleRetentionDays.value,
      retentionCount: scheduleRetentionCount.value,
      storageBackend: 'nfs',
    })
    scheduleCron.value = '0 2 * * *'
    scheduleRetentionDays.value = 30
    scheduleRetentionCount.value = 10
    showAddSchedule.value = false
    await fetchSchedules()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to create schedule'
  } finally {
    addingSchedule.value = false
  }
}

async function runSchedule(scheduleId: string) {
  error.value = ''
  try {
    await api.post(`/backups/schedules/${scheduleId}/run`, {})
    await fetchBackups()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to run schedule'
  }
}

async function deleteSchedule(scheduleId: string) {
  if (!confirm('Delete this backup schedule?')) return
  try {
    await api.del(`/backups/schedules/${scheduleId}`)
    await fetchSchedules()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to delete schedule'
  }
}

function formatDate(ts: any) {
  if (!ts) return '--'
  return new Date(ts).toLocaleString()
}

function formatSize(bytes: any) {
  const b = Number(bytes) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

onMounted(async () => {
  await Promise.all([fetchBackups(), fetchSchedules()])
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Archive class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Backups</h1>
      </div>
      <button
        v-if="canWrite"
        @click="createBackup"
        :disabled="creatingBackup"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
      >
        <Loader2 v-if="creatingBackup" class="w-4 h-4 animate-spin" />
        <Plus v-else class="w-4 h-4" />
        {{ creatingBackup ? 'Creating...' : 'Create Backup' }}
      </button>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
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
      <div v-if="loading" class="flex items-center justify-center py-20">
        <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
      </div>
      <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Size</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Storage</th>
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
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{{ formatDate(backup.createdAt) }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ formatSize(backup.sizeBytes) }}</td>
                <td class="px-6 py-4 text-sm">
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      backup.status === 'completed'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        : backup.status === 'in_progress'
                        ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    ]"
                  >
                    {{ backup.status }}
                  </span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ backup.storageBackend || 'nfs' }}</td>
                <td v-if="canWrite" class="px-6 py-4 text-right">
                  <div class="flex items-center justify-end gap-2">
                    <button
                      v-if="backup.status === 'completed'"
                      @click="restoreBackup(backup.id)"
                      class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                    >
                      <RotateCw class="w-3.5 h-3.5" />
                      Restore
                    </button>
                    <button
                      @click="deleteBackup(backup.id)"
                      class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
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
      <div v-if="canWrite" class="mb-4 flex justify-end">
        <button
          @click="showAddSchedule = true"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Clock class="w-4 h-4" />
          Add Schedule
        </button>
      </div>

      <!-- Add schedule form -->
      <div v-if="showAddSchedule" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">New Backup Schedule</h3>
        <form @submit.prevent="addSchedule" class="flex items-end gap-3 flex-wrap">
          <div class="flex-1 min-w-48">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Cron Expression</label>
            <input
              v-model="scheduleCron"
              type="text"
              placeholder="0 2 * * *"
              required
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
            />
          </div>
          <div class="w-36">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Retention (days)</label>
            <input
              v-model.number="scheduleRetentionDays"
              type="number"
              min="1"
              max="365"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div class="w-36">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Max Backups</label>
            <input
              v-model.number="scheduleRetentionCount"
              type="number"
              min="1"
              max="100"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <button type="submit" :disabled="addingSchedule" class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
            {{ addingSchedule ? 'Adding...' : 'Add' }}
          </button>
          <button type="button" @click="showAddSchedule = false" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
            Cancel
          </button>
        </form>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cron</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Retention</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Run</th>
                <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-if="schedules.length === 0">
                <td colspan="5" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No backup schedules configured.
                </td>
              </tr>
              <tr
                v-for="schedule in schedules"
                :key="schedule.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
              >
                <td class="px-6 py-4 text-sm font-mono text-gray-900 dark:text-white">{{ schedule.cron }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ schedule.retentionDays }}d / {{ schedule.retentionCount }} max</td>
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
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(schedule.lastRunAt) }}</td>
                <td v-if="canWrite" class="px-6 py-4 text-right">
                  <div class="flex items-center justify-end gap-2">
                    <button
                      @click="runSchedule(schedule.id)"
                      class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                    >
                      <Play class="w-3.5 h-3.5" />
                      Run Now
                    </button>
                    <button
                      @click="deleteSchedule(schedule.id)"
                      class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                    >
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
  </div>
</template>
