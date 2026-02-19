import { ref, onUnmounted } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useAuthStore } from '@/stores/auth'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export function useTerminal() {
  const terminalRef = ref<HTMLElement | null>(null)
  const connectionState = ref<ConnectionState>('disconnected')

  let terminal: Terminal | null = null
  let fitAddon: FitAddon | null = null
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let currentServiceId: string | null = null
  let intentionalClose = false
  let resizeObserver: ResizeObserver | null = null
  let dataDisposable: { dispose(): void } | null = null
  let resizeDisposable: { dispose(): void } | null = null
  let everConnected = false
  let currentContainerId: string | null = null
  let currentReplicaLabel: string | null = null

  const MAX_RECONNECT_ATTEMPTS = 5
  const BASE_DELAY_MS = 1000

  function createTerminal(container: HTMLElement) {
    terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1b26',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
      },
    })

    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())

    terminal.open(container)
    fitAddon.fit()

    // xterm canvas needs a deferred fit after the DOM layout settles (e.g., after tab switch remount)
    requestAnimationFrame(() => {
      fitAddon?.fit()
      terminal?.refresh(0, terminal.rows - 1)
    })

    resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit()
    })
    resizeObserver.observe(container)

    // Register input/resize handlers once (not per-connection)
    dataDisposable = terminal.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    return { terminal, fitAddon }
  }

  function refit() {
    if (fitAddon && terminal) {
      fitAddon.fit()
      terminal.refresh(0, terminal.rows - 1)
    }
  }

  function connect(serviceId: string, containerId?: string, replicaLabel?: string) {
    if (!terminal) return

    // Tear down any existing connection first to prevent orphaned WebSockets
    // whose onclose handlers would interfere with the new connection state
    if (ws || reconnectTimer) {
      intentionalClose = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        ws.close()
        ws = null
      }
    }

    intentionalClose = false
    currentServiceId = serviceId
    currentContainerId = containerId ?? null
    currentReplicaLabel = replicaLabel ?? null
    reconnectAttempts = 0
    everConnected = false
    doConnect(serviceId)
  }

  function doConnect(serviceId: string) {
    if (!terminal) return

    connectionState.value = reconnectAttempts > 0 ? 'reconnecting' : 'connecting'

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/v1/terminal/${serviceId}`
    const authStore = useAuthStore()
    const token = authStore.token
    const accountId = localStorage.getItem('fleet_account_id')

    let url = `${wsUrl}?token=${token}&accountId=${accountId}`
    if (currentContainerId) {
      url += `&containerId=${encodeURIComponent(currentContainerId)}`
    }

    ws = new WebSocket(url)

    ws.onopen = () => {
      connectionState.value = 'connected'
      const wasReconnecting = reconnectAttempts > 0
      reconnectAttempts = 0
      everConnected = true

      const replicaSuffix = currentReplicaLabel ? ` on ${currentReplicaLabel}` : ''
      if (!wasReconnecting) {
        terminal?.writeln(`Connected to terminal${replicaSuffix}...`)
      } else {
        terminal?.writeln(`\r\nReconnected${replicaSuffix}.`)
      }

      if (terminal && fitAddon) {
        // Refit and refresh the canvas to ensure it renders after remount
        fitAddon.fit()
        terminal.refresh(0, terminal.rows - 1)

        ws?.send(
          JSON.stringify({
            type: 'resize',
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        )
      }
    }

    ws.onmessage = (event) => {
      terminal?.write(event.data as string)
    }

    ws.onerror = () => {
      // onerror is always followed by onclose, handle reconnection there
    }

    ws.onclose = () => {
      connectionState.value = 'disconnected'

      if (intentionalClose) return

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = everConnected
          ? BASE_DELAY_MS * Math.pow(2, reconnectAttempts)
          : BASE_DELAY_MS  // short fixed delay for initial connection failures
        reconnectAttempts++
        if (everConnected) {
          terminal?.writeln(`\r\nConnection lost. Reconnecting in ${delay / 1000}s... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`)
        }
        connectionState.value = 'reconnecting'
        reconnectTimer = setTimeout(() => {
          if (currentServiceId) doConnect(currentServiceId)
        }, delay)
      } else {
        terminal?.writeln('\r\nFailed to connect to terminal. The service may not be running or the terminal server is unavailable.')
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
    connectionState.value = 'disconnected'
  }

  function dispose() {
    disconnect()
    dataDisposable?.dispose()
    dataDisposable = null
    resizeDisposable?.dispose()
    resizeDisposable = null
    resizeObserver?.disconnect()
    resizeObserver = null
    terminal?.dispose()
    terminal = null
    fitAddon = null
  }

  onUnmounted(() => {
    dispose()
  })

  return {
    terminalRef,
    connectionState,
    createTerminal,
    connect,
    disconnect,
    dispose,
    refit,
  }
}
