import chalk from 'chalk'
import { loadConfig, saveConfig, clearConfig, getAccountId } from './config.js'

interface ApiRequestOptions {
  headers?: Record<string, string>
  skipAuth?: boolean
}

export async function apiRequest<T = any>(
  method: string,
  path: string,
  body?: unknown,
  options: ApiRequestOptions = {},
): Promise<T> {
  const config = loadConfig()
  const url = `${config.apiUrl}${path}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (!options.skipAuth) {
    if (config.apiKey) {
      headers['X-API-Key'] = config.apiKey
    } else if (config.accessToken) {
      headers['Authorization'] = `Bearer ${config.accessToken}`
    }
  }

  // Add account context
  const accountId = getAccountId()
  if (accountId) {
    headers['X-Account-Id'] = accountId
  }

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    throw new Error(`Could not connect to Fleet API at ${config.apiUrl}`)
  }

  // Handle 401 — attempt token refresh (only for JWT auth, not API keys)
  if (response.status === 401 && !options.skipAuth && !config.apiKey && config.refreshToken) {
    const refreshed = await tryRefreshToken(config.apiUrl, config.refreshToken)
    if (refreshed) {
      // Retry the original request with new token
      headers['Authorization'] = `Bearer ${refreshed.accessToken}`
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        })
      } catch (err) {
        throw new Error(`Could not connect to Fleet API at ${config.apiUrl}`)
      }
    } else {
      clearConfig()
      throw new Error('Session expired. Please log in again with: fleet login')
    }
  }

  if (!response.ok) {
    let errorMessage: string
    try {
      const errorBody = await response.json() as { message?: string; error?: string }
      errorMessage = errorBody.message || errorBody.error || response.statusText
    } catch {
      errorMessage = response.statusText
    }
    throw new Error(`API error (${response.status}): ${errorMessage}`)
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

async function tryRefreshToken(
  apiUrl: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const response = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as {
      accessToken: string
      refreshToken: string
    }

    // Save new tokens
    const config = loadConfig()
    config.accessToken = data.accessToken
    config.refreshToken = data.refreshToken
    saveConfig(config)

    return data
  } catch {
    return null
  }
}

export function requireAuth(): void {
  const config = loadConfig()
  if (!config.accessToken && !config.apiKey) {
    console.error(chalk.red('Error: You are not logged in.'))
    console.error(chalk.yellow('Run: fleet login'))
    process.exit(1)
  }
}

/**
 * Build a WebSocket URL for the given API path, with auth token and accountId.
 */
export function buildWsUrl(path: string): string {
  const config = loadConfig()
  const base = config.apiUrl.replace(/^http/, 'ws')
  const token = config.accessToken || ''
  const accountId = getAccountId() || ''
  const sep = path.includes('?') ? '&' : '?'
  return `${base}${path}${sep}token=${encodeURIComponent(token)}&accountId=${encodeURIComponent(accountId)}`
}
