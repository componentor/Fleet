import { ref, computed, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'

export type LogStreamState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
export type LogLevel = 'all' | 'error' | 'warn' | 'info' | 'debug'

export interface LogEntry {
  timestamp: string
  level: string
  message: string
  raw: string
  isJson: boolean
  parsedJson?: Record<string, unknown>
}

const LEVEL_PATTERNS: [RegExp, string][] = [
  [/\b(FATAL|CRITICAL)\b/i, 'error'],
  [/\bERROR\b/i, 'error'],
  [/\b(WARN|WARNING)\b/i, 'warn'],
  [/\bINFO\b/i, 'info'],
  [/\bDEBUG\b/i, 'debug'],
  [/"level"\s*:\s*"?(error|fatal|critical)"?/i, 'error'],
  [/"level"\s*:\s*"?(warn|warning)"?/i, 'warn'],
  [/"level"\s*:\s*"?(info)"?/i, 'info'],
  [/"level"\s*:\s*"?(debug|trace)"?/i, 'debug'],
  [/\blevel=(error|fatal)\b/i, 'error'],
  [/\blevel=(warn|warning)\b/i, 'warn'],
  [/\blevel=info\b/i, 'info'],
  [/\blevel=(debug|trace)\b/i, 'debug'],
]

function detectLevel(line: string): string {
  for (const [pattern, level] of LEVEL_PATTERNS) {
    if (pattern.test(line)) return level
  }
  return 'info'
}

function parseLogLine(line: string): LogEntry {
  const trimmed = line.replace(/^\s+/, '')

  // Try to extract Docker timestamp prefix (RFC3339)
  let timestamp = ''
  let rest = trimmed
  const tsMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+/)
  if (tsMatch) {
    timestamp = tsMatch[1] ?? ''
    rest = trimmed.slice(tsMatch[0].length)
  }

  // Try to parse as JSON
  let isJson = false
  let parsedJson: Record<string, unknown> | undefined
  const jsonStart = rest.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const candidate = rest.slice(jsonStart)
      parsedJson = JSON.parse(candidate)
      isJson = true
      if (!timestamp && parsedJson && typeof parsedJson.timestamp === 'string') {
        timestamp = parsedJson.timestamp
      }
    } catch {
      // Not valid JSON
    }
  }

  const level = detectLevel(rest)

  return {
    timestamp,
    level,
    message: rest,
    raw: line,
    isJson,
    parsedJson,
  }
}

export function useLogStream() {
  const logs = ref('')
  const state = ref<LogStreamState>('disconnected')
  const rawLogs = ref<LogEntry[]>([])
  const filterLevel = ref<LogLevel>('all')
  const searchQuery = ref('')
  const jsonPrettyPrint = ref(false)

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let currentServiceId: string | null = null
  let intentionalClose = false

  const MAX_RECONNECT_ATTEMPTS = 5
  const BASE_DELAY_MS = 1000
  const MAX_LOG_LENGTH = 500_000 // Trim logs if they exceed this
  const MAX_LOG_ENTRIES = 5000

  const filteredLogs = computed(() => {
    let entries = rawLogs.value
    if (filterLevel.value !== 'all') {
      entries = entries.filter((e) => e.level === filterLevel.value)
    }
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      entries = entries.filter((e) => e.raw.toLowerCase().includes(q))
    }
    return entries
  })

  function exportLogs() {
    const content = filteredLogs.value.map((e) => e.raw).join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs-${currentServiceId ?? 'service'}-${new Date().toISOString().slice(0, 19)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function start(serviceId: string) {
    intentionalClose = false
    currentServiceId = serviceId
    reconnectAttempts = 0
    logs.value = ''
    rawLogs.value = []
    doConnect(serviceId)
  }

  function doConnect(serviceId: string) {
    state.value = reconnectAttempts > 0 ? 'reconnecting' : 'connecting'

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const authStore = useAuthStore()
    const token = authStore.token
    const accountId = localStorage.getItem('fleet_account_id')
    const wsUrl = `${protocol}//${window.location.host}/api/v1/terminal/logs/${serviceId}?token=${token}&accountId=${accountId}`

    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      state.value = 'connected'
      reconnectAttempts = 0
    }

    ws.onmessage = (event) => {
      const data = event.data as string
      logs.value += data

      // Trim if logs get too large (keep last portion)
      if (logs.value.length > MAX_LOG_LENGTH) {
        logs.value = logs.value.slice(-MAX_LOG_LENGTH)
      }

      // Parse into structured entries
      const lines = data.split('\n').filter((l) => l.trim())
      for (const line of lines) {
        rawLogs.value.push(parseLogLine(line))
      }

      // Trim entries if too many
      if (rawLogs.value.length > MAX_LOG_ENTRIES) {
        rawLogs.value = rawLogs.value.slice(-MAX_LOG_ENTRIES)
      }
    }

    ws.onerror = () => {
      // onerror is always followed by onclose
    }

    ws.onclose = () => {
      state.value = 'disconnected'

      if (intentionalClose) return

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = BASE_DELAY_MS * Math.pow(2, reconnectAttempts)
        reconnectAttempts++
        state.value = 'reconnecting'
        reconnectTimer = setTimeout(() => {
          if (currentServiceId) doConnect(currentServiceId)
        }, delay)
      }
    }
  }

  function parseStaticLogs(text: string) {
    rawLogs.value = []
    const lines = text.split('\n').filter((l) => l.trim())
    for (const line of lines) {
      rawLogs.value.push(parseLogLine(line))
    }
  }

  function stop() {
    intentionalClose = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    ws?.close()
    ws = null
    currentServiceId = null
    state.value = 'disconnected'
  }

  onUnmounted(() => {
    stop()
  })

  return {
    logs,
    state,
    rawLogs,
    filterLevel,
    searchQuery,
    jsonPrettyPrint,
    filteredLogs,
    start,
    stop,
    exportLogs,
    parseStaticLogs,
  }
}
