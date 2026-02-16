import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BillingPlan, Subscription, UsageRecord } from '@fleet/types'
import { useApi } from '@/composables/useApi'

export interface Invoice {
  id: string
  amount: number
  currency: string
  status: string
  createdAt: string
  pdfUrl: string | null
}

export const useBillingStore = defineStore('billing', () => {
  const api = useApi()

  const subscription = ref<Subscription | null>(null)
  const usage = ref<UsageRecord | null>(null)
  const plans = ref<BillingPlan[]>([])
  const invoices = ref<Invoice[]>([])
  const loading = ref(false)

  async function fetchPlans() {
    loading.value = true
    try {
      const data = await api.get<BillingPlan[]>('/billing/plans')
      plans.value = data
      return data
    } finally {
      loading.value = false
    }
  }

  async function fetchSubscription() {
    loading.value = true
    try {
      const data = await api.get<Subscription>('/billing/subscription')
      subscription.value = data
      return data
    } finally {
      loading.value = false
    }
  }

  async function fetchUsage() {
    loading.value = true
    try {
      const data = await api.get<UsageRecord>('/billing/usage')
      usage.value = data
      return data
    } finally {
      loading.value = false
    }
  }

  async function fetchInvoices() {
    loading.value = true
    try {
      const data = await api.get<Invoice[]>('/billing/invoices')
      invoices.value = data
      return data
    } finally {
      loading.value = false
    }
  }

  async function createCheckout(planId: string) {
    const data = await api.post<{ url: string }>('/billing/checkout', {
      planId,
      successUrl: `${window.location.origin}/panel/billing?success=true`,
      cancelUrl: `${window.location.origin}/panel/billing?cancelled=true`,
    })
    return data.url
  }

  return {
    subscription,
    usage,
    plans,
    invoices,
    loading,
    fetchPlans,
    fetchSubscription,
    fetchUsage,
    fetchInvoices,
    createCheckout,
  }
})
