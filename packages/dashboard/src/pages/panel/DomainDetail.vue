<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Globe, Plus, Trash2, CheckCircle2, Clock, Loader2, Shield, Edit2, X as XIcon, AlertTriangle } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const route = useRoute()
const router = useRouter()
const api = useApi()

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
const verifyToken = ref('')

// Nameserver editing
const editingNameservers = ref(false)
const savingNameservers = ref(false)
const editedNameservers = ref<string[]>([])
const registration = ref<any>(null)

const recordTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA']
const showPriority = computed(() => ['MX', 'SRV'].includes(newRecord.value.type))

async function fetchZone() {
  loading.value = true
  error.value = ''
  try {
    const data = await api.get<any>(`/dns/zones/${zoneId.value}`)
    zone.value = data
    records.value = data.records ?? []
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to load domain'
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
    error.value = err?.body?.error || 'Failed to add record'
  } finally {
    addingRecord.value = false
  }
}

async function deleteRecord(recordId: string) {
  if (!confirm('Delete this DNS record?')) return
  error.value = ''
  try {
    await api.del(`/dns/records/${recordId}`)
    await fetchZone()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to delete record'
  }
}

async function verifyDomain() {
  if (!verifyToken.value) return
  verifying.value = true
  error.value = ''
  try {
    await api.post(`/dns/zones/${zoneId.value}/verify`, { token: verifyToken.value })
    await fetchZone()
    verifyToken.value = ''
  } catch (err: any) {
    error.value = err?.body?.error || 'Verification failed'
  } finally {
    verifying.value = false
  }
}

async function fetchRegistration() {
  if (!zone.value) return
  try {
    const registrations = await api.get<any[]>('/domains/registrations')
    registration.value = registrations.find((r: any) => r.domain === zone.value.domain) ?? null
  } catch {
    // Not accessible or no registrations
  }
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
    error.value = 'At least 2 nameservers are required'
    return
  }
  savingNameservers.value = true
  error.value = ''
  try {
    await api.patch(`/dns/zones/${zoneId.value}/nameservers`, { nameservers: valid })
    editingNameservers.value = false
    await fetchZone()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to update nameservers'
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
  fetchZone().then(() => fetchRegistration())
})
</script>

<template>
  <div>
    <!-- Back link + header -->
    <div class="mb-8">
      <router-link to="/panel/domains" class="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-4 transition-colors">
        <ArrowLeft class="w-4 h-4" />
        Back to Domains
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
                {{ zone.verified ? 'Verified' : 'Pending Verification' }}
              </span>
              <span class="text-xs text-gray-400 dark:text-gray-500">Created {{ formatDate(zone.createdAt) }}</span>
            </div>
          </div>
        </div>
        <button
          @click="showAddForm = true"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Plus class="w-4 h-4" />
          Add Record
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <template v-else-if="zone">
      <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>

      <!-- Verification section (if not verified) -->
      <div v-if="!zone.verified" class="mb-6 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 rounded-xl p-6">
        <div class="flex items-start gap-3">
          <Shield class="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
          <div class="flex-1">
            <h3 class="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-1">Domain Verification Required</h3>
            <p class="text-sm text-yellow-700 dark:text-yellow-300 mb-3">Enter the verification token that was provided when you added this domain.</p>
            <form @submit.prevent="verifyDomain" class="flex items-end gap-3">
              <div class="flex-1 max-w-md">
                <input
                  v-model="verifyToken"
                  type="text"
                  placeholder="Verification token"
                  required
                  class="w-full px-3.5 py-2.5 rounded-lg border border-yellow-300 dark:border-yellow-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent text-sm font-mono"
                />
              </div>
              <button type="submit" :disabled="verifying || !verifyToken" class="px-4 py-2.5 rounded-lg bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {{ verifying ? 'Verifying...' : 'Verify' }}
              </button>
            </form>
          </div>
        </div>
      </div>

      <!-- Nameservers -->
      <div class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Nameservers</h3>
          <button
            v-if="!editingNameservers"
            @click="startEditingNameservers"
            class="flex items-center gap-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
          >
            <Edit2 class="w-3.5 h-3.5" />
            Edit
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
          <span v-if="registration" class="ml-2 inline-flex items-center gap-1 px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded text-xs">
            Registered through Fleet
          </span>
        </div>

        <!-- Edit mode -->
        <div v-else class="space-y-3">
          <div class="p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2">
            <AlertTriangle class="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <p class="text-xs text-amber-700 dark:text-amber-300">
              If you use custom nameservers, DNS records managed in Fleet will no longer resolve for this domain. You will need to configure records at your new DNS provider.
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
            Add Nameserver
          </button>

          <div class="flex items-center gap-3 pt-2">
            <button
              @click="saveNameservers"
              :disabled="savingNameservers"
              class="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {{ savingNameservers ? 'Saving...' : 'Save Nameservers' }}
            </button>
            <button
              @click="cancelEditingNameservers"
              class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <!-- Add record form -->
      <div v-if="showAddForm" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Add DNS Record</h3>
        <form @submit.prevent="addRecord" class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Type</label>
              <select
                v-model="newRecord.type"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              >
                <option v-for="t in recordTypes" :key="t" :value="t">{{ t }}</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Name</label>
              <input
                v-model="newRecord.name"
                type="text"
                :placeholder="zone.domain"
                required
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Content</label>
              <input
                v-model="newRecord.content"
                type="text"
                :placeholder="newRecord.type === 'A' ? '192.168.1.1' : newRecord.type === 'CNAME' ? 'target.example.com' : 'value'"
                required
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">TTL</label>
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
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Priority</label>
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
              {{ addingRecord ? 'Adding...' : 'Add Record' }}
            </button>
            <button type="button" @click="showAddForm = false" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
              Cancel
            </button>
          </div>
        </form>
      </div>

      <!-- Records table -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">DNS Records</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Content</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">TTL</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Priority</th>
                <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-if="records.length === 0">
                <td colspan="6" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No DNS records. Click "Add Record" to create one.
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
                    Delete
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
