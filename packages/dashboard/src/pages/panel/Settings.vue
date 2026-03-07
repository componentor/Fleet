<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Settings, Save, AlertTriangle, Calendar, ShieldX, Package, Plus, Trash2, Github } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useAccountStore } from '@/stores/account'
import { useRole } from '@/composables/useRole'

const { t } = useI18n()
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
const scheduledDeletionAt = ref<string | null>(null)
const deletePassword = ref('')
const showDeleteConfirm = ref(false)
const deleting = ref(false)
const revoking = ref(false)


async function loadAccount() {
  loading.value = true
  const accountId = accountStore.currentAccount?.id
  if (!accountId) { loading.value = false; return }
  try {
    const account = await api.get<any>(`/accounts/${accountId}`)
    accountName.value = account.name || ''
    accountSlug.value = account.slug || ''
    scheduledDeletionAt.value = account.scheduledDeletionAt || null
  } catch {
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
    success.value = t('settings.saved')
    await accountStore.fetchAccounts()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || t('settings.saveFailed')
  } finally {
    saving.value = false
  }
}

async function disconnectFromParent() {
  if (!confirm(t('settings.disconnectConfirm'))) return
  const accountId = accountStore.currentAccount?.id
  if (!accountId) return
  try {
    await api.post(`/accounts/${accountId}/disconnect`, {})
    success.value = t('settings.disconnected')
    await accountStore.fetchAccounts()
  } catch (err: any) {
    error.value = err?.body?.error || t('settings.disconnectFailed')
  }
}

async function scheduleDelete() {
  if (!deletePassword.value) {
    error.value = t('settings.passwordRequired')
    return
  }
  const accountId = accountStore.currentAccount?.id
  if (!accountId) return
  deleting.value = true
  error.value = ''
  try {
    const res = await api.del<any>(`/accounts/${accountId}`, { password: deletePassword.value })
    scheduledDeletionAt.value = res.scheduledDeletionAt || null
    showDeleteConfirm.value = false
    deletePassword.value = ''
    success.value = t('settings.deletionScheduled')
  } catch (err: any) {
    error.value = err?.body?.error || t('settings.deleteFailed')
  } finally {
    deleting.value = false
  }
}

async function revokeDeletion() {
  const accountId = accountStore.currentAccount?.id
  if (!accountId) return
  revoking.value = true
  error.value = ''
  try {
    await api.post(`/accounts/${accountId}/revoke-deletion`, {})
    scheduledDeletionAt.value = null
    success.value = t('settings.deletionRevoked')
    await accountStore.fetchAccounts()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || t('settings.revokeFailed')
  } finally {
    revoking.value = false
  }
}


// Registry credentials
const registryCreds = ref<Array<{ id: string; registry: string; username: string; createdAt: string | null }>>([])
const registryCredsLoading = ref(false)
const newRegRegistry = ref('')
const newRegUsername = ref('')
const newRegPassword = ref('')
const addingReg = ref(false)
const connectingGithub = ref(false)

async function loadRegistryCreds() {
  try {
    const data = await api.get<{ credentials: typeof registryCreds.value }>('/registry-credentials/account')
    registryCreds.value = data.credentials
  } catch {}
}

async function addRegistryCred() {
  if (!newRegRegistry.value || !newRegUsername.value || !newRegPassword.value) return
  addingReg.value = true
  try {
    await api.post('/registry-credentials/account', {
      registry: newRegRegistry.value,
      username: newRegUsername.value,
      password: newRegPassword.value,
    })
    newRegRegistry.value = ''
    newRegUsername.value = ''
    newRegPassword.value = ''
    await loadRegistryCreds()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to add credential'
  } finally {
    addingReg.value = false
  }
}

async function deleteRegistryCred(id: string) {
  if (!confirm('Remove this registry credential?')) return
  try {
    await api.del(`/registry-credentials/account/${id}`)
    await loadRegistryCreds()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to remove credential'
  }
}

async function connectGithubPackages() {
  connectingGithub.value = true
  try {
    await api.post('/registry-credentials/account/github', {})
    await loadRegistryCreds()
    success.value = 'GitHub Packages connected'
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to connect GitHub Packages'
  } finally {
    connectingGithub.value = false
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

onMounted(() => {
  loadAccount()
  loadRegistryCreds()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Settings class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('settings.accountSettings') }}</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <div v-else class="space-y-8 max-w-2xl">
      <div v-if="error" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>
      <div v-if="success" class="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
        <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
      </div>

      <!-- Scheduled deletion banner -->
      <div v-if="scheduledDeletionAt" class="p-5 bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-xl">
        <div class="flex items-start gap-3">
          <Calendar class="w-6 h-6 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div class="flex-1">
            <h3 class="text-base font-semibold text-red-700 dark:text-red-300">{{ $t('settings.deletionScheduledTitle') }}</h3>
            <p class="text-sm text-red-600 dark:text-red-400 mt-1">
              {{ $t('settings.deletionScheduledDesc', { date: formatDate(scheduledDeletionAt), days: daysUntil(scheduledDeletionAt) }) }}
            </p>
            <p class="text-xs text-red-500 dark:text-red-500 mt-2">{{ $t('settings.deletionScheduledNote') }}</p>
            <button
              @click="revokeDeletion"
              :disabled="revoking"
              class="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-gray-800 border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 text-sm font-medium transition-colors"
            >
              <CompassSpinner v-if="revoking" size="w-4 h-4" />
              <ShieldX v-else class="w-4 h-4" />
              {{ revoking ? $t('common.loading') : $t('settings.cancelDeletion') }}
            </button>
          </div>
        </div>
      </div>

      <!-- General settings -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('settings.general') }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('settings.generalDesc') }}</p>
        </div>
        <form @submit.prevent="saveSettings" class="p-6 space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('settings.accountName') }}</label>
            <input
              v-model="accountName"
              type="text"
              placeholder="My Account"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('settings.accountSlug') }}</label>
            <input
              v-model="accountSlug"
              type="text"
              placeholder="my-account"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
            />
            <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">{{ $t('settings.slugHint') }}</p>
          </div>
          <div v-if="canAdmin" class="pt-2 flex justify-end">
            <button type="submit" :disabled="saving" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              <CompassSpinner v-if="saving" size="w-4 h-4" />
              <Save v-else class="w-4 h-4" />
              {{ saving ? $t('common.saving') : $t('settings.saveChanges') }}
            </button>
          </div>
        </form>
      </div>

      <!-- Registry Credentials -->
      <div v-if="canAdmin" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2">
            <Package class="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Registry Credentials</h2>
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage private Docker registry credentials for deploying from registries</p>
        </div>
        <div class="p-6 space-y-5">
          <!-- Add credential form -->
          <div class="space-y-3">
            <div class="grid grid-cols-3 gap-3">
              <input
                v-model="newRegRegistry"
                type="text"
                placeholder="ghcr.io"
                class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
              <input
                v-model="newRegUsername"
                type="text"
                placeholder="Username"
                class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
              <input
                v-model="newRegPassword"
                type="password"
                placeholder="Password / Token"
                class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>
            <div class="flex items-center gap-3">
              <button
                @click="addRegistryCred"
                :disabled="addingReg || !newRegRegistry || !newRegUsername || !newRegPassword"
                class="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <CompassSpinner v-if="addingReg" size="w-3.5 h-3.5" />
                <Plus v-else class="w-3.5 h-3.5" />
                Add Credential
              </button>
              <button
                @click="connectGithubPackages"
                :disabled="connectingGithub"
                class="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors"
              >
                <CompassSpinner v-if="connectingGithub" size="w-3.5 h-3.5" />
                <Github v-else class="w-3.5 h-3.5" />
                Connect GitHub Packages
              </button>
            </div>
          </div>

          <!-- Existing credentials -->
          <div v-if="registryCreds.length > 0" class="space-y-2">
            <div
              v-for="cred in registryCreds"
              :key="cred.id"
              class="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50"
            >
              <div>
                <span class="text-sm font-medium text-gray-900 dark:text-white font-mono">{{ cred.registry }}</span>
                <span class="text-sm text-gray-500 dark:text-gray-400 ml-2">({{ cred.username }})</span>
              </div>
              <button
                @click="deleteRegistryCred(cred.id)"
                class="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                title="Remove"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </div>
          <p v-else class="text-xs text-gray-400 dark:text-gray-500">No registry credentials configured. Add one to deploy from private registries.</p>
        </div>
      </div>

      <!-- Danger zone -->
      <div v-if="canOwner" class="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-800 shadow-sm">
        <div class="px-6 py-4 border-b border-red-200 dark:border-red-800">
          <div class="flex items-center gap-2">
            <AlertTriangle class="w-5 h-5 text-red-600 dark:text-red-400" />
            <h2 class="text-lg font-semibold text-red-600 dark:text-red-400">{{ $t('settings.dangerZone') }}</h2>
          </div>
        </div>
        <div class="p-6 space-y-6">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-medium text-gray-900 dark:text-white">{{ $t('settings.disconnectParent') }}</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ $t('settings.disconnectParentDesc') }}</p>
            </div>
            <button @click="disconnectFromParent" class="px-4 py-2 rounded-lg border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors">
              {{ $t('settings.disconnect') }}
            </button>
          </div>

          <div class="border-t border-gray-200 dark:border-gray-700"></div>

          <div v-if="!scheduledDeletionAt">
            <div class="flex items-center justify-between gap-6">
              <div>
                <h3 class="text-sm font-medium text-gray-900 dark:text-white">{{ $t('settings.deleteAccount') }}</h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ $t('settings.deleteAccountDesc') }}</p>
              </div>
              <button @click="showDeleteConfirm = true" class="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors whitespace-nowrap">
                {{ $t('settings.deleteAccount') }}
              </button>
            </div>

            <!-- Password confirmation for deletion -->
            <div v-if="showDeleteConfirm" class="mt-4 p-4 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-200 dark:border-red-800">
              <p class="text-sm text-red-700 dark:text-red-300 mb-3">{{ $t('settings.deleteConfirmDesc') }}</p>
              <div class="mb-3">
                <label class="block text-xs font-medium text-red-700 dark:text-red-300 mb-1.5">{{ $t('settings.confirmPassword') }}</label>
                <input
                  v-model="deletePassword"
                  type="password"
                  :placeholder="$t('settings.confirmPassword')"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-red-300 dark:border-red-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
                  @keyup.enter="scheduleDelete"
                />
              </div>
              <div class="flex items-center gap-3">
                <button
                  @click="scheduleDelete"
                  :disabled="deleting || !deletePassword"
                  class="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  <CompassSpinner v-if="deleting" size="w-4 h-4" />
                  {{ deleting ? $t('common.loading') : $t('settings.confirmDeletion') }}
                </button>
                <button @click="showDeleteConfirm = false; deletePassword = ''" class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700">
                  {{ $t('common.cancel') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
