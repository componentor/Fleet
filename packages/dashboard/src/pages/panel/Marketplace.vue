<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Store, Rocket, Loader2, Search } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const api = useApi()

const templates = ref<any[]>([])
const categories = ref<string[]>([])
const loading = ref(true)
const deploying = ref<string | null>(null)
const error = ref('')
const success = ref('')
const search = ref('')
const selectedCategory = ref('')

const filteredTemplates = computed(() => {
  let result = templates.value
  if (selectedCategory.value) {
    result = result.filter(t => t.category === selectedCategory.value)
  }
  if (search.value) {
    const q = search.value.toLowerCase()
    result = result.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q)
    )
  }
  return result
})

function categoryColor(category: string) {
  switch (category) {
    case 'CMS': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    case 'Database': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    case 'Web Server': return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
    case 'Runtime': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
    case 'Storage': return 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300'
    default: return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }
}

async function fetchTemplates() {
  loading.value = true
  try {
    const [templateData, categoryData] = await Promise.all([
      api.get<any[]>('/marketplace/templates'),
      api.get<string[]>('/marketplace/templates/categories').catch(() => []),
    ])
    templates.value = templateData
    categories.value = Array.isArray(categoryData) ? categoryData : []
  } catch {
    templates.value = []
  } finally {
    loading.value = false
  }
}

async function deploy(slug: string) {
  deploying.value = slug
  error.value = ''
  success.value = ''
  try {
    await api.post('/marketplace/deploy', { slug })
    success.value = `Successfully deployed ${slug}!`
    setTimeout(() => { success.value = '' }, 5000)
  } catch (err: any) {
    error.value = err?.body?.error || `Failed to deploy ${slug}`
  } finally {
    deploying.value = null
  }
}

onMounted(() => {
  fetchTemplates()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Store class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">App Marketplace</h1>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>
    <div v-if="success" class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
      <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
    </div>

    <!-- Filters -->
    <div class="flex items-center gap-3 mb-6 flex-wrap">
      <div class="relative flex-1 min-w-48 max-w-sm">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="search"
          type="text"
          placeholder="Search templates..."
          class="w-full pl-10 pr-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
        />
      </div>
      <select
        v-model="selectedCategory"
        class="px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
      >
        <option value="">All Categories</option>
        <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
      </select>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else-if="filteredTemplates.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <p class="text-sm text-gray-500 dark:text-gray-400">No templates found.</p>
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="tmpl in filteredTemplates"
        :key="tmpl.slug"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
      >
        <div class="p-6">
          <div class="flex items-start justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ tmpl.name }}</h3>
            <span v-if="tmpl.category" :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', categoryColor(tmpl.category)]">
              {{ tmpl.category }}
            </span>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">{{ tmpl.description }}</p>
          <p v-if="tmpl.composeTemplate" class="text-xs text-gray-500 dark:text-gray-500 font-mono truncate">{{ tmpl.slug }}</p>
        </div>
        <div class="px-6 py-3 bg-gray-50 dark:bg-gray-750 border-t border-gray-200 dark:border-gray-700">
          <button
            @click="deploy(tmpl.slug)"
            :disabled="deploying === tmpl.slug"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
          >
            <Loader2 v-if="deploying === tmpl.slug" class="w-3.5 h-3.5 animate-spin" />
            <Rocket v-else class="w-3.5 h-3.5" />
            {{ deploying === tmpl.slug ? 'Deploying...' : 'Deploy' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
