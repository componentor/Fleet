<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Globe, Plus, Search, Loader2, Trash2, ShoppingCart, Link, ArrowLeft, Check, Copy, ShieldCheck, Clock, ExternalLink } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useRole } from '@/composables/useRole'

const api = useApi()
const { canWrite } = useRole()

type Tab = 'my-domains' | 'add-domain'
type AddMode = null | 'buy' | 'byod'
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

  // Deduplicate — if a domain is both a zone and a registration, prefer registration
  const purchasedDomains = new Set(purchased.map((p: any) => p.domain))
  const filtered = external.filter((e: any) => !purchasedDomains.has(e.domain))

  return [...purchased, ...filtered].sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return db - da
  })
})

async function fetchDomains() {
  loading.value = true
  try {
    const [z, r] = await Promise.all([
      api.get<any[]>('/dns/zones'),
      api.get<any[]>('/domains/registrations'),
    ])
    zones.value = z
    registrations.value = r
  } catch {
    zones.value = []
    registrations.value = []
  } finally {
    loading.value = false
  }
}

async function searchDomains() {
  if (!searchQuery.value.trim()) return
  searching.value = true
  error.value = ''
  try {
    const data = await api.get<any>(`/domains/search?q=${encodeURIComponent(searchQuery.value.trim())}`)
    searchResults.value = data.results ?? []
    buyStep.value = 'results'
  } catch (err: any) {
    error.value = err?.body?.error || 'Search failed'
  } finally {
    searching.value = false
  }
}

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
    error.value = err?.body?.error || 'Failed to start checkout'
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
    error.value = err?.body?.error || 'Failed to add domain'
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
      error.value = 'Verification failed. Please check your DNS records and try again.'
    }
  } catch (err: any) {
    error.value = err?.body?.error || 'Verification failed'
  } finally {
    verifying.value = false
  }
}

async function deleteDomain(id: string) {
  if (!confirm('Are you sure you want to delete this domain?')) return
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

function resetWizard() {
  addMode.value = null
  buyStep.value = 'search'
  byodStep.value = 'enter'
  searchQuery.value = ''
  searchResults.value = []
  byodDomain.value = ''
  byodZone.value = null
  error.value = ''
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
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Globe class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Domains</h1>
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
        My Domains
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
        Add Domain
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
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Domain</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Expires</th>
                <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-if="allDomains.length === 0">
                <td colspan="5" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No domains yet. Add your first domain to get started.
                </td>
              </tr>
              <tr v-for="d in allDomains" :key="d.id" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2">
                    <ShieldCheck v-if="d.verified" class="w-4 h-4 text-green-500 shrink-0" />
                    <Clock v-else class="w-4 h-4 text-yellow-500 shrink-0" />
                    <span class="text-sm font-medium text-gray-900 dark:text-white">{{ d.domain }}</span>
                  </div>
                </td>
                <td class="px-6 py-4">
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      d.type === 'purchased'
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    ]"
                  >
                    {{ d.type === 'purchased' ? 'Purchased' : 'External' }}
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
                    {{ d.status === 'active' ? 'Active' : 'Pending' }}
                  </span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(d.expiresAt) }}</td>
                <td v-if="canWrite" class="px-6 py-4 text-right">
                  <button
                    v-if="d.type === 'external'"
                    @click="deleteDomain(d.id)"
                    class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                  >
                    Remove
                  </button>
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
      <div v-if="!addMode" class="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
        <button
          @click="addMode = 'buy'"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all"
        >
          <div class="w-12 h-12 rounded-lg bg-primary-600 flex items-center justify-center mb-4">
            <ShoppingCart class="w-6 h-6 text-white" />
          </div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Buy a Domain</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400">Search and purchase a domain directly through us. SSL included automatically.</p>
        </button>

        <button
          @click="addMode = 'byod'"
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all"
        >
          <div class="w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center mb-4">
            <Link class="w-6 h-6 text-white" />
          </div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Use Your Own Domain</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400">Point your existing domain to your Fleet account. SSL included automatically.</p>
        </button>
      </div>

      <!-- Buy Domain Flow -->
      <div v-if="addMode === 'buy'" class="max-w-3xl">
        <button @click="resetWizard()" class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition-colors flex items-center gap-1">
          <ArrowLeft class="w-4 h-4" /> Back to options
        </button>

        <!-- Search -->
        <div v-if="buyStep === 'search' || buyStep === 'results'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Search for a Domain</h2>
          </div>
          <div class="p-6">
            <form @submit.prevent="searchDomains" class="flex items-end gap-3 mb-6">
              <div class="flex-1">
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="Enter a domain name (e.g. mywebsite)"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>
              <button type="submit" :disabled="searching || !searchQuery.trim()" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                <Loader2 v-if="searching" class="w-4 h-4 animate-spin" />
                <Search v-else class="w-4 h-4" />
                Search
              </button>
            </form>

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
                    {{ result.available ? 'Available' : 'Taken' }}
                  </span>
                </div>
                <div class="flex items-center gap-4">
                  <span v-if="result.price" class="text-sm font-semibold text-gray-900 dark:text-white">
                    {{ formatPrice(result.price.registration) }}/yr
                  </span>
                  <button
                    v-if="result.available"
                    @click="buyDomain(result.domain)"
                    :disabled="purchasing"
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                  >
                    <Loader2 v-if="purchasing" class="w-3.5 h-3.5 animate-spin" />
                    <ShoppingCart v-else class="w-3.5 h-3.5" />
                    Buy
                  </button>
                </div>
              </div>
            </div>

            <div v-else-if="buyStep === 'results' && !searching" class="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
              No results found. Try a different search term.
            </div>
          </div>
        </div>
      </div>

      <!-- BYOD Flow -->
      <div v-if="addMode === 'byod'" class="max-w-2xl">
        <button @click="resetWizard()" class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition-colors flex items-center gap-1">
          <ArrowLeft class="w-4 h-4" /> Back to options
        </button>

        <!-- Step 1: Enter domain -->
        <div v-if="byodStep === 'enter'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Use Your Own Domain</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Enter the domain you'd like to connect.</p>
          </div>
          <form @submit.prevent="addByodDomain" class="p-6 space-y-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Domain Name</label>
              <input
                v-model="byodDomain"
                type="text"
                placeholder="app.example.com"
                required
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>
            <div class="flex justify-end">
              <button type="submit" :disabled="byodAdding || !byodDomain.trim()" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                <Loader2 v-if="byodAdding" class="w-4 h-4 animate-spin" />
                Continue
              </button>
            </div>
          </form>
        </div>

        <!-- Step 2: DNS Instructions -->
        <div v-if="byodStep === 'instructions' && byodZone" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Configure DNS Records</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Add these records at your DNS provider to verify ownership.</p>
          </div>
          <div class="p-6 space-y-6">
            <!-- CNAME -->
            <div class="space-y-2">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Step 1: Add a CNAME record</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400">Point your domain to:</p>
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
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Step 2: Add a TXT record</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                Add a TXT record at <code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">_fleet-verify.{{ byodZone.domain }}</code> with value:
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
                Verify Domain
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
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Domain Verified!</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Your domain <strong>{{ byodZone?.domain }}</strong> has been verified and is ready to use. SSL will be provisioned automatically when you attach it to a service.
            </p>
            <button
              @click="activeTab = 'my-domains'; resetWizard()"
              class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
            >
              Go to My Domains
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
