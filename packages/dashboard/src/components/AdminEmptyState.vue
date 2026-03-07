<script setup lang="ts">
import { Inbox } from 'lucide-vue-next'

defineProps<{
  icon?: any
  title: string
  description?: string
}>()
</script>

<template>
  <div class="flex flex-col items-center justify-center py-16 px-4">
    <div class="w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-700/50 flex items-center justify-center mb-4">
      <component :is="icon ?? Inbox" class="w-6 h-6 text-gray-400 dark:text-gray-500" />
    </div>
    <p class="text-sm font-medium text-gray-900 dark:text-white mb-1">{{ title }}</p>
    <p v-if="description" class="text-xs text-gray-500 dark:text-gray-400 text-center max-w-xs">{{ description }}</p>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>
