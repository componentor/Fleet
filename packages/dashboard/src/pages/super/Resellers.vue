<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Users,
  Loader2,
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
} from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const { t } = useI18n()
const api = useApi()

// ─── State ──────────────────────────────────────────────────
const loading = ref(true)
const savingConfig = ref(false)
const error = ref('')
const success = ref('')
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

// ─── Computed ───────────────────────────────────────────────
const pendingCount = computed(() => applications.value.length)

const tabs = computed(() => {
  const items: { id: 'config' | 'applications' | 'resellers'; label: string; icon: any }[] = [
    { id: 'config', label: t('reseller.tabs.config'), icon: Settings },
    { id: 'resellers', label: t('reseller.tabs.resellers'), icon: UserCheck },
  ]
  if (config.value.approvalMode === 'manual') {
    items.splice(1, 0, {
      id: 'applications',
      label: t('reseller.tabs.applications'),
      icon: FileText,
    })
  }
  return items
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
    error.value = t('reseller.errors.loadConfig')
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
    resellers.value = await api.get<any[]>('/reseller/admin/accounts?status=active')
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
  error.value = ''
  try {
    await api.patch('/reseller/admin/config', config.value)
    showSuccess(t('reseller.success.configSaved'))
  } catch (err: any) {
    error.value = err?.body?.error || t('reseller.errors.saveConfig')
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
    showSuccess(t('reseller.success.approved'))
    await fetchResellers()
  } catch (err: any) {
    error.value = err?.body?.error || t('reseller.errors.approve')
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
    showSuccess(t('reseller.success.rejected'))
  } catch (err: any) {
    error.value = err?.body?.error || t('reseller.errors.reject')
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
  error.value = ''
  try {
    await api.patch(`/reseller/admin/accounts/${accountId}`, {
      discountType: editForm.value.discountType || null,
      discountPercent: editForm.value.discountPercent != null ? Number(editForm.value.discountPercent) : null,
      discountFixed: editForm.value.discountFixed != null ? Number(editForm.value.discountFixed) : null,
      canSubAccountResell: editForm.value.canSubAccountResell,
      status: editForm.value.status,
    })
    showSuccess(t('reseller.success.resellerUpdated'))
    await fetchResellers()
  } catch (err: any) {
    error.value = err?.body?.error || t('reseller.errors.updateReseller')
  } finally {
    savingReseller.value = null
  }
}

function formatDiscountOverride(reseller: any): string {
  if (!reseller.discountType) return t('reseller.useDefault')
  if (reseller.discountType === 'percentage') return `${reseller.discountPercent ?? 0}%`
  if (reseller.discountType === 'fixed') return `${reseller.discountFixed ?? 0}c`
  if (reseller.discountType === 'hybrid') return `${reseller.discountPercent ?? 0}% + ${reseller.discountFixed ?? 0}c`
  return '-'
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
  return new Date(ts).toLocaleDateString()
}

// ─── Helpers ────────────────────────────────────────────────
function showSuccess(msg: string) {
  success.value = msg
  setTimeout(() => { success.value = '' }, 3000)
}

onMounted(() => { fetchAll() })
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Users class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('reseller.title') }}</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <template v-else>
      <!-- Alerts -->
      <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>
      <div v-if="success" class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
        <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
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
            v-if="tab.id === 'applications' && pendingCount > 0"
            class="ml-1 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
          >
            {{ pendingCount }}
          </span>
        </button>
      </div>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- Tab 1: Configuration                                   -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <div v-if="activeTab === 'config'">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('reseller.config.title') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('reseller.config.description') }}</p>
          </div>

          <form @submit.prevent="saveConfig" class="p-6 space-y-6">
            <!-- Enable Reseller Program -->
            <div class="flex items-center justify-between p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div>
                <label for="resellerEnabled" class="text-sm font-medium text-gray-900 dark:text-white">{{ t('reseller.config.enable') }}</label>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ t('reseller.config.enableDesc') }}</p>
              </div>
              <input
                id="resellerEnabled"
                v-model="config.enabled"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-5 w-5"
              />
            </div>

            <!-- Approval Mode -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('reseller.config.approvalMode') }}</label>
              <select
                v-model="config.approvalMode"
                class="w-full max-w-xs px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="auto">{{ t('reseller.config.autoApproval') }}</option>
                <option value="manual">{{ t('reseller.config.manualApproval') }}</option>
              </select>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ t('reseller.config.approvalModeDesc') }}</p>
            </div>

            <!-- Allow Sub-Account Reselling -->
            <div class="flex items-center justify-between p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
              <div>
                <label for="allowSubAccount" class="text-sm font-medium text-gray-900 dark:text-white">{{ t('reseller.config.allowSubAccount') }}</label>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ t('reseller.config.allowSubAccountDesc') }}</p>
              </div>
              <input
                id="allowSubAccount"
                v-model="config.allowSubAccountReselling"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-5 w-5"
              />
            </div>

            <!-- Default Discount Settings -->
            <div class="space-y-4">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('reseller.config.defaultDiscount') }}</h3>

              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('reseller.config.discountType') }}</label>
                <select
                  v-model="config.defaultDiscountType"
                  class="w-full max-w-xs px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="percentage">{{ t('reseller.discountTypes.percentage') }}</option>
                  <option value="fixed">{{ t('reseller.discountTypes.fixed') }}</option>
                  <option value="hybrid">{{ t('reseller.discountTypes.hybrid') }}</option>
                </select>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div v-if="config.defaultDiscountType === 'percentage' || config.defaultDiscountType === 'hybrid'">
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('reseller.config.discountPercent') }}</label>
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
                  <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('reseller.config.discountFixed') }}</label>
                  <div class="relative">
                    <input
                      v-model.number="config.defaultDiscountFixed"
                      type="number"
                      min="0"
                      class="w-full max-w-[200px] px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{{ t('reseller.cents') }}</span>
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
                <Loader2 v-if="savingConfig" class="w-4 h-4 animate-spin" />
                <Save v-else class="w-4 h-4" />
                {{ savingConfig ? t('common.saving') : t('common.save') }}
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- Tab 2: Applications (manual mode only)                 -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <div v-if="activeTab === 'applications'">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('reseller.applications.title') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('reseller.applications.description') }}</p>
          </div>

          <div v-if="loadingApplications" class="flex items-center justify-center py-12">
            <Loader2 class="w-6 h-6 text-primary-600 dark:text-primary-400 animate-spin" />
          </div>

          <div v-else-if="applications.length === 0" class="px-6 py-12 text-center">
            <FileText class="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('reseller.applications.empty') }}</p>
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700">
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('reseller.applications.accountName') }}</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('reseller.applications.message') }}</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('reseller.applications.submitted') }}</th>
                  <th class="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('common.actions') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr v-for="app in applications" :key="app.id" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                  <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                    {{ app.account?.name ?? app.accountId }}
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 max-w-xs truncate">
                    {{ app.message || '--' }}
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {{ formatDate(app.createdAt) }}
                  </td>
                  <td class="px-6 py-4 text-right">
                    <div class="flex items-center justify-end gap-2">
                      <button
                        @click="approveApplication(app.id)"
                        :disabled="processingApplication === app.id"
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                      >
                        <Loader2 v-if="processingApplication === app.id" class="w-3.5 h-3.5 animate-spin" />
                        <Check v-else class="w-3.5 h-3.5" />
                        {{ t('reseller.applications.approve') }}
                      </button>
                      <button
                        @click="openRejectModal(app.id)"
                        :disabled="processingApplication === app.id"
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 text-xs font-medium transition-colors"
                      >
                        <X class="w-3.5 h-3.5" />
                        {{ t('reseller.applications.reject') }}
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- Tab 3: Active Resellers                                -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <div v-if="activeTab === 'resellers'">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('reseller.resellers.title') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('reseller.resellers.description') }}</p>
          </div>

          <div v-if="loadingResellers" class="flex items-center justify-center py-12">
            <Loader2 class="w-6 h-6 text-primary-600 dark:text-primary-400 animate-spin" />
          </div>

          <div v-else-if="resellers.length === 0" class="px-6 py-12 text-center">
            <UserCheck class="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('reseller.resellers.empty') }}</p>
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700">
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('reseller.resellers.accountName') }}</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('common.status') }}</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('reseller.resellers.discountOverride') }}</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('reseller.resellers.markup') }}</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('reseller.resellers.stripeConnected') }}</th>
                  <th class="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('common.actions') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <template v-for="reseller in resellers" :key="reseller.account?.id ?? reseller.id">
                  <tr
                    class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer"
                    @click="toggleReseller(reseller.account?.id ?? reseller.id, reseller)"
                  >
                    <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                      <div class="flex items-center gap-2">
                        {{ reseller.account?.name ?? reseller.accountId }}
                        <span v-if="reseller.account?.slug" class="text-xs text-gray-400 dark:text-gray-500 font-mono">{{ reseller.account.slug }}</span>
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
                      {{ reseller.markupPercent != null ? `${reseller.markupPercent}%` : '--' }}
                    </td>
                    <td class="px-6 py-4">
                      <span
                        :class="[
                          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
                          reseller.stripeConnectId
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
                        ]"
                      >
                        <component :is="reseller.stripeConnectId ? Link : Unlink" class="w-3 h-3" />
                        {{ reseller.stripeConnectId ? t('reseller.resellers.connected') : t('reseller.resellers.notConnected') }}
                      </span>
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
                    <td colspan="6" class="px-6 py-5 bg-gray-50 dark:bg-gray-900/50">
                      <form @submit.prevent="saveReseller(reseller.account?.id ?? reseller.id)" class="space-y-5">
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                          <!-- Discount Type -->
                          <div>
                            <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('reseller.config.discountType') }}</label>
                            <select
                              v-model="editForm.discountType"
                              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                            >
                              <option :value="null">{{ t('reseller.useDefault') }}</option>
                              <option value="percentage">{{ t('reseller.discountTypes.percentage') }}</option>
                              <option value="fixed">{{ t('reseller.discountTypes.fixed') }}</option>
                              <option value="hybrid">{{ t('reseller.discountTypes.hybrid') }}</option>
                            </select>
                          </div>

                          <!-- Discount Percent -->
                          <div v-if="editForm.discountType === 'percentage' || editForm.discountType === 'hybrid'">
                            <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('reseller.config.discountPercent') }}</label>
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
                            <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('reseller.config.discountFixed') }}</label>
                            <input
                              v-model.number="editForm.discountFixed"
                              type="number"
                              min="0"
                              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                          </div>

                          <!-- Status -->
                          <div>
                            <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('common.status') }}</label>
                            <select
                              v-model="editForm.status"
                              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                            >
                              <option value="active">{{ t('common.active') }}</option>
                              <option value="suspended">{{ t('reseller.resellers.suspended') }}</option>
                            </select>
                          </div>
                        </div>

                        <!-- Can Sub-Account Resell -->
                        <div class="flex items-center gap-3">
                          <input
                            id="canSubAccountResell"
                            v-model="editForm.canSubAccountResell"
                            type="checkbox"
                            class="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <label for="canSubAccountResell" class="text-sm text-gray-700 dark:text-gray-300">{{ t('reseller.resellers.canSubAccountResell') }}</label>
                        </div>

                        <div class="flex gap-2 justify-end">
                          <button
                            type="button"
                            @click="expandedReseller = null"
                            class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                          >
                            {{ t('common.cancel') }}
                          </button>
                          <button
                            type="submit"
                            :disabled="savingReseller === (reseller.account?.id ?? reseller.id)"
                            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                          >
                            <Loader2 v-if="savingReseller === (reseller.account?.id ?? reseller.id)" class="w-4 h-4 animate-spin" />
                            <Save v-else class="w-4 h-4" />
                            {{ t('common.save') }}
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

      <!-- ═══════════════════════════════════════════════════════ -->
      <!-- Reject Application Modal                               -->
      <!-- ═══════════════════════════════════════════════════════ -->
      <Teleport to="body">
        <div
          v-if="showRejectModal"
          class="fixed inset-0 z-50 flex items-center justify-center"
        >
          <!-- Backdrop -->
          <div class="absolute inset-0 bg-black/50" @click="showRejectModal = false" />

          <!-- Modal content -->
          <div class="relative w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('reseller.applications.rejectTitle') }}</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('reseller.applications.rejectDesc') }}</p>
            </div>

            <div class="p-6">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('reseller.applications.rejectNote') }}</label>
              <textarea
                v-model="rejectNote"
                rows="3"
                :placeholder="t('reseller.applications.rejectNotePlaceholder')"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm resize-none"
              />
            </div>

            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button
                @click="showRejectModal = false"
                class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                @click="confirmReject"
                :disabled="processingApplication !== null"
                class="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="processingApplication !== null" class="w-4 h-4 animate-spin" />
                <X v-else class="w-4 h-4" />
                {{ t('reseller.applications.confirmReject') }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>
