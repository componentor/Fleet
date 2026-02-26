<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Users, UserPlus, Loader2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useAccountStore } from '@/stores/account'
import { useRole } from '@/composables/useRole'

const { t } = useI18n()
const api = useApi()
const { canAdmin } = useRole()
const accountStore = useAccountStore()

const members = ref<any[]>([])
const loading = ref(true)
const showInvite = ref(false)
const inviteEmail = ref('')
const inviteRole = ref('member')
const inviting = ref(false)
const error = ref('')
const maxUsersPerAccount = ref<number | null>(null)

async function fetchMembers() {
  loading.value = true
  const accountId = accountStore.currentAccount?.id
  if (!accountId) { loading.value = false; return }
  try {
    members.value = await api.get(`/accounts/${accountId}/members`)
  } catch {
    members.value = []
  } finally {
    loading.value = false
  }
}

async function fetchResourceLimits() {
  try {
    const limits = await api.get<any>('/billing/resource-limits')
    maxUsersPerAccount.value = limits.maxUsersPerAccount ?? null
  } catch {
    // best-effort
  }
}

async function inviteMember() {
  if (!inviteEmail.value) return
  const accountId = accountStore.currentAccount?.id
  if (!accountId) return
  inviting.value = true
  error.value = ''
  try {
    await api.post(`/accounts/${accountId}/members`, { email: inviteEmail.value, role: inviteRole.value })
    inviteEmail.value = ''
    showInvite.value = false
    await fetchMembers()
  } catch (err: any) {
    error.value = err?.body?.error || t('users.inviteFailed')
  } finally {
    inviting.value = false
  }
}

async function removeMember(userId: string) {
  if (!confirm(t('users.confirmRemove'))) return
  const accountId = accountStore.currentAccount?.id
  if (!accountId) return
  try {
    await api.del(`/accounts/${accountId}/members/${userId}`)
    await fetchMembers()
  } catch {
    // ignore
  }
}

function formatDate(ts: any) {
  if (!ts) return '--'
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  return d.toLocaleDateString()
}

onMounted(() => {
  fetchMembers()
  fetchResourceLimits()
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <Users class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('users.title') }}</h1>
        <span v-if="maxUsersPerAccount && maxUsersPerAccount > 0" class="ml-2 px-2.5 py-1 rounded-full text-xs font-medium" :class="members.length >= maxUsersPerAccount ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'">
          {{ members.length }} / {{ maxUsersPerAccount }}
        </span>
      </div>
      <div class="flex items-center gap-3">
        <span v-if="maxUsersPerAccount && maxUsersPerAccount > 0 && members.length >= maxUsersPerAccount" class="text-xs text-red-600 dark:text-red-400">
          {{ t('users.limitReached') }}
        </span>
        <button
          v-if="canAdmin"
          @click="showInvite = true"
          :disabled="maxUsersPerAccount != null && maxUsersPerAccount > 0 && members.length >= maxUsersPerAccount"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          <UserPlus class="w-4 h-4" />
          {{ t('users.invite') }}
        </button>
      </div>
    </div>

    <!-- Invite form -->
    <div v-if="showInvite" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">{{ t('users.inviteTitle') }}</h3>
      <div v-if="error" class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>
      <form @submit.prevent="inviteMember" class="flex items-end gap-3">
        <div class="flex-1">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('users.email') }}</label>
          <input v-model="inviteEmail" type="email" :placeholder="t('users.emailPlaceholder')" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
        </div>
        <div class="w-40">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('users.role') }}</label>
          <select v-model="inviteRole" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm">
            <option value="member">{{ t('users.member') }}</option>
            <option value="admin">{{ t('users.admin') }}</option>
            <option value="viewer">{{ t('users.viewer') }}</option>
          </select>
        </div>
        <button type="submit" :disabled="inviting || !inviteEmail" class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
          {{ inviting ? t('users.inviting') : t('users.invite') }}
        </button>
        <button type="button" @click="showInvite = false; error = ''" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
          {{ t('users.cancel') }}
        </button>
      </form>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <!-- Members table -->
    <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('users.name') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('users.email') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('users.role') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('users.joined') }}</th>
              <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('users.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="members.length === 0">
              <td colspan="5" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                {{ t('users.noMembers') }}
              </td>
            </tr>
            <tr v-for="member in members" :key="member.id" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                    <span class="text-xs font-semibold text-primary-700 dark:text-primary-300">{{ member.name?.charAt(0)?.toUpperCase() || '?' }}</span>
                  </div>
                  <span class="text-sm font-medium text-gray-900 dark:text-white">{{ member.name || t('users.unknown') }}</span>
                </div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ member.email }}</td>
              <td class="px-6 py-4 text-sm">
                <span
                  :class="[
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    member.role === 'owner' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' :
                    member.role === 'admin' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                    'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  ]"
                >
                  {{ member.role }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(member.joinedAt) }}</td>
              <td v-if="canAdmin" class="px-6 py-4 text-right">
                <button
                  v-if="member.role !== 'owner'"
                  @click="removeMember(member.id)"
                  class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                >
                  {{ t('users.remove') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
