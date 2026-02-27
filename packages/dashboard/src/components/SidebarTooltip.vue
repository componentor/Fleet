<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  label: string
  show: boolean
}>()

const wrapper = ref<HTMLElement>()
const tooltipStyle = ref({ top: '0px', left: '0px' })
const visible = ref(false)

function onEnter() {
  if (!wrapper.value) return
  const rect = wrapper.value.getBoundingClientRect()
  tooltipStyle.value = {
    top: `${rect.top + rect.height / 2}px`,
    left: `${rect.right + 12}px`,
  }
  visible.value = true
}

function onLeave() {
  visible.value = false
}
</script>

<template>
  <div
    ref="wrapper"
    @mouseenter="show && onEnter()"
    @mouseleave="onLeave"
  >
    <slot />
    <Teleport to="body">
      <div
        v-if="show && visible"
        class="fixed z-[9999] -translate-y-1/2 pointer-events-none"
        :style="tooltipStyle"
      >
        <!-- Arrow -->
        <div class="absolute left-0 top-1/2 -translate-x-[6px] -translate-y-1/2 w-0 h-0 border-y-[6px] border-y-transparent border-r-[6px] border-r-gray-900 dark:border-r-gray-700" />
        <!-- Tooltip body -->
        <div class="px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-xs font-medium whitespace-nowrap shadow-xl ring-1 ring-white/10">
          {{ label }}
        </div>
      </div>
    </Teleport>
  </div>
</template>
