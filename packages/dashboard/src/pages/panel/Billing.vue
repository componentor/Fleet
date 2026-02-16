<script setup lang="ts">
import { ref } from 'vue'
import { CreditCard, Box, Globe, HardDrive } from 'lucide-vue-next'

const invoices = ref<any[]>([])
const loading = ref(false)
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <CreditCard class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Billing</h1>
    </div>

    <!-- Current plan -->
    <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
      <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Current Plan</h2>
        <button class="px-3 py-1.5 rounded-lg text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors">
          Upgrade Plan
        </button>
      </div>
      <div class="p-6">
        <div class="flex items-center gap-4 mb-4">
          <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
            Free
          </span>
          <span class="text-sm text-gray-500 dark:text-gray-400">$0.00/month</span>
        </div>
        <p class="text-sm text-gray-600 dark:text-gray-400">You are currently on the free plan. Upgrade to unlock more resources.</p>
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
                <p class="text-sm font-medium text-gray-900 dark:text-white">Services</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">0 of 3 used</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full bg-primary-500 rounded-full" style="width: 0%"></div>
              </div>
              <span class="text-xs font-medium text-gray-600 dark:text-gray-400 w-10 text-right">$0.00</span>
            </div>
          </div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <HardDrive class="w-5 h-5 text-gray-400" />
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">Storage</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">0 GB of 5 GB used</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full bg-purple-500 rounded-full" style="width: 0%"></div>
              </div>
              <span class="text-xs font-medium text-gray-600 dark:text-gray-400 w-10 text-right">$0.00</span>
            </div>
          </div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <Globe class="w-5 h-5 text-gray-400" />
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">Domains</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">0 of 2 used</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full bg-blue-500 rounded-full" style="width: 0%"></div>
              </div>
              <span class="text-xs font-medium text-gray-600 dark:text-gray-400 w-10 text-right">$0.00</span>
            </div>
          </div>
        </div>
        <div class="mt-5 pt-5 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <span class="text-sm font-semibold text-gray-900 dark:text-white">Total</span>
          <span class="text-lg font-bold text-gray-900 dark:text-white">$0.00</span>
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
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ invoice.date }}</td>
              <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ invoice.amount }}</td>
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
                <button class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">Download</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
