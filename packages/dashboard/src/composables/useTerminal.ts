import { ref, onUnmounted } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'

export function useTerminal() {
  const terminalRef = ref<HTMLElement | null>(null)
  let terminal: Terminal | null = null
  let fitAddon: FitAddon | null = null
  let ws: WebSocket | null = null

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

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit()
    })
    resizeObserver.observe(container)

    return { terminal, fitAddon, resizeObserver }
  }

  function connect(serviceId: string) {
    if (!terminal) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/v1/terminal/${serviceId}`

    const token = localStorage.getItem('hoster_token')
    ws = new WebSocket(`${wsUrl}?token=${token}`)

    ws.onopen = () => {
      terminal?.writeln('Connected to terminal...')
      // Send initial resize
      if (terminal && fitAddon) {
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
      terminal?.writeln('\r\nConnection error.')
    }

    ws.onclose = () => {
      terminal?.writeln('\r\nConnection closed.')
    }

    // Send input to server
    terminal.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Send resize events
    terminal.onResize(({ cols, rows }) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })
  }

  function disconnect() {
    ws?.close()
    ws = null
  }

  function dispose() {
    disconnect()
    terminal?.dispose()
    terminal = null
    fitAddon = null
  }

  onUnmounted(() => {
    dispose()
  })

  return {
    terminalRef,
    createTerminal,
    connect,
    disconnect,
    dispose,
  }
}
