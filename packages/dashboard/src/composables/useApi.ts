import { useToast } from './useToast'

const BASE_URL = '/api/v1'

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown,
  ) {
    super(`API Error ${status}: ${statusText}`)
    this.name = 'ApiError'
  }
}

let isRefreshing = false
let refreshPromise: Promise<string | null> | null = null

async function attemptRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // sends httpOnly cookie
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // empty body — cookie has the refresh token
    })

    if (!res.ok) return null

    const data = await res.json()
    const tokens = data.tokens as { accessToken: string; refreshToken: string }

    // Update in-memory token via auth store
    const { useAuthStore } = await import('@/stores/auth')
    const authStore = useAuthStore()
    authStore.token = tokens.accessToken

    return tokens.accessToken
  } catch {
    return null
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // Read token from auth store (in-memory)
  let token: string | null = null
  try {
    const { useAuthStore } = await import('@/stores/auth')
    const authStore = useAuthStore()
    token = authStore.token
  } catch {
    // Store not yet initialized
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const accountId = localStorage.getItem('fleet_account_id')
  if (accountId) {
    headers['X-Account-Id'] = accountId
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include', // always send cookies
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  // Handle 401 with automatic token refresh
  if (response.status === 401 && token && !path.includes('/auth/')) {
    // Deduplicate concurrent refresh attempts
    if (!isRefreshing) {
      isRefreshing = true
      refreshPromise = attemptRefresh().finally(() => {
        isRefreshing = false
        // Do NOT null refreshPromise — let concurrent awaiters read the resolved result
      })
    }

    const newToken = await refreshPromise
    if (newToken) {
      // Retry the original request with the new token
      const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` }
      const retryResponse = await fetch(`${BASE_URL}${path}`, {
        method,
        credentials: 'include',
        headers: retryHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })

      if (retryResponse.ok) {
        if (retryResponse.status === 204) return undefined as T
        return retryResponse.json() as Promise<T>
      }
    }

    // Refresh failed — clear auth and redirect to login
    try {
      const { useAuthStore } = await import('@/stores/auth')
      const authStore = useAuthStore()
      authStore.clearAuth()
    } catch {
      // fallback
    }
    localStorage.removeItem('fleet_user')
    window.location.href = '/login'
    throw new ApiError(401, 'Unauthorized', { error: 'Session expired' })
  }

  if (!response.ok) {
    let errorBody: unknown
    const text = await response.text()
    try {
      errorBody = JSON.parse(text)
    } catch {
      errorBody = text
    }
    throw new ApiError(response.status, response.statusText, errorBody)
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export function useApi() {
  const toast = useToast()

  function withToastError<T>(promise: Promise<T>): Promise<T> {
    return promise.catch((err) => {
      if (err instanceof ApiError && err.status !== 401) {
        const body = err.body as Record<string, string> | undefined
        toast.error(body?.error || body?.message || err.statusText)
      }
      throw err
    })
  }

  return {
    get<T>(path: string): Promise<T> {
      return request<T>('GET', path)
    },

    post<T>(path: string, body: unknown): Promise<T> {
      return withToastError(request<T>('POST', path, body))
    },

    patch<T>(path: string, body: unknown): Promise<T> {
      return withToastError(request<T>('PATCH', path, body))
    },

    put<T>(path: string, body: unknown): Promise<T> {
      return withToastError(request<T>('PUT', path, body))
    },

    del<T = void>(path: string, body?: unknown): Promise<T> {
      return withToastError(request<T>('DELETE', path, body))
    },

    async upload<T>(path: string, formData: FormData): Promise<T> {
      const headers: Record<string, string> = {}

      let token: string | null = null
      try {
        const { useAuthStore } = await import('@/stores/auth')
        const authStore = useAuthStore()
        token = authStore.token
      } catch {}

      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const accountId = localStorage.getItem('fleet_account_id')
      if (accountId) {
        headers['X-Account-Id'] = accountId
      }

      const response = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: formData,
      })

      // Handle 401 with token refresh
      if (response.status === 401 && token && !path.includes('/auth/')) {
        if (!isRefreshing) {
          isRefreshing = true
          refreshPromise = attemptRefresh().finally(() => {
            isRefreshing = false
          })
        }
        const newToken = await refreshPromise
        if (newToken) {
          const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` }
          const retryResponse = await fetch(`${BASE_URL}${path}`, {
            method: 'POST',
            credentials: 'include',
            headers: retryHeaders,
            body: formData,
          })
          if (retryResponse.ok) {
            if (retryResponse.status === 204) return undefined as T
            return retryResponse.json() as Promise<T>
          }
        }
      }

      if (!response.ok) {
        let errorBody: unknown
        const text = await response.text()
        try {
          errorBody = JSON.parse(text)
        } catch {
          errorBody = text
        }
        const err = new ApiError(response.status, response.statusText, errorBody)
        const body = err.body as Record<string, string> | undefined
        toast.error(body?.error || body?.message || err.statusText)
        throw err
      }

      if (response.status === 204) return undefined as T
      return response.json() as Promise<T>
    },

    async downloadBlob(path: string): Promise<Blob> {
      const headers: Record<string, string> = {}

      let token: string | null = null
      try {
        const { useAuthStore } = await import('@/stores/auth')
        const authStore = useAuthStore()
        token = authStore.token
      } catch {}

      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const accountId = localStorage.getItem('fleet_account_id')
      if (accountId) {
        headers['X-Account-Id'] = accountId
      }

      const response = await fetch(`${BASE_URL}${path}`, {
        method: 'GET',
        credentials: 'include',
        headers,
      })

      // Handle 401 with token refresh
      if (response.status === 401 && token && !path.includes('/auth/')) {
        if (!isRefreshing) {
          isRefreshing = true
          refreshPromise = attemptRefresh().finally(() => {
            isRefreshing = false
          })
        }
        const newToken = await refreshPromise
        if (newToken) {
          const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` }
          const retryResponse = await fetch(`${BASE_URL}${path}`, {
            method: 'GET',
            credentials: 'include',
            headers: retryHeaders,
          })
          if (retryResponse.ok) {
            return retryResponse.blob()
          }
        }
      }

      if (!response.ok) {
        throw new ApiError(response.status, response.statusText, 'Download failed')
      }

      return response.blob()
    },
  }
}
