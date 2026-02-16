<script setup lang="ts">
import { ref } from 'vue'
import { Store, Plus, Pencil, Trash2, Package } from 'lucide-vue-next'

const templates = ref<any[]>([])
const loading = ref(false)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Store class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">App Templates</h1>
      </div>
      <button
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        Add Template
      </button>
    </div>

    <!-- Template grid -->
    <div v-if="templates.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <Package class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
      <p class="text-gray-500 dark:text-gray-400 text-sm">No app templates configured yet.</p>
      <p class="text-gray-400 dark:text-gray-500 text-xs mt-1">Create templates that users can deploy with one click.</p>
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="template in templates"
        :key="template.id"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
      >
        <div class="p-6">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
                <Package class="w-5 h-5 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ template.name }}</h3>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ template.category }}</p>
              </div>
            </div>
            <span
              :class="[
                'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                template.published
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              ]"
            >
              {{ template.published ? 'Published' : 'Draft' }}
            </span>
          </div>
          <p class="mt-3 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{{ template.description }}</p>
        </div>
        <div class="px-6 py-3 bg-gray-50 dark:bg-gray-750 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
          <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <Pencil class="w-3.5 h-3.5" />
            Edit
          </button>
          <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <Trash2 class="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
