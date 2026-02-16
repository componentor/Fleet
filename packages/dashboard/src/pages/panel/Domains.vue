<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Globe, Plus, Search, Loader2, Trash2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const api = useApi()

const activeTab = ref<'my-domains' | 'buy-domain'>('my-domains')
const domains = ref<any[]>([])
const loading = ref(true)
const addingDomain = ref(false)
const showAddModal = ref(false)
const newDomain = ref('')
const error = ref('')

async function fetchDomains() {
  loading.value = true
  try {
    domains.value = await api.get('/dns/zones')
  } catch {
    domains.value = []
  } finally {
    loading.value = false
  }
}

async function addDomain() {
  if (!newDomain.value) return
  addingDomain.value = true
  error.value = ''
  try {
    await api.post('/dns/zones', { domain: newDomain.value })
    newDomain.value = ''
    showAddModal.value = false
    await fetchDomains()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to add domain'
  } finally {
    addingDomain.value = false
  }
}

async function deleteDomain(id: string) {
  if (!confirm('Are you sure you want to delete this domain?')) return
  try {
    await api.del(`/dns/zones/${id}`)
    await fetchDomains()
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
  fetchDomains()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Globe class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Domains</h1>
      </div>
      <button
        @click="showAddModal = true"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        Add Domain
      </button>
    </div>

    <!-- Add domain modal -->
    <div v-if="showAddModal" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Add a Domain</h3>
      <div v-if="error" class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>
      <form @submit.prevent="addDomain" class="flex items-end gap-3">
        <div class="flex-1">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Domain Name</label>
          <input v-model="newDomain" type="text" placeholder="example.com" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
        </div>
        <button type="submit" :disabled="addingDomain || !newDomain" class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
          {{ addingDomain ? 'Adding...' : 'Add' }}
        </button>
        <button type="button" @click="showAddModal = false; error = ''" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
          Cancel
        </button>
      </form>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <!-- Domains table -->
    <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Domain</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created</th>
              <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-if="domains.length === 0">
              <td colspan="4" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                No domains configured. Add your first domain to get started.
              </td>
            </tr>
            <tr v-for="domain in domains" :key="domain.id" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
              <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ domain.domain }}</td>
              <td class="px-6 py-4 text-sm">
                <span
                  :class="[
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    domain.verified
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                      : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                  ]"
                >
                  {{ domain.verified ? 'Verified' : 'Pending' }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(domain.createdAt) }}</td>
              <td class="px-6 py-4 text-right">
                <button @click="deleteDomain(domain.id)" class="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
