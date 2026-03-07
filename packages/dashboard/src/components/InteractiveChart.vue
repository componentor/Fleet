<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

export interface ChartSeries {
  key: string
  label: string
  color: string          // Tailwind-compatible color (used as CSS variable)
  dashed?: boolean
}

export interface ChartDataPoint {
  timestamp: string
  [key: string]: any
}

const props = withDefaults(defineProps<{
  data: ChartDataPoint[]
  series: ChartSeries[]
  height?: number
  formatValue?: (v: number) => string
  formatTime?: (d: Date) => string
  formatBytes?: boolean
}>(), {
  height: 200,
})

// ── Dimensions ────────────────────────────────────────────────────────
const width = 700
const pad = { top: 12, right: 12, bottom: 22, left: 55 }
const innerW = width - pad.left - pad.right
const innerH = computed(() => props.height - pad.top - pad.bottom)
const bottomY = computed(() => props.height - pad.bottom)

// ── Formatting ────────────────────────────────────────────────────────
function defaultFormatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

function defaultFormatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

const fmt = computed(() => props.formatValue ?? (props.formatBytes ? defaultFormatBytes : defaultFormatNumber))

function fmtTime(d: Date): string {
  if (props.formatTime) return props.formatTime(d)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── Scales ────────────────────────────────────────────────────────────
const maxVal = computed(() => {
  let max = 0
  for (const point of props.data) {
    for (const s of props.series) {
      const v = Number(point[s.key]) || 0
      if (v > max) max = v
    }
  }
  return max || 1
})

function xPos(i: number): number {
  return pad.left + (props.data.length === 1 ? innerW / 2 : (i / (props.data.length - 1)) * innerW)
}

function yPos(v: number): number {
  return pad.top + innerH.value - (v / maxVal.value) * innerH.value
}

// ── Smooth path (monotone cubic interpolation) ────────────────────────
function smoothPath(values: number[]): string {
  if (values.length === 0) return ''
  if (values.length === 1) {
    return `M${xPos(0)},${yPos(values[0]!)}`
  }

  const points = values.map((v, i) => ({ x: xPos(i), y: yPos(v) }))
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
}

function areaPath(values: number[]): string {
  if (values.length === 0) return ''
  const linePath = smoothPath(values)
  const lastX = xPos(values.length - 1)
  const firstX = xPos(0)
  return `${linePath} L${lastX},${bottomY.value} L${firstX},${bottomY.value} Z`
}

// ── Grid + time labels ────────────────────────────────────────────────
const gridLines = computed(() => {
  const steps = 4
  return Array.from({ length: steps + 1 }, (_, i) => {
    const val = (maxVal.value / steps) * i
    return { y: yPos(val), label: fmt.value(val) }
  })
})

const timeLabels = computed(() => {
  if (!props.data.length) return []
  const count = Math.min(props.data.length, 8)
  const step = Math.max(1, Math.floor(props.data.length / count))
  const labels: { x: number; label: string }[] = []
  for (let i = 0; i < props.data.length; i += step) {
    labels.push({ x: xPos(i), label: fmtTime(new Date(props.data[i]!.timestamp)) })
  }
  return labels
})

// ── Hover interaction ─────────────────────────────────────────────────
const svgEl = ref<SVGSVGElement | null>(null)
const hoverIndex = ref<number | null>(null)
const tooltipX = ref(0)
const tooltipY = ref(0)

function onMouseMove(e: MouseEvent) {
  if (!svgEl.value || !props.data.length) return
  const rect = svgEl.value.getBoundingClientRect()
  const mouseX = ((e.clientX - rect.left) / rect.width) * width
  // Find nearest data point
  let nearest = 0
  let minDist = Infinity
  for (let i = 0; i < props.data.length; i++) {
    const dist = Math.abs(xPos(i) - mouseX)
    if (dist < minDist) { minDist = dist; nearest = i }
  }
  hoverIndex.value = nearest
  tooltipX.value = e.clientX - rect.left
  tooltipY.value = e.clientY - rect.top
}

function onMouseLeave() {
  hoverIndex.value = null
}

// Touch support
function onTouchMove(e: TouchEvent) {
  if (!svgEl.value || !props.data.length || !e.touches[0]) return
  const rect = svgEl.value.getBoundingClientRect()
  const mouseX = ((e.touches[0].clientX - rect.left) / rect.width) * width
  let nearest = 0
  let minDist = Infinity
  for (let i = 0; i < props.data.length; i++) {
    const dist = Math.abs(xPos(i) - mouseX)
    if (dist < minDist) { minDist = dist; nearest = i }
  }
  hoverIndex.value = nearest
  tooltipX.value = e.touches[0].clientX - rect.left
  tooltipY.value = e.touches[0].clientY - rect.top
}

function onTouchEnd() {
  hoverIndex.value = null
}

// Hover line X position in SVG coords
const hoverLineX = computed(() => hoverIndex.value !== null ? xPos(hoverIndex.value) : 0)

// Tooltip content
const tooltipContent = computed(() => {
  if (hoverIndex.value === null) return null
  const point = props.data[hoverIndex.value]
  if (!point) return null
  const time = new Date(point.timestamp)
  const values = props.series.map(s => ({
    label: s.label,
    color: s.color,
    value: fmt.value(Number(point[s.key]) || 0),
  }))
  return { time: fmtTime(time), values }
})

// Tooltip positioning
const tooltipStyle = computed(() => {
  if (hoverIndex.value === null) return { display: 'none' }
  const flipX = tooltipX.value > (svgEl.value?.getBoundingClientRect().width ?? 0) / 2
  return {
    left: flipX ? `${tooltipX.value - 8}px` : `${tooltipX.value + 8}px`,
    top: `${Math.max(0, tooltipY.value - 60)}px`,
    transform: flipX ? 'translateX(-100%)' : 'none',
  }
})

// Series paths and areas
const seriesPaths = computed(() =>
  props.series.map(s => ({
    ...s,
    path: smoothPath(props.data.map(d => Number(d[s.key]) || 0)),
    area: areaPath(props.data.map(d => Number(d[s.key]) || 0)),
  }))
)

// Hover dots
const hoverDots = computed(() => {
  if (hoverIndex.value === null) return []
  return props.series.map(s => ({
    color: s.color,
    cx: xPos(hoverIndex.value!),
    cy: yPos(Number(props.data[hoverIndex.value!]?.[s.key]) || 0),
  }))
})
</script>

<template>
  <div class="relative">
    <svg
      ref="svgEl"
      :viewBox="`0 0 ${width} ${height}`"
      class="w-full h-auto select-none"
      preserveAspectRatio="xMidYMid meet"
      @mousemove="onMouseMove"
      @mouseleave="onMouseLeave"
      @touchmove.passive="onTouchMove"
      @touchend="onTouchEnd"
    >
      <!-- Gradient definitions -->
      <defs>
        <linearGradient
          v-for="s in series"
          :key="'grad-' + s.key"
          :id="'gradient-' + s.key"
          x1="0" y1="0" x2="0" y2="1"
        >
          <stop offset="0%" :stop-color="s.color" stop-opacity="0.2" />
          <stop offset="100%" :stop-color="s.color" stop-opacity="0.02" />
        </linearGradient>
      </defs>

      <!-- Grid lines -->
      <line
        v-for="(g, i) in gridLines"
        :key="'g' + i"
        :x1="pad.left" :y1="g.y" :x2="width - pad.right" :y2="g.y"
        stroke="currentColor" class="text-gray-200 dark:text-gray-700" stroke-width="0.5"
      />

      <!-- Y-axis labels -->
      <text
        v-for="(g, i) in gridLines"
        :key="'yl' + i"
        :x="pad.left - 4" :y="g.y + 3"
        text-anchor="end" class="fill-gray-400 dark:fill-gray-500" font-size="9"
      >{{ g.label }}</text>

      <!-- X-axis labels -->
      <text
        v-for="(tl, i) in timeLabels"
        :key="'tl' + i"
        :x="tl.x" :y="height - 2"
        text-anchor="middle" class="fill-gray-400 dark:fill-gray-500" font-size="9"
      >{{ tl.label }}</text>

      <!-- Area fills with gradient -->
      <path
        v-for="sp in seriesPaths"
        :key="'area-' + sp.key"
        :d="sp.area"
        :fill="`url(#gradient-${sp.key})`"
      />

      <!-- Lines (smooth curves) -->
      <path
        v-for="sp in seriesPaths"
        :key="'line-' + sp.key"
        :d="sp.path"
        fill="none"
        :stroke="sp.color"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke-dasharray="sp.dashed ? '6 3' : 'none'"
      />

      <!-- Hover vertical line -->
      <line
        v-if="hoverIndex !== null"
        :x1="hoverLineX" :y1="pad.top" :x2="hoverLineX" :y2="bottomY"
        stroke="currentColor" class="text-gray-300 dark:text-gray-600" stroke-width="1" stroke-dasharray="3 3"
      />

      <!-- Hover dots -->
      <template v-if="hoverIndex !== null">
        <circle
          v-for="(dot, i) in hoverDots"
          :key="'dot-' + i"
          :cx="dot.cx" :cy="dot.cy" r="4"
          :fill="dot.color" stroke="white" stroke-width="2"
          class="dark:stroke-gray-800"
        />
      </template>

      <!-- Invisible overlay for mouse tracking -->
      <rect
        :x="pad.left" :y="pad.top"
        :width="width - pad.left - pad.right"
        :height="height - pad.top - pad.bottom"
        fill="transparent"
        class="cursor-crosshair"
      />
    </svg>

    <!-- Tooltip -->
    <div
      v-if="tooltipContent"
      class="absolute pointer-events-none z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-xs"
      :style="tooltipStyle"
    >
      <p class="text-gray-500 dark:text-gray-400 mb-1 font-medium">{{ tooltipContent.time }}</p>
      <div v-for="v in tooltipContent.values" :key="v.label" class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: v.color }" />
        <span class="text-gray-600 dark:text-gray-400">{{ v.label }}:</span>
        <span class="font-semibold text-gray-900 dark:text-white tabular-nums">{{ v.value }}</span>
      </div>
    </div>
  </div>
</template>
