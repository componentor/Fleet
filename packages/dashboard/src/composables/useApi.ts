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
  const refreshToken = localStorage.getItem('fleet_refresh_token')
  if (!refreshToken) return null

  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })

    if (!res.ok) return null

    const data = await res.json()
    const tokens = data.tokens as { accessToken: string; refreshToken: string }
    localStorage.setItem('fleet_token', tokens.accessToken)
    localStorage.setItem('fleet_refresh_token', tokens.refreshToken)
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

  const token = localStorage.getItem('fleet_token')
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const accountId = localStorage.getItem('fleet_account_id')
  if (accountId) {
    headers['X-Account-Id'] = accountId
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
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
        refreshPromise = null
      })
    }

    const newToken = await refreshPromise
    if (newToken) {
      // Retry the original request with the new token
      const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` }
      const retryResponse = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: retryHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })

      if (retryResponse.ok) {
        if (retryResponse.status === 204) return undefined as T
        return retryResponse.json() as Promise<T>
      }
    }

    // Refresh failed — clear auth and redirect to login
    localStorage.removeItem('fleet_token')
    localStorage.removeItem('fleet_refresh_token')
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

    del<T = void>(path: string): Promise<T> {
      return withToastError(request<T>('DELETE', path))
    },
  }
}
