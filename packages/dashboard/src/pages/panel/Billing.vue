<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { CreditCard, Box, HardDrive, Loader2, ExternalLink, Calendar, Tag, Gauge, Cpu, MemoryStick, Wifi, AlertTriangle } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useRole } from '@/composables/useRole'

const api = useApi()
const { canOwner: isOwner } = useRole()

const loading = ref(true)
const config = ref<any>(null)
const subscription = ref<any>(null)
const usage = ref<any>(null)
const plans = ref<any[]>([])
const invoices = ref<any[]>([])
const limits = ref<any>(null)

// Checkout state
const selectedModel = ref<string>('fixed')
const selectedPlan = ref<string>('')
const selectedCycle = ref<string>('monthly')
const checkingOut = ref(false)

const allCycles = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'half_yearly', label: 'Half Yearly' },
  { id: 'yearly', label: 'Yearly' },
]

const allowedCycleOptions = computed(() => {
  const allowed = config.value?.allowedCycles ?? ['monthly', 'yearly']
  return allCycles.filter(c => allowed.includes(c.id))
})

const cycleMultipliers: Record<string, number> = {
  daily: 1 / 30, weekly: 7 / 30, monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12,
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function getCyclePrice(plan: any, cycle: string): number {
  const base = plan.priceCents * (cycleMultipliers[cycle] ?? 1)
  const discounts = config.value?.cycleDiscounts ?? {}
  const d = discounts[cycle]
  if (!d) return Math.round(base)
  if (d.type === 'percentage') return Math.round(base * (1 - d.value / 100))
  if (d.type === 'fixed') return Math.max(0, Math.round(base - d.value))
  return Math.round(base)
}

function getCycleDiscount(cycle: string): string | null {
  const discounts = config.value?.cycleDiscounts ?? {}
  const d = discounts[cycle]
  if (!d) return null
  if (d.type === 'percentage') return `${d.value}% off`
  if (d.type === 'fixed') return `$${(d.value / 100).toFixed(2)} off`
  return null
}

const hasSubscription = computed(() => subscription.value && subscription.value.status !== 'cancelled')
const isTrialing = computed(() => subscription.value?.status === 'trialing')
const isCancelled = computed(() => subscription.value?.cancelledAt !== null && subscription.value?.cancelledAt !== undefined)

async function fetchAll() {
  loading.value = true
  try {
    const [configData, subsData, usageData, plansData, invoiceData, limitsData] = await Promise.all([
      api.get<any>('/billing/config'),
      api.get<any>('/billing/subscription'),
      api.get<any>('/billing/usage'),
      api.get<any[]>('/billing/plans'),
      api.get<any[]>('/billing/invoices'),
      api.get<any>('/billing/resource-limits'),
    ])
    config.value = configData
    subscription.value = subsData
    usage.value = usageData
    plans.value = plansData
    invoices.value = invoiceData
    limits.value = limitsData
    selectedModel.value = configData.billingModel ?? 'fixed'
    if (plansData.length > 0) selectedPlan.value = plansData[0].id
  } catch {
    // silently handle
  } finally {
    loading.value = false
  }
}

async function checkout() {
  checkingOut.value = true
  try {
    const body: any = {
      billingModel: selectedModel.value,
      billingCycle: selectedCycle.value,
      successUrl: `${window.location.origin}/panel/billing?success=true`,
      cancelUrl: `${window.location.origin}/panel/billing`,
    }
    if (selectedModel.value !== 'usage') {
      body.planId = selectedPlan.value
    }
    const res = await api.post<{ url: string }>('/billing/checkout', body)
    if (res.url) window.location.href = res.url
  } catch (err: any) {
    alert(err?.body?.error || 'Checkout failed')
  } finally {
    checkingOut.value = false
  }
}

async function cancelSubscription() {
  if (!confirm('Cancel your subscription? It will remain active until the end of your billing period.')) return
  try {
    await api.del('/billing/subscription')
    await fetchAll()
  } catch (err: any) {
    alert(err?.body?.error || 'Failed to cancel')
  }
}

async function openPortal() {
  try {
    const res = await api.post<{ url: string }>('/billing/portal', {
      returnUrl: window.location.href,
    })
    if (res.url) window.location.href = res.url
  } catch {
    alert('Failed to open billing portal')
  }
}

onMounted(() => { fetchAll() })
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <CreditCard class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Billing</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <template v-else>
      <!-- Trial Banner -->
      <div v-if="isTrialing" class="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center gap-3">
        <Calendar class="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
        <p class="text-sm text-blue-700 dark:text-blue-300">
          You are currently on a free trial.
          <span v-if="subscription?.trialEndsAt"> Trial ends {{ new Date(subscription.trialEndsAt).toLocaleDateString() }}.</span>
        </p>
      </div>

      <!-- Cancellation Banner -->
      <div v-if="isCancelled" class="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-center gap-3">
        <AlertTriangle class="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
        <p class="text-sm text-yellow-700 dark:text-yellow-300">
          Your subscription has been cancelled and will end
          <span v-if="subscription?.currentPeriodEnd"> on {{ new Date(subscription.currentPeriodEnd).toLocaleDateString() }}</span>.
        </p>
      </div>

      <!-- Section 1: Current Subscription -->
      <div v-if="hasSubscription" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Current Subscription</h2>
          <span :class="[
            'px-2.5 py-0.5 text-xs font-medium rounded-full',
            subscription.status === 'active' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
            subscription.status === 'trialing' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
            'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
          ]">{{ subscription.status }}</span>
        </div>
        <div class="p-6">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div>
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Plan</p>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ subscription.plan?.name ?? 'Usage-Based' }}</p>
            </div>
            <div>
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Model</p>
              <p class="text-sm font-semibold text-gray-900 dark:text-white capitalize">{{ subscription.billingModel }}</p>
            </div>
            <div>
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Cycle</p>
              <p class="text-sm font-semibold text-gray-900 dark:text-white capitalize">{{ subscription.billingCycle?.replace('_', ' ') }}</p>
            </div>
            <div v-if="subscription.currentPeriodEnd">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Renews</p>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ new Date(subscription.currentPeriodEnd).toLocaleDateString() }}</p>
            </div>
          </div>
          <div v-if="isOwner" class="flex gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button @click="openPortal" class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <ExternalLink class="w-4 h-4" /> Manage Billing
            </button>
            <button v-if="!isCancelled" @click="cancelSubscription" class="px-3 py-2 rounded-lg border border-red-300 dark:border-red-800 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              Cancel Subscription
            </button>
          </div>
        </div>
      </div>

      <!-- Section 2: Usage Dashboard -->
      <div v-if="usage" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Resource Usage</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Current billing period usage and estimated costs.</p>
        </div>
        <div class="p-6">
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
            <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div class="flex items-center gap-2 mb-2">
                <Box class="w-4 h-4 text-blue-500" />
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Containers</span>
              </div>
              <p class="text-lg font-bold text-gray-900 dark:text-white">{{ usage.runningContainers }} <span class="text-sm font-normal text-gray-400">/ {{ usage.totalContainers }}</span></p>
            </div>
            <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div class="flex items-center gap-2 mb-2">
                <Cpu class="w-4 h-4 text-orange-500" />
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">CPU Hours</span>
              </div>
              <p class="text-lg font-bold text-gray-900 dark:text-white">{{ usage.cpuHours?.toFixed(1) ?? 0 }}</p>
            </div>
            <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div class="flex items-center gap-2 mb-2">
                <MemoryStick class="w-4 h-4 text-purple-500" />
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Memory GB-hrs</span>
              </div>
              <p class="text-lg font-bold text-gray-900 dark:text-white">{{ usage.memoryGbHours?.toFixed(1) ?? 0 }}</p>
            </div>
            <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div class="flex items-center gap-2 mb-2">
                <HardDrive class="w-4 h-4 text-green-500" />
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Storage (GB)</span>
              </div>
              <p class="text-lg font-bold text-gray-900 dark:text-white">{{ usage.storageGb ?? 0 }}</p>
            </div>
            <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div class="flex items-center gap-2 mb-2">
                <Wifi class="w-4 h-4 text-teal-500" />
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Bandwidth (GB)</span>
              </div>
              <p class="text-lg font-bold text-gray-900 dark:text-white">{{ usage.bandwidthGb ?? 0 }}</p>
            </div>
          </div>

          <!-- Cost estimate for usage/hybrid users -->
          <div v-if="usage.estimatedCostCents > 0" class="p-4 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Gauge class="w-5 h-5 text-primary-600 dark:text-primary-400" />
                <span class="text-sm font-medium text-primary-700 dark:text-primary-300">Estimated Usage Cost</span>
              </div>
              <span class="text-lg font-bold text-primary-700 dark:text-primary-300">{{ formatCents(usage.estimatedCostCents) }}</span>
            </div>
            <div class="mt-2 grid grid-cols-5 gap-2 text-xs text-primary-600 dark:text-primary-400">
              <span>CPU: {{ formatCents(usage.breakdown?.cpuCents ?? 0) }}</span>
              <span>Memory: {{ formatCents(usage.breakdown?.memoryCents ?? 0) }}</span>
              <span>Storage: {{ formatCents(usage.breakdown?.storageCents ?? 0) }}</span>
              <span>Bandwidth: {{ formatCents(usage.breakdown?.bandwidthCents ?? 0) }}</span>
              <span>Containers: {{ formatCents(usage.breakdown?.containerCents ?? 0) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Section 3: Plan Selection (for new subscriptions) -->
      <div v-if="!hasSubscription && plans.length > 0 && isOwner" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Choose a Plan</h2>
        </div>
        <div class="p-6">
          <!-- Billing model selector (if user choice allowed) -->
          <div v-if="config?.allowUserChoice" class="mb-6">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Billing Model</label>
            <div class="grid grid-cols-3 gap-3">
              <button v-for="m in [{ id: 'fixed', label: 'Fixed' }, { id: 'usage', label: 'Usage-Based' }, { id: 'hybrid', label: 'Hybrid' }]"
                :key="m.id" @click="selectedModel = m.id"
                :class="['p-3 rounded-lg border-2 text-center text-sm font-medium transition-colors', selectedModel === m.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400']"
              >{{ m.label }}</button>
            </div>
          </div>

          <!-- Plan cards (for fixed/hybrid) -->
          <div v-if="selectedModel !== 'usage'" class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <button v-for="plan in plans" :key="plan.id" @click="selectedPlan = plan.id"
              :class="[
                'p-5 rounded-xl border-2 text-left transition-all',
                selectedPlan === plan.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 shadow-sm' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
              ]"
            >
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-bold text-gray-900 dark:text-white">{{ plan.name }}</h3>
                <span v-if="plan.isFree" class="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs rounded font-medium">Free</span>
              </div>
              <p class="text-2xl font-bold text-gray-900 dark:text-white mb-1">{{ formatCents(getCyclePrice(plan, selectedCycle)) }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">per {{ selectedCycle.replace('_', ' ') }}</p>
              <div class="space-y-1 text-xs text-gray-600 dark:text-gray-400">
                <p>{{ plan.cpuLimit }}mc CPU / {{ plan.memoryLimit }}MB RAM</p>
                <p>{{ plan.containerLimit }} containers / {{ plan.storageLimit }}GB storage</p>
                <p v-if="plan.bandwidthLimit">{{ plan.bandwidthLimit }}GB bandwidth</p>
              </div>
            </button>
          </div>

          <!-- Cycle selector -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Billing Cycle</label>
            <div class="flex flex-wrap gap-2">
              <button v-for="c in allowedCycleOptions" :key="c.id" @click="selectedCycle = c.id"
                :class="[
                  'px-4 py-2 rounded-lg border text-sm font-medium transition-colors relative',
                  selectedCycle === c.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                ]"
              >
                {{ c.label }}
                <span v-if="getCycleDiscount(c.id)" class="ml-1.5 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs rounded-full font-medium">
                  {{ getCycleDiscount(c.id) }}
                </span>
              </button>
            </div>
          </div>

          <!-- Subscribe button -->
          <button @click="checkout" :disabled="checkingOut || (!selectedPlan && selectedModel !== 'usage')"
            class="w-full py-3 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            <Loader2 v-if="checkingOut" class="w-4 h-4 animate-spin" />
            {{ checkingOut ? 'Redirecting to Stripe...' : 'Subscribe Now' }}
          </button>
        </div>
      </div>

      <!-- Section 4: Invoice History -->
      <div v-if="invoices.length > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Invoice History</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <th class="px-6 py-3">Date</th>
                <th class="px-6 py-3">Amount</th>
                <th class="px-6 py-3">Status</th>
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
                    <ExternalLink class="w-3 h-3" /> Download
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
