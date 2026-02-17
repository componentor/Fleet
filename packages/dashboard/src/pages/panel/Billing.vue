<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { CreditCard, Box, Globe, HardDrive, Loader2, ExternalLink } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useRole } from '@/composables/useRole'

const api = useApi()
const { canOwner } = useRole()

const loading = ref(true)
const subscription = ref<any>(null)
const usage = ref<any>(null)
const invoices = ref<any[]>([])
const portalLoading = ref(false)

async function fetchBillingData() {
  loading.value = true
  try {
    const [usageData, invoiceData] = await Promise.all([
      api.get<any>('/billing/usage').catch(() => null),
      api.get<any[]>('/billing/invoices').catch(() => []),
    ])
    usage.value = usageData
    invoices.value = Array.isArray(invoiceData) ? invoiceData : []

    try {
      subscription.value = await api.get<any>('/billing/subscription')
    } catch {
      subscription.value = null
    }
  } finally {
    loading.value = false
  }
}

async function openPortal() {
  portalLoading.value = true
  try {
    const result = await api.post<{ url: string }>('/billing/portal', {
      returnUrl: window.location.href,
    })
    if (result.url) {
      window.location.href = result.url
    }
  } catch {
    // Portal not available
  } finally {
    portalLoading.value = false
  }
}

function formatCurrency(cents: number, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

function formatDate(ts: any) {
  if (!ts) return '--'
  const d = new Date(ts)
  return d.toLocaleDateString()
}

onMounted(() => {
  fetchBillingData()
})
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
      <!-- Current plan -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Current Plan</h2>
          <button
            v-if="canOwner"
            @click="openPortal"
            :disabled="portalLoading"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
          >
            <ExternalLink class="w-3.5 h-3.5" />
            {{ portalLoading ? 'Opening...' : 'Manage Billing' }}
          </button>
        </div>
        <div class="p-6">
          <div v-if="subscription" class="flex items-center gap-4 mb-4">
            <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
              {{ subscription.plan?.name || 'Active' }}
            </span>
            <span v-if="subscription.plan?.priceCents" class="text-sm text-gray-500 dark:text-gray-400">
              {{ formatCurrency(subscription.plan.priceCents) }}/month
            </span>
          </div>
          <div v-else class="flex items-center gap-4 mb-4">
            <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              Free
            </span>
            <span class="text-sm text-gray-500 dark:text-gray-400">$0.00/month</span>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ subscription ? `Status: ${subscription.status}` : 'You are currently on the free plan.' }}
          </p>
        </div>
      </div>

      <!-- Usage breakdown -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Usage This Month</h2>
        </div>
        <div class="p-6">
          <div class="space-y-5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <Box class="w-5 h-5 text-gray-400" />
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Containers</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ usage?.containers ?? 0 }} active</p>
                </div>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <HardDrive class="w-5 h-5 text-gray-400" />
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Storage</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ (usage?.storageGb ?? 0).toFixed(2) }} GB used</p>
                </div>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <Globe class="w-5 h-5 text-gray-400" />
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">CPU</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ usage?.cpuSeconds ?? 0 }} seconds</p>
                </div>
              </div>
            </div>
          </div>
          <div v-if="usage?.recordedAt" class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <p class="text-xs text-gray-400 dark:text-gray-500">Last recorded: {{ formatDate(usage.recordedAt) }}</p>
          </div>
        </div>
      </div>

      <!-- Invoice history -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Invoice History</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Amount</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Invoice</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-if="invoices.length === 0">
                <td colspan="4" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No invoices yet.
                </td>
              </tr>
              <tr
                v-for="invoice in invoices"
                :key="invoice.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
              >
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(invoice.createdAt) }}</td>
                <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ formatCurrency(invoice.amount, invoice.currency) }}</td>
                <td class="px-6 py-4 text-sm">
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      invoice.status === 'paid'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                    ]"
                  >
                    {{ invoice.status }}
                  </span>
                </td>
                <td class="px-6 py-4 text-right">
                  <a v-if="invoice.pdfUrl" :href="invoice.pdfUrl" target="_blank" class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">Download</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
