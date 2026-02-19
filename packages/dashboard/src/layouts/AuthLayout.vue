<script setup lang="ts">
import { useTheme } from '@/composables/useTheme'
import { Sun, Moon } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { theme, toggle } = useTheme()
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center px-4 py-12">
    <!-- Theme toggle -->
    <button
      @click="toggle"
      class="fixed top-4 right-4 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
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
    <div class="mb-8 text-center">
      <h1 class="text-3xl font-bold text-primary-600 dark:text-primary-400">Fleet</h1>
      <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{{ $t('authLayout.tagline') }}</p>
    </div>

    <!-- Card -->
    <div class="w-full max-w-md">
      <div class="bg-white dark:bg-gray-800 shadow-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-8">
        <slot />
      </div>
    </div>
  </div>
</template>
