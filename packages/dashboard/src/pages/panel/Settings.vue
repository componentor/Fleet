<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Settings, Save, AlertTriangle, Loader2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useAccountStore } from '@/stores/account'
import { useRole } from '@/composables/useRole'

const api = useApi()
const { canAdmin, canOwner } = useRole()
const router = useRouter()
const accountStore = useAccountStore()

const accountName = ref('')
const accountSlug = ref('')
const saving = ref(false)
const loading = ref(true)
const error = ref('')
const success = ref('')

async function loadAccount() {
  loading.value = true
  const accountId = accountStore.currentAccount?.id
  if (!accountId) { loading.value = false; return }
  try {
    const account = await api.get<any>(`/accounts/${accountId}`)
    accountName.value = account.name || ''
    accountSlug.value = account.slug || ''
  } catch {
    // use store data as fallback
    accountName.value = accountStore.currentAccount?.name || ''
    accountSlug.value = accountStore.currentAccount?.slug || ''
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  const accountId = accountStore.currentAccount?.id
  if (!accountId) return
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await api.patch(`/accounts/${accountId}`, {
      name: accountName.value,
      slug: accountSlug.value,
    })
    success.value = 'Settings saved successfully'
    await accountStore.fetchAccounts()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save settings'
  } finally {
    saving.value = false
  }
}

async function disconnectFromParent() {
  if (!confirm('Are you sure you want to disconnect this account from its parent? This cannot be undone.')) return
  const accountId = accountStore.currentAccount?.id
  if (!accountId) return
  try {
    await api.post(`/accounts/${accountId}/disconnect`, {})
    success.value = 'Disconnected from parent'
    await accountStore.fetchAccounts()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to disconnect'
  }
}

async function deleteAccount() {
  if (!confirm('Are you sure you want to permanently delete this account and all associated data? This cannot be undone.')) return
  const accountId = accountStore.currentAccount?.id
  if (!accountId) return
  try {
    await api.del(`/accounts/${accountId}`)
    await accountStore.fetchAccounts()
    router.push('/panel')
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to delete account'
  }
}

onMounted(() => {
  loadAccount()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Settings class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Account Settings</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else class="space-y-8 max-w-2xl">
      <div v-if="error" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>
      <div v-if="success" class="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
        <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
      </div>

      <!-- General settings -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">General</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Basic account information.</p>
        </div>
        <form @submit.prevent="saveSettings" class="p-6 space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Account Name</label>
            <input
              v-model="accountName"
              type="text"
              placeholder="My Account"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Account Slug</label>
            <input
              v-model="accountSlug"
              type="text"
              placeholder="my-account"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
            />
            <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">This is used in URLs and API calls.</p>
          </div>
          <div v-if="canAdmin" class="pt-2 flex justify-end">
            <button type="submit" :disabled="saving" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" />
              {{ saving ? 'Saving...' : 'Save Changes' }}
            </button>
          </div>
        </form>
      </div>

      <!-- Danger zone -->
      <div v-if="canOwner" class="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-800 shadow-sm">
        <div class="px-6 py-4 border-b border-red-200 dark:border-red-800">
          <div class="flex items-center gap-2">
            <AlertTriangle class="w-5 h-5 text-red-600 dark:text-red-400" />
            <h2 class="text-lg font-semibold text-red-600 dark:text-red-400">Danger Zone</h2>
          </div>
        </div>
        <div class="p-6 space-y-6">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-medium text-gray-900 dark:text-white">Disconnect from Parent</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Remove this account from its parent organization. This cannot be undone.</p>
            </div>
            <button @click="disconnectFromParent" class="px-4 py-2 rounded-lg border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors">
              Disconnect
            </button>
          </div>

          <div class="border-t border-gray-200 dark:border-gray-700"></div>

          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-medium text-gray-900 dark:text-white">Delete Account</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Permanently delete this account and all associated data. This cannot be undone.</p>
            </div>
            <button @click="deleteAccount" class="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors">
              Delete Account
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
