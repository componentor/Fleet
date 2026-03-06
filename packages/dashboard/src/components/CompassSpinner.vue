<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

withDefaults(defineProps<{
  size?: string
  color?: string
}>(), {
  size: 'w-8 h-8',
  color: 'text-primary-600 dark:text-primary-400',
})

const rotation = ref(0)
let raf = 0
let angle = 0       // current angle in degrees
let velocity = 0    // degrees per frame
let target = 0      // where we're heading
let nextChange = 0  // when to pick a new target (ms)

function pickTarget(now: number) {
  // Random target between -90 and +90 degrees
  const offset = (Math.random() - 0.5) * 180
  target = Math.max(-90, Math.min(90, offset))
  // Random interval 0.3–1.2s before next change — keeps it snappy
  nextChange = now + 300 + Math.random() * 900
}

function tick(now: number) {
  if (now >= nextChange) pickTarget(now)

  // Spring physics: stiffer spring = quicker response
  const stiffness = 0.004 + Math.random() * 0.001
  const damping = 0.90 + Math.random() * 0.03
  const force = (target - angle) * stiffness
  // Random jitter for liveliness
  const jitter = (Math.random() - 0.5) * 0.6
  velocity = (velocity + force + jitter) * damping
  angle += velocity

  rotation.value = angle
  raf = requestAnimationFrame(tick)
}

onMounted(() => {
  // Randomize initial state so multiple spinners don't sync
  angle = (Math.random() - 0.5) * 100
  velocity = (Math.random() - 0.5) * 4
  nextChange = performance.now() + Math.random() * 800
  raf = requestAnimationFrame(tick)
})

onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template>
  <svg
    :class="[size, color]"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <!-- Degree tick marks around the bezel (rotated from top for perfect circle) -->
    <g stroke="currentColor" stroke-linecap="round" opacity="0.2">
      <!-- Cardinal: 0° 90° 180° 270° — long + thick -->
      <line x1="12" y1="1.5" x2="12" y2="3.5" stroke-width="1" transform="rotate(0 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="3.5" stroke-width="1" transform="rotate(90 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="3.5" stroke-width="1" transform="rotate(180 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="3.5" stroke-width="1" transform="rotate(270 12 12)" />
      <!-- Intercardinal: 30° 60° 120° 150° 210° 240° 300° 330° — medium -->
      <line x1="12" y1="1.5" x2="12" y2="3.2" stroke-width="0.7" transform="rotate(30 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="3.2" stroke-width="0.7" transform="rotate(60 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="3.2" stroke-width="0.7" transform="rotate(120 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="3.2" stroke-width="0.7" transform="rotate(150 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="3.2" stroke-width="0.7" transform="rotate(210 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="3.2" stroke-width="0.7" transform="rotate(240 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="3.2" stroke-width="0.7" transform="rotate(300 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="3.2" stroke-width="0.7" transform="rotate(330 12 12)" />
      <!-- Minor: every other 10° — short + thin -->
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(10 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(20 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(40 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(50 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(70 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(80 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(100 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(110 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(130 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(140 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(160 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(170 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(190 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(200 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(220 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(230 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(250 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(260 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(280 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(290 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(310 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(320 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(340 12 12)" />
      <line x1="12" y1="1.5" x2="12" y2="2.8" stroke-width="0.4" transform="rotate(350 12 12)" />
    </g>
    <!-- Cross lines (center only, between letters) -->
    <line x1="12" y1="8" x2="12" y2="16.5" stroke="currentColor" stroke-width="0.5" opacity="0.15" />
    <line x1="7.5" y1="12" x2="16.5" y2="12" stroke="currentColor" stroke-width="0.5" opacity="0.15" />
    <!-- Cardinal letters -->
    <text x="12" y="7.8" text-anchor="middle" fill="currentColor" font-size="3.8" font-weight="800" opacity="0.6" style="font-family: system-ui, sans-serif">N</text>
    <text x="12" y="19.5" text-anchor="middle" fill="currentColor" font-size="3.2" font-weight="400" opacity="0.5" style="font-family: system-ui, sans-serif">S</text>
    <text x="5.8" y="13" text-anchor="middle" fill="currentColor" font-size="3.2" font-weight="400" opacity="0.5" style="font-family: system-ui, sans-serif">W</text>
    <text x="18.2" y="13" text-anchor="middle" fill="currentColor" font-size="3.2" font-weight="400" opacity="0.5" style="font-family: system-ui, sans-serif">E</text>
    <!-- Needle (diamond shape) -->
    <g :style="{ transform: `rotate(${rotation}deg)`, transformOrigin: '12px 12px' }">
      <!-- North half (filled) -->
      <polygon points="12,4.5 13.2,12 10.8,12" fill="currentColor" opacity="0.85" />
      <!-- South half (lighter) -->
      <polygon points="12,19.5 13.2,12 10.8,12" fill="currentColor" opacity="0.3" />
      <!-- Center pivot -->
      <circle cx="12" cy="12" r="1.5" fill="currentColor" opacity="0.5" />
    </g>
  </svg>
</template>
