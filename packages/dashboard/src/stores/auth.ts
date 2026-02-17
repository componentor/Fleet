import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User, LoginInput, RegisterInput, AuthTokens } from '@fleet/types'
import { useApi } from '@/composables/useApi'

export const useAuthStore = defineStore('auth', () => {
  const api = useApi()

  // Hydrate user from cache so name/isSuper are available immediately on page reload
  const cachedUser = localStorage.getItem('fleet_user')
  let initialUser: User | null = null
  if (cachedUser) {
    try { initialUser = JSON.parse(cachedUser) } catch { /* ignore */ }
  }

  const user = ref<User | null>(initialUser)
  const token = ref<string | null>(localStorage.getItem('fleet_token'))
  const refreshTokenValue = ref<string | null>(localStorage.getItem('fleet_refresh_token'))
  const loading = ref(false)

  const isAuthenticated = computed(() => !!token.value)
  const isSuper = computed(() => user.value?.isSuper ?? false)

  function setTokens(tokens: AuthTokens) {
    token.value = tokens.accessToken
    refreshTokenValue.value = tokens.refreshToken
    localStorage.setItem('fleet_token', tokens.accessToken)
    localStorage.setItem('fleet_refresh_token', tokens.refreshToken)
  }

  function setToken(newToken: string) {
    token.value = newToken
    localStorage.setItem('fleet_token', newToken)
  }

  function clearAuth() {
    user.value = null
    token.value = null
    refreshTokenValue.value = null
    localStorage.removeItem('fleet_token')
    localStorage.removeItem('fleet_refresh_token')
    localStorage.removeItem('fleet_user')
  }

  async function login(input: LoginInput) {
    loading.value = true
    try {
      const data = await api.post<{ tokens: AuthTokens; user: User }>('/auth/login', input)
      setTokens(data.tokens)
      user.value = data.user
      localStorage.setItem('fleet_user', JSON.stringify(data.user))
      return data
    } finally {
      loading.value = false
    }
  }

  async function register(input: RegisterInput) {
    loading.value = true
    try {
      const data = await api.post<{ tokens: AuthTokens; user: User }>('/auth/register', input)
      setTokens(data.tokens)
      user.value = data.user
      localStorage.setItem('fleet_user', JSON.stringify(data.user))
      return data
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    try {
      await api.post('/auth/logout', {})
    } catch {
      // Ignore logout API errors
    } finally {
      clearAuth()
    }
  }

  async function refreshToken() {
    if (!refreshTokenValue.value) {
      clearAuth()
      throw new Error('No refresh token')
    }
    try {
      const data = await api.post<{ tokens: AuthTokens }>('/auth/refresh', {
        refreshToken: refreshTokenValue.value,
      })
      setTokens(data.tokens)
      return data.tokens
    } catch {
      clearAuth()
      throw new Error('Token refresh failed')
    }
  }

  async function loadUser() {
    if (!token.value) return

    // Try loading from localStorage first
    const cached = localStorage.getItem('fleet_user')
    if (cached) {
      try {
        user.value = JSON.parse(cached)
      } catch {
        // ignore parse errors
      }
    }

    try {
      const data = await api.get<User>('/auth/me')
      user.value = data
      localStorage.setItem('fleet_user', JSON.stringify(data))
    } catch {
      clearAuth()
    }
  }

  return {
    user,
    token,
    loading,
    isAuthenticated,
    isSuper,
    login,
    register,
    logout,
    refreshToken,
    setToken,
    setTokens,
    loadUser,
  }
})
