<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Users, Search, UserCog, ChevronRight } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useAuthStore } from '@/stores/auth'
import { useAccountStore } from '@/stores/account'
import { useI18n } from 'vue-i18n'
import { useAdminPermissions } from '@/composables/useAdminPermissions'
import AdminEmptyState from '@/components/AdminEmptyState.vue'

const { t } = useI18n()
const router = useRouter()
const api = useApi()
const authStore = useAuthStore()
const accountStore = useAccountStore()
const adminPerms = useAdminPermissions()
const canImpersonate = computed(() => adminPerms.can('accounts', 'impersonate'))

const accounts = ref<any[]>([])
const search = ref('')
const loading = ref(true)
const error = ref('')
const page = ref(1)
const totalPages = ref(1)

async function fetchAccounts() {
  loading.value = true
  try {
    const data = await api.get<any>(`/admin/accounts?page=${page.value}&limit=50`)
    accounts.value = data.data ?? []
    totalPages.value = data.pagination?.totalPages ?? 1
  } catch {
    accounts.value = []
  } finally {
    loading.value = false
  }
}

const filteredAccounts = computed(() => {
  if (!search.value) return accounts.value
  const q = search.value.toLowerCase()
  return accounts.value.filter((a: any) =>
    a.name?.toLowerCase().includes(q) ||
    a.slug?.toLowerCase().includes(q)
  )
})

async function impersonate(accountId: string) {
  try {
    const result = await api.post<any>(`/accounts/${accountId}/impersonate`, {})
    if (result.token) {
      // Save original account ID for "Stop Impersonating" (not secret)
      // Token is NOT stored in sessionStorage — on stop we refresh from httpOnly cookie
      const currentAccountId = localStorage.getItem('fleet_account_id')
      if (currentAccountId) sessionStorage.setItem('fleet_original_account_id', currentAccountId)
      sessionStorage.setItem('fleet_impersonating', result.accountId)

      // Set impersonation token (in-memory) and account
      authStore.setToken(result.token)
      localStorage.setItem('fleet_account_id', accountId)

      window.location.href = '/panel'
    }
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to impersonate account'
  }
}

function formatDate(ts: any) {
  if (!ts) return '--'
  const d = new Date(ts)
  return d.toLocaleDateString()
}

onMounted(() => {
  fetchAccounts()
  adminPerms.fetch()
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <Users class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('super.accounts.title') }}</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{{ $t('super.accounts.subtitle') }}</p>
        </div>
      </div>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- Search -->
    <div class="mb-6">
      <div class="relative max-w-md">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="search"
          type="text"
          :placeholder="$t('super.accounts.searchAccounts')"
          class="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
        />
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full admin-table">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.accounts.name') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.accounts.slug') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.accounts.parent') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.accounts.created') }}</th>
              <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.accounts.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="filteredAccounts.length === 0">
              <td colspan="5">
                <AdminEmptyState
                  :icon="search ? Search : Users"
                  :title="search ? $t('super.accounts.noAccountsSearch') : $t('super.accounts.noAccountsFound')"
                />
              </td>
            </tr>
            <tr
              v-for="account in filteredAccounts"
              :key="account.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer"
              @click="router.push({ name: 'super-account-detail', params: { id: account.id } })"
            >
              <td class="px-6 py-4">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-gray-900 dark:text-white">{{ account.name }}</span>
                  <span v-if="account.status === 'suspended'" class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Suspended</span>
                </div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 font-mono">{{ account.slug }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ account.parentId ? account.path?.split('/').slice(-2, -1)[0] || 'Yes' : '--' }}</td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(account.createdAt) }}</td>
              <td class="px-6 py-4 text-right" @click.stop>
                <div class="flex items-center justify-end gap-2">
                  <button
                    v-if="canImpersonate"
                    @click="impersonate(account.id)"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                  >
                    <UserCog class="w-3.5 h-3.5" />
                    {{ $t('super.accounts.impersonate') }}
                  </button>
                  <ChevronRight class="w-4 h-4 text-gray-400" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('super.accounts.pageOf', { page, total: totalPages }) }}</p>
        <div class="flex gap-2">
          <button @click="page--; fetchAccounts()" :disabled="page <= 1" class="px-3 py-1.5 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">{{ $t('super.accounts.previous') }}</button>
          <button @click="page++; fetchAccounts()" :disabled="page >= totalPages" class="px-3 py-1.5 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">{{ $t('super.accounts.next') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
