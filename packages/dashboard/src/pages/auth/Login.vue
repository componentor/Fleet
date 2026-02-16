<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useAuth } from '@/composables/useAuth'
import { LogIn, Github, Mail } from 'lucide-vue-next'

const { login, loading } = useAuth()

const email = ref('')
const password = ref('')
const error = ref('')

async function handleSubmit() {
  error.value = ''
  try {
    await login(email.value, password.value)
  } catch (e: any) {
    error.value = e?.body?.message ?? e?.message ?? 'Login failed. Please try again.'
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
        <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">Welcome back</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Sign in to your account</p>
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
          @click="loginWithGithub"
          class="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
        >
          <Github class="w-5 h-5" />
          Sign in with GitHub
        </button>

        <button
          @click="loginWithGoogle"
          class="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
        >
          <Mail class="w-5 h-5" />
          Sign in with Google
        </button>
      </div>

      <!-- Divider -->
      <div class="relative">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full border-t border-gray-200 dark:border-gray-600"></div>
        </div>
        <div class="relative flex justify-center text-sm">
          <span class="bg-white dark:bg-gray-800 px-3 text-gray-500 dark:text-gray-400">or continue with email</span>
        </div>
      </div>

      <!-- Email/Password form -->
      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label for="email" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Email address
          </label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="email"
            placeholder="you@example.com"
            class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>

        <div>
          <label for="password" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Password
          </label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            placeholder="Enter your password"
            class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          <LogIn class="w-4 h-4" />
          <span v-if="loading">Signing in...</span>
          <span v-else>Sign in</span>
        </button>
      </form>

      <!-- Register link -->
      <p class="text-center text-sm text-gray-500 dark:text-gray-400">
        Don't have an account?
        <RouterLink to="/register" class="text-primary-600 dark:text-primary-400 hover:underline font-medium">
          Create one
        </RouterLink>
      </p>
    </div>
  </AuthLayout>
</template>
