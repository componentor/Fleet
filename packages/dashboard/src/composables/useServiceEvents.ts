import { ref, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'

export type ServiceEvent =
  | { type: 'deployment_started'; deploymentId: string; serviceId: string }

export function useServiceEvents() {
  const lastEvent = ref<ServiceEvent | null>(null)
  const connected = ref(false)

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let intentionalClose = false
  let currentServiceId: string | null = null

  function connect(serviceId: string) {
    disconnect()
    intentionalClose = false
    currentServiceId = serviceId

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const authStore = useAuthStore()
    const token = authStore.token
    const accountId = localStorage.getItem('fleet_account_id')
    const wsUrl = `${protocol}//${window.location.host}/api/v1/terminal/service/${serviceId}/events?accountId=${accountId}`

    ws = new WebSocket(wsUrl, [`auth-${token}`])

    ws.onopen = () => {
      connected.value = true
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as ServiceEvent
        lastEvent.value = data
      } catch {
        // ignore malformed
      }
    }

    ws.onerror = () => {
      // followed by onclose
    }

    ws.onclose = () => {
      connected.value = false
      ws = null
      // Auto-reconnect after 5s unless intentionally closed
      if (!intentionalClose && currentServiceId) {
        reconnectTimer = setTimeout(() => {
          if (currentServiceId) connect(currentServiceId)
        }, 5_000)
      }
    }
  }

  function disconnect() {
    intentionalClose = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    ws?.close()
    ws = null
    currentServiceId = null
    connected.value = false
  }

  onUnmounted(() => {
    disconnect()
  })

  return {
    lastEvent,
    connected,
    connect,
    disconnect,
  }
}
