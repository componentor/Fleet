<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ShoppingBasket } from 'lucide-vue-next'
import { useTheme } from '@/composables/useTheme'
import { useBranding } from '@/composables/useBranding'
import { useAuthStore } from '@/stores/auth'

export interface NavLink {
  label: string
  href: string
  external?: boolean
  routerLink?: boolean
}

const props = withDefaults(defineProps<{
  navLinks: NavLink[]
  showLocaleSwitcher?: boolean
  showGetStarted?: boolean
  cartCount?: number
}>(), {
  showLocaleSwitcher: true,
  showGetStarted: true,
  cartCount: 0,
})

const emit = defineEmits<{
  (e: 'open-cart'): void
}>()

const { locale, t } = useI18n()
const { theme, toggle } = useTheme()
const { brandTitle, logoSrc } = useBranding()
const authStore = useAuthStore()
const isLoggedIn = computed(() => authStore.isAuthenticated)

const isScrolled = ref(false)
const mobileMenuOpen = ref(false)
const localeOpen = ref(false)
const navRef = ref<HTMLElement | null>(null)
const localeRef = ref<HTMLElement | null>(null)

const locales = [
  {
    code: 'en',
    label: 'English',
    flagSvg: '<svg width="100%" height="100%" viewBox="0 0 60 30" preserveAspectRatio="none"><rect width="60" height="30" fill="#012169"/><path d="m0 0 60 30M60 0 0 30" stroke="#fff" stroke-width="6"/><path d="m0 0 60 30M60 0 0 30" stroke="#C8102E" stroke-width="2"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></svg>',
  },
  {
    code: 'nb',
    label: 'Norsk',
    flagSvg: '<svg width="100%" height="100%" viewBox="0 0 22 16" preserveAspectRatio="none"><rect width="22" height="16" fill="#BA0C2F"/><path d="M8 0v16M0 8h22" stroke="#fff" stroke-width="4"/><path d="M8 0v16M0 8h22" stroke="#002868" stroke-width="2"/></svg>',
  },
  {
    code: 'de',
    label: 'Deutsch',
    flagSvg: '<svg width="100%" height="100%" viewBox="0 0 5 3" preserveAspectRatio="none"><rect width="5" height="1" fill="#000"/><rect y="1" width="5" height="1" fill="#D00"/><rect y="2" width="5" height="1" fill="#FFCE00"/></svg>',
  },
  {
    code: 'zh',
    label: '中文',
    flagSvg: '<svg width="100%" height="100%" viewBox="0 0 30 20" preserveAspectRatio="none"><rect width="30" height="20" fill="#DE2910"/><polygon fill="#FFDE00" points="5,1 6,3.5 8.5,3.5 6.5,5.2 7.3,7.7 5,6 2.7,7.7 3.5,5.2 1.5,3.5 4,3.5"/></svg>',
  },
]

const currentLocale = computed(() => locales.find(l => l.code === locale.value) || locales[0]!)

function handleScroll() {
  isScrolled.value = window.scrollY > 20
}

function handleClickOutside(e: MouseEvent) {
  if (mobileMenuOpen.value && navRef.value && !navRef.value.contains(e.target as Node)) {
    mobileMenuOpen.value = false
  }
  if (localeOpen.value && localeRef.value && !localeRef.value.contains(e.target as Node)) {
    localeOpen.value = false
  }
}

function changeLocale(newLocale: string) {
  locale.value = newLocale
  localStorage.setItem('fleet_locale', newLocale)
  localeOpen.value = false
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll)
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <nav
    ref="navRef"
    :class="[
      'fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b pt-[env(safe-area-inset-top)]',
      isScrolled
        ? 'bg-white/60 dark:bg-surface-950/60 backdrop-blur-xl border-surface-200/50 dark:border-surface-800/50 nav-scrolled'
        : 'bg-transparent border-transparent nav-transparent',
    ]"
  >
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="flex h-16 items-center justify-between">
        <!-- Logo -->
        <router-link to="/" class="flex items-center gap-2">
          <img
            v-if="logoSrc()"
            :src="logoSrc()!"
            :alt="brandTitle"
            class="h-8 w-auto max-w-[140px] rounded-lg object-contain"
          />
          <div v-else class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700">
            <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span :class="['text-xl font-medium transition-colors', isScrolled ? 'text-gray-900 dark:text-white' : 'text-white']">{{ brandTitle }}</span>
        </router-link>

        <!-- Desktop nav links -->
        <div class="hidden items-center gap-8 md:flex">
          <template v-for="link in navLinks" :key="link.label">
            <router-link
              v-if="link.routerLink"
              :to="link.href"
              :class="['text-sm font-medium transition-colors', isScrolled ? 'text-surface-500 dark:text-surface-400 hover:text-gray-900 dark:hover:text-white' : 'text-white/70 hover:text-white']"
            >
              {{ link.label }}
            </router-link>
            <a
              v-else
              :href="link.href"
              :target="link.external ? '_blank' : undefined"
              :rel="link.external ? 'noopener noreferrer' : undefined"
              :class="['text-sm font-medium transition-colors', isScrolled ? 'text-surface-500 dark:text-surface-400 hover:text-gray-900 dark:hover:text-white' : 'text-white/70 hover:text-white']"
            >
              {{ link.label }}
            </a>
          </template>
          <!-- Locale switcher -->
          <div v-if="showLocaleSwitcher" ref="localeRef" class="relative">
            <button
              @click.stop="localeOpen = !localeOpen"
              :class="['flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors cursor-pointer', isScrolled ? 'text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800' : 'text-white/70 hover:text-white hover:bg-white/10']"
            >
              <span class="inline-block w-5 h-3.5 rounded-sm overflow-hidden shrink-0" v-html="currentLocale.flagSvg"></span>
              <span>{{ currentLocale.label }}</span>
              <svg class="w-3.5 h-3.5 transition-transform" :class="localeOpen && 'rotate-180'" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <Transition
              enter-active-class="transition ease-out duration-150"
              enter-from-class="opacity-0 -translate-y-1 scale-95"
              enter-to-class="opacity-100 translate-y-0 scale-100"
              leave-active-class="transition ease-in duration-100"
              leave-from-class="opacity-100 translate-y-0 scale-100"
              leave-to-class="opacity-0 -translate-y-1 scale-95"
            >
              <div
                v-if="localeOpen"
                class="absolute right-0 top-full mt-1.5 w-40 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg shadow-black/10 dark:shadow-black/30 py-1 z-50"
              >
                <button
                  v-for="loc in locales"
                  :key="loc.code"
                  @click="changeLocale(loc.code)"
                  :class="[
                    'flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors cursor-pointer',
                    locale === loc.code
                      ? 'bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300 font-medium'
                      : 'text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800',
                  ]"
                >
                  <span class="inline-block w-5 h-3.5 rounded-sm overflow-hidden shrink-0" v-html="loc.flagSvg"></span>
                  <span>{{ loc.label }}</span>
                  <svg v-if="locale === loc.code" class="w-4 h-4 ml-auto text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>
            </Transition>
          </div>
          <!-- Cart button -->
          <button
            v-if="cartCount > 0"
            @click="emit('open-cart')"
            :class="['relative p-2 rounded-lg transition-colors cursor-pointer', isScrolled ? 'text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800' : 'text-white/70 hover:text-white hover:bg-white/10']"
            :title="$t('landing.cart.title', 'Cart')"
          >
            <ShoppingBasket class="w-5 h-5" />
            <span class="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary-600 text-[10px] leading-none font-bold text-white">{{ cartCount }}</span>
          </button>
          <!-- Theme toggle -->
          <button
            @click="toggle"
            :class="['p-2 rounded-lg transition-colors cursor-pointer', isScrolled ? 'text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800' : 'text-white/70 hover:text-white hover:bg-white/10']"
            :title="`Theme: ${theme}`"
          >
            <svg v-if="theme === 'light'" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <svg v-else class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          </button>
          <template v-if="isLoggedIn">
            <router-link
              to="/panel"
              class="rounded-lg bg-gradient-to-r from-primary-600 to-primary-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition-all hover:shadow-primary-500/40 hover:brightness-110"
            >
              {{ $t('nav.dashboard') }}
            </router-link>
          </template>
          <template v-else-if="showGetStarted">
            <router-link
              to="/get-started"
              class="rounded-lg bg-gradient-to-r from-primary-600 to-primary-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition-all hover:shadow-primary-500/40 hover:brightness-110"
            >
              {{ $t('landing.nav.getStarted') }}
            </router-link>
            <router-link
              to="/login"
              :class="['rounded-lg border px-4 py-2 text-sm font-semibold transition-all -ml-4', isScrolled ? 'border-surface-300 dark:border-surface-700 text-surface-600 dark:text-surface-300 hover:border-surface-400 dark:hover:border-surface-600 hover:text-gray-900 dark:hover:text-white' : 'border-white/30 text-white/80 hover:border-white/50 hover:text-white']"
            >
              {{ $t('landing.nav.login') }}
            </router-link>
          </template>
        </div>

        <!-- Mobile: cart + theme toggle + menu button -->
        <div class="flex items-center gap-1 md:hidden">
          <button
            v-if="cartCount > 0"
            @click="emit('open-cart')"
            :class="['relative inline-flex items-center justify-center rounded-lg p-2 transition-colors cursor-pointer', isScrolled ? 'text-surface-500 dark:text-surface-400 hover:text-gray-900 dark:hover:text-white' : 'text-white/70 hover:text-white']"
          >
            <ShoppingBasket class="w-5 h-5" />
            <span class="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary-600 text-[10px] leading-none font-bold text-white">{{ cartCount }}</span>
          </button>
          <button
            @click="toggle"
            :class="['inline-flex items-center justify-center rounded-lg p-2 transition-colors cursor-pointer', isScrolled ? 'text-surface-500 dark:text-surface-400 hover:text-gray-900 dark:hover:text-white' : 'text-white/70 hover:text-white']"
            :title="`Theme: ${theme}`"
          >
            <svg v-if="theme === 'light'" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <svg v-else class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          </button>
          <button
            :class="['inline-flex items-center justify-center rounded-lg p-2 cursor-pointer transition-colors', isScrolled ? 'text-surface-500 dark:text-surface-400 hover:text-gray-900 dark:hover:text-white' : 'text-white/70 hover:text-white']"
            @click.stop="mobileMenuOpen = !mobileMenuOpen"
          >
            <svg v-if="!mobileMenuOpen" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <svg v-else class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Mobile menu -->
      <div
        v-if="mobileMenuOpen"
        class="border-t border-surface-200 dark:border-surface-800/50 bg-white dark:bg-surface-950 pb-4 pt-2 md:hidden"
      >
        <template v-for="link in navLinks" :key="link.label">
          <router-link
            v-if="link.routerLink"
            :to="link.href"
            class="block rounded-lg px-3 py-2 text-sm font-medium text-surface-500 dark:text-surface-400 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-gray-900 dark:hover:text-white"
            @click="mobileMenuOpen = false"
          >
            {{ link.label }}
          </router-link>
          <a
            v-else
            :href="link.href"
            :target="link.external ? '_blank' : undefined"
            :rel="link.external ? 'noopener noreferrer' : undefined"
            class="block rounded-lg px-3 py-2 text-sm font-medium text-surface-500 dark:text-surface-400 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-gray-900 dark:hover:text-white"
            @click="mobileMenuOpen = false"
          >
            {{ link.label }}
          </a>
        </template>
        <!-- Mobile locale switcher -->
        <div v-if="showLocaleSwitcher" class="mx-3 my-1 flex gap-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 p-1">
          <button
            v-for="loc in locales"
            :key="loc.code"
            @click="changeLocale(loc.code)"
            :class="[
              'flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-all cursor-pointer',
              locale === loc.code
                ? 'bg-white dark:bg-surface-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-surface-500 dark:text-surface-400 hover:text-gray-700 dark:hover:text-surface-200',
            ]"
          >
            <span class="inline-block w-5 h-3.5 rounded-sm overflow-hidden shrink-0" v-html="loc.flagSvg"></span>
          </button>
        </div>
        <template v-if="isLoggedIn">
          <router-link
            to="/panel"
            class="mx-3 mt-2 block rounded-lg bg-gradient-to-r from-primary-600 to-primary-500 px-3 py-2 text-center text-sm font-semibold text-white"
            @click="mobileMenuOpen = false"
          >
            {{ $t('nav.dashboard') }}
          </router-link>
        </template>
        <template v-else-if="showGetStarted">
          <router-link
            to="/get-started"
            class="mx-3 mt-2 block rounded-lg bg-gradient-to-r from-primary-600 to-primary-500 px-3 py-2 text-center text-sm font-semibold text-white"
            @click="mobileMenuOpen = false"
          >
            {{ $t('landing.nav.getStarted') }}
          </router-link>
          <router-link
            to="/login"
            class="mx-3 mt-2 block rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-center text-sm font-semibold text-surface-600 dark:text-surface-300"
            @click="mobileMenuOpen = false"
          >
            {{ $t('landing.nav.login') }}
          </router-link>
        </template>
      </div>
    </div>
  </nav>
</template>

