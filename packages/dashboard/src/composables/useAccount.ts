import { computed } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useAuthStore } from '@/stores/auth'

export function useAccount() {
  const accountStore = useAccountStore()
  const authStore = useAuthStore()

  const currentAccount = computed(() => accountStore.currentAccount)
  const accounts = computed(() => accountStore.accounts)
  const loading = computed(() => accountStore.loading)
  const isSuper = computed(() => authStore.isSuper)

  async function switchAccount(id: string) {
    await accountStore.switchAccount(id)
  }

  async function fetchAccounts() {
    await accountStore.fetchAccounts()
  }

  return {
    currentAccount,
    accounts,
    loading,
    isSuper,
    switchAccount,
    fetchAccounts,
  }
}
