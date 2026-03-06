import { ref, computed, watch } from 'vue'

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
  billingCycle?: 'monthly' | 'yearly'
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

  // Sum of attached hosting plan costs (in display currency amount, not cents)
  const hostingTotal = computed(() =>
    items.value.reduce((sum, i) => {
      if (!i.planPriceCents) return sum
      const cycle = i.billingCycle ?? 'yearly'
      return sum + (cycle === 'yearly' ? (i.planPriceCents * 12) / 100 : i.planPriceCents / 100)
    }, 0),
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

  function setPlan(domain: string, plan: { id: string; slug: string; name: string; priceCents: number } | null) {
    const item = items.value.find(i => i.domain === domain)
    if (!item) return
    if (plan) {
      item.planId = plan.id
      item.planSlug = plan.slug
      item.planName = plan.name
      item.planPriceCents = plan.priceCents
      if (!item.billingCycle) item.billingCycle = 'yearly'
    } else {
      item.planId = undefined
      item.planSlug = undefined
      item.planName = undefined
      item.planPriceCents = undefined
      item.billingCycle = undefined
    }
  }

  function setBillingCycle(domain: string, cycle: 'monthly' | 'yearly') {
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
