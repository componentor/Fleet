<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { KeyRound, Plus, Trash2, Loader2, Copy, Check, Eye, EyeOff } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { useRole } from '@/composables/useRole'

const api = useApi()
const toast = useToast()
const { canAdmin } = useRole()

const apiKeys = ref<any[]>([])
const loading = ref(true)
const showForm = ref(false)
const newKeyName = ref('')
const adding = ref(false)
const error = ref('')

// Shown only once after creation
const createdKey = ref('')
const copied = ref(false)

async function fetchKeys() {
  loading.value = true
  try {
    apiKeys.value = await api.get<any[]>('/api-keys')
  } catch {
    apiKeys.value = []
  } finally {
    loading.value = false
  }
}

async function createKey() {
  if (!newKeyName.value) return
  adding.value = true
  error.value = ''
  try {
    const result = await api.post<{ key: string; id: string }>('/api-keys', {
      name: newKeyName.value,
    })
    createdKey.value = result.key
    newKeyName.value = ''
    showForm.value = false
    toast.success('API key created successfully')
    await fetchKeys()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to create API key'
  } finally {
    adding.value = false
  }
}

async function revokeKey(keyId: string) {
  if (!confirm('Revoke this API key? This action cannot be undone.')) return
  try {
    await api.del(`/api-keys/${keyId}`)
    toast.success('API key revoked')
    await fetchKeys()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to revoke API key'
  }
}

async function copyKey() {
  try {
    await navigator.clipboard.writeText(createdKey.value)
    copied.value = true
    toast.success('Copied to clipboard')
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    toast.error('Failed to copy')
  }
}

function dismissCreatedKey() {
  createdKey.value = ''
  copied.value = false
}

function formatDate(ts: any) {
  if (!ts) return '--'
  return new Date(ts).toLocaleDateString()
}

onMounted(() => {
  fetchKeys()
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <KeyRound class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">API Keys</h1>
      </div>
      <button
        v-if="!showForm && canAdmin"
        @click="showForm = true"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        Create API Key
      </button>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- Newly created key display (shown only once) -->
    <div v-if="createdKey" class="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
      <p class="text-sm font-medium text-green-700 dark:text-green-300 mb-2">
        Your new API key has been created. Copy it now -- you won't be able to see it again.
      </p>
      <div class="flex items-center gap-2">
        <code class="flex-1 block bg-gray-900 text-green-400 p-3 rounded-lg text-xs overflow-x-auto font-mono select-all">{{ createdKey }}</code>
        <button
          @click="copyKey"
          class="shrink-0 p-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-white transition-colors"
          :title="copied ? 'Copied!' : 'Copy to clipboard'"
        >
          <Check v-if="copied" class="w-4 h-4 text-green-400" />
          <Copy v-else class="w-4 h-4" />
        </button>
      </div>
      <button @click="dismissCreatedKey" class="mt-2 text-xs text-green-600 dark:text-green-400 hover:underline">
        Dismiss
      </button>
    </div>

    <div class="space-y-8">
      <!-- Create key form -->
      <div v-if="showForm" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Create New API Key</h3>
        </div>
        <form @submit.prevent="createKey" class="p-6 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Key Name</label>
            <input
              v-model="newKeyName"
              type="text"
              placeholder="e.g. CI/CD Pipeline, Monitoring"
              required
              class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div class="flex items-center gap-3">
            <button
              type="submit"
              :disabled="adding || !newKeyName"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Loader2 v-if="adding" class="w-4 h-4 animate-spin" />
              <Plus v-else class="w-4 h-4" />
              {{ adding ? 'Creating...' : 'Create Key' }}
            </button>
            <button
              type="button"
              @click="showForm = false"
              class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>

      <!-- Keys table -->
      <div v-if="loading" class="flex items-center justify-center py-20">
        <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
      </div>

      <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Key Prefix</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Used</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created</th>
                <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-if="apiKeys.length === 0">
                <td colspan="5" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No API keys created yet.
                </td>
              </tr>
              <tr
                v-for="key in apiKeys"
                :key="key.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
              >
                <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ key.name }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 font-mono">{{ key.prefix }}...</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never' }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(key.createdAt) }}</td>
                <td v-if="canAdmin" class="px-6 py-4 text-right">
                  <button
                    @click="revokeKey(key.id)"
                    class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                    Revoke
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
