import { ref, computed } from 'vue'
import { useApi } from './useApi'
import { useAuthStore } from '@/stores/auth'

export type AdminSection =
  | 'dashboard'
  | 'nodes'
  | 'status'
  | 'users'
  | 'accounts'
  | 'services'
  | 'storage'
  | 'marketplace'
  | 'events'
  | 'errors'
  | 'jobs'
  | 'billing'
  | 'resellers'
  | 'statusPosts'
  | 'emailTemplates'
  | 'sharedDomains'
  | 'settings'
  | 'updates'
  | 'support'
  | 'roles'
  | 'database'

export type AdminPermissionLevel = 'read' | 'write' | 'impersonate'

export type AdminPermissions = Partial<Record<AdminSection, AdminPermissionLevel[]>>

interface PermissionsResponse {
  isSuper: boolean
  permissions: AdminPermissions | null
}

let cached: PermissionsResponse | null = null
let fetchPromise: Promise<PermissionsResponse> | null = null

export function useAdminPermissions() {
  const api = useApi()
  const authStore = useAuthStore()

  const permissions = ref<PermissionsResponse | null>(cached)
  const loading = ref(false)

  async function fetch() {
    // Super users don't need to fetch — they have full access
    if (authStore.isSuper) {
      const result: PermissionsResponse = { isSuper: true, permissions: null }
      cached = result
      permissions.value = result
      return result
    }

    // Not an admin at all
    if (!authStore.user?.adminRoleId) {
      permissions.value = null
      return null
    }

    // Deduplicate concurrent fetches
    if (fetchPromise) {
      const result = await fetchPromise
      permissions.value = result
      return result
    }

    loading.value = true
    try {
      fetchPromise = api.get<PermissionsResponse>('/admin/my-permissions')
      const result = await fetchPromise
      cached = result
      permissions.value = result
      return result
    } catch {
      permissions.value = null
      return null
    } finally {
      loading.value = false
      fetchPromise = null
    }
  }

  function can(section: AdminSection, level: AdminPermissionLevel = 'read'): boolean {
    if (authStore.isSuper) return true
    if (!permissions.value) return false
    if (permissions.value.isSuper) return true
    const perms = permissions.value.permissions
    if (!perms) return false
    const sectionPerms = perms[section]
    return !!sectionPerms && sectionPerms.includes(level)
  }

  const isAdmin = computed(() => authStore.isSuper || !!authStore.user?.adminRoleId)

  function invalidate() {
    cached = null
    permissions.value = null
  }

  return {
    permissions,
    loading,
    fetch,
    can,
    isAdmin,
    invalidate,
  }
}
