<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Trash2, Archive, HardDrive, Shield, Clock } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  show: boolean
  title: string
  message: string
  itemName: string
  volumes?: Array<{ source: string; target: string }>
  loading?: boolean
  /** Show "Create backup before deleting" option */
  showBackupOption?: boolean
  /** Recovery period in days */
  recoveryDays?: number
}>()

const emit = defineEmits<{
  confirm: [deleteVolumeNames: string[], options: { backupBeforeDelete: boolean }]
  cancel: []
}>()

const selectedVolumes = ref<Set<string>>(new Set())
const backupBeforeDelete = ref(true)
const volumeMode = ref<'keep' | 'select'>('keep')

// Reset state when modal opens
watch(() => props.show, (val) => {
  if (val) {
    selectedVolumes.value = new Set()
    backupBeforeDelete.value = true
    volumeMode.value = 'keep'
  }
})

const hasVolumes = computed(() => (props.volumes?.length ?? 0) > 0)
const anySelected = computed(() => selectedVolumes.value.size > 0)
const allSelected = computed(() =>
  hasVolumes.value && selectedVolumes.value.size === props.volumes!.length
)
const recoveryDays = computed(() => props.recoveryDays ?? 30)

function toggleVolume(source: string) {
  const next = new Set(selectedVolumes.value)
  if (next.has(source)) next.delete(source)
  else next.add(source)
  selectedVolumes.value = next
}

function selectAllVolumes() {
  selectedVolumes.value = new Set(props.volumes!.map(v => v.source))
}

function handleConfirm() {
  const deleteVols = volumeMode.value === 'select' ? [...selectedVolumes.value] : []
  emit('confirm', deleteVols, { backupBeforeDelete: backupBeforeDelete.value })
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <!-- Backdrop -->
        <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" @click="emit('cancel')"></div>

        <!-- Modal -->
        <div class="relative w-full max-w-lg bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden">
          <!-- Header -->
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <Trash2 class="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ title }}</h3>
            </div>
            <button @click="emit('cancel')" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <!-- Body -->
          <div class="p-6 space-y-5">
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ message }}
              <span class="font-semibold text-gray-900 dark:text-white">{{ itemName }}</span>?
            </p>

            <!-- Recovery notice -->
            <div class="flex items-start gap-3 p-3.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <Clock class="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p class="text-sm font-medium text-blue-900 dark:text-blue-200">
                  {{ t('confirmDelete.recoveryTitle', 'You can restore this') }}
                </p>
                <p class="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                  {{ t('confirmDelete.recoveryDesc', { days: recoveryDays }) }}
                </p>
              </div>
            </div>

            <!-- Backup option -->
            <label v-if="showBackupOption !== false" class="flex items-start gap-3 p-3.5 rounded-lg border transition-colors cursor-pointer"
              :class="backupBeforeDelete
                ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'"
            >
              <input
                type="checkbox"
                v-model="backupBeforeDelete"
                class="w-4 h-4 mt-0.5 rounded border-gray-300 dark:border-gray-600 text-green-600 focus:ring-green-500 dark:bg-gray-700"
              />
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <Shield class="w-4 h-4 text-green-600 dark:text-green-400" />
                  <p class="text-sm font-medium text-gray-900 dark:text-white">
                    {{ t('confirmDelete.backupBeforeDelete', 'Create a backup before deleting') }}
                  </p>
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
                  {{ t('confirmDelete.backupBeforeDeleteDesc', 'Saves a snapshot of your data so you can restore it later if needed.') }}
                </p>
              </div>
            </label>

            <!-- Volume handling -->
            <div v-if="hasVolumes" class="space-y-3">
              <div class="flex items-center gap-2 mb-1">
                <HardDrive class="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('confirmDelete.storageTitle', 'Storage') }}
                </span>
              </div>

              <!-- Keep / Delete toggle -->
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  @click="volumeMode = 'keep'; selectedVolumes = new Set()"
                  :class="[
                    'p-3 rounded-lg text-left border-2 transition-all',
                    volumeMode === 'keep'
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  ]"
                >
                  <p class="text-xs font-semibold text-gray-900 dark:text-white">
                    {{ t('confirmDelete.keepVolumes', 'Keep all disks') }}
                  </p>
                  <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {{ t('confirmDelete.keepVolumesDesc', 'Data stays available for future use') }}
                  </p>
                </button>
                <button
                  type="button"
                  @click="volumeMode = 'select'; selectAllVolumes()"
                  :class="[
                    'p-3 rounded-lg text-left border-2 transition-all',
                    volumeMode === 'select'
                      ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  ]"
                >
                  <p class="text-xs font-semibold text-gray-900 dark:text-white">
                    {{ t('confirmDelete.deleteVolumes', 'Delete disks permanently') }}
                  </p>
                  <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {{ t('confirmDelete.deleteVolumesDesc', 'Remove selected disks and all their data') }}
                  </p>
                </button>
              </div>

              <!-- Volume checkboxes (only when "delete" mode selected) -->
              <Transition name="fade">
                <div v-if="volumeMode === 'select'" class="space-y-1.5 max-h-48 overflow-y-auto rounded-lg border border-red-200 dark:border-red-800 p-2">
                  <label
                    v-for="vol in volumes"
                    :key="vol.source"
                    class="flex items-center gap-3 p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      :checked="selectedVolumes.has(vol.source)"
                      @change="toggleVolume(vol.source)"
                      class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500 dark:bg-gray-700"
                    />
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-mono text-gray-900 dark:text-white truncate">{{ vol.source }}</p>
                      <p class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ vol.target }}</p>
                    </div>
                  </label>

                  <!-- Warning -->
                  <div v-if="anySelected" class="mt-2 p-2.5 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <p class="text-xs text-red-700 dark:text-red-300">
                      {{ t('confirmDelete.deleteVolumesWarning', 'Selected disks and all their data will be permanently deleted. This cannot be recovered.') }}
                    </p>
                  </div>
                </div>
              </Transition>
            </div>
          </div>

          <!-- Footer -->
          <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
            <button
              type="button"
              @click="emit('cancel')"
              :disabled="loading"
              class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              {{ t('confirmDelete.cancel', 'Cancel') }}
            </button>
            <button
              type="button"
              @click="handleConfirm"
              :disabled="loading"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <CompassSpinner v-if="loading" size="w-4 h-4" />
              <Trash2 v-else class="w-4 h-4" />
              {{ loading ? t('confirmDelete.deleting', 'Deleting...') : t('confirmDelete.moveToTrash', 'Move to Trash') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-active .relative,
.modal-leave-active .relative {
  transition: transform 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .relative {
  transform: scale(0.95);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
