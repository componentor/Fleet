<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useApi } from '@/composables/useApi'
import { useAuthStore } from '@/stores/auth'
import { useAccountStore } from '@/stores/account'
import { ShieldCheck, Loader2, KeyRound } from 'lucide-vue-next'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const api = useApi()
const authStore = useAuthStore()
const accountStore = useAccountStore()

const code = ref('')
const loading = ref(false)
const error = ref('')
const useBackupCode = ref(false)

const tempToken = (route.query.tempToken as string) || ''

async function handleSubmit() {
  error.value = ''

  if (!code.value.trim()) {
    error.value = useBackupCode.value ? t('auth.pleaseEnterBackupCode') : t('auth.pleaseEnter6DigitCode')
    return
  }

  if (!useBackupCode.value && !/^\d{6}$/.test(code.value.trim())) {
    error.value = t('auth.codeMustBe6Digits')
    return
  }

  loading.value = true
  try {
    const data = await api.post<{ tokens: { accessToken: string; refreshToken: string }; user: any }>('/auth/2fa/verify', {
      tempToken,
      code: code.value.trim(),
    })

    // Store tokens and user data
    authStore.setTokens(data.tokens)
    localStorage.setItem('fleet_user', JSON.stringify(data.user))
    await authStore.loadUser()
    await accountStore.fetchAccounts()

    // Redirect to dashboard
    const redirect = route.query.redirect as string | undefined
    if (redirect) {
      await router.push(redirect)
    } else if (data.user?.isSuper) {
      await router.push('/admin')
    } else {
      await router.push('/panel')
    }
  } catch (e: any) {
    error.value = e?.body?.error ?? e?.body?.message ?? 'Invalid code. Please try again.'
  } finally {
    loading.value = false
  }
}

function toggleBackupCode() {
  useBackupCode.value = !useBackupCode.value
  code.value = ''
  error.value = ''
}
</script>

<template>
  <AuthLayout>
    <div class="space-y-6">
      <div class="text-center">
        <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ $t('auth.twoFactorTitle') }}</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ useBackupCode ? $t('auth.enterBackupCode') : $t('auth.enter6DigitCode') }}
        </p>
      </div>

      <!-- Error alert -->
      <div
        v-if="error"
        class="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3"
      >
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>

      <!-- No temp token warning -->
      <div
        v-if="!tempToken"
        class="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3"
      >
        <p class="text-sm text-yellow-700 dark:text-yellow-300">
          {{ $t('auth.missingAuthSession') }}
          <RouterLink to="/login" class="underline font-medium">{{ $t('auth.signInAgain') }}</RouterLink>.
        </p>
      </div>

      <!-- Form -->
      <form v-if="tempToken" @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label for="code" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            {{ useBackupCode ? $t('auth.enterBackupCodeLabel') : $t('auth.authenticationCode') }}
          </label>
          <input
            id="code"
            v-model="code"
            :type="useBackupCode ? 'text' : 'text'"
            required
            autocomplete="one-time-code"
            :placeholder="useBackupCode ? $t('auth.enterBackupCodePlaceholder') : '000000'"
            :maxlength="useBackupCode ? 50 : 6"
            class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm text-center tracking-widest text-lg font-mono"
          />
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
          <ShieldCheck v-else class="w-4 h-4" />
          <span v-if="loading">{{ $t('auth.verifying') }}</span>
          <span v-else>{{ $t('auth.verifyButton') }}</span>
        </button>
      </form>

      <!-- Toggle backup code -->
      <div class="text-center">
        <button
          @click="toggleBackupCode"
          class="inline-flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:underline font-medium"
        >
          <KeyRound class="w-3.5 h-3.5" />
          {{ useBackupCode ? $t('auth.useAuthenticatorInstead') : $t('auth.useBackupCode') }}
        </button>
      </div>

      <!-- Back to login -->
      <p class="text-center text-sm text-gray-500 dark:text-gray-400">
        <RouterLink to="/login" class="text-primary-600 dark:text-primary-400 hover:underline font-medium">
          {{ $t('auth.backToLogin') }}
        </RouterLink>
      </p>
    </div>
  </AuthLayout>
</template>
