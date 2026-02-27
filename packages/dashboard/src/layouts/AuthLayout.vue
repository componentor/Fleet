<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useTheme } from '@/composables/useTheme'
import { Sun, Moon } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useBranding } from '@/composables/useBranding'

const { t } = useI18n()
const { theme, toggle } = useTheme()
const { brandTitle, logoSrc } = useBranding()

// Check if we're on a reseller's custom domain
const resellerBranding = ref<{ found: boolean; brandName?: string; brandLogoUrl?: string; brandPrimaryColor?: string; slug?: string }>({ found: false })

onMounted(async () => {
  try {
    const host = window.location.hostname
    const appHost = new URL(import.meta.env.VITE_API_URL || window.location.origin).hostname
    if (host !== appHost && host !== 'localhost') {
      const res = await fetch(`/api/v1/reseller/branding/${encodeURIComponent(host)}`)
      if (res.ok) {
        resellerBranding.value = await res.json()
      }
    }
  } catch {
    // Not a reseller domain
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
    <!-- Floating background decorations -->
    <div class="pointer-events-none fixed inset-0 overflow-hidden">
      <div class="absolute top-1/4 -left-20 w-72 h-72 bg-primary-500/10 rounded-full blur-3xl animate-float"></div>
      <div class="absolute bottom-1/4 -right-20 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-float" style="animation-delay: 2s;"></div>
      <div class="absolute top-2/3 left-1/3 w-48 h-48 bg-primary-600/5 rounded-full blur-3xl animate-float" style="animation-delay: 4s;"></div>
    </div>

    <!-- Theme toggle -->
    <button
      @click="toggle"
      class="fixed top-4 right-4 z-10 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      :title="`Theme: ${theme}`"
    >
      <Sun v-if="theme === 'light'" class="w-5 h-5" />
      <Moon v-else class="w-5 h-5" />
    </button>

    <!-- Logo -->
    <div class="mb-8 text-center relative z-10 animate-fade-in-up">
      <template v-if="resellerBranding.found">
        <RouterLink to="/" class="flex items-center justify-center gap-2 mb-2">
          <img v-if="resellerBranding.brandLogoUrl" :src="resellerBranding.brandLogoUrl" :alt="resellerBranding.brandName" class="h-10 w-auto max-w-[200px] object-contain" />
          <h1 v-else class="text-3xl font-bold" :style="resellerBranding.brandPrimaryColor ? { color: resellerBranding.brandPrimaryColor } : {}">
            {{ resellerBranding.brandName }}
          </h1>
        </RouterLink>
      </template>
      <template v-else>
        <RouterLink to="/" class="flex items-center justify-center gap-2 mb-2">
          <template v-if="logoSrc()">
            <img :src="logoSrc()!" :alt="brandTitle" class="h-10 w-auto max-w-[200px] object-contain" />
          </template>
          <template v-else>
            <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700">
              <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </template>
          <h1 class="text-3xl font-bold text-primary-600 dark:text-primary-400">{{ brandTitle }}</h1>
        </RouterLink>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('authLayout.tagline') }}</p>
      </template>
    </div>

    <!-- Card -->
    <div class="w-full max-w-md relative z-10 animate-fade-in-up" style="animation-delay: 0.1s;">
      <div class="bg-white dark:bg-gray-800 shadow-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-8">
        <slot />
      </div>
    </div>
  </div>
</template>
