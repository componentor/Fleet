<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{ serviceId: string }>()
const terminalRef = ref<HTMLDivElement>()
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let ws: WebSocket | null = null
let resizeObserver: ResizeObserver | null = null

function connectWebSocket(serviceId: string) {
  ws?.close()

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = localStorage.getItem('hoster_token')
  ws = new WebSocket(`${protocol}//${window.location.host}/api/v1/terminal/${serviceId}?token=${token}`)

  ws.onmessage = (event) => {
    terminal?.write(event.data)
  }

  ws.onclose = () => {
    terminal?.write('\r\n\x1b[31mConnection closed.\x1b[0m\r\n')
  }

  ws.onerror = () => {
    terminal?.write('\r\n\x1b[31mConnection error.\x1b[0m\r\n')
  }
}

onMounted(() => {
  if (!terminalRef.value) return

  terminal = new Terminal({
    cursorBlink: true,
    theme: {
      background: '#1a1b26',
      foreground: '#a9b1d6',
      cursor: '#c0caf5',
    },
    fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
    fontSize: 14,
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalRef.value)
  fitAddon.fit()

  terminal.onData((data) => {
    ws?.send(data)
  })

  // Handle resize
  resizeObserver = new ResizeObserver(() => fitAddon?.fit())
  resizeObserver.observe(terminalRef.value)

  // Connect
  connectWebSocket(props.serviceId)
})

watch(
  () => props.serviceId,
  (newId, oldId) => {
    if (newId !== oldId) {
      terminal?.clear()
      connectWebSocket(newId)
    }
  },
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  ws?.close()
  terminal?.dispose()
})
</script>

<template>
  <div ref="terminalRef" class="w-full h-full min-h-[400px] rounded-lg overflow-hidden bg-[#1a1b26]"></div>
</template>
