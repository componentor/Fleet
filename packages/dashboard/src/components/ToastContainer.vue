<script setup lang="ts">
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'

const { toasts, remove } = useToast()

const icons = { success: CheckCircle2, error: AlertCircle, info: Info }
const colors = {
  success: 'bg-green-50/90 dark:bg-green-900/80 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200 backdrop-blur-sm',
  error: 'bg-red-50/90 dark:bg-red-900/80 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 backdrop-blur-sm',
  info: 'bg-blue-50/90 dark:bg-blue-900/80 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 backdrop-blur-sm',
}
const iconColors = {
  success: 'text-green-500 dark:text-green-400',
  error: 'text-red-500 dark:text-red-400',
  info: 'text-blue-500 dark:text-blue-400',
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      <TransitionGroup
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-x-full opacity-0"
        enter-to-class="translate-x-0 opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="translate-x-0 opacity-100"
        leave-to-class="translate-x-full opacity-0"
      >
        <div
          v-for="toast in toasts"
          :key="toast.id"
          :class="[colors[toast.type], 'flex items-start gap-3 p-3.5 rounded-lg border shadow-lg']"
        >
          <component :is="icons[toast.type]" :class="[iconColors[toast.type], 'w-5 h-5 shrink-0 mt-0.5']" />
          <p class="text-sm flex-1">{{ toast.message }}</p>
          <button @click="remove(toast.id)" class="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
            <X class="w-4 h-4" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
