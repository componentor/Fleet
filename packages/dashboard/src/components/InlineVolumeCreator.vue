<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Loader2, X } from 'lucide-vue-next'
import type { VolumeInfo, StorageQuota } from '@/composables/useVolumeManager'

const props = defineProps<{
  modelValue: { source: string; target: string; readonly: boolean }
  accountVolumes: VolumeInfo[]
  storageQuota: StorageQuota | null
  createLoading: boolean
  suggestedName?: string
  suggestedTarget?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: { source: string; target: string; readonly: boolean }]
  volumeCreated: [volume: VolumeInfo]
  remove: []
  browse: [volumeName: string]
}>()

const { t } = useI18n()

const createMode = ref(false)
const newName = ref(props.suggestedName ?? '')
const newSize = ref(5)

const selectValue = computed({
  get: () => createMode.value ? '__create__' : props.modelValue.source,
  set: (val: string) => {
    if (val === '__create__') {
      createMode.value = true
      if (props.suggestedName) newName.value = props.suggestedName
    } else {
      createMode.value = false
      emit('update:modelValue', { ...props.modelValue, source: val })
    }
  },
})

const target = computed({
  get: () => props.modelValue.target,
  set: (val: string) => emit('update:modelValue', { ...props.modelValue, target: val }),
})

const readonly = computed({
  get: () => props.modelValue.readonly,
  set: (val: boolean) => emit('update:modelValue', { ...props.modelValue, readonly: val }),
})

const selectedVolume = computed(() =>
  props.modelValue.source ? props.accountVolumes.find((v) => v.name === props.modelValue.source) : null,
)

const remainingGb = computed(() => {
  if (!props.storageQuota) return null
  return Math.max(0, props.storageQuota.limitGb - props.storageQuota.usedGb)
})

const nameError = computed(() => {
  if (!newName.value) return null
  if (!/^[a-z0-9][a-z0-9-]*$/.test(newName.value)) return 'Lowercase letters, numbers, and hyphens only'
  if (props.accountVolumes.some((v) => v.displayName === newName.value)) return 'Volume name already exists'
  return null
})

// If suggestedTarget changes and target is empty, auto-fill it
watch(
  () => props.suggestedTarget,
  (val) => {
    if (val && !props.modelValue.target) {
      emit('update:modelValue', { ...props.modelValue, target: val })
    }
  },
  { immediate: true },
)

async function handleCreate() {
  if (!newName.value || nameError.value) return
  emit('volumeCreated', { name: newName.value, displayName: newName.value, sizeGb: newSize.value, usedGb: 0, availableGb: newSize.value })
}

// When the parent sets source to a real volume (after creation), close create mode
watch(
  () => props.modelValue.source,
  (val) => {
    if (val && val !== '__create__' && createMode.value) {
      createMode.value = false
      newName.value = ''
      newSize.value = 5
    }
  },
)
</script>

<template>
  <div class="flex items-start gap-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
    <div class="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <!-- Volume source -->
      <div>
        <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{{ $t('deploy.volume') || 'Volume' }}</label>
        <select
          v-model="selectValue"
          class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">{{ $t('deploy.selectVolume') || 'Select volume...' }}</option>
          <option v-for="vol in accountVolumes" :key="vol.name" :value="vol.name">
            {{ vol.displayName }} ({{ vol.usedGb?.toFixed(1) ?? 0 }}/{{ vol.sizeGb }}GB)
          </option>
          <option v-if="modelValue.source && !accountVolumes.find((v) => v.name === modelValue.source)" :value="modelValue.source">
            {{ modelValue.source }}
          </option>
          <option disabled>──────────</option>
          <option value="__create__">+ {{ $t('deploy.createNewVolume') || 'Create New Volume' }}</option>
        </select>

        <!-- Selected volume usage -->
        <div v-if="selectedVolume && !createMode" class="mt-1.5">
          <div class="flex items-baseline justify-between mb-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ selectedVolume.usedGb?.toFixed(1) ?? 0 }} / {{ selectedVolume.sizeGb }} GB used</span>
          </div>
          <div class="h-1 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="selectedVolume.sizeGb > 0 && (selectedVolume.usedGb ?? 0) / selectedVolume.sizeGb > 0.9
                ? 'bg-red-500'
                : selectedVolume.sizeGb > 0 && (selectedVolume.usedGb ?? 0) / selectedVolume.sizeGb > 0.7
                  ? 'bg-amber-500'
                  : 'bg-primary-500'"
              :style="{ width: selectedVolume.sizeGb > 0 ? `${Math.min(100, ((selectedVolume.usedGb ?? 0) / selectedVolume.sizeGb) * 100)}%` : '0%' }"
            />
          </div>
        </div>

        <!-- Inline creation form -->
        <div v-if="createMode" class="mt-2 space-y-2">
          <div>
            <input
              v-model="newName"
              type="text"
              :placeholder="$t('deploy.volumeName') || 'volume-name'"
              class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <p v-if="nameError" class="text-xs text-red-500 mt-0.5">{{ nameError }}</p>
          </div>
          <div class="flex items-center gap-2">
            <input
              v-model.number="newSize"
              type="number"
              min="1"
              max="1000"
              class="w-20 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <span class="text-xs text-gray-400">GB</span>
            <button
              @click="handleCreate"
              :disabled="createLoading || !newName || !!nameError"
              class="ml-auto px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              <Loader2 v-if="createLoading" class="w-3.5 h-3.5 animate-spin" />
              <template v-else>{{ $t('deploy.create') || 'Create' }}</template>
            </button>
          </div>
          <p v-if="remainingGb !== null" class="text-xs text-gray-400 dark:text-gray-500">
            {{ remainingGb }} GB {{ $t('deploy.volumeAvailable') || 'available' }}
          </p>
        </div>
      </div>

      <!-- Mount path -->
      <div>
        <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{{ $t('deploy.mountPath') || 'Mount Path' }}</label>
        <input
          v-model="target"
          type="text"
          placeholder="/var/data"
          class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>
    </div>

    <!-- Controls -->
    <div class="flex items-center gap-2 mt-5">
      <button
        v-if="modelValue.source"
        @click="emit('browse', modelValue.source)"
        class="p-1 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        title="Browse files"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
      </button>
      <label class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer" title="Read-Only">
        <input type="checkbox" v-model="readonly" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
        RO
      </label>
      <button @click="emit('remove')" class="p-1 text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors" title="Remove">
        <X class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>
