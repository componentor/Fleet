<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'
import { useBranding } from '@/composables/useBranding'
import { useCart } from '@/composables/useCart'
import { useCurrency } from '@/composables/useCurrency'
import { useApi } from '@/composables/useApi'
import CompassSpinner from '@/components/CompassSpinner.vue'
import {
  Globe,
  ArrowRight,
  Trash2,
  Minus,
  Plus,
  ShoppingCart,
  Sun,
  Moon,
  Server,
  Info,
  AlertTriangle,
} from 'lucide-vue-next'
import type { BillingCycle } from '@/composables/useCart'
import { CYCLE_MONTHS, CYCLE_SHORT, CYCLE_LABELS } from '@/composables/useCart'

const { t, locale } = useI18n()
const router = useRouter()
const authStore = useAuthStore()
const { theme, toggle: toggleTheme } = useTheme()
const { brandTitle, logoSrc } = useBranding()
const { items, count, total, hostingTotal, removeDomain, setYears, setPlan, setBillingCycle, clearCart } = useCart()
const { formatCurrency, selectedCurrency } = useCurrency()
const api = useApi()

const purchasing = ref(false)
const checkoutError = ref('')

interface ApiPlan {
  id: string
  name: string
  slug: string
  nameTranslations?: Record<string, string>
  priceCents: number
  yearlyPriceCents?: number | null
  cyclePrices?: Record<string, number>
  isFree: boolean
  isDefault: boolean
  cpuLimit: number
  memoryLimit: number
  containerLimit: number
  storageLimit: number
  bandwidthLimit: number | null
}

const plans = ref<ApiPlan[]>([])
const allowedCycles = ref<BillingCycle[]>(['monthly', 'yearly'])
const domainMaxYears = ref(10)
const showComparison = ref(false)

function localPlanName(plan: ApiPlan): string {
  return plan.nameTranslations?.[locale.value] || plan.name
}

function getCyclePriceCents(plan: ApiPlan, cycle: BillingCycle): number {
  if (plan.cyclePrices?.[cycle] != null) return plan.cyclePrices[cycle]
  if (cycle === 'yearly' && plan.yearlyPriceCents != null) return plan.yearlyPriceCents
  return Math.round(plan.priceCents * CYCLE_MONTHS[cycle])
}

function planPrice(plan: ApiPlan, cycle: BillingCycle) {
  if (plan.isFree) return t('landing.pricing.plans.free.name', 'Free')
  const amount = getCyclePriceCents(plan, cycle) / 100
  return `${formatCurrency(amount, cartCurrency.value)}/${CYCLE_SHORT[cycle]}`
}

function togglePlan(domain: string, plan: ApiPlan) {
  const item = items.value.find(i => i.domain === domain)
  if (item?.planId === plan.id) {
    setPlan(domain, null)
  } else {
    setPlan(domain, plan)
  }
}

function formatMemory(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

function formatStorage(gb: number): string {
  if (gb === -1) return t('landing.cart.unlimited', 'Unlimited')
  return gb >= 1024 ? `${(gb / 1024).toFixed(gb % 1024 === 0 ? 0 : 1)} TB` : `${gb} GB`
}

import { computed } from 'vue'

const cartCurrency = computed(() => items.value[0]?.currency ?? selectedCurrency.value)
const hasHosting = computed(() => items.value.some(i => i.planPriceCents))

function hostingCycleLabel() {
  const withPlans = items.value.filter(i => i.planPriceCents)
  if (withPlans.length === 0) return ''
  const cycle = withPlans[0]?.billingCycle ?? 'monthly'
  const allSame = withPlans.every(i => (i.billingCycle ?? 'monthly') === cycle)
  if (allSame) return '/ ' + CYCLE_SHORT[cycle]
  return '/ ' + CYCLE_SHORT.monthly
}

onMounted(async () => {
  if (!authStore.initialized) await authStore.init()
  // If not authenticated, redirect to login
  if (!authStore.isAuthenticated) {
    router.replace('/login')
    return
  }
  // If cart is empty, go to dashboard
  if (count.value === 0) {
    router.replace('/panel')
    return
  }
  // Fetch plans
  try {
    const res = await fetch('/api/v1/billing/public/plans')
    if (res.ok) {
      const data = await res.json()
      if (data.plans?.length) plans.value = data.plans
      if (data.allowedCycles?.length) allowedCycles.value = data.allowedCycles
      if (data.domainMaxYears) domainMaxYears.value = data.domainMaxYears
    }
  } catch { /* fallback: no plans */ }
})

async function proceedToCheckout() {
  if (purchasing.value) return
  purchasing.value = true
  checkoutError.value = ''

  try {
    const currentUrl = window.location.origin
    const data = await api.post<{ url: string | null }>('/domains/bulk-checkout', {
      domains: items.value.map(i => ({ domain: i.domain, years: i.years })),
      currency: items.value[0]?.currency ?? selectedCurrency.value,
      successUrl: `${currentUrl}/panel/domains?purchased=true`,
      cancelUrl: `${currentUrl}/checkout`,
    })

    if (data.url) {
      window.location.href = data.url
    } else {
      checkoutError.value = t('checkout.noCheckoutUrl', 'Could not create checkout session. Please try again.')
    }
  } catch (err: any) {
    const msg = err?.body?.error || err?.message || ''
    if (msg.includes('STRIPE_SECRET_KEY') || msg.includes('not configured')) {
      checkoutError.value = t('checkout.stripeNotConfigured', 'Payment processing is not yet configured. Please contact support or try again later.')
    } else {
      checkoutError.value = msg || t('checkout.checkoutFailed', 'Checkout failed. Please try again.')
    }
  } finally {
    purchasing.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center px-4 py-12 relative overflow-hidden">
    <!-- Background decorations -->
    <div class="pointer-events-none fixed inset-0 overflow-hidden">
      <div class="absolute top-1/4 -left-20 w-72 h-72 bg-primary-500/10 rounded-full blur-3xl animate-float"></div>
      <div class="absolute bottom-1/4 -right-20 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-float" style="animation-delay: 2s;"></div>
    </div>

    <!-- Theme toggle -->
    <button
      @click="toggleTheme"
      class="fixed top-4 right-4 z-10 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
    >
      <Sun v-if="theme === 'light'" class="w-5 h-5" />
      <Moon v-else class="w-5 h-5" />
    </button>

    <!-- Logo -->
    <div class="mb-8 text-center relative z-10">
      <router-link to="/" class="flex items-center justify-center gap-2 mb-2">
        <template v-if="logoSrc()">
          <img :src="logoSrc()!" :alt="brandTitle" class="h-10 w-auto max-w-[200px] object-contain" />
        </template>
        <template v-else>
          <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700">
            <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
        </template>
        <h1 class="text-3xl font-medium text-gray-900 dark:text-white">{{ brandTitle }}</h1>
      </router-link>
    </div>

    <!-- Checkout card -->
    <div class="w-full max-w-lg relative z-10">
      <div class="text-center mb-6">
        <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ $t('checkout.title', 'Checkout') }}</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ $t('checkout.subtitle', 'Review your cart before proceeding') }}</p>
      </div>

      <!-- Cart items -->
      <div class="space-y-3 mb-6">
        <div
          v-for="item in items"
          :key="item.domain"
          class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm"
        >
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/30 shrink-0">
              <Globe class="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-gray-900 dark:text-white truncate">{{ item.domain }}</p>
              <p class="text-xs text-gray-400 dark:text-gray-500">
                {{ formatCurrency(item.price, item.currency) }} / {{ $t('landing.cart.year', 'yr') }}
              </p>
            </div>
            <button
              @click="removeDomain(item.domain)"
              class="p-1.5 rounded-lg text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </div>

          <!-- Year selector -->
          <div class="mt-3 flex items-center justify-between">
            <div class="flex items-center gap-1">
              <button
                @click="setYears(item.domain, item.years - 1)"
                :disabled="item.years <= 1"
                class="flex items-center justify-center w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors"
              >
                <Minus class="w-3.5 h-3.5" />
              </button>
              <span class="w-16 text-center text-sm font-medium text-gray-900 dark:text-white">
                {{ item.years }} {{ item.years === 1 ? $t('landing.cart.year', 'yr') : $t('landing.cart.years', 'yrs') }}
              </span>
              <button
                @click="setYears(item.domain, item.years + 1)"
                :disabled="item.years >= domainMaxYears"
                class="flex items-center justify-center w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors"
              >
                <Plus class="w-3.5 h-3.5" />
              </button>
            </div>
            <p class="text-sm font-semibold text-gray-900 dark:text-white">
              {{ formatCurrency(item.price * item.years, item.currency) }}
            </p>
          </div>

          <!-- Service tier selector -->
          <div v-if="plans.length > 0" class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700/50">
            <div class="flex items-center gap-1.5 mb-2">
              <Server class="w-3.5 h-3.5 text-gray-400" />
              <span class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ $t('landing.cart.addHosting', 'Add hosting') }}</span>
              <button
                @click="showComparison = !showComparison"
                class="p-0.5 rounded text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
              >
                <Info class="w-3.5 h-3.5" />
              </button>
            </div>
            <!-- Plan comparison panel -->
            <Transition name="comparison">
              <div v-if="showComparison" class="mb-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
                <table class="w-full text-[11px]">
                  <thead>
                    <tr class="border-b border-gray-100 dark:border-gray-800">
                      <th class="text-left py-1.5 px-2 font-medium text-gray-400 dark:text-gray-500"></th>
                      <th
                        v-for="plan in plans"
                        :key="plan.id"
                        class="py-1.5 px-2 font-semibold text-center text-gray-900 dark:text-white"
                      >
                        {{ localPlanName(plan) }}
                      </th>
                    </tr>
                  </thead>
                  <tbody class="text-gray-600 dark:text-gray-400">
                    <tr class="border-b border-gray-50 dark:border-gray-800/50">
                      <td class="py-1 px-2 text-gray-400">{{ $t('landing.cart.planPrice', 'Price') }}</td>
                      <td v-for="plan in plans" :key="plan.id" class="py-1 px-2 text-center font-medium">
                        {{ plan.isFree ? $t('landing.pricing.free', 'Free') : planPrice(plan, item.billingCycle ?? 'yearly') }}
                      </td>
                    </tr>
                    <tr class="border-b border-gray-50 dark:border-gray-800/50">
                      <td class="py-1 px-2 text-gray-400">CPU</td>
                      <td v-for="plan in plans" :key="plan.id" class="py-1 px-2 text-center">
                        {{ plan.cpuLimit === -1 ? $t('landing.cart.unlimited', 'Unlimited') : plan.cpuLimit + ' ' + (plan.cpuLimit === 1 ? 'core' : 'cores') }}
                      </td>
                    </tr>
                    <tr class="border-b border-gray-50 dark:border-gray-800/50">
                      <td class="py-1 px-2 text-gray-400">{{ $t('landing.cart.memory', 'RAM') }}</td>
                      <td v-for="plan in plans" :key="plan.id" class="py-1 px-2 text-center">
                        {{ formatMemory(plan.memoryLimit) }}
                      </td>
                    </tr>
                    <tr class="border-b border-gray-50 dark:border-gray-800/50">
                      <td class="py-1 px-2 text-gray-400">{{ $t('landing.cart.storage', 'Storage') }}</td>
                      <td v-for="plan in plans" :key="plan.id" class="py-1 px-2 text-center">
                        {{ formatStorage(plan.storageLimit) }}
                      </td>
                    </tr>
                    <tr>
                      <td class="py-1 px-2 text-gray-400">{{ $t('landing.cart.services', 'Services') }}</td>
                      <td v-for="plan in plans" :key="plan.id" class="py-1 px-2 text-center">
                        {{ plan.containerLimit === -1 ? $t('landing.cart.unlimited', 'Unlimited') : plan.containerLimit }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Transition>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="plan in plans"
                :key="plan.id"
                @click="togglePlan(item.domain, plan)"
                :class="[
                  'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all border',
                  item.planId === plan.id
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600',
                ]"
              >
                <span>{{ localPlanName(plan) }}</span>
                <span v-if="!plan.isFree" class="ml-1 opacity-70">{{ planPrice(plan, item.billingCycle ?? 'yearly') }}</span>
                <span v-else class="ml-1 opacity-70">{{ $t('landing.pricing.free', 'Free') }}</span>
              </button>
            </div>
            <!-- Billing cycle toggle -->
            <div v-if="item.planId && item.planPriceCents && item.planPriceCents > 0 && allowedCycles.length > 1" class="mt-2 flex items-center gap-1">
              <div class="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 flex-wrap">
                <button
                  v-for="cycle in allowedCycles"
                  :key="cycle"
                  @click="setBillingCycle(item.domain, cycle)"
                  :class="[
                    'rounded-md px-2.5 py-1 text-[11px] font-medium transition-all',
                    (item.billingCycle ?? 'monthly') === cycle
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
                  ]"
                >
                  {{ CYCLE_LABELS[cycle] }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Totals -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm mb-6">
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('landing.cart.domains', 'Domains') }}</span>
            <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ formatCurrency(total, cartCurrency) }}</span>
          </div>
          <div v-if="hasHosting" class="flex items-center justify-between">
            <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('landing.cart.hosting', 'Hosting') }}</span>
            <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ formatCurrency(hostingTotal, cartCurrency) }} {{ hostingCycleLabel() }}</span>
          </div>
          <p class="text-[11px] text-gray-400 dark:text-gray-500">{{ $t('landing.cart.exclVat', 'Excl. VAT') }}</p>
        </div>
      </div>

      <!-- Error alert -->
      <div
        v-if="checkoutError"
        class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6"
      >
        <div class="flex items-start gap-3">
          <AlertTriangle class="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p class="text-sm font-medium text-red-700 dark:text-red-300">{{ checkoutError }}</p>
          </div>
        </div>
      </div>

      <!-- Proceed button -->
      <button
        @click="proceedToCheckout"
        :disabled="purchasing"
        class="flex items-center justify-center gap-2 w-full rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition-all hover:shadow-primary-500/40 hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <CompassSpinner v-if="purchasing" size="w-4 h-4" />
        <ShoppingCart v-else class="w-4 h-4" />
        <span v-if="purchasing">{{ $t('checkout.processing', 'Processing...') }}</span>
        <span v-else>{{ $t('checkout.proceed', 'Proceed to checkout') }}</span>
        <ArrowRight v-if="!purchasing" class="w-4 h-4" />
      </button>

      <!-- Skip link -->
      <div class="mt-4 text-center">
        <button
          @click="router.push('/panel')"
          class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          {{ $t('checkout.skipToDashboard', 'Skip to dashboard') }} &rarr;
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.comparison-enter-active,
.comparison-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.comparison-enter-from,
.comparison-leave-to {
  opacity: 0;
  max-height: 0;
  margin-bottom: 0;
}
.comparison-enter-to,
.comparison-leave-from {
  opacity: 1;
  max-height: 300px;
}
</style>
