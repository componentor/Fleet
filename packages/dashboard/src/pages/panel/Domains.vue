<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Globe, Plus, Search, Loader2, Trash2, ShoppingCart, Link, ArrowLeft, Check, Copy, ShieldCheck, Clock, ExternalLink, Share2, Settings2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useRole } from '@/composables/useRole'

const { t } = useI18n()
const router = useRouter()
const api = useApi()
const { canWrite } = useRole()

type Tab = 'my-domains' | 'add-domain'
type AddMode = null | 'buy' | 'byod' | 'subdomain'
type BuyStep = 'search' | 'results'
type ByodStep = 'enter' | 'instructions' | 'verify'

const activeTab = ref<Tab>('my-domains')
const addMode = ref<AddMode>(null)
const buyStep = ref<BuyStep>('search')
const byodStep = ref<ByodStep>('enter')

// Domain lists
const zones = ref<any[]>([])
const registrations = ref<any[]>([])
const loading = ref(true)
const error = ref('')

// Buy domain
const searchQuery = ref('')
const searchResults = ref<any[]>([])
const searching = ref(false)
const purchasing = ref(false)

// BYOD
const byodDomain = ref('')
const byodAdding = ref(false)
const byodZone = ref<any>(null)
const verifying = ref(false)
const copyFeedback = ref('')

// Subdomain claim
const availableDomains = ref<any[]>([])
const subdomainClaims = ref<any[]>([])
const loadingSubdomains = ref(false)
const selectedParent = ref<any>(null)
const subdomainInput = ref('')
const claimingSubdomain = ref(false)
const claimSuccess = ref(false)

const allDomains = computed(() => {
  const purchased = registrations.value.map((r: any) => ({
    id: r.id,
    domain: r.domain,
    type: 'purchased' as const,
    status: r.status ?? 'active',
    verified: true,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt ?? r.registeredAt,
  }))

  const external = zones.value.map((z: any) => ({
    id: z.id,
    domain: z.domain,
    type: 'external' as const,
    status: z.verified ? 'active' : 'pending',
    verified: z.verified,
    expiresAt: null,
    createdAt: z.createdAt,
  }))

  const subdomain = subdomainClaims.value.map((cl: any) => ({
    id: cl.id,
    domain: cl.fullDomain,
    type: 'subdomain' as const,
    status: cl.status === 'active' ? 'active' : 'pending',
    verified: true,
    expiresAt: null,
    createdAt: cl.createdAt,
    serviceName: cl.serviceName,
  }))

  // Deduplicate — if a domain is both a zone and a registration, prefer registration
  const purchasedDomains = new Set(purchased.map((p: any) => p.domain))
  const filtered = external.filter((e: any) => !purchasedDomains.has(e.domain))

  return [...purchased, ...filtered, ...subdomain].sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return db - da
  })
})

async function fetchDomains() {
  loading.value = true
  try {
    const [z, r, sc] = await Promise.all([
      api.get<any[]>('/dns/zones'),
      api.get<any[]>('/domains/registrations'),
      api.get<any[]>('/shared-domains/mine').catch(() => []),
    ])
    zones.value = z
    registrations.value = r
    subdomainClaims.value = sc
  } catch {
    zones.value = []
    registrations.value = []
    subdomainClaims.value = []
  } finally {
    loading.value = false
  }
}

let searchTimeout: ReturnType<typeof setTimeout> | null = null

async function searchDomains() {
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    return
  }
  searching.value = true
  error.value = ''
  try {
    const data = await api.get<any>(`/domains/search?q=${encodeURIComponent(searchQuery.value.trim())}`)
    searchResults.value = data.results ?? []
    buyStep.value = 'results'
  } catch (err: any) {
    error.value = err?.body?.error || t('domains.searchFailed')
  } finally {
    searching.value = false
  }
}

// Debounced search as you type
watch(searchQuery, (val) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  if (!val.trim()) {
    searchResults.value = []
    return
  }
  searchTimeout = setTimeout(() => {
    searchDomains()
  }, 400)
})

async function buyDomain(domain: string) {
  purchasing.value = true
  error.value = ''
  try {
    const currentUrl = window.location.origin
    const data = await api.post<any>('/domains/checkout', {
      domain,
      years: 1,
      successUrl: `${currentUrl}/panel/domains?purchased=true`,
      cancelUrl: `${currentUrl}/panel/domains`,
    })
    if (data.url) {
      window.location.href = data.url
    }
  } catch (err: any) {
    error.value = err?.body?.error || t('domains.checkoutFailed')
  } finally {
    purchasing.value = false
  }
}

async function addByodDomain() {
  if (!byodDomain.value.trim()) return
  byodAdding.value = true
  error.value = ''
  try {
    const result = await api.post<any>('/dns/zones', { domain: byodDomain.value.trim() })
    byodZone.value = result
    byodStep.value = 'instructions'
  } catch (err: any) {
    error.value = err?.body?.error || t('domains.addFailed')
  } finally {
    byodAdding.value = false
  }
}

async function verifyDomain() {
  if (!byodZone.value) return
  verifying.value = true
  error.value = ''
  try {
    const result = await api.post<any>(`/dns/zones/${byodZone.value.id}/verify`, {
      token: byodZone.value.verificationToken,
    })
    if (result.verified) {
      byodStep.value = 'verify'
      await fetchDomains()
    } else {
      error.value = t('domains.verificationFailedDetail')
    }
  } catch (err: any) {
    error.value = err?.body?.error || t('domains.verificationFailed')
  } finally {
    verifying.value = false
  }
}

async function deleteDomain(id: string) {
  if (!confirm(t('domains.confirmDelete'))) return
  try {
    await api.del(`/dns/zones/${id}`)
    await fetchDomains()
  } catch {
    // ignore
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  copyFeedback.value = text
  setTimeout(() => { copyFeedback.value = '' }, 2000)
}

async function fetchAvailableDomains() {
  loadingSubdomains.value = true
  try {
    availableDomains.value = await api.get<any[]>('/shared-domains/available')
  } catch {
    availableDomains.value = []
  } finally {
    loadingSubdomains.value = false
  }
}

async function claimSubdomain() {
  if (!selectedParent.value || !subdomainInput.value.trim()) return
  claimingSubdomain.value = true
  error.value = ''
  try {
    await api.post('/shared-domains/claim', {
      sharedDomainId: selectedParent.value.id,
      subdomain: subdomainInput.value.trim().toLowerCase(),
    })
    claimSuccess.value = true
    await fetchDomains()
  } catch (err: any) {
    error.value = err?.body?.error || t('domains.claimFailed')
  } finally {
    claimingSubdomain.value = false
  }
}

async function releaseSubdomain(id: string) {
  if (!confirm(t('domains.confirmRelease'))) return
  try {
    await api.del(`/shared-domains/${id}`)
    await fetchDomains()
  } catch {
    // ignore
  }
}

function formatSubdomainPrice(d: any): string {
  if (d.pricingType === 'free') return t('domains.free')
  const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: d.currency }).format(d.price / 100)
  return d.pricingType === 'one_time' ? t('domains.priceOneTime', { price: formatted }) : t('domains.priceMonthly', { price: formatted })
}

function resetWizard() {
  addMode.value = null
  buyStep.value = 'search'
  byodStep.value = 'enter'
  searchQuery.value = ''
  searchResults.value = []
  byodDomain.value = ''
  byodZone.value = null
  error.value = ''
  selectedParent.value = null
  subdomainInput.value = ''
  claimSuccess.value = false
}

function goToAddDomain() {
  activeTab.value = 'add-domain'
  resetWizard()
}

function formatDate(ts: any) {
  if (!ts) return '--'
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  return d.toLocaleDateString()
}

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`
}

function goToDomainDetail(d: any) {
  // External (BYOD) domains use the zone ID
  if (d.type === 'external') {
    router.push({ name: 'panel-domain-detail', params: { id: d.id } })
  }
  // Purchased domains — find matching zone
  else if (d.type === 'purchased') {
    const zone = zones.value.find((z: any) => z.domain === d.domain)
    if (zone) {
      router.push({ name: 'panel-domain-detail', params: { id: zone.id } })
    }
  }
}

function openDomainUrl(domain: string) {
  window.open(`https://${domain}`, '_blank', 'noopener,noreferrer')
}

onMounted(() => {
  fetchDomains()
  // Check for successful purchase redirect
  const params = new URLSearchParams(window.location.search)
  if (params.get('purchased') === 'true') {
    window.history.replaceState({}, '', window.location.pathname)
  }
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <Globe class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('domains.title') }}</h1>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex items-center gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
      <button
        @click="activeTab = 'my-domains'; resetWizard()"
        :class="[
          'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
          activeTab === 'my-domains'
            ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
            : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
        ]"
      >
        {{ t('domains.myDomains') }}
      </button>
      <button
        v-if="canWrite"
        @click="goToAddDomain()"
        :class="[
          'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
          activeTab === 'add-domain'
            ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
            : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
        ]"
      >
        {{ t('domains.addDomain') }}
      </button>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- My Domains Tab -->
    <div v-if="activeTab === 'my-domains'">
      <div v-if="loading" class="flex items-center justify-center py-20">
        <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
      </div>

      <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('domains.columnDomain') }}</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('domains.columnType') }}</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('domains.columnStatus') }}</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('domains.columnExpires') }}</th>
                <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('domains.columnActions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-if="allDomains.length === 0">
                <td colspan="5" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  {{ t('domains.emptyState') }}
                </td>
              </tr>
              <tr
                v-for="d in allDomains"
                :key="d.id"
                :class="[
                  'hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors',
                  (d.type === 'external' || d.type === 'purchased') ? 'cursor-pointer' : '',
                ]"
                @click="(d.type === 'external' || d.type === 'purchased') ? goToDomainDetail(d) : undefined"
              >
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2">
                    <ShieldCheck v-if="d.verified" class="w-4 h-4 text-green-500 shrink-0" />
                    <Clock v-else class="w-4 h-4 text-yellow-500 shrink-0" />
                    <span class="text-sm font-medium text-gray-900 dark:text-white">{{ d.domain }}</span>
                    <span v-if="d.status === 'pending' && d.type === 'external'" class="text-xs text-yellow-600 dark:text-yellow-400">— {{ t('domains.clickToConfigureDns') }}</span>
                  </div>
                </td>
                <td class="px-6 py-4">
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      d.type === 'purchased'
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                        : d.type === 'subdomain'
                          ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300'
                          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    ]"
                  >
                    {{ d.type === 'purchased' ? t('domains.typePurchased') : d.type === 'subdomain' ? t('domains.typeSubdomain') : t('domains.typeExternal') }}
                  </span>
                </td>
                <td class="px-6 py-4">
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      d.status === 'active'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                    ]"
                  >
                    {{ d.status === 'active' ? t('domains.statusActive') : t('domains.statusPending') }}
                  </span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(d.expiresAt) }}</td>
                <td v-if="canWrite" class="px-6 py-4 text-right">
                  <div class="flex items-center justify-end gap-2" @click.stop>
                    <button
                      v-if="d.status === 'active'"
                      @click="openDomainUrl(d.domain)"
                      class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                      :title="t('domains.openInNewTab')"
                    >
                      <ExternalLink class="w-3.5 h-3.5" />
                      {{ t('domains.open') }}
                    </button>
                    <button
                      v-if="d.type === 'external' || d.type === 'purchased'"
                      @click="goToDomainDetail(d)"
                      class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      :title="t('domains.manageDns')"
                    >
                      <Settings2 class="w-3.5 h-3.5" />
                      {{ t('domains.dns') }}
                    </button>
                    <button
                      v-if="d.type === 'external'"
                      @click="deleteDomain(d.id)"
                      class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                    >
                      {{ t('domains.remove') }}
                    </button>
                    <button
                      v-if="d.type === 'subdomain'"
                      @click="releaseSubdomain(d.id)"
                      class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                    >
                      {{ t('domains.release') }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Add Domain Tab -->
    <div v-if="activeTab === 'add-domain'">
      <!-- Choose mode -->
      <div v-if="!addMode" class="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl">
        <button
          @click="addMode = 'buy'"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all"
        >
          <div class="w-12 h-12 rounded-lg bg-primary-600 flex items-center justify-center mb-4">
            <ShoppingCart class="w-6 h-6 text-white" />
          </div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ t('domains.buyTitle') }}</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('domains.buyDescription') }}</p>
        </button>

        <button
          @click="addMode = 'byod'"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all"
        >
          <div class="w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center mb-4">
            <Link class="w-6 h-6 text-white" />
          </div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ t('domains.byodTitle') }}</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('domains.byodDescription') }}</p>
        </button>

        <button
          @click="addMode = 'subdomain'; fetchAvailableDomains()"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all"
        >
          <div class="w-12 h-12 rounded-lg bg-teal-600 flex items-center justify-center mb-4">
            <Share2 class="w-6 h-6 text-white" />
          </div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ t('domains.claimTitle') }}</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('domains.claimDescription') }}</p>
        </button>
      </div>

      <!-- Buy Domain Flow -->
      <div v-if="addMode === 'buy'" class="max-w-3xl">
        <button @click="resetWizard()" class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition-colors flex items-center gap-1">
          <ArrowLeft class="w-4 h-4" /> {{ t('domains.backToOptions') }}
        </button>

        <!-- Search -->
        <div v-if="buyStep === 'search' || buyStep === 'results'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('domains.searchForDomain') }}</h2>
          </div>
          <div class="p-6">
            <div class="relative mb-6">
              <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="t('domains.searchPlaceholder')"
                class="w-full pl-10 pr-10 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
              <Loader2 v-if="searching" class="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-500 animate-spin" />
            </div>

            <!-- Results -->
            <div v-if="searchResults.length > 0" class="space-y-2">
              <div
                v-for="result in searchResults"
                :key="result.domain"
                :class="[
                  'flex items-center justify-between p-4 rounded-lg border transition-colors',
                  result.available
                    ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10'
                    : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 opacity-60'
                ]"
              >
                <div class="flex items-center gap-3">
                  <span class="text-sm font-medium text-gray-900 dark:text-white">{{ result.domain }}</span>
                  <span
                    :class="[
                      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                      result.available
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    ]"
                  >
                    {{ result.available ? t('domains.available') : t('domains.taken') }}
                  </span>
                </div>
                <div class="flex items-center gap-4">
                  <span v-if="result.price" class="text-sm font-semibold text-gray-900 dark:text-white">
                    {{ t('domains.pricePerYear', { price: formatPrice(result.price.registration) }) }}
                  </span>
                  <button
                    v-if="result.available"
                    @click="buyDomain(result.domain)"
                    :disabled="purchasing"
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                  >
                    <Loader2 v-if="purchasing" class="w-3.5 h-3.5 animate-spin" />
                    <ShoppingCart v-else class="w-3.5 h-3.5" />
                    {{ t('domains.buy') }}
                  </button>
                </div>
              </div>
            </div>

            <div v-else-if="buyStep === 'results' && !searching" class="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
              {{ t('domains.noSearchResults') }}
            </div>
          </div>
        </div>
      </div>

      <!-- Claim Subdomain Flow -->
      <div v-if="addMode === 'subdomain'" class="max-w-2xl">
        <button @click="resetWizard()" class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition-colors flex items-center gap-1">
          <ArrowLeft class="w-4 h-4" /> {{ t('domains.backToOptions') }}
        </button>

        <!-- Success -->
        <div v-if="claimSuccess" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="p-8 text-center">
            <div class="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
              <Check class="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ t('domains.subdomainClaimed') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {{ t('domains.subdomainClaimedDesc', { subdomain: `${subdomainInput}.${selectedParent?.domain}` }) }}
            </p>
            <button
              @click="activeTab = 'my-domains'; resetWizard()"
              class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
            >
              {{ t('domains.goToMyDomains') }}
            </button>
          </div>
        </div>

        <!-- Loading -->
        <div v-else-if="loadingSubdomains" class="flex items-center justify-center py-20">
          <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
        </div>

        <!-- No available domains -->
        <div v-else-if="availableDomains.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-center">
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('domains.noSharedDomains') }}</p>
        </div>

        <!-- Pick parent + enter subdomain -->
        <div v-else class="space-y-6">
          <!-- Step 1: Choose parent domain -->
          <div v-if="!selectedParent" class="space-y-3">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('domains.chooseDomain') }}</h2>
            <div
              v-for="d in availableDomains"
              :key="d.id"
              @click="selectedParent = d"
              class="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary-300 dark:hover:border-primary-600 cursor-pointer transition-all"
            >
              <div>
                <span class="text-sm font-medium text-gray-900 dark:text-white">*.{{ d.domain }}</span>
                <p v-if="d.maxPerAccount > 0" class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {{ t('domains.claimsUsed', { used: d.myClaimCount, max: d.maxPerAccount }) }}
                </p>
              </div>
              <span
                :class="[
                  'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                  d.pricingType === 'free'
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                ]"
              >
                {{ formatSubdomainPrice(d) }}
              </span>
            </div>
          </div>

          <!-- Step 2: Enter subdomain -->
          <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between">
                <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('domains.claimASubdomain') }}</h2>
                <button @click="selectedParent = null" class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                  {{ t('domains.changeDomain') }}
                </button>
              </div>
            </div>
            <form @submit.prevent="claimSubdomain" class="p-6 space-y-5">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('domains.subdomainLabel') }}</label>
                <div class="flex items-center">
                  <input
                    v-model="subdomainInput"
                    type="text"
                    :placeholder="t('domains.subdomainPlaceholder')"
                    required
                    pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                    class="flex-1 px-3.5 py-2.5 rounded-l-lg border border-r-0 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                  />
                  <span class="px-3.5 py-2.5 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-sm rounded-r-lg">
                    .{{ selectedParent.domain }}
                  </span>
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ t('domains.subdomainHint') }}</p>
              </div>
              <div class="flex justify-end">
                <button
                  type="submit"
                  :disabled="claimingSubdomain || !subdomainInput.trim()"
                  class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  <Loader2 v-if="claimingSubdomain" class="w-4 h-4 animate-spin" />
                  {{ t('domains.claimSubdomainBtn') }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- BYOD Flow -->
      <div v-if="addMode === 'byod'" class="max-w-2xl">
        <button @click="resetWizard()" class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition-colors flex items-center gap-1">
          <ArrowLeft class="w-4 h-4" /> {{ t('domains.backToOptions') }}
        </button>

        <!-- Step 1: Enter domain -->
        <div v-if="byodStep === 'enter'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('domains.byodTitle') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('domains.byodEnterDesc') }}</p>
          </div>
          <form @submit.prevent="addByodDomain" class="p-6 space-y-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('domains.domainName') }}</label>
              <input
                v-model="byodDomain"
                type="text"
                :placeholder="t('domains.byodPlaceholder')"
                required
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>
            <div class="flex justify-end">
              <button type="submit" :disabled="byodAdding || !byodDomain.trim()" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                <Loader2 v-if="byodAdding" class="w-4 h-4 animate-spin" />
                {{ t('domains.continue') }}
              </button>
            </div>
          </form>
        </div>

        <!-- Step 2: DNS Instructions -->
        <div v-if="byodStep === 'instructions' && byodZone" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('domains.configureDns') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('domains.configureDnsDesc') }}</p>
          </div>
          <div class="p-6 space-y-6">
            <!-- CNAME -->
            <div class="space-y-2">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('domains.step1Cname') }}</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('domains.pointDomainTo') }}</p>
              <div class="flex items-center gap-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                <code class="flex-1 text-sm font-mono text-gray-900 dark:text-white">{{ byodZone.cnameTarget }}</code>
                <button @click="copyToClipboard(byodZone.cnameTarget)" class="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                  <Check v-if="copyFeedback === byodZone.cnameTarget" class="w-4 h-4 text-green-500" />
                  <Copy v-else class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- TXT -->
            <div class="space-y-2">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('domains.step2Txt') }}</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('domains.addTxtRecordAt') }} <code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">_fleet-verify.{{ byodZone.domain }}</code> {{ t('domains.withValue') }}
              </p>
              <div class="flex items-center gap-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                <code class="flex-1 text-sm font-mono text-gray-900 dark:text-white break-all">fleet-verify={{ byodZone.verificationToken }}</code>
                <button @click="copyToClipboard(`fleet-verify=${byodZone.verificationToken}`)" class="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors shrink-0">
                  <Check v-if="copyFeedback === `fleet-verify=${byodZone.verificationToken}`" class="w-4 h-4 text-green-500" />
                  <Copy v-else class="w-4 h-4" />
                </button>
              </div>
            </div>

            <div class="pt-2 flex justify-end">
              <button
                @click="verifyDomain"
                :disabled="verifying"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="verifying" class="w-4 h-4 animate-spin" />
                <ShieldCheck v-else class="w-4 h-4" />
                {{ t('domains.verifyDomain') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Step 3: Verified -->
        <div v-if="byodStep === 'verify'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="p-8 text-center">
            <div class="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
              <Check class="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ t('domains.domainVerified') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {{ t('domains.domainVerifiedDesc', { domain: byodZone?.domain }) }}
            </p>
            <button
              @click="activeTab = 'my-domains'; resetWizard()"
              class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
            >
              {{ t('domains.goToMyDomains') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
