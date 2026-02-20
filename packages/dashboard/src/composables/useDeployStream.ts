import { ref, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'

export type DeployStreamState = 'disconnected' | 'connecting' | 'connected'
export type DeployStep = 'queued' | 'cloning' | 'building' | 'pushing' | 'deploying' | 'health_check' | 'succeeded' | 'failed'

export function useDeployStream() {
  const logLines = ref<string[]>([])
  const status = ref<string>('')
  const step = ref<DeployStep | ''>('')
  const state = ref<DeployStreamState>('disconnected')

  let ws: WebSocket | null = null
  let currentDeploymentId: string | null = null
  let intentionalClose = false

  function start(deploymentId: string) {
    stop()
    intentionalClose = false
    currentDeploymentId = deploymentId
    logLines.value = []
    status.value = ''
    step.value = ''
    state.value = 'connecting'

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const authStore = useAuthStore()
    const token = authStore.token
    const accountId = localStorage.getItem('fleet_account_id')
    const wsUrl = `${protocol}//${window.location.host}/api/v1/terminal/deploy/${deploymentId}?token=${token}&accountId=${accountId}`

    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      state.value = 'connected'
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string)

        if (data.status) status.value = data.status
        if (data.step) step.value = data.step

        if (data.type === 'init' && data.log) {
          // Initial log blob — split into lines
          const lines = data.log.split('\n').filter((l: string) => l)
          logLines.value = lines
        } else if (data.logLine) {
          // Incremental log lines
          const lines = data.logLine.split('\n').filter((l: string) => l)
          logLines.value.push(...lines)

          // Cap at 10000 lines
          if (logLines.value.length > 10000) {
            logLines.value = logLines.value.slice(-10000)
          }
        }

        // Auto-close on terminal status
        if (data.status === 'succeeded' || data.status === 'failed') {
          intentionalClose = true
          // Keep state as connected briefly so UI can read final status
        }
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onerror = () => {
      // followed by onclose
    }

    ws.onclose = () => {
      state.value = 'disconnected'
      ws = null
    }
  }

  function stop() {
    intentionalClose = true
    ws?.close()
    ws = null
    currentDeploymentId = null
    state.value = 'disconnected'
  }

  onUnmounted(() => {
    stop()
  })

  return {
    logLines,
    status,
    step,
    state,
    start,
    stop,
  }
}
