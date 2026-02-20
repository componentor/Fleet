<script setup lang="ts">
import { useTheme } from '@/composables/useTheme'
import { Sun, Moon } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { theme, toggle } = useTheme()
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
      <Moon v-else-if="theme === 'dark'" class="w-5 h-5" />
      <svg v-else class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none" />
      </svg>
    </button>

    <!-- Logo -->
    <div class="mb-8 text-center relative z-10 animate-fade-in-up">
      <div class="flex items-center justify-center gap-2 mb-2">
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700">
          <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h1 class="text-3xl font-bold text-primary-600 dark:text-primary-400">Fleet</h1>
      </div>
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('authLayout.tagline') }}</p>
    </div>

    <!-- Card -->
    <div class="w-full max-w-md relative z-10 animate-fade-in-up" style="animation-delay: 0.1s;">
      <div class="bg-white dark:bg-gray-800 shadow-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-8">
        <slot />
      </div>
    </div>
  </div>
</template>
