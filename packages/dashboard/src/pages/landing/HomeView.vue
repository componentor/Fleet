<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, Check, X, Globe, Shield, Zap, Server, ArrowRight, Clock, Rocket, MousePointerClick } from 'lucide-vue-next'
import LandingNavbar from '@/components/landing/LandingNavbar.vue'
import type { NavLink } from '@/components/landing/LandingNavbar.vue'
import LandingFooter from '@/components/landing/LandingFooter.vue'
import CartDrawer from '@/components/landing/CartDrawer.vue'
import { useBranding } from '@/composables/useBranding'
import { useCart } from '@/composables/useCart'
import { useCurrency } from '@/composables/useCurrency'

const { t, locale } = useI18n()
const { brandGithubUrl, logoSrc } = useBranding()
const cart = useCart()
const { selectedCurrency, allowedCurrencies, bcp47, fetchAllowed, formatCurrency, formatCents } = useCurrency()

// ── Domain search ──
const searchQuery = ref('')
const searchResults = ref<any[]>([])
const searching = ref(false)
const searched = ref(false)
const cartOpen = ref(false)

let searchTimeout: ReturnType<typeof setTimeout> | null = null

async function searchDomains() {
  const q = searchQuery.value.trim()
  if (!q) {
    searchResults.value = []
    searched.value = false
    return
  }
  searching.value = true
  searched.value = false
  try {
    const res = await fetch(`/api/v1/domains/public/search?q=${encodeURIComponent(q)}&currency=${selectedCurrency.value}`)
    if (res.ok) {
      const data = await res.json()
      searchResults.value = data.results ?? []
    } else {
      searchResults.value = []
    }
  } catch {
    searchResults.value = []
  } finally {
    searching.value = false
    searched.value = true
  }
}

// Debounced auto-search while typing
watch(searchQuery, (val) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  if (!val.trim()) {
    searchResults.value = []
    searched.value = false
    return
  }
  searchTimeout = setTimeout(() => searchDomains(), 400)
})

function addToCart(result: any) {
  const price = result.price?.registration ?? 0
  const currency = result.price?.currency ?? 'USD'
  const renewalPrice = result.price?.renewal
  cart.addDomain(result.domain, price, currency, renewalPrice)
}

function formatPrice(result: any) {
  if (!result.price) return ''
  return formatCurrency(result.price.registration, result.price.currency)
}

// ── Plans (same as before) ──
interface ApiPlan {
  id: string
  name: string
  slug: string
  description: string | null
  nameTranslations?: Record<string, string>
  descriptionTranslations?: Record<string, string>
  isFree: boolean
  isDefault: boolean
  priceCents: number
  cpuLimit: number
  memoryLimit: number
  containerLimit: number
  storageLimit: number
}

const apiPlans = ref<ApiPlan[]>([])
const plansLoaded = ref(false)

const fallbackPlans = computed(() => [
  {
    id: 'free',
    slug: 'free',
    name: t('landing.pricing.plans.free.name'),
    price: formatCents(0),
    period: t('landing.pricing.perYear', '/ yr'),
    description: t('landing.pricing.plans.free.description'),
    features: [
      t('landing.pricing.plans.free.f1'),
      t('landing.pricing.plans.free.f2'),
      t('landing.pricing.plans.free.f3'),
      t('landing.pricing.plans.free.f4'),
      t('landing.pricing.plans.free.f5'),
    ],
    highlighted: false,
    isFree: true,
  },
  {
    id: 'starter',
    slug: 'starter',
    name: t('landing.pricing.plans.starter.name'),
    price: formatCents(1000 * 12),
    period: t('landing.pricing.perYear', '/ yr'),
    description: t('landing.pricing.plans.starter.description'),
    features: [
      t('landing.pricing.plans.starter.f1'),
      t('landing.pricing.plans.starter.f2'),
      t('landing.pricing.plans.starter.f3'),
      t('landing.pricing.plans.starter.f4'),
      t('landing.pricing.plans.starter.f5'),
    ],
    highlighted: true,
    isFree: false,
  },
  {
    id: 'pro',
    slug: 'pro',
    name: t('landing.pricing.plans.pro.name'),
    price: formatCents(2500 * 12),
    period: t('landing.pricing.perYear', '/ yr'),
    description: t('landing.pricing.plans.pro.description'),
    features: [
      t('landing.pricing.plans.pro.f1'),
      t('landing.pricing.plans.pro.f2'),
      t('landing.pricing.plans.pro.f3'),
      t('landing.pricing.plans.pro.f4'),
      t('landing.pricing.plans.pro.f5'),
    ],
    highlighted: false,
    isFree: false,
  },
])

function formatMemory(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)}GB` : `${mb}MB`
}

function formatLimit(val: number, suffixPlural: string, suffixSingular?: string): string {
  const unlimited = t('onboarding.unlimited', 'Unlimited')
  if (val === -1) return `${unlimited} ${suffixPlural}`
  const suffix = val === 1 && suffixSingular ? suffixSingular : suffixPlural
  return `${val} ${suffix}`
}

const plans = computed(() => {
  if (!plansLoaded.value || !apiPlans.value.length) return fallbackPlans.value
  const unlimited = t('onboarding.unlimited', 'Unlimited')
  return apiPlans.value.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.nameTranslations?.[locale.value] || p.name,
    price: formatCents(p.priceCents * 12),
    period: t('landing.pricing.perYear', '/ yr'),
    description: p.descriptionTranslations?.[locale.value] || p.description || '',
    features: [
      formatLimit(p.containerLimit, t('onboarding.containers', 'services'), t('onboarding.container', 'service')),
      `${formatMemory(p.memoryLimit)} ${t('onboarding.memory', 'RAM')}`,
      formatLimit(p.cpuLimit, t('onboarding.cpu', 'CPU cores'), t('onboarding.cpuSingular', 'CPU core')),
      `${p.storageLimit === -1 ? unlimited : p.storageLimit + 'GB'} ${t('onboarding.storage', 'storage')}`,
    ],
    highlighted: p.isDefault && !p.isFree,
    isFree: p.isFree,
  }))
})

// ── Lifecycle ──
async function fetchPlans() {
  try {
    const res = await fetch(`/api/v1/billing/public/plans?currency=${selectedCurrency.value}`)
    if (res.ok) {
      const data = await res.json()
      if (data.plans?.length) apiPlans.value = data.plans
    }
  } catch { /* fallback plans */ } finally {
    plansLoaded.value = true
  }
}

// Re-fetch prices when currency changes (locale change auto-updates selectedCurrency via composable)
watch(selectedCurrency, async () => {
  fetchPlans()
  if (searchQuery.value.trim()) searchDomains()
  // Re-price existing cart items in the new currency
  if (cart.items.value.length > 0) {
    for (const item of cart.items.value) {
      try {
        const res = await fetch(`/api/v1/domains/public/search?q=${encodeURIComponent(item.domain)}&currency=${selectedCurrency.value}`)
        if (res.ok) {
          const data = await res.json()
          const match = data.results?.find((r: any) => r.domain === item.domain)
          if (match?.price) {
            cart.updateDomain(item.domain, match.price.registration, match.price.currency, match.price.renewal)
          }
        }
      } catch { /* keep existing price */ }
    }
  }
})

onMounted(async () => {
  await fetchAllowed()
  await fetchPlans()

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('visible')
      })
    },
    { threshold: 0.1 }
  )
  document.querySelectorAll('.fade-in').forEach((el) => observer.observe(el))
  onUnmounted(() => observer.disconnect())
})

const navLinks = computed<NavLink[]>(() => {
  const links: NavLink[] = []
  if (brandGithubUrl.value) {
    links.push({ label: t('landing.nav.github'), href: brandGithubUrl.value, external: true })
  }
  return links
})

// "How it works" steps
const steps = computed(() => [
  { icon: Search, title: t('landing.howItWorks.step1Title', 'Search Your Domain'), description: t('landing.howItWorks.step1Desc', 'Find the perfect domain name for your project or business.') },
  { icon: MousePointerClick, title: t('landing.howItWorks.step2Title', 'Pick a Tier'), description: t('landing.howItWorks.step2Desc', 'Choose a service tier that fits your needs. Start free.') },
  { icon: Rocket, title: t('landing.howItWorks.step3Title', 'Go Live'), description: t('landing.howItWorks.step3Desc', 'Deploy your site or app in seconds. We handle the rest.') },
])

// "Why choose us" trust signals
const trustSignals = computed(() => [
  { icon: Zap, title: t('landing.whyChooseUs.fastDns', 'Fast DNS'), description: t('landing.whyChooseUs.fastDnsDesc', 'Global DNS propagation in minutes, not hours.') },
  { icon: Shield, title: t('landing.whyChooseUs.freeSsl', 'Free SSL'), description: t('landing.whyChooseUs.freeSslDesc', 'Automatic HTTPS certificates for every domain.') },
  { icon: Server, title: t('landing.whyChooseUs.oneClickApps', '1-Click Apps'), description: t('landing.whyChooseUs.oneClickAppsDesc', 'Deploy WordPress, databases, and more from our marketplace.') },
  { icon: Clock, title: t('landing.whyChooseUs.uptime', '99.9% Uptime'), description: t('landing.whyChooseUs.uptimeDesc', 'Redundant infrastructure with automatic failover.') },
  { icon: Globe, title: t('landing.whyChooseUs.domainMgmt', 'Domain Management'), description: t('landing.whyChooseUs.domainMgmtDesc', 'Full DNS control, WHOIS privacy, and easy transfers.') },
  { icon: Shield, title: t('landing.whyChooseUs.backups', 'Automatic Backups'), description: t('landing.whyChooseUs.backupsDesc', 'Daily backups with one-click restore.') },
])
</script>

<template>
  <div class="min-h-screen bg-white dark:bg-surface-950 text-surface-700 dark:text-surface-200">
    <LandingNavbar :nav-links="navLinks" :cart-count="cart.count.value" @open-cart="cartOpen = true" />

    <CartDrawer :open="cartOpen" @close="cartOpen = false" />

    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- HERO — Domain search first                                        -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <section class="relative pt-32 pb-28 sm:pt-40 sm:pb-36">
      <!-- Background gradients -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div class="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary-600/10 dark:bg-primary-600/20 blur-[128px]"></div>
        <div class="absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full bg-primary-800/10 dark:bg-primary-800/20 blur-[128px]"></div>
        <div class="absolute top-1/2 left-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-700/5 dark:bg-primary-700/10 blur-[128px]"></div>
      </div>

      <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,90,31,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,90,31,0.03)_1px,transparent_1px)] bg-[size:64px_64px]"></div>

      <!-- Wave transition — "How It Works" color rising into hero -->
      <div class="pointer-events-none absolute bottom-0 left-0 right-0 z-10">
        <svg viewBox="0 0 1440 100" preserveAspectRatio="none" class="block w-full h-[80px] sm:h-[100px]">
          <path d="M0,60 C360,0 1080,100 1440,40 L1440,100 L0,100 Z" class="fill-surface-50 dark:fill-surface-900" />
        </svg>
      </div>

      <div class="relative mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
        <img v-if="logoSrc()" :src="logoSrc()!" alt="" class="mx-auto mb-6 h-14 w-auto object-contain" />
        <div v-else class="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700">
          <svg class="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h1 class="mx-auto max-w-5xl text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white sm:text-5xl lg:text-6xl">
          <span class="block">{{ t('landing.domainSearch.heroTitle', 'Find Your Perfect') }}</span>
          <span class="animate-gradient bg-[length:200%_auto] bg-gradient-to-r from-primary-500 via-cyan-400 to-primary-500 dark:from-primary-400 dark:via-cyan-300 dark:to-primary-400 bg-clip-text text-transparent">
            {{ t('landing.domainSearch.heroHighlight', 'Domain Name') }}
          </span>
        </h1>

        <p class="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-surface-500 dark:text-surface-400 sm:text-xl">
          {{ t('landing.domainSearch.heroSubtitle', 'Search, register, and host your website — all in one place.') }}
        </p>

        <!-- Domain search bar -->
        <div class="mx-auto mt-10 max-w-2xl">
          <div class="flex rounded-2xl border-2 border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl shadow-surface-200/50 dark:shadow-black/30 transition-all focus-within:border-primary-500 focus-within:shadow-primary-500/20 min-w-0">
            <div class="flex items-center pl-4 sm:pl-5 text-surface-400 shrink-0">
              <Globe class="w-5 h-5" />
            </div>
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="t('landing.domainSearch.placeholder', 'Enter your domain name...')"
              class="flex-1 min-w-0 bg-transparent px-3 sm:px-4 py-4 text-base sm:text-lg text-gray-900 dark:text-white placeholder-surface-400 outline-none"
            />
            <button
              @click="searchDomains"
              :disabled="searching || !searchQuery.trim()"
              class="m-2 flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 px-4 sm:px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition-all hover:shadow-primary-500/40 hover:brightness-110 disabled:opacity-50 shrink-0"
            >
              <Search class="w-4 h-4" />
              <span class="hidden sm:inline">{{ t('landing.domainSearch.searchBtn', 'Search') }}</span>
            </button>
          </div>

          <!-- TLD pills -->
          <div class="mt-4 flex flex-wrap items-center justify-center gap-2">
            <span class="text-xs text-surface-400 dark:text-surface-500">{{ t('landing.domainSearch.popular', 'Popular:') }}</span>
            <button
              v-for="tld in ['.com', '.net', '.org', '.io', '.dev']"
              :key="tld"
              @click="searchQuery = (searchQuery.replace(/\.[a-z]+$/i, '') || searchQuery) + tld"
              class="rounded-full border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 px-3 py-1 text-xs font-medium text-surface-600 dark:text-surface-400 transition-colors hover:border-primary-300 dark:hover:border-primary-700 hover:text-primary-600 dark:hover:text-primary-400"
            >
              {{ tld }}
            </button>
          </div>
        </div>

        <!-- Search results -->
        <div v-if="searching" class="mx-auto mt-8 max-w-2xl">
          <div class="flex items-center justify-center gap-3 py-8">
            <div class="h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
            <span class="text-sm text-surface-500 dark:text-surface-400">{{ t('landing.domainSearch.searching', 'Searching available domains...') }}</span>
          </div>
        </div>

        <div v-else-if="searched && searchResults.length > 0" class="mx-auto mt-8 max-w-2xl">
          <div class="overflow-hidden rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900/80 shadow-lg">
            <div
              v-for="(result, idx) in searchResults.slice(0, 6)"
              :key="result.domain"
              :class="[
                'flex items-center gap-4 px-6 py-4 transition-colors',
                idx > 0 ? 'border-t border-surface-100 dark:border-surface-800' : '',
                result.available ? 'hover:bg-surface-50 dark:hover:bg-surface-800/50' : 'opacity-60',
              ]"
            >
              <div class="flex-1 text-left">
                <span class="text-base font-semibold text-gray-900 dark:text-white">{{ result.domain }}</span>
              </div>
              <div v-if="result.available" class="flex items-center gap-1 text-green-600 dark:text-green-400">
                <Check class="w-4 h-4" />
                <span class="text-xs font-medium">{{ t('landing.domainSearch.available', 'Available') }}</span>
              </div>
              <div v-else class="flex items-center gap-1 text-surface-400">
                <X class="w-4 h-4" />
                <span class="text-xs font-medium">{{ t('landing.domainSearch.taken', 'Taken') }}</span>
              </div>
              <div v-if="result.available && result.price" class="text-right">
                <span class="text-sm font-bold text-gray-900 dark:text-white">{{ formatPrice(result) }}</span>
                <span class="text-xs text-surface-400"> / {{ t('landing.domainSearch.yr', 'yr') }}</span>
                <p class="text-[10px] text-surface-400">{{ t('landing.cart.exclVat', 'Excl. VAT') }}</p>
              </div>
              <button
                v-if="result.available"
                @click="addToCart(result)"
                :disabled="cart.hasDomain(result.domain)"
                :class="[
                  'rounded-lg px-4 py-2 text-sm font-semibold transition-all',
                  cart.hasDomain(result.domain)
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 cursor-default'
                    : 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm hover:shadow-md',
                ]"
              >
                {{ cart.hasDomain(result.domain) ? t('landing.domainSearch.inCart', 'In Cart') : t('landing.domainSearch.addToCart', 'Add to Cart') }}
              </button>
            </div>
          </div>
        </div>

        <div v-else-if="searched && searchResults.length === 0" class="mx-auto mt-8 max-w-2xl">
          <div class="rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900/80 px-6 py-8 text-center">
            <p class="text-sm text-surface-500 dark:text-surface-400">
              {{ t('landing.domainSearch.noResults', 'No domains found. Try a different search term.') }}
            </p>
          </div>
        </div>

        <!-- Scroll indicator -->
        <div class="mt-12 flex justify-center">
          <a href="#how-it-works" class="animate-bounce text-surface-400 dark:text-surface-500 hover:text-primary-500 transition-colors">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </a>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- HOW IT WORKS — 3 steps                                            -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <section id="how-it-works" class="relative py-24 sm:py-32 bg-surface-50 dark:bg-surface-900">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="fade-in text-center">
          <p class="text-sm font-semibold uppercase tracking-widest text-primary-600 dark:text-primary-400">{{ t('landing.howItWorks.label', 'How It Works') }}</p>
          <h2 class="mt-3 text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">
            {{ t('landing.howItWorks.title', 'Get Online in 3 Simple Steps') }}
          </h2>
        </div>

        <div class="mt-16 grid gap-8 sm:grid-cols-3">
          <div
            v-for="(step, idx) in steps"
            :key="idx"
            class="fade-in relative text-center"
          >
            <!-- Step number -->
            <div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-100 dark:bg-primary-900/30">
              <component :is="step.icon" class="w-7 h-7 text-primary-600 dark:text-primary-400" />
            </div>
            <div class="absolute -top-5 left-1/2 -translate-x-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white shadow-lg">
              {{ idx + 1 }}
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ step.title }}</h3>
            <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">{{ step.description }}</p>
            <!-- Connector arrow (except last) -->
            <div v-if="idx < 2" class="hidden sm:block absolute top-8 -right-4 translate-x-1/2 text-surface-300 dark:text-surface-700">
              <ArrowRight class="w-6 h-6" />
            </div>
          </div>
        </div>
      </div>
      <!-- Wave transition — hanging over next section -->
      <div class="pointer-events-none absolute -bottom-[79px] sm:-bottom-[99px] left-0 right-0 z-10">
        <svg viewBox="0 0 1440 100" preserveAspectRatio="none" class="block w-full h-[80px] sm:h-[100px]">
          <path d="M0,0 L1440,0 L1440,50 C1080,0 720,90 360,30 C180,0 60,40 0,45 Z" class="fill-surface-50 dark:fill-surface-900" />
        </svg>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- WHY CHOOSE US — trust signals                                     -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <section id="features" class="relative py-24 sm:py-32 bg-white dark:bg-surface-950">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="fade-in text-center">
          <p class="text-sm font-semibold uppercase tracking-widest text-primary-600 dark:text-primary-400">{{ t('landing.whyChooseUs.label', 'Why Choose Us') }}</p>
          <h2 class="mt-3 text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">
            {{ t('landing.whyChooseUs.title', 'Everything You Need to Succeed Online') }}
          </h2>
          <p class="mx-auto mt-4 max-w-2xl text-lg text-surface-500 dark:text-surface-400">
            {{ t('landing.whyChooseUs.subtitle', 'From domain registration to deployment, we provide a complete hosting solution.') }}
          </p>
        </div>

        <div class="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="(signal, idx) in trustSignals"
            :key="idx"
            class="fade-in group relative overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900/50 p-6 transition-all duration-300 hover:border-primary-500/30 hover:bg-surface-50 dark:hover:bg-surface-850 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary-500/5"
          >
            <div class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <div class="absolute -top-20 -right-20 h-40 w-40 rounded-full bg-primary-500/5 blur-[64px]"></div>
            </div>
            <div class="relative">
              <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary-500/10">
                <component :is="signal.icon" class="w-6 h-6 text-primary-600 dark:text-primary-400" />
              </div>
              <h3 class="mb-2 text-base font-semibold text-gray-900 dark:text-white">{{ signal.title }}</h3>
              <p class="text-sm leading-relaxed text-surface-500 dark:text-surface-400">{{ signal.description }}</p>
            </div>
          </div>
        </div>
      </div>
      <!-- Wave transition — white hanging over pricing -->
      <div class="pointer-events-none absolute -bottom-[79px] sm:-bottom-[99px] left-0 right-0 z-10">
        <svg viewBox="0 0 1440 100" preserveAspectRatio="none" class="block w-full h-[80px] sm:h-[100px]">
          <path d="M0,0 L1440,0 L1440,40 C1080,100 360,0 0,60 Z" class="fill-white dark:fill-surface-950" />
        </svg>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- PRICING                                                           -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <section id="pricing" class="relative py-36 sm:py-44 bg-surface-50 dark:bg-surface-900">
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div class="absolute top-0 left-1/2 h-[400px] w-[800px] -translate-x-1/2 rounded-full bg-primary-600/5 blur-[128px]"></div>
      </div>

      <div class="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="fade-in text-center">
          <p class="text-sm font-semibold uppercase tracking-widest text-primary-600 dark:text-primary-400">{{ t('landing.pricing.label') }}</p>
          <h2 class="mt-3 text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{{ t('landing.pricing.title') }}</h2>
          <p class="mx-auto mt-4 max-w-2xl text-lg text-surface-500 dark:text-surface-400">{{ t('landing.pricing.subtitle') }}</p>
        </div>

        <div class="mt-16 grid gap-8 lg:grid-cols-3">
          <div
            v-for="plan in plans"
            :key="plan.id"
            :class="[
              'fade-in relative overflow-hidden rounded-2xl border p-8 transition-all duration-300 hover:-translate-y-1',
              plan.highlighted
                ? 'border-primary-500/50 bg-white dark:bg-surface-900 shadow-xl shadow-primary-500/10 hover:shadow-2xl hover:shadow-primary-500/20'
                : 'border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900/50 hover:border-surface-300 dark:hover:border-surface-700 hover:shadow-lg',
            ]"
          >
            <div v-if="plan.highlighted" class="absolute top-0 right-0 rounded-bl-xl bg-gradient-to-r from-primary-600 to-primary-500 px-4 py-1 text-xs font-semibold text-white">
              {{ t('landing.pricing.popular') }}
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ plan.name }}</h3>
              <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">{{ plan.description }}</p>
            </div>
            <div class="mt-6">
              <div class="flex items-baseline gap-1">
                <span class="text-4xl font-extrabold text-gray-900 dark:text-white">{{ plan.price }}</span>
                <span class="text-surface-500 dark:text-surface-400">{{ plan.period }}</span>
              </div>
              <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">{{ t('landing.cart.exclVat', 'Excl. VAT') }}</p>
            </div>
            <ul class="mt-8 space-y-3">
              <li v-for="(feat, i) in plan.features" :key="i" class="flex items-center gap-3 text-sm text-surface-600 dark:text-surface-300">
                <svg class="h-5 w-5 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {{ feat }}
              </li>
            </ul>
            <router-link
              :to="`/get-started?plan=${plan.slug || plan.id}`"
              :class="[
                'mt-8 block w-full rounded-xl px-4 py-3 text-center text-sm font-semibold transition-all',
                plan.highlighted
                  ? 'bg-gradient-to-r from-primary-600 to-primary-500 text-white shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:brightness-110'
                  : 'border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 text-surface-600 dark:text-surface-300 hover:border-surface-400 dark:hover:border-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-gray-900 dark:hover:text-white',
              ]"
            >
              {{ plan.isFree ? t('landing.pricing.getStartedFree', 'Start Free') : t('landing.pricing.choosePlan', 'Get Started') }}
            </router-link>
          </div>
        </div>
      </div>
      <!-- Wave transition — hanging over CTA -->
      <div class="pointer-events-none absolute -bottom-[79px] sm:-bottom-[99px] left-0 right-0 z-10">
        <svg viewBox="0 0 1440 100" preserveAspectRatio="none" class="block w-full h-[80px] sm:h-[100px]">
          <path d="M0,0 L1440,0 L1440,35 C1080,95 360,5 0,55 Z" class="fill-surface-50 dark:fill-surface-900" />
        </svg>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- CTA                                                               -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <section class="relative pt-36 pb-24 sm:pt-44 sm:pb-32 bg-white dark:bg-surface-950">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="fade-in relative overflow-hidden rounded-2xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50">
          <div class="pointer-events-none absolute inset-0">
            <div class="absolute -top-20 -right-20 h-[300px] w-[300px] rounded-full bg-primary-600/10 blur-[96px]"></div>
            <div class="absolute -bottom-20 -left-20 h-[300px] w-[300px] rounded-full bg-primary-800/10 blur-[96px]"></div>
          </div>
          <div class="relative px-8 py-16 text-center sm:px-16 sm:py-24">
            <h2 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">
              {{ t('landing.cta.title') }}
            </h2>
            <p class="mx-auto mt-4 max-w-xl text-lg text-surface-500 dark:text-surface-400">
              {{ t('landing.cta.subtitle') }}
            </p>
            <div class="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <router-link
                to="/get-started"
                class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 px-8 py-3.5 text-base font-semibold text-white shadow-xl shadow-primary-500/25 transition-all hover:shadow-primary-500/40 hover:brightness-110"
              >
                {{ t('landing.cta.getStarted') }}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </router-link>
              <a
                v-if="brandGithubUrl"
                :href="brandGithubUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-2 text-base font-semibold text-surface-500 dark:text-surface-400 transition-colors hover:text-gray-900 dark:hover:text-white"
              >
                {{ t('landing.cta.starOnGithub') }}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>

    <LandingFooter />
  </div>
</template>

<style scoped>
.fade-in {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.6s ease-out, transform 0.6s ease-out;
}

.fade-in.visible {
  opacity: 1;
  transform: translateY(0);
}
</style>
