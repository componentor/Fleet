<script setup lang="ts">
defineProps<{
  type?: 'card' | 'stat' | 'list' | 'gauge' | 'text' | 'circle'
  count?: number
}>()
</script>

<template>
  <!-- Stat card skeleton -->
  <template v-if="type === 'stat'">
    <div v-for="i in (count ?? 4)" :key="i" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 animate-pulse">
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div class="flex-1 space-y-2">
          <div class="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
          <div class="h-6 w-14 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    </div>
  </template>

  <!-- Card skeleton -->
  <template v-else-if="type === 'card'">
    <div v-for="i in (count ?? 1)" :key="i" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 animate-pulse">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-5 h-5 rounded bg-gray-200 dark:bg-gray-700" />
        <div class="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
      <div class="space-y-3">
        <div v-for="j in 4" :key="j" class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700 shrink-0" />
          <div class="flex-1 space-y-1.5">
            <div class="h-3.5 bg-gray-200 dark:bg-gray-700 rounded" :style="{ width: `${60 + Math.random() * 30}%` }" />
            <div class="h-2.5 bg-gray-100 dark:bg-gray-700/50 rounded w-1/3" />
          </div>
          <div class="w-16 h-5 bg-gray-200 dark:bg-gray-700 rounded-full shrink-0" />
        </div>
      </div>
    </div>
  </template>

  <!-- List skeleton -->
  <template v-else-if="type === 'list'">
    <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 animate-pulse overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
        <div class="w-5 h-5 rounded bg-gray-200 dark:bg-gray-700" />
        <div class="h-5 w-36 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
      <div class="divide-y divide-gray-100 dark:divide-gray-700/50">
        <div v-for="j in (count ?? 5)" :key="j" class="px-6 py-3.5 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700" />
            <div class="space-y-1.5">
              <div class="h-3.5 bg-gray-200 dark:bg-gray-700 rounded" :style="{ width: `${80 + Math.random() * 60}px` }" />
              <div class="h-2.5 bg-gray-100 dark:bg-gray-700/50 rounded w-20" />
            </div>
          </div>
          <div class="w-16 h-5 bg-gray-200 dark:bg-gray-700 rounded-full" />
        </div>
      </div>
    </div>
  </template>

  <!-- Gauge skeleton -->
  <template v-else-if="type === 'gauge'">
    <div v-for="i in (count ?? 6)" :key="i" class="flex flex-col items-center gap-2 animate-pulse">
      <div class="w-20 h-20 rounded-full border-[3px] border-gray-200 dark:border-gray-700" />
      <div class="h-3 w-14 bg-gray-200 dark:bg-gray-700 rounded" />
      <div class="h-2.5 w-10 bg-gray-100 dark:bg-gray-700/50 rounded" />
    </div>
  </template>

  <!-- Circle skeleton -->
  <template v-else-if="type === 'circle'">
    <div class="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
  </template>

  <!-- Text skeleton (default) -->
  <template v-else>
    <div class="space-y-2 animate-pulse">
      <div v-for="i in (count ?? 3)" :key="i" class="h-3 bg-gray-200 dark:bg-gray-700 rounded" :style="{ width: `${50 + Math.random() * 40}%` }" />
    </div>
  </template>
</template>
