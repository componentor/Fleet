<script setup lang="ts">
import { ref, watch } from 'vue'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  show: boolean
  title: string
  message: string
  itemName: string
  showVolumeToggle?: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  confirm: [deleteVolumes: boolean]
  cancel: []
}>()

const deleteVolumes = ref(false)

// Reset toggle when modal opens
watch(() => props.show, (val) => {
  if (val) deleteVolumes.value = false
})
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

            <!-- Volume toggle -->
            <div v-if="showVolumeToggle" class="pt-2 border-t border-gray-200 dark:border-gray-700">
              <label class="flex items-center justify-between gap-3 cursor-pointer group">
                <div>
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {{ t('confirmDelete.deleteVolumes', 'Also delete related storage volumes') }}
                  </span>
                  <p class="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                    {{ t('confirmDelete.deleteVolumesHint', 'Permanently deletes all data stored in the volumes') }}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="deleteVolumes"
                  @click="deleteVolumes = !deleteVolumes"
                  :class="[
                    'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800',
                    deleteVolumes ? 'bg-red-600' : 'bg-gray-200 dark:bg-gray-600'
                  ]"
                >
                  <span
                    :class="[
                      'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                      deleteVolumes ? 'translate-x-5' : 'translate-x-0'
                    ]"
                  />
                </button>
              </label>

              <!-- Warning when toggle is on -->
              <Transition name="fade">
                <div v-if="deleteVolumes" class="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p class="text-xs text-red-700 dark:text-red-300">
                    {{ t('confirmDelete.deleteVolumesWarning', 'Warning: All data in the associated volumes will be permanently deleted. This cannot be recovered.') }}
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
              @click="emit('confirm', deleteVolumes)"
              :disabled="loading"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
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
