<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'

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
  dashboardUrl?: string
}>(), {
  showLocaleSwitcher: true,
  showGetStarted: true,
  dashboardUrl: 'http://localhost:5173',
})

const { locale } = useI18n()
const { theme, toggle } = useTheme()

const isScrolled = ref(false)
const mobileMenuOpen = ref(false)
const navRef = ref<HTMLElement | null>(null)

function handleScroll() {
  isScrolled.value = window.scrollY > 20
}

function handleClickOutside(e: MouseEvent) {
  if (mobileMenuOpen.value && navRef.value && !navRef.value.contains(e.target as Node)) {
    mobileMenuOpen.value = false
  }
}

function changeLocale(newLocale: string) {
  locale.value = newLocale
  localStorage.setItem('fleet_locale', newLocale)
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
      'fixed top-[var(--banner-height,0px)] left-0 right-0 z-50 transition-all duration-300 border-b',
      isScrolled
        ? 'bg-white/80 dark:bg-surface-950/80 backdrop-blur-xl border-surface-200 dark:border-surface-800/50'
        : 'bg-transparent border-transparent',
    ]"
  >
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="flex h-16 items-center justify-between">
        <!-- Logo -->
        <router-link to="/" class="flex items-center gap-2">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700">
            <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span class="text-xl font-bold text-gray-900 dark:text-white">Siglar</span>
        </router-link>

        <!-- Desktop nav links -->
        <div class="hidden items-center gap-8 md:flex">
          <template v-for="link in navLinks" :key="link.label">
            <router-link
              v-if="link.routerLink"
              :to="link.href"
              class="text-sm font-medium text-surface-500 dark:text-surface-400 transition-colors hover:text-gray-900 dark:hover:text-white"
            >
              {{ link.label }}
            </router-link>
            <a
              v-else
              :href="link.href"
              :target="link.external ? '_blank' : undefined"
              :rel="link.external ? 'noopener noreferrer' : undefined"
              class="text-sm font-medium text-surface-500 dark:text-surface-400 transition-colors hover:text-gray-900 dark:hover:text-white"
            >
              {{ link.label }}
            </a>
          </template>
          <select
            v-if="showLocaleSwitcher"
            :value="locale"
            @change="changeLocale(($event.target as HTMLSelectElement).value)"
            class="rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-1 text-sm font-medium text-surface-600 dark:text-surface-400 transition-colors hover:text-gray-900 dark:hover:text-white cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="en" class="bg-white dark:bg-surface-900 text-gray-900 dark:text-surface-200">EN</option>
            <option value="nb" class="bg-white dark:bg-surface-900 text-gray-900 dark:text-surface-200">NO</option>
            <option value="de" class="bg-white dark:bg-surface-900 text-gray-900 dark:text-surface-200">DE</option>
            <option value="zh" class="bg-white dark:bg-surface-900 text-gray-900 dark:text-surface-200">中文</option>
          </select>
          <!-- Theme toggle -->
          <button
            @click="toggle"
            class="p-2 rounded-lg text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors cursor-pointer"
            :title="`Theme: ${theme}`"
          >
            <!-- Sun icon for light mode -->
            <svg v-if="theme === 'light'" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <!-- Moon icon for dark mode -->
            <svg v-else-if="theme === 'dark'" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
            <!-- Half circle icon for system mode -->
            <svg v-else class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <a
            v-if="showGetStarted"
            :href="dashboardUrl + '/login'"
            class="rounded-lg border border-surface-300 dark:border-surface-700 px-4 py-2 text-sm font-semibold text-surface-600 dark:text-surface-300 transition-all hover:border-surface-400 dark:hover:border-surface-600 hover:text-gray-900 dark:hover:text-white"
          >
            {{ $t('nav.login') }}
          </a>
          <a
            v-if="showGetStarted"
            :href="dashboardUrl + '/get-started'"
            class="rounded-lg bg-gradient-to-r from-primary-600 to-primary-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition-all hover:shadow-primary-500/40 hover:brightness-110"
          >
            {{ $t('nav.getStarted') }}
          </a>
        </div>

        <!-- Mobile: theme toggle + menu button -->
        <div class="flex items-center gap-1 md:hidden">
          <button
            @click="toggle"
            class="inline-flex items-center justify-center rounded-lg p-2 text-surface-500 dark:text-surface-400 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer"
            :title="`Theme: ${theme}`"
          >
            <svg v-if="theme === 'light'" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <svg v-else-if="theme === 'dark'" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
            <svg v-else class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button
            class="inline-flex items-center justify-center rounded-lg p-2 text-surface-500 dark:text-surface-400 hover:text-gray-900 dark:hover:text-white cursor-pointer"
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
        <select
          v-if="showLocaleSwitcher"
          :value="locale"
          @change="changeLocale(($event.target as HTMLSelectElement).value)"
          class="mx-3 my-1 block w-[calc(100%-1.5rem)] rounded-lg px-3 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 transition-colors hover:text-gray-900 dark:hover:text-white cursor-pointer outline-none"
        >
          <option value="en" class="bg-white dark:bg-surface-900 text-gray-900 dark:text-surface-200">English</option>
          <option value="nb" class="bg-white dark:bg-surface-900 text-gray-900 dark:text-surface-200">Norsk</option>
          <option value="de" class="bg-white dark:bg-surface-900 text-gray-900 dark:text-surface-200">Deutsch</option>
          <option value="zh" class="bg-white dark:bg-surface-900 text-gray-900 dark:text-surface-200">中文</option>
        </select>
        <a
          v-if="showGetStarted"
          :href="dashboardUrl + '/login'"
          class="mx-3 mt-2 block rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-center text-sm font-semibold text-surface-600 dark:text-surface-300"
          @click="mobileMenuOpen = false"
        >
          {{ $t('nav.login') }}
        </a>
        <a
          v-if="showGetStarted"
          :href="dashboardUrl + '/get-started'"
          class="mx-3 mt-2 block rounded-lg bg-gradient-to-r from-primary-600 to-primary-500 px-3 py-2 text-center text-sm font-semibold text-white"
          @click="mobileMenuOpen = false"
        >
          {{ $t('nav.getStarted') }}
        </a>
      </div>
    </div>
  </nav>
</template>
