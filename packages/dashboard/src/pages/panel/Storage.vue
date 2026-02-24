<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { HardDrive, Plus, Loader2, Info, FolderOpen } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useRole } from '@/composables/useRole'
import FileExplorer from '@/components/FileExplorer.vue'

const { t } = useI18n()
const api = useApi()
const { canWrite } = useRole()

const volumes = ref<any[]>([])
const loading = ref(true)
const showCreate = ref(false)
const newName = ref('')
const newSize = ref(1)
const creating = ref(false)
const error = ref('')
const browsingVolumeName = ref<string | null>(null)
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
    error.value = err?.body?.error || t('storagePage.createFailed')
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
  if (!confirm(t('storagePage.confirmDelete'))) return
  try {
    await api.del(`/storage/volumes/${volumeId}`)
    await fetchVolumes()
  } catch (err: any) {
    error.value = err?.body?.error || t('storagePage.deleteFailed')
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
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <HardDrive class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('storage.title') }}</h1>
      </div>
      <button
        v-if="canWrite"
        @click="showCreate = true"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        {{ t('storage.createVolume') }}
      </button>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- Create volume form -->
    <div v-if="showCreate" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">{{ t('storagePage.createNew') }}</h3>

      <!-- Storage info bar -->
      <div v-if="maxStorageGb !== null || estimatedMonthlyCost" class="mb-4 flex flex-wrap items-center gap-4 px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-700 text-xs">
        <div v-if="maxStorageGb !== null" class="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
          <Info class="w-3.5 h-3.5 shrink-0" />
          <span>
            <span class="font-medium text-gray-900 dark:text-white">{{ usedStorageGb }} GB</span> {{ t('storagePage.of') }}
            <span class="font-medium text-gray-900 dark:text-white">{{ maxStorageGb }} GB</span> {{ t('storage.used') }}
            <template v-if="remainingStorageGb !== null">
              &middot; <span class="font-medium text-green-600 dark:text-green-400">{{ remainingStorageGb }} GB</span> {{ t('storage.available') }}
            </template>
          </span>
        </div>
        <div v-if="estimatedMonthlyCost" class="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 ml-auto">
          {{ t('storagePage.estimated', { cost: estimatedMonthlyCost, size: newSize }) }}
        </div>
      </div>

      <form @submit.prevent="createVolume" class="space-y-3">
        <div class="flex items-end gap-3 flex-wrap">
          <div class="flex-1 min-w-48">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('storagePage.name') }}</label>
            <input
              v-model="newName"
              type="text"
              placeholder="my-data"
              required
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
            />
          </div>
          <div class="w-32">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('storagePage.sizeGb') }}</label>
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
            {{ creating ? t('storagePage.creating') : t('storagePage.create') }}
          </button>
          <button type="button" @click="showCreate = false" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
            {{ t('storagePage.cancel') }}
          </button>
        </div>
        <p class="text-xs text-gray-400 dark:text-gray-500">{{ t('storagePage.nameHint') }}</p>
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
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('storagePage.name') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('storagePage.driver') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('storagePage.created') }}</th>
              <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('storagePage.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="volumes.length === 0">
              <td colspan="4" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                {{ t('storagePage.noVolumes') }}
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
              <td class="px-6 py-4 text-right">
                <div class="flex items-center justify-end gap-3">
                  <button
                    @click="browsingVolumeName = volume.name"
                    class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center gap-1"
                  >
                    <FolderOpen class="w-3.5 h-3.5" />
                    Browse
                  </button>
                  <button
                    v-if="canWrite"
                    @click="deleteVolume(volume.name)"
                    class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                  >
                    {{ t('storagePage.delete') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Volume File Browser Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="browsingVolumeName" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" @click="browsingVolumeName = null"></div>
          <div class="relative w-full max-w-6xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0">
              <div class="flex items-center gap-3">
                <FolderOpen class="w-5 h-5 text-primary-600 dark:text-primary-400" />
                <div>
                  <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Volume Browser</h3>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono">{{ browsingVolumeName }}</p>
                </div>
              </div>
              <button @click="browsingVolumeName = null" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div class="flex-1 overflow-y-auto p-6">
              <FileExplorer :volumeName="browsingVolumeName" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
