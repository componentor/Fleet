<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import {
  Store,
  Loader2,
  CreditCard,
  Percent,
  DollarSign,
  Palette,
  Users,
  ExternalLink,
  CheckCircle,
  Clock,
  XCircle,
  Info,
  Link,
  Send,
  TrendingUp,
  ArrowRight,
  Copy,
  Check,
  BarChart3,
  Zap,
  Eye,
  Globe,
  CircleDollarSign,
  LayoutDashboard,
  RefreshCw,
} from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const route = useRoute()
const api = useApi()
const toast = useToast()

// ---------- State ----------
const loading = ref(true)

// Status endpoint data
const isReseller = ref(false)
const resellerAccount = ref<any>(null)
const config = ref<any>(null)
const canApply = ref(false)
const pendingApplication = ref(false)

// Dashboard data
const dashboard = ref<any>(null)

// Stripe Connect status
const stripeConnect = ref<any>(null)

// Earnings data
const earnings = ref<any>(null)

// Application form
const applicationMessage = ref('')
const applying = ref(false)

// Markup form
const markupType = ref<string>('percentage')
const markupPercent = ref<number>(0)
const markupFixed = ref<number>(0)
const savingMarkup = ref(false)

// Branding form
const signupSlug = ref('')
const customDomain = ref('')
const brandName = ref('')
const brandLogoUrl = ref('')
const brandPrimaryColor = ref('#6366f1')
const brandDescription = ref('')
const savingBranding = ref(false)

// Sub-account toggling
const togglingSubAccount = ref<string | null>(null)

// Stripe Connect onboarding
const connectingStripe = ref(false)

// Clipboard
const copiedSlug = ref(false)

// Connect dashboard
const openingDashboard = ref(false)

// Active section (for dashboard tabs)
const activeSection = ref<'overview' | 'pricing' | 'branding' | 'customers'>('overview')

// ---------- Computed ----------
const programEnabled = computed(() => config.value?.enabled === true)

const signupPageUrl = computed(() => {
  if (!signupSlug.value) return null
  return `${window.location.origin}/r/${signupSlug.value}`
})

const showMarkupPercent = computed(() =>
  markupType.value === 'percentage' || markupType.value === 'hybrid',
)

const showMarkupFixed = computed(() =>
  markupType.value === 'fixed' || markupType.value === 'hybrid',
)

const subAccounts = computed(() => dashboard.value?.subAccounts ?? [])

const allowSubAccountReselling = computed(() => config.value?.allowSubAccountReselling === true)

const onboardingSteps = computed(() => {
  const steps = [
    {
      key: 'approved',
      label: 'Account Approved',
      done: isReseller.value,
      icon: CheckCircle,
    },
    {
      key: 'stripe',
      label: 'Connect Stripe',
      done: stripeConnect.value?.onboarded === true,
      icon: CreditCard,
    },
    {
      key: 'branding',
      label: 'Set Up Branding',
      done: !!(resellerAccount.value?.brandName && resellerAccount.value?.signupSlug),
      icon: Palette,
    },
    {
      key: 'pricing',
      label: 'Configure Pricing',
      done: (resellerAccount.value?.markupType && (resellerAccount.value?.markupPercent > 0 || resellerAccount.value?.markupFixed > 0)),
      icon: DollarSign,
    },
  ]
  return steps
})

const completedSteps = computed(() => onboardingSteps.value.filter(s => s.done).length)
const onboardingComplete = computed(() => completedSteps.value === onboardingSteps.value.length)

const estimatedMonthlyRevenue = computed(() => {
  return earnings.value?.estimatedMonthlyRevenueCents ?? 0
})

// ---------- Fetching ----------
async function fetchStatus() {
  try {
    const data = await api.get<any>('/reseller/status')
    isReseller.value = data.isReseller ?? false
    resellerAccount.value = data.resellerAccount ?? null
    config.value = data.config ?? {}
    canApply.value = data.canApply ?? false
    pendingApplication.value = data.pendingApplication ?? false
  } catch {
    config.value = { enabled: false }
  }
}

async function fetchDashboard() {
  try {
    const data = await api.get<any>('/reseller/dashboard')
    dashboard.value = data

    const ra = data.resellerAccount
    if (ra) {
      markupType.value = ra.markupType ?? 'percentage'
      markupPercent.value = ra.markupPercent ?? 0
      markupFixed.value = ra.markupFixed ?? 0
      signupSlug.value = ra.signupSlug ?? ''
      customDomain.value = ra.customDomain ?? ''
      brandName.value = ra.brandName ?? ''
      brandLogoUrl.value = ra.brandLogoUrl ?? ''
      brandPrimaryColor.value = ra.brandPrimaryColor ?? '#6366f1'
      brandDescription.value = ra.brandDescription ?? ''
    }
  } catch {
    // Dashboard not available
  }
}

async function fetchConnectStatus() {
  try {
    stripeConnect.value = await api.get<any>('/reseller/connect/status')
  } catch {
    stripeConnect.value = null
  }
}

async function fetchEarnings() {
  try {
    earnings.value = await api.get<any>('/reseller/earnings')
  } catch {
    earnings.value = null
  }
}

async function loadAll() {
  loading.value = true
  try {
    await fetchStatus()
    if (isReseller.value) {
      await Promise.all([fetchDashboard(), fetchConnectStatus(), fetchEarnings()])
    }
  } finally {
    loading.value = false
  }
}

// ---------- Actions ----------
async function applyToBeReseller() {
  applying.value = true
  try {
    await api.post('/reseller/apply', {
      message: applicationMessage.value || undefined,
    })
    toast.success(t('reseller.applicationSubmitted', 'Your application has been submitted'))
    pendingApplication.value = true
    canApply.value = false
    applicationMessage.value = ''
    // Reload to check if auto-approved
    await loadAll()
  } catch (err: any) {
    toast.error(err?.body?.error || t('reseller.applicationFailed', 'Failed to submit application'))
  } finally {
    applying.value = false
  }
}

async function saveMarkup() {
  savingMarkup.value = true
  try {
    const body: any = { markupType: markupType.value }
    if (showMarkupPercent.value) body.markupPercent = markupPercent.value
    if (showMarkupFixed.value) body.markupFixed = markupFixed.value
    await api.patch('/reseller/markup', body)
    toast.success(t('reseller.markupSaved', 'Markup settings saved'))
    await fetchDashboard()
  } catch (err: any) {
    toast.error(err?.body?.error || t('reseller.markupFailed', 'Failed to save markup settings'))
  } finally {
    savingMarkup.value = false
  }
}

async function saveBranding() {
  savingBranding.value = true
  try {
    await api.patch('/reseller/branding', {
      signupSlug: signupSlug.value || undefined,
      customDomain: customDomain.value || undefined,
      brandName: brandName.value || undefined,
      brandLogoUrl: brandLogoUrl.value || undefined,
      brandPrimaryColor: brandPrimaryColor.value || undefined,
      brandDescription: brandDescription.value || undefined,
    })
    toast.success(t('reseller.brandingSaved', 'Branding settings saved'))
    await fetchDashboard()
  } catch (err: any) {
    toast.error(err?.body?.error || t('reseller.brandingFailed', 'Failed to save branding settings'))
  } finally {
    savingBranding.value = false
  }
}

async function connectStripe() {
  connectingStripe.value = true
  try {
    const res = await api.post<{ url: string }>('/reseller/connect', {})
    if (res.url) {
      window.open(res.url, '_blank')
    }
  } catch (err: any) {
    toast.error(err?.body?.error || t('reseller.connectFailed', 'Failed to start Stripe onboarding'))
  } finally {
    connectingStripe.value = false
  }
}

async function openStripeDashboard() {
  openingDashboard.value = true
  try {
    const res = await api.get<{ url: string }>('/reseller/connect/dashboard')
    if (res.url) {
      window.open(res.url, '_blank')
    }
  } catch (err: any) {
    toast.error(err?.body?.error || 'Failed to open Stripe dashboard')
  } finally {
    openingDashboard.value = false
  }
}

async function toggleSubAccountReselling(subAccountId: string, enable: boolean) {
  togglingSubAccount.value = subAccountId
  try {
    const action = enable ? 'enable-reselling' : 'disable-reselling'
    await api.post(`/reseller/sub-accounts/${subAccountId}/${action}`, {})
    toast.success(
      enable
        ? t('reseller.resellingEnabled', 'Reselling enabled for sub-account')
        : t('reseller.resellingDisabled', 'Reselling disabled for sub-account'),
    )
    await fetchDashboard()
  } catch (err: any) {
    toast.error(err?.body?.error || t('reseller.toggleFailed', 'Failed to update sub-account'))
  } finally {
    togglingSubAccount.value = null
  }
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

async function copySignupUrl() {
  if (!signupPageUrl.value) return
  try {
    await navigator.clipboard.writeText(signupPageUrl.value)
    copiedSlug.value = true
    setTimeout(() => { copiedSlug.value = false }, 2000)
  } catch {
    toast.error('Failed to copy')
  }
}

// Handle return from Stripe Connect onboarding
watch(() => route.query, async (q) => {
  if (q.connected === '1' || q.refresh === '1') {
    await fetchConnectStatus()
  }
}, { immediate: true })

// ---------- Lifecycle ----------
onMounted(() => {
  loadAll()
})
</script>

<template>
  <div>
    <!-- Page Header -->
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-xl bg-primary-100 dark:bg-primary-900/30">
          <Store class="w-6 h-6 text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('reseller.title', 'Reseller Program') }}</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400">Manage your reseller account, pricing, and branding</p>
        </div>
      </div>
      <button
        v-if="isReseller && !loading"
        @click="loadAll"
        class="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        title="Refresh"
      >
        <RefreshCw class="w-4 h-4" />
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <template v-else>
      <!-- ═══════════════════════════════════════════════════ -->
      <!-- State 1: Program Not Enabled                       -->
      <!-- ═══════════════════════════════════════════════════ -->
      <div v-if="!programEnabled" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center max-w-lg mx-auto">
        <div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center mx-auto mb-5">
          <Store class="w-8 h-8 text-gray-400 dark:text-gray-500" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Reseller Program Not Available</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">The reseller program is not currently enabled on this platform. Contact your administrator for more information.</p>
      </div>

      <!-- ═══════════════════════════════════════════════════ -->
      <!-- State 2: Not a Reseller, Can Apply                 -->
      <!-- ═══════════════════════════════════════════════════ -->
      <div v-else-if="!isReseller && canApply && !pendingApplication" class="max-w-2xl mx-auto">
        <!-- Hero -->
        <div class="bg-gradient-to-br from-primary-600 to-primary-800 dark:from-primary-700 dark:to-primary-900 rounded-2xl p-8 mb-6 text-white relative overflow-hidden">
          <div class="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div class="relative">
            <h2 class="text-2xl font-bold mb-3">Become a Reseller</h2>
            <p class="text-primary-100 text-sm leading-relaxed max-w-md">
              Resell our platform under your own brand. Set your own prices, create custom signup pages, and earn revenue from every customer you bring in.
            </p>
            <div class="flex gap-6 mt-6">
              <div class="flex items-center gap-2 text-sm text-primary-200">
                <DollarSign class="w-4 h-4" />
                <span>Earn recurring revenue</span>
              </div>
              <div class="flex items-center gap-2 text-sm text-primary-200">
                <Palette class="w-4 h-4" />
                <span>Your own branding</span>
              </div>
              <div class="flex items-center gap-2 text-sm text-primary-200">
                <Users class="w-4 h-4" />
                <span>Manage sub-accounts</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Application form -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Send class="w-5 h-5 text-primary-600 dark:text-primary-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Apply Now</h2>
          </div>
          <div class="p-6">
            <form @submit.prevent="applyToBeReseller" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Tell us about your business
                  <span class="text-gray-400 dark:text-gray-500 font-normal ml-1">(optional)</span>
                </label>
                <textarea
                  v-model="applicationMessage"
                  rows="3"
                  placeholder="Describe your business and how you plan to use the reseller program..."
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm resize-none"
                />
              </div>
              <button
                type="submit"
                :disabled="applying"
                class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="applying" class="w-4 h-4 animate-spin" />
                <Send v-else class="w-4 h-4" />
                {{ applying ? 'Submitting...' : 'Submit Application' }}
              </button>
            </form>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════ -->
      <!-- State 3: Application Pending                       -->
      <!-- ═══════════════════════════════════════════════════ -->
      <div v-else-if="!isReseller && pendingApplication" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center max-w-lg mx-auto">
        <div class="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-5">
          <Clock class="w-8 h-8 text-amber-500 dark:text-amber-400" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Application Under Review</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">Your application to join the reseller program is being reviewed. You'll be notified once a decision has been made.</p>
      </div>

      <!-- ═══════════════════════════════════════════════════ -->
      <!-- State 4: Active Reseller Dashboard                 -->
      <!-- ═══════════════════════════════════════════════════ -->
      <template v-else-if="isReseller">

        <!-- Onboarding progress bar (shown until all steps complete) -->
        <div v-if="!onboardingComplete" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 mb-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Setup Progress</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Complete all steps to start earning</p>
            </div>
            <span class="text-sm font-semibold text-primary-600 dark:text-primary-400">{{ completedSteps }}/{{ onboardingSteps.length }}</span>
          </div>
          <!-- Progress bar -->
          <div class="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full mb-5 overflow-hidden">
            <div
              class="h-full bg-gradient-to-r from-primary-500 to-primary-600 rounded-full transition-all duration-500"
              :style="{ width: `${(completedSteps / onboardingSteps.length) * 100}%` }"
            />
          </div>
          <!-- Steps -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div
              v-for="step in onboardingSteps"
              :key="step.key"
              class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors"
              :class="step.done ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' : 'bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600'"
            >
              <component
                :is="step.done ? CheckCircle : step.icon"
                :class="step.done ? 'w-4 h-4 text-green-500 shrink-0' : 'w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0'"
              />
              <span
                class="text-xs font-medium"
                :class="step.done ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-400'"
              >
                {{ step.label }}
              </span>
            </div>
          </div>
        </div>

        <!-- Dashboard tabs -->
        <div class="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
          <button
            v-for="tab in [
              { id: 'overview', label: 'Overview', icon: BarChart3 },
              { id: 'pricing', label: 'Pricing', icon: DollarSign },
              { id: 'branding', label: 'Branding', icon: Palette },
              { id: 'customers', label: 'Customers', icon: Users },
            ]"
            :key="tab.id"
            @click="activeSection = tab.id as any"
            :class="[
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              activeSection === tab.id
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600',
            ]"
          >
            <component :is="tab.icon" class="w-4 h-4" />
            {{ tab.label }}
            <span
              v-if="tab.id === 'customers' && subAccounts.length > 0"
              class="ml-1 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
            >
              {{ subAccounts.length }}
            </span>
          </button>
        </div>

        <!-- ═══ Tab: Overview ═══════════════════════════════ -->
        <div v-if="activeSection === 'overview'" class="space-y-6">

          <!-- Stats Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <!-- Sub-accounts -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <div class="flex items-center justify-between mb-3">
                <div class="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <Users class="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
              <p class="text-2xl font-bold text-gray-900 dark:text-white">{{ earnings?.totalSubAccounts ?? subAccounts.length }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Sub-accounts</p>
            </div>
            <!-- Active subscriptions -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <div class="flex items-center justify-between mb-3">
                <div class="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                  <Zap class="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <p class="text-2xl font-bold text-gray-900 dark:text-white">{{ earnings?.activeSubscriptions ?? 0 }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Active subscriptions</p>
            </div>
            <!-- Estimated monthly revenue -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <div class="flex items-center justify-between mb-3">
                <div class="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                  <TrendingUp class="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <p class="text-2xl font-bold text-gray-900 dark:text-white">{{ formatCents(estimatedMonthlyRevenue) }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Est. monthly revenue</p>
            </div>
            <!-- Stripe status -->
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <div class="flex items-center justify-between mb-3">
                <div class="p-2 rounded-lg" :class="stripeConnect?.onboarded ? 'bg-green-100 dark:bg-green-900/30' : 'bg-amber-100 dark:bg-amber-900/30'">
                  <CreditCard :class="stripeConnect?.onboarded ? 'w-4 h-4 text-green-600 dark:text-green-400' : 'w-4 h-4 text-amber-600 dark:text-amber-400'" />
                </div>
              </div>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">
                {{ stripeConnect?.onboarded ? 'Connected' : stripeConnect?.connected ? 'Pending' : 'Not Connected' }}
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Stripe payouts</p>
            </div>
          </div>

          <!-- Stripe Connect Card -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <CreditCard class="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <h2 class="text-base font-semibold text-gray-900 dark:text-white">Stripe Connect</h2>
              </div>
              <div v-if="stripeConnect?.onboarded" class="flex items-center gap-2">
                <button
                  @click="openStripeDashboard"
                  :disabled="openingDashboard"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                >
                  <Loader2 v-if="openingDashboard" class="w-3.5 h-3.5 animate-spin" />
                  <LayoutDashboard v-else class="w-3.5 h-3.5" />
                  Stripe Dashboard
                  <ExternalLink class="w-3 h-3" />
                </button>
              </div>
            </div>
            <div class="p-6">
              <!-- Not connected -->
              <div v-if="!stripeConnect?.connected" class="flex items-start gap-4">
                <div class="p-3 rounded-xl bg-primary-50 dark:bg-primary-900/20 shrink-0">
                  <CreditCard class="w-6 h-6 text-primary-600 dark:text-primary-400" />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-1">Connect your Stripe account</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
                    Link a Stripe account to receive automatic payouts when your sub-accounts pay their subscriptions. This is required before you can earn revenue.
                  </p>
                  <button
                    @click="connectStripe"
                    :disabled="connectingStripe"
                    class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    <Loader2 v-if="connectingStripe" class="w-4 h-4 animate-spin" />
                    <ExternalLink v-else class="w-4 h-4" />
                    {{ connectingStripe ? 'Connecting...' : 'Connect Stripe Account' }}
                  </button>
                </div>
              </div>

              <!-- Connected but not fully onboarded -->
              <div v-else-if="!stripeConnect.onboarded" class="flex items-start gap-4">
                <div class="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 shrink-0">
                  <Clock class="w-6 h-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-1">Complete Stripe onboarding</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400 mb-3">
                    Your account is linked but onboarding is incomplete. Please finish the setup process to start receiving payouts.
                  </p>
                  <div class="grid grid-cols-3 gap-3 mb-4">
                    <div class="flex items-center gap-1.5 text-xs" :class="stripeConnect.chargesEnabled ? 'text-green-600 dark:text-green-400' : 'text-gray-400'">
                      <component :is="stripeConnect.chargesEnabled ? CheckCircle : XCircle" class="w-3.5 h-3.5" />
                      Charges
                    </div>
                    <div class="flex items-center gap-1.5 text-xs" :class="stripeConnect.payoutsEnabled ? 'text-green-600 dark:text-green-400' : 'text-gray-400'">
                      <component :is="stripeConnect.payoutsEnabled ? CheckCircle : XCircle" class="w-3.5 h-3.5" />
                      Payouts
                    </div>
                    <div class="flex items-center gap-1.5 text-xs" :class="stripeConnect.onboarded ? 'text-green-600 dark:text-green-400' : 'text-gray-400'">
                      <component :is="stripeConnect.onboarded ? CheckCircle : XCircle" class="w-3.5 h-3.5" />
                      Onboarded
                    </div>
                  </div>
                  <button
                    @click="connectStripe"
                    :disabled="connectingStripe"
                    class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    <Loader2 v-if="connectingStripe" class="w-4 h-4 animate-spin" />
                    <ExternalLink v-else class="w-4 h-4" />
                    {{ connectingStripe ? 'Opening...' : 'Continue Onboarding' }}
                  </button>
                </div>
              </div>

              <!-- Fully connected -->
              <div v-else class="flex items-start gap-4">
                <div class="p-3 rounded-xl bg-green-50 dark:bg-green-900/20 shrink-0">
                  <CheckCircle class="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-1">Stripe account connected</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    Your Stripe account is fully set up. Revenue from sub-account subscriptions will be automatically transferred to your account.
                  </p>
                  <div class="flex items-center gap-4 mt-3">
                    <div class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                      <CheckCircle class="w-3.5 h-3.5" />
                      Charges enabled
                    </div>
                    <div class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                      <CheckCircle class="w-3.5 h-3.5" />
                      Payouts enabled
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Discount info -->
          <div v-if="dashboard?.effectiveDiscount" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <Percent class="w-5 h-5 text-gray-500 dark:text-gray-400" />
              <h2 class="text-base font-semibold text-gray-900 dark:text-white">Your Discount Rate</h2>
            </div>
            <div class="p-6">
              <div class="flex items-start gap-4">
                <div class="p-3 rounded-xl bg-violet-50 dark:bg-violet-900/20 shrink-0">
                  <CircleDollarSign class="w-6 h-6 text-violet-600 dark:text-violet-400" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-baseline gap-3 mb-1">
                    <span class="text-2xl font-bold text-gray-900 dark:text-white">
                      <template v-if="dashboard.effectiveDiscount.type === 'percentage' || dashboard.effectiveDiscount.type === 'hybrid'">
                        {{ dashboard.effectiveDiscount.percentage ?? dashboard.effectiveDiscount.percent ?? 0 }}%
                      </template>
                      <template v-else>
                        {{ formatCents(dashboard.effectiveDiscount.fixed ?? 0) }}
                      </template>
                    </span>
                    <span class="text-sm text-gray-500 dark:text-gray-400 capitalize">{{ dashboard.effectiveDiscount.type ?? 'percentage' }} discount</span>
                  </div>
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    This is the discount you receive on platform prices. Set by your platform administrator.
                    <template v-if="dashboard.effectiveDiscount.type === 'hybrid'">
                      Additional fixed discount: {{ formatCents(dashboard.effectiveDiscount.fixed ?? 0) }}
                    </template>
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Quick signup link -->
          <div v-if="signupPageUrl" class="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3 min-w-0 flex-1">
                <div class="p-2 rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 shrink-0">
                  <Link class="w-4 h-4 text-gray-500 dark:text-gray-400" />
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Your Signup Page</p>
                  <p class="text-xs text-primary-600 dark:text-primary-400 font-mono truncate">{{ signupPageUrl }}</p>
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0 ml-3">
                <button
                  @click="copySignupUrl"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors"
                >
                  <component :is="copiedSlug ? Check : Copy" class="w-3.5 h-3.5" />
                  {{ copiedSlug ? 'Copied!' : 'Copy' }}
                </button>
                <a
                  :href="signupPageUrl"
                  target="_blank"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors"
                >
                  <Eye class="w-3.5 h-3.5" />
                  Preview
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ Tab: Pricing ════════════════════════════════ -->
        <div v-if="activeSection === 'pricing'" class="space-y-6">

          <!-- Pricing explainer -->
          <div class="bg-gradient-to-r from-primary-50 to-violet-50 dark:from-primary-900/20 dark:to-violet-900/20 rounded-xl border border-primary-200 dark:border-primary-800 p-5">
            <div class="flex items-start gap-3">
              <Info class="w-5 h-5 text-primary-600 dark:text-primary-400 shrink-0 mt-0.5" />
              <div>
                <h3 class="text-sm font-semibold text-primary-900 dark:text-primary-100 mb-1">How pricing works</h3>
                <p class="text-xs text-primary-700 dark:text-primary-300 leading-relaxed">
                  You receive a discount on platform prices (set by the admin). You then add your markup on top of the discounted price. Your customers pay the final price, and your profit is the markup amount.
                </p>
                <div class="flex items-center gap-2 mt-3 text-xs text-primary-800 dark:text-primary-200 font-mono">
                  <span class="px-2 py-1 bg-white dark:bg-gray-800 rounded border border-primary-200 dark:border-primary-700">Platform Price</span>
                  <ArrowRight class="w-3 h-3" />
                  <span class="px-2 py-1 bg-white dark:bg-gray-800 rounded border border-primary-200 dark:border-primary-700">- Your Discount</span>
                  <ArrowRight class="w-3 h-3" />
                  <span class="px-2 py-1 bg-white dark:bg-gray-800 rounded border border-primary-200 dark:border-primary-700">+ Your Markup</span>
                  <ArrowRight class="w-3 h-3" />
                  <span class="px-2 py-1 bg-green-100 dark:bg-green-900/30 rounded border border-green-200 dark:border-green-700 font-semibold">Customer Price</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Your discount (read-only) -->
          <div v-if="dashboard?.effectiveDiscount" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-base font-semibold text-gray-900 dark:text-white">Your Discount</h2>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Set by the platform administrator</p>
            </div>
            <div class="p-6">
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Type</p>
                  <p class="text-sm font-semibold text-gray-900 dark:text-white capitalize">{{ dashboard.effectiveDiscount.type ?? 'percentage' }}</p>
                </div>
                <div v-if="dashboard.effectiveDiscount.percentage != null || dashboard.effectiveDiscount.percent != null" class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Percentage</p>
                  <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ dashboard.effectiveDiscount.percentage ?? dashboard.effectiveDiscount.percent ?? 0 }}%</p>
                </div>
                <div v-if="dashboard.effectiveDiscount.fixed != null && dashboard.effectiveDiscount.fixed > 0" class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Fixed Amount</p>
                  <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ formatCents(dashboard.effectiveDiscount.fixed) }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Markup settings (editable) -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-base font-semibold text-gray-900 dark:text-white">Your Markup</h2>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">This is added on top of your discounted cost — it's your profit margin</p>
            </div>
            <div class="p-6">
              <form @submit.prevent="saveMarkup" class="space-y-5">
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Markup Type</label>
                    <select
                      v-model="markupType"
                      class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    >
                      <option value="percentage">Percentage</option>
                      <option value="fixed">Fixed Amount</option>
                      <option value="hybrid">Hybrid (% + Fixed)</option>
                    </select>
                  </div>

                  <div v-if="showMarkupPercent">
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Percentage</label>
                    <div class="relative">
                      <input
                        v-model.number="markupPercent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        class="w-full px-3.5 py-2.5 pr-8 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                      />
                      <span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                    </div>
                  </div>

                  <div v-if="showMarkupFixed">
                    <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Fixed Amount (cents)</label>
                    <input
                      v-model.number="markupFixed"
                      type="number"
                      min="0"
                      step="1"
                      class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    />
                  </div>
                </div>

                <div class="flex justify-end">
                  <button
                    type="submit"
                    :disabled="savingMarkup"
                    class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    <Loader2 v-if="savingMarkup" class="w-4 h-4 animate-spin" />
                    {{ savingMarkup ? 'Saving...' : 'Save Markup' }}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        <!-- ═══ Tab: Branding ═══════════════════════════════ -->
        <div v-if="activeSection === 'branding'" class="space-y-6">

          <!-- Branding form -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-base font-semibold text-gray-900 dark:text-white">Brand Identity</h2>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Customize how your signup page looks to your customers</p>
            </div>
            <div class="p-6">
              <form @submit.prevent="saveBranding" class="space-y-5">
                <!-- Two-column layout -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <!-- Left column: Form fields -->
                  <div class="space-y-4">
                    <div>
                      <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Brand Name</label>
                      <input
                        v-model="brandName"
                        type="text"
                        placeholder="Your Brand"
                        class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                      />
                    </div>

                    <div>
                      <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Logo URL</label>
                      <input
                        v-model="brandLogoUrl"
                        type="url"
                        placeholder="https://yourbrand.com/logo.png"
                        class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                      />
                    </div>

                    <div>
                      <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Primary Color</label>
                      <div class="flex items-center gap-3">
                        <input
                          v-model="brandPrimaryColor"
                          type="color"
                          class="w-10 h-10 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer p-0.5"
                        />
                        <input
                          v-model="brandPrimaryColor"
                          type="text"
                          pattern="#[0-9a-fA-F]{6}"
                          placeholder="#6366f1"
                          class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Description</label>
                      <textarea
                        v-model="brandDescription"
                        rows="3"
                        placeholder="A short description of your hosting service..."
                        class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm resize-none"
                      />
                    </div>
                  </div>

                  <!-- Right column: Live preview -->
                  <div>
                    <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Live Preview</p>
                    <div class="rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-6 text-center">
                      <div class="flex items-center justify-center gap-2 mb-2">
                        <img
                          v-if="brandLogoUrl"
                          :src="brandLogoUrl"
                          :alt="brandName"
                          class="h-8 w-auto object-contain"
                          @error="($event.target as HTMLImageElement).style.display = 'none'"
                        />
                        <h3
                          v-if="brandName"
                          class="text-lg font-bold"
                          :style="{ color: brandPrimaryColor }"
                        >
                          {{ brandName }}
                        </h3>
                        <h3 v-else class="text-lg font-bold text-gray-300 dark:text-gray-600 italic">Your Brand</h3>
                      </div>
                      <p v-if="brandDescription" class="text-xs text-gray-500 dark:text-gray-400 max-w-xs mx-auto">{{ brandDescription }}</p>
                      <p v-else class="text-xs text-gray-300 dark:text-gray-600 italic">Your description will appear here</p>
                      <div class="mt-4 inline-block px-4 py-2 rounded-lg text-white text-xs font-medium" :style="{ backgroundColor: brandPrimaryColor }">
                        Create Account
                      </div>
                    </div>
                  </div>
                </div>

                <hr class="border-gray-200 dark:border-gray-700" />

                <!-- Signup URL -->
                <div>
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">Signup Page URL</h3>
                  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                        URL Slug
                      </label>
                      <input
                        v-model="signupSlug"
                        type="text"
                        pattern="[a-zA-Z0-9\-]+"
                        placeholder="my-brand"
                        class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                      />
                      <p v-if="signupPageUrl" class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                        <span class="font-mono text-primary-600 dark:text-primary-400">{{ signupPageUrl }}</span>
                      </p>
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                        Custom Domain
                        <span class="text-gray-400 dark:text-gray-500 font-normal ml-1">(optional)</span>
                      </label>
                      <input
                        v-model="customDomain"
                        type="text"
                        placeholder="hosting.yourbrand.com"
                        class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                      />
                      <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">Point a CNAME to your platform</p>
                    </div>
                  </div>
                </div>

                <div class="flex items-center justify-between pt-2">
                  <button
                    type="submit"
                    :disabled="savingBranding"
                    class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    <Loader2 v-if="savingBranding" class="w-4 h-4 animate-spin" />
                    {{ savingBranding ? 'Saving...' : 'Save Branding' }}
                  </button>
                  <a
                    v-if="signupPageUrl"
                    :href="signupPageUrl"
                    target="_blank"
                    class="flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    <Eye class="w-4 h-4" />
                    Preview signup page
                    <ExternalLink class="w-3 h-3" />
                  </a>
                </div>
              </form>
            </div>
          </div>
        </div>

        <!-- ═══ Tab: Customers ══════════════════════════════ -->
        <div v-if="activeSection === 'customers'" class="space-y-6">

          <!-- Customer earnings breakdown -->
          <div v-if="earnings?.subAccountEarnings?.length > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h2 class="text-base font-semibold text-gray-900 dark:text-white">Customer Overview</h2>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Revenue breakdown by customer</p>
              </div>
              <span class="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-full font-medium">
                {{ earnings.totalSubAccounts }} total
              </span>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full">
                <thead>
                  <tr class="border-b border-gray-200 dark:border-gray-700">
                    <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Customer</th>
                    <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                    <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Subscription</th>
                    <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Monthly Revenue</th>
                    <th v-if="allowSubAccountReselling" class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                  <tr
                    v-for="sub in earnings.subAccountEarnings"
                    :key="sub.id"
                    class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                  >
                    <td class="px-6 py-4">
                      <span class="text-sm font-medium text-gray-900 dark:text-white">{{ sub.name }}</span>
                    </td>
                    <td class="px-6 py-4">
                      <span :class="[
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                        sub.status === 'active' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                        sub.status === 'suspended' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                        'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                      ]">
                        {{ sub.status }}
                      </span>
                    </td>
                    <td class="px-6 py-4">
                      <span :class="[
                        'inline-flex items-center gap-1 text-xs font-medium',
                        sub.hasSubscription ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'
                      ]">
                        <component :is="sub.hasSubscription ? CheckCircle : XCircle" class="w-3.5 h-3.5" />
                        {{ sub.hasSubscription ? 'Active' : 'None' }}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-right">
                      <span
                        class="text-sm font-semibold"
                        :class="sub.monthlyRevenueCents > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'"
                      >
                        {{ sub.monthlyRevenueCents > 0 ? formatCents(sub.monthlyRevenueCents) : '--' }}
                      </span>
                    </td>
                    <td v-if="allowSubAccountReselling" class="px-6 py-4 text-right">
                      <button
                        v-if="subAccounts.find((s: any) => s.id === sub.id)?.canResell"
                        @click="toggleSubAccountReselling(sub.id, false)"
                        :disabled="togglingSubAccount === sub.id"
                        class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                      >
                        <Loader2 v-if="togglingSubAccount === sub.id" class="w-3.5 h-3.5 animate-spin inline" />
                        <template v-else>Disable Reselling</template>
                      </button>
                      <button
                        v-else
                        @click="toggleSubAccountReselling(sub.id, true)"
                        :disabled="togglingSubAccount === sub.id"
                        class="text-xs font-medium text-green-600 dark:text-green-400 hover:underline disabled:opacity-50"
                      >
                        <Loader2 v-if="togglingSubAccount === sub.id" class="w-3.5 h-3.5 animate-spin inline" />
                        <template v-else>Enable Reselling</template>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Empty state for customers -->
          <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
            <div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center mx-auto mb-5">
              <Users class="w-8 h-8 text-gray-400 dark:text-gray-500" />
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">No customers yet</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-sm mx-auto">Share your signup page link with potential customers to start building your reseller business.</p>
            <button
              v-if="signupPageUrl"
              @click="copySignupUrl"
              class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
            >
              <component :is="copiedSlug ? Check : Copy" class="w-4 h-4" />
              {{ copiedSlug ? 'Copied!' : 'Copy Signup Link' }}
            </button>
            <p v-else class="text-xs text-gray-400 dark:text-gray-500">Set up your branding first to get a signup page link.</p>
          </div>
        </div>
      </template>

      <!-- Not a reseller, cannot apply, no pending application -->
      <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center max-w-lg mx-auto">
        <div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center mx-auto mb-5">
          <Store class="w-8 h-8 text-gray-400 dark:text-gray-500" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Not Eligible</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">Your account is not currently eligible to apply for the reseller program. Contact support for more information.</p>
      </div>
    </template>
  </div>
</template>
