<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Globe, Plus, Trash2, CheckCircle2, Clock, Shield, Edit2, X as XIcon, AlertTriangle, Copy, Check, ShieldCheck } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'

const route = useRoute()
const router = useRouter()
const api = useApi()
const { t } = useI18n()

const zoneId = computed(() => route.params.id as string)

const zone = ref<any>(null)
const records = ref<any[]>([])
const loading = ref(true)
const error = ref('')

// Add record form
const showAddForm = ref(false)
const addingRecord = ref(false)
const newRecord = ref({
  type: 'A' as string,
  name: '',
  content: '',
  ttl: 3600,
  priority: 10,
})

// Verify
const verifying = ref(false)
const copyFeedback = ref('')

// Nameserver editing
const editingNameservers = ref(false)
const savingNameservers = ref(false)
const editedNameservers = ref<string[]>([])

const recordTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA']
const showPriority = computed(() => ['MX', 'SRV'].includes(newRecord.value.type))

/** Whether this domain was purchased through Fleet (has full DNS management) */
const isPurchased = computed(() => !!zone.value?.isPurchased)

async function fetchZone() {
  loading.value = true
  error.value = ''
  try {
    const data = await api.get<any>(`/dns/zones/${zoneId.value}`)
    zone.value = data
    records.value = data.records ?? []
  } catch (err: any) {
    error.value = err?.body?.error || t('domainDetail.failedToLoadDomain')
  } finally {
    loading.value = false
  }
}

async function addRecord() {
  if (!newRecord.value.name || !newRecord.value.content) return
  addingRecord.value = true
  error.value = ''
  try {
    await api.post(`/dns/zones/${zoneId.value}/records`, {
      type: newRecord.value.type,
      name: newRecord.value.name,
      content: newRecord.value.content,
      ttl: newRecord.value.ttl,
      ...(showPriority.value && { priority: newRecord.value.priority }),
    })
    newRecord.value = { type: 'A', name: '', content: '', ttl: 3600, priority: 10 }
    showAddForm.value = false
    await fetchZone()
  } catch (err: any) {
    error.value = err?.body?.error || t('domainDetail.failedToAddRecord')
  } finally {
    addingRecord.value = false
  }
}

async function deleteRecord(recordId: string) {
  if (!confirm(t('domainDetail.confirmDeleteRecord'))) return
  error.value = ''
  try {
    await api.del(`/dns/records/${recordId}`)
    await fetchZone()
  } catch (err: any) {
    error.value = err?.body?.error || t('domainDetail.failedToDeleteRecord')
  }
}

async function verifyDomain() {
  verifying.value = true
  error.value = ''
  try {
    const result = await api.post<any>(`/dns/zones/${zoneId.value}/verify`, {
      token: zone.value?.verificationToken,
    })
    if (result.verified) {
      await fetchZone()
    } else {
      error.value = t('domainDetail.verificationFailedDetails')
    }
  } catch (err: any) {
    error.value = err?.body?.error || t('domainDetail.verificationFailed')
  } finally {
    verifying.value = false
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  copyFeedback.value = text
  setTimeout(() => { copyFeedback.value = '' }, 2000)
}

function startEditingNameservers() {
  editedNameservers.value = [...(zone.value?.nameservers?.length ? zone.value.nameservers : ['ns1.fleet.local', 'ns2.fleet.local'])]
  editingNameservers.value = true
}

function cancelEditingNameservers() {
  editingNameservers.value = false
  editedNameservers.value = []
}

function addNameserver() {
  if (editedNameservers.value.length < 13) {
    editedNameservers.value.push('')
  }
}

function removeNameserver(index: number) {
  if (editedNameservers.value.length > 2) {
    editedNameservers.value.splice(index, 1)
  }
}

async function saveNameservers() {
  const valid = editedNameservers.value.filter(ns => ns.trim().length > 0)
  if (valid.length < 2) {
    error.value = t('domainDetail.minNameserversRequired')
    return
  }
  savingNameservers.value = true
  error.value = ''
  try {
    await api.patch(`/dns/zones/${zoneId.value}/nameservers`, { nameservers: valid })
    editingNameservers.value = false
    await fetchZone()
  } catch (err: any) {
    error.value = err?.body?.error || t('domainDetail.failedToUpdateNameservers')
  } finally {
    savingNameservers.value = false
  }
}

function formatDate(ts: any) {
  if (!ts) return '--'
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  return d.toLocaleDateString()
}

onMounted(() => {
  fetchZone()
})
</script>

<template>
  <div>
    <!-- Back link + header -->
    <div class="mb-8">
      <router-link to="/panel/domains" class="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-4 transition-colors">
        <ArrowLeft class="w-4 h-4" />
        {{ t('domainDetail.backToDomains') }}
      </router-link>

      <div v-if="zone" class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Globe class="w-7 h-7 text-primary-600 dark:text-primary-400" />
          <div>
            <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ zone.domain }}</h1>
            <div class="flex items-center gap-3 mt-1">
              <span
                :class="[
                  'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium',
                  zone.verified
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
                ]"
              >
                <CheckCircle2 v-if="zone.verified" class="w-3 h-3" />
                <Clock v-else class="w-3 h-3" />
                {{ zone.verified ? t('domainDetail.verified') : t('domainDetail.pendingVerification') }}
              </span>
              <span
                :class="[
                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                  isPurchased
                    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                ]"
              >
                {{ isPurchased ? t('domainDetail.purchased') : t('domainDetail.external') }}
              </span>
              <span class="text-xs text-gray-400 dark:text-gray-500">{{ t('domainDetail.created', { date: formatDate(zone.createdAt) }) }}</span>
            </div>
          </div>
        </div>
        <button
          v-if="isPurchased"
          @click="showAddForm = true"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Plus class="w-4 h-4" />
          {{ t('domainDetail.addRecord') }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-8 h-8" />
    </div>

    <template v-else-if="zone">
      <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>

      <!-- Verification section (if not verified) — DNS instructions -->
      <div v-if="!zone.verified" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('domainDetail.configureDnsRecords') }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('domainDetail.configureDnsDescription') }}</p>
        </div>
        <div class="p-6 space-y-6">
          <!-- Step 1: CNAME -->
          <div v-if="zone.cnameTarget" class="space-y-2">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('domainDetail.step1AddCname') }}</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('domainDetail.pointDomainTo') }}</p>
            <div class="flex items-center gap-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
              <code class="flex-1 text-sm font-mono text-gray-900 dark:text-white">{{ zone.cnameTarget }}</code>
              <button @click="copyToClipboard(zone.cnameTarget)" class="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                <Check v-if="copyFeedback === zone.cnameTarget" class="w-4 h-4 text-green-500" />
                <Copy v-else class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Step 2: TXT -->
          <div v-if="zone.verificationToken" class="space-y-2">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('domainDetail.addTxtRecordStep', { step: zone.cnameTarget ? 2 : 1 }) }}</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('domainDetail.addTxtRecordAt') }} <code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">_fleet-verify.{{ zone.domain }}</code> {{ t('domainDetail.withValue') }}
            </p>
            <div class="flex items-center gap-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
              <code class="flex-1 text-sm font-mono text-gray-900 dark:text-white break-all">fleet-verify={{ zone.verificationToken }}</code>
              <button @click="copyToClipboard(`fleet-verify=${zone.verificationToken}`)" class="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors shrink-0">
                <Check v-if="copyFeedback === `fleet-verify=${zone.verificationToken}`" class="w-4 h-4 text-green-500" />
                <Copy v-else class="w-4 h-4" />
              </button>
            </div>
          </div>

          <div class="pt-2 flex justify-end">
            <button
              @click="verifyDomain"
              :disabled="verifying"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <CompassSpinner v-if="verifying" size="w-4 h-4" />
              <ShieldCheck v-else class="w-4 h-4" />
              {{ t('domainDetail.verifyDomain') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Purchased domain: Nameservers + DNS Records management -->
      <template v-if="isPurchased">
        <!-- Nameservers -->
        <div class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('domainDetail.nameservers') }}</h3>
            <button
              v-if="!editingNameservers"
              @click="startEditingNameservers"
              class="flex items-center gap-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
            >
              <Edit2 class="w-3.5 h-3.5" />
              {{ t('domainDetail.edit') }}
            </button>
          </div>

          <!-- Display mode -->
          <div v-if="!editingNameservers" class="flex flex-wrap gap-2">
            <span
              v-for="ns in (zone.nameservers?.length ? zone.nameservers : ['ns1.fleet.local', 'ns2.fleet.local'])"
              :key="ns"
              class="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm font-mono text-gray-700 dark:text-gray-300"
            >
              {{ ns }}
            </span>
          </div>

          <!-- Edit mode -->
          <div v-else class="space-y-3">
            <div class="p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2">
              <AlertTriangle class="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p class="text-xs text-amber-700 dark:text-amber-300">
                {{ t('domainDetail.customNameserversWarning') }}
              </p>
            </div>

            <div v-for="(ns, index) in editedNameservers" :key="index" class="flex items-center gap-2">
              <input
                v-model="editedNameservers[index]"
                type="text"
                :placeholder="`ns${index + 1}.example.com`"
                class="flex-1 max-w-md px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              />
              <button
                v-if="editedNameservers.length > 2"
                @click="removeNameserver(index)"
                class="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <XIcon class="w-4 h-4" />
              </button>
            </div>

            <button
              v-if="editedNameservers.length < 13"
              @click="addNameserver"
              class="flex items-center gap-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
            >
              <Plus class="w-3.5 h-3.5" />
              {{ t('domainDetail.addNameserver') }}
            </button>

            <div class="flex items-center gap-3 pt-2">
              <button
                @click="saveNameservers"
                :disabled="savingNameservers"
                class="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {{ savingNameservers ? t('domainDetail.saving') : t('domainDetail.saveNameservers') }}
              </button>
              <button
                @click="cancelEditingNameservers"
                class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {{ t('domainDetail.cancel') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Add record form -->
        <div v-if="showAddForm" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">{{ t('domainDetail.addDnsRecord') }}</h3>
          <form @submit.prevent="addRecord" class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('domainDetail.type') }}</label>
                <select
                  v-model="newRecord.type"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                >
                  <option v-for="rt in recordTypes" :key="rt" :value="rt">{{ rt }}</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('domainDetail.name') }}</label>
                <input
                  v-model="newRecord.name"
                  type="text"
                  :placeholder="zone.domain"
                  required
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('domainDetail.content') }}</label>
                <input
                  v-model="newRecord.content"
                  type="text"
                  :placeholder="newRecord.type === 'A' ? '192.168.1.1' : newRecord.type === 'CNAME' ? 'target.example.com' : 'value'"
                  required
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('domainDetail.ttl') }}</label>
                <input
                  v-model.number="newRecord.ttl"
                  type="number"
                  min="60"
                  max="86400"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>
            </div>
            <div v-if="showPriority" class="max-w-xs">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('domainDetail.priority') }}</label>
              <input
                v-model.number="newRecord.priority"
                type="number"
                min="0"
                max="65535"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>
            <div class="flex items-center gap-3 pt-2">
              <button type="submit" :disabled="addingRecord" class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {{ addingRecord ? t('domainDetail.adding') : t('domainDetail.addRecord') }}
              </button>
              <button type="button" @click="showAddForm = false" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
                {{ t('domainDetail.cancel') }}
              </button>
            </div>
          </form>
        </div>

        <!-- Records table -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('domainDetail.dnsRecords') }}</h2>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700">
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('domainDetail.type') }}</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('domainDetail.name') }}</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('domainDetail.content') }}</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('domainDetail.ttl') }}</th>
                  <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('domainDetail.priority') }}</th>
                  <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('domainDetail.actions') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr v-if="records.length === 0">
                  <td colspan="6" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                    {{ t('domainDetail.noRecords') }}
                  </td>
                </tr>
                <tr
                  v-for="record in records"
                  :key="record.id"
                  class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                >
                  <td class="px-6 py-4">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                      {{ record.type }}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-sm font-mono text-gray-900 dark:text-white">{{ record.name }}</td>
                  <td class="px-6 py-4 text-sm font-mono text-gray-600 dark:text-gray-400 max-w-xs truncate">{{ record.content }}</td>
                  <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ record.ttl }}s</td>
                  <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ record.priority ?? '--' }}</td>
                  <td class="px-6 py-4 text-right">
                    <button
                      @click="deleteRecord(record.id)"
                      class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                      {{ t('domainDetail.delete') }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <!-- External domain: just show verified status info -->
      <div v-if="!isPurchased && zone.verified" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <div class="flex items-start gap-3">
          <CheckCircle2 class="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
          <div>
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-1">{{ t('domainDetail.domainVerified') }}</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('domainDetail.externalDomainVerifiedDescription') }}
            </p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
