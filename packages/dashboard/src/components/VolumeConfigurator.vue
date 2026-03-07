<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { HardDrive, Plus, X, Database, ChevronDown, AlertTriangle, ArrowUpCircle, Shield, Trash2 } from 'lucide-vue-next'
import { useVolumeManager, type VolumeInfo } from '@/composables/useVolumeManager'
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
  disabled?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [entries: VolumeEntry[]]
  'quota-exceeded': []
  'volume-created': [vol: VolumeInfo]
}>()

const router = useRouter()
const volumeManager = useVolumeManager()
const expandedCards = ref<Set<number>>(new Set())

onMounted(async () => {
  await volumeManager.fetchAll()
  autoDetectVolumes()
})

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

// ── Quota ────────────────────────────────────────────────────────────────

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

// ── Volume CRUD ──────────────────────────────────────────────────────────

function addStorage() {
  const name = props.serviceName ? volumeManager.suggestedVolumeName(props.serviceName) : 'data'
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
  expandedCards.value.add(entries.length - 1)
}

function removeVolume(index: number) {
  const entries = [...props.modelValue]
  entries.splice(index, 1)
  expandedCards.value.delete(index)
  emit('update:modelValue', entries)
}

function updateVolume(index: number, updates: Partial<VolumeEntry>) {
  const entries = [...props.modelValue]
  entries[index] = { ...entries[index]!, ...updates }
  emit('update:modelValue', entries)
}

function pickExisting(index: number, vol: VolumeInfo) {
  updateVolume(index, {
    source: vol.name,
    mode: 'existing',
    displayName: vol.displayName,
    sizeGb: vol.sizeGb,
  })
}

function toggleExpanded(index: number) {
  if (expandedCards.value.has(index)) {
    expandedCards.value.delete(index)
  } else {
    expandedCards.value.add(index)
  }
}

watch(isOverQuota, (v) => { if (v) emit('quota-exceeded') })

// ── Helpers ──────────────────────────────────────────────────────────────

const isDbImage = computed(() => props.image ? volumeManager.isDatabaseImage(props.image) : false)

function friendlyPath(target: string): string {
  if (!target) return ''
  const known: Record<string, string> = {
    '/var/lib/postgresql/data': 'PostgreSQL data',
    '/var/lib/mysql': 'MySQL data',
    '/data/db': 'MongoDB data',
    '/data': 'Application data',
    '/var/lib/clickhouse': 'ClickHouse data',
    '/var/lib/influxdb2': 'InfluxDB data',
    '/usr/share/elasticsearch/data': 'Elasticsearch data',
    '/var/lib/cassandra': 'Cassandra data',
    '/cockroach/cockroach-data': 'CockroachDB data',
  }
  return known[target] || target
}

function storageSummary(entry: VolumeEntry): string {
  if (entry.mode === 'existing' && entry.source) {
    return `Using "${entry.displayName}"`
  }
  return `${entry.sizeGb} GB — will be created on deploy`
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div v-if="!compact" class="flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <div class="p-2 rounded-xl bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-900/30 dark:to-primary-800/20">
          <HardDrive class="w-4.5 h-4.5 text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Storage</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Keep your data safe between restarts
          </p>
        </div>
      </div>
      <button
        v-if="!disabled"
        type="button"
        @click="addStorage"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors shadow-sm"
      >
        <Plus class="w-3.5 h-3.5" />
        Add Storage
      </button>
    </div>

    <!-- Storage usage bar (simple, visual) -->
    <div v-if="quota && quota.limitGb > 0" class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div class="flex items-center justify-between mb-2.5">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Your storage</span>
        <span class="text-sm tabular-nums font-medium" :class="isOverQuota ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'">
          {{ usedAfterDeploy.toFixed(1) }} / {{ quota.limitGb }} GB
        </span>
      </div>

      <!-- Visual bar -->
      <div class="h-3 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden relative">
        <div
          class="absolute inset-y-0 left-0 rounded-full transition-all duration-500 bg-primary-500"
          :style="{ width: `${quotaPercent}%` }"
        />
        <div
          v-if="totalNewGb > 0"
          class="absolute inset-y-0 rounded-full transition-all duration-500"
          :class="isOverQuota ? 'bg-red-400' : 'bg-primary-400 animate-pulse'"
          :style="{ left: `${quotaPercent}%`, width: `${newPercent}%` }"
        />
      </div>

      <div class="flex items-center justify-between mt-2">
        <span class="text-xs text-gray-500 dark:text-gray-400">
          {{ quota.usedGb.toFixed(1) }} GB used
        </span>
        <span v-if="totalNewGb > 0 && !isOverQuota" class="text-xs text-primary-600 dark:text-primary-400 font-medium">
          +{{ totalNewGb }} GB new
        </span>
        <span v-else-if="!isOverQuota" class="text-xs text-gray-400 dark:text-gray-500">
          {{ ((remainingGb ?? 0)).toFixed(1) }} GB free
        </span>
      </div>

      <!-- Over quota warning — friendly language -->
      <div v-if="isOverQuota" class="mt-3 flex items-start gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
        <AlertTriangle class="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-red-800 dark:text-red-200">Not enough space</p>
          <p class="text-xs text-red-600 dark:text-red-400 mt-1">
            You need {{ (usedAfterDeploy - quota.limitGb).toFixed(1) }} GB more.
            Try reducing the size below, or upgrade your plan for more space.
          </p>
        </div>
        <button
          @click="router.push('/panel/billing')"
          class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors"
        >
          <ArrowUpCircle class="w-3.5 h-3.5" />
          Get More Space
        </button>
      </div>
    </div>

    <!-- DB warning — friendly, not scary -->
    <div v-if="isDbImage && modelValue.length === 0 && !disabled" class="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
      <Database class="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
      <div class="flex-1">
        <p class="text-sm font-medium text-amber-800 dark:text-amber-200">Your database needs storage</p>
        <p class="text-xs text-amber-600 dark:text-amber-400 mt-1">
          Without storage, all your data will be lost when the app restarts.
          Add storage to keep everything safe.
        </p>
      </div>
      <button
        @click="autoDetectVolumes"
        class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors"
      >
        <Shield class="w-3.5 h-3.5" />
        Protect My Data
      </button>
    </div>

    <!-- Storage cards -->
    <div class="space-y-3">
      <div
        v-for="(entry, i) in modelValue"
        :key="i"
        class="rounded-xl border transition-all"
        :class="entry.isAutoDetected
          ? 'border-primary-300 dark:border-primary-700 bg-primary-50/30 dark:bg-primary-900/10 shadow-sm shadow-primary-100 dark:shadow-none'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'"
      >
        <!-- Card summary (always visible) -->
        <div
          class="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
          @click="toggleExpanded(i)"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div class="p-1.5 rounded-lg" :class="entry.isAutoDetected ? 'bg-primary-100 dark:bg-primary-900/30' : 'bg-gray-100 dark:bg-gray-700'">
              <HardDrive class="w-4 h-4" :class="entry.isAutoDetected ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'" />
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {{ entry.displayName || 'New storage' }}
                </span>
                <span v-if="entry.isAutoDetected" class="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300">
                  Recommended
                </span>
                <span v-if="entry.readonly" class="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                  Read-only
                </span>
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                <template v-if="entry.target">{{ friendlyPath(entry.target) }} &middot; </template>
                {{ storageSummary(entry) }}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              v-if="!disabled"
              @click.stop="removeVolume(i)"
              class="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
            >
              <Trash2 class="w-4 h-4" />
            </button>
            <ChevronDown
              class="w-4 h-4 text-gray-400 transition-transform duration-200"
              :class="{ 'rotate-180': expandedCards.has(i) }"
            />
          </div>
        </div>

        <!-- Expanded details -->
        <div v-if="expandedCards.has(i)" class="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-gray-700/50 space-y-4">

          <!-- Pick existing or create new -->
          <div v-if="!disabled && volumeManager.accountVolumes.value.length > 0" class="space-y-2">
            <p class="text-xs font-medium text-gray-600 dark:text-gray-400">Use an existing storage disk?</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="vol in volumeManager.accountVolumes.value"
                :key="vol.name"
                @click="pickExisting(i, vol)"
                class="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                :class="entry.source === vol.name
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                  : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-primary-300 dark:hover:border-primary-700'"
              >
                {{ vol.displayName }}
                <span class="text-gray-400 ml-1">{{ vol.sizeGb }} GB</span>
              </button>
              <button
                v-if="entry.mode === 'existing'"
                @click="updateVolume(i, { source: '', mode: 'create', displayName: serviceName ? volumeManager.suggestedVolumeName(serviceName) : 'data', sizeGb: Math.min(5, Math.max(1, remainingGb ?? 5)) })"
                class="px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
              >
                + Create new instead
              </button>
            </div>
          </div>

          <!-- Create new: name + size -->
          <div v-if="entry.mode === 'create'" class="space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Name</label>
                <input
                  :value="entry.displayName"
                  @input="updateVolume(i, { displayName: ($event.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })"
                  type="text"
                  :disabled="!!entry.source || disabled"
                  :placeholder="serviceName ? volumeManager.suggestedVolumeName(serviceName) : 'my-data'"
                  class="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Size</label>
                <div class="flex items-center gap-2">
                  <input
                    :value="entry.sizeGb"
                    @input="updateVolume(i, { sizeGb: Math.max(1, Math.min(1000, parseInt(($event.target as HTMLInputElement).value) || 1)) })"
                    type="number"
                    min="1"
                    :max="Math.min(1000, (remainingGb ?? 1000) + entry.sizeGb)"
                    :disabled="!!entry.source || disabled"
                    class="w-24 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                  />
                  <span class="text-sm text-gray-500 dark:text-gray-400">GB</span>
                </div>
              </div>
            </div>
            <p v-if="!entry.source" class="text-xs text-gray-400 dark:text-gray-500">
              This storage disk will be created automatically when you deploy.
            </p>
          </div>

          <!-- Where to save data (mount path) -->
          <div>
            <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Save data to
              <span class="font-normal text-gray-400 dark:text-gray-500">(path inside the container)</span>
            </label>
            <input
              :value="entry.target"
              @input="updateVolume(i, { target: ($event.target as HTMLInputElement).value })"
              type="text"
              :disabled="disabled"
              placeholder="/data"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
            />
          </div>

          <!-- Advanced: read-only toggle -->
          <label v-if="!disabled" class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              :checked="entry.readonly"
              @change="updateVolume(i, { readonly: !entry.readonly })"
              class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 w-4 h-4"
            />
            <span class="text-xs text-gray-600 dark:text-gray-400">Read-only (app can read but not write)</span>
          </label>
        </div>
      </div>
    </div>

    <!-- Empty state — warm and inviting -->
    <div v-if="modelValue.length === 0 && !isDbImage" class="text-center py-8 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
      <HardDrive class="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
      <p class="text-sm font-medium text-gray-600 dark:text-gray-400">No storage added yet</p>
      <p class="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-xs mx-auto">
        Storage keeps your files and data safe, even when your app restarts or gets updated.
      </p>
      <button
        v-if="!disabled"
        @click="addStorage"
        class="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors shadow-sm"
      >
        <Plus class="w-3.5 h-3.5" />
        Add Storage
      </button>
    </div>

    <!-- Compact add button -->
    <button
      v-if="compact && !disabled && modelValue.length > 0"
      @click="addStorage"
      class="w-full py-2.5 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400 hover:border-primary-300 dark:hover:border-primary-700 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
    >
      <Plus class="w-3.5 h-3.5 inline mr-1" />
      Add More Storage
    </button>
  </div>
</template>
