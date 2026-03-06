<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Languages,
  Save,
  Trash2,
  Plus,
  Search,
  RotateCcw,
  Wand2,
  Globe,
  Check,
  X,
} from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'

const { t } = useI18n()
const api = useApi()

// ── Types ────────────────────────────────────────────────────────────────────

interface LocaleInfo {
  code: string
  name: string
  builtIn: boolean
  totalKeys: number
  translatedKeys: number
  overrideCount: number
}

interface TranslationKey {
  key: string
  namespace: string
  en: string
  value: string | null
  isOverridden: boolean
  isBuiltIn: boolean
}

interface LocalesResponse {
  builtIn: LocaleInfo[]
  custom: LocaleInfo[]
}

interface KeysResponse {
  namespaces: string[]
  keys: TranslationKey[]
  totalKeys: number
}

// ── State ────────────────────────────────────────────────────────────────────

const loading = ref(true)
const loadingKeys = ref(false)
const saving = ref(false)
const translating = ref(false)
const error = ref('')
const success = ref('')

const builtInLocales = ref<LocaleInfo[]>([])
const customLocales = ref<LocaleInfo[]>([])
const selectedLocale = ref<string | null>(null)

// Keys state
const namespaces = ref<string[]>([])
const allKeys = ref<TranslationKey[]>([])
const totalKeyCount = ref(0)
const selectedNamespace = ref('')
const searchQuery = ref('')

// Dirty state: tracks edited values
const dirtyValues = ref<Record<string, string>>({})

// Add locale form
const showAddForm = ref(false)
const newLocaleCode = ref('')
const newLocaleName = ref('')
const addingLocale = ref(false)

// Delete confirmation
const deleteConfirmCode = ref<string | null>(null)
const deletingLocale = ref(false)

// Auto-translate options
const overwriteExisting = ref(false)

// ── Computed ─────────────────────────────────────────────────────────────────

const allLocales = computed(() => [...builtInLocales.value, ...customLocales.value])

const selectedLocaleInfo = computed(() =>
  allLocales.value.find((l) => l.code === selectedLocale.value) ?? null,
)

const filteredKeys = computed(() => {
  let keys = allKeys.value

  if (selectedNamespace.value) {
    keys = keys.filter((k) => k.namespace === selectedNamespace.value)
  }

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    keys = keys.filter(
      (k) =>
        k.key.toLowerCase().includes(q) ||
        k.en.toLowerCase().includes(q) ||
        (k.value?.toLowerCase().includes(q) ?? false) ||
        (dirtyValues.value[k.key]?.toLowerCase().includes(q) ?? false),
    )
  }

  return keys
})

const stats = computed(() => {
  const keys = allKeys.value
  let translated = 0
  let overridden = 0
  let missing = 0

  for (const k of keys) {
    const hasDirty = k.key in dirtyValues.value
    const val = hasDirty ? dirtyValues.value[k.key] : k.value

    if (k.isOverridden || hasDirty) overridden++
    if (val) translated++
    else missing++
  }

  return { translated, overridden, missing }
})

const dirtyCount = computed(() => Object.keys(dirtyValues.value).length)

// ── API calls ────────────────────────────────────────────────────────────────

function clearMessages() {
  error.value = ''
  success.value = ''
}

function showSuccess(msg: string) {
  success.value = msg
  setTimeout(() => { success.value = '' }, 4000)
}

async function fetchLocales() {
  loading.value = true
  clearMessages()
  try {
    const data = await api.get<LocalesResponse>('/admin/i18n/locales')
    builtInLocales.value = data.builtIn
    customLocales.value = data.custom
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to load locales'
  } finally {
    loading.value = false
  }
}

async function fetchKeys(locale: string) {
  loadingKeys.value = true
  clearMessages()
  try {
    const data = await api.get<KeysResponse>(`/admin/i18n/keys?locale=${locale}`)
    namespaces.value = data.namespaces
    allKeys.value = data.keys
    totalKeyCount.value = data.totalKeys
    dirtyValues.value = {}
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to load translation keys'
  } finally {
    loadingKeys.value = false
  }
}

async function addLocale() {
  if (!newLocaleCode.value.trim() || !newLocaleName.value.trim()) return
  addingLocale.value = true
  clearMessages()
  try {
    await api.post('/admin/i18n/locales', {
      code: newLocaleCode.value.trim().toLowerCase(),
      name: newLocaleName.value.trim(),
    })
    showSuccess(t('super.translations.localeAdded'))
    newLocaleCode.value = ''
    newLocaleName.value = ''
    showAddForm.value = false
    await fetchLocales()
  } catch (err: any) {
    error.value = err?.body?.error || t('super.translations.localeExists')
  } finally {
    addingLocale.value = false
  }
}

async function deleteLocale(code: string) {
  deletingLocale.value = true
  clearMessages()
  try {
    await api.del(`/admin/i18n/locales/${code}`)
    showSuccess(t('super.translations.localeDeleted'))
    deleteConfirmCode.value = null
    if (selectedLocale.value === code) {
      selectedLocale.value = null
      allKeys.value = []
    }
    await fetchLocales()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to delete locale'
  } finally {
    deletingLocale.value = false
  }
}

function onValueChange(key: string, value: string) {
  const original = allKeys.value.find((k) => k.key === key)
  if (original && value === (original.value ?? '')) {
    delete dirtyValues.value[key]
  } else {
    dirtyValues.value[key] = value
  }
}

async function saveChanges() {
  if (dirtyCount.value === 0 || !selectedLocale.value) return
  saving.value = true
  clearMessages()
  try {
    await api.put(`/admin/i18n/overrides/${selectedLocale.value}`, {
      overrides: dirtyValues.value,
    })
    showSuccess(t('super.translations.saved', { count: dirtyCount.value }))
    // Refetch to get clean state
    await fetchKeys(selectedLocale.value)
    await fetchLocales()
  } catch (err: any) {
    error.value = err?.body?.error || t('super.translations.saveFailed')
  } finally {
    saving.value = false
  }
}

async function resetKey(key: string) {
  if (!selectedLocale.value) return
  clearMessages()
  try {
    await api.del(`/admin/i18n/overrides/${selectedLocale.value}/${encodeURIComponent(key)}`)
    showSuccess(t('super.translations.keyReset'))
    // Remove from dirty
    delete dirtyValues.value[key]
    // Refetch
    await fetchKeys(selectedLocale.value)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to reset key'
  }
}

async function autoTranslate(namespace?: string) {
  if (!selectedLocale.value) return
  translating.value = true
  clearMessages()
  try {
    const body: Record<string, unknown> = {
      sourceLocale: 'en',
      targetLocale: selectedLocale.value,
      overwriteExisting: overwriteExisting.value,
    }
    if (namespace) body.namespace = namespace
    const res = await api.post<{ translated: number; failed: number; skipped: number }>(
      '/admin/i18n/auto-translate',
      body,
    )
    showSuccess(t('super.translations.translateResult', { translated: res.translated, failed: res.failed }))
    await fetchKeys(selectedLocale.value)
    await fetchLocales()
  } catch (err: any) {
    const msg = err?.body?.error
    if (msg === 'Translation service not configured') {
      error.value = t('super.translations.translateNotConfigured')
    } else {
      error.value = msg || t('super.translations.translateFailed')
    }
  } finally {
    translating.value = false
  }
}

function getEffectiveValue(key: TranslationKey): string {
  if (key.key in dirtyValues.value) return dirtyValues.value[key.key]!
  return key.value ?? ''
}

function getStatusColor(key: TranslationKey): string {
  const val = getEffectiveValue(key)
  if (key.key in dirtyValues.value) return 'bg-yellow-400'
  if (key.isOverridden) return 'bg-blue-400'
  if (val) return 'bg-green-400'
  return 'bg-red-400'
}

// ── Watchers & lifecycle ─────────────────────────────────────────────────────

watch(selectedLocale, (code) => {
  if (code) {
    fetchKeys(code)
  } else {
    allKeys.value = []
    namespaces.value = []
    dirtyValues.value = {}
  }
})

onMounted(() => {
  fetchLocales()
})
</script>

<template>
  <div>
    <!-- Page header -->
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Languages class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('super.translations.title') }}</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{{ t('super.translations.description') }}</p>
        </div>
      </div>
    </div>

    <!-- Success alert -->
    <div v-if="success" class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center justify-between">
      <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
      <button @click="success = ''" class="text-green-500 hover:text-green-700"><X class="w-4 h-4" /></button>
    </div>

    <!-- Error alert -->
    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center justify-between">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      <button @click="error = ''" class="text-red-500 hover:text-red-700"><X class="w-4 h-4" /></button>
    </div>

    <!-- Loading -->
    <div v-if="loading && allLocales.length === 0" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-8 h-8" />
    </div>

    <!-- Main two-panel layout -->
    <div v-else class="flex flex-col lg:flex-row gap-6">

      <!-- ═══════════ Left panel — Locale list ═══════════ -->
      <div class="lg:w-72 shrink-0">

        <!-- Add locale button -->
        <button
          v-if="!showAddForm"
          @click="showAddForm = true"
          class="w-full flex items-center justify-center gap-2 px-4 py-2.5 mb-4 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          <Plus class="w-4 h-4" />
          {{ t('super.translations.addLocale') }}
        </button>

        <!-- Add locale form -->
        <div v-if="showAddForm" class="mb-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div>
            <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.translations.localeCode') }}</label>
            <input
              v-model="newLocaleCode"
              type="text"
              :placeholder="t('super.translations.localeCodePlaceholder')"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.translations.localeName') }}</label>
            <input
              v-model="newLocaleName"
              type="text"
              :placeholder="t('super.translations.localeNamePlaceholder')"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
            />
          </div>
          <div class="flex gap-2">
            <button
              @click="addLocale"
              :disabled="addingLocale || !newLocaleCode.trim() || !newLocaleName.trim()"
              class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <CompassSpinner v-if="addingLocale" size="w-4 h-4" />
              <Check v-else class="w-4 h-4" />
              {{ t('super.translations.addLocale') }}
            </button>
            <button
              @click="showAddForm = false; newLocaleCode = ''; newLocaleName = ''"
              class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Built-in locales -->
        <div class="mb-3">
          <p class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">{{ t('super.translations.builtIn') }}</p>
          <nav class="space-y-1.5">
            <button
              v-for="locale in builtInLocales"
              :key="locale.code"
              @click="selectedLocale = locale.code"
              :class="[
                'w-full text-left px-3.5 py-3 rounded-lg border transition-colors',
                selectedLocale === locale.code
                  ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750',
              ]"
            >
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">{{ locale.name }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ locale.code }}</p>
                </div>
                <div class="text-right">
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {{ t('super.translations.progress', { count: locale.translatedKeys, total: locale.totalKeys }) }}
                  </p>
                  <p v-if="locale.overrideCount > 0" class="text-[10px] text-blue-500 mt-0.5">
                    {{ locale.overrideCount }} {{ t('super.translations.overridden').toLowerCase() }}
                  </p>
                </div>
              </div>
            </button>
          </nav>
        </div>

        <!-- Custom locales -->
        <div v-if="customLocales.length > 0" class="mb-3">
          <p class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">{{ t('super.translations.custom') }}</p>
          <nav class="space-y-1.5">
            <div
              v-for="locale in customLocales"
              :key="locale.code"
              class="relative"
            >
              <button
                @click="selectedLocale = locale.code"
                :class="[
                  'w-full text-left px-3.5 py-3 rounded-lg border transition-colors',
                  selectedLocale === locale.code
                    ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750',
                ]"
              >
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-gray-900 dark:text-white">{{ locale.name }}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ locale.code }}</p>
                  </div>
                  <div class="text-right">
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      {{ t('super.translations.progress', { count: locale.translatedKeys, total: locale.totalKeys }) }}
                    </p>
                  </div>
                </div>
              </button>

              <!-- Delete button -->
              <button
                v-if="deleteConfirmCode !== locale.code"
                @click.stop="deleteConfirmCode = locale.code"
                class="absolute top-2 right-2 p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                :title="t('super.translations.deleteLocale')"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>

              <!-- Delete confirm -->
              <div v-if="deleteConfirmCode === locale.code" class="mt-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p class="text-xs text-red-700 dark:text-red-300 mb-2">
                  {{ t('super.translations.deleteLocaleConfirm', { name: locale.name, code: locale.code }) }}
                </p>
                <div class="flex gap-2">
                  <button
                    @click="deleteLocale(locale.code)"
                    :disabled="deletingLocale"
                    class="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white transition-colors"
                  >
                    <CompassSpinner v-if="deletingLocale" size="w-3 h-3" class="inline mr-1" />
                    {{ t('super.translations.deleteLocale') }}
                  </button>
                  <button
                    @click="deleteConfirmCode = null"
                    class="px-3 py-1.5 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    {{ t('common.cancel') }}
                  </button>
                </div>
              </div>
            </div>
          </nav>
        </div>
      </div>

      <!-- ═══════════ Right panel — Key editor ═══════════ -->
      <div class="flex-1 min-w-0">
        <!-- No locale selected -->
        <div
          v-if="!selectedLocale"
          class="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500"
        >
          <Globe class="w-12 h-12 mb-3 opacity-50" />
          <p class="text-sm">{{ t('super.translations.selectLocale') }}</p>
        </div>

        <!-- Locale selected -->
        <template v-else>
          <!-- Header bar -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-4">
            <div class="px-5 py-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                    {{ t('super.translations.editingLocale', { name: selectedLocaleInfo?.name ?? selectedLocale }) }}
                  </h2>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {{ t('super.translations.stats', { translated: stats.translated, overridden: stats.overridden, missing: stats.missing }) }}
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <!-- Auto-translate dropdown -->
                  <div class="relative group">
                    <button
                      :disabled="translating"
                      class="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                    >
                      <CompassSpinner v-if="translating" size="w-4 h-4" />
                      <Wand2 v-else class="w-4 h-4" />
                      {{ t('super.translations.autoTranslate') }}
                    </button>
                    <div class="absolute right-0 mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 z-20 hidden group-hover:block">
                      <label class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 mb-3 cursor-pointer">
                        <input v-model="overwriteExisting" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                        {{ t('super.translations.overwriteExisting') }}
                      </label>
                      <button
                        v-if="selectedNamespace"
                        @click="autoTranslate(selectedNamespace)"
                        :disabled="translating"
                        class="w-full mb-2 px-3 py-2 rounded-lg text-xs font-medium bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/30 disabled:opacity-50 transition-colors text-left"
                      >
                        {{ t('super.translations.autoTranslateNamespace') }} ({{ selectedNamespace }})
                      </button>
                      <button
                        @click="autoTranslate()"
                        :disabled="translating"
                        class="w-full px-3 py-2 rounded-lg text-xs font-medium bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors"
                      >
                        {{ t('super.translations.autoTranslateAll') }}
                      </button>
                    </div>
                  </div>

                  <!-- Save button -->
                  <button
                    @click="saveChanges"
                    :disabled="saving || dirtyCount === 0"
                    class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    <CompassSpinner v-if="saving" size="w-4 h-4" />
                    <Save v-else class="w-4 h-4" />
                    {{ dirtyCount > 0 ? `${t('super.translations.saveChanges')} (${dirtyCount})` : t('super.translations.saveChanges') }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Filters row -->
            <div class="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-3">
              <!-- Namespace filter -->
              <select
                v-model="selectedNamespace"
                class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">{{ t('super.translations.allNamespaces') }} ({{ totalKeyCount }})</option>
                <option v-for="ns in namespaces" :key="ns" :value="ns">{{ ns }}</option>
              </select>

              <!-- Search -->
              <div class="flex-1 min-w-[200px] relative">
                <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  v-model="searchQuery"
                  type="text"
                  :placeholder="t('super.translations.searchKeys')"
                  class="w-full pl-9 pr-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 text-xs"
                />
              </div>

              <span class="text-xs text-gray-400 dark:text-gray-500">
                {{ filteredKeys.length }} {{ t('super.translations.key').toLowerCase() }}{{ filteredKeys.length !== 1 ? 's' : '' }}
              </span>
            </div>
          </div>

          <!-- Loading keys -->
          <div v-if="loadingKeys" class="flex items-center justify-center py-16">
            <CompassSpinner />
          </div>

          <!-- Keys table -->
          <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full">
                <thead>
                  <tr class="border-b border-gray-200 dark:border-gray-700">
                    <th class="w-6 px-3 py-3"></th>
                    <th class="px-3 py-3 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('super.translations.key') }}</th>
                    <th class="px-3 py-3 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-[35%]">{{ t('super.translations.englishDefault') }}</th>
                    <th class="px-3 py-3 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-[35%]">{{ t('super.translations.currentValue') }}</th>
                    <th class="w-10 px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-gray-700/50">
                  <tr v-if="filteredKeys.length === 0">
                    <td colspan="5" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                      {{ searchQuery ? 'No keys match your search' : 'No keys found' }}
                    </td>
                  </tr>
                  <tr
                    v-for="key in filteredKeys"
                    :key="key.key"
                    class="hover:bg-gray-50/50 dark:hover:bg-gray-750/50 transition-colors"
                  >
                    <!-- Status dot -->
                    <td class="px-3 py-2">
                      <div
                        :class="['w-2 h-2 rounded-full', getStatusColor(key)]"
                        :title="key.isOverridden ? t('super.translations.overridden') : (getEffectiveValue(key) ? t('super.translations.translated') : t('super.translations.untranslated'))"
                      />
                    </td>

                    <!-- Key path -->
                    <td class="px-3 py-2">
                      <code class="text-[11px] text-gray-600 dark:text-gray-400 font-mono break-all">{{ key.key }}</code>
                    </td>

                    <!-- English default -->
                    <td class="px-3 py-2">
                      <span class="text-xs text-gray-500 dark:text-gray-400 break-words">{{ key.en }}</span>
                    </td>

                    <!-- Editable value -->
                    <td class="px-3 py-2">
                      <input
                        :value="getEffectiveValue(key)"
                        @input="onValueChange(key.key, ($event.target as HTMLInputElement).value)"
                        type="text"
                        :placeholder="key.en"
                        :class="[
                          'w-full px-2.5 py-1.5 rounded border text-xs transition-colors',
                          key.key in dirtyValues
                            ? 'border-yellow-400 dark:border-yellow-600 bg-yellow-50 dark:bg-yellow-900/10'
                            : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700',
                          'text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-primary-500',
                        ]"
                      />
                    </td>

                    <!-- Reset button -->
                    <td class="px-3 py-2">
                      <button
                        v-if="key.isOverridden || key.key in dirtyValues"
                        @click="resetKey(key.key)"
                        class="p-1 rounded text-gray-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                        :title="t('super.translations.resetKey')"
                      >
                        <RotateCcw class="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
