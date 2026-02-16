import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User, LoginInput, RegisterInput, AuthTokens } from '@hoster/types'
import { useApi } from '@/composables/useApi'

export const useAuthStore = defineStore('auth', () => {
  const api = useApi()

  const user = ref<User | null>(null)
  const token = ref<string | null>(localStorage.getItem('hoster_token'))
  const refreshTokenValue = ref<string | null>(localStorage.getItem('hoster_refresh_token'))
  const loading = ref(false)

  const isAuthenticated = computed(() => !!token.value)
  const isSuper = computed(() => user.value?.isSuper ?? false)

  function setTokens(tokens: AuthTokens) {
    token.value = tokens.accessToken
    refreshTokenValue.value = tokens.refreshToken
    localStorage.setItem('hoster_token', tokens.accessToken)
    localStorage.setItem('hoster_refresh_token', tokens.refreshToken)
  }

  function setToken(newToken: string) {
    token.value = newToken
    localStorage.setItem('hoster_token', newToken)
  }

  function clearAuth() {
    user.value = null
    token.value = null
    refreshTokenValue.value = null
    localStorage.removeItem('hoster_token')
    localStorage.removeItem('hoster_refresh_token')
    localStorage.removeItem('hoster_user')
  }

  async function login(input: LoginInput) {
    loading.value = true
    try {
      const data = await api.post<{ tokens: AuthTokens; user: User }>('/auth/login', input)
      setTokens(data.tokens)
      user.value = data.user
      localStorage.setItem('hoster_user', JSON.stringify(data.user))
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
      localStorage.setItem('hoster_user', JSON.stringify(data.user))
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
    const cached = localStorage.getItem('hoster_user')
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
      localStorage.setItem('hoster_user', JSON.stringify(data))
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
