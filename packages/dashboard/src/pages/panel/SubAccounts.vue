<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Network, Plus, Loader2, Unlink } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useAccountStore } from '@/stores/account'
import { useRouter } from 'vue-router'

const api = useApi()
const accountStore = useAccountStore()
const router = useRouter()

const tree = ref<any>(null)
const loading = ref(true)
const error = ref('')
const releasingId = ref<string | null>(null)

// Create sub-account
const showCreate = ref(false)
const newName = ref('')
const creating = ref(false)

async function fetchTree() {
  loading.value = true
  const accountId = accountStore.currentAccount?.id
  if (!accountId) { loading.value = false; return }
  try {
    tree.value = await api.get<any>(`/accounts/${accountId}/tree`)
  } catch {
    tree.value = null
  } finally {
    loading.value = false
  }
}

async function createSubAccount() {
  if (!newName.value) return
  creating.value = true
  error.value = ''
  try {
    await api.post('/accounts', {
      name: newName.value,
      parentId: accountStore.currentAccount?.id,
    })
    newName.value = ''
    showCreate.value = false
    await fetchTree()
    await accountStore.fetchAccounts()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to create sub-account'
  } finally {
    creating.value = false
  }
}

function switchToAccount(accountId: string) {
  accountStore.switchAccount(accountId)
  router.push('/panel')
}

async function releaseChild(childId: string, childName: string) {
  if (!confirm(`Release "${childName}" from your account? It will become an independent account.`)) return
  const accountId = accountStore.currentAccount?.id
  if (!accountId) return
  releasingId.value = childId
  error.value = ''
  try {
    await api.post(`/accounts/${accountId}/release/${childId}`, {})
    await fetchTree()
    await accountStore.fetchAccounts()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to release sub-account'
  } finally {
    releasingId.value = null
  }
}

onMounted(() => {
  fetchTree()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Network class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Sub-Accounts</h1>
      </div>
      <button
        @click="showCreate = true"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        Create Sub-Account
      </button>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- Create form -->
    <div v-if="showCreate" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Create Sub-Account</h3>
      <form @submit.prevent="createSubAccount" class="flex items-end gap-3">
        <div class="flex-1">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Account Name</label>
          <input
            v-model="newName"
            type="text"
            placeholder="My Sub-Account"
            required
            class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>
        <button type="submit" :disabled="creating" class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
          {{ creating ? 'Creating...' : 'Create' }}
        </button>
        <button type="button" @click="showCreate = false" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
          Cancel
        </button>
      </form>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <template v-else>
      <!-- Account tree -->
      <div v-if="tree" class="space-y-3">
        <!-- Root account -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ tree.account.name }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">{{ tree.account.slug }}</p>
            </div>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
              Current
            </span>
          </div>
        </div>

        <!-- Children -->
        <div v-if="tree.children && tree.children.length > 0" class="ml-6 space-y-3">
          <div
            v-for="child in tree.children"
            :key="child.account.id"
            class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5"
          >
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ child.account.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">{{ child.account.slug }}</p>
                <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Status:
                  <span :class="child.account.status === 'active' ? 'text-green-600 dark:text-green-400' : 'text-gray-500'">
                    {{ child.account.status }}
                  </span>
                </p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  @click="switchToAccount(child.account.id)"
                  class="px-3 py-1.5 rounded-lg text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                >
                  Switch to
                </button>
                <button
                  @click="releaseChild(child.account.id, child.account.name)"
                  :disabled="releasingId === child.account.id"
                  class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                >
                  <Loader2 v-if="releasingId === child.account.id" class="w-3 h-3 animate-spin" />
                  <Unlink v-else class="w-3 h-3" />
                  Release
                </button>
              </div>
            </div>

            <!-- Nested children -->
            <div v-if="child.children && child.children.length > 0" class="ml-6 mt-3 space-y-2">
              <div
                v-for="grandchild in child.children"
                :key="grandchild.account.id"
                class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-750"
              >
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">{{ grandchild.account.name }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 font-mono">{{ grandchild.account.slug }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    @click="switchToAccount(grandchild.account.id)"
                    class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    Switch to
                  </button>
                  <button
                    @click="releaseChild(grandchild.account.id, grandchild.account.name)"
                    :disabled="releasingId === grandchild.account.id"
                    class="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                  >
                    <Loader2 v-if="releasingId === grandchild.account.id" class="w-3 h-3 animate-spin" />
                    <Unlink v-else class="w-3 h-3" />
                    Release
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="ml-6">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-center">
            <p class="text-sm text-gray-500 dark:text-gray-400">No sub-accounts created yet. Create one to delegate access.</p>
          </div>
        </div>
      </div>

      <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
        <p class="text-sm text-gray-500 dark:text-gray-400">Unable to load account tree.</p>
      </div>
    </template>
  </div>
</template>
