<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Shield, Loader2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const api = useApi()
const authStore = useAuthStore()

const users = ref<any[]>([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const totalPages = ref(1)

async function fetchUsers() {
  loading.value = true
  try {
    const data = await api.get<any>(`/admin/users?page=${page.value}&limit=50`)
    users.value = data.data ?? []
    totalPages.value = data.pagination?.totalPages ?? 1
  } catch {
    users.value = []
  } finally {
    loading.value = false
  }
}

async function toggleSuper(userId: string, currentlySuper: boolean) {
  const action = currentlySuper ? 'remove super admin status from' : 'grant super admin status to'
  if (!confirm(`Are you sure you want to ${action} this user?`)) return
  error.value = ''
  try {
    const result = await api.patch<any>(`/admin/users/${userId}/super`, {})
    const idx = users.value.findIndex(u => u.id === userId)
    if (idx !== -1) {
      users.value[idx] = { ...users.value[idx], isSuper: result.isSuper }
    }
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to update user'
  }
}

function formatDate(ts: any) {
  if (!ts) return '--'
  const d = new Date(ts)
  return d.toLocaleDateString()
}

onMounted(() => {
  fetchUsers()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Shield class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('super.users.title') }}</h1>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.users.name') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.users.email') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.users.superAdmin') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('common.created') }}</th>
              <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="users.length === 0">
              <td colspan="5" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                {{ $t('super.users.noUsersFound') }}
              </td>
            </tr>
            <tr
              v-for="user in users"
              :key="user.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
            >
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                    <span class="text-xs font-semibold text-primary-700 dark:text-primary-300">{{ user.name?.charAt(0)?.toUpperCase() || '?' }}</span>
                  </div>
                  <span class="text-sm font-medium text-gray-900 dark:text-white">{{ user.name || $t('super.users.unknown') }}</span>
                </div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ user.email }}</td>
              <td class="px-6 py-4 text-sm">
                <span
                  :class="[
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    user.isSuper
                      ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  ]"
                >
                  {{ user.isSuper ? $t('common.yes') : $t('common.no') }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(user.createdAt) }}</td>
              <td class="px-6 py-4 text-right">
                <span
                  v-if="user.id === authStore.user?.id"
                  class="text-xs font-medium text-gray-400 dark:text-gray-500"
                >{{ $t('super.users.you') }}</span>
                <button
                  v-else
                  @click="toggleSuper(user.id, user.isSuper)"
                  :class="[
                    'text-xs font-medium hover:underline',
                    user.isSuper ? 'text-red-600 dark:text-red-400' : 'text-primary-600 dark:text-primary-400'
                  ]"
                >
                  {{ user.isSuper ? $t('super.users.revokeSuper') : $t('super.users.grantSuper') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ $t('super.users.pageOf', { page, total: totalPages }) }}</p>
        <div class="flex gap-2">
          <button @click="page--; fetchUsers()" :disabled="page <= 1" class="px-3 py-1.5 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">{{ $t('super.users.previous') }}</button>
          <button @click="page++; fetchUsers()" :disabled="page >= totalPages" class="px-3 py-1.5 rounded text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">{{ $t('super.users.next') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
