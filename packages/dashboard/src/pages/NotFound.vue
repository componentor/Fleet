<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ArrowLeft, FileQuestion } from 'lucide-vue-next'

const router = useRouter()
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
    <div class="text-center">
      <FileQuestion class="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-6" />
      <h1 class="text-4xl font-bold text-gray-900 dark:text-white mb-2">404</h1>
      <p class="text-gray-500 dark:text-gray-400 mb-8">The page you're looking for doesn't exist.</p>
      <button
        @click="router.push('/panel')"
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <ArrowLeft class="w-4 h-4" />
        Back to Dashboard
      </button>
    </div>
  </div>
</template>
