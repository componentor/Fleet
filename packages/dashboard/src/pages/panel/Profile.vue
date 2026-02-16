<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { User, Save, Lock, Loader2, CheckCircle2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'

const api = useApi()
const toast = useToast()

const loading = ref(true)
const profile = ref<any>(null)
const accounts = ref<any[]>([])

// Profile form
const name = ref('')
const avatarUrl = ref('')
const savingProfile = ref(false)

// Password form
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const changingPassword = ref(false)
const passwordError = ref('')

async function fetchProfile() {
  loading.value = true
  try {
    const [profileData, accountsData] = await Promise.all([
      api.get<any>('/users/me'),
      api.get<any[]>('/users/me/accounts'),
    ])
    profile.value = profileData
    accounts.value = accountsData
    name.value = profileData.name || ''
    avatarUrl.value = profileData.avatarUrl || ''
  } catch {
    // handled by useApi toast
  } finally {
    loading.value = false
  }
}

async function saveProfile() {
  savingProfile.value = true
  try {
    const updated = await api.patch<any>('/users/me', {
      name: name.value,
      avatarUrl: avatarUrl.value || null,
    })
    profile.value = updated
    // Update localStorage user data
    const userJson = localStorage.getItem('fleet_user')
    if (userJson) {
      const user = JSON.parse(userJson)
      user.name = updated.name
      user.avatarUrl = updated.avatarUrl
      localStorage.setItem('fleet_user', JSON.stringify(user))
    }
    toast.success('Profile updated')
  } catch {
    // handled by useApi toast
  } finally {
    savingProfile.value = false
  }
}

async function changePassword() {
  passwordError.value = ''

  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = 'Passwords do not match'
    return
  }
  if (newPassword.value.length < 8) {
    passwordError.value = 'Password must be at least 8 characters'
    return
  }

  changingPassword.value = true
  try {
    await api.put('/users/me/password', {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    })
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    toast.success('Password changed successfully')
  } catch (err: any) {
    passwordError.value = err?.body?.error || 'Failed to change password'
  } finally {
    changingPassword.value = false
  }
}

function formatDate(ts: any) {
  if (!ts) return '--'
  return new Date(ts).toLocaleDateString()
}

onMounted(() => {
  fetchProfile()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <User class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Profile</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else class="space-y-8 max-w-2xl">
      <!-- Profile info -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Profile Information</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Update your name and avatar.</p>
        </div>
        <form @submit.prevent="saveProfile" class="p-6 space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email</label>
            <input
              :value="profile?.email"
              type="email"
              disabled
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-sm cursor-not-allowed"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Name</label>
            <input
              v-model="name"
              type="text"
              placeholder="Your name"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Avatar URL</label>
            <input
              v-model="avatarUrl"
              type="url"
              placeholder="https://example.com/avatar.jpg"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div class="pt-2 flex justify-end">
            <button type="submit" :disabled="savingProfile" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              <Loader2 v-if="savingProfile" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" />
              {{ savingProfile ? 'Saving...' : 'Save Changes' }}
            </button>
          </div>
        </form>
      </div>

      <!-- Change password -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2">
            <Lock class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Change Password</h2>
          </div>
        </div>
        <form @submit.prevent="changePassword" class="p-6 space-y-5">
          <div v-if="passwordError" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p class="text-sm text-red-700 dark:text-red-300">{{ passwordError }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Current Password</label>
            <input
              v-model="currentPassword"
              type="password"
              required
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">New Password</label>
            <input
              v-model="newPassword"
              type="password"
              required
              minlength="8"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Confirm New Password</label>
            <input
              v-model="confirmPassword"
              type="password"
              required
              minlength="8"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div class="pt-2 flex justify-end">
            <button type="submit" :disabled="changingPassword || !currentPassword || !newPassword || !confirmPassword" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              <Loader2 v-if="changingPassword" class="w-4 h-4 animate-spin" />
              <Lock v-else class="w-4 h-4" />
              {{ changingPassword ? 'Changing...' : 'Change Password' }}
            </button>
          </div>
        </form>
      </div>

      <!-- Account memberships -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Account Memberships</h2>
        </div>
        <div class="divide-y divide-gray-200 dark:divide-gray-700">
          <div v-if="accounts.length === 0" class="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No account memberships.
          </div>
          <div v-for="account in accounts" :key="account.id" class="px-6 py-4 flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ account.name }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ account.slug }}</p>
            </div>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
              {{ account.role }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
