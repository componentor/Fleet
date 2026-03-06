<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ShoppingBasket, X, Trash2, Globe, Minus, Plus, Server, Info } from 'lucide-vue-next'
import { useCart, CYCLE_MONTHS, CYCLE_LABELS, CYCLE_SHORT, type BillingCycle } from '@/composables/useCart'
import { useCurrency } from '@/composables/useCurrency'

const { t, locale } = useI18n()
function localPlanName(plan: ApiPlan): string {
  return plan.nameTranslations?.[locale.value] || plan.name
}
const { items, count, total, hostingTotal, removeDomain, setYears, setPlan, setBillingCycle } = useCart()
const { formatCurrency, selectedCurrency } = useCurrency()

interface ApiPlan {
  id: string
  name: string
  slug: string
  nameTranslations?: Record<string, string>
  descriptionTranslations?: Record<string, string>
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
  description?: string
}

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const plans = ref<ApiPlan[]>([])
const plansLoaded = ref(false)
const showComparison = ref(false)
const allowedCycles = ref<BillingCycle[]>(['monthly', 'yearly'])

function formatMemory(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

function formatStorage(gb: number): string {
  if (gb === -1) return t('landing.cart.unlimited', 'Unlimited')
  return gb >= 1024 ? `${(gb / 1024).toFixed(gb % 1024 === 0 ? 0 : 1)} TB` : `${gb} GB`
}

// Fetch plans when drawer opens (retry if previous fetch returned no plans)
watch(() => props.open, async (isOpen) => {
  if (isOpen && plans.value.length === 0) {
    try {
      const res = await fetch('/api/v1/billing/public/plans')
      if (res.ok) {
        const data = await res.json()
        if (data.plans?.length) plans.value = data.plans
        if (data.allowedCycles?.length) allowedCycles.value = data.allowedCycles
      }
    } catch { /* fallback: no plans shown */ }
    plansLoaded.value = true
  }
})

const cartCurrency = computed(() => items.value[0]?.currency ?? selectedCurrency.value)
const formattedTotal = computed(() => formatCurrency(total.value, cartCurrency.value))
const hasHosting = computed(() => items.value.some(i => i.planPriceCents))

function formattedHostingTotal() {
  // Show grouped by cycle — if all items share the same cycle, show one line
  // Otherwise show combined yearly equivalent
  return formatCurrency(hostingTotal.value, cartCurrency.value)
}

function hostingCycleLabel() {
  const withPlans = items.value.filter(i => i.planPriceCents)
  if (withPlans.length === 0) return ''
  const cycle = withPlans[0]?.billingCycle ?? 'monthly'
  const allSame = withPlans.every(i => (i.billingCycle ?? 'monthly') === cycle)
  if (allSame) return '/ ' + CYCLE_SHORT[cycle]
  return '/ ' + CYCLE_SHORT.monthly
}

function getCyclePriceCents(plan: ApiPlan, cycle: BillingCycle): number {
  // 1. Use specific cycle price if configured for this currency
  if (plan.cyclePrices?.[cycle] != null) return plan.cyclePrices[cycle]
  // 2. For yearly, use explicit yearlyPriceCents if set
  if (cycle === 'yearly' && plan.yearlyPriceCents != null) return plan.yearlyPriceCents
  // 3. Fall back to monthly base × cycle multiplier
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
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="fixed inset-0 z-[70]">
        <!-- Backdrop -->
        <div class="fixed inset-0 bg-black/40 backdrop-blur-sm" @click="emit('close')"></div>

        <!-- Drawer -->
        <div class="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white dark:bg-surface-900 shadow-2xl flex flex-col">
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-800">
            <div class="flex items-center gap-3">
              <ShoppingBasket class="w-5 h-5 text-primary-600 dark:text-primary-400" />
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ t('landing.cart.title', 'Your Cart') }}
              </h2>
              <span v-if="count > 0" class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/30 text-xs font-bold text-primary-700 dark:text-primary-300">
                {{ count }}
              </span>
            </div>
            <button @click="emit('close')" class="p-2 rounded-lg text-surface-400 hover:text-gray-900 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
              <X class="w-5 h-5" />
            </button>
          </div>

          <!-- Items -->
          <div class="flex-1 overflow-y-auto px-6 py-4">
            <template v-if="items.length === 0">
              <div class="flex flex-col items-center justify-center h-full text-center py-12">
                <ShoppingBasket class="w-12 h-12 text-surface-300 dark:text-surface-600 mb-4" />
                <p class="text-sm text-surface-500 dark:text-surface-400">
                  {{ t('landing.cart.empty', 'Your cart is empty') }}
                </p>
                <p class="text-xs text-surface-400 dark:text-surface-500 mt-1">
                  {{ t('landing.cart.emptyHint', 'Search for a domain to get started') }}
                </p>
              </div>
            </template>
            <template v-else>
              <div class="space-y-3">
                <div
                  v-for="item in items"
                  :key="item.domain"
                  class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-800/50 p-4"
                >
                  <div class="flex items-center gap-3">
                    <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/30 shrink-0">
                      <Globe class="w-5 h-5 text-primary-600 dark:text-primary-400" />
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-semibold text-gray-900 dark:text-white truncate">{{ item.domain }}</p>
                      <p class="text-xs text-surface-400 dark:text-surface-500">
                        {{ formatCurrency(item.price, item.currency) }} / {{ t('landing.cart.year', 'yr') }}
                      </p>
                    </div>
                    <button
                      @click="removeDomain(item.domain)"
                      class="p-1.5 rounded-lg text-surface-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
                    >
                      <Trash2 class="w-4 h-4" />
                    </button>
                  </div>
                  <div class="mt-3 flex items-center justify-between">
                    <!-- Year selector -->
                    <div class="flex items-center gap-1">
                      <button
                        @click="setYears(item.domain, item.years - 1)"
                        :disabled="item.years <= 1"
                        class="flex items-center justify-center w-7 h-7 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-30 transition-colors"
                      >
                        <Minus class="w-3.5 h-3.5" />
                      </button>
                      <span class="w-16 text-center text-sm font-medium text-gray-900 dark:text-white">
                        {{ item.years }} {{ item.years === 1 ? t('landing.cart.year', 'yr') : t('landing.cart.years', 'yrs') }}
                      </span>
                      <button
                        @click="setYears(item.domain, item.years + 1)"
                        :disabled="item.years >= 10"
                        class="flex items-center justify-center w-7 h-7 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-30 transition-colors"
                      >
                        <Plus class="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p class="text-sm font-semibold text-gray-900 dark:text-white">
                      {{ formatCurrency(item.price * item.years, item.currency) }}
                    </p>
                  </div>

                  <!-- Service tier selector -->
                  <div v-if="plans.length > 0" class="mt-3 pt-3 border-t border-surface-200 dark:border-surface-700/50">
                    <div class="flex items-center gap-1.5 mb-2">
                      <Server class="w-3.5 h-3.5 text-surface-400" />
                      <span class="text-xs font-medium text-surface-500 dark:text-surface-400">{{ t('landing.cart.addHosting', 'Add hosting') }}</span>
                      <button
                        @click="showComparison = !showComparison"
                        class="p-0.5 rounded text-surface-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                        :title="t('landing.cart.comparePlans', 'Compare plans')"
                      >
                        <Info class="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <!-- Plan comparison panel -->
                    <Transition name="comparison">
                      <div v-if="showComparison" class="mb-2.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 overflow-hidden">
                        <table class="w-full text-[11px]">
                          <thead>
                            <tr class="border-b border-surface-100 dark:border-surface-800">
                              <th class="text-left py-1.5 px-2 font-medium text-surface-400 dark:text-surface-500"></th>
                              <th
                                v-for="plan in plans"
                                :key="plan.id"
                                class="py-1.5 px-2 font-semibold text-center text-gray-900 dark:text-white"
                              >
                                {{ localPlanName(plan) }}
                              </th>
                            </tr>
                          </thead>
                          <tbody class="text-surface-600 dark:text-surface-400">
                            <tr class="border-b border-surface-50 dark:border-surface-800/50">
                              <td class="py-1 px-2 text-surface-400">{{ t('landing.cart.planPrice', 'Price') }}</td>
                              <td v-for="plan in plans" :key="plan.id" class="py-1 px-2 text-center font-medium">
                                {{ plan.isFree ? t('landing.pricing.free', 'Free') : planPrice(plan, item.billingCycle ?? 'yearly') }}
                              </td>
                            </tr>
                            <tr class="border-b border-surface-50 dark:border-surface-800/50">
                              <td class="py-1 px-2 text-surface-400">CPU</td>
                              <td v-for="plan in plans" :key="plan.id" class="py-1 px-2 text-center">
                                {{ plan.cpuLimit === -1 ? t('landing.cart.unlimited', 'Unlimited') : plan.cpuLimit + ' ' + (plan.cpuLimit === 1 ? 'core' : 'cores') }}
                              </td>
                            </tr>
                            <tr class="border-b border-surface-50 dark:border-surface-800/50">
                              <td class="py-1 px-2 text-surface-400">{{ t('landing.cart.memory', 'RAM') }}</td>
                              <td v-for="plan in plans" :key="plan.id" class="py-1 px-2 text-center">
                                {{ formatMemory(plan.memoryLimit) }}
                              </td>
                            </tr>
                            <tr class="border-b border-surface-50 dark:border-surface-800/50">
                              <td class="py-1 px-2 text-surface-400">{{ t('landing.cart.storage', 'Storage') }}</td>
                              <td v-for="plan in plans" :key="plan.id" class="py-1 px-2 text-center">
                                {{ formatStorage(plan.storageLimit) }}
                              </td>
                            </tr>
                            <tr>
                              <td class="py-1 px-2 text-surface-400">{{ t('landing.cart.services', 'Services') }}</td>
                              <td v-for="plan in plans" :key="plan.id" class="py-1 px-2 text-center">
                                {{ plan.containerLimit === -1 ? t('landing.cart.unlimited', 'Unlimited') : plan.containerLimit }}
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
                            : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:border-surface-300 dark:hover:border-surface-600',
                        ]"
                      >
                        <span>{{ localPlanName(plan) }}</span>
                        <span v-if="!plan.isFree" class="ml-1 opacity-70">{{ planPrice(plan, item.billingCycle ?? 'yearly') }}</span>
                        <span v-else class="ml-1 opacity-70">{{ t('landing.pricing.free', 'Free') }}</span>
                      </button>
                    </div>
                    <!-- Billing cycle toggle (only when a paid plan is selected) -->
                    <div v-if="item.planId && item.planPriceCents && item.planPriceCents > 0 && allowedCycles.length > 1" class="mt-2 flex items-center gap-1">
                      <div class="inline-flex rounded-lg border border-surface-200 dark:border-surface-700 p-0.5 flex-wrap">
                        <button
                          v-for="cycle in allowedCycles"
                          :key="cycle"
                          @click="setBillingCycle(item.domain, cycle)"
                          :class="[
                            'rounded-md px-2.5 py-1 text-[11px] font-medium transition-all',
                            (item.billingCycle ?? 'monthly') === cycle
                              ? 'bg-primary-600 text-white shadow-sm'
                              : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200',
                          ]"
                        >
                          {{ CYCLE_LABELS[cycle] }}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Footer -->
          <div v-if="items.length > 0" class="px-6 py-4 border-t border-surface-200 dark:border-surface-800 space-y-4">
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-sm text-surface-600 dark:text-surface-400">{{ t('landing.cart.domains', 'Domains') }}</span>
                <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ formattedTotal }}</span>
              </div>
              <div v-if="hasHosting" class="flex items-center justify-between">
                <span class="text-sm text-surface-600 dark:text-surface-400">{{ t('landing.cart.hosting', 'Hosting') }}</span>
                <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ formattedHostingTotal() }} {{ hostingCycleLabel() }}</span>
              </div>
              <p class="text-[11px] text-surface-400 dark:text-surface-500">{{ t('landing.cart.exclVat', 'Excl. VAT') }}</p>
            </div>
            <router-link
              to="/get-started?cart=true"
              @click="emit('close')"
              class="block w-full rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition-all hover:shadow-primary-500/40 hover:brightness-110"
            >
              {{ t('landing.cart.checkout', 'Continue to Checkout') }}
            </router-link>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.3s ease;
}
.drawer-enter-active > div:last-child,
.drawer-leave-active > div:last-child {
  transition: transform 0.3s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from > div:last-child {
  transform: translateX(100%);
}
.drawer-leave-to > div:last-child {
  transform: translateX(100%);
}
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
