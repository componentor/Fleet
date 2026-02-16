<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Key, Plus, Trash2, Loader2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const api = useApi()

const sshKeys = ref<any[]>([])
const loading = ref(true)
const newKeyName = ref('')
const newKeyContent = ref('')
const adding = ref(false)
const error = ref('')

async function fetchKeys() {
  loading.value = true
  try {
    sshKeys.value = await api.get<any[]>('/ssh/keys')
  } catch {
    sshKeys.value = []
  } finally {
    loading.value = false
  }
}

async function addKey() {
  if (!newKeyName.value || !newKeyContent.value) return
  adding.value = true
  error.value = ''
  try {
    await api.post('/ssh/keys', {
      name: newKeyName.value,
      publicKey: newKeyContent.value,
    })
    newKeyName.value = ''
    newKeyContent.value = ''
    await fetchKeys()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to add SSH key'
  } finally {
    adding.value = false
  }
}

async function removeKey(keyId: string) {
  if (!confirm('Remove this SSH key?')) return
  try {
    await api.del(`/ssh/keys/${keyId}`)
    await fetchKeys()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to remove SSH key'
  }
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
    <div class="flex items-center gap-3 mb-8">
      <Key class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">SSH Access</h1>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <div class="space-y-8">
      <!-- Add key form -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Add SSH Key</h3>
        </div>
        <form @submit.prevent="addKey" class="p-6 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Name</label>
            <input
              v-model="newKeyName"
              type="text"
              placeholder="My laptop key"
              required
              class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Public Key</label>
            <textarea
              v-model="newKeyContent"
              rows="3"
              placeholder="ssh-ed25519 AAAA..."
              required
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
            ></textarea>
          </div>
          <button
            type="submit"
            :disabled="adding || !newKeyName || !newKeyContent"
            class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            <Loader2 v-if="adding" class="w-4 h-4 animate-spin" />
            <Plus v-else class="w-4 h-4" />
            {{ adding ? 'Adding...' : 'Add Key' }}
          </button>
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
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Fingerprint</th>
                <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Added</th>
                <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-if="sshKeys.length === 0">
                <td colspan="4" class="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                  No SSH keys added yet.
                </td>
              </tr>
              <tr
                v-for="key in sshKeys"
                :key="key.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
              >
                <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ key.name }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 font-mono">{{ key.fingerprint }}</td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{{ formatDate(key.createdAt) }}</td>
                <td class="px-6 py-4 text-right">
                  <button
                    @click="removeKey(key.id)"
                    class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                    Remove
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
