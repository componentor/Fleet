<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Settings, Save, Loader2, RefreshCw, Check, X, Upload, Trash2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useBranding } from '@/composables/useBranding'

const { t } = useI18n()

const api = useApi()
const branding = useBranding()

const activeSection = ref('general')
const loading = ref(true)
const savingField = ref<string | null>(null)
const error = ref('')
const success = ref('')

const sections = [
  { id: 'general', label: () => t('settings.general') },
  { id: 'github', label: () => t('super.settings.githubConfig') },
  { id: 'google', label: () => t('super.settings.googleConfig') },
  { id: 'stripe', label: () => t('super.settings.stripeConfig') },
  { id: 'email', label: () => t('super.settings.emailConfig') },
  { id: 'registrar', label: () => t('super.settings.domainRegistrar') },
  { id: 'pricing', label: () => t('super.settings.domainPricing') },
  { id: 'branding', label: () => t('super.settings.branding') },
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
const stripeConfigured = ref(false)
const stripeSecretKeyHint = ref('')
const stripeWebhookSecretHint = ref('')

// Email settings
const emailProvider = ref<'smtp' | 'resend'>('smtp')
const smtpHost = ref('')
const smtpPort = ref(587)
const smtpUser = ref('')
const smtpPass = ref('')
const smtpFrom = ref('')
const resendApiKey = ref('')
const resendFrom = ref('')
const smtpPassHint = ref('')
const resendApiKeyHint = ref('')

// GitHub settings
const githubClientId = ref('')
const githubClientSecret = ref('')
const githubWebhookSecret = ref('')
const githubConfigured = ref(false)
const githubClientSecretHint = ref('')
const githubWebhookSecretHint = ref('')

// Google settings
const googleClientId = ref('')
const googleClientSecret = ref('')
const googleConfigured = ref(false)
const googleClientSecretHint = ref('')

// Registrar settings
const registrarProvider = ref('resellerclub')
const registrarResellerId = ref('')
const registrarApiKey = ref('')
const registrarApiSecret = ref('')
const registrarSandbox = ref(false)
const registrarConfigured = ref(false)
const registrarApiKeyHint = ref('')
const registrarApiSecretHint = ref('')
const testingConnection = ref(false)
const testResult = ref<{ success: boolean; message: string } | null>(null)

// Domain pricing
const pricingEntries = ref<any[]>([])
const pricingLoading = ref(false)
const syncing = ref(false)

// Branding
const brandTitleInput = ref('')
const brandLogoPreview = ref<string | null>(null)
const brandFaviconPreview = ref<string | null>(null)
const brandLogoSet = ref(false)
const brandFaviconSet = ref(false)
const brandLogoFile = ref<File | null>(null)
const brandFaviconFile = ref<File | null>(null)
const savingBranding = ref(false)

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
    // Masked hints for email secrets (from generic GET /settings)
    const smtpPassVal = data['email:smtpPass'] as string ?? ''
    smtpPassHint.value = smtpPassVal && smtpPassVal !== '' ? smtpPassVal : ''
    const resendKeyVal = data['email:resendApiKey'] as string ?? ''
    resendApiKeyHint.value = resendKeyVal && resendKeyVal !== '' ? resendKeyVal : ''
  } catch {
    // Settings may not exist yet
  } finally {
    loading.value = false
  }
}

async function fetchStripe() {
  try {
    const data = await api.get<any>('/settings/stripe')
    stripeConfigured.value = data.configured ?? false
    if (data.configured) {
      stripePublishableKey.value = data.publishableKey ?? ''
      stripeSecretKeyHint.value = data.secretKeyHint ?? ''
      stripeWebhookSecretHint.value = data.webhookSecretHint ?? ''
    }
  } catch {
    // Not configured
  }
}

async function fetchGitHub() {
  try {
    const data = await api.get<any>('/settings/github')
    githubConfigured.value = data.configured ?? false
    githubClientId.value = data.clientId ?? ''
    githubClientSecretHint.value = data.clientSecretHint ?? ''
    githubWebhookSecretHint.value = data.webhookSecretHint ?? ''
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
      registrarApiKeyHint.value = data.apiKeyHint ?? ''
      registrarApiSecretHint.value = data.apiSecretHint ?? ''
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


async function fetchGoogle() {
  try {
    const data = await api.get<any>('/settings/google')
    googleConfigured.value = data.configured ?? false
    googleClientId.value = data.clientId ?? ''
    googleClientSecretHint.value = data.clientSecretHint ?? ''
  } catch {
    // Not configured
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

async function fetchBranding() {
  try {
    const data = await api.get<any>('/settings/branding')
    brandTitleInput.value = data.title ?? ''
    brandLogoSet.value = data.logoSet ?? false
    brandFaviconSet.value = data.faviconSet ?? false
    brandLogoPreview.value = data.logoUrl ?? null
    brandFaviconPreview.value = data.faviconUrl ?? null
  } catch {
    // Not configured
  }
}

function onLogoFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  brandLogoFile.value = file
  brandLogoPreview.value = URL.createObjectURL(file)
}

function onFaviconFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  brandFaviconFile.value = file
  brandFaviconPreview.value = URL.createObjectURL(file)
}

async function saveBranding() {
  savingBranding.value = true
  error.value = ''
  success.value = ''
  try {
    const formData = new FormData()
    formData.append('title', brandTitleInput.value)
    if (brandLogoFile.value) formData.append('logo', brandLogoFile.value)
    if (brandFaviconFile.value) formData.append('favicon', brandFaviconFile.value)
    await api.upload('/settings/branding', formData)
    brandLogoFile.value = null
    brandFaviconFile.value = null
    success.value = t('super.settings.brandingSaved')
    await branding.refresh()
    await fetchBranding()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save branding'
  } finally {
    savingBranding.value = false
  }
}

async function removeBrandingAsset(type: 'logo' | 'favicon') {
  try {
    await api.del(`/settings/branding/${type}`)
    if (type === 'logo') {
      brandLogoPreview.value = null
      brandLogoSet.value = false
      brandLogoFile.value = null
    } else {
      brandFaviconPreview.value = null
      brandFaviconSet.value = false
      brandFaviconFile.value = null
    }
    success.value = `${type === 'logo' ? 'Logo' : 'Favicon'} removed`
    await branding.refresh()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || `Failed to remove ${type}`
  }
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

async function saveOneField(fieldKey: string, apiCall: () => Promise<void>, afterSave?: () => Promise<void>) {
  savingField.value = fieldKey
  error.value = ''
  success.value = ''
  try {
    await apiCall()
    success.value = 'Saved'
    if (afterSave) await afterSave()
    setTimeout(() => { success.value = '' }, 2000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save'
  } finally {
    savingField.value = null
  }
}

function saveGeneralField(key: string, value: string) {
  saveOneField(`general:${key}`, () => api.patch('/settings', { [key]: value }))
}

function saveGitHubField(key: string, value: string) {
  if (!value) return
  saveOneField(`github:${key}`, () => api.patch('/settings/github', { [key]: value }), async () => {
    if (key === 'clientSecret') githubClientSecret.value = ''
    if (key === 'webhookSecret') githubWebhookSecret.value = ''
    await fetchGitHub()
  })
}

function saveGoogleField(key: string, value: string) {
  if (!value) return
  saveOneField(`google:${key}`, () => api.patch('/settings/google', { [key]: value }), async () => {
    if (key === 'clientSecret') googleClientSecret.value = ''
    await fetchGoogle()
  })
}

function saveStripeField(key: string, value: string) {
  if (!value) return
  saveOneField(`stripe:${key}`, () => api.patch('/settings/stripe', { [key]: value }), async () => {
    if (key === 'secretKey') stripeSecretKey.value = ''
    if (key === 'webhookSecret') stripeWebhookSecret.value = ''
    await fetchStripe()
  })
}

function saveRegistrarField(key: string, value: any) {
  if (!value && value !== false) return
  const payload: Record<string, any> = { provider: registrarProvider.value, [key]: value }
  saveOneField(`registrar:${key}`, () => api.patch('/settings/registrar', payload), async () => {
    if (key === 'apiKey') registrarApiKey.value = ''
    if (key === 'apiSecret') registrarApiSecret.value = ''
    await fetchRegistrar()
  })
}

function saveEmailField(key: string, value: any) {
  const payload: Record<string, any> = { provider: emailProvider.value, [key]: value }
  saveOneField(`email:${key}`, () => api.patch('/settings/email', payload), async () => {
    if (key === 'smtpPass') smtpPass.value = ''
    if (key === 'resendApiKey') resendApiKey.value = ''
    await fetchSettings()
  })
}

onMounted(() => {
  fetchSettings()
  fetchStripe()
  fetchGitHub()
  fetchGoogle()
  fetchRegistrar()
  fetchPricing()
  fetchBranding()
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
        <div v-if="activeSection === 'general'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.generalSettings') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('super.settings.generalSettingsDesc') }}</p>
          </div>
          <div class="p-6 space-y-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.platformName') }}</label>
              <div class="flex items-center gap-2 max-w-md">
                <input v-model="platformName" type="text" placeholder="Fleet" @keydown.enter="saveGeneralField('platform:name', platformName)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                <button @click="saveGeneralField('platform:name', platformName)" :disabled="savingField === 'general:platform:name'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'general:platform:name'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.rootDomain') }}</label>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{{ $t('super.settings.rootDomainDesc') }}</p>
              <div class="flex items-center gap-2 max-w-md">
                <input v-model="platformDomain" type="text" placeholder="fleet.example.com" @keydown.enter="saveGeneralField('platform:domain', platformDomain)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                <button @click="saveGeneralField('platform:domain', platformDomain)" :disabled="savingField === 'general:platform:domain'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'general:platform:domain'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.platformUrl') }}</label>
              <div class="flex items-center gap-2 max-w-md">
                <input v-model="platformUrl" type="url" placeholder="https://your-platform.com" @keydown.enter="saveGeneralField('platform:url', platformUrl)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                <button @click="saveGeneralField('platform:url', platformUrl)" :disabled="savingField === 'general:platform:url'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'general:platform:url'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('common.email') }}</label>
              <div class="flex items-center gap-2 max-w-md">
                <input v-model="supportEmail" type="email" placeholder="support@your-platform.com" @keydown.enter="saveGeneralField('platform:supportEmail', supportEmail)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                <button @click="saveGeneralField('platform:supportEmail', supportEmail)" :disabled="savingField === 'general:platform:supportEmail'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'general:platform:supportEmail'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- GitHub Configuration -->
        <div v-if="activeSection === 'github'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.githubConfig') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('super.settings.githubConfigDesc') }}</p>
          </div>
          <div class="p-6 space-y-5">
            <div v-if="githubConfigured" class="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p class="text-sm text-green-700 dark:text-green-300 break-all">GitHub configured (Client ID: <strong class="font-mono">{{ githubClientId }}</strong>)</p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.githubClientId') }}</label>
              <div class="flex items-center gap-2 max-w-lg">
                <input v-model="githubClientId" type="text" placeholder="Ov23li..." @keydown.enter="saveGitHubField('clientId', githubClientId)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
                <button @click="saveGitHubField('clientId', githubClientId)" :disabled="savingField === 'github:clientId'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'github:clientId'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.githubClientSecret') }}</label>
              <div class="flex items-center gap-2 max-w-lg">
                <input v-model="githubClientSecret" type="password" :placeholder="githubClientSecretHint || 'Enter client secret'" @keydown.enter="saveGitHubField('clientSecret', githubClientSecret)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
                <button @click="saveGitHubField('clientSecret', githubClientSecret)" :disabled="savingField === 'github:clientSecret'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'github:clientSecret'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.githubWebhookSecret') }} ({{ $t('common.optional') }})</label>
              <div class="flex items-center gap-2 max-w-lg">
                <input v-model="githubWebhookSecret" type="password" :placeholder="githubWebhookSecretHint || 'Enter webhook secret'" @keydown.enter="saveGitHubField('webhookSecret', githubWebhookSecret)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
                <button @click="saveGitHubField('webhookSecret', githubWebhookSecret)" :disabled="savingField === 'github:webhookSecret'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'github:webhookSecret'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('super.settings.githubOAuthHint') }}</p>
          </div>
        </div>

        <!-- Google Configuration -->
        <div v-if="activeSection === 'google'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.googleConfig') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('super.settings.googleConfigDesc') }}</p>
          </div>
          <div class="p-6 space-y-5">
            <div v-if="googleConfigured" class="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p class="text-sm text-green-700 dark:text-green-300 break-all">Google configured (Client ID: <strong class="font-mono">{{ googleClientId }}</strong>)</p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.googleClientId') }}</label>
              <div class="flex items-center gap-2 max-w-lg">
                <input v-model="googleClientId" type="text" placeholder="123456789-abc.apps.googleusercontent.com" @keydown.enter="saveGoogleField('clientId', googleClientId)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
                <button @click="saveGoogleField('clientId', googleClientId)" :disabled="savingField === 'google:clientId'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'google:clientId'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.googleClientSecret') }}</label>
              <div class="flex items-center gap-2 max-w-lg">
                <input v-model="googleClientSecret" type="password" :placeholder="googleClientSecretHint || 'Enter client secret'" @keydown.enter="saveGoogleField('clientSecret', googleClientSecret)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
                <button @click="saveGoogleField('clientSecret', googleClientSecret)" :disabled="savingField === 'google:clientSecret'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'google:clientSecret'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('super.settings.googleOAuthHint') }}</p>
          </div>
        </div>

        <!-- Stripe Configuration -->
        <div v-if="activeSection === 'stripe'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.stripeConfig') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('super.settings.stripeConfigDesc') }}</p>
          </div>
          <div class="p-6 space-y-5">
            <div v-if="stripeConfigured" class="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p class="text-sm text-green-700 dark:text-green-300 break-all">Stripe configured (Publishable Key: <strong class="font-mono">{{ stripePublishableKey }}</strong>)</p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.stripePublishableKey') }}</label>
              <div class="flex items-center gap-2 max-w-lg">
                <input v-model="stripePublishableKey" type="text" placeholder="pk_live_..." @keydown.enter="saveStripeField('publishableKey', stripePublishableKey)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
                <button @click="saveStripeField('publishableKey', stripePublishableKey)" :disabled="savingField === 'stripe:publishableKey'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'stripe:publishableKey'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.stripeSecretKey') }}</label>
              <div class="flex items-center gap-2 max-w-lg">
                <input v-model="stripeSecretKey" type="password" :placeholder="stripeSecretKeyHint || 'sk_live_...'" @keydown.enter="saveStripeField('secretKey', stripeSecretKey)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
                <button @click="saveStripeField('secretKey', stripeSecretKey)" :disabled="savingField === 'stripe:secretKey'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'stripe:secretKey'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.stripeWebhookSecret') }} ({{ $t('common.optional') }})</label>
              <div class="flex items-center gap-2 max-w-lg">
                <input v-model="stripeWebhookSecret" type="password" :placeholder="stripeWebhookSecretHint || 'whsec_...'" @keydown.enter="saveStripeField('webhookSecret', stripeWebhookSecret)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
                <button @click="saveStripeField('webhookSecret', stripeWebhookSecret)" :disabled="savingField === 'stripe:webhookSecret'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'stripe:webhookSecret'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Email Configuration -->
        <div v-if="activeSection === 'email'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.emailConfig') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('super.settings.emailConfigDesc') }}</p>
          </div>
          <div class="p-6 space-y-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Provider</label>
              <div class="flex items-center gap-2 max-w-xs">
                <select v-model="emailProvider" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm">
                  <option value="smtp">SMTP</option>
                  <option value="resend">Resend</option>
                </select>
                <button @click="saveEmailField('provider', emailProvider)" :disabled="savingField === 'email:provider'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'email:provider'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>

            <template v-if="emailProvider === 'smtp'">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.smtpHost') }}</label>
                <div class="flex items-center gap-2 max-w-md">
                  <input v-model="smtpHost" type="text" placeholder="smtp.example.com" @keydown.enter="saveEmailField('smtpHost', smtpHost)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                  <button @click="saveEmailField('smtpHost', smtpHost)" :disabled="savingField === 'email:smtpHost'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                    <Loader2 v-if="savingField === 'email:smtpHost'" class="w-4 h-4 animate-spin" />
                    <Save v-else class="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.smtpPort') }}</label>
                <div class="flex items-center gap-2 max-w-xs">
                  <input v-model.number="smtpPort" type="number" placeholder="587" @keydown.enter="saveEmailField('smtpPort', smtpPort)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                  <button @click="saveEmailField('smtpPort', smtpPort)" :disabled="savingField === 'email:smtpPort'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                    <Loader2 v-if="savingField === 'email:smtpPort'" class="w-4 h-4 animate-spin" />
                    <Save v-else class="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.smtpUser') }}</label>
                <div class="flex items-center gap-2 max-w-md">
                  <input v-model="smtpUser" type="text" placeholder="your-username" @keydown.enter="saveEmailField('smtpUser', smtpUser)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                  <button @click="saveEmailField('smtpUser', smtpUser)" :disabled="savingField === 'email:smtpUser'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                    <Loader2 v-if="savingField === 'email:smtpUser'" class="w-4 h-4 animate-spin" />
                    <Save v-else class="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.smtpPass') }}</label>
                <div class="flex items-center gap-2 max-w-md">
                  <input v-model="smtpPass" type="password" :placeholder="smtpPassHint || 'Enter new password to update'" @keydown.enter="saveEmailField('smtpPass', smtpPass)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                  <button @click="saveEmailField('smtpPass', smtpPass)" :disabled="savingField === 'email:smtpPass'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                    <Loader2 v-if="savingField === 'email:smtpPass'" class="w-4 h-4 animate-spin" />
                    <Save v-else class="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.emailFrom') }}</label>
                <div class="flex items-center gap-2 max-w-md">
                  <input v-model="smtpFrom" type="email" placeholder="noreply@your-platform.com" @keydown.enter="saveEmailField('smtpFrom', smtpFrom)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                  <button @click="saveEmailField('smtpFrom', smtpFrom)" :disabled="savingField === 'email:smtpFrom'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                    <Loader2 v-if="savingField === 'email:smtpFrom'" class="w-4 h-4 animate-spin" />
                    <Save v-else class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </template>

            <template v-if="emailProvider === 'resend'">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Resend API Key</label>
                <div class="flex items-center gap-2 max-w-lg">
                  <input v-model="resendApiKey" type="password" :placeholder="resendApiKeyHint || 're_...'" @keydown.enter="saveEmailField('resendApiKey', resendApiKey)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
                  <button @click="saveEmailField('resendApiKey', resendApiKey)" :disabled="savingField === 'email:resendApiKey'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                    <Loader2 v-if="savingField === 'email:resendApiKey'" class="w-4 h-4 animate-spin" />
                    <Save v-else class="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.emailFrom') }}</label>
                <div class="flex items-center gap-2 max-w-md">
                  <input v-model="resendFrom" type="email" placeholder="noreply@your-platform.com" @keydown.enter="saveEmailField('resendFrom', resendFrom)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                  <button @click="saveEmailField('resendFrom', resendFrom)" :disabled="savingField === 'email:resendFrom'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                    <Loader2 v-if="savingField === 'email:resendFrom'" class="w-4 h-4 animate-spin" />
                    <Save v-else class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Domain Registrar -->
        <div v-if="activeSection === 'registrar'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.domainRegistrar') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('super.settings.domainRegistrarDesc') }}</p>
          </div>
          <div class="p-6 space-y-5">
            <div v-if="registrarConfigured" class="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p class="text-sm text-green-700 dark:text-green-300 break-all">Registrar configured: <strong>{{ registrarProvider }}</strong><template v-if="registrarApiKeyHint"> (API Key: <span class="font-mono">{{ registrarApiKeyHint }}</span>)</template></p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Provider</label>
              <div class="flex items-center gap-2 max-w-xs">
                <select v-model="registrarProvider" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm">
                  <option value="resellerclub">ResellerClub</option>
                  <option value="namecom">Name.com</option>
                </select>
              </div>
            </div>

            <!-- ResellerClub fields -->
            <div v-if="registrarProvider === 'resellerclub'">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Reseller ID</label>
              <div class="flex items-center gap-2 max-w-md">
                <input v-model="registrarResellerId" type="text" placeholder="Your ResellerClub Reseller ID" @keydown.enter="saveRegistrarField('resellerId', registrarResellerId)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                <button @click="saveRegistrarField('resellerId', registrarResellerId)" :disabled="savingField === 'registrar:resellerId'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'registrar:resellerId'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>

            <div v-if="registrarProvider === 'resellerclub'">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">API Key</label>
              <div class="flex items-center gap-2 max-w-md">
                <input v-model="registrarApiKey" type="password" :placeholder="registrarApiKeyHint || 'Enter API key'" @keydown.enter="saveRegistrarField('apiKey', registrarApiKey)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
                <button @click="saveRegistrarField('apiKey', registrarApiKey)" :disabled="savingField === 'registrar:apiKey'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'registrar:apiKey'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Name.com fields -->
            <div v-if="registrarProvider === 'namecom'">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Username</label>
              <div class="flex items-center gap-2 max-w-md">
                <input v-model="registrarApiKey" type="text" placeholder="Your Name.com username" @keydown.enter="saveRegistrarField('apiKey', registrarApiKey)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                <button @click="saveRegistrarField('apiKey', registrarApiKey)" :disabled="savingField === 'registrar:apiKey'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'registrar:apiKey'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>

            <div v-if="registrarProvider === 'namecom'">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">API Token</label>
              <div class="flex items-center gap-2 max-w-md">
                <input v-model="registrarApiSecret" type="password" :placeholder="registrarApiSecretHint || 'Enter API token'" @keydown.enter="saveRegistrarField('apiSecret', registrarApiSecret)" class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
                <button @click="saveRegistrarField('apiSecret', registrarApiSecret)" :disabled="savingField === 'registrar:apiSecret'" class="shrink-0 p-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white transition-colors">
                  <Loader2 v-if="savingField === 'registrar:apiSecret'" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Sandbox toggle (shared) -->
            <div class="flex items-center gap-3">
              <input id="registrar-sandbox" v-model="registrarSandbox" type="checkbox" @change="saveRegistrarField('sandbox', registrarSandbox)" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
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
          </div>
        </div>

        <!-- Domain Pricing -->
        <div v-if="activeSection === 'pricing'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
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

        <!-- Branding -->
        <div v-if="activeSection === 'branding'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.settings.branding') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('super.settings.brandingDesc') }}</p>
          </div>
          <form @submit.prevent="saveBranding" class="p-6 space-y-6">
            <!-- Title -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.brandTitle') }}</label>
              <input v-model="brandTitleInput" type="text" placeholder="Fleet" class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            </div>

            <!-- Logo -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.brandLogo') }}</label>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">{{ $t('super.settings.logoHint') }}</p>
              <div class="flex items-center gap-4">
                <div v-if="brandLogoPreview" class="h-12 px-3 py-1 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 flex items-center">
                  <img :src="brandLogoPreview" alt="Logo preview" class="h-10 w-auto max-w-[200px] object-contain" />
                </div>
                <label class="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <Upload class="w-4 h-4" />
                  {{ $t('super.settings.uploadLogo') }}
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" class="hidden" @change="onLogoFileChange" />
                </label>
                <button
                  v-if="brandLogoSet"
                  type="button"
                  @click="removeBrandingAsset('logo')"
                  class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 class="w-4 h-4" />
                  {{ $t('super.settings.removeLogo') }}
                </button>
              </div>
            </div>

            <!-- Favicon -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.settings.brandFavicon') }}</label>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">{{ $t('super.settings.faviconHint') }}</p>
              <div class="flex items-center gap-4">
                <div v-if="brandFaviconPreview" class="h-10 w-10 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 flex items-center justify-center">
                  <img :src="brandFaviconPreview" alt="Favicon preview" class="h-8 w-8 object-contain" />
                </div>
                <label class="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <Upload class="w-4 h-4" />
                  {{ $t('super.settings.uploadFavicon') }}
                  <input type="file" accept="image/x-icon,image/png,image/svg+xml" class="hidden" @change="onFaviconFileChange" />
                </label>
                <button
                  v-if="brandFaviconSet"
                  type="button"
                  @click="removeBrandingAsset('favicon')"
                  class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 class="w-4 h-4" />
                  {{ $t('super.settings.removeFavicon') }}
                </button>
              </div>
            </div>

            <div class="pt-2 flex justify-end">
              <button type="submit" :disabled="savingBranding" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                <Loader2 v-if="savingBranding" class="w-4 h-4 animate-spin" />
                <Save v-else class="w-4 h-4" />
                {{ savingBranding ? $t('common.saving') : $t('common.save') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
