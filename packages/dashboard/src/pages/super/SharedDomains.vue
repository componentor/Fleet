<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Globe, Plus, Loader2, Trash2, Pencil, X, Check } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const { t } = useI18n()
const api = useApi()

interface SharedDomain {
  id: string
  domain: string
  enabled: boolean
  pricingType: string
  price: number
  currency: string
  maxPerAccount: number
  claimCount: number
  createdAt: string
}

const loading = ref(true)
const domains = ref<SharedDomain[]>([])
const showAddDialog = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const error = ref('')

// Form
const form = ref({
  domain: '',
  pricingType: 'free' as 'free' | 'one_time' | 'monthly',
  price: 0,
  currency: 'USD',
  maxPerAccount: 0,
  enabled: true,
})

function resetForm() {
  form.value = { domain: '', pricingType: 'free', price: 0, currency: 'USD', maxPerAccount: 0, enabled: true }
  editingId.value = null
  error.value = ''
}

async function fetchDomains() {
  loading.value = true
  try {
    domains.value = await api.get<SharedDomain[]>('/shared-domains/admin')
  } catch {
    domains.value = []
  } finally {
    loading.value = false
  }
}

async function saveDomain() {
  saving.value = true
  error.value = ''
  try {
    if (editingId.value) {
      await api.patch(`/shared-domains/admin/${editingId.value}`, {
        pricingType: form.value.pricingType,
        price: form.value.pricingType === 'free' ? 0 : form.value.price,
        currency: form.value.currency,
        maxPerAccount: form.value.maxPerAccount,
        enabled: form.value.enabled,
      })
    } else {
      await api.post('/shared-domains/admin', {
        domain: form.value.domain,
        pricingType: form.value.pricingType,
        price: form.value.pricingType === 'free' ? 0 : form.value.price,
        currency: form.value.currency,
        maxPerAccount: form.value.maxPerAccount,
        enabled: form.value.enabled,
      })
    }
    showAddDialog.value = false
    resetForm()
    await fetchDomains()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save'
  } finally {
    saving.value = false
  }
}

function editDomain(d: SharedDomain) {
  editingId.value = d.id
  form.value = {
    domain: d.domain,
    pricingType: d.pricingType as 'free' | 'one_time' | 'monthly',
    price: d.price,
    currency: d.currency,
    maxPerAccount: d.maxPerAccount,
    enabled: d.enabled,
  }
  showAddDialog.value = true
}

async function deleteDomain(id: string) {
  if (!confirm(t('super.sharedDomains.confirmDelete'))) return
  try {
    await api.del(`/shared-domains/admin/${id}`)
    await fetchDomains()
  } catch {
    // ignore
  }
}

async function toggleEnabled(d: SharedDomain) {
  try {
    await api.patch(`/shared-domains/admin/${d.id}`, { enabled: !d.enabled })
    d.enabled = !d.enabled
  } catch {
    // ignore
  }
}

function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price / 100)
}

function pricingLabel(d: SharedDomain): string {
  if (d.pricingType === 'free') return t('super.sharedDomains.free')
  const formatted = formatPrice(d.price, d.currency)
  return d.pricingType === 'one_time'
    ? `${formatted} ${t('super.sharedDomains.oneTime')}`
    : `${formatted}/${t('super.sharedDomains.month')}`
}

onMounted(() => {
  fetchDomains()
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <Globe class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('super.sharedDomains.title') }}</h1>
      </div>
      <button
        @click="resetForm(); showAddDialog = true"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        {{ t('super.sharedDomains.add') }}
      </button>
    </div>

    <!-- Info box -->
    <div class="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
      <p class="text-sm text-blue-700 dark:text-blue-300">
        {{ t('super.sharedDomains.dnsHint') }}
      </p>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div v-if="domains.length === 0" class="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
        {{ t('super.sharedDomains.empty') }}
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('super.sharedDomains.domain') }}</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('super.sharedDomains.pricing') }}</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('super.sharedDomains.limit') }}</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('super.sharedDomains.claims') }}</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('super.sharedDomains.enabled') }}</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-for="d in domains" :key="d.id" class="hover:bg-gray-50 dark:hover:bg-gray-750">
              <td class="px-4 py-3">
                <span class="text-sm font-medium text-gray-900 dark:text-white">*.{{ d.domain }}</span>
              </td>
              <td class="px-4 py-3">
                <span
                  :class="[
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    d.pricingType === 'free'
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                      : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  ]"
                >
                  {{ pricingLabel(d) }}
                </span>
              </td>
              <td class="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-400">
                {{ d.maxPerAccount === 0 ? t('super.sharedDomains.unlimited') : d.maxPerAccount }}
              </td>
              <td class="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-400">
                {{ d.claimCount }}
              </td>
              <td class="px-4 py-3 text-center">
                <button
                  @click="toggleEnabled(d)"
                  :class="[
                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                    d.enabled ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600',
                  ]"
                >
                  <span
                    :class="[
                      'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                      d.enabled ? 'translate-x-4.5' : 'translate-x-1',
                    ]"
                  />
                </button>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-2">
                  <button
                    @click="editDomain(d)"
                    class="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    <Pencil class="w-4 h-4" />
                  </button>
                  <button
                    @click="deleteDomain(d.id)"
                    class="p-1.5 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add/Edit Dialog -->
    <Teleport to="body">
      <div v-if="showAddDialog" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="fixed inset-0 bg-black/50" @click="showAddDialog = false; resetForm()" />
        <div class="relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-full max-w-lg">
          <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ editingId ? t('super.sharedDomains.edit') : t('super.sharedDomains.add') }}
            </h2>
            <button @click="showAddDialog = false; resetForm()" class="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X class="w-5 h-5" />
            </button>
          </div>

          <form @submit.prevent="saveDomain" class="p-6 space-y-5">
            <div v-if="error" class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
            </div>

            <!-- Domain -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('super.sharedDomains.domain') }}</label>
              <input
                v-model="form.domain"
                type="text"
                placeholder="example.com"
                :disabled="!!editingId"
                required
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm disabled:opacity-50"
              />
            </div>

            <!-- Pricing Type -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('super.sharedDomains.pricingType') }}</label>
              <select
                v-model="form.pricingType"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              >
                <option value="free">{{ t('super.sharedDomains.free') }}</option>
                <option value="one_time">{{ t('super.sharedDomains.oneTime') }}</option>
                <option value="monthly">{{ t('super.sharedDomains.monthly') }}</option>
              </select>
            </div>

            <!-- Price (shown when not free) -->
            <div v-if="form.pricingType !== 'free'" class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('super.sharedDomains.priceLabel') }}</label>
                <input
                  v-model.number="form.price"
                  type="number"
                  min="0"
                  step="1"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ t('super.sharedDomains.priceHint') }}</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('super.sharedDomains.currency') }}</label>
                <select
                  v-model="form.currency"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="NOK">NOK</option>
                </select>
              </div>
            </div>

            <!-- Max per account -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('super.sharedDomains.maxPerAccount') }}</label>
              <input
                v-model.number="form.maxPerAccount"
                type="number"
                min="0"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ t('super.sharedDomains.maxHint') }}</p>
            </div>

            <div class="flex justify-end gap-3 pt-2">
              <button
                type="button"
                @click="showAddDialog = false; resetForm()"
                class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                type="submit"
                :disabled="saving || (!editingId && !form.domain)"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
                {{ editingId ? t('common.save') : t('super.sharedDomains.add') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
