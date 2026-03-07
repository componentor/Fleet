<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  values: number[]
  color?: string
  width?: number
  height?: number
}>(), {
  color: '#6366f1',
  width: 80,
  height: 28,
})

const path = computed(() => {
  if (props.values.length < 2) return ''
  const max = Math.max(...props.values, 1)
  const pad = 1
  const w = props.width - pad * 2
  const h = props.height - pad * 2

  const points = props.values.map((v, i) => ({
    x: pad + (i / (props.values.length - 1)) * w,
    y: pad + h - (v / max) * h,
  }))

  const first = points[0]!
  let d = `M${first.x},${first.y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(points.length - 1, i + 2)]!
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`
  }
  return d
})

const areaPath = computed(() => {
  if (!path.value) return ''
  const lastX = 1 + (props.width - 2)
  const firstX = 1
  return `${path.value} L${lastX},${props.height - 1} L${firstX},${props.height - 1} Z`
})

const trend = computed(() => {
  if (props.values.length < 2) return 0
  const half = Math.floor(props.values.length / 2)
  const first = props.values.slice(0, half).reduce((a, b) => a + b, 0) / half
  const second = props.values.slice(half).reduce((a, b) => a + b, 0) / (props.values.length - half)
  if (first === 0) return second > 0 ? 100 : 0
  return ((second - first) / first) * 100
})
</script>

<template>
  <svg :viewBox="`0 0 ${width} ${height}`" :width="width" :height="height" class="overflow-visible">
    <defs>
      <linearGradient :id="'spark-grad-' + color.replace('#', '')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="color" stop-opacity="0.15" />
        <stop offset="100%" :stop-color="color" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path v-if="areaPath" :d="areaPath" :fill="`url(#spark-grad-${color.replace('#', '')})`" />
    <path v-if="path" :d="path" fill="none" :stroke="color" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
