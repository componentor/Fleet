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

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const token = localStorage.getItem('hoster_token')
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const accountId = localStorage.getItem('hoster_account_id')
  if (accountId) {
    headers['X-Account-Id'] = accountId
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    let errorBody: unknown
    try {
      errorBody = await response.json()
    } catch {
      errorBody = await response.text()
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
  return {
    get<T>(path: string): Promise<T> {
      return request<T>('GET', path)
    },

    post<T>(path: string, body: unknown): Promise<T> {
      return request<T>('POST', path, body)
    },

    patch<T>(path: string, body: unknown): Promise<T> {
      return request<T>('PATCH', path, body)
    },

    put<T>(path: string, body: unknown): Promise<T> {
      return request<T>('PUT', path, body)
    },

    del<T = void>(path: string): Promise<T> {
      return request<T>('DELETE', path)
    },
  }
}
