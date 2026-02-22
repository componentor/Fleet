<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import { Loader2, Save, RotateCcw, Cpu, CreditCard } from 'lucide-vue-next'

const props = defineProps<{ accountId: string }>()
const api = useApi()

const activeTab = ref<'resources' | 'billing'>('resources')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const success = ref('')

// Resource limits
const resourceGlobal = ref<Record<string, number | null>>({})
const resourceOverride = ref<Record<string, number | null>>({})

// Billing overrides
const billingOverride = ref<Record<string, any>>({
  discountPercent: 0,
  customPriceCents: null,
  notes: '',
  cpuCentsPerHourOverride: null,
  memoryCentsPerGbHourOverride: null,
  storageCentsPerGbMonthOverride: null,
  bandwidthCentsPerGbOverride: null,
  containerCentsPerHourOverride: null,
})

const resourceFields = [
  { key: 'maxCpuPerContainer', label: 'Max CPU/Container', unit: 'cores' },
  { key: 'maxMemoryPerContainer', label: 'Max Memory/Container', unit: 'MB' },
  { key: 'maxReplicas', label: 'Max Replicas', unit: '' },
  { key: 'maxContainers', label: 'Max Services', unit: '' },
  { key: 'maxStorageGb', label: 'Max Storage', unit: 'GB' },
  { key: 'maxBandwidthGb', label: 'Max Bandwidth', unit: 'GB' },
  { key: 'maxNfsStorageGb', label: 'Max NFS Storage', unit: 'GB' },
]

const billingFields = [
  { key: 'discountPercent', label: 'Discount', unit: '%', type: 'number', nullable: false },
  { key: 'customPriceCents', label: 'Custom Price', unit: 'cents', type: 'number', nullable: true },
  { key: 'cpuCentsPerHourOverride', label: 'CPU ¢/hr', unit: '', type: 'number', nullable: true },
  { key: 'memoryCentsPerGbHourOverride', label: 'Memory ¢/GB-hr', unit: '', type: 'number', nullable: true },
  { key: 'storageCentsPerGbMonthOverride', label: 'Storage ¢/GB-mo', unit: '', type: 'number', nullable: true },
  { key: 'bandwidthCentsPerGbOverride', label: 'Bandwidth ¢/GB', unit: '', type: 'number', nullable: true },
  { key: 'containerCentsPerHourOverride', label: 'Container ¢/hr', unit: '', type: 'number', nullable: true },
]

async function fetchData() {
  loading.value = true
  error.value = ''
  try {
    const [resources, billing] = await Promise.all([
      api.get<any>(`/billing/admin/resource-limits/${props.accountId}`),
      api.get<any>(`/billing/admin/account-overrides/${props.accountId}`),
    ])

    resourceGlobal.value = resources.global ?? {}
    resourceOverride.value = resources.override ?? {}

    if (billing) {
      billingOverride.value = {
        discountPercent: billing.discountPercent ?? 0,
        customPriceCents: billing.customPriceCents ?? null,
        notes: billing.notes ?? '',
        cpuCentsPerHourOverride: billing.cpuCentsPerHourOverride ?? null,
        memoryCentsPerGbHourOverride: billing.memoryCentsPerGbHourOverride ?? null,
        storageCentsPerGbMonthOverride: billing.storageCentsPerGbMonthOverride ?? null,
        bandwidthCentsPerGbOverride: billing.bandwidthCentsPerGbOverride ?? null,
        containerCentsPerHourOverride: billing.containerCentsPerHourOverride ?? null,
      }
    }
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to load overrides'
  } finally {
    loading.value = false
  }
}

async function saveResources() {
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await api.patch(`/billing/admin/resource-limits/${props.accountId}`, resourceOverride.value)
    success.value = 'Resource limits saved'
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save'
  } finally {
    saving.value = false
  }
}

async function resetResources() {
  if (!confirm('Reset resource limits to global defaults?')) return
  saving.value = true
  error.value = ''
  try {
    await api.del(`/billing/admin/resource-limits/${props.accountId}`)
    resourceOverride.value = {}
    success.value = 'Resource limits reset to global defaults'
    await fetchData()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to reset'
  } finally {
    saving.value = false
  }
}

async function saveBilling() {
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await api.patch(`/billing/admin/account-overrides/${props.accountId}`, billingOverride.value)
    success.value = 'Billing overrides saved'
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save'
  } finally {
    saving.value = false
  }
}

async function resetBilling() {
  if (!confirm('Reset billing overrides?')) return
  saving.value = true
  error.value = ''
  try {
    await api.del(`/billing/admin/account-overrides/${props.accountId}`)
    billingOverride.value = {
      discountPercent: 0,
      customPriceCents: null,
      notes: '',
      cpuCentsPerHourOverride: null,
      memoryCentsPerGbHourOverride: null,
      storageCentsPerGbMonthOverride: null,
      bandwidthCentsPerGbOverride: null,
      containerCentsPerHourOverride: null,
    }
    success.value = 'Billing overrides reset'
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to reset'
  } finally {
    saving.value = false
  }
}

watch(() => props.accountId, () => fetchData())
onMounted(() => fetchData())
</script>

<template>
  <div class="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800">
    <div class="max-w-7xl mx-auto px-4 py-4">
      <!-- Error/Success messages -->
      <div v-if="error" class="mb-3 p-2 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300">
        {{ error }}
      </div>
      <div v-if="success" class="mb-3 p-2 bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded text-xs text-green-700 dark:text-green-300">
        {{ success }}
      </div>

      <!-- Tab switcher -->
      <div class="flex items-center gap-2 mb-3">
        <button
          @click="activeTab = 'resources'"
          :class="[
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
            activeTab === 'resources'
              ? 'bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100'
              : 'text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30',
          ]"
        >
          <Cpu class="w-3.5 h-3.5" />
          Resource Limits
        </button>
        <button
          @click="activeTab = 'billing'"
          :class="[
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
            activeTab === 'billing'
              ? 'bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100'
              : 'text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30',
          ]"
        >
          <CreditCard class="w-3.5 h-3.5" />
          Billing
        </button>
      </div>

      <div v-if="loading" class="flex items-center justify-center py-4">
        <Loader2 class="w-5 h-5 text-amber-600 animate-spin" />
      </div>

      <template v-else>
        <!-- Resource Limits -->
        <div v-if="activeTab === 'resources'">
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div
              v-for="field in resourceFields"
              :key="field.key"
              class="bg-white dark:bg-gray-800 rounded-lg p-3 border border-amber-200 dark:border-gray-700"
            >
              <label class="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                {{ field.label }}
              </label>
              <div class="flex items-center gap-1.5">
                <input
                  v-model.number="resourceOverride[field.key]"
                  type="number"
                  min="0"
                  :placeholder="resourceGlobal[field.key] != null ? String(resourceGlobal[field.key]) : 'No limit'"
                  class="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <span v-if="field.unit" class="text-[10px] text-gray-400 shrink-0">{{ field.unit }}</span>
              </div>
              <div class="text-[10px] text-gray-400 mt-1">
                Global: {{ resourceGlobal[field.key] ?? '\u221E' }}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 mt-3">
            <button
              @click="saveResources"
              :disabled="saving"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              <Loader2 v-if="saving" class="w-3.5 h-3.5 animate-spin" />
              <Save v-else class="w-3.5 h-3.5" />
              Save
            </button>
            <button
              @click="resetResources"
              :disabled="saving"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
            >
              <RotateCcw class="w-3.5 h-3.5" />
              Reset to Global
            </button>
          </div>
        </div>

        <!-- Billing -->
        <div v-if="activeTab === 'billing'">
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div
              v-for="field in billingFields"
              :key="field.key"
              class="bg-white dark:bg-gray-800 rounded-lg p-3 border border-amber-200 dark:border-gray-700"
            >
              <label class="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                {{ field.label }}
              </label>
              <div class="flex items-center gap-1.5">
                <input
                  v-model.number="billingOverride[field.key]"
                  type="number"
                  min="0"
                  :placeholder="field.nullable ? 'None' : '0'"
                  class="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <span v-if="field.unit" class="text-[10px] text-gray-400 shrink-0">{{ field.unit }}</span>
              </div>
            </div>
            <!-- Notes field spans full width -->
            <div class="col-span-full bg-white dark:bg-gray-800 rounded-lg p-3 border border-amber-200 dark:border-gray-700">
              <label class="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Notes
              </label>
              <input
                v-model="billingOverride.notes"
                type="text"
                placeholder="Internal notes about this override"
                class="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>
          <div class="flex items-center gap-2 mt-3">
            <button
              @click="saveBilling"
              :disabled="saving"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              <Loader2 v-if="saving" class="w-3.5 h-3.5 animate-spin" />
              <Save v-else class="w-3.5 h-3.5" />
              Save
            </button>
            <button
              @click="resetBilling"
              :disabled="saving"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
            >
              <RotateCcw class="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
