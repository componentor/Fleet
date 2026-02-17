import { ref, computed, watch } from 'vue'
import { useApi } from './useApi'
import { useAccountStore } from '@/stores/account'
import { useAuthStore } from '@/stores/auth'

type AccountRole = 'viewer' | 'member' | 'admin' | 'owner'
const ROLE_LEVEL: Record<AccountRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 }

const role = ref<AccountRole>('viewer')
const loading = ref(false)
let lastAccountId: string | null = null

export function useRole() {
  const api = useApi()
  const accountStore = useAccountStore()
  const authStore = useAuthStore()

  async function fetchRole() {
    const accountId = accountStore.currentAccount?.id
    if (!accountId) return

    // Skip refetch if same account
    if (accountId === lastAccountId) return

    // Super users always get owner
    if (authStore.isSuper) {
      role.value = 'owner'
      lastAccountId = accountId
      return
    }

    loading.value = true
    try {
      const res = await api.get<{ role: string }>(`/accounts/${accountId}/my-role`)
      role.value = (res.role as AccountRole) ?? 'viewer'
      lastAccountId = accountId
    } catch {
      role.value = 'viewer'
    } finally {
      loading.value = false
    }
  }

  // Re-fetch when account changes
  watch(() => accountStore.currentAccount?.id, (newId) => {
    if (newId && newId !== lastAccountId) {
      fetchRole()
    }
  }, { immediate: true })

  const canWrite = computed(() => ROLE_LEVEL[role.value] >= ROLE_LEVEL.member)
  const canAdmin = computed(() => ROLE_LEVEL[role.value] >= ROLE_LEVEL.admin)
  const canOwner = computed(() => ROLE_LEVEL[role.value] >= ROLE_LEVEL.owner)

  return {
    role,
    loading,
    canWrite,
    canAdmin,
    canOwner,
    fetchRole,
  }
}
