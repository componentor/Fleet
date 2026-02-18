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
  const token = ref<string | null>(null) // In-memory only — never persisted to localStorage
  const loading = ref(false)
  const initialized = ref(false)

  const isAuthenticated = computed(() => !!token.value)
  const isSuper = computed(() => user.value?.isSuper ?? false)

  /** Silently refresh access token on app startup using httpOnly cookie */
  async function init() {
    if (initialized.value) return
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include', // sends the httpOnly cookie
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // empty body — cookie has the refresh token
      })
      if (res.ok) {
        const data = await res.json()
        token.value = data.tokens.accessToken
      } else {
        token.value = null
      }
    } catch {
      // Not logged in or refresh failed
      token.value = null
    } finally {
      initialized.value = true
    }
  }

  function setTokens(tokens: AuthTokens) {
    token.value = tokens.accessToken
    // Refresh token is stored in httpOnly cookie by the server — no localStorage
  }

  function setToken(newToken: string) {
    token.value = newToken
  }

  function clearAuth() {
    user.value = null
    token.value = null
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
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        clearAuth()
        throw new Error('Token refresh failed')
      }
      const data = await res.json()
      token.value = data.tokens.accessToken
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
    initialized,
    isAuthenticated,
    isSuper,
    init,
    login,
    register,
    logout,
    refreshToken,
    setToken,
    setTokens,
    loadUser,
    clearAuth,
  }
})
