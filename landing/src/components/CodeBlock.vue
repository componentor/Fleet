<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  code: string
  language?: string
}>()

const copied = ref(false)

function copyCode(code: string) {
  navigator.clipboard.writeText(code)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <div class="group relative overflow-hidden rounded-lg border border-surface-800 bg-surface-900/80">
    <div class="flex items-center justify-between border-b border-surface-800 bg-surface-900 px-4 py-2">
      <span class="text-xs text-surface-500">{{ language ?? 'shell' }}</span>
      <button
        class="text-xs text-surface-500 transition-colors hover:text-surface-300"
        @click="copyCode(code)"
      >
        {{ copied ? 'Copied!' : 'Copy' }}
      </button>
    </div>
    <pre class="overflow-x-auto p-4 text-sm leading-relaxed"><code class="text-surface-300">{{ code }}</code></pre>
  </div>
</template>
