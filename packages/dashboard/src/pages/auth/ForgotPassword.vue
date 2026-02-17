<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useApi } from '@/composables/useApi'
import { Mail, ArrowLeft, Loader2 } from 'lucide-vue-next'

const api = useApi()

const email = ref('')
const loading = ref(false)
const submitted = ref(false)

async function handleSubmit() {
  loading.value = true
  try {
    await api.post('/auth/forgot-password', { email: email.value })
  } catch {
    // Silently ignore errors to prevent email enumeration
  } finally {
    loading.value = false
    submitted.value = true
  }
}
</script>

<template>
  <AuthLayout>
    <div class="space-y-6">
      <div class="text-center">
        <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ $t('auth.forgotPasswordTitle') }}</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ $t('auth.forgotPasswordDesc') }}</p>
      </div>

      <!-- Success message -->
      <div
        v-if="submitted"
        class="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4"
      >
        <p class="text-sm text-green-700 dark:text-green-300">
          {{ $t('auth.forgotPasswordSuccess') }}
        </p>
      </div>

      <!-- Form -->
      <form v-if="!submitted" @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label for="email" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            {{ $t('auth.emailLabel') }}
          </label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="email"
            :placeholder="$t('auth.emailPlaceholder')"
            class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
          <Mail v-else class="w-4 h-4" />
          <span v-if="loading">{{ $t('auth.sending') }}</span>
          <span v-else>{{ $t('auth.sendResetLink') }}</span>
        </button>
      </form>

      <!-- Back to login -->
      <p class="text-center text-sm text-gray-500 dark:text-gray-400">
        <RouterLink to="/login" class="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline font-medium">
          <ArrowLeft class="w-3.5 h-3.5" />
          {{ $t('auth.backToLogin') }}
        </RouterLink>
      </p>
    </div>
  </AuthLayout>
</template>
