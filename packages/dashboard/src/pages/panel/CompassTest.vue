<script setup lang="ts">
import CompassSpinner from '@/components/CompassSpinner.vue'
</script>

<template>
  <div class="p-8 space-y-8">
    <h1 class="text-2xl font-bold dark:text-white">Compass Spinner Preview</h1>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-8">
      <div class="flex flex-col items-center gap-2">
        <span class="text-sm text-gray-500">w-4 h-4</span>
        <CompassSpinner size="w-4 h-4" />
      </div>
      <div class="flex flex-col items-center gap-2">
        <span class="text-sm text-gray-500">w-5 h-5</span>
        <CompassSpinner size="w-5 h-5" />
      </div>
      <div class="flex flex-col items-center gap-2">
        <span class="text-sm text-gray-500">w-6 h-6 (default)</span>
        <CompassSpinner />
      </div>
      <div class="flex flex-col items-center gap-2">
        <span class="text-sm text-gray-500">w-8 h-8</span>
        <CompassSpinner size="w-8 h-8" />
      </div>
      <div class="flex flex-col items-center gap-2">
        <span class="text-sm text-gray-500">w-10 h-10</span>
        <CompassSpinner size="w-10 h-10" />
      </div>
      <div class="flex flex-col items-center gap-2">
        <span class="text-sm text-gray-500">w-12 h-12</span>
        <CompassSpinner size="w-12 h-12" />
      </div>
      <div class="flex flex-col items-center gap-2">
        <span class="text-sm text-gray-500">w-16 h-16</span>
        <CompassSpinner size="w-16 h-16" />
      </div>
      <div class="flex flex-col items-center gap-2">
        <span class="text-sm text-gray-500">w-24 h-24</span>
        <CompassSpinner size="w-24 h-24" />
      </div>
    </div>

    <h2 class="text-xl font-semibold dark:text-white mt-8">On dark background</h2>
    <div class="bg-gray-900 rounded-xl p-8 grid grid-cols-2 md:grid-cols-4 gap-8">
      <div class="flex flex-col items-center gap-2">
        <span class="text-sm text-gray-400">w-6 h-6</span>
        <CompassSpinner color="text-white" />
      </div>
      <div class="flex flex-col items-center gap-2">
        <span class="text-sm text-gray-400">w-8 h-8</span>
        <CompassSpinner size="w-8 h-8" color="text-blue-400" />
      </div>
      <div class="flex flex-col items-center gap-2">
        <span class="text-sm text-gray-400">w-12 h-12</span>
        <CompassSpinner size="w-12 h-12" color="text-emerald-400" />
      </div>
      <div class="flex flex-col items-center gap-2">
        <span class="text-sm text-gray-400">w-16 h-16</span>
        <CompassSpinner size="w-16 h-16" color="text-amber-400" />
      </div>
    </div>

    <h2 class="text-xl font-semibold dark:text-white mt-8">Inline with text</h2>
    <div class="space-y-4">
      <p class="flex items-center gap-2 dark:text-gray-300">
        <CompassSpinner size="w-4 h-4" /> Loading services...
      </p>
      <p class="flex items-center gap-2 dark:text-gray-300">
        <CompassSpinner size="w-5 h-5" /> Deploying your application...
      </p>
      <button class="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg">
        <CompassSpinner size="w-4 h-4" color="text-white" /> Processing
      </button>
    </div>
  </div>
</template>
