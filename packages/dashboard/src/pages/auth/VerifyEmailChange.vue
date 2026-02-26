<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useApi } from '@/composables/useApi'
import { MailCheck, Loader2, CheckCircle, XCircle } from 'lucide-vue-next'

const route = useRoute()
const api = useApi()

const loading = ref(true)
const success = ref(false)
const error = ref('')

const token = route.query.token as string

async function verifyEmailChange() {
  if (!token) {
    loading.value = false
    error.value = 'Missing verification token. Please check your email link.'
    return
  }

  try {
    await api.post('/users/me/email/verify', { token })
    success.value = true
  } catch (e: any) {
    error.value = e?.body?.error ?? 'Verification failed. The link may have expired.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  verifyEmailChange()
})
</script>

<template>
  <AuthLayout>
    <div class="space-y-6">
      <div class="text-center">
        <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">Confirm Email Change</h2>
      </div>

      <div v-if="loading" class="flex flex-col items-center gap-4 py-8">
        <Loader2 class="w-10 h-10 text-primary-600 dark:text-primary-400 animate-spin" />
        <p class="text-sm text-gray-500 dark:text-gray-400">Verifying your new email address...</p>
      </div>

      <div v-else-if="success" class="flex flex-col items-center gap-4 py-8">
        <div class="w-16 h-16 rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
          <CheckCircle class="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <div class="text-center">
          <p class="text-lg font-semibold text-gray-900 dark:text-gray-100">Email Updated</p>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Your email address has been changed. Please log in again with your new email.</p>
        </div>
        <RouterLink
          to="/login"
          class="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <MailCheck class="w-4 h-4" />
          Continue to Sign In
        </RouterLink>
      </div>

      <div v-else class="flex flex-col items-center gap-4 py-8">
        <div class="w-16 h-16 rounded-full bg-red-50 dark:bg-red-900/30 flex items-center justify-center">
          <XCircle class="w-8 h-8 text-red-600 dark:text-red-400" />
        </div>
        <div class="text-center">
          <p class="text-lg font-semibold text-gray-900 dark:text-gray-100">Verification Failed</p>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ error }}</p>
        </div>
        <RouterLink
          to="/panel/profile"
          class="text-primary-600 dark:text-primary-400 hover:underline text-sm font-medium"
        >
          Back to Profile
        </RouterLink>
      </div>
    </div>
  </AuthLayout>
</template>
