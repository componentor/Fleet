<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
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
} from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
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
    // Status endpoint may 404 if reseller module not available
    config.value = { enabled: false }
  }
}

async function fetchDashboard() {
  try {
    const data = await api.get<any>('/reseller/dashboard')
    dashboard.value = data

    // Populate markup form from current values
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

async function loadAll() {
  loading.value = true
  try {
    await fetchStatus()
    if (isReseller.value) {
      await Promise.all([fetchDashboard(), fetchConnectStatus()])
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
  return `$${(cents / 100).toFixed(2)}`
}

// ---------- Lifecycle ----------
onMounted(() => {
  loadAll()
})
</script>

<template>
  <div>
    <!-- Page Header -->
    <div class="flex items-center gap-3 mb-8">
      <Store class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('reseller.title', 'Reseller') }}</h1>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <template v-else>
      <!-- State 1: Program Not Enabled -->
      <div v-if="!programEnabled" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
        <Store class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">{{ t('reseller.programNotEnabled', 'Reseller Program Not Available') }}</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('reseller.programNotEnabledDesc', 'The reseller program is not currently enabled. Contact your platform administrator for more information.') }}</p>
      </div>

      <!-- State 2: Not a Reseller, Can Apply -->
      <div v-else-if="!isReseller && canApply && !pendingApplication" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <Send class="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('reseller.applyTitle', 'Apply to Become a Reseller') }}</h2>
        </div>
        <div class="p-6">
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">
            {{ t('reseller.applyDescription', 'As a reseller, you can create sub-accounts, set your own pricing with markup, customize your branding, and earn revenue by reselling our platform services under your own brand.') }}
          </p>
          <form @submit.prevent="applyToBeReseller" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {{ t('reseller.applicationMessage', 'Message (optional)') }}
              </label>
              <textarea
                v-model="applicationMessage"
                rows="3"
                :placeholder="t('reseller.applicationMessagePlaceholder', 'Tell us about your business and how you plan to use the reseller program...')"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm resize-none"
              />
            </div>
            <button
              type="submit"
              :disabled="applying"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Loader2 v-if="applying" class="w-4 h-4 animate-spin" />
              <Send v-else class="w-4 h-4" />
              {{ applying ? t('reseller.submitting', 'Submitting...') : t('reseller.submitApplication', 'Submit Application') }}
            </button>
          </form>
        </div>
      </div>

      <!-- State 3: Application Pending -->
      <div v-else-if="!isReseller && pendingApplication" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
        <Clock class="w-12 h-12 text-yellow-500 dark:text-yellow-400 mx-auto mb-4" />
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">{{ t('reseller.pendingTitle', 'Application Pending') }}</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('reseller.pendingDesc', 'Your application to become a reseller is pending review. You will be notified once it has been approved.') }}</p>
      </div>

      <!-- State 4: Active Reseller Dashboard -->
      <template v-else-if="isReseller">
        <!-- Stripe Connect Status -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <CreditCard class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('reseller.stripeConnect', 'Stripe Connect') }}</h2>
          </div>
          <div class="p-6">
            <!-- Not connected -->
            <div v-if="!stripeConnect?.connected">
              <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {{ t('reseller.stripeConnectDesc', 'Connect your Stripe account to receive payouts from your sub-accounts. This is required to start earning revenue as a reseller.') }}
              </p>
              <button
                @click="connectStripe"
                :disabled="connectingStripe"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="connectingStripe" class="w-4 h-4 animate-spin" />
                <ExternalLink v-else class="w-4 h-4" />
                {{ connectingStripe ? t('reseller.connecting', 'Connecting...') : t('reseller.connectStripeAccount', 'Connect Stripe Account') }}
              </button>
            </div>

            <!-- Connected -->
            <div v-else>
              <div class="flex items-center gap-3 mb-4">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                  <CheckCircle class="w-3.5 h-3.5" />
                  {{ t('reseller.stripeConnected', 'Stripe Account Connected') }}
                </span>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div class="p-3 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{{ t('reseller.onboarded', 'Onboarded') }}</p>
                  <div class="flex items-center gap-1.5">
                    <component :is="stripeConnect.onboarded ? CheckCircle : XCircle" :class="stripeConnect.onboarded ? 'w-4 h-4 text-green-500' : 'w-4 h-4 text-red-500'" />
                    <span class="text-sm font-medium text-gray-900 dark:text-white">{{ stripeConnect.onboarded ? t('common.yes', 'Yes') : t('common.no', 'No') }}</span>
                  </div>
                </div>
                <div class="p-3 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{{ t('reseller.chargesEnabled', 'Charges Enabled') }}</p>
                  <div class="flex items-center gap-1.5">
                    <component :is="stripeConnect.chargesEnabled ? CheckCircle : XCircle" :class="stripeConnect.chargesEnabled ? 'w-4 h-4 text-green-500' : 'w-4 h-4 text-red-500'" />
                    <span class="text-sm font-medium text-gray-900 dark:text-white">{{ stripeConnect.chargesEnabled ? t('common.yes', 'Yes') : t('common.no', 'No') }}</span>
                  </div>
                </div>
                <div class="p-3 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{{ t('reseller.payoutsEnabled', 'Payouts Enabled') }}</p>
                  <div class="flex items-center gap-1.5">
                    <component :is="stripeConnect.payoutsEnabled ? CheckCircle : XCircle" :class="stripeConnect.payoutsEnabled ? 'w-4 h-4 text-green-500' : 'w-4 h-4 text-red-500'" />
                    <span class="text-sm font-medium text-gray-900 dark:text-white">{{ stripeConnect.payoutsEnabled ? t('common.yes', 'Yes') : t('common.no', 'No') }}</span>
                  </div>
                </div>
              </div>
              <!-- Re-open onboarding if not fully onboarded -->
              <div v-if="!stripeConnect.onboarded" class="mt-4">
                <button
                  @click="connectStripe"
                  :disabled="connectingStripe"
                  class="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <Loader2 v-if="connectingStripe" class="w-4 h-4 animate-spin" />
                  <ExternalLink v-else class="w-4 h-4" />
                  {{ t('reseller.continueOnboarding', 'Continue Onboarding') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Your Discount Rate (read-only) -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Percent class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('reseller.yourDiscount', 'Your Discount Rate') }}</h2>
          </div>
          <div class="p-6">
            <div v-if="dashboard?.effectiveDiscount" class="space-y-4">
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{{ t('reseller.discountType', 'Discount Type') }}</p>
                  <p class="text-sm font-semibold text-gray-900 dark:text-white capitalize">{{ dashboard.effectiveDiscount.type ?? 'percentage' }}</p>
                </div>
                <div v-if="dashboard.effectiveDiscount.percentage != null" class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{{ t('reseller.discountPercent', 'Percentage') }}</p>
                  <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ dashboard.effectiveDiscount.percentage }}%</p>
                </div>
                <div v-if="dashboard.effectiveDiscount.fixed != null" class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
                  <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{{ t('reseller.discountFixed', 'Fixed Amount') }}</p>
                  <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ formatCents(dashboard.effectiveDiscount.fixed) }}</p>
                </div>
              </div>
              <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <Info class="w-4 h-4 text-blue-500 dark:text-blue-400 shrink-0" />
                <p class="text-xs text-blue-700 dark:text-blue-300">{{ t('reseller.discountNote', 'Set by platform administrator. Contact support to request changes.') }}</p>
              </div>
            </div>
            <div v-else class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('reseller.noDiscount', 'No discount rate has been configured for your account.') }}
            </div>
          </div>
        </div>

        <!-- Markup Settings (editable) -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <DollarSign class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('reseller.markupSettings', 'Your Markup Settings') }}</h2>
          </div>
          <div class="p-6">
            <form @submit.prevent="saveMarkup" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {{ t('reseller.markupType', 'Markup Type') }}
                </label>
                <select
                  v-model="markupType"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                >
                  <option value="percentage">{{ t('reseller.markupPercentage', 'Percentage') }}</option>
                  <option value="fixed">{{ t('reseller.markupFixedType', 'Fixed') }}</option>
                  <option value="hybrid">{{ t('reseller.markupHybrid', 'Hybrid (Percentage + Fixed)') }}</option>
                </select>
              </div>

              <div v-if="showMarkupPercent">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {{ t('reseller.markupPercentLabel', 'Markup Percent') }}
                </label>
                <input
                  v-model.number="markupPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">{{ t('reseller.markupPercentHint', 'Percentage added on top of your discounted cost (0-100)') }}</p>
              </div>

              <div v-if="showMarkupFixed">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {{ t('reseller.markupFixedLabel', 'Fixed Markup (cents)') }}
                </label>
                <input
                  v-model.number="markupFixed"
                  type="number"
                  min="0"
                  step="1"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">{{ t('reseller.markupFixedHint', 'Fixed amount in cents added on top of your discounted cost') }}</p>
              </div>

              <button
                type="submit"
                :disabled="savingMarkup"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="savingMarkup" class="w-4 h-4 animate-spin" />
                {{ savingMarkup ? t('common.saving', 'Saving...') : t('common.save', 'Save') }}
              </button>
            </form>
          </div>
        </div>

        <!-- Branding & Signup Page -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Palette class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('reseller.brandingTitle', 'Branding & Signup Page') }}</h2>
          </div>
          <div class="p-6">
            <form @submit.prevent="saveBranding" class="space-y-4">
              <!-- Signup Slug -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {{ t('reseller.signupSlug', 'Signup URL Slug') }}
                </label>
                <input
                  v-model="signupSlug"
                  type="text"
                  pattern="[a-zA-Z0-9\-]+"
                  :placeholder="t('reseller.signupSlugPlaceholder', 'my-brand')"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                />
                <p v-if="signupPageUrl" class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  {{ t('reseller.signupPreview', 'Preview') }}: <span class="font-mono text-primary-600 dark:text-primary-400">{{ signupPageUrl }}</span>
                </p>
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">{{ t('reseller.signupSlugHint', 'Alphanumeric characters and hyphens only') }}</p>
              </div>

              <!-- Custom Domain -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {{ t('reseller.customDomain', 'Custom Domain') }}
                  <span class="text-gray-400 dark:text-gray-500 font-normal ml-1">({{ t('common.optional', 'optional') }})</span>
                </label>
                <input
                  v-model="customDomain"
                  type="text"
                  :placeholder="t('reseller.customDomainPlaceholder', 'hosting.yourbrand.com')"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                />
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">{{ t('reseller.customDomainHint', 'Point a CNAME record for this domain to your platform instance') }}</p>
              </div>

              <!-- Brand Name -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {{ t('reseller.brandName', 'Brand Name') }}
                </label>
                <input
                  v-model="brandName"
                  type="text"
                  :placeholder="t('reseller.brandNamePlaceholder', 'Your Brand')"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>

              <!-- Logo URL -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {{ t('reseller.logoUrl', 'Logo URL') }}
                </label>
                <input
                  v-model="brandLogoUrl"
                  type="url"
                  :placeholder="t('reseller.logoUrlPlaceholder', 'https://yourbrand.com/logo.png')"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                />
              </div>

              <!-- Primary Color -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {{ t('reseller.primaryColor', 'Primary Color') }}
                </label>
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

              <!-- Description -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {{ t('reseller.brandDescription', 'Description') }}
                </label>
                <textarea
                  v-model="brandDescription"
                  rows="3"
                  :placeholder="t('reseller.brandDescriptionPlaceholder', 'A short description of your hosting service...')"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm resize-none"
                />
              </div>

              <div class="flex items-center justify-between pt-2">
                <button
                  type="submit"
                  :disabled="savingBranding"
                  class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  <Loader2 v-if="savingBranding" class="w-4 h-4 animate-spin" />
                  {{ savingBranding ? t('common.saving', 'Saving...') : t('common.save', 'Save') }}
                </button>
                <a
                  v-if="signupPageUrl"
                  :href="signupPageUrl"
                  target="_blank"
                  class="flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
                >
                  <Link class="w-4 h-4" />
                  {{ t('reseller.visitSignupPage', 'Visit your signup page') }}
                  <ExternalLink class="w-3 h-3" />
                </a>
              </div>
            </form>
          </div>
        </div>

        <!-- Sub-Accounts -->
        <div v-if="subAccounts.length > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Users class="w-5 h-5 text-gray-500 dark:text-gray-400" />
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('reseller.subAccounts', 'Sub-Accounts') }}</h2>
            </div>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {{ dashboard?.subAccountCount ?? subAccounts.length }} {{ t('reseller.total', 'total') }}
            </span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700">
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('common.name', 'Name') }}</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('common.status', 'Status') }}</th>
                  <th v-if="allowSubAccountReselling" class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('reseller.resellingEnabled', 'Reselling') }}</th>
                  <th v-if="allowSubAccountReselling" class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('common.actions', 'Actions') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr
                  v-for="sub in subAccounts"
                  :key="sub.id"
                  class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                >
                  <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ sub.name ?? sub.email ?? sub.id }}</td>
                  <td class="px-6 py-4">
                    <span :class="[
                      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                      sub.status === 'active' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                      sub.status === 'suspended' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                      'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                    ]">
                      {{ sub.status ?? 'active' }}
                    </span>
                  </td>
                  <td v-if="allowSubAccountReselling" class="px-6 py-4">
                    <span :class="[
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                      sub.canResell ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                    ]">
                      <component :is="sub.canResell ? CheckCircle : XCircle" class="w-3 h-3" />
                      {{ sub.canResell ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled') }}
                    </span>
                  </td>
                  <td v-if="allowSubAccountReselling" class="px-6 py-4 text-right">
                    <button
                      v-if="sub.canResell"
                      @click="toggleSubAccountReselling(sub.id, false)"
                      :disabled="togglingSubAccount === sub.id"
                      class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                    >
                      <Loader2 v-if="togglingSubAccount === sub.id" class="w-3.5 h-3.5 animate-spin inline" />
                      <template v-else>{{ t('common.disable', 'Disable') }}</template>
                    </button>
                    <button
                      v-else
                      @click="toggleSubAccountReselling(sub.id, true)"
                      :disabled="togglingSubAccount === sub.id"
                      class="text-xs font-medium text-green-600 dark:text-green-400 hover:underline disabled:opacity-50"
                    >
                      <Loader2 v-if="togglingSubAccount === sub.id" class="w-3.5 h-3.5 animate-spin inline" />
                      <template v-else>{{ t('common.enable', 'Enable') }}</template>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <!-- Not a reseller, cannot apply, no pending application -->
      <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
        <Store class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">{{ t('reseller.notEligible', 'Not Eligible') }}</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('reseller.notEligibleDesc', 'Your account is not currently eligible to apply for the reseller program. Contact support for more information.') }}</p>
      </div>
    </template>
  </div>
</template>
