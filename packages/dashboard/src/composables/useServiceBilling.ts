import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApi, ApiError } from './useApi'
import { useToast } from './useToast'
import { useCurrency } from './useCurrency'

export interface ServiceTier {
  id: string
  name: string
  slug: string
  description: string | null
  nameTranslations?: Record<string, string>
  descriptionTranslations?: Record<string, string>
  priceCents: number
  cpuLimit: number
  memoryLimit: number
  containerLimit: number
  storageLimit: number
  bandwidthLimit: number | null
  volumeIncludedGb: number
  scope: 'service' | 'stack'
  isFree: boolean
  isDefault: boolean
  sortOrder: number
}

export interface ServiceSubscription {
  id: string
  accountId: string
  planId: string | null
  serviceId: string | null
  stackId: string | null
  billingModel: string
  billingCycle: string
  status: string
  paymentContactName: string | null
  paymentContactEmail: string | null
  stripeSubscriptionId: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  plan?: ServiceTier | null
}

export interface ResourceConflict {
  field: string
  current: number
  limit: number
}

export type ChangePlanResult =
  | { ok: true }
  | { ok: false; status?: number; conflicts?: ResourceConflict[]; message?: string }

// Module-level shared state
const tiers = ref<ServiceTier[]>([])
const tiersLoaded = ref(false)

/** Get the localized name/description for a plan-like object */
export function usePlanLocale() {
  const { locale } = useI18n()
  function planName(plan: { name: string; nameTranslations?: Record<string, string> }): string {
    return plan.nameTranslations?.[locale.value] || plan.name
  }
  function planDescription(plan: { description?: string | null; descriptionTranslations?: Record<string, string> }): string {
    return plan.descriptionTranslations?.[locale.value] || plan.description || ''
  }
  return { planName, planDescription }
}

export function useServiceBilling() {
  const api = useApi()
  const toast = useToast()
  const { formatCents, selectedCurrency } = useCurrency()

  async function fetchTiers() {
    if (tiersLoaded.value) return
    try {
      const data = await api.get<{ plans: ServiceTier[] }>(`/billing/public/plans?currency=${selectedCurrency.value}`)
      tiers.value = (data.plans ?? []).sort((a, b) => a.sortOrder - b.sortOrder)
      tiersLoaded.value = true
    } catch {
      // Fallback — tiers may not be configured yet
    }
  }

  async function refreshTiers() {
    tiersLoaded.value = false
    await fetchTiers()
  }

  async function fetchServiceSubscription(serviceId: string): Promise<ServiceSubscription | null> {
    try {
      return await api.get<ServiceSubscription | null>(`/billing/services/${serviceId}/subscription`)
    } catch {
      return null
    }
  }

  async function listServiceSubscriptions(): Promise<ServiceSubscription[]> {
    try {
      return await api.get<ServiceSubscription[]>('/billing/service-subscriptions')
    } catch {
      return []
    }
  }

  async function createCheckout(params: {
    serviceId?: string
    stackId?: string
    planId: string
    billingCycle: string
    currency?: string
    paymentMethodId?: string
    billingContactEmail?: string
    billingContactName?: string
  }): Promise<string | null> {
    try {
      const origin = window.location.origin
      const result = await api.post<{ url: string }>('/billing/service-subscriptions/checkout', {
        ...params,
        currency: params.currency ?? selectedCurrency.value,
        successUrl: `${origin}/panel/billing?checkout=success`,
        cancelUrl: `${origin}/panel/billing?checkout=cancelled`,
      })
      return result.url
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        const body = err.body as Record<string, unknown> | undefined
        toast.error((body?.error as string) ?? 'Billing is not configured. Contact your administrator.')
      } else {
        toast.error('Failed to create checkout session')
      }
      return null
    }
  }

  async function changePlan(subscriptionId: string, planId: string, opts?: { confirm?: boolean }): Promise<ChangePlanResult> {
    try {
      const qs = opts?.confirm ? '?confirm=true' : ''
      await api.patch(`/billing/service-subscriptions/${subscriptionId}/plan${qs}`, { planId })
      toast.success('Plan updated successfully')
      return { ok: true }
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as Record<string, unknown> | undefined
        if (err.status === 409 && body?.conflicts) {
          return { ok: false, status: 409, conflicts: body.conflicts as ResourceConflict[] }
        }
        if (err.status === 403) {
          return { ok: false, status: 403, message: (body?.error as string) ?? 'Downgrade is not allowed' }
        }
      }
      toast.error('Failed to change plan')
      return { ok: false }
    }
  }

  async function changePaymentMethod(subscriptionId: string, paymentMethodId: string): Promise<boolean> {
    try {
      await api.patch(`/billing/service-subscriptions/${subscriptionId}/payment-method`, { paymentMethodId })
      toast.success('Payment method updated')
      return true
    } catch {
      toast.error('Failed to update payment method')
      return false
    }
  }

  async function updateContact(subscriptionId: string, contact: { billingContactEmail?: string; billingContactName?: string }): Promise<boolean> {
    try {
      await api.patch(`/billing/service-subscriptions/${subscriptionId}/contact`, contact)
      toast.success('Billing contact updated')
      return true
    } catch {
      toast.error('Failed to update billing contact')
      return false
    }
  }

  async function cancelSubscription(subscriptionId: string): Promise<boolean> {
    try {
      await api.del(`/billing/service-subscriptions/${subscriptionId}`)
      toast.success('Subscription will cancel at end of billing period')
      return true
    } catch {
      toast.error('Failed to cancel subscription')
      return false
    }
  }

  async function fetchFreeTierUsage(): Promise<{ used: number; limit: number | null }> {
    try {
      return await api.get<{ used: number; limit: number | null }>('/billing/free-tier-usage')
    } catch {
      return { used: 0, limit: null }
    }
  }

  async function fetchBillingConfig(): Promise<{ allowDowngrade: boolean; maxFreeServicesPerAccount: number | null } | null> {
    try {
      return await api.get<{ allowDowngrade: boolean; maxFreeServicesPerAccount: number | null }>('/billing/config')
    } catch {
      return null
    }
  }

  const freeTier = computed(() => tiers.value.find(t => t.isFree) ?? null)

  return {
    tiers,
    tiersLoaded,
    freeTier,
    fetchTiers,
    refreshTiers,
    fetchServiceSubscription,
    listServiceSubscriptions,
    createCheckout,
    changePlan,
    fetchFreeTierUsage,
    fetchBillingConfig,
    changePaymentMethod,
    updateContact,
    cancelSubscription,
    formatCents,
  }
}
