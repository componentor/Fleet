<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()

const dashboardUrl = import.meta.env.VITE_DASHBOARD_URL || 'http://localhost:5173'

const isScrolled = ref(false)
const mobileMenuOpen = ref(false)

function handleScroll() {
  isScrolled.value = window.scrollY > 20
}

function changeLocale(newLocale: string) {
  locale.value = newLocale
  localStorage.setItem('fleet_locale', newLocale)
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll)

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
    window.removeEventListener('scroll', handleScroll)
    observer.disconnect()
  })
})

const features = computed(() => [
  {
    icon: '&#x2699;&#xFE0F;',
    title: t('features.dockerSwarm.title'),
    description: t('features.dockerSwarm.description'),
  },
  {
    icon: '&#x1F3E2;',
    title: t('features.multiTenant.title'),
    description: t('features.multiTenant.description'),
  },
  {
    icon: '&#x1F4B3;',
    title: t('features.billing.title'),
    description: t('features.billing.description'),
  },
  {
    icon: '&#x1F310;',
    title: t('features.domains.title'),
    description: t('features.domains.description'),
  },
  {
    icon: '&#x1F5A5;&#xFE0F;',
    title: t('features.ssh.title'),
    description: t('features.ssh.description'),
  },
  {
    icon: '&#x1F4BE;',
    title: t('features.backups.title'),
    description: t('features.backups.description'),
  },
  {
    icon: '&#x1F6D2;',
    title: t('features.marketplace.title'),
    description: t('features.marketplace.description'),
  },
  {
    icon: '&#x1F4CA;',
    title: t('features.monitoring.title'),
    description: t('features.monitoring.description'),
  },
])

const plans = computed(() => [
  {
    id: 'free',
    name: t('pricing.plans.free.name'),
    price: '$0',
    period: t('pricing.perMonth'),
    description: t('pricing.plans.free.description'),
    features: [
      t('pricing.plans.free.f1'),
      t('pricing.plans.free.f2'),
      t('pricing.plans.free.f3'),
      t('pricing.plans.free.f4'),
      t('pricing.plans.free.f5'),
    ],
    highlighted: false,
  },
  {
    id: 'starter',
    name: t('pricing.plans.starter.name'),
    price: '$10',
    period: t('pricing.perMonth'),
    description: t('pricing.plans.starter.description'),
    features: [
      t('pricing.plans.starter.f1'),
      t('pricing.plans.starter.f2'),
      t('pricing.plans.starter.f3'),
      t('pricing.plans.starter.f4'),
      t('pricing.plans.starter.f5'),
    ],
    highlighted: true,
  },
  {
    id: 'pro',
    name: t('pricing.plans.pro.name'),
    price: '$25',
    period: t('pricing.perMonth'),
    description: t('pricing.plans.pro.description'),
    features: [
      t('pricing.plans.pro.f1'),
      t('pricing.plans.pro.f2'),
      t('pricing.plans.pro.f3'),
      t('pricing.plans.pro.f4'),
      t('pricing.plans.pro.f5'),
    ],
    highlighted: false,
  },
])

const navLinks = computed(() => [
  { label: t('nav.features'), href: '#features' },
  { label: t('nav.pricing'), href: '#pricing' },
  { label: t('nav.github'), href: 'https://github.com/fleet', external: true },
])
</script>

<template>
  <div class="min-h-screen bg-surface-950 text-surface-200">
    <!-- Navbar -->
    <nav
      :class="[
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b',
        isScrolled
          ? 'bg-surface-950/80 backdrop-blur-xl border-surface-800/50'
          : 'bg-transparent border-transparent',
      ]"
    >
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="flex h-16 items-center justify-between">
          <!-- Logo -->
          <a href="/" class="flex items-center gap-2">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700">
              <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span class="text-xl font-bold text-white">Fleet</span>
          </a>

          <!-- Desktop nav links -->
          <div class="hidden items-center gap-8 md:flex">
            <a
              v-for="link in navLinks"
              :key="link.label"
              :href="link.href"
              :target="link.external ? '_blank' : undefined"
              :rel="link.external ? 'noopener noreferrer' : undefined"
              class="text-sm font-medium text-surface-400 transition-colors hover:text-white"
            >
              {{ link.label }}
            </a>
            <select
              :value="locale"
              @change="changeLocale(($event.target as HTMLSelectElement).value)"
              class="bg-transparent text-sm font-medium text-surface-400 transition-colors hover:text-white cursor-pointer outline-none"
            >
              <option value="en" class="bg-surface-900 text-surface-200">EN</option>
              <option value="nb" class="bg-surface-900 text-surface-200">NO</option>
              <option value="de" class="bg-surface-900 text-surface-200">DE</option>
              <option value="zh" class="bg-surface-900 text-surface-200">中文</option>
            </select>
            <a
              :href="dashboardUrl + '/register'"
              class="rounded-lg bg-gradient-to-r from-primary-600 to-primary-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition-all hover:shadow-primary-500/40 hover:brightness-110"
            >
              {{ $t('nav.getStarted') }}
            </a>
          </div>

          <!-- Mobile menu button -->
          <button
            class="inline-flex items-center justify-center rounded-lg p-2 text-surface-400 hover:text-white md:hidden"
            @click="mobileMenuOpen = !mobileMenuOpen"
          >
            <svg v-if="!mobileMenuOpen" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <svg v-else class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Mobile menu -->
        <div
          v-if="mobileMenuOpen"
          class="border-t border-surface-800/50 pb-4 pt-2 md:hidden"
        >
          <a
            v-for="link in navLinks"
            :key="link.label"
            :href="link.href"
            :target="link.external ? '_blank' : undefined"
            :rel="link.external ? 'noopener noreferrer' : undefined"
            class="block rounded-lg px-3 py-2 text-sm font-medium text-surface-400 transition-colors hover:bg-surface-800 hover:text-white"
            @click="mobileMenuOpen = false"
          >
            {{ link.label }}
          </a>
          <select
            :value="locale"
            @change="changeLocale(($event.target as HTMLSelectElement).value)"
            class="block w-full rounded-lg px-3 py-2 text-sm font-medium text-surface-400 bg-transparent transition-colors hover:bg-surface-800 hover:text-white cursor-pointer outline-none"
          >
            <option value="en" class="bg-surface-900 text-surface-200">English</option>
            <option value="nb" class="bg-surface-900 text-surface-200">Norsk</option>
            <option value="de" class="bg-surface-900 text-surface-200">Deutsch</option>
            <option value="zh" class="bg-surface-900 text-surface-200">中文</option>
          </select>
          <a
            :href="dashboardUrl + '/register'"
            class="mt-2 block rounded-lg bg-gradient-to-r from-primary-600 to-primary-500 px-3 py-2 text-center text-sm font-semibold text-white"
            @click="mobileMenuOpen = false"
          >
            {{ $t('nav.getStarted') }}
          </a>
        </div>
      </div>
    </nav>

    <!-- Hero Section -->
    <section class="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-32">
      <!-- Background gradient effects -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div class="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary-600/20 blur-[128px]"></div>
        <div class="absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full bg-primary-800/20 blur-[128px]"></div>
        <div class="absolute top-1/2 left-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-700/10 blur-[128px]"></div>
      </div>

      <!-- Grid pattern overlay -->
      <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px]"></div>

      <div class="relative mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
        <!-- Badge -->
        <div class="mb-8 inline-flex items-center gap-2 rounded-full border border-primary-500/20 bg-primary-500/10 px-4 py-1.5 text-sm text-primary-300">
          <span class="relative flex h-2 w-2">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75"></span>
            <span class="relative inline-flex h-2 w-2 rounded-full bg-primary-500"></span>
          </span>
          {{ $t('hero.badge') }}
        </div>

        <h1 class="mx-auto max-w-4xl text-4xl font-extrabold tracking-tight text-white sm:text-6xl lg:text-7xl">
          {{ $t('hero.deployManage') }}
          <span class="bg-gradient-to-r from-primary-400 via-primary-300 to-blue-400 bg-clip-text text-transparent">
            {{ $t('hero.dockerServices') }}
          </span>
          {{ $t('hero.atScale') }}
        </h1>

        <p class="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-surface-400 sm:text-xl">
          {{ $t('hero.subtitle') }}
        </p>

        <div class="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            :href="dashboardUrl + '/register'"
            class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 px-8 py-3.5 text-base font-semibold text-white shadow-xl shadow-primary-500/25 transition-all hover:shadow-primary-500/40 hover:brightness-110"
          >
            {{ $t('hero.getStarted') }}
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </a>
          <a
            href="https://github.com/fleet"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 rounded-xl border border-surface-700 bg-surface-900/50 px-8 py-3.5 text-base font-semibold text-surface-300 transition-all hover:border-surface-600 hover:bg-surface-800/50 hover:text-white"
          >
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            {{ $t('hero.viewOnGithub') }}
          </a>
        </div>

        <!-- Terminal preview -->
        <div class="fade-in mx-auto mt-16 max-w-3xl">
          <div class="overflow-hidden rounded-xl border border-surface-800 bg-surface-900/80 shadow-2xl shadow-black/50">
            <div class="flex items-center gap-2 border-b border-surface-800 bg-surface-900 px-4 py-3">
              <div class="h-3 w-3 rounded-full bg-red-500/80"></div>
              <div class="h-3 w-3 rounded-full bg-yellow-500/80"></div>
              <div class="h-3 w-3 rounded-full bg-green-500/80"></div>
              <span class="ml-2 text-xs text-surface-500">{{ $t('terminal.title') }}</span>
            </div>
            <div class="p-6 font-mono text-sm leading-relaxed">
              <p><span class="text-green-400">$</span> <span class="text-surface-300">{{ $t('terminal.command') }}</span></p>
              <p class="mt-2 text-surface-500">{{ $t('terminal.deploying') }}</p>
              <p class="text-surface-500">{{ $t('terminal.building') }}</p>
              <p class="text-surface-500">{{ $t('terminal.pushing') }}</p>
              <p class="text-surface-500">{{ $t('terminal.updating') }}</p>
              <p class="mt-2 text-green-400">&#x2713; {{ $t('terminal.success') }}</p>
              <p class="text-surface-500">&#x2192; {{ $t('terminal.url') }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Features Section -->
    <section id="features" class="relative py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="fade-in text-center">
          <p class="text-sm font-semibold uppercase tracking-widest text-primary-400">{{ $t('features.label') }}</p>
          <h2 class="mt-3 text-3xl font-bold text-white sm:text-4xl">
            {{ $t('features.title') }}
          </h2>
          <p class="mx-auto mt-4 max-w-2xl text-lg text-surface-400">
            {{ $t('features.subtitle') }}
          </p>
        </div>

        <div class="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div
            v-for="(feature, index) in features"
            :key="feature.title"
            class="fade-in group relative overflow-hidden rounded-xl border border-surface-800 bg-surface-900/50 p-6 transition-all duration-300 hover:border-primary-500/30 hover:bg-surface-850"
            :style="{ transitionDelay: `${index * 50}ms` }"
          >
            <!-- Hover glow -->
            <div class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <div class="absolute -top-20 -right-20 h-40 w-40 rounded-full bg-primary-500/5 blur-[64px]"></div>
            </div>

            <div class="relative">
              <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary-500/10 text-2xl" v-html="feature.icon">
              </div>
              <h3 class="mb-2 text-base font-semibold text-white">{{ feature.title }}</h3>
              <p class="text-sm leading-relaxed text-surface-400">{{ feature.description }}</p>
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
          <p class="text-sm font-semibold uppercase tracking-widest text-primary-400">{{ $t('pricing.label') }}</p>
          <h2 class="mt-3 text-3xl font-bold text-white sm:text-4xl">
            {{ $t('pricing.title') }}
          </h2>
          <p class="mx-auto mt-4 max-w-2xl text-lg text-surface-400">
            {{ $t('pricing.subtitle') }}
          </p>
        </div>

        <div class="mt-16 grid gap-8 lg:grid-cols-3">
          <div
            v-for="plan in plans"
            :key="plan.id"
            :class="[
              'fade-in relative overflow-hidden rounded-2xl border p-8 transition-all duration-300',
              plan.highlighted
                ? 'border-primary-500/50 bg-surface-900 shadow-xl shadow-primary-500/10'
                : 'border-surface-800 bg-surface-900/50 hover:border-surface-700',
            ]"
          >
            <!-- Popular badge -->
            <div
              v-if="plan.highlighted"
              class="absolute top-0 right-0 rounded-bl-xl bg-gradient-to-r from-primary-600 to-primary-500 px-4 py-1 text-xs font-semibold text-white"
            >
              {{ $t('pricing.popular') }}
            </div>

            <div>
              <h3 class="text-lg font-semibold text-white">{{ plan.name }}</h3>
              <p class="mt-1 text-sm text-surface-400">{{ plan.description }}</p>
            </div>

            <div class="mt-6 flex items-baseline gap-1">
              <span class="text-4xl font-extrabold text-white">{{ plan.price }}</span>
              <span class="text-surface-400">{{ plan.period }}</span>
            </div>

            <ul class="mt-8 space-y-3">
              <li
                v-for="(feat, i) in plan.features"
                :key="i"
                class="flex items-center gap-3 text-sm text-surface-300"
              >
                <svg class="h-5 w-5 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {{ feat }}
              </li>
            </ul>

            <a
              :href="dashboardUrl + '/register'"
              :class="[
                'mt-8 block w-full rounded-xl px-4 py-3 text-center text-sm font-semibold transition-all',
                plan.highlighted
                  ? 'bg-gradient-to-r from-primary-600 to-primary-500 text-white shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:brightness-110'
                  : 'border border-surface-700 bg-surface-800/50 text-surface-300 hover:border-surface-600 hover:bg-surface-800 hover:text-white',
              ]"
            >
              {{ $t('pricing.getStarted') }}
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA Section -->
    <section class="relative py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="fade-in relative overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/50">
          <!-- Background -->
          <div class="pointer-events-none absolute inset-0">
            <div class="absolute -top-20 -right-20 h-[300px] w-[300px] rounded-full bg-primary-600/10 blur-[96px]"></div>
            <div class="absolute -bottom-20 -left-20 h-[300px] w-[300px] rounded-full bg-primary-800/10 blur-[96px]"></div>
          </div>

          <div class="relative px-8 py-16 text-center sm:px-16 sm:py-24">
            <h2 class="text-3xl font-bold text-white sm:text-4xl">
              {{ $t('cta.title') }}
            </h2>
            <p class="mx-auto mt-4 max-w-xl text-lg text-surface-400">
              {{ $t('cta.subtitle') }}
            </p>
            <div class="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                :href="dashboardUrl + '/register'"
                class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 px-8 py-3.5 text-base font-semibold text-white shadow-xl shadow-primary-500/25 transition-all hover:shadow-primary-500/40 hover:brightness-110"
              >
                {{ $t('cta.getStarted') }}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
              <a
                href="https://github.com/fleet"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-2 text-base font-semibold text-surface-400 transition-colors hover:text-white"
              >
                {{ $t('cta.starOnGithub') }}
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="border-t border-surface-800/50 py-12">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="flex flex-col items-center justify-between gap-8 md:flex-row">
          <!-- Branding -->
          <div class="flex flex-col items-center gap-2 md:items-start">
            <div class="flex items-center gap-2">
              <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700">
                <svg class="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span class="text-lg font-bold text-white">Fleet</span>
            </div>
            <p class="text-sm text-surface-500">{{ $t('footer.builtWith') }}</p>
          </div>

          <!-- Links -->
          <div class="flex items-center gap-8">
            <a
              href="https://github.com/fleet"
              target="_blank"
              rel="noopener noreferrer"
              class="text-sm text-surface-400 transition-colors hover:text-white"
            >
              {{ $t('footer.github') }}
            </a>
            <a
              href="#"
              class="text-sm text-surface-400 transition-colors hover:text-white"
            >
              {{ $t('footer.docs') }}
            </a>
            <a
              href="#"
              class="text-sm text-surface-400 transition-colors hover:text-white"
            >
              {{ $t('footer.discord') }}
            </a>
          </div>

          <!-- Copyright -->
          <p class="text-sm text-surface-500">
            &copy; {{ new Date().getFullYear() }} {{ $t('footer.rights') }}
          </p>
        </div>
      </div>
    </footer>
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
