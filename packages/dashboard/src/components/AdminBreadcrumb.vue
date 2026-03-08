<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'

export interface BreadcrumbItem {
  label: string
  to?: string
}

defineProps<{
  items: BreadcrumbItem[]
}>()
</script>

<template>
  <nav class="flex items-center gap-1.5 text-sm mb-4">
    <template v-for="(item, i) in items" :key="i">
      <ChevronRight v-if="i > 0" class="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
      <RouterLink
        v-if="item.to"
        :to="item.to"
        class="text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors truncate"
      >
        {{ item.label }}
      </RouterLink>
      <span v-else class="text-gray-900 dark:text-white font-medium truncate">
        {{ item.label }}
      </span>
    </template>
  </nav>
</template>
