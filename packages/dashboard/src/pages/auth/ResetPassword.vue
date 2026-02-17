<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useApi } from '@/composables/useApi'
import { Lock, Loader2, CheckCircle } from 'lucide-vue-next'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const api = useApi()

const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')
const success = ref(false)

const token = route.query.token as string

async function handleSubmit() {
  error.value = ''

  if (password.value.length < 8) {
    error.value = t('auth.passwordMinError')
    return
  }

  if (password.value !== confirmPassword.value) {
    error.value = t('auth.passwordMismatch')
    return
  }

  loading.value = true
  try {
    await api.post('/auth/reset-password', { token, password: password.value })
    success.value = true
    setTimeout(() => {
      router.push('/login')
    }, 3000)
  } catch (e: any) {
    error.value = e?.body?.message ?? e?.message ?? 'Failed to reset password. The link may have expired.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <div class="space-y-6">
      <div class="text-center">
        <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ $t('auth.resetPasswordTitle') }}</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ $t('auth.resetPasswordDesc') }}</p>
      </div>

      <!-- Error alert -->
      <div
        v-if="error"
        class="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3"
      >
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>

      <!-- Success message -->
      <div
        v-if="success"
        class="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4"
      >
        <div class="flex items-center gap-2">
          <CheckCircle class="w-5 h-5 text-green-600 dark:text-green-400" />
          <p class="text-sm text-green-700 dark:text-green-300">
            {{ $t('auth.passwordResetRedirecting') }}
          </p>
        </div>
      </div>

      <!-- No token warning -->
      <div
        v-if="!token && !success"
        class="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3"
      >
        <p class="text-sm text-yellow-700 dark:text-yellow-300">
          {{ $t('auth.invalidResetToken') }}
        </p>
      </div>

      <!-- Form -->
      <form v-if="!success && token" @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label for="password" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            {{ $t('auth.newPassword') }}
          </label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            minlength="8"
            autocomplete="new-password"
            :placeholder="$t('auth.passwordMinPlaceholder')"
            class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>

        <div>
          <label for="confirmPassword" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            {{ $t('auth.confirmPassword') }}
          </label>
          <input
            id="confirmPassword"
            v-model="confirmPassword"
            type="password"
            required
            minlength="8"
            autocomplete="new-password"
            :placeholder="$t('auth.reenterPassword')"
            class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
          <Lock v-else class="w-4 h-4" />
          <span v-if="loading">{{ $t('auth.resetting') }}</span>
          <span v-else>{{ $t('auth.resetPassword') }}</span>
        </button>
      </form>

      <!-- Back to login -->
      <p class="text-center text-sm text-gray-500 dark:text-gray-400">
        <RouterLink to="/login" class="text-primary-600 dark:text-primary-400 hover:underline font-medium">
          {{ $t('auth.backToLogin') }}
        </RouterLink>
      </p>
    </div>
  </AuthLayout>
</template>
