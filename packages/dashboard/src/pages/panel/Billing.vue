<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { CreditCard, Box, HardDrive, ExternalLink, Calendar, Gauge, Cpu, MemoryStick, Wifi, AlertTriangle, Trash2, Star, Plus } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useRole } from '@/composables/useRole'
import { useToast } from '@/composables/useToast'
import { useServiceBilling, usePlanLocale, type ServiceSubscription } from '@/composables/useServiceBilling'

const { t } = useI18n()
const router = useRouter()
const api = useApi()
const toast = useToast()
const { canOwner: isOwner } = useRole()
const serviceBilling = useServiceBilling()
const { planName } = usePlanLocale()

const loading = ref(true)
const config = ref<any>(null)
const usage = ref<any>(null)
const invoices = ref<any[]>([])
const limits = ref<any>(null)
const paymentMethods = ref<any[]>([])
const defaultPaymentMethodId = ref<string | null>(null)
const serviceSubscriptions = ref<ServiceSubscription[]>([])

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function cardBrandLabel(brand: string): string {
  switch (brand) {
    case 'visa': return 'Visa'
    case 'mastercard': return 'MC'
    case 'amex': return 'Amex'
    case 'discover': return 'Disc'
    default: return brand.charAt(0).toUpperCase() + brand.slice(1)
  }
}

async function fetchAll() {
  loading.value = true
  try {
    const [configData, usageData, invoiceData, limitsData, pmData, subs] = await Promise.all([
      api.get<any>('/billing/config'),
      api.get<any>('/billing/usage'),
      api.get<any[]>('/billing/invoices'),
      api.get<any>('/billing/resource-limits'),
      api.get<any>('/billing/payment-methods'),
      serviceBilling.listServiceSubscriptions(),
    ])
    config.value = configData
    usage.value = usageData
    invoices.value = invoiceData
    limits.value = limitsData
    paymentMethods.value = pmData?.methods ?? []
    defaultPaymentMethodId.value = pmData?.defaultId ?? null
    serviceSubscriptions.value = subs
  } catch {
    toast.error(t('billing.loadFailed', 'Failed to load billing data'))
  } finally {
    loading.value = false
  }
}

async function openPortal() {
  try {
    const res = await api.post<{ url: string }>('/billing/portal', {
      returnUrl: window.location.href,
    })
    if (res.url) window.location.href = res.url
  } catch {
    toast.error(t('billing.portalFailed', 'Failed to open billing portal'))
  }
}

async function addPaymentMethod() {
  await openPortal()
}

async function setDefaultPaymentMethod(pmId: string) {
  try {
    await api.patch(`/billing/payment-methods/${pmId}/default`, {})
    defaultPaymentMethodId.value = pmId
  } catch {
    toast.error(t('billing.setDefaultFailed'))
  }
}

async function removePaymentMethod(pmId: string) {
  if (!confirm(t('billing.removeMethodConfirm'))) return
  try {
    await api.del(`/billing/payment-methods/${pmId}`)
    paymentMethods.value = paymentMethods.value.filter(m => m.id !== pmId)
    if (defaultPaymentMethodId.value === pmId) defaultPaymentMethodId.value = null
  } catch {
    toast.error(t('billing.removeMethodFailed'))
  }
}

onMounted(() => { fetchAll() })
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <CreditCard class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('billing.title') }}</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <template v-else>
      <!-- Section 1: Active Service Plans -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Active Service Plans</h2>
        </div>
        <div v-if="serviceSubscriptions.length === 0" class="p-6 text-center">
          <Box class="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p class="text-sm text-gray-500 dark:text-gray-400">No active service subscriptions. Deploy a service to get started.</p>
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th class="px-6 py-3">Service</th>
                <th class="px-6 py-3">Tier</th>
                <th class="px-6 py-3">Cost</th>
                <th class="px-6 py-3">Cycle</th>
                <th class="px-6 py-3">{{ $t('common.status') }}</th>
                <th class="px-6 py-3">Renews</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr
                v-for="sub in serviceSubscriptions"
                :key="sub.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer transition-colors"
                @click="sub.serviceId ? router.push(`/panel/services/${sub.serviceId}`) : undefined"
              >
                <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                  {{ sub.serviceId ? `Service` : sub.stackId ? `Stack` : 'Account' }}
                </td>
                <td class="px-6 py-4 text-sm text-gray-900 dark:text-white">
                  {{ sub.plan ? planName(sub.plan) : '—' }}
                </td>
                <td class="px-6 py-4 text-sm text-gray-900 dark:text-white font-medium">
                  {{ sub.plan?.isFree ? 'Free' : sub.plan ? formatCents(sub.plan.priceCents) + '/mo' : '—' }}
                </td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 capitalize">
                  {{ sub.billingCycle?.replace('_', ' ') ?? '—' }}
                </td>
                <td class="px-6 py-4">
                  <span :class="[
                    'px-2 py-0.5 text-xs font-medium rounded-full',
                    sub.status === 'active' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                    sub.status === 'past_due' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' :
                    sub.status === 'cancelled' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                    'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  ]">{{ sub.status }}</span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                  {{ sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Section 2: Payment Methods -->
      <div v-if="isOwner" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('billing.paymentMethods') }}</h2>
          <button @click="addPaymentMethod" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors">
            <Plus class="w-3.5 h-3.5" />
            {{ $t('billing.addMethod') }}
          </button>
        </div>
        <div class="p-6">
          <div v-if="paymentMethods.length === 0" class="text-center py-6">
            <CreditCard class="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('billing.noPaymentMethods') }}</p>
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="pm in paymentMethods"
              :key="pm.id"
              :class="[
                'flex items-center justify-between p-4 rounded-lg border transition-colors',
                pm.id === defaultPaymentMethodId
                  ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/10'
                  : 'border-gray-200 dark:border-gray-600'
              ]"
            >
              <div class="flex items-center gap-3">
                <div class="w-10 h-7 rounded bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300">
                  {{ cardBrandLabel(pm.brand) }}
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">
                    •••• {{ pm.last4 }}
                    <span v-if="pm.id === defaultPaymentMethodId" class="ml-2 px-1.5 py-0.5 text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded font-medium">
                      {{ $t('billing.default') }}
                    </span>
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('billing.expires') }} {{ pm.expMonth }}/{{ pm.expYear }}</p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <button
                  v-if="pm.id !== defaultPaymentMethodId"
                  @click="setDefaultPaymentMethod(pm.id)"
                  class="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                  :title="$t('billing.setAsDefault')"
                >
                  <Star class="w-4 h-4" />
                </button>
                <button
                  @click="removePaymentMethod(pm.id)"
                  class="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  :title="$t('billing.removeMethod')"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Section 3: Usage Dashboard -->
      <div v-if="usage" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('billing.resourceUsage') }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('billing.usageDesc') }}</p>
        </div>
        <div class="p-6">
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
            <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <Box class="w-4 h-4 text-blue-500" />
                  <span class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ $t('billing.containers') }}</span>
                </div>
                <span v-if="limits?.maxContainers" class="text-[10px] text-gray-400">{{ Math.round((usage.runningContainers / limits.maxContainers) * 100) }}%</span>
              </div>
              <p class="text-lg font-bold text-gray-900 dark:text-white">{{ usage.runningContainers }} <span v-if="limits?.maxContainers" class="text-sm font-normal text-gray-400">/ {{ limits.maxContainers }}</span></p>
              <div v-if="limits?.maxContainers" class="mt-2 w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all duration-500" :class="(usage.runningContainers / limits.maxContainers) > 0.9 ? 'bg-red-500' : (usage.runningContainers / limits.maxContainers) > 0.7 ? 'bg-yellow-500' : 'bg-blue-500'" :style="{ width: Math.min((usage.runningContainers / limits.maxContainers) * 100, 100) + '%' }" />
              </div>
            </div>
            <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div class="flex items-center gap-2 mb-2">
                <Cpu class="w-4 h-4 text-orange-500" />
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ $t('billing.cpuHours') }}</span>
              </div>
              <p class="text-lg font-bold text-gray-900 dark:text-white">{{ usage.cpuHours?.toFixed(1) ?? 0 }}</p>
            </div>
            <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div class="flex items-center gap-2 mb-2">
                <MemoryStick class="w-4 h-4 text-purple-500" />
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ $t('billing.memoryGbHrs') }}</span>
              </div>
              <p class="text-lg font-bold text-gray-900 dark:text-white">{{ usage.memoryGbHours?.toFixed(1) ?? 0 }}</p>
            </div>
            <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <HardDrive class="w-4 h-4 text-green-500" />
                  <span class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ $t('billing.storageGb') }}</span>
                </div>
                <span v-if="limits?.maxStorageGb" class="text-[10px] text-gray-400">{{ Math.round(((usage.storageGb ?? 0) / limits.maxStorageGb) * 100) }}%</span>
              </div>
              <p class="text-lg font-bold text-gray-900 dark:text-white">{{ usage.storageGb ?? 0 }} <span v-if="limits?.maxStorageGb" class="text-sm font-normal text-gray-400">/ {{ limits.maxStorageGb }} GB</span></p>
              <div v-if="limits?.maxStorageGb" class="mt-2 w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all duration-500" :class="((usage.storageGb ?? 0) / limits.maxStorageGb) > 0.9 ? 'bg-red-500' : ((usage.storageGb ?? 0) / limits.maxStorageGb) > 0.7 ? 'bg-yellow-500' : 'bg-green-500'" :style="{ width: Math.min(((usage.storageGb ?? 0) / limits.maxStorageGb) * 100, 100) + '%' }" />
              </div>
            </div>
            <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <Wifi class="w-4 h-4 text-teal-500" />
                  <span class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ $t('billing.bandwidthGb') }}</span>
                </div>
                <span v-if="limits?.maxBandwidthGb" class="text-[10px] text-gray-400">{{ Math.round(((usage.bandwidthGb ?? 0) / limits.maxBandwidthGb) * 100) }}%</span>
              </div>
              <p class="text-lg font-bold text-gray-900 dark:text-white">{{ usage.bandwidthGb ?? 0 }} <span v-if="limits?.maxBandwidthGb" class="text-sm font-normal text-gray-400">/ {{ limits.maxBandwidthGb }} GB</span></p>
              <div v-if="limits?.maxBandwidthGb" class="mt-2 w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all duration-500" :class="((usage.bandwidthGb ?? 0) / limits.maxBandwidthGb) > 0.9 ? 'bg-red-500' : ((usage.bandwidthGb ?? 0) / limits.maxBandwidthGb) > 0.7 ? 'bg-yellow-500' : 'bg-teal-500'" :style="{ width: Math.min(((usage.bandwidthGb ?? 0) / limits.maxBandwidthGb) * 100, 100) + '%' }" />
              </div>
            </div>
          </div>

          <!-- Cost Breakdown -->
          <div v-if="usage.estimatedCostCents > 0" class="p-4 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800">
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center gap-2">
                <Gauge class="w-5 h-5 text-primary-600 dark:text-primary-400" />
                <span class="text-sm font-medium text-primary-700 dark:text-primary-300">{{ $t('billing.estimatedUsageCost') }}</span>
              </div>
              <span class="text-lg font-bold text-primary-700 dark:text-primary-300">{{ formatCents(usage.estimatedCostCents) }}</span>
            </div>
            <div class="space-y-2.5">
              <div v-if="usage.breakdown?.cpuCents" class="flex items-center gap-3">
                <span class="w-20 text-xs text-gray-600 dark:text-gray-400 text-right">CPU</span>
                <div class="flex-1 h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div class="h-full rounded-full bg-orange-500 transition-all duration-500" :style="{ width: ((usage.breakdown.cpuCents / usage.estimatedCostCents) * 100) + '%' }" />
                </div>
                <span class="w-16 text-xs font-medium text-gray-900 dark:text-white text-right">{{ formatCents(usage.breakdown.cpuCents) }}</span>
              </div>
              <div v-if="usage.breakdown?.memoryCents" class="flex items-center gap-3">
                <span class="w-20 text-xs text-gray-600 dark:text-gray-400 text-right">Memory</span>
                <div class="flex-1 h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div class="h-full rounded-full bg-purple-500 transition-all duration-500" :style="{ width: ((usage.breakdown.memoryCents / usage.estimatedCostCents) * 100) + '%' }" />
                </div>
                <span class="w-16 text-xs font-medium text-gray-900 dark:text-white text-right">{{ formatCents(usage.breakdown.memoryCents) }}</span>
              </div>
              <div v-if="usage.breakdown?.storageCents" class="flex items-center gap-3">
                <span class="w-20 text-xs text-gray-600 dark:text-gray-400 text-right">Storage</span>
                <div class="flex-1 h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div class="h-full rounded-full bg-green-500 transition-all duration-500" :style="{ width: ((usage.breakdown.storageCents / usage.estimatedCostCents) * 100) + '%' }" />
                </div>
                <span class="w-16 text-xs font-medium text-gray-900 dark:text-white text-right">{{ formatCents(usage.breakdown.storageCents) }}</span>
              </div>
              <div v-if="usage.breakdown?.bandwidthCents" class="flex items-center gap-3">
                <span class="w-20 text-xs text-gray-600 dark:text-gray-400 text-right">Bandwidth</span>
                <div class="flex-1 h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div class="h-full rounded-full bg-teal-500 transition-all duration-500" :style="{ width: ((usage.breakdown.bandwidthCents / usage.estimatedCostCents) * 100) + '%' }" />
                </div>
                <span class="w-16 text-xs font-medium text-gray-900 dark:text-white text-right">{{ formatCents(usage.breakdown.bandwidthCents) }}</span>
              </div>
              <div v-if="usage.breakdown?.containerCents" class="flex items-center gap-3">
                <span class="w-20 text-xs text-gray-600 dark:text-gray-400 text-right">Containers</span>
                <div class="flex-1 h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div class="h-full rounded-full bg-blue-500 transition-all duration-500" :style="{ width: ((usage.breakdown.containerCents / usage.estimatedCostCents) * 100) + '%' }" />
                </div>
                <span class="w-16 text-xs font-medium text-gray-900 dark:text-white text-right">{{ formatCents(usage.breakdown.containerCents) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Section 4: Invoice History -->
      <div v-if="invoices.length > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('billing.invoiceHistory') }}</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th class="px-6 py-3">{{ $t('common.date') }}</th>
                <th class="px-6 py-3">{{ $t('billing.amount') }}</th>
                <th class="px-6 py-3">{{ $t('common.status') }}</th>
                <th class="px-6 py-3">PDF</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-for="inv in invoices" :key="inv.id">
                <td class="px-6 py-4 text-sm text-gray-900 dark:text-white">{{ inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : '-' }}</td>
                <td class="px-6 py-4 text-sm text-gray-900 dark:text-white font-medium">{{ formatCents(inv.amount) }}</td>
                <td class="px-6 py-4">
                  <span :class="[
                    'px-2 py-0.5 text-xs font-medium rounded-full',
                    inv.status === 'paid' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  ]">{{ inv.status }}</span>
                </td>
                <td class="px-6 py-4">
                  <a v-if="inv.pdfUrl" :href="inv.pdfUrl" target="_blank" class="text-primary-600 dark:text-primary-400 text-xs hover:underline flex items-center gap-1">
                    <ExternalLink class="w-3 h-3" /> {{ $t('common.download') }}
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
