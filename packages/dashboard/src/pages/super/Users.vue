<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Shield, X, ShieldCheck, ShieldOff, ChevronRight, KeyRound, Github, Lock, Globe, AlertTriangle, Check, Chrome } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'
import { useAdminPermissions } from '@/composables/useAdminPermissions'

const { t } = useI18n()
const api = useApi()
const authStore = useAuthStore()
const adminPerms = useAdminPermissions()
const canWrite = computed(() => adminPerms.can('users', 'write'))

interface Role {
  id: string
  name: string
  permissions: Record<string, string[]>
}

const users = ref<any[]>([])
const roles = ref<Role[]>([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const totalPages = ref(1)
const selectedUser = ref<any | null>(null)
const filter = ref<'all' | 'admins'>('all')
const searchQuery = ref('')
const searchTimeout = ref<ReturnType<typeof setTimeout> | null>(null)

// Region management
const editingRegions = ref(false)
const regionInput = ref('')
const savingRegions = ref(false)

async function fetchUsers() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      limit: '50',
      filter: filter.value,
    })
    if (searchQuery.value) params.set('search', searchQuery.value)
    const data = await api.get<any>(`/admin/users?${params}`)
    users.value = data.data ?? []
    totalPages.value = data.pagination?.totalPages ?? 1
  } catch {
    users.value = []
  } finally {
    loading.value = false
  }
}

async function fetchRoles() {
  try {
    const data = await api.get<any>('/admin/roles')
    roles.value = Array.isArray(data) ? data : (data as any).data ?? []
  } catch {
    roles.value = []
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
      if (selectedUser.value?.id === userId) {
        selectedUser.value = { ...selectedUser.value, isSuper: result.isSuper }
      }
    }
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to update user'
  }
}

async function assignRole(userId: string, roleId: string | null) {
  error.value = ''
  try {
    await api.patch<any>(`/admin/users/${userId}/role`, { adminRoleId: roleId })
    const idx = users.value.findIndex(u => u.id === userId)
    if (idx !== -1) {
      users.value[idx] = { ...users.value[idx], adminRoleId: roleId }
      if (selectedUser.value?.id === userId) {
        selectedUser.value = { ...selectedUser.value, adminRoleId: roleId }
      }
    }
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to assign role'
  }
}

async function saveRegions() {
  if (!selectedUser.value) return
  savingRegions.value = true
  error.value = ''
  try {
    const regions = regionInput.value.trim()
      ? regionInput.value.split(',').map(r => r.trim().toUpperCase()).filter(r => r.length === 2)
      : null
    const result = await api.patch<any>(`/admin/users/${selectedUser.value.id}/regions`, {
      allowedLoginRegions: regions,
    })
    const idx = users.value.findIndex(u => u.id === selectedUser.value?.id)
    if (idx !== -1) {
      users.value[idx] = { ...users.value[idx], allowedLoginRegions: result.allowedLoginRegions }
    }
    selectedUser.value = { ...selectedUser.value, allowedLoginRegions: result.allowedLoginRegions }
    editingRegions.value = false
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to update regions'
  } finally {
    savingRegions.value = false
  }
}

function startEditRegions() {
  regionInput.value = (selectedUser.value?.allowedLoginRegions ?? []).join(', ')
  editingRegions.value = true
}

function getRoleName(roleId: string | null): string {
  if (!roleId) return '--'
  const role = roles.value.find(r => r.id === roleId)
  return role?.name ?? '--'
}

const selectedUserRole = computed(() => {
  if (!selectedUser.value?.adminRoleId) return null
  return roles.value.find(r => r.id === selectedUser.value.adminRoleId) ?? null
})

const selectedUserPermissions = computed(() => {
  const role = selectedUserRole.value
  if (!role?.permissions) return []
  return Object.entries(role.permissions)
    .filter(([, levels]) => levels.length > 0)
    .map(([section, levels]) => ({ section, levels: levels.join(', ') }))
})

const isAdmin = (user: any) => user.isSuper || user.adminRoleId

const adminsWithout2FA = computed(() =>
  users.value.filter(u => isAdmin(u) && !u.twoFactorEnabled)
)

function formatDate(ts: any) {
  if (!ts) return '--'
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function openUser(user: any) {
  selectedUser.value = { ...user }
  editingRegions.value = false
}

function closePanel() {
  selectedUser.value = null
  editingRegions.value = false
}

function switchFilter(f: 'all' | 'admins') {
  filter.value = f
  page.value = 1
  fetchUsers()
}

function onSearch() {
  if (searchTimeout.value) clearTimeout(searchTimeout.value)
  searchTimeout.value = setTimeout(() => {
    page.value = 1
    fetchUsers()
  }, 300)
}

onMounted(() => {
  fetchUsers()
  fetchRoles()
  adminPerms.fetch()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-6">
      <Shield class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('super.users.title') }}</h1>
    </div>

    <!-- Security Alert: Admins without 2FA -->
    <div v-if="adminsWithout2FA.length > 0 && filter === 'admins'" class="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-3">
      <AlertTriangle class="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
      <div>
        <p class="text-sm font-medium text-amber-800 dark:text-amber-200">{{ $t('super.users.securityWarning') }}</p>
        <p class="text-xs text-amber-600 dark:text-amber-400 mt-1">
          {{ $t('super.users.adminsWithout2fa', { count: adminsWithout2FA.length }) }}:
          <span class="font-medium">{{ adminsWithout2FA.map(u => u.email).join(', ') }}</span>
        </p>
      </div>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center justify-between">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      <button @click="error = ''" class="text-red-400 hover:text-red-600 dark:hover:text-red-300">
        <X class="w-4 h-4" />
      </button>
    </div>

    <!-- Filter tabs + Search -->
    <div class="flex items-center justify-between mb-4 gap-4">
      <div class="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
        <button
          @click="switchFilter('all')"
          :class="['px-4 py-2 rounded-md text-sm font-medium transition-colors', filter === 'all' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white']"
        >
          {{ $t('super.users.allUsers') }}
        </button>
        <button
          @click="switchFilter('admins')"
          :class="['px-4 py-2 rounded-md text-sm font-medium transition-colors', filter === 'admins' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white']"
        >
          {{ $t('super.users.adminsOnly') }}
        </button>
      </div>
      <input
        v-model="searchQuery"
        @input="onSearch"
        type="text"
        :placeholder="$t('common.search')"
        class="w-64 px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
      />
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.users.name') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.users.email') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.users.role') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.users.security') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.users.loginMethods') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('super.users.regions') }}</th>
              <th class="px-6 py-3.5 w-10"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="users.length === 0">
              <td colspan="7" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                {{ $t('super.users.noUsersFound') }}
              </td>
            </tr>
            <tr
              v-for="user in users"
              :key="user.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer"
              :class="selectedUser?.id === user.id ? 'bg-primary-50 dark:bg-primary-900/10' : ''"
              @click="openUser(user)"
            >
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                    <span class="text-xs font-semibold text-primary-700 dark:text-primary-300">{{ user.name?.charAt(0)?.toUpperCase() || '?' }}</span>
                  </div>
                  <div class="min-w-0">
                    <span class="text-sm font-medium text-gray-900 dark:text-white block truncate">{{ user.name || $t('super.users.unknown') }}</span>
                    <span v-if="user.id === authStore.user?.id" class="text-[10px] font-medium text-primary-600 dark:text-primary-400">{{ $t('super.users.you') }}</span>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ user.email }}</td>
              <td class="px-6 py-4 text-sm">
                <span v-if="user.isSuper" class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                  {{ $t('super.users.superAdmin') }}
                </span>
                <span v-else-if="user.adminRoleId" class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                  {{ getRoleName(user.adminRoleId) }}
                </span>
                <span v-else class="text-gray-400 dark:text-gray-500 text-xs">{{ $t('super.users.noRole') }}</span>
              </td>
              <td class="px-6 py-4">
                <div class="flex items-center gap-1.5">
                  <span
                    :class="[
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                      user.twoFactorEnabled
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        : isAdmin(user)
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    ]"
                  >
                    <Lock class="w-3 h-3" />
                    {{ user.twoFactorEnabled ? '2FA' : $t('super.users.no2fa') }}
                  </span>
                </div>
              </td>
              <td class="px-6 py-4">
                <div class="flex items-center gap-1.5">
                  <span v-if="user.loginMethods?.includes('password')" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    <KeyRound class="w-3 h-3" />
                  </span>
                  <span v-if="user.loginMethods?.includes('github')" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    <Github class="w-3 h-3" />
                  </span>
                  <span v-if="user.loginMethods?.includes('google')" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    <Chrome class="w-3 h-3" />
                  </span>
                </div>
              </td>
              <td class="px-6 py-4 text-sm">
                <div v-if="user.allowedLoginRegions && user.allowedLoginRegions.length > 0" class="flex items-center gap-1">
                  <Globe class="w-3.5 h-3.5 text-blue-500" />
                  <span class="text-xs font-medium text-gray-600 dark:text-gray-300">{{ user.allowedLoginRegions.join(', ') }}</span>
                </div>
                <span v-else-if="isAdmin(user)" class="text-xs text-gray-400 dark:text-gray-500">{{ $t('super.users.allRegions') }}</span>
                <span v-else class="text-xs text-gray-300 dark:text-gray-600">--</span>
              </td>
              <td class="px-6 py-4 text-right">
                <ChevronRight class="w-4 h-4 text-gray-400" />
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

    <!-- User Detail Side Panel -->
    <Teleport to="body">
      <Transition name="slide">
        <div v-if="selectedUser" class="fixed inset-0 z-50 flex justify-end" @click.self="closePanel">
          <div class="fixed inset-0 bg-black/30" @click="closePanel" />
          <div class="relative w-full max-w-md bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 shadow-xl overflow-y-auto">
            <!-- Header -->
            <div class="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('super.users.userDetail') }}</h2>
              <button @click="closePanel" class="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <X class="w-5 h-5" />
              </button>
            </div>

            <div class="p-6 space-y-6">
              <!-- User identity -->
              <div class="flex items-center gap-4">
                <div class="w-14 h-14 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shrink-0">
                  <span class="text-xl font-bold text-primary-700 dark:text-primary-300">{{ selectedUser.name?.charAt(0)?.toUpperCase() || '?' }}</span>
                </div>
                <div class="min-w-0">
                  <h3 class="text-base font-semibold text-gray-900 dark:text-white truncate">{{ selectedUser.name || $t('super.users.unknown') }}</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400 truncate">{{ selectedUser.email }}</p>
                </div>
              </div>

              <!-- Security Status -->
              <div>
                <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{{ $t('super.users.security') }}</h4>
                <div class="space-y-3">
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('super.users.twoFactor') }}</span>
                    <span :class="['inline-flex items-center gap-1.5 text-sm font-medium', selectedUser.twoFactorEnabled ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400']">
                      <component :is="selectedUser.twoFactorEnabled ? Check : AlertTriangle" class="w-3.5 h-3.5" />
                      {{ selectedUser.twoFactorEnabled ? $t('common.enabled') : $t('common.disabled') }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('super.users.emailVerified') }}</span>
                    <span :class="['text-sm font-medium', selectedUser.emailVerified ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400']">
                      {{ selectedUser.emailVerified ? $t('common.yes') : $t('common.no') }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('super.users.loginMethods') }}</span>
                    <div class="flex items-center gap-1.5">
                      <span v-if="selectedUser.loginMethods?.includes('password')" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300" :title="$t('super.users.passwordLogin')">
                        <KeyRound class="w-3 h-3" /> {{ $t('super.users.passwordLogin') }}
                      </span>
                      <span v-if="selectedUser.loginMethods?.includes('github')" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        <Github class="w-3 h-3" /> GitHub
                      </span>
                      <span v-if="selectedUser.loginMethods?.includes('google')" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        <Chrome class="w-3 h-3" /> Google
                      </span>
                    </div>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('common.created') }}</span>
                    <span class="text-sm font-medium text-gray-900 dark:text-white">{{ formatDate(selectedUser.createdAt) }}</span>
                  </div>
                </div>
              </div>

              <!-- Login Region Restrictions (admin users only) -->
              <div v-if="isAdmin(selectedUser)">
                <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{{ $t('super.users.loginRegions') }}</h4>

                <div v-if="!editingRegions">
                  <div v-if="selectedUser.allowedLoginRegions && selectedUser.allowedLoginRegions.length > 0" class="flex flex-wrap gap-1.5 mb-3">
                    <span
                      v-for="region in selectedUser.allowedLoginRegions"
                      :key="region"
                      class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                    >
                      <Globe class="w-3 h-3" />
                      {{ region }}
                    </span>
                  </div>
                  <p v-else class="text-sm text-gray-500 dark:text-gray-400 mb-3">
                    {{ $t('super.users.noRegionRestrictions') }}
                  </p>
                  <button
                    v-if="canWrite"
                    @click="startEditRegions"
                    class="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium"
                  >
                    {{ $t('super.users.editRegions') }}
                  </button>
                </div>

                <div v-else class="space-y-3">
                  <div>
                    <label class="block text-sm text-gray-600 dark:text-gray-400 mb-1.5">{{ $t('super.users.regionCodes') }}</label>
                    <input
                      v-model="regionInput"
                      type="text"
                      :placeholder="$t('super.users.regionPlaceholder')"
                      class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ $t('super.users.regionHint') }}</p>
                  </div>
                  <div class="flex gap-2">
                    <button
                      @click="saveRegions"
                      :disabled="savingRegions"
                      class="px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
                    >
                      {{ savingRegions ? $t('common.saving') : $t('common.save') }}
                    </button>
                    <button
                      @click="editingRegions = false"
                      class="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      {{ $t('common.cancel') }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- Access Control -->
              <div>
                <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{{ $t('super.users.accessControl') }}</h4>
                <div class="space-y-4">
                  <!-- Super Admin Toggle -->
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-gray-600 dark:text-gray-400">{{ $t('super.users.superAdmin') }}</span>
                    <div v-if="selectedUser.id === authStore.user?.id" class="text-xs text-gray-400 dark:text-gray-500">{{ $t('super.users.you') }}</div>
                    <button
                      v-else-if="canWrite"
                      @click="toggleSuper(selectedUser.id, selectedUser.isSuper)"
                      :class="[
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        selectedUser.isSuper
                          ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30'
                          : 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/30'
                      ]"
                    >
                      <component :is="selectedUser.isSuper ? ShieldOff : ShieldCheck" class="w-3.5 h-3.5" />
                      {{ selectedUser.isSuper ? $t('super.users.revokeSuper') : $t('super.users.grantSuper') }}
                    </button>
                  </div>

                  <!-- Role Assignment -->
                  <div>
                    <label class="block text-sm text-gray-600 dark:text-gray-400 mb-1.5">{{ $t('super.users.adminRole') }}</label>
                    <div v-if="selectedUser.isSuper" class="text-sm text-purple-600 dark:text-purple-400 font-medium">
                      {{ $t('super.users.superAdminAccess') }}
                    </div>
                    <select
                      v-else
                      :value="selectedUser.adminRoleId ?? ''"
                      @change="assignRole(selectedUser.id, ($event.target as HTMLSelectElement).value || null)"
                      :disabled="!canWrite"
                      class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
                    >
                      <option value="">{{ $t('super.users.noRole') }}</option>
                      <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
                    </select>
                  </div>
                </div>
              </div>

              <!-- Permissions Summary -->
              <div v-if="!selectedUser.isSuper && selectedUserRole">
                <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{{ $t('super.users.permissions') }}</h4>
                <div v-if="selectedUserPermissions.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
                  {{ $t('super.users.noPermissions') }}
                </div>
                <div v-else class="space-y-1.5">
                  <div
                    v-for="perm in selectedUserPermissions"
                    :key="perm.section"
                    class="flex items-center justify-between py-1.5 px-3 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                  >
                    <span class="text-sm text-gray-700 dark:text-gray-300 capitalize">{{ perm.section }}</span>
                    <span class="text-xs text-gray-500 dark:text-gray-400">{{ perm.levels }}</span>
                  </div>
                </div>
              </div>

              <div v-if="selectedUser.isSuper" class="p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                <p class="text-xs text-purple-700 dark:text-purple-300">{{ $t('super.users.superAdminAccess') }}</p>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: all 0.2s ease;
}
.slide-enter-active > div:last-child,
.slide-leave-active > div:last-child {
  transition: transform 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
}
.slide-enter-from > div:last-child,
.slide-leave-to > div:last-child {
  transform: translateX(100%);
}
</style>
