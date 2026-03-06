<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { AlertTriangle, Trash2 } from 'lucide-vue-next'
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
}>()

const emit = defineEmits<{
  confirm: [deleteVolumeNames: string[]]
  cancel: []
}>()

const selectedVolumes = ref<Set<string>>(new Set())

// Reset selection when modal opens
watch(() => props.show, (val) => {
  if (val) selectedVolumes.value = new Set()
})

const hasVolumes = computed(() => (props.volumes?.length ?? 0) > 0)
const anySelected = computed(() => selectedVolumes.value.size > 0)
const allSelected = computed(() =>
  hasVolumes.value && selectedVolumes.value.size === props.volumes!.length
)

function toggleVolume(source: string) {
  const next = new Set(selectedVolumes.value)
  if (next.has(source)) next.delete(source)
  else next.add(source)
  selectedVolumes.value = next
}

function toggleAll() {
  if (allSelected.value) {
    selectedVolumes.value = new Set()
  } else {
    selectedVolumes.value = new Set(props.volumes!.map(v => v.source))
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <!-- Backdrop -->
        <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" @click="emit('cancel')"></div>

        <!-- Modal -->
        <div class="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden">
          <!-- Header -->
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle class="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ title }}</h3>
            </div>
            <button @click="emit('cancel')" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <!-- Body -->
          <div class="p-6 space-y-4">
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ message }}
              <span class="font-semibold text-gray-900 dark:text-white">{{ itemName }}</span>?
            </p>

            <p class="text-xs text-gray-500 dark:text-gray-500">
              {{ t('confirmDelete.cannotBeUndone', 'This action cannot be undone.') }}
            </p>

            <!-- Volume selection -->
            <div v-if="hasVolumes" class="pt-2 border-t border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ t('confirmDelete.selectVolumesToDelete', 'Select volumes to delete') }}
                </span>
                <button
                  type="button"
                  @click="toggleAll"
                  class="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                >
                  {{ allSelected ? t('confirmDelete.deselectAll', 'Deselect all') : t('confirmDelete.selectAll', 'Select all') }}
                </button>
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-500 mb-3">
                {{ t('confirmDelete.volumeSelectionHint', 'Checked volumes will be permanently deleted. Unchecked volumes will be kept.') }}
              </p>
              <div class="space-y-1.5 max-h-48 overflow-y-auto">
                <label
                  v-for="vol in volumes"
                  :key="vol.source"
                  class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    :checked="selectedVolumes.has(vol.source)"
                    @change="toggleVolume(vol.source)"
                    class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500 dark:bg-gray-700"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-mono text-gray-900 dark:text-white truncate">{{ vol.source }}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400 truncate">→ {{ vol.target }}</p>
                  </div>
                </label>
              </div>

              <!-- Warning when any volumes selected -->
              <Transition name="fade">
                <div v-if="anySelected" class="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p class="text-xs text-red-700 dark:text-red-300">
                    {{ t('confirmDelete.deleteVolumesWarning', 'Warning: All data in the selected volumes will be permanently deleted. This cannot be recovered.') }}
                  </p>
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
              @click="emit('confirm', [...selectedVolumes])"
              :disabled="loading"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <CompassSpinner v-if="loading" size="w-4 h-4" />
              <Trash2 v-else class="w-4 h-4" />
              {{ loading ? t('confirmDelete.deleting', 'Deleting...') : t('confirmDelete.confirm', 'Delete') }}
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
