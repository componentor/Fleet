<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { User, Save, Lock, Loader2, Mail, Github, Link2, Unlink, Download, Trash2, AlertTriangle, Send, Upload, X, Shield, ToggleLeft, ToggleRight, KeyRound, Plus, Copy, Check } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/composables/useAuth'

const { t } = useI18n()
const api = useApi()
const toast = useToast()
const router = useRouter()
const { user: authUser } = useAuth()

const loading = ref(true)
const profile = ref<any>(null)
const accounts = ref<any[]>([])

// Profile form
const name = ref('')
const savingProfile = ref(false)

// Avatar
const avatarFileInput = ref<HTMLInputElement | null>(null)
const uploadingAvatar = ref(false)

// Email change
const showEmailChange = ref(false)
const newEmail = ref('')
const emailPassword = ref('')
const changingEmail = ref(false)
const emailError = ref('')
const emailSent = ref(false)

// Password form
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const changingPassword = ref(false)
const passwordError = ref('')

// OAuth providers
const oauthProviders = ref<Array<{ provider: string; providerUserId: string; createdAt: string }>>([])
const loadingOAuth = ref(false)
const disconnecting = ref('')

// Login methods
interface LoginMethod {
  method: string
  available: boolean
  enabled: boolean
}
const loginMethods = ref<LoginMethod[]>([])
const loadingLoginMethods = ref(false)
const togglingMethod = ref('')

// SSH keys
interface SshKey {
  id: string
  name: string
  fingerprint: string
  publicKey: string
  nodeAccess: boolean
  createdAt: string
}
const sshKeys = ref<SshKey[]>([])
const loadingSshKeys = ref(false)
const showAddKey = ref(false)
const newKeyName = ref('')
const newKeyPublicKey = ref('')
const addingKey = ref(false)
const addKeyError = ref('')
const deletingKeyId = ref('')
const copiedFingerprint = ref('')

// Data export
const exporting = ref(false)

// Delete account
const showDeleteModal = ref(false)
const deletePassword = ref('')
const deleteEmailCode = ref('')
const sendingCode = ref(false)
const codeSent = ref(false)
const deletingAccount = ref(false)
const deleteError = ref('')

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
  } catch {
    // handled by useApi toast
  } finally {
    loading.value = false
  }
}

async function fetchOAuth() {
  loadingOAuth.value = true
  try {
    oauthProviders.value = await api.get<any[]>('/users/me/oauth')
  } catch {
    // silent
  } finally {
    loadingOAuth.value = false
  }
}

async function saveProfile() {
  savingProfile.value = true
  try {
    const updated = await api.patch<any>('/users/me', {
      name: name.value,
    })
    profile.value = updated
    const userJson = localStorage.getItem('fleet_user')
    if (userJson) {
      const user = JSON.parse(userJson)
      user.name = updated.name
      localStorage.setItem('fleet_user', JSON.stringify(user))
    }
    toast.success(t('profile.profileUpdated'))
  } catch {
    // handled by useApi toast
  } finally {
    savingProfile.value = false
  }
}

async function uploadAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const maxSize = 2 * 1024 * 1024 // 2 MB
  if (file.size > maxSize) {
    toast.error(t('profile.avatarTooLarge'))
    input.value = ''
    return
  }

  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  if (!allowed.includes(file.type)) {
    toast.error(t('profile.avatarInvalidType'))
    input.value = ''
    return
  }

  uploadingAvatar.value = true
  try {
    const { useAuthStore } = await import('@/stores/auth')
    const authStore = useAuthStore()
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('/api/v1/users/me/avatar', {
      method: 'POST',
      body: formData,
      headers: { Authorization: `Bearer ${authStore.token}` },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Upload failed')
    }
    const updated = await res.json()
    profile.value = updated
    if (authStore.user) authStore.user.avatarUrl = updated.avatarUrl ? `${updated.avatarUrl}?t=${Date.now()}` : null
    toast.success(t('profile.avatarUpdated'))
  } catch (err: any) {
    toast.error(err?.message || t('profile.avatarUploadFailed'))
  } finally {
    uploadingAvatar.value = false
    input.value = ''
  }
}

async function removeAvatar() {
  uploadingAvatar.value = true
  try {
    const { useAuthStore } = await import('@/stores/auth')
    const authStore = useAuthStore()
    const updated = await api.del<any>('/users/me/avatar')
    profile.value = updated
    if (authStore.user) authStore.user.avatarUrl = null
    toast.success(t('profile.avatarRemoved'))
  } catch {
    toast.error(t('profile.avatarRemoveFailed'))
  } finally {
    uploadingAvatar.value = false
  }
}

async function requestEmailChange() {
  emailError.value = ''
  if (!newEmail.value || !emailPassword.value) {
    emailError.value = t('profile.emailPasswordRequired')
    return
  }

  changingEmail.value = true
  try {
    await api.put('/users/me/email', {
      newEmail: newEmail.value,
      password: emailPassword.value,
    })
    emailSent.value = true
    toast.success(t('profile.verificationSent', { email: newEmail.value }))
  } catch (err: any) {
    emailError.value = err?.body?.error || t('profile.emailChangeFailed')
  } finally {
    changingEmail.value = false
  }
}

async function changePassword() {
  passwordError.value = ''

  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = t('profile.passwordsNoMatch')
    return
  }
  if (newPassword.value.length < 8) {
    passwordError.value = t('profile.passwordMinLength')
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
    toast.success(t('profile.passwordChanged'))
  } catch (err: any) {
    passwordError.value = err?.body?.error || t('profile.passwordChangeFailed')
  } finally {
    changingPassword.value = false
  }
}

async function fetchLoginMethods() {
  loadingLoginMethods.value = true
  try {
    const res = await api.get<{ methods: LoginMethod[] }>('/users/me/login-methods')
    loginMethods.value = res.methods
  } catch {
    // silent
  } finally {
    loadingLoginMethods.value = false
  }
}

async function toggleLoginMethod(method: string) {
  const current = loginMethods.value.find((m) => m.method === method)
  if (!current) return

  togglingMethod.value = method
  try {
    // Build the new disabled list
    const currentDisabled = loginMethods.value
      .filter((m) => m.available && !m.enabled)
      .map((m) => m.method)

    let newDisabled: string[]
    if (current.enabled) {
      // Disabling this method
      newDisabled = [...currentDisabled, method]
    } else {
      // Re-enabling this method
      newDisabled = currentDisabled.filter((m) => m !== method)
    }

    const res = await api.patch<{ methods: LoginMethod[]; reEnabled?: string[] }>('/users/me/login-methods', {
      disabledMethods: newDisabled,
    })
    loginMethods.value = res.methods
    toast.success(current.enabled
      ? t('profile.loginMethodDisabled', { method })
      : t('profile.loginMethodEnabled', { method }),
    )
  } catch (err: any) {
    toast.error(err?.body?.error || t('profile.loginMethodUpdateFailed'))
  } finally {
    togglingMethod.value = ''
  }
}

function canToggleMethod(method: LoginMethod): boolean {
  if (!method.available) return false
  if (method.enabled) {
    // Can only disable if at least one other method will remain enabled
    const otherEnabled = loginMethods.value.filter((m) => m.method !== method.method && m.available && m.enabled)
    return otherEnabled.length > 0
  }
  // Can always re-enable
  return true
}

async function fetchSshKeys() {
  loadingSshKeys.value = true
  try {
    sshKeys.value = await api.get<SshKey[]>('/ssh/keys')
  } catch {
    // silent
  } finally {
    loadingSshKeys.value = false
  }
}

async function addSshKey() {
  addKeyError.value = ''
  if (!newKeyName.value.trim() || !newKeyPublicKey.value.trim()) {
    addKeyError.value = 'Name and public key are required'
    return
  }

  addingKey.value = true
  try {
    await api.post('/ssh/keys', {
      name: newKeyName.value.trim(),
      publicKey: newKeyPublicKey.value.trim(),
    })
    newKeyName.value = ''
    newKeyPublicKey.value = ''
    showAddKey.value = false
    toast.success('SSH key added')
    await fetchSshKeys()
  } catch (err: any) {
    addKeyError.value = err?.body?.error || 'Failed to add SSH key'
  } finally {
    addingKey.value = false
  }
}

async function deleteSshKey(id: string) {
  if (!confirm('Are you sure you want to delete this SSH key?')) return

  deletingKeyId.value = id
  try {
    await api.del(`/ssh/keys/${id}`)
    toast.success('SSH key deleted')
    await fetchSshKeys()
  } catch {
    toast.error('Failed to delete SSH key')
  } finally {
    deletingKeyId.value = ''
  }
}

function copyFingerprint(fingerprint: string) {
  navigator.clipboard.writeText(fingerprint)
  copiedFingerprint.value = fingerprint
  setTimeout(() => { copiedFingerprint.value = '' }, 2000)
}

function connectProvider(provider: string) {
  window.location.href = `/api/v1/auth/${provider}?returnTo=/panel/profile`
}

async function disconnectProvider(provider: string) {
  if (!confirm(t('profile.disconnectConfirm', { provider }))) return

  disconnecting.value = provider
  try {
    const res = await api.del<{ message: string; reEnabled?: string[] }>(`/users/me/oauth/${provider}`)
    toast.success(t('profile.providerDisconnected', { provider }))
    if (res.reEnabled?.length) {
      toast.success(t('profile.methodsReEnabled', { methods: res.reEnabled.join(', ') }))
    }
    await Promise.all([fetchOAuth(), fetchLoginMethods()])
  } catch (err: any) {
    toast.error(err?.body?.error || t('profile.disconnectFailed'))
  } finally {
    disconnecting.value = ''
  }
}

function isConnected(provider: string): boolean {
  return oauthProviders.value.some((p) => p.provider === provider)
}

async function exportData() {
  exporting.value = true
  try {
    const data = await api.get<any>('/users/me/export')
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'fleet-data-export.json'
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('profile.dataExported'))
  } catch {
    toast.error(t('profile.dataExportFailed'))
  } finally {
    exporting.value = false
  }
}

async function sendDeleteCode() {
  sendingCode.value = true
  try {
    await api.post('/users/me/delete-code', {})
    codeSent.value = true
    toast.success(t('profile.verificationCodeSent'))
  } catch (err: any) {
    deleteError.value = err?.body?.error || t('profile.sendCodeFailed')
  } finally {
    sendingCode.value = false
  }
}

async function confirmDelete() {
  deleteError.value = ''
  if (!deletePassword.value && !deleteEmailCode.value) {
    deleteError.value = t('profile.enterPasswordOrCode')
    return
  }

  deletingAccount.value = true
  try {
    await api.del('/users/me', {
      password: deletePassword.value || undefined,
      emailCode: deleteEmailCode.value || undefined,
    })
    toast.success(t('profile.accountDeleted'))
    localStorage.clear()
    router.push('/')
  } catch (err: any) {
    deleteError.value = err?.body?.error || t('profile.deleteFailed')
  } finally {
    deletingAccount.value = false
  }
}

onMounted(() => {
  fetchProfile()
  fetchOAuth()
  fetchLoginMethods()
  fetchSshKeys()

  // Check for OAuth connection result in URL fragment
  const hash = window.location.hash
  if (hash.includes('connected=github')) {
    toast.success(t('profile.githubConnected'))
    window.history.replaceState(null, '', window.location.pathname)
    fetchOAuth()
  } else if (hash.includes('connected=google')) {
    toast.success(t('profile.googleConnected'))
    window.history.replaceState(null, '', window.location.pathname)
    fetchOAuth()
  } else if (hash.includes('error=')) {
    const errorMsg = decodeURIComponent(hash.split('error=')[1]?.split('&')[0] ?? t('profile.connectionFailed'))
    toast.error(errorMsg)
    window.history.replaceState(null, '', window.location.pathname)
  }
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <User class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('profile.title') }}</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else class="space-y-8 max-w-2xl">
      <!-- Profile info -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('profile.personalInfo') }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('profile.profileDesc') }}</p>
        </div>
        <form @submit.prevent="saveProfile" class="p-6 space-y-5">
          <!-- Email with change option -->
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('profile.email') }}</label>
            <div class="flex items-center gap-2">
              <input
                :value="profile?.email"
                type="email"
                disabled
                class="flex-1 px-3.5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-sm cursor-not-allowed"
              />
              <button
                type="button"
                @click="showEmailChange = !showEmailChange"
                class="px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {{ $t('profile.changeEmail') }}
              </button>
            </div>

            <!-- Email change form -->
            <div v-if="showEmailChange" class="mt-3 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 space-y-3">
              <div v-if="emailSent" class="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <p class="text-sm text-green-700 dark:text-green-300">{{ $t('profile.verificationSent', { email: newEmail }) }}</p>
              </div>
              <template v-else>
                <div v-if="emailError" class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p class="text-sm text-red-700 dark:text-red-300">{{ emailError }}</p>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ $t('profile.newEmail') }}</label>
                  <input
                    v-model="newEmail"
                    type="email"
                    :placeholder="$t('profile.newEmailPlaceholder')"
                    class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ $t('profile.currentPassword') }}</label>
                  <input
                    v-model="emailPassword"
                    type="password"
                    class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div class="flex justify-end">
                  <button
                    type="button"
                    @click="requestEmailChange"
                    :disabled="changingEmail || !newEmail || !emailPassword"
                    class="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    <Loader2 v-if="changingEmail" class="w-3.5 h-3.5 animate-spin" />
                    <Mail v-else class="w-3.5 h-3.5" />
                    {{ $t('profile.sendVerification') }}
                  </button>
                </div>
              </template>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('profile.name') }}</label>
            <input
              v-model="name"
              type="text"
              :placeholder="$t('profile.namePlaceholder')"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('profile.avatar') }}</label>
            <div class="flex items-center gap-4">
              <div class="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden border-2 border-gray-200 dark:border-gray-600 shrink-0">
                <img
                  v-if="profile?.avatarUrl"
                  :src="profile.avatarUrl"
                  :alt="profile.name || 'Avatar'"
                  class="w-full h-full object-cover"
                />
                <User v-else class="w-8 h-8 text-gray-400" />
              </div>
              <div class="flex flex-col gap-2">
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    @click="avatarFileInput?.click()"
                    :disabled="uploadingAvatar"
                    class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                  >
                    <Loader2 v-if="uploadingAvatar" class="w-3.5 h-3.5 animate-spin" />
                    <Upload v-else class="w-3.5 h-3.5" />
                    {{ $t('profile.uploadAvatar') }}
                  </button>
                  <button
                    v-if="profile?.avatarUrl"
                    type="button"
                    @click="removeAvatar"
                    :disabled="uploadingAvatar"
                    class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                  >
                    <X class="w-3.5 h-3.5" />
                    {{ $t('profile.removeAvatar') }}
                  </button>
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('profile.avatarHint') }}</p>
              </div>
              <input
                ref="avatarFileInput"
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                class="hidden"
                @change="uploadAvatar"
              />
            </div>
          </div>
          <div class="pt-2 flex justify-end">
            <button type="submit" :disabled="savingProfile" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              <Loader2 v-if="savingProfile" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" />
              {{ savingProfile ? $t('profile.saving') : $t('profile.saveChanges') }}
            </button>
          </div>
        </form>
      </div>

      <!-- Change password -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2">
            <Lock class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('profile.changePassword') }}</h2>
          </div>
        </div>
        <form @submit.prevent="changePassword" class="p-6 space-y-5">
          <div v-if="passwordError" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p class="text-sm text-red-700 dark:text-red-300">{{ passwordError }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('profile.currentPassword') }}</label>
            <input
              v-model="currentPassword"
              type="password"
              required
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('profile.newPassword') }}</label>
            <input
              v-model="newPassword"
              type="password"
              required
              minlength="8"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('profile.confirmNewPassword') }}</label>
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
              {{ changingPassword ? $t('profile.changingPassword') : $t('profile.changePassword') }}
            </button>
          </div>
        </form>
      </div>

      <!-- Connected accounts -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2">
            <Link2 class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('profile.connectedAccounts') }}</h2>
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('profile.connectedAccountsDesc') }}</p>
        </div>
        <div class="p-6 space-y-4">
          <div v-if="loadingOAuth" class="flex items-center justify-center py-4">
            <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
          </div>
          <template v-else>
            <!-- GitHub -->
            <div class="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-gray-900 dark:bg-white flex items-center justify-center">
                  <Github class="w-5 h-5 text-white dark:text-gray-900" />
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">GitHub</p>
                  <p v-if="isConnected('github')" class="text-xs text-green-600 dark:text-green-400">{{ $t('profile.connected') }}</p>
                  <p v-else class="text-xs text-gray-500 dark:text-gray-400">{{ $t('profile.notConnected') }}</p>
                </div>
              </div>
              <button
                v-if="isConnected('github')"
                @click="disconnectProvider('github')"
                :disabled="disconnecting === 'github'"
                class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                <Loader2 v-if="disconnecting === 'github'" class="w-3.5 h-3.5 animate-spin" />
                <Unlink v-else class="w-3.5 h-3.5" />
                {{ $t('profile.disconnect') }}
              </button>
              <button
                v-else
                @click="connectProvider('github')"
                class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
              >
                <Link2 class="w-3.5 h-3.5" />
                {{ $t('profile.connect') }}
              </button>
            </div>

            <!-- Google -->
            <div class="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 flex items-center justify-center">
                  <svg class="w-5 h-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Google</p>
                  <p v-if="isConnected('google')" class="text-xs text-green-600 dark:text-green-400">{{ $t('profile.connected') }}</p>
                  <p v-else class="text-xs text-gray-500 dark:text-gray-400">{{ $t('profile.notConnected') }}</p>
                </div>
              </div>
              <button
                v-if="isConnected('google')"
                @click="disconnectProvider('google')"
                :disabled="disconnecting === 'google'"
                class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                <Loader2 v-if="disconnecting === 'google'" class="w-3.5 h-3.5 animate-spin" />
                <Unlink v-else class="w-3.5 h-3.5" />
                {{ $t('profile.disconnect') }}
              </button>
              <button
                v-else
                @click="connectProvider('google')"
                class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-500 transition-colors"
              >
                <Link2 class="w-3.5 h-3.5" />
                {{ $t('profile.connect') }}
              </button>
            </div>
          </template>
        </div>
      </div>

      <!-- Login methods -->
      <div v-if="loginMethods.some((m) => m.available)" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2">
            <Shield class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('profile.loginMethods') }}</h2>
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('profile.loginMethodsDesc') }}</p>
        </div>
        <div class="p-6 space-y-3">
          <div v-if="loadingLoginMethods" class="flex items-center justify-center py-4">
            <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
          </div>
          <template v-else>
            <div
              v-for="method in loginMethods.filter((m) => m.available)"
              :key="method.method"
              class="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600"
            >
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg flex items-center justify-center" :class="method.method === 'github' ? 'bg-gray-900 dark:bg-white' : method.method === 'google' ? 'bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500' : 'bg-primary-100 dark:bg-primary-900/30'">
                  <Github v-if="method.method === 'github'" class="w-5 h-5 text-white dark:text-gray-900" />
                  <svg v-else-if="method.method === 'google'" class="w-5 h-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <Lock v-else class="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">
                    {{ method.method === 'password' ? $t('profile.passwordLogin') : method.method === 'github' ? 'GitHub' : 'Google' }}
                  </p>
                  <p class="text-xs" :class="method.enabled ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'">
                    {{ method.enabled ? $t('profile.loginEnabled') : $t('profile.loginDisabled') }}
                  </p>
                </div>
              </div>
              <button
                @click="toggleLoginMethod(method.method)"
                :disabled="!canToggleMethod(method) || togglingMethod === method.method"
                :title="!canToggleMethod(method) && method.enabled ? $t('profile.cantDisableLast') : ''"
                class="p-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                :class="method.enabled ? 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20' : 'text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600'"
              >
                <Loader2 v-if="togglingMethod === method.method" class="w-7 h-7 animate-spin" />
                <ToggleRight v-else-if="method.enabled" class="w-7 h-7" />
                <ToggleLeft v-else class="w-7 h-7" />
              </button>
            </div>
          </template>
        </div>
      </div>

      <!-- SSH Keys -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center justify-between">
            <div>
              <div class="flex items-center gap-2">
                <KeyRound class="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <h2 class="text-lg font-semibold text-gray-900 dark:text-white">SSH Keys</h2>
              </div>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage SSH keys for accessing your services and nodes</p>
            </div>
            <button
              @click="showAddKey = !showAddKey"
              class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
            >
              <Plus class="w-4 h-4" />
              Add Key
            </button>
          </div>
        </div>
        <div class="p-6 space-y-4">
          <!-- Add key form -->
          <div v-if="showAddKey" class="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 space-y-3">
            <div v-if="addKeyError" class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p class="text-sm text-red-700 dark:text-red-300">{{ addKeyError }}</p>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
              <input
                v-model="newKeyName"
                type="text"
                placeholder="e.g. My Laptop"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Public Key</label>
              <textarea
                v-model="newKeyPublicKey"
                rows="3"
                placeholder="ssh-ed25519 AAAA... or ssh-rsa AAAA..."
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              />
            </div>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                @click="showAddKey = false; addKeyError = ''"
                class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                @click="addSshKey"
                :disabled="addingKey || !newKeyName.trim() || !newKeyPublicKey.trim()"
                class="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="addingKey" class="w-3.5 h-3.5 animate-spin" />
                <Plus v-else class="w-3.5 h-3.5" />
                Add Key
              </button>
            </div>
          </div>

          <!-- Loading -->
          <div v-if="loadingSshKeys" class="flex items-center justify-center py-4">
            <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
          </div>

          <!-- Keys list -->
          <template v-else>
            <div v-if="sshKeys.length === 0" class="text-center py-8">
              <KeyRound class="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p class="text-sm text-gray-500 dark:text-gray-400">No SSH keys added yet</p>
              <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">Add a key to enable SSH access to your services</p>
            </div>

            <div
              v-for="key in sshKeys"
              :key="key.id"
              class="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class="text-sm font-medium text-gray-900 dark:text-white">{{ key.name }}</p>
                  <span v-if="key.nodeAccess" class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                    Node Access
                  </span>
                </div>
                <div class="flex items-center gap-1.5 mt-1">
                  <code class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">{{ key.fingerprint }}</code>
                  <button
                    @click="copyFingerprint(key.fingerprint)"
                    class="shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    title="Copy fingerprint"
                  >
                    <Check v-if="copiedFingerprint === key.fingerprint" class="w-3 h-3 text-green-500" />
                    <Copy v-else class="w-3 h-3" />
                  </button>
                </div>
                <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                  Added {{ new Date(key.createdAt).toLocaleDateString() }}
                </p>
              </div>
              <button
                @click="deleteSshKey(key.id)"
                :disabled="deletingKeyId === key.id"
                class="shrink-0 ml-4 p-2 rounded-lg text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                title="Delete key"
              >
                <Loader2 v-if="deletingKeyId === key.id" class="w-4 h-4 animate-spin" />
                <Trash2 v-else class="w-4 h-4" />
              </button>
            </div>
          </template>
        </div>
      </div>

      <!-- Data export -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2">
            <Download class="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('profile.dataExport') }}</h2>
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('profile.dataExportDesc') }}</p>
        </div>
        <div class="p-6">
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {{ $t('profile.dataExportDetails') }}
          </p>
          <button
            @click="exportData"
            :disabled="exporting"
            class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            <Loader2 v-if="exporting" class="w-4 h-4 animate-spin" />
            <Download v-else class="w-4 h-4" />
            {{ exporting ? $t('profile.exporting') : $t('profile.downloadMyData') }}
          </button>
        </div>
      </div>

      <!-- Account memberships -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('profile.accountMemberships') }}</h2>
        </div>
        <div class="divide-y divide-gray-200 dark:divide-gray-700">
          <div v-if="accounts.length === 0" class="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            {{ $t('profile.noMemberships') }}
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

      <!-- Delete account (danger zone) -->
      <div v-if="!authUser?.isSuper" class="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-800 shadow-sm">
        <div class="px-6 py-4 border-b border-red-200 dark:border-red-800">
          <div class="flex items-center gap-2">
            <AlertTriangle class="w-5 h-5 text-red-500" />
            <h2 class="text-lg font-semibold text-red-600 dark:text-red-400">{{ $t('profile.dangerZone') }}</h2>
          </div>
        </div>
        <div class="p-6">
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">
            {{ $t('profile.deleteAccountDesc') }}
          </p>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {{ $t('profile.deleteAccountSoleOwner') }}
          </p>
          <button
            @click="showDeleteModal = true"
            class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
          >
            <Trash2 class="w-4 h-4" />
            {{ $t('profile.deleteMyAccount') }}
          </button>
        </div>
      </div>

      <!-- Delete confirmation modal -->
      <Teleport to="body">
        <div v-if="showDeleteModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="fixed inset-0 bg-black/50" @click="showDeleteModal = false" />
          <div class="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-md p-6 space-y-4">
            <div class="flex items-center gap-2">
              <AlertTriangle class="w-5 h-5 text-red-500" />
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('profile.deleteAccountTitle') }}</h3>
            </div>

            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ $t('profile.deleteAccountVerify') }}
            </p>

            <div v-if="deleteError" class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p class="text-sm text-red-700 dark:text-red-300">{{ deleteError }}</p>
            </div>

            <!-- Password verification -->
            <div v-if="profile?.hasPassword">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('profile.password') }}</label>
              <input
                v-model="deletePassword"
                type="password"
                :placeholder="$t('profile.enterPassword')"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div class="flex items-center gap-3">
              <div class="h-px flex-1 bg-gray-200 dark:bg-gray-600" />
              <span class="text-xs text-gray-400">{{ $t('profile.orVerifyEmail') }}</span>
              <div class="h-px flex-1 bg-gray-200 dark:bg-gray-600" />
            </div>

            <!-- Email code verification -->
            <div>
              <div class="flex items-center gap-2 mb-1.5">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('profile.emailCode') }}</label>
                <button
                  type="button"
                  @click="sendDeleteCode"
                  :disabled="sendingCode || codeSent"
                  class="text-xs text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50"
                >
                  <span v-if="codeSent">{{ $t('profile.codeSent') }}</span>
                  <span v-else-if="sendingCode">{{ $t('profile.sendingCode') }}</span>
                  <span v-else>{{ $t('profile.sendCode') }}</span>
                </button>
              </div>
              <input
                v-model="deleteEmailCode"
                type="text"
                inputmode="numeric"
                maxlength="6"
                :placeholder="$t('profile.digitCode')"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div class="flex justify-end gap-3 pt-2">
              <button
                @click="showDeleteModal = false"
                class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {{ $t('profile.cancel') }}
              </button>
              <button
                @click="confirmDelete"
                :disabled="deletingAccount || (!deletePassword && !deleteEmailCode)"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="deletingAccount" class="w-4 h-4 animate-spin" />
                <Trash2 v-else class="w-4 h-4" />
                {{ deletingAccount ? $t('profile.deleting') : $t('profile.deletePermanently') }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>
    </div>
  </div>
</template>
