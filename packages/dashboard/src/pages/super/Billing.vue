<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { CreditCard, DollarSign, Save, Loader2, Plus, Trash2, RefreshCw, MapPin, Shield, Users, Gauge, Info, ExternalLink, Clock } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const { t } = useI18n()
const api = useApi()

const loading = ref(true)
const saving = ref(false)
const savingConfig = ref(false)
const savingPricing = ref(false)
const savingLimits = ref(false)
const syncing = ref(false)
const error = ref('')
const success = ref('')

// ─── Billing Config ──────────────────────────────────────────
const billingModel = ref('fixed')
const allowUserChoice = ref(false)
const allowedCycles = ref<string[]>(['monthly', 'yearly'])
const trialDays = ref(0)
const cycleDiscounts = ref<Record<string, { type: string; value: number }>>({})

// ─── Data Lifecycle ──────────────────────────────────────────
const suspensionGraceDays = ref(7)
const deletionGraceDays = ref(14)
const autoSuspendEnabled = ref(true)
const autoDeleteEnabled = ref(false)
const suspensionWarningDays = ref(2)
const deletionWarningDays = ref(7)
const volumeDeletionEnabled = ref(true)
const purgeEnabled = ref(true)
const purgeRetentionDays = ref(30)
const savingLifecycle = ref(false)

// ─── Plans ───────────────────────────────────────────────────
const plans = ref<any[]>([])
const showPlanForm = ref(false)
const editingPlan = ref<any>(null)
const planForm = ref({
  name: '', slug: '', description: '', sortOrder: 0,
  isDefault: false, isFree: false, visible: true,
  cpuLimit: 1000, memoryLimit: 512, containerLimit: 5,
  storageLimit: 10, bandwidthLimit: 0, priceCents: 0,
})

// ─── Usage Pricing ───────────────────────────────────────────
const pricing = ref({
  cpuCentsPerHour: 0, memoryCentsPerGbHour: 0,
  storageCentsPerGbMonth: 0, bandwidthCentsPerGb: 0,
  containerCentsPerHour: 0, domainMarkupPercent: 0,
  backupStorageCentsPerGb: 0, locationPricingEnabled: false,
})

// ─── Location Multipliers ────────────────────────────────────
const locations = ref<any[]>([])
const newLocation = ref({ locationKey: '', label: '', multiplier: 100 })

// ─── Resource Limits (Global) ────────────────────────────────
const resourceLimitsForm = ref({
  maxCpuPerContainer: null as number | null,
  maxMemoryPerContainer: null as number | null,
  maxReplicas: null as number | null,
  maxContainers: null as number | null,
  maxStorageGb: null as number | null,
  maxBandwidthGb: null as number | null,
  maxNfsStorageGb: null as number | null,
  maxTotalCpuCores: null as number | null,
  maxTotalMemoryMb: null as number | null,
})

// ─── Subscriptions ───────────────────────────────────────────
const subs = ref<any[]>([])

// ─── Account Overrides ───────────────────────────────────────
const overrides = ref<any[]>([])

const allCycles = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'half_yearly', label: 'Half Yearly' },
  { id: 'yearly', label: 'Yearly' },
]

function toggleCycle(cycleId: string) {
  const idx = allowedCycles.value.indexOf(cycleId)
  if (idx >= 0) {
    if (allowedCycles.value.length > 1) {
      allowedCycles.value.splice(idx, 1)
      delete cycleDiscounts.value[cycleId]
    }
  } else {
    allowedCycles.value.push(cycleId)
  }
}

function setDiscount(cycleId: string, type: string, value: number) {
  if (type === 'none') {
    delete cycleDiscounts.value[cycleId]
  } else {
    cycleDiscounts.value[cycleId] = { type, value }
  }
}

function getDiscountType(cycleId: string): string {
  return cycleDiscounts.value[cycleId]?.type ?? 'none'
}

function getDiscountValue(cycleId: string): number {
  return cycleDiscounts.value[cycleId]?.value ?? 0
}

function openPlanForm(plan?: any) {
  if (plan) {
    editingPlan.value = plan
    planForm.value = { ...plan }
  } else {
    editingPlan.value = null
    planForm.value = {
      name: '', slug: '', description: '', sortOrder: 0,
      isDefault: false, isFree: false, visible: true,
      cpuLimit: 1000, memoryLimit: 512, containerLimit: 5,
      storageLimit: 10, bandwidthLimit: 0, priceCents: 0,
    }
  }
  showPlanForm.value = true
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

async function fetchAll() {
  loading.value = true
  try {
    const [configData, plansData, pricingData, locData, limitsData, subsData, overridesData] = await Promise.all([
      api.get<any>('/billing/config'),
      api.get<any[]>('/billing/admin/plans'),
      api.get<any>('/billing/admin/pricing'),
      api.get<any[]>('/billing/admin/locations'),
      api.get<any>('/billing/admin/resource-limits'),
      api.get<any[]>('/billing/admin/subscriptions'),
      api.get<any[]>('/billing/admin/account-overrides'),
    ])

    billingModel.value = configData.billingModel ?? 'fixed'
    allowUserChoice.value = configData.allowUserChoice ?? false
    allowedCycles.value = configData.allowedCycles ?? ['monthly', 'yearly']
    cycleDiscounts.value = configData.cycleDiscounts ?? {}
    trialDays.value = configData.trialDays ?? 0
    suspensionGraceDays.value = configData.suspensionGraceDays ?? 7
    deletionGraceDays.value = configData.deletionGraceDays ?? 14
    autoSuspendEnabled.value = configData.autoSuspendEnabled ?? true
    autoDeleteEnabled.value = configData.autoDeleteEnabled ?? false
    suspensionWarningDays.value = configData.suspensionWarningDays ?? 2
    deletionWarningDays.value = configData.deletionWarningDays ?? 7
    volumeDeletionEnabled.value = configData.volumeDeletionEnabled ?? true
    purgeEnabled.value = configData.purgeEnabled ?? true
    purgeRetentionDays.value = configData.purgeRetentionDays ?? 30

    plans.value = plansData
    pricing.value = { ...pricing.value, ...pricingData }
    locations.value = locData
    resourceLimitsForm.value = { ...resourceLimitsForm.value, ...limitsData }
    subs.value = subsData
    overrides.value = overridesData
  } catch {
    error.value = 'Failed to load billing settings'
  } finally {
    loading.value = false
  }
}

async function saveBillingConfig() {
  savingConfig.value = true
  error.value = ''
  try {
    await api.patch('/billing/config', {
      billingModel: billingModel.value,
      allowUserChoice: allowUserChoice.value,
      allowedCycles: allowedCycles.value,
      cycleDiscounts: cycleDiscounts.value,
      trialDays: trialDays.value,
    })
    showSuccess('Billing configuration saved')
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save billing config'
  } finally {
    savingConfig.value = false
  }
}

async function saveLifecycleConfig() {
  savingLifecycle.value = true
  error.value = ''
  try {
    await api.patch('/billing/config', {
      suspensionGraceDays: suspensionGraceDays.value,
      deletionGraceDays: deletionGraceDays.value,
      autoSuspendEnabled: autoSuspendEnabled.value,
      autoDeleteEnabled: autoDeleteEnabled.value,
      suspensionWarningDays: suspensionWarningDays.value,
      deletionWarningDays: deletionWarningDays.value,
      volumeDeletionEnabled: volumeDeletionEnabled.value,
      purgeEnabled: purgeEnabled.value,
      purgeRetentionDays: purgeRetentionDays.value,
    })
    showSuccess('Lifecycle configuration saved')
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save lifecycle config'
  } finally {
    savingLifecycle.value = false
  }
}

async function savePlan() {
  saving.value = true
  error.value = ''
  try {
    if (editingPlan.value) {
      await api.patch(`/billing/admin/plans/${editingPlan.value.id}`, planForm.value)
    } else {
      await api.post('/billing/admin/plans', planForm.value)
    }
    showPlanForm.value = false
    showSuccess('Plan saved')
    const data = await api.get<any[]>('/billing/admin/plans')
    plans.value = data
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save plan'
  } finally {
    saving.value = false
  }
}

async function deletePlan(id: string) {
  if (!confirm('This will hide the plan. Continue?')) return
  try {
    await api.del(`/billing/admin/plans/${id}`)
    plans.value = plans.value.filter(p => p.id !== id)
    showSuccess('Plan hidden')
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to delete plan'
  }
}

async function syncPlan(id: string) {
  syncing.value = true
  try {
    await api.post(`/billing/admin/plans/${id}/sync-stripe`, {})
    showSuccess('Plan synced to Stripe')
  } catch (err: any) {
    error.value = err?.body?.error || 'Stripe sync failed'
  } finally {
    syncing.value = false
  }
}

async function syncAllPlans() {
  syncing.value = true
  try {
    const res = await api.post<any>('/billing/admin/plans/sync-all', {})
    showSuccess(res.message || 'All plans synced')
  } catch (err: any) {
    error.value = err?.body?.error || 'Stripe sync failed'
  } finally {
    syncing.value = false
  }
}

async function savePricingConfig() {
  savingPricing.value = true
  error.value = ''
  try {
    await api.patch('/billing/admin/pricing', pricing.value)
    showSuccess('Usage pricing saved')
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save pricing'
  } finally {
    savingPricing.value = false
  }
}

async function addLocation() {
  try {
    const loc = await api.post<any>('/billing/admin/locations', newLocation.value)
    locations.value.push(loc)
    newLocation.value = { locationKey: '', label: '', multiplier: 100 }
    showSuccess('Location added')
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to add location'
  }
}

async function removeLocation(id: string) {
  try {
    await api.del(`/billing/admin/locations/${id}`)
    locations.value = locations.value.filter(l => l.id !== id)
    showSuccess('Location removed')
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to remove location'
  }
}

async function saveResourceLimits() {
  savingLimits.value = true
  error.value = ''
  try {
    await api.patch('/billing/admin/resource-limits', resourceLimitsForm.value)
    showSuccess('Resource limits saved')
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save resource limits'
  } finally {
    savingLimits.value = false
  }
}

function showSuccess(msg: string) {
  success.value = msg
  setTimeout(() => { success.value = '' }, 3000)
}

onMounted(() => { fetchAll() })
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <CreditCard class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('super.billing.platformBilling') }}</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <template v-else>
      <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>
      <div v-if="success" class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
        <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
      </div>

      <!-- Stripe Payment Methods Notice -->
      <div class="mb-8 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div class="flex gap-3">
          <Info class="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div>
            <h3 class="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-1.5">{{ t('super.billing.stripePaymentMethods') }}</h3>
            <p class="text-sm text-blue-700 dark:text-blue-300 mb-2">{{ t('super.billing.stripePaymentMethodsDesc') }}</p>
            <ol class="text-sm text-blue-700 dark:text-blue-300 list-decimal list-inside space-y-1">
              <li>{{ t('super.billing.stripeStep1') }}</li>
              <li>{{ t('super.billing.stripeStep2') }}</li>
              <li>{{ t('super.billing.stripeStep3') }}</li>
            </ol>
          </div>
        </div>
      </div>

      <!-- Section 1: Billing Model Configuration -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('super.billing.billingModel') }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('super.billing.billingModelDesc') }}</p>
        </div>
        <form @submit.prevent="saveBillingConfig" class="p-6 space-y-6">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button v-for="m in [{ id: 'fixed', title: t('super.billing.fixedPrice'), desc: t('super.billing.fixedPriceDesc') }, { id: 'usage', title: t('super.billing.usageBased'), desc: t('super.billing.usageBasedDesc') }, { id: 'hybrid', title: t('super.billing.hybrid'), desc: t('super.billing.hybridDesc') }]"
              :key="m.id" type="button" @click="billingModel = m.id"
              :class="['p-4 rounded-lg border-2 text-left transition-colors', billingModel === m.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300']"
            >
              <p class="font-medium text-gray-900 dark:text-white text-sm">{{ m.title }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ m.desc }}</p>
            </button>
          </div>

          <div class="flex items-center gap-3">
            <input id="allowUserChoice" type="checkbox" v-model="allowUserChoice" class="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
            <label for="allowUserChoice" class="text-sm text-gray-700 dark:text-gray-300">{{ t('super.billing.allowUserChoice') }}</label>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{{ t('super.billing.billingCycles') }}</label>
            <div class="flex flex-wrap gap-2">
              <button v-for="cycle in allCycles" :key="cycle.id" type="button" @click="toggleCycle(cycle.id)"
                :class="['px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors', allowedCycles.includes(cycle.id) ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400']"
              >{{ cycle.label }}</button>
            </div>
          </div>

          <div v-if="allowedCycles.length > 0">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{{ t('super.billing.cycleDiscounts') }}</label>
            <div class="space-y-3">
              <div v-for="cycle in allCycles.filter(c => allowedCycles.includes(c.id))" :key="cycle.id"
                class="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600"
              >
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300 w-24 shrink-0">{{ cycle.label }}</span>
                <select :value="getDiscountType(cycle.id)" @change="setDiscount(cycle.id, ($event.target as HTMLSelectElement).value, getDiscountValue(cycle.id))"
                  class="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="none">{{ t('super.billing.noDiscount') }}</option>
                  <option value="percentage">{{ t('super.billing.percentOff') }}</option>
                  <option value="fixed">{{ t('super.billing.fixedOff') }}</option>
                </select>
                <template v-if="getDiscountType(cycle.id) !== 'none'">
                  <div class="relative">
                    <span v-if="getDiscountType(cycle.id) === 'percentage'" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                    <span v-else class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input type="number" step="0.01" min="0" :value="getDiscountValue(cycle.id)"
                      @input="setDiscount(cycle.id, getDiscountType(cycle.id), Number(($event.target as HTMLInputElement).value))"
                      :class="['w-28 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500', getDiscountType(cycle.id) === 'percentage' ? 'px-3 pr-8' : 'pl-8 pr-3']"
                    />
                  </div>
                </template>
              </div>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('super.billing.freeTrial') }}</label>
            <input v-model.number="trialDays" type="number" min="0" placeholder="0" class="w-32 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>

          <div class="pt-2 flex justify-end">
            <button type="submit" :disabled="savingConfig" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              <Loader2 v-if="savingConfig" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" />
              {{ savingConfig ? t('common.saving') : t('super.billing.saveBillingConfig') }}
            </button>
          </div>
        </form>
      </div>

      <!-- Section: Data Lifecycle -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2">
            <Clock class="w-5 h-5 text-amber-500" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('super.billing.dataLifecycle') }}</h2>
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('super.billing.dataLifecycleDesc') }}</p>
        </div>
        <form @submit.prevent="saveLifecycleConfig" class="p-6 space-y-6">
          <!-- Suspension subsection -->
          <div>
            <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">{{ t('super.billing.suspensionSettings') }}</h3>
            <div class="space-y-4">
              <label class="flex items-center gap-3">
                <input type="checkbox" v-model="autoSuspendEnabled" class="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('super.billing.autoSuspend') }}</span>
              </label>
              <div v-if="autoSuspendEnabled" class="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-8">
                <div>
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.suspensionGraceDays') }}</label>
                  <input v-model.number="suspensionGraceDays" type="number" min="1" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.suspensionWarningDays') }}</label>
                  <input v-model.number="suspensionWarningDays" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              </div>
            </div>
          </div>

          <!-- Deletion subsection -->
          <div>
            <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">{{ t('super.billing.deletionSettings') }}</h3>
            <div class="space-y-4">
              <label class="flex items-center gap-3">
                <input type="checkbox" v-model="autoDeleteEnabled" class="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('super.billing.autoDelete') }}</span>
              </label>
              <div v-if="autoDeleteEnabled" class="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-8">
                <div>
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.deletionGraceDays') }}</label>
                  <input v-model.number="deletionGraceDays" type="number" min="1" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.deletionWarningDays') }}</label>
                  <input v-model.number="deletionWarningDays" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              </div>
              <label class="flex items-center gap-3 pl-8" v-if="autoDeleteEnabled">
                <input type="checkbox" v-model="volumeDeletionEnabled" class="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('super.billing.volumeDeletion') }}</span>
              </label>
            </div>
          </div>

          <!-- Permanent purge subsection -->
          <div>
            <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">{{ t('super.billing.permanentPurge') }}</h3>
            <div class="space-y-4">
              <label class="flex items-center gap-3">
                <input type="checkbox" v-model="purgeEnabled" class="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('super.billing.purgeEnabled') }}</span>
              </label>
              <div v-if="purgeEnabled" class="pl-8">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.purgeRetentionDays') }}</label>
                <input v-model.number="purgeRetentionDays" type="number" min="1" class="w-32 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>
          </div>

          <div class="pt-2 flex justify-end">
            <button type="submit" :disabled="savingLifecycle" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              <Loader2 v-if="savingLifecycle" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" />
              {{ savingLifecycle ? t('common.saving') : t('super.billing.saveLifecycle') }}
            </button>
          </div>
        </form>
      </div>

      <!-- Section 2: Plan Tiers -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8 overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('super.billing.planTiers') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('super.billing.planTiersDesc') }}</p>
          </div>
          <div class="flex gap-2 shrink-0">
            <button @click="syncAllPlans" :disabled="syncing" class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors whitespace-nowrap">
              <RefreshCw :class="['w-4 h-4 shrink-0', syncing ? 'animate-spin' : '']" /> {{ t('super.billing.syncAllStripe') }}
            </button>
            <button @click="openPlanForm()" class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors whitespace-nowrap">
              <Plus class="w-4 h-4 shrink-0" /> {{ t('super.billing.addPlan') }}
            </button>
          </div>
        </div>

        <!-- Plan form modal -->
        <div v-if="showPlanForm" class="p-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
          <form @submit.prevent="savePlan" class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div class="sm:col-span-2">
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.planName') }}</label>
                <input v-model="planForm.name" required class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.planSlug') }}</label>
                <input v-model="planForm.slug" required pattern="[a-z0-9-]+" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.monthlyPrice') }}</label>
                <input v-model.number="planForm.priceCents" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.cpuLimit') }}</label>
                <input v-model.number="planForm.cpuLimit" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.memoryLimit') }}</label>
                <input v-model.number="planForm.memoryLimit" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.containerLimit') }}</label>
                <input v-model.number="planForm.containerLimit" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.storageLimit') }}</label>
                <input v-model.number="planForm.storageLimit" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.bandwidthLimit') }}</label>
                <input v-model.number="planForm.bandwidthLimit" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-4">
              <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" v-model="planForm.isFree" class="rounded border-gray-300 text-primary-600 focus:ring-primary-500" /> {{ t('super.billing.freeTier') }}
              </label>
              <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" v-model="planForm.isDefault" class="rounded border-gray-300 text-primary-600 focus:ring-primary-500" /> {{ t('super.billing.defaultPlan') }}
              </label>
              <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" v-model="planForm.visible" class="rounded border-gray-300 text-primary-600 focus:ring-primary-500" /> {{ t('super.billing.visible') }}
              </label>
            </div>
            <div class="flex gap-2 justify-end">
              <button type="button" @click="showPlanForm = false" class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">{{ t('common.cancel') }}</button>
              <button type="submit" :disabled="saving" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium">
                <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
                {{ editingPlan ? t('super.billing.updatePlan') : t('super.billing.createPlan') }}
              </button>
            </div>
          </form>
        </div>

        <div class="overflow-x-auto">
          <table v-if="plans.length > 0" class="w-full">
            <thead>
              <tr class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th class="px-6 py-3">{{ t('super.billing.planName') }}</th>
                <th class="px-6 py-3">{{ t('super.billing.planSlug') }}</th>
                <th class="px-6 py-3">{{ t('super.billing.price') }}</th>
                <th class="px-6 py-3">{{ t('super.billing.cpuMemContainers') }}</th>
                <th class="px-6 py-3">{{ t('super.billing.stripe') }}</th>
                <th class="px-6 py-3">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-for="plan in plans" :key="plan.id" :class="!plan.visible ? 'opacity-50' : ''">
                <td class="px-6 py-4 text-sm text-gray-900 dark:text-white font-medium whitespace-nowrap">
                  {{ plan.name }}
                  <span v-if="plan.isFree" class="ml-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs rounded">{{ t('super.billing.free') }}</span>
                  <span v-if="plan.isDefault" class="ml-1 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded">{{ t('super.billing.default') }}</span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 font-mono whitespace-nowrap">{{ plan.slug }}</td>
                <td class="px-6 py-4 text-sm text-gray-900 dark:text-white whitespace-nowrap">{{ formatCents(plan.priceCents) }}/mo</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{{ plan.cpuLimit }}mc / {{ plan.memoryLimit }}MB / {{ plan.containerLimit }}</td>
                <td class="px-6 py-4">
                  <span :class="plan.stripeProductId ? 'text-green-600 dark:text-green-400' : 'text-gray-400'" class="text-xs font-medium">
                    {{ plan.stripeProductId ? t('super.billing.synced') : t('super.billing.notSynced') }}
                  </span>
                </td>
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2">
                    <button @click="openPlanForm(plan)" class="text-xs text-primary-600 dark:text-primary-400 hover:underline">{{ t('common.edit') }}</button>
                    <button @click="syncPlan(plan.id)" :disabled="syncing" class="text-xs text-blue-600 dark:text-blue-400 hover:underline">{{ t('super.billing.sync') }}</button>
                    <button @click="deletePlan(plan.id)" class="text-xs text-red-600 dark:text-red-400 hover:underline">{{ t('super.billing.hide') }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('super.billing.noPlans') }}</div>
        </div>
      </div>

      <!-- Section 3: Usage-Based Pricing -->
      <div v-if="billingModel === 'usage' || billingModel === 'hybrid'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2">
            <Gauge class="w-5 h-5 text-orange-500" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('super.billing.usagePricing') }}</h2>
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('super.billing.usagePricingDesc') }}</p>
        </div>
        <form @submit.prevent="savePricingConfig" class="p-6 space-y-5">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.cpuPerCore') }}</label>
              <input v-model.number="pricing.cpuCentsPerHour" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.memPerGb') }}</label>
              <input v-model.number="pricing.memoryCentsPerGbHour" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.storagePerGb') }}</label>
              <input v-model.number="pricing.storageCentsPerGbMonth" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.bandwidthPerGb') }}</label>
              <input v-model.number="pricing.bandwidthCentsPerGb" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.buildMinute') }}</label>
              <input v-model.number="pricing.containerCentsPerHour" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.multiplier') }}</label>
              <input v-model.number="pricing.domainMarkupPercent" type="number" min="0" max="100" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.storagePerGb') }}</label>
              <input v-model.number="pricing.backupStorageCentsPerGb" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>
          <div class="pt-2 flex justify-end">
            <button type="submit" :disabled="savingPricing" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              <Loader2 v-if="savingPricing" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" />
              {{ savingPricing ? t('common.saving') : t('super.billing.saveUsagePricing') }}
            </button>
          </div>
        </form>
      </div>

      <!-- Section 4: Location Pricing -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <MapPin class="w-5 h-5 text-blue-500" />
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('super.billing.locationPricing') }}</h2>
            </div>
            <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" v-model="pricing.locationPricingEnabled" @change="savePricingConfig" class="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
              {{ t('super.billing.enable') }}
            </label>
          </div>
        </div>
        <div v-if="pricing.locationPricingEnabled" class="p-6 space-y-4">
          <div v-for="loc in locations" :key="loc.id" class="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
            <span class="text-sm font-mono text-gray-600 dark:text-gray-400 w-28">{{ loc.locationKey }}</span>
            <span class="text-sm text-gray-900 dark:text-white flex-1">{{ loc.label }}</span>
            <span class="text-sm text-gray-600 dark:text-gray-400">{{ (loc.multiplier / 100).toFixed(2) }}x</span>
            <button @click="removeLocation(loc.id)" class="text-red-500 hover:text-red-700 dark:hover:text-red-400">
              <Trash2 class="w-4 h-4" />
            </button>
          </div>
          <div class="flex items-end gap-3">
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.key') }}</label>
              <input v-model="newLocation.locationKey" placeholder="us-east" class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.label') }}</label>
              <input v-model="newLocation.label" placeholder="US East" class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.multiplier') }}</label>
              <input v-model.number="newLocation.multiplier" type="number" min="1" class="w-24 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <button @click="addLocation" class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">
              <Plus class="w-4 h-4" /> {{ t('common.add') }}
            </button>
          </div>
        </div>
        <div v-else class="px-6 py-6 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('super.billing.locationPricingDesc') }}</div>
      </div>

      <!-- Section 5: Global Resource Limits -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2">
            <Shield class="w-5 h-5 text-purple-500" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('super.billing.resourceLimits') }}</h2>
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('super.billing.resourceLimitsDesc') }}</p>
        </div>
        <form @submit.prevent="saveResourceLimits" class="p-6 space-y-5">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.maxCpu') }}</label>
              <input v-model.number="resourceLimitsForm.maxCpuPerContainer" type="number" min="0" placeholder="Unlimited" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.maxMemory') }}</label>
              <input v-model.number="resourceLimitsForm.maxMemoryPerContainer" type="number" min="0" placeholder="Unlimited" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.maxReplicas') }}</label>
              <input v-model.number="resourceLimitsForm.maxReplicas" type="number" min="0" placeholder="Unlimited" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.maxContainers') }}</label>
              <input v-model.number="resourceLimitsForm.maxContainers" type="number" min="0" placeholder="Unlimited" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.maxStorage') }}</label>
              <input v-model.number="resourceLimitsForm.maxStorageGb" type="number" min="0" placeholder="Unlimited" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.maxBandwidth') }}</label>
              <input v-model.number="resourceLimitsForm.maxBandwidthGb" type="number" min="0" placeholder="Unlimited" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('super.billing.maxNfsStorage') }}</label>
              <input v-model.number="resourceLimitsForm.maxNfsStorageGb" type="number" min="0" placeholder="Unlimited" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Total CPU Pool (cores)</label>
              <input v-model.number="resourceLimitsForm.maxTotalCpuCores" type="number" min="0" placeholder="Unlimited" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Total Memory Pool (MB)</label>
              <input v-model.number="resourceLimitsForm.maxTotalMemoryMb" type="number" min="0" placeholder="Unlimited" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>
          <div class="pt-2 flex justify-end">
            <button type="submit" :disabled="savingLimits" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              <Loader2 v-if="savingLimits" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" />
              {{ savingLimits ? t('common.saving') : t('super.billing.saveResourceLimits') }}
            </button>
          </div>
        </form>
      </div>

      <!-- Section 6: Subscriptions Overview -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2">
            <Users class="w-5 h-5 text-green-500" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('super.billing.subscriptions') }}</h2>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table v-if="subs.length > 0" class="w-full">
            <thead>
              <tr class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th class="px-6 py-3">{{ t('super.billing.account') }}</th>
                <th class="px-6 py-3">{{ t('super.billing.plan') }}</th>
                <th class="px-6 py-3">{{ t('super.billing.model') }}</th>
                <th class="px-6 py-3">{{ t('super.billing.cycle') }}</th>
                <th class="px-6 py-3">{{ t('common.status') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-for="sub in subs" :key="sub.id">
                <td class="px-6 py-4 text-sm text-gray-900 dark:text-white">{{ sub.account?.name ?? sub.accountId }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ sub.plan?.name ?? 'Usage only' }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 capitalize">{{ sub.billingModel }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ sub.billingCycle }}</td>
                <td class="px-6 py-4">
                  <span :class="[
                    'px-2 py-0.5 text-xs font-medium rounded-full',
                    sub.status === 'active' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                    sub.status === 'trialing' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                    'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  ]">{{ sub.status }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">{{ t('super.billing.noSubscriptions') }}</div>
        </div>
      </div>

      <!-- Section 7: Account Billing Overrides -->
      <div v-if="overrides.length > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2">
            <DollarSign class="w-5 h-5 text-yellow-500" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('super.billing.overrides') }}</h2>
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('super.billing.overridesDesc') }}</p>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th class="px-6 py-3">{{ t('super.billing.account') }}</th>
                <th class="px-6 py-3">{{ t('super.billing.discount') }}</th>
                <th class="px-6 py-3">{{ t('super.billing.notes') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-for="o in overrides" :key="o.id">
                <td class="px-6 py-4 text-sm text-gray-900 dark:text-white">{{ o.account?.name ?? o.accountId }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ o.discountPercent }}%</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ o.notes ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
