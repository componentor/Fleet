import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Account, CreateAccountInput } from '@fleet/types'
import { useApi } from '@/composables/useApi'

export const useAccountStore = defineStore('account', () => {
  const api = useApi()

  const currentAccount = ref<Account | null>(null)
  const accounts = ref<Account[]>([])
  const loading = ref(false)

  async function fetchAccounts() {
    loading.value = true
    try {
      const data = await api.get<Account[]>('/accounts')
      accounts.value = data

      if (currentAccount.value) {
        // Refresh current account from fresh data (e.g. after name change)
        const updated = data.find((a) => a.id === currentAccount.value!.id)
        if (updated) currentAccount.value = updated
      } else if (data.length > 0) {
        const savedId = localStorage.getItem('fleet_account_id')
        const saved = savedId ? data.find((a) => a.id === savedId) : null
        currentAccount.value = saved ?? data[0]!
        localStorage.setItem('fleet_account_id', currentAccount.value.id)
      }

      return data
    } finally {
      loading.value = false
    }
  }

  async function switchAccount(id: string) {
    const account = accounts.value.find((a) => a.id === id)
    if (account) {
      currentAccount.value = account
      localStorage.setItem('fleet_account_id', id)
      // Force refetch of account-specific data (services, billing, etc.)
      window.location.reload()
    }
  }

  async function createSubAccount(input: CreateAccountInput) {
    loading.value = true
    try {
      const data = await api.post<Account>('/accounts', input)
      accounts.value.push(data)
      return data
    } finally {
      loading.value = false
    }
  }

  function clear() {
    currentAccount.value = null
    accounts.value = []
    localStorage.removeItem('fleet_account_id')
  }

  return {
    currentAccount,
    accounts,
    loading,
    fetchAccounts,
    switchAccount,
    createSubAccount,
    clear,
  }
})
