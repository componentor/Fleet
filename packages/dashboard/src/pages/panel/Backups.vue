<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Archive, RotateCw, Trash2, Plus, Clock, Play, Filter, HardDrive } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useRole } from '@/composables/useRole'
import { useServicesStore } from '@/stores/services'

const { t } = useI18n()
const api = useApi()
const { canWrite } = useRole()
const servicesStore = useServicesStore()

const activeTab = ref<'backups' | 'schedules'>('backups')
const backups = ref<any[]>([])
const schedules = ref<any[]>([])
const loading = ref(true)
const error = ref('')

// Quota
const quota = ref<{ usedBytes: number; limitBytes: number; usedGb: number; limitGb: number; percentUsed: number } | null>(null)

// Service filter
const serviceFilter = ref('')
const filteredBackups = computed(() => {
  if (!serviceFilter.value) return backups.value
  return backups.value.filter((b: any) => b.serviceId === serviceFilter.value)
})

// Backup-capable clusters
const backupClusters = ref<Array<{ id: string; name: string; region: string | null; scope: string }>>([])

// Create backup
const showCreateDialog = ref(false)
const creatingBackup = ref(false)
const createServiceId = ref('')
const createClusterId = ref('')
const createStorageBackend = ref('nfs')

// Add schedule
const showAddSchedule = ref(false)
const scheduleCron = ref('0 2 * * *')
const scheduleRetentionDays = ref(30)
const scheduleRetentionCount = ref(10)
const scheduleClusterId = ref('')
const addingSchedule = ref(false)

async function fetchBackups() {
  loading.value = true
  try {
    const query = serviceFilter.value ? `?serviceId=${serviceFilter.value}` : ''
    backups.value = await api.get<any[]>(`/backups${query}`)
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

async function fetchQuota() {
  try {
    quota.value = await api.get('/backups/quota')
  } catch {
    quota.value = null
  }
}

async function fetchBackupClusters() {
  try {
    backupClusters.value = await api.get<any[]>('/backups/clusters')
  } catch {
    backupClusters.value = []
  }
}

async function createBackup() {
  creatingBackup.value = true
  error.value = ''
  try {
    const body: any = { storageBackend: createStorageBackend.value }
    if (createServiceId.value) body.serviceId = createServiceId.value
    if (createClusterId.value) body.clusterId = createClusterId.value
    await api.post('/backups', body)
    showCreateDialog.value = false
    createServiceId.value = ''
    createClusterId.value = ''
    createStorageBackend.value = 'nfs'
    await Promise.all([fetchBackups(), fetchQuota()])
  } catch (err: any) {
    error.value = err?.body?.error || t('backups.createFailed')
  } finally {
    creatingBackup.value = false
  }
}

async function restoreBackup(backupId: string) {
  if (!confirm(t('backups.confirmRestore'))) return
  error.value = ''
  try {
    await api.post(`/backups/${backupId}/restore`, {})
    await fetchBackups()
  } catch (err: any) {
    error.value = err?.body?.error || t('backups.restoreFailed')
  }
}

async function deleteBackup(backupId: string) {
  if (!confirm(t('backups.confirmDelete'))) return
  try {
    await api.del(`/backups/${backupId}`)
    await Promise.all([fetchBackups(), fetchQuota()])
  } catch (err: any) {
    error.value = err?.body?.error || t('backups.deleteFailed')
  }
}

async function addSchedule() {
  if (!scheduleCron.value) return
  addingSchedule.value = true
  error.value = ''
  try {
    const body: any = {
      cron: scheduleCron.value,
      retentionDays: scheduleRetentionDays.value,
      retentionCount: scheduleRetentionCount.value,
      storageBackend: 'nfs',
    }
    if (scheduleClusterId.value) body.clusterId = scheduleClusterId.value
    await api.post('/backups/schedules', body)
    scheduleCron.value = '0 2 * * *'
    scheduleRetentionDays.value = 30
    scheduleRetentionCount.value = 10
    scheduleClusterId.value = ''
    showAddSchedule.value = false
    await fetchSchedules()
  } catch (err: any) {
    error.value = err?.body?.error || t('backups.createScheduleFailed')
  } finally {
    addingSchedule.value = false
  }
}

async function runSchedule(scheduleId: string) {
  error.value = ''
  try {
    await api.post(`/backups/schedules/${scheduleId}/run`, {})
    await Promise.all([fetchBackups(), fetchQuota()])
  } catch (err: any) {
    error.value = err?.body?.error || t('backups.runScheduleFailed')
  }
}

async function deleteSchedule(scheduleId: string) {
  if (!confirm(t('backups.confirmDeleteSchedule'))) return
  try {
    await api.del(`/backups/schedules/${scheduleId}`)
    await fetchSchedules()
  } catch (err: any) {
    error.value = err?.body?.error || t('backups.deleteScheduleFailed')
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

function backupTypeLabel(backup: any) {
  const level = backup.level ?? 0
  if (level === 0) return t('backups.typeFull')
  return t('backups.typeIncremental', { level })
}

function serviceName(serviceId: string | null) {
  if (!serviceId) return t('backups.account')
  const svc = servicesStore.services.find((s) => s.id === serviceId)
  return svc?.name || serviceId.slice(0, 8)
}

function quotaBarColor(percent: number) {
  if (percent >= 90) return 'bg-red-500'
  if (percent >= 70) return 'bg-yellow-500'
  return 'bg-primary-500'
}

function onServiceFilterChange() {
  fetchBackups()
}

onMounted(async () => {
  await Promise.all([fetchBackups(), fetchSchedules(), fetchQuota(), fetchBackupClusters(), servicesStore.fetchServices()])
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <Archive class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('backups.title') }}</h1>
      </div>
      <button
        v-if="canWrite"
        @click="showCreateDialog = true"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        {{ t('backups.create') }}
      </button>
    </div>

    <!-- Quota bar -->
    <div v-if="quota" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <HardDrive class="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('backups.backupStorage') }}</span>
        </div>
        <span class="text-sm text-gray-500 dark:text-gray-400">
          {{ t('backups.quotaUsage', { used: quota.usedGb.toFixed(2), limit: quota.limitGb, percent: Math.round(quota.percentUsed) }) }}
        </span>
      </div>
      <div class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          :class="['h-full rounded-full transition-all', quotaBarColor(quota.percentUsed)]"
          :style="{ width: Math.min(quota.percentUsed, 100) + '%' }"
        />
      </div>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- Create backup dialog -->
    <Teleport to="body">
      <div v-if="showCreateDialog" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="fixed inset-0 bg-black/50" @click="showCreateDialog = false" />
        <div class="relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl p-6 w-full max-w-md">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">{{ t('backups.create') }}</h3>
          <form @submit.prevent="createBackup" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('backups.serviceOptional') }}</label>
              <select
                v-model="createServiceId"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              >
                <option value="">{{ t('backups.allServicesAccount') }}</option>
                <option v-for="svc in servicesStore.services" :key="svc.id" :value="svc.id">{{ svc.name }}</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('backups.storageBackend') }}</label>
              <select
                v-model="createStorageBackend"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              >
                <option value="nfs">{{ t('backups.storageNfs') }}</option>
                <option value="local">{{ t('backups.storageLocal') }}</option>
                <option value="object">{{ t('backups.storageObject') }}</option>
              </select>
            </div>
            <div v-if="backupClusters.length > 1">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('backups.clusterOptional') }}</label>
              <select
                v-model="createClusterId"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              >
                <option value="">{{ t('backups.default') }}</option>
                <option v-for="cl in backupClusters" :key="cl.id" :value="cl.id">{{ cl.name }}{{ cl.region ? ` (${cl.region})` : '' }}</option>
              </select>
            </div>
            <div class="flex justify-end gap-3 pt-2">
              <button type="button" @click="showCreateDialog = false" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700">
                {{ t('backups.cancel') }}
              </button>
              <button type="submit" :disabled="creatingBackup" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                <CompassSpinner v-if="creatingBackup" size="w-4 h-4" />
                {{ creatingBackup ? t('backups.creating') : t('backups.createBtn') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

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
          {{ t('backups.tabBackups') }}
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
          {{ t('backups.tabSchedules') }}
        </button>
      </nav>
    </div>

    <!-- Backups list -->
    <div v-if="activeTab === 'backups'">
      <!-- Service filter -->
      <div v-if="servicesStore.services.length > 0" class="mb-4 flex items-center gap-2">
        <Filter class="w-4 h-4 text-gray-400" />
        <select
          v-model="serviceFilter"
          @change="onServiceFilterChange"
          class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        >
          <option value="">{{ t('backups.allServices') }}</option>
          <option v-for="svc in servicesStore.services" :key="svc.id" :value="svc.id">{{ svc.name }}</option>
        </select>
      </div>

      <div v-if="loading" class="flex items-center justify-center py-20">
        <CompassSpinner size="w-8 h-8" />
      </div>
      <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('backups.headerDate') }}</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('backups.service') }}</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('backups.headerType') }}</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('backups.size') }}</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('backups.status') }}</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('backups.headerStorage') }}</th>
                <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('backups.headerActions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-if="filteredBackups.length === 0">
                <td colspan="7" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  {{ t('backups.noBackupsCreated') }}
                </td>
              </tr>
              <tr
                v-for="backup in filteredBackups"
                :key="backup.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
              >
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{{ formatDate(backup.createdAt) }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ serviceName(backup.serviceId) }}</td>
                <td class="px-6 py-4 text-sm">
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      (backup.level ?? 0) === 0
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                    ]"
                  >
                    {{ backupTypeLabel(backup) }}
                  </span>
                </td>
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
                      {{ t('backups.restore') }}
                    </button>
                    <button
                      @click="deleteBackup(backup.id)"
                      class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                      {{ t('backups.delete') }}
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
          {{ t('backups.addSchedule') }}
        </button>
      </div>

      <!-- Add schedule form -->
      <div v-if="showAddSchedule" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">{{ t('backups.newBackupSchedule') }}</h3>
        <form @submit.prevent="addSchedule" class="space-y-4">
          <div class="flex items-end gap-3 flex-wrap">
            <div class="flex-1 min-w-48">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('backups.cronExpression') }}</label>
              <input
                v-model="scheduleCron"
                type="text"
                placeholder="0 2 * * *"
                required
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              />
            </div>
            <div class="w-36">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('backups.retentionDays') }}</label>
              <input
                v-model.number="scheduleRetentionDays"
                type="number"
                min="1"
                max="365"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>
            <div class="w-36">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('backups.maxBackups') }}</label>
              <input
                v-model.number="scheduleRetentionCount"
                type="number"
                min="1"
                max="100"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>
          </div>
          <div v-if="backupClusters.length > 1" class="w-64">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('backups.clusterOptional') }}</label>
            <select
              v-model="scheduleClusterId"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            >
              <option value="">{{ t('backups.default') }}</option>
              <option v-for="cl in backupClusters" :key="cl.id" :value="cl.id">{{ cl.name }}{{ cl.region ? ` (${cl.region})` : '' }}</option>
            </select>
          </div>
          <div class="flex gap-3">
            <button type="submit" :disabled="addingSchedule" class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              {{ addingSchedule ? t('backups.adding') : t('backups.addSchedule') }}
            </button>
            <button type="button" @click="showAddSchedule = false" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
              {{ t('backups.cancel') }}
            </button>
          </div>
        </form>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('backups.headerCron') }}</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('backups.retention') }}</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('backups.status') }}</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('backups.lastRun') }}</th>
                <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('backups.headerActions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-if="schedules.length === 0">
                <td colspan="5" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  {{ t('backups.noSchedules') }}
                </td>
              </tr>
              <tr
                v-for="schedule in schedules"
                :key="schedule.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
              >
                <td class="px-6 py-4 text-sm font-mono text-gray-900 dark:text-white">{{ schedule.cron }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ t('backups.retentionSummary', { days: schedule.retentionDays, count: schedule.retentionCount }) }}</td>
                <td class="px-6 py-4 text-sm">
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      schedule.enabled
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                    ]"
                  >
                    {{ schedule.enabled ? t('backups.active') : t('backups.paused') }}
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
                      {{ t('backups.runNow') }}
                    </button>
                    <button
                      @click="deleteSchedule(schedule.id)"
                      class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                    >
                      {{ t('backups.delete') }}
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
