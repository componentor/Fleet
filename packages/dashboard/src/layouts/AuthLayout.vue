<script setup lang="ts">
import { useTheme } from '@/composables/useTheme'
import { Sun, Moon, Monitor } from 'lucide-vue-next'

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
      <Monitor v-else class="w-5 h-5" />
    </button>

    <!-- Logo -->
    <div class="mb-8 text-center">
      <h1 class="text-3xl font-bold text-primary-600 dark:text-primary-400">Fleet</h1>
      <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">Cloud hosting made simple</p>
    </div>

    <!-- Card -->
    <div class="w-full max-w-md">
      <div class="bg-white dark:bg-gray-800 shadow-xl rounded-2xl border border-gray-200 dark:border-gray-700 p-8">
        <slot />
      </div>
    </div>
  </div>
</template>
