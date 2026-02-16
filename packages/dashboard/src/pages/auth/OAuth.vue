<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Loader2 } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const error = ref('')

onMounted(async () => {
  const token = route.query.token as string | undefined
  const refreshToken = route.query.refresh_token as string | undefined

  if (!token) {
    error.value = route.query.error as string || 'Authentication failed. No token received.'
    return
  }

  try {
    authStore.setTokens({
      accessToken: token,
      refreshToken: refreshToken ?? '',
    })
    await authStore.loadUser()
    await router.replace('/panel')
  } catch {
    error.value = 'Failed to complete authentication. Please try again.'
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
    <div class="text-center">
      <template v-if="!error">
        <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin mx-auto" />
        <p class="mt-4 text-sm text-gray-500 dark:text-gray-400">Completing sign in...</p>
      </template>
      <template v-else>
        <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-8 max-w-md mx-4">
          <p class="text-red-600 dark:text-red-400 font-medium">Authentication Error</p>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{{ error }}</p>
          <RouterLink
            to="/login"
            class="inline-block mt-4 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
          >
            Back to login
          </RouterLink>
        </div>
      </template>
    </div>
  </div>
</template>
