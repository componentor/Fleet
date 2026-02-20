<script setup lang="ts">
import { watch, nextTick, ref } from 'vue'
import { Search } from 'lucide-vue-next'
import { useCommandPalette } from '@/composables/useCommandPalette'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const {
  isOpen, query, selectedIndex, results, groupedResults,
  close, execute, moveUp, moveDown, executeSelected, onQueryChange,
} = useCommandPalette()

const inputRef = ref<HTMLInputElement | null>(null)

watch(isOpen, (val) => {
  if (val) {
    nextTick(() => inputRef.value?.focus())
  }
})

watch(query, () => onQueryChange())

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

const typeLabels: Record<string, string> = {
  navigation: 'Navigation',
  service: 'Services',
  domain: 'Domains',
  action: 'Quick Actions',
}

function statusColor(status?: string) {
  switch (status) {
    case 'running': return 'text-green-500'
    case 'stopped': return 'text-gray-400'
    case 'deploying': return 'text-yellow-500'
    case 'failed': return 'text-red-500'
    default: return 'text-gray-400'
  }
}

function getFlatIndex(type: string, indexInGroup: number): number {
  let idx = 0
  for (const [key, items] of Object.entries(groupedResults.value)) {
    if (key === type) return idx + indexInGroup
    idx += items.length
  }
  return idx + indexInGroup
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="isOpen" class="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]" @click.self="close">
        <!-- Backdrop -->
        <div class="fixed inset-0 bg-black/50" @click="close" />

        <!-- Modal -->
        <div class="relative w-full max-w-lg mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <!-- Search input -->
          <div class="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <Search class="w-5 h-5 text-gray-400 shrink-0" />
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              :placeholder="$t('commandPalette.placeholder', 'Search services, pages, actions...')"
              class="flex-1 bg-transparent text-gray-900 dark:text-white text-sm placeholder-gray-400 focus:outline-none"
              @keydown.up.prevent="moveUp"
              @keydown.down.prevent="moveDown"
              @keydown.enter.prevent="executeSelected"
            />
            <kbd class="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium text-gray-400 bg-gray-100 dark:bg-gray-700 rounded">ESC</kbd>
          </div>

          <!-- Results -->
          <div class="max-h-80 overflow-y-auto py-2">
            <template v-if="results.length === 0">
              <div class="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                {{ $t('commandPalette.noResults', 'No results found') }}
              </div>
            </template>

            <template v-for="(items, type) in groupedResults" :key="type">
              <div class="px-3 pt-2 pb-1">
                <span class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  {{ typeLabels[type] ?? type }}
                </span>
              </div>
              <button
                v-for="(item, idx) in items"
                :key="item.id"
                :class="[
                  'flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm transition-colors',
                  getFlatIndex(type, idx) === selectedIndex
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50',
                ]"
                @click="execute(item)"
                @mouseenter="selectedIndex = getFlatIndex(type, idx)"
              >
                <component :is="item.icon" class="w-4 h-4 shrink-0 opacity-60" />
                <span class="flex-1 truncate">{{ item.label }}</span>
                <span v-if="item.description && item.type === 'service'" :class="['text-xs', statusColor(item.description)]">
                  {{ item.description }}
                </span>
                <span v-else-if="item.description" class="text-xs text-gray-400">
                  {{ item.description }}
                </span>
              </button>
            </template>
          </div>

          <!-- Footer -->
          <div class="px-4 py-2.5 border-t border-gray-200 dark:border-gray-700 flex items-center gap-4 text-[10px] text-gray-400">
            <span class="flex items-center gap-1">
              <kbd class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded font-mono">↑↓</kbd> navigate
            </span>
            <span class="flex items-center gap-1">
              <kbd class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded font-mono">↵</kbd> select
            </span>
            <span class="flex items-center gap-1">
              <kbd class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded font-mono">esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
