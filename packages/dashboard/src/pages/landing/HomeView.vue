<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import LandingNavbar from '@/components/landing/LandingNavbar.vue'
import type { NavLink } from '@/components/landing/LandingNavbar.vue'
import LandingFooter from '@/components/landing/LandingFooter.vue'

const { t } = useI18n()

const demoBanner = ref<HTMLElement | null>(null)
const bannerHeight = ref(36)

onMounted(async () => {
  // Fetch dynamic plans from API
  try {
    const res = await fetch('/api/v1/billing/public/plans')
    if (res.ok) {
      const data = await res.json()
      if (data.plans?.length) {
        apiPlans.value = data.plans
      }
    }
  } catch {
    // Fall back to hardcoded plans
  } finally {
    plansLoaded.value = true
  }

  // Measure demo banner and set CSS variable for navbar offset
  nextTick(() => {
    if (demoBanner.value) {
      const h = demoBanner.value.offsetHeight
      bannerHeight.value = h
      document.documentElement.style.setProperty('--banner-height', `${h}px`)
    }
  })

  // Intersection Observer for fade-in animations
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible')
        }
      })
    },
    { threshold: 0.1 }
  )

  document.querySelectorAll('.fade-in').forEach((el) => observer.observe(el))

  onUnmounted(() => {
    observer.disconnect()
    document.documentElement.style.removeProperty('--banner-height')
  })
})

const features = computed(() => [
  {
    id: 'docker-swarm',
    icon: '&#x2699;&#xFE0F;',
    title: t('landing.features.dockerSwarm.title'),
    description: t('landing.features.dockerSwarm.description'),
  },
  {
    id: 'multi-tenant',
    icon: '&#x1F3E2;',
    title: t('landing.features.multiTenant.title'),
    description: t('landing.features.multiTenant.description'),
  },
  {
    id: 'billing',
    icon: '&#x1F4B3;',
    title: t('landing.features.billing.title'),
    description: t('landing.features.billing.description'),
  },
  {
    id: 'domains',
    icon: '&#x1F310;',
    title: t('landing.features.domains.title'),
    description: t('landing.features.domains.description'),
  },
  {
    id: 'ssh',
    icon: '&#x1F5A5;&#xFE0F;',
    title: t('landing.features.ssh.title'),
    description: t('landing.features.ssh.description'),
  },
  {
    id: 'backups',
    icon: '&#x1F4BE;',
    title: t('landing.features.backups.title'),
    description: t('landing.features.backups.description'),
  },
  {
    id: 'marketplace',
    icon: '&#x1F6D2;',
    title: t('landing.features.marketplace.title'),
    description: t('landing.features.marketplace.description'),
  },
  {
    id: 'monitoring',
    icon: '&#x1F4CA;',
    title: t('landing.features.monitoring.title'),
    description: t('landing.features.monitoring.description'),
  },
])

// Dynamic plans from API (with hardcoded fallback)
interface ApiPlan {
  id: string
  name: string
  slug: string
  description: string | null
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
    price: '$0',
    period: t('landing.pricing.perMonth'),
    description: t('landing.pricing.plans.free.description'),
    features: [
      t('landing.pricing.plans.free.f1'),
      t('landing.pricing.plans.free.f2'),
      t('landing.pricing.plans.free.f3'),
      t('landing.pricing.plans.free.f4'),
      t('landing.pricing.plans.free.f5'),
    ],
    highlighted: false,
  },
  {
    id: 'starter',
    slug: 'starter',
    name: t('landing.pricing.plans.starter.name'),
    price: '$10',
    period: t('landing.pricing.perMonth'),
    description: t('landing.pricing.plans.starter.description'),
    features: [
      t('landing.pricing.plans.starter.f1'),
      t('landing.pricing.plans.starter.f2'),
      t('landing.pricing.plans.starter.f3'),
      t('landing.pricing.plans.starter.f4'),
      t('landing.pricing.plans.starter.f5'),
    ],
    highlighted: true,
  },
  {
    id: 'pro',
    slug: 'pro',
    name: t('landing.pricing.plans.pro.name'),
    price: '$25',
    period: t('landing.pricing.perMonth'),
    description: t('landing.pricing.plans.pro.description'),
    features: [
      t('landing.pricing.plans.pro.f1'),
      t('landing.pricing.plans.pro.f2'),
      t('landing.pricing.plans.pro.f3'),
      t('landing.pricing.plans.pro.f4'),
      t('landing.pricing.plans.pro.f5'),
    ],
    highlighted: false,
  },
])

function formatCents(cents: number): string {
  if (cents === 0) return '$0'
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

function formatMemory(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)}GB` : `${mb}MB`
}

function formatLimit(val: number, suffix: string): string {
  return val === -1 ? `Unlimited ${suffix}` : `${val} ${suffix}`
}

const plans = computed(() => {
  if (!plansLoaded.value || !apiPlans.value.length) return fallbackPlans.value

  return apiPlans.value.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    price: formatCents(p.priceCents),
    period: t('landing.pricing.perMonth'),
    description: p.description || '',
    features: [
      formatLimit(p.containerLimit, 'services'),
      `${formatMemory(p.memoryLimit)} RAM`,
      formatLimit(p.cpuLimit, 'CPU cores'),
      `${p.storageLimit === -1 ? 'Unlimited' : p.storageLimit + 'GB'} storage`,
    ],
    highlighted: p.isDefault && !p.isFree,
  }))
})

const navLinks = computed<NavLink[]>(() => [
  { label: t('landing.nav.features'), href: '#features' },
  { label: t('landing.nav.pricing'), href: '#pricing' },
  { label: 'Docs', href: '/docs', routerLink: true },
  { label: 'API', href: '/api/docs', external: true },
  { label: t('landing.nav.github'), href: 'https://github.com/fleet', external: true },
])
</script>

<template>
  <div class="min-h-screen bg-white dark:bg-surface-950 text-surface-700 dark:text-surface-200">
    <!-- Demo Banner (fixed) + spacer -->
    <div ref="demoBanner" class="fixed top-0 left-0 right-0 z-[60] bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 shadow-sm">
      <div class="flex items-center justify-center gap-2 py-2 px-4">
        <svg class="h-4 w-4 text-amber-900 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span class="text-sm font-semibold text-amber-950 tracking-wide">{{ $t('landing.demo.banner') }}</span>
      </div>
    </div>
    <div :style="{ height: bannerHeight + 'px' }"></div>

    <LandingNavbar :nav-links="navLinks" />

    <!-- Hero Section -->
    <section class="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-32">
      <!-- Background gradient effects -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div class="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary-600/10 dark:bg-primary-600/20 blur-[128px]"></div>
        <div class="absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full bg-primary-800/10 dark:bg-primary-800/20 blur-[128px]"></div>
        <div class="absolute top-1/2 left-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-700/5 dark:bg-primary-700/10 blur-[128px]"></div>
      </div>

      <!-- Grid pattern overlay -->
      <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px]"></div>

      <div class="relative mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
        <!-- Badge -->
        <div class="mb-8 inline-flex items-center gap-2 rounded-full border border-primary-500/20 bg-primary-500/10 px-4 py-1.5 text-sm text-primary-700 dark:text-primary-300">
          <span class="relative flex h-2 w-2">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75"></span>
            <span class="relative inline-flex h-2 w-2 rounded-full bg-primary-500"></span>
          </span>
          {{ $t('landing.hero.badge') }}
        </div>

        <h1 class="mx-auto max-w-4xl text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white sm:text-6xl lg:text-7xl">
          {{ $t('landing.hero.deployManage') }}
          <span class="animate-gradient bg-[length:200%_auto] bg-gradient-to-r from-primary-600 via-blue-500 to-primary-600 dark:from-primary-400 dark:via-blue-400 dark:to-primary-400 bg-clip-text text-transparent">
            {{ $t('landing.hero.dockerServices') }}
          </span>
          {{ $t('landing.hero.atScale') }}
        </h1>

        <p class="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-surface-500 dark:text-surface-400 sm:text-xl">
          {{ $t('landing.hero.subtitle') }}
        </p>

        <div class="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <router-link
            to="/get-started"
            class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 px-8 py-3.5 text-base font-semibold text-white shadow-xl shadow-primary-500/25 transition-all hover:shadow-primary-500/40 hover:brightness-110"
          >
            {{ $t('landing.hero.getStarted') }}
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </router-link>
          <a
            href="https://github.com/fleet"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white/50 dark:bg-surface-900/50 px-8 py-3.5 text-base font-semibold text-surface-600 dark:text-surface-300 transition-all hover:border-surface-400 dark:hover:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800/50 hover:text-gray-900 dark:hover:text-white"
          >
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            {{ $t('landing.hero.viewOnGithub') }}
          </a>
        </div>

        <!-- Terminal preview (always dark) -->
        <div class="fade-in mx-auto mt-16 max-w-3xl">
          <div class="overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-900/80 shadow-2xl shadow-black/20 dark:shadow-black/50">
            <div class="flex items-center gap-2 border-b border-surface-800 bg-surface-900 px-4 py-3">
              <div class="h-3 w-3 rounded-full bg-red-500/80"></div>
              <div class="h-3 w-3 rounded-full bg-yellow-500/80"></div>
              <div class="h-3 w-3 rounded-full bg-green-500/80"></div>
              <span class="ml-2 text-xs text-surface-500">{{ $t('landing.terminal.title') }}</span>
            </div>
            <div class="p-6 font-mono text-sm leading-normal text-left space-y-0">
              <div class="terminal-line" style="animation-delay: 0.3s"><span class="text-green-400">$</span> <span class="text-surface-300">{{ $t('landing.terminal.command') }}</span></div>
              <div class="terminal-line" style="animation-delay: 0.9s"><span class="text-green-400">&#x2713; {{ $t('landing.terminal.success') }}</span></div>
              <div class="terminal-line" style="animation-delay: 1.5s"><span class="text-white font-bold">  {{ $t('landing.terminal.labelName') }}     </span><span class="text-surface-400">{{ $t('landing.terminal.valueName') }}</span></div>
              <div class="terminal-line" style="animation-delay: 2.0s"><span class="text-white font-bold">  {{ $t('landing.terminal.labelReplicas') }} </span><span class="text-surface-400">{{ $t('landing.terminal.valueReplicas') }}</span></div>
              <div class="terminal-line cursor-blink" style="animation-delay: 2.5s"><span class="text-white font-bold">  {{ $t('landing.terminal.labelUrl') }}      </span><span class="text-cyan-400">{{ $t('landing.terminal.valueUrl') }}</span></div>
            </div>
          </div>
        </div>

        <!-- Scroll indicator -->
        <div class="mt-10 flex justify-center">
          <a href="#features" class="animate-bounce text-surface-400 dark:text-surface-500 hover:text-primary-500 transition-colors">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </a>
        </div>
      </div>
    </section>

    <!-- Features Section -->
    <section id="features" class="relative py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="fade-in text-center">
          <p class="text-sm font-semibold uppercase tracking-widest text-primary-600 dark:text-primary-400">{{ $t('landing.features.label') }}</p>
          <h2 class="mt-3 text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">
            {{ $t('landing.features.title') }}
          </h2>
          <p class="mx-auto mt-4 max-w-2xl text-lg text-surface-500 dark:text-surface-400">
            {{ $t('landing.features.subtitle') }}
          </p>
        </div>

        <div class="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div
            v-for="(feature, index) in features"
            :key="feature.id"
            class="fade-in group relative overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900/50 p-6 transition-all duration-300 hover:border-primary-500/30 hover:bg-surface-50 dark:hover:bg-surface-850 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary-500/5"
            :style="{ transitionDelay: `${index * 50}ms` }"
          >
            <!-- Hover glow -->
            <div class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <div class="absolute -top-20 -right-20 h-40 w-40 rounded-full bg-primary-500/5 blur-[64px]"></div>
            </div>

            <div class="relative">
              <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary-500/10 text-2xl" v-html="feature.icon">
              </div>
              <h3 class="mb-2 text-base font-semibold text-gray-900 dark:text-white">{{ feature.title }}</h3>
              <p class="text-sm leading-relaxed text-surface-500 dark:text-surface-400">{{ feature.description }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Pricing Section -->
    <section id="pricing" class="relative py-24 sm:py-32">
      <!-- Background accent -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div class="absolute top-0 left-1/2 h-[400px] w-[800px] -translate-x-1/2 rounded-full bg-primary-600/5 blur-[128px]"></div>
      </div>

      <div class="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="fade-in text-center">
          <p class="text-sm font-semibold uppercase tracking-widest text-primary-600 dark:text-primary-400">{{ $t('landing.pricing.label') }}</p>
          <h2 class="mt-3 text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">
            {{ $t('landing.pricing.title') }}
          </h2>
          <p class="mx-auto mt-4 max-w-2xl text-lg text-surface-500 dark:text-surface-400">
            {{ $t('landing.pricing.subtitle') }}
          </p>
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
            <!-- Popular badge -->
            <div
              v-if="plan.highlighted"
              class="absolute top-0 right-0 rounded-bl-xl bg-gradient-to-r from-primary-600 to-primary-500 px-4 py-1 text-xs font-semibold text-white"
            >
              {{ $t('landing.pricing.popular') }}
            </div>

            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ plan.name }}</h3>
              <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">{{ plan.description }}</p>
            </div>

            <div class="mt-6 flex items-baseline gap-1">
              <span class="text-4xl font-extrabold text-gray-900 dark:text-white">{{ plan.price }}</span>
              <span class="text-surface-500 dark:text-surface-400">{{ plan.period }}</span>
            </div>

            <ul class="mt-8 space-y-3">
              <li
                v-for="(feat, i) in plan.features"
                :key="i"
                class="flex items-center gap-3 text-sm text-surface-600 dark:text-surface-300"
              >
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
              {{ $t('landing.pricing.getStarted') }}
            </router-link>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA Section -->
    <section class="relative py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="fade-in relative overflow-hidden rounded-2xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50">
          <!-- Background -->
          <div class="pointer-events-none absolute inset-0">
            <div class="absolute -top-20 -right-20 h-[300px] w-[300px] rounded-full bg-primary-600/10 blur-[96px]"></div>
            <div class="absolute -bottom-20 -left-20 h-[300px] w-[300px] rounded-full bg-primary-800/10 blur-[96px]"></div>
          </div>

          <div class="relative px-8 py-16 text-center sm:px-16 sm:py-24">
            <h2 class="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">
              {{ $t('landing.cta.title') }}
            </h2>
            <p class="mx-auto mt-4 max-w-xl text-lg text-surface-500 dark:text-surface-400">
              {{ $t('landing.cta.subtitle') }}
            </p>
            <div class="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <router-link
                to="/get-started"
                class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 px-8 py-3.5 text-base font-semibold text-white shadow-xl shadow-primary-500/25 transition-all hover:shadow-primary-500/40 hover:brightness-110"
              >
                {{ $t('landing.cta.getStarted') }}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </router-link>
              <a
                href="https://github.com/fleet"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-2 text-base font-semibold text-surface-500 dark:text-surface-400 transition-colors hover:text-gray-900 dark:hover:text-white"
              >
                {{ $t('landing.cta.starOnGithub') }}
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
