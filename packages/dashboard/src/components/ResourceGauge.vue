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

// Unique ID per instance for SVG gradient reference
const uid = `gauge-${Math.random().toString(36).slice(2, 9)}`

const gradientStops = computed(() => {
  if (props.highIsGood) {
    if (animated.value >= 80) return ['#22c55e', '#10b981'] // green → emerald
    if (animated.value >= 50) return ['#f59e0b', '#f97316'] // amber → orange
    return ['#ef4444', '#e11d48']                           // red → rose
  }
  if (animated.value >= 90) return ['#ef4444', '#e11d48']   // red → rose
  if (animated.value >= 70) return ['#f59e0b', '#f97316']   // amber → orange
  return ['#0ea5e9', '#0369a1']                             // sky → ocean blue
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
        <defs>
          <linearGradient :id="uid" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" :stop-color="gradientStops[0]" />
            <stop offset="100%" :stop-color="gradientStops[1]" />
          </linearGradient>
        </defs>
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
          :stroke="`url(#${uid})`"
          stroke-width="3"
          stroke-linecap="round"
          :stroke-dasharray="dashArray"
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
