<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  Network, Plus, Unlink,
  Check,
} from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useAccountStore } from '@/stores/account'

const { t } = useI18n()
const api = useApi()
const route = useRoute()
const router = useRouter()
const accountStore = useAccountStore()

const tree = ref<any>(null)
const loading = ref(true)
const error = ref('')
const releasingId = ref<string | null>(null)
const successMessage = ref('')

// ── Wizard state ──
const showWizard = ref(false)
const newName = ref('')
const creating = ref(false)


// ── Tree ──
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

function switchToAccount(accountId: string) {
  accountStore.switchAccount(accountId)
  router.push('/panel')
}

async function releaseChild(childId: string, childName: string) {
  if (!confirm(t('subAccounts.releaseConfirm', { name: childName }))) return
  const accountId = accountStore.currentAccount?.id
  if (!accountId) return
  releasingId.value = childId
  error.value = ''
  try {
    await api.post(`/accounts/${accountId}/release/${childId}`, {})
    await fetchTree()
    await accountStore.fetchAccounts()
  } catch (err: any) {
    error.value = err?.body?.error || t('subAccounts.releaseFailed')
  } finally {
    releasingId.value = null
  }
}

// ── Wizard functions ──
function openWizard() {
  showWizard.value = true
  newName.value = ''
  error.value = ''
  successMessage.value = ''
}

function closeWizard() {
  showWizard.value = false
  error.value = ''
}

async function submitWizard() {
  const accountId = accountStore.currentAccount?.id
  if (!accountId || !newName.value.trim()) return

  creating.value = true
  error.value = ''
  try {
    await api.post<any>(`/accounts/${accountId}/sub-accounts`, {
      name: newName.value.trim(),
    })

    showWizard.value = false
    successMessage.value = t('subAccounts.wizard.successCreated')
    setTimeout(() => { successMessage.value = '' }, 5000)
    await fetchTree()
    await accountStore.fetchAccounts()
  } catch (err: any) {
    error.value = err?.body?.error || t('subAccounts.createFailed')
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  fetchTree()

  // Handle return from Stripe checkout
  if (route.query.sub_account_created === 'true') {
    successMessage.value = t('subAccounts.wizard.successCreated')
    setTimeout(() => { successMessage.value = '' }, 5000)
    // Clean up query params
    router.replace({ path: route.path })
  }
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <Network class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('subAccounts.title') }}</h1>
      </div>
      <button
        v-if="!showWizard"
        @click="openWizard"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        {{ t('subAccounts.create') }}
      </button>
    </div>

    <!-- Success message -->
    <div v-if="successMessage" class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-3">
      <Check class="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
      <p class="text-sm text-green-700 dark:text-green-300">{{ successMessage }}</p>
    </div>

    <!-- Error message -->
    <div v-if="error && !showWizard" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- ─── Create sub-account ─── -->
    <div v-if="showWizard" class="mb-8 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('subAccounts.wizard.nameTitle') }}</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('subAccounts.wizard.nameDesc') }}</p>
      </div>

      <div class="p-6">
        <!-- Error -->
        <div v-if="error" class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
        </div>

        <form @submit.prevent="submitWizard">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('subAccounts.accountName') }}</label>
          <input
            v-model="newName"
            type="text"
            :placeholder="t('subAccounts.namePlaceholder')"
            required
            autofocus
            class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
          <div class="flex items-center gap-3 mt-6">
            <button type="button" @click="closeWizard" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              {{ t('subAccounts.cancel') }}
            </button>
            <button type="submit" :disabled="!newName.trim() || creating" class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              <CompassSpinner v-if="creating" size="w-4 h-4" />
              <Check v-else class="w-4 h-4" />
              {{ creating ? t('subAccounts.wizard.creating') : t('subAccounts.wizard.createButton') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ─── Tree view ─── -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <template v-else>
      <div v-if="tree" class="space-y-3">
        <!-- Root account -->
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ tree.account.name }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">{{ tree.account.slug }}</p>
            </div>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
              {{ t('subAccounts.current') }}
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
                  {{ t('subAccounts.status') }}
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
                  {{ t('subAccounts.switchTo') }}
                </button>
                <button
                  @click="releaseChild(child.account.id, child.account.name)"
                  :disabled="releasingId === child.account.id"
                  class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                >
                  <CompassSpinner v-if="releasingId === child.account.id" size="w-3 h-3" />
                  <Unlink v-else class="w-3 h-3" />
                  {{ t('subAccounts.release') }}
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
                    {{ t('subAccounts.switchTo') }}
                  </button>
                  <button
                    @click="releaseChild(grandchild.account.id, grandchild.account.name)"
                    :disabled="releasingId === grandchild.account.id"
                    class="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                  >
                    <CompassSpinner v-if="releasingId === grandchild.account.id" size="w-3 h-3" />
                    <Unlink v-else class="w-3 h-3" />
                    {{ t('subAccounts.release') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="ml-6">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-center">
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('subAccounts.noSubAccounts') }}</p>
          </div>
        </div>
      </div>

      <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('subAccounts.loadFailed') }}</p>
      </div>
    </template>
  </div>
</template>
