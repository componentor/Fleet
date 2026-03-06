import { ref, computed, watch } from 'vue'

export type BillingCycle = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'

/** Monthly-equivalent multiplier for each cycle */
export const CYCLE_MONTHS: Record<BillingCycle, number> = {
  daily: 1 / 30,
  weekly: 7 / 30,
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
}

export const CYCLE_LABELS: Record<BillingCycle, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half Yearly',
  yearly: 'Yearly',
}

export const CYCLE_SHORT: Record<BillingCycle, string> = {
  daily: 'day',
  weekly: 'wk',
  monthly: 'mo',
  quarterly: 'qtr',
  half_yearly: '6mo',
  yearly: 'yr',
}

export interface CartItem {
  type: 'domain'
  domain: string
  price: number
  renewalPrice?: number
  currency: string
  years: number
  // Optional attached service tier
  planId?: string
  planSlug?: string
  planName?: string
  planPriceCents?: number
  planYearlyPriceCents?: number | null
  planCyclePrices?: Record<string, number>
  billingCycle?: BillingCycle
}

const STORAGE_KEY = 'fleet-cart'

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

const items = ref<CartItem[]>(loadCart())

// Persist to localStorage on every change
watch(items, (val) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
}, { deep: true })

export function useCart() {
  const count = computed(() => items.value.length)
  const total = computed(() => items.value.reduce((sum, i) => sum + i.price * i.years, 0))

  function getItemCyclePriceCents(item: CartItem): number {
    if (!item.planPriceCents) return 0
    const cycle = item.billingCycle ?? 'monthly'
    // 1. Specific cycle price configured for this currency
    if (item.planCyclePrices?.[cycle] != null) return item.planCyclePrices[cycle]
    // 2. Explicit yearly price
    if (cycle === 'yearly' && item.planYearlyPriceCents != null) return item.planYearlyPriceCents
    // 3. Monthly base × multiplier
    return Math.round(item.planPriceCents * CYCLE_MONTHS[cycle])
  }

  // Sum of attached hosting plan costs (in display currency amount, not cents)
  const hostingTotal = computed(() =>
    items.value.reduce((sum, i) => sum + getItemCyclePriceCents(i) / 100, 0),
  )

  function addDomain(domain: string, price: number, currency: string, renewalPrice?: number, years = 1) {
    // Don't add duplicates
    if (items.value.some(i => i.domain === domain)) return
    items.value.push({ type: 'domain', domain, price, currency, renewalPrice, years })
  }

  function removeDomain(domain: string) {
    items.value = items.value.filter(i => i.domain !== domain)
  }

  function hasDomain(domain: string) {
    return items.value.some(i => i.domain === domain)
  }

  function setYears(domain: string, years: number) {
    const item = items.value.find(i => i.domain === domain)
    if (item) item.years = Math.max(1, Math.min(10, years))
  }

  function updateDomain(domain: string, price: number, currency: string, renewalPrice?: number) {
    const item = items.value.find(i => i.domain === domain)
    if (item) {
      item.price = price
      item.currency = currency
      if (renewalPrice !== undefined) item.renewalPrice = renewalPrice
    }
  }

  function setPlan(domain: string, plan: { id: string; slug: string; name: string; priceCents: number; yearlyPriceCents?: number | null; cyclePrices?: Record<string, number> } | null) {
    const item = items.value.find(i => i.domain === domain)
    if (!item) return
    if (plan) {
      item.planId = plan.id
      item.planSlug = plan.slug
      item.planName = plan.name
      item.planPriceCents = plan.priceCents
      item.planYearlyPriceCents = plan.yearlyPriceCents ?? undefined
      item.planCyclePrices = plan.cyclePrices
      if (!item.billingCycle) item.billingCycle = 'monthly'
    } else {
      item.planId = undefined
      item.planSlug = undefined
      item.planName = undefined
      item.planPriceCents = undefined
      item.planYearlyPriceCents = undefined
      item.planCyclePrices = undefined
      item.billingCycle = undefined
    }
  }

  function setBillingCycle(domain: string, cycle: BillingCycle) {
    const item = items.value.find(i => i.domain === domain)
    if (item) item.billingCycle = cycle
  }

  function clearCart() {
    items.value = []
  }

  return {
    items,
    count,
    total,
    hostingTotal,
    addDomain,
    removeDomain,
    hasDomain,
    setYears,
    updateDomain,
    setPlan,
    setBillingCycle,
    clearCart,
  }
}
