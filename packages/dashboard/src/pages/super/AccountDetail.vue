<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  ArrowLeft, Users, Box, Shield, DollarSign, Activity, UserCog,
  Cpu, MemoryStick, HardDrive, Container, Zap, Ban, CheckCircle, Clock,
  Save, Trash2, ExternalLink,
} from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const api = useApi()
const authStore = useAuthStore()

const accountId = computed(() => route.params.id as string)

type Tab = 'overview' | 'services' | 'users' | 'billing'
const activeTab = ref<Tab>('overview')

const account = ref<any>(null)
const loading = ref(true)
const error = ref('')
const success = ref('')

// Billing override form
const overrideForm = ref({
  discountPercent: null as number | null,
  customPriceCents: null as number | null,
  notes: '' as string,
  cpuCentsPerHourOverride: null as number | null,
  memoryCentsPerGbHourOverride: null as number | null,
  storageCentsPerGbMonthOverride: null as number | null,
  bandwidthCentsPerGbOverride: null as number | null,
  containerCentsPerHourOverride: null as number | null,
  maxFreeServices: null as number | null,
  freeTierCpuLimit: null as number | null,
  freeTierMemoryLimit: null as number | null,
  freeTierContainerLimit: null as number | null,
  freeTierStorageLimit: null as number | null,
  boostCpuLimit: null as number | null,
  boostMemoryLimit: null as number | null,
  boostContainerLimit: null as number | null,
  boostStorageLimit: null as number | null,
})

// Resource limits form
const limitsForm = ref({
  maxCpuPerContainer: null as number | null,
  maxMemoryPerContainer: null as number | null,
  maxReplicas: null as number | null,
  maxContainers: null as number | null,
  maxStorageGb: null as number | null,
  maxBandwidthGb: null as number | null,
  maxTotalCpuCores: null as number | null,
  maxTotalMemoryMb: null as number | null,
})

// Account edit form
const editForm = ref({ name: '', currency: '' })

const saving = ref(false)
const savingOverride = ref(false)
const savingLimits = ref(false)
const suspending = ref(false)

async function fetchAccount() {
  loading.value = true
  error.value = ''
  try {
    account.value = await api.get<any>(`/admin/accounts/${accountId.value}`)
    editForm.value = {
      name: account.value.name ?? '',
      currency: account.value.currency ?? 'USD',
    }
    populateOverrideForm()
    populateLimitsForm()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to load account'
  } finally {
    loading.value = false
  }
}

function populateOverrideForm() {
  const o = account.value?.billingOverride
  overrideForm.value = {
    discountPercent: o?.discountPercent ?? null,
    customPriceCents: o?.customPriceCents ?? null,
    notes: o?.notes ?? '',
    cpuCentsPerHourOverride: o?.cpuCentsPerHourOverride ?? null,
    memoryCentsPerGbHourOverride: o?.memoryCentsPerGbHourOverride ?? null,
    storageCentsPerGbMonthOverride: o?.storageCentsPerGbMonthOverride ?? null,
    bandwidthCentsPerGbOverride: o?.bandwidthCentsPerGbOverride ?? null,
    containerCentsPerHourOverride: o?.containerCentsPerHourOverride ?? null,
    maxFreeServices: o?.maxFreeServices ?? null,
    freeTierCpuLimit: o?.freeTierCpuLimit ?? null,
    freeTierMemoryLimit: o?.freeTierMemoryLimit ?? null,
    freeTierContainerLimit: o?.freeTierContainerLimit ?? null,
    freeTierStorageLimit: o?.freeTierStorageLimit ?? null,
    boostCpuLimit: o?.boostCpuLimit ?? null,
    boostMemoryLimit: o?.boostMemoryLimit ?? null,
    boostContainerLimit: o?.boostContainerLimit ?? null,
    boostStorageLimit: o?.boostStorageLimit ?? null,
  }
}

function populateLimitsForm() {
  const l = account.value?.resourceLimit
  limitsForm.value = {
    maxCpuPerContainer: l?.maxCpuPerContainer ?? null,
    maxMemoryPerContainer: l?.maxMemoryPerContainer ?? null,
    maxReplicas: l?.maxReplicas ?? null,
    maxContainers: l?.maxContainers ?? null,
    maxStorageGb: l?.maxStorageGb ?? null,
    maxBandwidthGb: l?.maxBandwidthGb ?? null,
    maxTotalCpuCores: l?.maxTotalCpuCores ?? null,
    maxTotalMemoryMb: l?.maxTotalMemoryMb ?? null,
  }
}

async function saveAccount() {
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await api.patch<any>(`/admin/accounts/${accountId.value}`, {
      name: editForm.value.name,
      currency: editForm.value.currency,
    })
    success.value = 'Account updated'
    await fetchAccount()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to update account'
  } finally {
    saving.value = false
  }
}

async function saveOverride() {
  savingOverride.value = true
  error.value = ''
  success.value = ''
  try {
    const data: Record<string, any> = {}
    for (const [key, val] of Object.entries(overrideForm.value)) {
      data[key] = val === 0 && key !== 'discountPercent' ? null : (val || null)
    }
    if (overrideForm.value.discountPercent != null) data.discountPercent = overrideForm.value.discountPercent
    if (overrideForm.value.notes) data.notes = overrideForm.value.notes
    await api.patch<any>(`/billing/admin/account-overrides/${accountId.value}`, data)
    success.value = 'Billing override saved'
    await fetchAccount()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save billing override'
  } finally {
    savingOverride.value = false
  }
}

async function deleteOverride() {
  if (!confirm('Remove all billing overrides for this account?')) return
  savingOverride.value = true
  error.value = ''
  try {
    await api.del(`/billing/admin/account-overrides/${accountId.value}`)
    success.value = 'Billing override removed'
    await fetchAccount()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to remove override'
  } finally {
    savingOverride.value = false
  }
}

async function saveLimits() {
  savingLimits.value = true
  error.value = ''
  success.value = ''
  try {
    const data: Record<string, any> = {}
    for (const [key, val] of Object.entries(limitsForm.value)) {
      data[key] = val === 0 ? null : (val || null)
    }
    await api.patch<any>(`/billing/admin/resource-limits/${accountId.value}`, data)
    success.value = 'Resource limits saved'
    await fetchAccount()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save resource limits'
  } finally {
    savingLimits.value = false
  }
}

async function deleteLimits() {
  if (!confirm('Remove all resource limit overrides for this account?')) return
  savingLimits.value = true
  error.value = ''
  try {
    await api.del(`/billing/admin/resource-limits/${accountId.value}`)
    success.value = 'Resource limits removed'
    await fetchAccount()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to remove limits'
  } finally {
    savingLimits.value = false
  }
}

async function suspendAccount() {
  if (!confirm(`Suspend account "${account.value?.name}"? This will stop all running services.`)) return
  suspending.value = true
  error.value = ''
  try {
    await api.post<any>(`/billing/admin/accounts/${accountId.value}/suspend`, { scheduleDeletionDays: 30 })
    success.value = 'Account suspended'
    await fetchAccount()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to suspend account'
  } finally {
    suspending.value = false
  }
}

async function unsuspendAccount() {
  suspending.value = true
  error.value = ''
  try {
    await api.post<any>(`/billing/admin/accounts/${accountId.value}/unsuspend`, {})
    success.value = 'Account unsuspended'
    await fetchAccount()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to unsuspend account'
  } finally {
    suspending.value = false
  }
}

async function impersonate() {
  try {
    const result = await api.post<any>(`/accounts/${accountId.value}/impersonate`, {})
    if (result.token) {
      const currentAccountId = localStorage.getItem('fleet_account_id')
      if (currentAccountId) sessionStorage.setItem('fleet_original_account_id', currentAccountId)
      sessionStorage.setItem('fleet_impersonating', result.accountId)
      authStore.setToken(result.token)
      localStorage.setItem('fleet_account_id', accountId.value)
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

function statusColor(status: string) {
  if (status === 'running') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  if (status === 'stopped' || status === 'failed' || status === 'error') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
}

const runningServices = computed(() => (account.value?.services ?? []).filter((s: any) => s.status === 'running').length)
const totalCpu = computed(() => (account.value?.services ?? []).reduce((sum: number, s: any) => sum + ((s.cpuLimit || 0) * (s.replicas || 1)), 0))
const totalMemory = computed(() => (account.value?.services ?? []).reduce((sum: number, s: any) => sum + ((s.memoryLimit || 0) * (s.replicas || 1)), 0))

onMounted(() => fetchAccount())
watch(accountId, () => fetchAccount())
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-6">
      <div class="flex items-center gap-3">
        <button @click="router.push({ name: 'super-accounts' })" class="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <ArrowLeft class="w-5 h-5" />
        </button>
        <Shield class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ account?.name ?? 'Account' }}</h1>
          <p v-if="account?.slug" class="text-sm text-gray-500 dark:text-gray-400 font-mono">{{ account.slug }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="account?.status === 'suspended'" class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
          <Ban class="w-3.5 h-3.5" /> Suspended
        </span>
        <span v-else-if="account?.status === 'active'" class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
          <CheckCircle class="w-3.5 h-3.5" /> Active
        </span>
        <button @click="impersonate" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-600 hover:bg-primary-700 text-white transition-colors">
          <UserCog class="w-3.5 h-3.5" /> Impersonate
        </button>
      </div>
    </div>

    <!-- Alerts -->
    <div v-if="error" class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>
    <div v-if="success" class="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
      <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-8 h-8" />
    </div>

    <template v-else-if="account">
      <!-- Tabs -->
      <div class="flex items-center gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
        <button v-for="tab in (['overview', 'services', 'users', 'billing'] as Tab[])" :key="tab"
          @click="activeTab = tab"
          :class="['px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px capitalize',
            activeTab === tab
              ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']"
        >
          {{ tab }}
        </button>
      </div>

      <!-- Overview Tab -->
      <div v-if="activeTab === 'overview'" class="space-y-6">
        <!-- Stats -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div class="flex items-center gap-2 mb-1">
              <Box class="w-4 h-4 text-green-500" />
              <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Services</span>
            </div>
            <p class="text-xl font-bold text-gray-900 dark:text-white">{{ runningServices }} <span class="text-sm font-normal text-gray-500">/ {{ account.serviceCount }}</span></p>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div class="flex items-center gap-2 mb-1">
              <Users class="w-4 h-4 text-blue-500" />
              <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Users</span>
            </div>
            <p class="text-xl font-bold text-gray-900 dark:text-white">{{ account.userCount }}</p>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div class="flex items-center gap-2 mb-1">
              <Cpu class="w-4 h-4 text-purple-500" />
              <span class="text-xs font-medium text-gray-500 dark:text-gray-400">CPU Allocated</span>
            </div>
            <p class="text-xl font-bold text-gray-900 dark:text-white">{{ totalCpu }} <span class="text-sm font-normal text-gray-500">cores</span></p>
          </div>
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div class="flex items-center gap-2 mb-1">
              <MemoryStick class="w-4 h-4 text-orange-500" />
              <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Memory Allocated</span>
            </div>
            <p class="text-xl font-bold text-gray-900 dark:text-white">{{ totalMemory }} <span class="text-sm font-normal text-gray-500">MB</span></p>
          </div>
        </div>

        <!-- Account Details -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Account Details</h2>
          </div>
          <div class="p-6 space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
                <input v-model="editForm.name" type="text" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Currency</label>
                <input v-model="editForm.currency" type="text" maxlength="3" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">ID</span>
                <p class="font-mono text-gray-900 dark:text-white text-xs mt-0.5 break-all">{{ account.id }}</p>
              </div>
              <div>
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Created</span>
                <p class="text-gray-900 dark:text-white mt-0.5">{{ formatDate(account.createdAt) }}</p>
              </div>
              <div>
                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Status</span>
                <p class="text-gray-900 dark:text-white mt-0.5 capitalize">{{ account.status }}</p>
              </div>
            </div>
            <div class="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
              <div class="flex items-center gap-2">
                <button v-if="account.status === 'active'" @click="suspendAccount" :disabled="suspending"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50">
                  <Ban class="w-3.5 h-3.5" /> Suspend
                </button>
                <button v-else-if="account.status === 'suspended'" @click="unsuspendAccount" :disabled="suspending"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50">
                  <CheckCircle class="w-3.5 h-3.5" /> Unsuspend
                </button>
              </div>
              <button @click="saveAccount" :disabled="saving"
                class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white transition-colors disabled:opacity-50">
                <Save class="w-4 h-4" /> {{ saving ? 'Saving...' : 'Save' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Services Tab -->
      <div v-if="activeTab === 'services'">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700">
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Image</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Resources</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Updated</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr v-if="account.services.length === 0">
                  <td colspan="5" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">No services</td>
                </tr>
                <tr v-for="svc in account.services" :key="svc.id" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                  <td class="px-6 py-3.5">
                    <span class="text-sm font-medium text-gray-900 dark:text-white">{{ svc.name }}</span>
                  </td>
                  <td class="px-6 py-3.5 text-sm text-gray-500 dark:text-gray-400 font-mono truncate max-w-[200px]">{{ svc.image }}</td>
                  <td class="px-6 py-3.5">
                    <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', statusColor(svc.status)]">{{ svc.status }}</span>
                  </td>
                  <td class="px-6 py-3.5 text-sm text-gray-500 dark:text-gray-400">
                    {{ svc.cpuLimit ?? 0 }} CPU &middot; {{ svc.memoryLimit ?? 0 }} MB &middot; {{ svc.replicas ?? 1 }}x
                  </td>
                  <td class="px-6 py-3.5 text-sm text-gray-500 dark:text-gray-400">{{ formatDate(svc.updatedAt || svc.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Users Tab -->
      <div v-if="activeTab === 'users'">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700">
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Email</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Role</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Login</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr v-if="account.users.length === 0">
                  <td colspan="5" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">No users</td>
                </tr>
                <tr v-for="u in account.users" :key="u.id" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                  <td class="px-6 py-3.5 text-sm font-medium text-gray-900 dark:text-white">{{ u.name }}</td>
                  <td class="px-6 py-3.5 text-sm text-gray-500 dark:text-gray-400">{{ u.email }}</td>
                  <td class="px-6 py-3.5">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{{ u.role }}</span>
                  </td>
                  <td class="px-6 py-3.5 text-sm text-gray-500 dark:text-gray-400">{{ formatDate(u.lastLoginAt) }}</td>
                  <td class="px-6 py-3.5 text-sm text-gray-500 dark:text-gray-400">{{ formatDate(u.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Billing Tab -->
      <div v-if="activeTab === 'billing'" class="space-y-6">
        <!-- Billing Overrides -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <DollarSign class="w-5 h-5 text-amber-500" />
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Billing Overrides</h2>
            </div>
            <button v-if="account.billingOverride" @click="deleteOverride" :disabled="savingOverride"
              class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash2 class="w-3 h-3" /> Remove
            </button>
          </div>
          <div class="p-6 space-y-5">
            <!-- Pricing -->
            <div>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">Pricing</h3>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Discount %</label>
                  <input v-model.number="overrideForm.discountPercent" type="number" min="0" max="100" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="0" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Custom price (cents)</label>
                  <input v-model.number="overrideForm.customPriceCents" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
                <div class="col-span-2">
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Notes</label>
                  <input v-model="overrideForm.notes" type="text" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Internal note" />
                </div>
              </div>
            </div>

            <!-- Usage pricing overrides -->
            <div>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">Usage Pricing Overrides</h3>
              <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">CPU $/hr</label>
                  <input v-model.number="overrideForm.cpuCentsPerHourOverride" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Memory $/GB/hr</label>
                  <input v-model.number="overrideForm.memoryCentsPerGbHourOverride" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Storage $/GB/mo</label>
                  <input v-model.number="overrideForm.storageCentsPerGbMonthOverride" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Bandwidth $/GB</label>
                  <input v-model.number="overrideForm.bandwidthCentsPerGbOverride" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Container $/hr</label>
                  <input v-model.number="overrideForm.containerCentsPerHourOverride" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
              </div>
              <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">All values in cents. Leave empty for global default.</p>
            </div>

            <!-- Free tier overrides -->
            <div>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">Free Tier Overrides</h3>
              <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max Free Services</label>
                  <input v-model.number="overrideForm.maxFreeServices" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">CPU (cores)</label>
                  <input v-model.number="overrideForm.freeTierCpuLimit" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Memory (MB)</label>
                  <input v-model.number="overrideForm.freeTierMemoryLimit" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Containers</label>
                  <input v-model.number="overrideForm.freeTierContainerLimit" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Storage (GB)</label>
                  <input v-model.number="overrideForm.freeTierStorageLimit" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
              </div>
              <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Override the global free tier limits for this account. Leave empty for global default.</p>
            </div>

            <!-- Resource boosts -->
            <div>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <Zap class="w-4 h-4 text-purple-500" /> Resource Boost (all tiers)
              </h3>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">CPU (cores)</label>
                  <input v-model.number="overrideForm.boostCpuLimit" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Memory (MB)</label>
                  <input v-model.number="overrideForm.boostMemoryLimit" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Containers</label>
                  <input v-model.number="overrideForm.boostContainerLimit" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Storage (GB)</label>
                  <input v-model.number="overrideForm.boostStorageLimit" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
                </div>
              </div>
              <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Applies to all tiers. Effective limit = max(plan limit, boost). Can only increase, never reduce.</p>
            </div>

            <div class="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
              <button @click="saveOverride" :disabled="savingOverride"
                class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white transition-colors disabled:opacity-50">
                <Save class="w-4 h-4" /> {{ savingOverride ? 'Saving...' : 'Save Billing Overrides' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Resource Limits -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Shield class="w-5 h-5 text-blue-500" />
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Resource Limits</h2>
            </div>
            <button v-if="account.resourceLimit" @click="deleteLimits" :disabled="savingLimits"
              class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash2 class="w-3 h-3" /> Remove
            </button>
          </div>
          <div class="p-6 space-y-4">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max CPU/container</label>
                <input v-model.number="limitsForm.maxCpuPerContainer" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max Memory/container (MB)</label>
                <input v-model.number="limitsForm.maxMemoryPerContainer" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max Replicas</label>
                <input v-model.number="limitsForm.maxReplicas" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max Containers</label>
                <input v-model.number="limitsForm.maxContainers" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max Storage (GB)</label>
                <input v-model.number="limitsForm.maxStorageGb" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max Bandwidth (GB)</label>
                <input v-model.number="limitsForm.maxBandwidthGb" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max Total CPU (cores)</label>
                <input v-model.number="limitsForm.maxTotalCpuCores" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max Total Memory (MB)</label>
                <input v-model.number="limitsForm.maxTotalMemoryMb" type="number" min="0" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="--" />
              </div>
            </div>
            <p class="text-[11px] text-gray-400 dark:text-gray-500">Hard caps on what this account can allocate. Leave empty for no limit.</p>
            <div class="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
              <button @click="saveLimits" :disabled="savingLimits"
                class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white transition-colors disabled:opacity-50">
                <Save class="w-4 h-4" /> {{ savingLimits ? 'Saving...' : 'Save Resource Limits' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
