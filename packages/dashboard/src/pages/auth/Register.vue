<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useAuth } from '@/composables/useAuth'
import { UserPlus, Github, Mail } from 'lucide-vue-next'

const { register, loading } = useAuth()

const name = ref('')
const email = ref('')
const password = ref('')
const error = ref('')

async function handleSubmit() {
  error.value = ''
  try {
    await register(name.value, email.value, password.value)
  } catch (e: any) {
    error.value = e?.body?.message ?? e?.message ?? 'Registration failed. Please try again.'
  }
}

function registerWithGithub() {
  window.location.href = '/api/v1/auth/github'
}

function registerWithGoogle() {
  window.location.href = '/api/v1/auth/google'
}
</script>

<template>
  <AuthLayout>
    <div class="space-y-6">
      <div class="text-center">
        <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ $t('auth.createYourAccount') }}</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ $t('auth.getStartedWithFleet') }}</p>
      </div>

      <!-- Error alert -->
      <div
        v-if="error"
        class="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3"
      >
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>

      <!-- OAuth buttons -->
      <div class="space-y-3">
        <button
          @click="registerWithGithub"
          class="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
        >
          <Github class="w-5 h-5" />
          {{ $t('auth.signUpWithGithub') }}
        </button>

        <button
          @click="registerWithGoogle"
          class="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
        >
          <Mail class="w-5 h-5" />
          {{ $t('auth.signUpWithGoogle') }}
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

      <!-- Registration form -->
      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label for="name" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            {{ $t('auth.nameLabel') }}
          </label>
          <input
            id="name"
            v-model="name"
            type="text"
            required
            autocomplete="name"
            :placeholder="$t('auth.namePlaceholder')"
            class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>

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
            autocomplete="new-password"
            :placeholder="$t('auth.createStrongPassword')"
            minlength="8"
            class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
          <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">{{ $t('auth.passwordMinLength') }}</p>
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          <UserPlus class="w-4 h-4" />
          <span v-if="loading">{{ $t('auth.creatingAccount') }}</span>
          <span v-else>{{ $t('auth.signUpButton') }}</span>
        </button>
      </form>

      <!-- Login link -->
      <p class="text-center text-sm text-gray-500 dark:text-gray-400">
        {{ $t('auth.hasAccount') }}
        <RouterLink to="/login" class="text-primary-600 dark:text-primary-400 hover:underline font-medium">
          {{ $t('auth.signInButton') }}
        </RouterLink>
      </p>
    </div>
  </AuthLayout>
</template>
