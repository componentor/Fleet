<script setup lang="ts">
import { ref, computed, onMounted, type Component as VueComponent } from 'vue'

const props = defineProps<{
  label: string
  value: number
  color?: string
  icon?: VueComponent
  highIsGood?: boolean
  detail?: string
}>()

const animated = ref(0)

const clampedValue = computed(() => Math.max(0, Math.min(100, props.value)))

// r=15.9155 gives circumference ≈ 100 for easy percentage math
const radius = 15.9155
const circumference = 2 * Math.PI * radius

const dashArray = computed(() => {
  const filled = (animated.value / 100) * circumference
  return `${filled} ${circumference - filled}`
})

const colorClass = computed(() => {
  if (props.color) return props.color
  if (props.highIsGood) {
    // High = good (e.g. uptime): green at top, red at bottom
    if (animated.value >= 80) return 'text-green-500'
    if (animated.value >= 50) return 'text-amber-500'
    return 'text-red-500'
  }
  // High = bad (e.g. disk usage): red at top, green at bottom
  if (animated.value >= 90) return 'text-red-500'
  if (animated.value >= 70) return 'text-amber-500'
  return 'text-primary-500'
})

onMounted(() => {
  // Animate from 0 to target value
  const end = clampedValue.value
  if (end === 0) { animated.value = 0; return }
  const start = performance.now()
  const duration = 800
  const step = (now: number) => {
    const progress = Math.min((now - start) / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3)
    animated.value = Math.round(eased * end)
    if (progress < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
})
</script>

<template>
  <div class="flex flex-col items-center gap-2">
    <div class="relative w-20 h-20">
      <svg viewBox="0 0 36 36" class="w-full h-full -rotate-90">
        <!-- Background track -->
        <circle
          cx="18" cy="18" :r="radius"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          class="text-gray-200 dark:text-gray-700"
        />
        <!-- Value arc -->
        <circle
          cx="18" cy="18" :r="radius"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          :stroke-dasharray="dashArray"
          :class="colorClass"
          style="transition: stroke-dasharray 0.3s ease"
        />
      </svg>
      <!-- Center text -->
      <div class="absolute inset-0 flex items-center justify-center">
        <span class="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{{ animated }}%</span>
      </div>
    </div>
    <div class="flex flex-col items-center gap-0.5">
      <div class="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
        <component v-if="icon" :is="icon" class="w-3.5 h-3.5" />
        <span>{{ label }}</span>
      </div>
      <span v-if="detail" class="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">{{ detail }}</span>
    </div>
  </div>
</template>
