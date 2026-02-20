<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Settings, Save, Loader2, RefreshCw, Check, X } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const { t } = useI18n()

const api = useApi()

const activeSection = ref('general')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const success = ref('')

const sections = [
  { id: 'general', label: () => t('settings.general') },
  { id: 'github', label: () => t('super.settings.githubConfig') },
  { id: 'stripe', label: () => t('super.settings.stripeConfig') },
  { id: 'email', label: () => t('super.settings.emailConfig') },
  { id: 'registrar', label: () => t('super.settings.domainRegistrar') },
  { id: 'pricing', label: () => t('super.settings.domainPricing') },
]

// General settings
const platformName = ref('')
const platformDomain = ref('')
const platformUrl = ref('')
const supportEmail = ref('')

// Stripe settings
const stripePublishableKey = ref('')
const stripeSecretKey = ref('')
const stripeWebhookSecret = ref('')

// Email settings
const emailProvider = ref<'smtp' | 'resend'>('smtp')
const smtpHost = ref('')
const smtpPort = ref(587)
const smtpUser = ref('')
const smtpPass = ref('')
const smtpFrom = ref('')
const resendApiKey = ref('')
const resendFrom = ref('')

// GitHub settings
const githubClientId = ref('')
const githubClientSecret = ref('')
const githubWebhookSecret = ref('')
const githubConfigured = ref(false)

// Registrar settings
const registrarProvider = ref('resellerclub')
const registrarResellerId = ref('')
const registrarApiKey = ref('')
const registrarApiSecret = ref('')
const registrarSandbox = ref(false)
const registrarConfigured = ref(false)
const registrarApiKeyMasked = ref('')
const testingConnection = ref(false)
const testResult = ref<{ success: boolean; message: string } | null>(null)

// Domain pricing
const pricingEntries = ref<any[]>([])
const pricingLoading = ref(false)
const syncing = ref(false)

async function fetchSettings() {
  loading.value = true
  try {
    const data = await api.get<Record<string, any>>('/settings')
    platformName.value = data['platform:name'] as string ?? ''
    // platform:domain may be stored JSON-stringified by setup wizard
    const rawDomain = data['platform:domain']
    platformDomain.value = typeof rawDomain === 'string'
      ? (rawDomain.startsWith('"') ? JSON.parse(rawDomain) : rawDomain)
      : ''
    platformUrl.value = data['platform:url'] as string ?? ''
    supportEmail.value = data['platform:supportEmail'] as string ?? ''
    emailProvider.value = (data['email:provider'] as string ?? 'smtp') as 'smtp' | 'resend'
    smtpHost.value = data['email:smtpHost'] as string ?? ''
    smtpPort.value = (data['email:smtpPort'] as number) ?? 587
    smtpUser.value = data['email:smtpUser'] as string ?? ''
    smtpFrom.value = data['email:smtpFrom'] as string ?? ''
    resendFrom.value = data['email:resendFrom'] as string ?? ''
  } catch {
    // Settings may not exist yet
  } finally {
    loading.value = false
  }
}

async function fetchGitHub() {
  try {
    const data = await api.get<any>('/settings/github')
    githubConfigured.value = data.configured ?? false
    githubClientId.value = data.clientId ?? ''
  } catch {
    // Not configured
  }
}

async function fetchRegistrar() {
  try {
    const data = await api.get<any>('/settings/registrar')
    registrarConfigured.value = data.configured ?? false
    if (data.configured) {
      registrarProvider.value = data.provider ?? 'resellerclub'
      registrarApiKeyMasked.value = data.apiKeyMasked ?? ''
      const config = data.config as Record<string, string> | null
      registrarResellerId.value = config?.resellerId ?? ''
      registrarSandbox.value = config?.sandbox === 'true'
    }
  } catch {
    // Not configured
  }
}

async function fetchPricing() {
  pricingLoading.value = true
  try {
    pricingEntries.value = await api.get<any[]>('/domain-pricing')
  } catch {
    pricingEntries.value = []
  } finally {
    pricingLoading.value = false
  }
}

async function saveGeneral() {
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await api.patch('/settings', {
      'platform:name': platformName.value,
      'platform:domain': platformDomain.value,
      'platform:url': platformUrl.value,
      'platform:supportEmail': supportEmail.value,
    })
    success.value = 'General settings saved'
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save settings'
  } finally {
    saving.value = false
  }
}

async function saveGitHub() {
  if (!githubClientId.value || !githubClientSecret.value) {
    error.value = 'Client ID and Client Secret are required'
    return
  }
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await api.patch('/settings/github', {
      clientId: githubClientId.value,
      clientSecret: githubClientSecret.value,
      webhookSecret: githubWebhookSecret.value || undefined,
    })
    success.value = 'GitHub configuration saved'
    githubClientSecret.value = ''
    githubWebhookSecret.value = ''
    await fetchGitHub()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save GitHub configuration'
  } finally {
    saving.value = false
  }
}

async function saveStripe() {
  if (!stripePublishableKey.value || !stripeSecretKey.value) {
    error.value = 'Publishable key and secret key are required'
    return
  }
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await api.patch('/settings/stripe', {
      publishableKey: stripePublishableKey.value,
      secretKey: stripeSecretKey.value,
      webhookSecret: stripeWebhookSecret.value || undefined,
    })
    success.value = 'Stripe configuration saved'
    stripePublishableKey.value = ''
    stripeSecretKey.value = ''
    stripeWebhookSecret.value = ''
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save Stripe configuration'
  } finally {
    saving.value = false
  }
}

async function saveEmail() {
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await api.patch('/settings/email', {
      provider: emailProvider.value,
      smtpHost: smtpHost.value || undefined,
      smtpPort: smtpPort.value || undefined,
      smtpUser: smtpUser.value || undefined,
      smtpPass: smtpPass.value || undefined,
      smtpFrom: smtpFrom.value || undefined,
      resendApiKey: resendApiKey.value || undefined,
      resendFrom: resendFrom.value || undefined,
    })
    success.value = 'Email configuration saved'
    smtpPass.value = ''
    resendApiKey.value = ''
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save email configuration'
  } finally {
    saving.value = false
  }
}

async function saveRegistrar() {
  if (!registrarApiKey.value) {
    error.value = 'API key is required'
    return
  }
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await api.patch('/settings/registrar', {
      provider: registrarProvider.value,
      apiKey: registrarApiKey.value,
      apiSecret: registrarApiSecret.value || undefined,
      resellerId: registrarResellerId.value || undefined,
      sandbox: registrarSandbox.value || undefined,
    })
    success.value = 'Domain registrar saved'
    registrarApiKey.value = ''
    registrarApiSecret.value = ''
    await fetchRegistrar()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save registrar configuration'
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testingConnection.value = true
  testResult.value = null
  try {
    const result = await api.post<any>('/settings/registrar/test', {})
    testResult.value = { success: result.success, message: result.success ? `Connected to ${result.provider}` : result.error ?? 'Test failed' }
  } catch (err: any) {
    testResult.value = { success: false, message: err?.body?.error || 'Connection test failed' }
  } finally {
    testingConnection.value = false
  }
}

async function syncPrices() {
  syncing.value = true
  error.value = ''
  success.value = ''
  try {
    const result = await api.post<any>('/domain-pricing/sync', {})
    success.value = result.message
    await fetchPricing()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to sync prices'
  } finally {
    syncing.value = false
  }
}

async function updatePricingEntry(entry: any) {
  try {
    await api.patch(`/domain-pricing/${entry.id}`, {
      markupType: entry.markupType,
      markupValue: entry.markupValue,
      enabled: entry.enabled,
    })
    await fetchPricing()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to update pricing'
  }
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

onMounted(() => {
  fetchSettings()
  fetchGitHub()
  fetchRegistrar()
  fetchPricing()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Settings class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('super.settings.title') }}</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else class="flex flex-col lg:flex-row gap-6">
      <!-- Sidebar navigation -->
      <div class="lg:w-56 shrink-0">
        <nav class="space-y-1">
          <button
            v-for="section in sections"
            :key="section.id"
            @click="activeSection = section.id; error = ''; success = ''"
            :class="[
              'w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
              activeSection === section.id
                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
            ]"
          >
            {{ section.label() }}
          </button>
        </nav>
      </div>

      <!-- Content area -->
      <div class="flex-1 min-w-0">
        <div v-if="error" class="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
        </div>
        <div v-if="success" class="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
        </div>

        <!-- General -->
        <div v-if="activeSection === 'general'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.generalSettings') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('super.settings.generalSettingsDesc') }}</p>
          </div>
          <form @submit.prevent="saveGeneral" class="p-6 space-y-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.platformName') }}</label>
              <input v-model="platformName" type="text" placeholder="Fleet" class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.rootDomain') }}</label>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{{ $t('super.settings.rootDomainDesc') }}</p>
              <input v-model="platformDomain" type="text" placeholder="fleet.example.com" class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.platformUrl') }}</label>
              <input v-model="platformUrl" type="url" placeholder="https://your-platform.com" class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('common.email') }}</label>
              <input v-model="supportEmail" type="email" placeholder="support@your-platform.com" class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            </div>
            <div class="pt-2 flex justify-end">
              <button type="submit" :disabled="saving" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
                <Save v-else class="w-4 h-4" />
                {{ saving ? $t('common.saving') : $t('common.save') }}
              </button>
            </div>
          </form>
        </div>

        <!-- GitHub Configuration -->
        <div v-if="activeSection === 'github'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.githubConfig') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('super.settings.githubConfigDesc') }}</p>
          </div>
          <form @submit.prevent="saveGitHub" class="p-6 space-y-5">
            <div v-if="githubConfigured" class="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p class="text-sm text-green-700 dark:text-green-300">GitHub configured (Client ID: <strong class="font-mono">{{ githubClientId }}</strong>)</p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.githubClientId') }}</label>
              <input v-model="githubClientId" type="text" placeholder="Ov23li..." required class="w-full max-w-lg px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.githubClientSecret') }}</label>
              <input v-model="githubClientSecret" type="password" placeholder="Enter client secret" required class="w-full max-w-lg px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.githubWebhookSecret') }} ({{ $t('common.optional') }})</label>
              <input v-model="githubWebhookSecret" type="password" placeholder="Enter webhook secret" class="w-full max-w-lg px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('super.settings.githubOAuthHint') }}</p>
            <div class="pt-2 flex justify-end">
              <button type="submit" :disabled="saving" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
                <Save v-else class="w-4 h-4" />
                {{ saving ? $t('common.saving') : $t('common.save') }}
              </button>
            </div>
          </form>
        </div>

        <!-- Stripe Configuration -->
        <div v-if="activeSection === 'stripe'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.stripeConfig') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('super.settings.stripeConfigDesc') }}</p>
          </div>
          <form @submit.prevent="saveStripe" class="p-6 space-y-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.stripePublishableKey') }}</label>
              <input v-model="stripePublishableKey" type="text" placeholder="pk_live_..." required class="w-full max-w-lg px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.stripeSecretKey') }}</label>
              <input v-model="stripeSecretKey" type="password" placeholder="sk_live_..." required class="w-full max-w-lg px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.stripeWebhookSecret') }} ({{ $t('common.optional') }})</label>
              <input v-model="stripeWebhookSecret" type="password" placeholder="whsec_..." class="w-full max-w-lg px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
            </div>
            <div class="pt-2 flex justify-end">
              <button type="submit" :disabled="saving" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
                <Save v-else class="w-4 h-4" />
                {{ saving ? $t('common.saving') : $t('common.save') }}
              </button>
            </div>
          </form>
        </div>

        <!-- Email Configuration -->
        <div v-if="activeSection === 'email'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.emailConfig') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('super.settings.emailConfigDesc') }}</p>
          </div>
          <form @submit.prevent="saveEmail" class="p-6 space-y-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Provider</label>
              <select v-model="emailProvider" class="w-full max-w-xs px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm">
                <option value="smtp">SMTP</option>
                <option value="resend">Resend</option>
              </select>
            </div>

            <template v-if="emailProvider === 'smtp'">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.smtpHost') }}</label>
                  <input v-model="smtpHost" type="text" placeholder="smtp.example.com" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.smtpPort') }}</label>
                  <input v-model.number="smtpPort" type="number" placeholder="587" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.smtpUser') }}</label>
                <input v-model="smtpUser" type="text" placeholder="your-username" class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.smtpPass') }}</label>
                <input v-model="smtpPass" type="password" placeholder="Enter new password to update" class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.emailFrom') }}</label>
                <input v-model="smtpFrom" type="email" placeholder="noreply@your-platform.com" class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
              </div>
            </template>

            <template v-if="emailProvider === 'resend'">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Resend API Key</label>
                <input v-model="resendApiKey" type="password" placeholder="re_..." class="w-full max-w-lg px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.emailFrom') }}</label>
                <input v-model="resendFrom" type="email" placeholder="noreply@your-platform.com" class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
              </div>
            </template>

            <div class="pt-2 flex justify-end">
              <button type="submit" :disabled="saving" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
                <Save v-else class="w-4 h-4" />
                {{ saving ? $t('common.saving') : $t('common.save') }}
              </button>
            </div>
          </form>
        </div>

        <!-- Domain Registrar -->
        <div v-if="activeSection === 'registrar'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.domainRegistrar') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('super.settings.domainRegistrarDesc') }}</p>
          </div>
          <form @submit.prevent="saveRegistrar" class="p-6 space-y-5">
            <div v-if="registrarConfigured" class="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p class="text-sm text-green-700 dark:text-green-300">Registrar configured: <strong>{{ registrarProvider }}</strong> ({{ registrarApiKeyMasked }})</p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Provider</label>
              <select v-model="registrarProvider" class="w-full max-w-xs px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm">
                <option value="resellerclub">ResellerClub</option>
                <option value="namecom">Name.com</option>
              </select>
            </div>

            <!-- ResellerClub fields -->
            <div v-if="registrarProvider === 'resellerclub'">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Reseller ID</label>
              <input v-model="registrarResellerId" type="text" placeholder="Your ResellerClub Reseller ID" class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            </div>

            <div v-if="registrarProvider === 'resellerclub'">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">API Key</label>
              <input v-model="registrarApiKey" type="password" placeholder="Enter API key" class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
            </div>

            <!-- Name.com fields -->
            <div v-if="registrarProvider === 'namecom'">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Username</label>
              <input v-model="registrarApiKey" type="text" placeholder="Your Name.com username" class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            </div>

            <div v-if="registrarProvider === 'namecom'">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">API Token</label>
              <input v-model="registrarApiSecret" type="password" placeholder="Enter API token" class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
            </div>

            <!-- Sandbox toggle (shared) -->
            <div class="flex items-center gap-3">
              <input id="registrar-sandbox" v-model="registrarSandbox" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
              <label for="registrar-sandbox" class="text-sm text-gray-700 dark:text-gray-300">Sandbox mode (use test API)</label>
            </div>

            <div class="flex items-center gap-3">
              <button
                type="button"
                @click="testConnection"
                :disabled="testingConnection"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                <Loader2 v-if="testingConnection" class="w-4 h-4 animate-spin" />
                <RefreshCw v-else class="w-4 h-4" />
                {{ $t('super.settings.testConnection') }}
              </button>
              <div v-if="testResult" class="flex items-center gap-1.5 text-sm">
                <Check v-if="testResult.success" class="w-4 h-4 text-green-600" />
                <X v-else class="w-4 h-4 text-red-600" />
                <span :class="testResult.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'">
                  {{ testResult.message }}
                </span>
              </div>
            </div>

            <div class="pt-2 flex justify-end">
              <button type="submit" :disabled="saving" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
                <Save v-else class="w-4 h-4" />
                {{ saving ? $t('common.saving') : $t('common.save') }}
              </button>
            </div>
          </form>
        </div>

        <!-- Domain Pricing -->
        <div v-if="activeSection === 'pricing'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.domainPricing') }}</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('super.settings.domainPricingDesc') }}</p>
            </div>
            <button
              @click="syncPrices"
              :disabled="syncing"
              class="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              <Loader2 v-if="syncing" class="w-3.5 h-3.5 animate-spin" />
              <RefreshCw v-else class="w-3.5 h-3.5" />
              {{ $t('super.settings.syncFromProvider') }}
            </button>
          </div>

          <div v-if="pricingLoading" class="p-8 flex items-center justify-center">
            <Loader2 class="w-6 h-6 text-primary-600 dark:text-primary-400 animate-spin" />
          </div>

          <div v-else-if="pricingEntries.length === 0" class="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
            {{ $t('super.settings.noTldPricing') }}
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700">
                  <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ $t('super.settings.tld') }}</th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ $t('super.settings.registerPrice') }}</th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Markup</th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ $t('super.settings.renewPrice') }}</th>
                  <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ $t('common.enabled') }}</th>
                  <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ $t('common.actions') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr v-for="entry in pricingEntries" :key="entry.id" class="hover:bg-gray-50 dark:hover:bg-gray-750">
                  <td class="px-4 py-3 text-sm font-mono font-medium text-gray-900 dark:text-white">.{{ entry.tld }}</td>
                  <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    ${{ formatCents(entry.providerRegistrationPrice) }} / ${{ formatCents(entry.providerRenewalPrice) }}
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                      <select
                        v-model="entry.markupType"
                        class="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs"
                      >
                        <option value="percentage">%</option>
                        <option value="fixed_amount">+ $</option>
                        <option value="fixed_price">= $</option>
                      </select>
                      <input
                        v-model.number="entry.markupValue"
                        type="number"
                        min="0"
                        class="w-20 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs"
                      />
                    </div>
                  </td>
                  <td class="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                    ${{ formatCents(entry.sellRegistrationPrice) }} / ${{ formatCents(entry.sellRenewalPrice) }}
                  </td>
                  <td class="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      v-model="entry.enabled"
                      class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                    />
                  </td>
                  <td class="px-4 py-3 text-right">
                    <button
                      @click="updatePricingEntry(entry)"
                      class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      {{ $t('common.save') }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
