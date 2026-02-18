<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'

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
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
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
        <router-link to="/" class="flex items-center gap-2">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700">
            <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span class="text-xl font-bold text-white">Fleet</span>
        </router-link>

        <!-- Desktop nav links -->
        <div class="hidden items-center gap-8 md:flex">
          <template v-for="link in navLinks" :key="link.label">
            <router-link
              v-if="link.routerLink"
              :to="link.href"
              class="text-sm font-medium text-surface-400 transition-colors hover:text-white"
            >
              {{ link.label }}
            </router-link>
            <a
              v-else
              :href="link.href"
              :target="link.external ? '_blank' : undefined"
              :rel="link.external ? 'noopener noreferrer' : undefined"
              class="text-sm font-medium text-surface-400 transition-colors hover:text-white"
            >
              {{ link.label }}
            </a>
          </template>
          <select
            v-if="showLocaleSwitcher"
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
            v-if="showGetStarted"
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
        <template v-for="link in navLinks" :key="link.label">
          <router-link
            v-if="link.routerLink"
            :to="link.href"
            class="block rounded-lg px-3 py-2 text-sm font-medium text-surface-400 transition-colors hover:bg-surface-800 hover:text-white"
            @click="mobileMenuOpen = false"
          >
            {{ link.label }}
          </router-link>
          <a
            v-else
            :href="link.href"
            :target="link.external ? '_blank' : undefined"
            :rel="link.external ? 'noopener noreferrer' : undefined"
            class="block rounded-lg px-3 py-2 text-sm font-medium text-surface-400 transition-colors hover:bg-surface-800 hover:text-white"
            @click="mobileMenuOpen = false"
          >
            {{ link.label }}
          </a>
        </template>
        <select
          v-if="showLocaleSwitcher"
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
          v-if="showGetStarted"
          :href="dashboardUrl + '/register'"
          class="mt-2 block rounded-lg bg-gradient-to-r from-primary-600 to-primary-500 px-3 py-2 text-center text-sm font-semibold text-white"
          @click="mobileMenuOpen = false"
        >
          {{ $t('nav.getStarted') }}
        </a>
      </div>
    </div>
  </nav>
</template>
