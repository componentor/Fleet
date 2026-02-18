<script setup lang="ts">
import type { DocSection } from '@/data/docs'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  sections: DocSection[]
  activeSection: string
}>()

defineEmits<{
  navigate: [id: string]
}>()
</script>

<template>
  <nav class="space-y-1">
    <template v-for="section in sections" :key="section.id">
      <a
        :href="'#' + section.id"
        :class="[
          'block rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
          activeSection === section.id
            ? 'bg-primary-500/10 text-primary-400'
            : 'text-surface-300 hover:bg-surface-800 hover:text-white',
        ]"
        @click.prevent="$emit('navigate', section.id)"
      >
        {{ t(section.titleKey) }}
      </a>
      <div v-if="section.children" class="ml-3 space-y-0.5">
        <a
          v-for="child in section.children"
          :key="child.id"
          :href="'#' + child.id"
          :class="[
            'block rounded-lg px-3 py-1.5 text-sm transition-colors',
            activeSection === child.id
              ? 'text-primary-400'
              : 'text-surface-500 hover:text-surface-300',
          ]"
          @click.prevent="$emit('navigate', child.id)"
        >
          {{ t(child.titleKey) }}
        </a>
      </div>
    </template>
  </nav>
</template>
