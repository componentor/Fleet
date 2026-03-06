<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Users,
  Save,
  Settings,
  FileText,
  UserCheck,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Link,
  Unlink,
  Store,
  TrendingUp,
  Zap,
  AlertCircle,
  Eye,
  ExternalLink,
} from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const api = useApi()
const toast = useToast()

// ─── State ──────────────────────────────────────────────────
const loading = ref(true)
const savingConfig = ref(false)
const activeTab = ref<'config' | 'applications' | 'resellers'>('config')

// ─── Config ─────────────────────────────────────────────────
const config = ref({
  enabled: false,
  approvalMode: 'manual' as 'auto' | 'manual',
  allowSubAccountReselling: false,
  defaultDiscountType: 'percentage' as 'percentage' | 'fixed' | 'hybrid',
  defaultDiscountPercent: 0,
  defaultDiscountFixed: 0,
})

// ─── Applications ───────────────────────────────────────────
const applications = ref<any[]>([])
const loadingApplications = ref(false)
const rejectingId = ref<string | null>(null)
const rejectNote = ref('')
const showRejectModal = ref(false)
const processingApplication = ref<string | null>(null)

// ─── Resellers ──────────────────────────────────────────────
const resellers = ref<any[]>([])
const loadingResellers = ref(false)
const expandedReseller = ref<string | null>(null)
const savingReseller = ref<string | null>(null)
const editForm = ref<Record<string, any>>({})
const resellerFilter = ref<'all' | 'active' | 'suspended'>('all')

// ─── Computed ───────────────────────────────────────────────
const pendingCount = computed(() => applications.value.length)

const tabs = computed(() => {
  const items: { id: 'config' | 'applications' | 'resellers'; label: string; icon: any; badge?: number }[] = [
    { id: 'config', label: 'Configuration', icon: Settings },
    { id: 'resellers', label: 'Resellers', icon: UserCheck, badge: resellers.value.length },
  ]
  if (config.value.approvalMode === 'manual') {
    items.splice(1, 0, {
      id: 'applications',
      label: 'Applications',
      icon: FileText,
      badge: pendingCount.value,
    })
  }
  return items
})

const filteredResellers = computed(() => {
  if (resellerFilter.value === 'all') return resellers.value
  return resellers.value.filter((r: any) => r.status === resellerFilter.value)
})

const stats = computed(() => {
  const active = resellers.value.filter((r: any) => r.status === 'active').length
  const connected = resellers.value.filter((r: any) => r.stripeConnectId).length
  const suspended = resellers.value.filter((r: any) => r.status === 'suspended').length
  return { total: resellers.value.length, active, connected, suspended, pending: pendingCount.value }
})

// ─── Fetch Functions ────────────────────────────────────────
async function fetchConfig() {
  try {
    const data = await api.get<any>('/reseller/admin/config')
    config.value = {
      enabled: data.enabled ?? false,
      approvalMode: data.approvalMode ?? 'manual',
      allowSubAccountReselling: data.allowSubAccountReselling ?? false,
      defaultDiscountType: data.defaultDiscountType ?? 'percentage',
      defaultDiscountPercent: data.defaultDiscountPercent ?? 0,
      defaultDiscountFixed: data.defaultDiscountFixed ?? 0,
    }
  } catch {
    toast.error('Failed to load reseller configuration')
  }
}

async function fetchApplications() {
  loadingApplications.value = true
  try {
    applications.value = await api.get<any[]>('/reseller/admin/applications?status=pending')
  } catch {
    applications.value = []
  } finally {
    loadingApplications.value = false
  }
}

async function fetchResellers() {
  loadingResellers.value = true
  try {
    resellers.value = await api.get<any[]>('/reseller/admin/accounts')
  } catch {
    resellers.value = []
  } finally {
    loadingResellers.value = false
  }
}

async function fetchAll() {
  loading.value = true
  try {
    await Promise.all([fetchConfig(), fetchApplications(), fetchResellers()])
  } finally {
    loading.value = false
  }
}

// ─── Config Actions ─────────────────────────────────────────
async function saveConfig() {
  savingConfig.value = true
  try {
    await api.patch('/reseller/admin/config', config.value)
    toast.success('Configuration saved')
  } catch (err: any) {
    toast.error(err?.body?.error || 'Failed to save configuration')
  } finally {
    savingConfig.value = false
  }
}

// ─── Application Actions ────────────────────────────────────
async function approveApplication(id: string) {
  processingApplication.value = id
  try {
    await api.post(`/reseller/admin/applications/${id}/approve`, {})
    applications.value = applications.value.filter(a => a.id !== id)
    toast.success('Application approved')
    await fetchResellers()
  } catch (err: any) {
    toast.error(err?.body?.error || 'Failed to approve application')
  } finally {
    processingApplication.value = null
  }
}

function openRejectModal(id: string) {
  rejectingId.value = id
  rejectNote.value = ''
  showRejectModal.value = true
}

async function confirmReject() {
  if (!rejectingId.value) return
  processingApplication.value = rejectingId.value
  try {
    await api.post(`/reseller/admin/applications/${rejectingId.value}/reject`, {
      note: rejectNote.value || undefined,
    })
    applications.value = applications.value.filter(a => a.id !== rejectingId.value)
    showRejectModal.value = false
    rejectingId.value = null
    rejectNote.value = ''
    toast.success('Application rejected')
  } catch (err: any) {
    toast.error(err?.body?.error || 'Failed to reject application')
  } finally {
    processingApplication.value = null
  }
}

// ─── Reseller Actions ───────────────────────────────────────
function toggleReseller(accountId: string, reseller: any) {
  if (expandedReseller.value === accountId) {
    expandedReseller.value = null
    return
  }
  expandedReseller.value = accountId
  editForm.value = {
    discountType: reseller.discountType ?? null,
    discountPercent: reseller.discountPercent ?? null,
    discountFixed: reseller.discountFixed ?? null,
    canSubAccountResell: reseller.canSubAccountResell ?? false,
    status: reseller.status ?? 'active',
  }
}

async function saveReseller(accountId: string) {
  savingReseller.value = accountId
  try {
    await api.patch(`/reseller/admin/accounts/${accountId}`, {
      discountType: editForm.value.discountType || null,
      discountPercent: editForm.value.discountPercent != null ? Number(editForm.value.discountPercent) : null,
      discountFixed: editForm.value.discountFixed != null ? Number(editForm.value.discountFixed) : null,
      canSubAccountResell: editForm.value.canSubAccountResell,
      status: editForm.value.status,
    })
    toast.success('Reseller settings updated')
    expandedReseller.value = null
    await fetchResellers()
  } catch (err: any) {
    toast.error(err?.body?.error || 'Failed to update reseller')
  } finally {
    savingReseller.value = null
  }
}

function formatDiscountOverride(reseller: any): string {
  if (!reseller.discountType) return 'Default'
  if (reseller.discountType === 'percentage') return `${reseller.discountPercent ?? 0}%`
  if (reseller.discountType === 'fixed') return `${reseller.discountFixed ?? 0}c`
  if (reseller.discountType === 'hybrid') return `${reseller.discountPercent ?? 0}% + ${reseller.discountFixed ?? 0}c`
  return '-'
}

function formatMarkup(reseller: any): string {
  if (!reseller.markupType) return '--'
  if (reseller.markupType === 'percentage') return `${reseller.markupPercent ?? 0}%`
  if (reseller.markupType === 'fixed') return `${reseller.markupFixed ?? 0}c`
  if (reseller.markupType === 'hybrid') return `${reseller.markupPercent ?? 0}% + ${reseller.markupFixed ?? 0}c`
  return '--'
}

function statusColor(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    case 'suspended':
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    default:
      return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
  }
}

function formatDate(ts: any): string {
  if (!ts) return '--'
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

onMounted(() => { fetchAll() })
</script>

<template>
  <div>
    <!-- Page header -->
    <div class="flex items-center gap-3 mb-8">
      <div class="p-2 rounded-xl bg-primary-100 dark:bg-primary-900/30">
        <Store class="w-6 h-6 text-primary-600 dark:text-primary-400" />
      </div>
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Reseller Program</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400">Manage the reseller program, applications, and active resellers</p>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-8 h-8" />
    </div>

    <template v-else>
      <!-- Stats overview -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
          <div class="flex items-center gap-2 mb-2">
            <div class="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Users class="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            </div>
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400">Total Resellers</p>
          </div>
          <p class="text-xl font-bold text-gray-900 dark:text-white">{{ stats.total }}</p>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
          <div class="flex items-center gap-2 mb-2">
            <div class="p-1.5 rounded-lg bg-green-100 dark:bg-green-900/30">
              <Zap class="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
            </div>
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400">Active</p>
          </div>
          <p class="text-xl font-bold text-gray-900 dark:text-white">{{ stats.active }}</p>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
          <div class="flex items-center gap-2 mb-2">
            <div class="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
              <Link class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400">Stripe Connected</p>
          </div>
          <p class="text-xl font-bold text-gray-900 dark:text-white">{{ stats.connected }}</p>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
          <div class="flex items-center gap-2 mb-2">
            <div class="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <FileText class="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            </div>
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400">Pending</p>
          </div>
          <p class="text-xl font-bold text-gray-900 dark:text-white">{{ stats.pending }}</p>
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="activeTab = tab.id"
          :class="[
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
            activeTab === tab.id
              ? 'border-primary-500 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600',
          ]"
        >
          <component :is="tab.icon" class="w-4 h-4" />
          {{ tab.label }}
          <span
            v-if="tab.badge && tab.badge > 0"
            :class="[
              'ml-1 px-1.5 py-0.5 rounded-full text-xs font-semibold',
              tab.id === 'applications'
                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
            ]"
          >
            {{ tab.badge }}
          </span>
        </button>
      </div>

      <!-- ═══ Tab: Configuration ════════════════════════════ -->
      <div v-if="activeTab === 'config'">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">Program Settings</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Configure how the reseller program works</p>
          </div>

          <form @submit.prevent="saveConfig" class="p-6 space-y-6">
            <!-- Enable toggle -->
            <div class="flex items-center justify-between p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div>
                <label for="resellerEnabled" class="text-sm font-medium text-gray-900 dark:text-white">Enable Reseller Program</label>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Allow users to apply and become resellers</p>
              </div>
              <input
                id="resellerEnabled"
                v-model="config.enabled"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-5 w-5"
              />
            </div>

            <!-- Approval mode -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Approval Mode</label>
              <select
                v-model="config.approvalMode"
                class="w-full max-w-xs px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="auto">Auto-approve</option>
                <option value="manual">Manual review</option>
              </select>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {{ config.approvalMode === 'auto' ? 'New applications are instantly approved' : 'Applications require admin review before activation' }}
              </p>
            </div>

            <!-- Sub-account reselling -->
            <div class="flex items-center justify-between p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div>
                <label for="allowSubAccount" class="text-sm font-medium text-gray-900 dark:text-white">Allow Sub-Account Reselling</label>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Let resellers grant reselling rights to their sub-accounts</p>
              </div>
              <input
                id="allowSubAccount"
                v-model="config.allowSubAccountReselling"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-5 w-5"
              />
            </div>

            <!-- Default discount -->
            <div class="space-y-4">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Default Discount for New Resellers</h3>

              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Discount Type</label>
                <select
                  v-model="config.defaultDiscountType"
                  class="w-full max-w-xs px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed (cents)</option>
                  <option value="hybrid">Hybrid (% + fixed)</option>
                </select>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div v-if="config.defaultDiscountType === 'percentage' || config.defaultDiscountType === 'hybrid'">
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Percentage</label>
                  <div class="relative">
                    <input
                      v-model.number="config.defaultDiscountPercent"
                      type="number"
                      min="0"
                      max="100"
                      class="w-full max-w-[200px] px-3 py-2 pr-8 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                  </div>
                </div>

                <div v-if="config.defaultDiscountType === 'fixed' || config.defaultDiscountType === 'hybrid'">
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fixed Amount</label>
                  <div class="relative">
                    <input
                      v-model.number="config.defaultDiscountFixed"
                      type="number"
                      min="0"
                      class="w-full max-w-[200px] px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">cents</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Save -->
            <div class="pt-2 flex justify-end">
              <button
                type="submit"
                :disabled="savingConfig"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <CompassSpinner v-if="savingConfig" size="w-4 h-4" />
                <Save v-else class="w-4 h-4" />
                {{ savingConfig ? 'Saving...' : 'Save Configuration' }}
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- ═══ Tab: Applications ═════════════════════════════ -->
      <div v-if="activeTab === 'applications'">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">Pending Applications</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Review and approve reseller applications</p>
          </div>

          <div v-if="loadingApplications" class="flex items-center justify-center py-12">
            <CompassSpinner />
          </div>

          <div v-else-if="applications.length === 0" class="px-6 py-12 text-center">
            <div class="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center mx-auto mb-4">
              <FileText class="w-7 h-7 text-gray-400 dark:text-gray-500" />
            </div>
            <p class="text-sm font-medium text-gray-900 dark:text-white mb-1">No pending applications</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">New applications will appear here for review</p>
          </div>

          <div v-else class="divide-y divide-gray-200 dark:divide-gray-700">
            <div
              v-for="app in applications"
              :key="app.id"
              class="p-6 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
            >
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
                    {{ app.account?.name ?? app.accountId }}
                  </h3>
                  <p v-if="app.message" class="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{{ app.message }}</p>
                  <p class="text-xs text-gray-400 dark:text-gray-500 mt-2">Applied {{ formatDate(app.createdAt) }}</p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <button
                    @click="approveApplication(app.id)"
                    :disabled="processingApplication === app.id"
                    class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                  >
                    <CompassSpinner v-if="processingApplication === app.id" size="w-3.5 h-3.5" />
                    <Check v-else class="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    @click="openRejectModal(app.id)"
                    :disabled="processingApplication === app.id"
                    class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 text-xs font-medium transition-colors"
                  >
                    <X class="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ Tab: Active Resellers ═════════════════════════ -->
      <div v-if="activeTab === 'resellers'">
        <!-- Filter bar -->
        <div class="flex items-center justify-between mb-4">
          <div class="flex gap-2">
            <button
              v-for="f in (['all', 'active', 'suspended'] as const)"
              :key="f"
              @click="resellerFilter = f"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                resellerFilter === f
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700',
              ]"
            >
              {{ f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1) }}
              <span
                v-if="f === 'all'"
                class="ml-1 text-gray-400 dark:text-gray-500"
              >{{ resellers.length }}</span>
            </button>
          </div>
        </div>

        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div v-if="loadingResellers" class="flex items-center justify-center py-12">
            <CompassSpinner />
          </div>

          <div v-else-if="filteredResellers.length === 0" class="px-6 py-12 text-center">
            <div class="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center mx-auto mb-4">
              <UserCheck class="w-7 h-7 text-gray-400 dark:text-gray-500" />
            </div>
            <p class="text-sm font-medium text-gray-900 dark:text-white mb-1">No resellers found</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ resellerFilter === 'all' ? 'No reseller accounts have been created yet' : 'No resellers match this filter' }}</p>
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700">
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Reseller</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Discount</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Markup</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Stripe</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Signup Slug</th>
                  <th class="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <template v-for="reseller in filteredResellers" :key="reseller.account?.id ?? reseller.id">
                  <tr
                    class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer"
                    @click="toggleReseller(reseller.account?.id ?? reseller.id, reseller)"
                  >
                    <td class="px-6 py-4">
                      <div>
                        <span class="text-sm font-medium text-gray-900 dark:text-white">
                          {{ reseller.brandName || reseller.account?.name || reseller.accountId }}
                        </span>
                        <p v-if="reseller.account?.slug" class="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5">{{ reseller.account.slug }}</p>
                      </div>
                    </td>
                    <td class="px-6 py-4">
                      <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', statusColor(reseller.status)]">
                        {{ reseller.status }}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {{ formatDiscountOverride(reseller) }}
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {{ formatMarkup(reseller) }}
                    </td>
                    <td class="px-6 py-4">
                      <span
                        :class="[
                          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
                          reseller.connectOnboarded
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                            : reseller.stripeConnectId
                              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
                        ]"
                      >
                        <component
                          :is="reseller.connectOnboarded ? Link : reseller.stripeConnectId ? AlertCircle : Unlink"
                          class="w-3 h-3"
                        />
                        {{ reseller.connectOnboarded ? 'Active' : reseller.stripeConnectId ? 'Pending' : 'None' }}
                      </span>
                    </td>
                    <td class="px-6 py-4">
                      <span v-if="reseller.signupSlug" class="text-xs font-mono text-primary-600 dark:text-primary-400">/r/{{ reseller.signupSlug }}</span>
                      <span v-else class="text-xs text-gray-400 dark:text-gray-500">--</span>
                    </td>
                    <td class="px-6 py-4 text-right">
                      <component
                        :is="expandedReseller === (reseller.account?.id ?? reseller.id) ? ChevronUp : ChevronDown"
                        class="w-4 h-4 text-gray-400 inline-block"
                      />
                    </td>
                  </tr>

                  <!-- Expanded edit form -->
                  <tr v-if="expandedReseller === (reseller.account?.id ?? reseller.id)">
                    <td colspan="7" class="px-6 py-5 bg-gray-50 dark:bg-gray-900/50">
                      <form @submit.prevent="saveReseller(reseller.account?.id ?? reseller.id)" class="space-y-5">
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                          <!-- Discount Type -->
                          <div>
                            <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Discount Type</label>
                            <select
                              v-model="editForm.discountType"
                              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                            >
                              <option :value="null">Default</option>
                              <option value="percentage">Percentage</option>
                              <option value="fixed">Fixed</option>
                              <option value="hybrid">Hybrid</option>
                            </select>
                          </div>

                          <!-- Discount Percent -->
                          <div v-if="editForm.discountType === 'percentage' || editForm.discountType === 'hybrid'">
                            <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Discount %</label>
                            <div class="relative">
                              <input
                                v-model.number="editForm.discountPercent"
                                type="number"
                                min="0"
                                max="100"
                                class="w-full px-3 py-2 pr-8 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                              />
                              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                            </div>
                          </div>

                          <!-- Discount Fixed -->
                          <div v-if="editForm.discountType === 'fixed' || editForm.discountType === 'hybrid'">
                            <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Discount Fixed</label>
                            <input
                              v-model.number="editForm.discountFixed"
                              type="number"
                              min="0"
                              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                          </div>

                          <!-- Status -->
                          <div>
                            <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
                            <select
                              v-model="editForm.status"
                              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                            >
                              <option value="active">Active</option>
                              <option value="suspended">Suspended</option>
                            </select>
                          </div>

                          <!-- Can Sub-Account Resell -->
                          <div class="flex items-end pb-1">
                            <label class="flex items-center gap-2">
                              <input
                                v-model="editForm.canSubAccountResell"
                                type="checkbox"
                                class="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                              />
                              <span class="text-xs text-gray-700 dark:text-gray-300">Sub-account reselling</span>
                            </label>
                          </div>
                        </div>

                        <div class="flex gap-2 justify-end">
                          <button
                            type="button"
                            @click="expandedReseller = null"
                            class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            :disabled="savingReseller === (reseller.account?.id ?? reseller.id)"
                            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                          >
                            <CompassSpinner v-if="savingReseller === (reseller.account?.id ?? reseller.id)" size="w-4 h-4" />
                            <Save v-else class="w-4 h-4" />
                            Save
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ═══ Reject Application Modal ══════════════════════ -->
      <Teleport to="body">
        <div
          v-if="showRejectModal"
          class="fixed inset-0 z-50 flex items-center justify-center"
        >
          <div class="absolute inset-0 bg-black/50" @click="showRejectModal = false" />
          <div class="relative w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Reject Application</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Provide a reason for rejecting this application</p>
            </div>
            <div class="p-6">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Rejection Note (optional)</label>
              <textarea
                v-model="rejectNote"
                rows="3"
                placeholder="Explain why this application was rejected..."
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm resize-none"
              />
            </div>
            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button
                @click="showRejectModal = false"
                class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                @click="confirmReject"
                :disabled="processingApplication !== null"
                class="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <CompassSpinner v-if="processingApplication !== null" size="w-4 h-4" />
                <X v-else class="w-4 h-4" />
                Reject
              </button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>
