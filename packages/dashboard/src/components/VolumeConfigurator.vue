<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { HardDrive, Plus, X, Database, FolderOpen, AlertTriangle, ArrowUpCircle, Check, RefreshCw } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useVolumeManager, type VolumeInfo, type StorageQuota } from '@/composables/useVolumeManager'
import { useRouter } from 'vue-router'

export interface VolumeEntry {
  source: string
  target: string
  sizeGb: number
  readonly: boolean
  mode: 'existing' | 'create'
  displayName: string
  isAutoDetected?: boolean
}

const props = defineProps<{
  modelValue: VolumeEntry[]
  serviceName?: string
  image?: string
  /** Disable editing (read-only display) */
  disabled?: boolean
  /** Compact mode for inline use (no header) */
  compact?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [entries: VolumeEntry[]]
  'quota-exceeded': []
  'volume-created': [vol: VolumeInfo]
}>()

const { t } = useI18n()
const router = useRouter()
const volumeManager = useVolumeManager()
const creating = ref<number | null>(null)

onMounted(async () => {
  await volumeManager.fetchAll()
  autoDetectVolumes()
})

// Re-detect when image changes
watch(() => props.image, () => {
  autoDetectVolumes()
})

function autoDetectVolumes() {
  if (!props.image || props.modelValue.length > 0) return
  const suggestedPath = volumeManager.suggestedVolumePath(props.image)
  if (suggestedPath) {
    const name = props.serviceName ? volumeManager.suggestedVolumeName(props.serviceName) : 'data'
    emit('update:modelValue', [{
      source: '',
      target: suggestedPath,
      sizeGb: 5,
      readonly: false,
      mode: 'create',
      displayName: name,
      isAutoDetected: true,
    }])
  }
}

// ── Quota calculations ───────────────────────────────────────────────────

const quota = computed(() => volumeManager.storageQuota.value)

const totalNewGb = computed(() =>
  props.modelValue
    .filter(v => v.mode === 'create' && !v.source)
    .reduce((sum, v) => sum + v.sizeGb, 0),
)

const usedAfterDeploy = computed(() => {
  if (!quota.value) return 0
  return quota.value.usedGb + totalNewGb.value
})

const remainingGb = computed(() => {
  if (!quota.value) return null
  return Math.max(0, quota.value.limitGb - quota.value.usedGb)
})

const remainingAfterDeploy = computed(() => {
  if (!quota.value) return null
  return Math.max(0, quota.value.limitGb - usedAfterDeploy.value)
})

const isOverQuota = computed(() => {
  if (!quota.value || quota.value.limitGb <= 0) return false
  return usedAfterDeploy.value > quota.value.limitGb
})

const quotaPercent = computed(() => {
  if (!quota.value || quota.value.limitGb <= 0) return 0
  return Math.min(100, (quota.value.usedGb / quota.value.limitGb) * 100)
})

const newPercent = computed(() => {
  if (!quota.value || quota.value.limitGb <= 0) return 0
  return Math.min(100 - quotaPercent.value, (totalNewGb.value / quota.value.limitGb) * 100)
})

const quotaBarColor = computed(() => {
  const total = quotaPercent.value + newPercent.value
  if (total > 100) return 'bg-red-500'
  if (total > 80) return 'bg-amber-500'
  return 'bg-primary-500'
})

// ── Volume CRUD ──────────────────────────────────────────────────────────

function addVolume() {
  const name = props.serviceName ? volumeManager.suggestedVolumeName(props.serviceName) : ''
  const maxSize = remainingGb.value ?? 5
  const entries = [...props.modelValue, {
    source: '',
    target: '',
    sizeGb: Math.min(5, Math.max(1, maxSize)),
    readonly: false,
    mode: 'create' as const,
    displayName: name || 'data',
  }]
  emit('update:modelValue', entries)
}

function removeVolume(index: number) {
  const entries = [...props.modelValue]
  entries.splice(index, 1)
  emit('update:modelValue', entries)
}

function updateVolume(index: number, updates: Partial<VolumeEntry>) {
  const entries = [...props.modelValue]
  entries[index] = { ...entries[index]!, ...updates }
  emit('update:modelValue', entries)
}

function setExistingVolume(index: number, vol: VolumeInfo) {
  updateVolume(index, {
    source: vol.name,
    mode: 'existing',
    displayName: vol.displayName,
    sizeGb: vol.sizeGb,
  })
}

function switchToCreate(index: number) {
  const name = props.serviceName ? volumeManager.suggestedVolumeName(props.serviceName) : 'data'
  updateVolume(index, {
    source: '',
    mode: 'create',
    displayName: name,
    sizeGb: Math.min(5, Math.max(1, remainingGb.value ?? 5)),
  })
}

async function createAndAttach(index: number) {
  const entry = props.modelValue[index]!
  if (!entry.displayName || entry.source) return
  creating.value = index
  try {
    const vol = await volumeManager.createVolume(entry.displayName, entry.sizeGb)
    updateVolume(index, { source: vol.name })
    emit('volume-created', vol)
    await volumeManager.fetchQuota()
  } catch {
    // createError is set by volumeManager
  } finally {
    creating.value = null
  }
}

// Emit quota-exceeded when over quota
watch(isOverQuota, (v) => { if (v) emit('quota-exceeded') })

// ── Validation ───────────────────────────────────────────────────────────

const nameErrors = computed(() => {
  return props.modelValue.map(v => {
    if (v.mode !== 'create' || v.source) return null
    if (!v.displayName) return 'Name is required'
    if (!/^[a-z0-9][a-z0-9-]*$/.test(v.displayName)) return 'Lowercase letters, numbers, and hyphens only'
    if (volumeManager.accountVolumes.value.some(ev => ev.displayName === v.displayName)) return 'Name already exists'
    return null
  })
})

const isDbImage = computed(() => props.image ? volumeManager.isDatabaseImage(props.image) : false)
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div v-if="!compact" class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="p-1.5 rounded-lg bg-primary-50 dark:bg-primary-900/20">
          <HardDrive class="w-4 h-4 text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
            {{ $t('deploy.persistentStorage') || 'Persistent Storage' }}
          </h3>
          <p class="text-[11px] text-gray-500 dark:text-gray-400">
            Volumes persist data across restarts and redeployments
          </p>
        </div>
      </div>
      <button
        v-if="!disabled"
        type="button"
        @click="addVolume"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
      >
        <Plus class="w-3.5 h-3.5" />
        Add Volume
      </button>
    </div>

    <!-- Storage Quota Bar -->
    <div v-if="quota && quota.limitGb > 0" class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium text-gray-600 dark:text-gray-400">Storage Quota</span>
        <span class="text-xs tabular-nums" :class="isOverQuota ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-500 dark:text-gray-400'">
          {{ usedAfterDeploy.toFixed(1) }} / {{ quota.limitGb }} GB
          <span v-if="totalNewGb > 0" class="text-primary-600 dark:text-primary-400">(+{{ totalNewGb }} GB new)</span>
        </span>
      </div>

      <!-- Quota progress bar -->
      <div class="h-2.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden relative">
        <!-- Existing usage -->
        <div
          class="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          :class="quotaBarColor"
          :style="{ width: `${quotaPercent}%` }"
        />
        <!-- New volumes (lighter shade) -->
        <div
          v-if="totalNewGb > 0"
          class="absolute inset-y-0 rounded-full transition-all duration-500 opacity-50"
          :class="isOverQuota ? 'bg-red-400' : 'bg-primary-400'"
          :style="{ left: `${quotaPercent}%`, width: `${newPercent}%` }"
        />
      </div>

      <!-- Remaining indicator -->
      <div class="flex items-center justify-between mt-1.5">
        <span class="text-[10px] text-gray-400 dark:text-gray-500">
          {{ quota.usedGb.toFixed(1) }} GB used
        </span>
        <span v-if="!isOverQuota" class="text-[10px] text-gray-400 dark:text-gray-500">
          {{ (remainingAfterDeploy ?? 0).toFixed(1) }} GB remaining
        </span>
      </div>

      <!-- Over quota warning -->
      <div v-if="isOverQuota" class="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
        <AlertTriangle class="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
        <div class="flex-1 min-w-0">
          <p class="text-xs font-medium text-red-800 dark:text-red-200">Storage quota exceeded</p>
          <p class="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
            You need {{ (usedAfterDeploy - quota.limitGb).toFixed(1) }} GB more space.
            Reduce volume sizes or upgrade your plan.
          </p>
        </div>
        <button
          @click="router.push('/panel/billing')"
          class="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-medium transition-colors"
        >
          <ArrowUpCircle class="w-3 h-3" />
          Upgrade
        </button>
      </div>
    </div>

    <!-- DB auto-detect banner -->
    <div v-if="isDbImage && modelValue.length === 0 && !disabled" class="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
      <Database class="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
      <div class="flex-1">
        <p class="text-xs font-medium text-amber-800 dark:text-amber-200">{{ $t('deploy.dbWithoutVolume') || 'Database without persistent storage' }}</p>
        <p class="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
          {{ $t('deploy.dbWithoutVolumeDesc', { path: volumeManager.suggestedVolumePath(image!) }) || 'Data will be lost when the container restarts.' }}
        </p>
      </div>
      <button
        @click="autoDetectVolumes"
        class="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-medium transition-colors"
      >
        <Plus class="w-3 h-3" />
        Add Volume
      </button>
    </div>

    <!-- Volume cards -->
    <div class="space-y-3">
      <div
        v-for="(entry, i) in modelValue"
        :key="i"
        class="group rounded-xl border transition-colors"
        :class="entry.isAutoDetected
          ? 'border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'"
      >
        <!-- Card header -->
        <div class="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-700/50">
          <div class="flex items-center gap-2">
            <FolderOpen class="w-3.5 h-3.5 text-gray-400" />
            <span class="text-xs font-medium text-gray-700 dark:text-gray-300">
              Volume {{ i + 1 }}
            </span>
            <span v-if="entry.isAutoDetected" class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
              Auto-detected
            </span>
          </div>
          <div class="flex items-center gap-2">
            <label v-if="!disabled" class="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
              <input type="checkbox" :checked="entry.readonly" @change="updateVolume(i, { readonly: !entry.readonly })" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 w-3 h-3" />
              Read-only
            </label>
            <button v-if="!disabled" @click="removeVolume(i)" class="p-1 text-gray-400 hover:text-red-500 transition-colors">
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div class="p-4 space-y-3">
          <!-- Mode toggle: Create / Existing -->
          <div v-if="!disabled" class="flex gap-1 p-0.5 rounded-lg bg-gray-100 dark:bg-gray-700/50 w-fit">
            <button
              @click="switchToCreate(i)"
              class="px-3 py-1 rounded-md text-xs font-medium transition-colors"
              :class="entry.mode === 'create'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'"
            >
              Create New
            </button>
            <button
              @click="updateVolume(i, { mode: 'existing' })"
              class="px-3 py-1 rounded-md text-xs font-medium transition-colors"
              :class="entry.mode === 'existing'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'"
            >
              Use Existing
            </button>
          </div>

          <!-- Create mode -->
          <div v-if="entry.mode === 'create'" class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Name</label>
              <div class="relative">
                <input
                  :value="entry.displayName"
                  @input="updateVolume(i, { displayName: ($event.target as HTMLInputElement).value })"
                  type="text"
                  :disabled="!!entry.source || disabled"
                  :placeholder="serviceName ? volumeManager.suggestedVolumeName(serviceName) : 'volume-name'"
                  class="w-full px-2.5 py-1.5 rounded-lg border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                  :class="nameErrors[i]
                    ? 'border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-900/10'
                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white'"
                />
                <Check v-if="entry.source" class="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-green-500" />
              </div>
              <p v-if="nameErrors[i]" class="text-[10px] text-red-500 mt-0.5">{{ nameErrors[i] }}</p>
            </div>

            <div>
              <label class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Size</label>
              <div class="flex items-center gap-2">
                <input
                  :value="entry.sizeGb"
                  @input="updateVolume(i, { sizeGb: Math.max(1, Math.min(1000, parseInt(($event.target as HTMLInputElement).value) || 1)) })"
                  type="number"
                  min="1"
                  :max="Math.min(1000, (remainingGb ?? 1000) + entry.sizeGb)"
                  :disabled="!!entry.source || disabled"
                  class="w-20 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                />
                <span class="text-xs text-gray-400">GB</span>
                <button
                  v-if="!entry.source && !disabled"
                  @click="createAndAttach(i)"
                  :disabled="creating === i || !!nameErrors[i] || !entry.displayName"
                  class="ml-auto px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                >
                  <CompassSpinner v-if="creating === i" size="w-3.5 h-3.5" />
                  <template v-else>Create</template>
                </button>
              </div>
              <p v-if="volumeManager.createError.value && creating === i" class="text-[10px] text-red-500 mt-0.5">{{ volumeManager.createError.value }}</p>
            </div>

            <div>
              <label class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Mount Path</label>
              <input
                :value="entry.target"
                @input="updateVolume(i, { target: ($event.target as HTMLInputElement).value })"
                type="text"
                :disabled="disabled"
                placeholder="/var/data"
                class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
              />
            </div>
          </div>

          <!-- Existing volume mode -->
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Volume</label>
              <select
                :value="entry.source"
                @change="setExistingVolume(i, volumeManager.accountVolumes.value.find(v => v.name === ($event.target as HTMLSelectElement).value)!)"
                :disabled="disabled"
                class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
              >
                <option value="">Select a volume...</option>
                <option v-for="vol in volumeManager.accountVolumes.value" :key="vol.name" :value="vol.name">
                  {{ vol.displayName }} ({{ vol.usedGb?.toFixed(1) ?? 0 }}/{{ vol.sizeGb }} GB)
                </option>
              </select>
              <!-- Usage bar for selected volume -->
              <div v-if="entry.source" class="mt-1.5">
                <div class="h-1 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all duration-500"
                    :class="entry.sizeGb > 0 && (volumeManager.accountVolumes.value.find(v => v.name === entry.source)?.usedGb ?? 0) / entry.sizeGb > 0.9
                      ? 'bg-red-500'
                      : entry.sizeGb > 0 && (volumeManager.accountVolumes.value.find(v => v.name === entry.source)?.usedGb ?? 0) / entry.sizeGb > 0.7
                        ? 'bg-amber-500'
                        : 'bg-primary-500'"
                    :style="{ width: entry.sizeGb > 0 ? `${Math.min(100, ((volumeManager.accountVolumes.value.find(v => v.name === entry.source)?.usedGb ?? 0) / entry.sizeGb) * 100)}%` : '0%' }"
                  />
                </div>
              </div>
            </div>

            <div>
              <label class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Mount Path</label>
              <input
                :value="entry.target"
                @input="updateVolume(i, { target: ($event.target as HTMLInputElement).value })"
                type="text"
                :disabled="disabled"
                placeholder="/var/data"
                class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="modelValue.length === 0 && !isDbImage" class="text-center py-6 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
      <HardDrive class="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
      <p class="text-sm text-gray-500 dark:text-gray-400">No volumes configured</p>
      <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">Add a volume to persist data across restarts</p>
      <button
        v-if="!disabled"
        @click="addVolume"
        class="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
      >
        <Plus class="w-3.5 h-3.5" />
        Add Volume
      </button>
    </div>

    <!-- Compact add button -->
    <button
      v-if="compact && !disabled && modelValue.length > 0"
      @click="addVolume"
      class="w-full py-2 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400 hover:border-primary-300 dark:hover:border-primary-700 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
    >
      <Plus class="w-3.5 h-3.5 inline mr-1" />
      Add Another Volume
    </button>
  </div>
</template>
