<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { HardDrive, Plus, Loader2, Info } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useRole } from '@/composables/useRole'

const api = useApi()
const { canWrite } = useRole()

const volumes = ref<any[]>([])
const loading = ref(true)
const showCreate = ref(false)
const newName = ref('')
const newSize = ref(1)
const creating = ref(false)
const error = ref('')
const maxStorageGb = ref<number | null>(null)
const storageCentsPerGbMonth = ref<number>(0)

async function fetchVolumes() {
  loading.value = true
  try {
    volumes.value = await api.get<any[]>('/storage/volumes')
  } catch {
    volumes.value = []
  } finally {
    loading.value = false
  }
}

async function createVolume() {
  if (!newName.value) return
  creating.value = true
  error.value = ''
  try {
    await api.post('/storage/volumes', {
      name: newName.value,
      sizeGb: newSize.value,
    })
    newName.value = ''
    newSize.value = 1
    showCreate.value = false
    await fetchVolumes()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to create volume'
  } finally {
    creating.value = false
  }
}

const usedStorageGb = computed(() =>
  volumes.value.reduce((sum: number, v: any) => sum + (v.sizeGb ?? 0), 0),
)

const remainingStorageGb = computed(() =>
  maxStorageGb.value !== null ? Math.max(0, maxStorageGb.value - usedStorageGb.value) : null,
)

const estimatedMonthlyCost = computed(() => {
  if (!storageCentsPerGbMonth.value) return null
  return ((newSize.value * storageCentsPerGbMonth.value) / 100).toFixed(2)
})

async function fetchLimitsAndPricing() {
  try {
    const [limits, config] = await Promise.all([
      api.get<any>('/billing/resource-limits'),
      api.get<any>('/billing/config'),
    ])
    maxStorageGb.value = limits.maxNfsStorageGb ?? limits.maxStorageGb ?? null
    storageCentsPerGbMonth.value = config.pricingConfig?.storageCentsPerGbMonth ?? 0
  } catch {
    // Non-critical — just hide the info
  }
}

async function deleteVolume(volumeId: string) {
  if (!confirm('Delete this volume? All data will be lost.')) return
  try {
    await api.del(`/storage/volumes/${volumeId}`)
    await fetchVolumes()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to delete volume'
  }
}

function formatDate(ts: any) {
  if (!ts) return '--'
  return new Date(ts).toLocaleDateString()
}

onMounted(() => {
  fetchVolumes()
  fetchLimitsAndPricing()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <HardDrive class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Storage</h1>
      </div>
      <button
        v-if="canWrite"
        @click="showCreate = true"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        Create Volume
      </button>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- Create volume form -->
    <div v-if="showCreate" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Create New Volume</h3>

      <!-- Storage info bar -->
      <div v-if="maxStorageGb !== null || estimatedMonthlyCost" class="mb-4 flex flex-wrap items-center gap-4 px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-700 text-xs">
        <div v-if="maxStorageGb !== null" class="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
          <Info class="w-3.5 h-3.5 shrink-0" />
          <span>
            <span class="font-medium text-gray-900 dark:text-white">{{ usedStorageGb }} GB</span> of
            <span class="font-medium text-gray-900 dark:text-white">{{ maxStorageGb }} GB</span> used
            <template v-if="remainingStorageGb !== null">
              &middot; <span class="font-medium text-green-600 dark:text-green-400">{{ remainingStorageGb }} GB</span> available
            </template>
          </span>
        </div>
        <div v-if="estimatedMonthlyCost" class="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 ml-auto">
          Est. <span class="font-medium text-gray-900 dark:text-white">${{ estimatedMonthlyCost }}/mo</span> for {{ newSize }} GB
        </div>
      </div>

      <form @submit.prevent="createVolume" class="space-y-3">
        <div class="flex items-end gap-3 flex-wrap">
          <div class="flex-1 min-w-48">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Name</label>
            <input
              v-model="newName"
              type="text"
              placeholder="my-data"
              required
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
            />
          </div>
          <div class="w-32">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Size (GB)</label>
            <input
              v-model.number="newSize"
              type="number"
              min="1"
              :max="remainingStorageGb ?? 1000"
              required
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <button type="submit" :disabled="creating" class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
            {{ creating ? 'Creating...' : 'Create' }}
          </button>
          <button type="button" @click="showCreate = false" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
            Cancel
          </button>
        </div>
        <p class="text-xs text-gray-400 dark:text-gray-500">Lowercase letters, numbers, and hyphens only.</p>
      </form>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Driver</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created</th>
              <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="volumes.length === 0">
              <td colspan="4" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                No storage volumes created yet.
              </td>
            </tr>
            <tr
              v-for="volume in volumes"
              :key="volume.name"
              class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
            >
              <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white font-mono">{{ volume.name }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ volume.driver || 'local' }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(volume.createdAt) }}</td>
              <td v-if="canWrite" class="px-6 py-4 text-right">
                <button
                  @click="deleteVolume(volume.name)"
                  class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                >
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
