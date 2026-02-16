import { ref, onUnmounted } from 'vue'

export type LogStreamState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export function useLogStream() {
  const logs = ref('')
  const state = ref<LogStreamState>('disconnected')

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let currentServiceId: string | null = null
  let intentionalClose = false

  const MAX_RECONNECT_ATTEMPTS = 5
  const BASE_DELAY_MS = 1000
  const MAX_LOG_LENGTH = 500_000 // Trim logs if they exceed this

  function start(serviceId: string) {
    intentionalClose = false
    currentServiceId = serviceId
    reconnectAttempts = 0
    logs.value = ''
    doConnect(serviceId)
  }

  function doConnect(serviceId: string) {
    state.value = reconnectAttempts > 0 ? 'reconnecting' : 'connecting'

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const token = localStorage.getItem('fleet_token')
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
    start,
    stop,
  }
}
