<script setup lang="ts">
import { ref } from 'vue'
import { CreditCard, TrendingUp, DollarSign, Users, Save } from 'lucide-vue-next'

const revenueStats = [
  { label: 'Monthly Revenue', value: '$0', icon: DollarSign, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
  { label: 'Active Subscriptions', value: '0', icon: TrendingUp, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  { label: 'Paying Customers', value: '0', icon: Users, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' },
]
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <CreditCard class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Platform Billing</h1>
    </div>

    <!-- Revenue stats -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
      <div
        v-for="stat in revenueStats"
        :key="stat.label"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6"
      >
        <div class="flex items-center gap-4">
          <div :class="[stat.bg, 'p-3 rounded-lg']">
            <component :is="stat.icon" :class="[stat.color, 'w-6 h-6']" />
          </div>
          <div>
            <p class="text-sm font-medium text-gray-600 dark:text-gray-400">{{ stat.label }}</p>
            <p class="text-2xl font-bold text-gray-900 dark:text-white">{{ stat.value }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Revenue chart placeholder -->
    <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
      <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Revenue Overview</h2>
      </div>
      <div class="p-6">
        <div class="h-64 flex items-center justify-center bg-gray-50 dark:bg-gray-750 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-600">
          <p class="text-gray-400 dark:text-gray-500 text-sm">Revenue chart will be displayed here</p>
        </div>
      </div>
    </div>

    <!-- Pricing configuration -->
    <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
      <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Pricing Plans</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure pricing tiers for your customers.</p>
      </div>
      <div class="p-6 space-y-5">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Base Plan Price (monthly)</label>
            <div class="relative">
              <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input type="number" step="0.01" placeholder="0.00" class="w-full pl-8 pr-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Pro Plan Price (monthly)</label>
            <div class="relative">
              <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input type="number" step="0.01" placeholder="0.00" class="w-full pl-8 pr-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            </div>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Free Tier Limits</label>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input type="number" placeholder="Max services" class="px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            <input type="number" placeholder="Max storage (GB)" class="px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            <input type="number" placeholder="Max domains" class="px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
          </div>
        </div>
      </div>
      <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
        <button class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors">
          <Save class="w-4 h-4" />
          Save Changes
        </button>
      </div>
    </div>
  </div>
</template>
