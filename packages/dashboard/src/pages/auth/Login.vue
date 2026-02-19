<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useAuth } from '@/composables/useAuth'
import { LogIn, Github, Mail, Clock } from 'lucide-vue-next'

const { login, loading } = useAuth()

const email = ref('')
const password = ref('')
const error = ref('')
const rateLimitCountdown = ref(0)
let countdownTimer: ReturnType<typeof setInterval> | null = null

function startCountdown(seconds: number) {
  stopCountdown()
  rateLimitCountdown.value = seconds
  countdownTimer = setInterval(() => {
    rateLimitCountdown.value--
    if (rateLimitCountdown.value <= 0) {
      stopCountdown()
      error.value = ''
    }
  }, 1000)
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  rateLimitCountdown.value = 0
}

onUnmounted(() => stopCountdown())

async function handleSubmit() {
  if (rateLimitCountdown.value > 0) return
  error.value = ''
  try {
    await login(email.value, password.value)
  } catch (e: any) {
    const retryAfter = e?.body?.retryAfter
    if (e?.status === 429 && retryAfter) {
      error.value = 'Too many login attempts.'
      startCountdown(retryAfter)
    } else {
      error.value = e?.body?.error ?? e?.body?.message ?? 'Login failed. Please try again.'
    }
  }
}

function loginWithGithub() {
  window.location.href = '/api/v1/auth/github'
}

function loginWithGoogle() {
  window.location.href = '/api/v1/auth/google'
}
</script>

<template>
  <AuthLayout>
    <div class="space-y-6">
      <div class="text-center">
        <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ $t('auth.welcomeBack') }}</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ $t('auth.signInToAccount') }}</p>
      </div>

      <!-- Error alert -->
      <div
        v-if="error"
        class="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3"
      >
        <div class="flex items-center gap-2">
          <Clock v-if="rateLimitCountdown > 0" class="w-4 h-4 text-red-500 shrink-0" />
          <p class="text-sm text-red-700 dark:text-red-300">
            {{ error }}
            <span v-if="rateLimitCountdown > 0" class="font-medium"> Try again in {{ rateLimitCountdown }}s</span>
          </p>
        </div>
      </div>

      <!-- OAuth buttons -->
      <div class="space-y-3">
        <button
          @click="loginWithGithub"
          class="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
        >
          <Github class="w-5 h-5" />
          {{ $t('auth.signInWithGithub') }}
        </button>

        <button
          @click="loginWithGoogle"
          class="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
        >
          <Mail class="w-5 h-5" />
          {{ $t('auth.signInWithGoogle') }}
        </button>
      </div>

      <!-- Divider -->
      <div class="relative">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full border-t border-gray-200 dark:border-gray-600"></div>
        </div>
        <div class="relative flex justify-center text-sm">
          <span class="bg-white dark:bg-gray-800 px-3 text-gray-500 dark:text-gray-400">{{ $t('auth.orContinueWithEmail') }}</span>
        </div>
      </div>

      <!-- Email/Password form -->
      <form @submit.prevent="handleSubmit" class="space-y-4">
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

        <div>
          <label for="password" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            {{ $t('auth.passwordLabel') }}
          </label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            :placeholder="$t('auth.passwordPlaceholder')"
            class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>

        <button
          type="submit"
          :disabled="loading || rateLimitCountdown > 0"
          class="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          <LogIn class="w-4 h-4" />
          <span v-if="loading">{{ $t('auth.signingIn') }}</span>
          <span v-else-if="rateLimitCountdown > 0">{{ $t('auth.signInButton') }} ({{ rateLimitCountdown }}s)</span>
          <span v-else>{{ $t('auth.signInButton') }}</span>
        </button>
      </form>

      <!-- Register link -->
      <p class="text-center text-sm text-gray-500 dark:text-gray-400">
        {{ $t('auth.noAccount') }}
        <RouterLink to="/register" class="text-primary-600 dark:text-primary-400 hover:underline font-medium">
          {{ $t('auth.createOne') }}
        </RouterLink>
      </p>
    </div>
  </AuthLayout>
</template>
