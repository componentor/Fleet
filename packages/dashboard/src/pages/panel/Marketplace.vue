<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Store, Rocket, Loader2, Search } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const api = useApi()
const router = useRouter()

const templates = ref<any[]>([])
const categories = ref<string[]>([])
const loading = ref(true)
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

function startDeploy(tmpl: any) {
  router.push({ name: 'panel-deploy-wizard', params: { slug: tmpl.slug } })
}

onMounted(() => {
  fetchTemplates()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Store class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('marketplace.title') }}</h1>
    </div>

    <!-- Filters -->
    <div class="flex items-center gap-3 mb-6 flex-wrap">
      <div class="relative flex-1 min-w-48 max-w-sm">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="search"
          type="text"
          :placeholder="$t('marketplace.search')"
          class="w-full pl-10 pr-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
        />
      </div>
      <select
        v-model="selectedCategory"
        class="px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
      >
        <option value="">{{ $t('marketplace.allCategories') }}</option>
        <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
      </select>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else-if="filteredTemplates.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('marketplace.noApps') }}</p>
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="tmpl in filteredTemplates"
        :key="tmpl.slug"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden hover:border-primary-300 dark:hover:border-primary-700 transition-colors cursor-pointer group"
        @click="startDeploy(tmpl)"
      >
        <div class="p-6">
          <div class="flex items-start gap-3 mb-3">
            <div class="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0 overflow-hidden">
              <img
                v-if="tmpl.iconUrl"
                :src="tmpl.iconUrl"
                :alt="tmpl.name"
                class="w-7 h-7 object-contain"
                @error="($event.target as HTMLImageElement).style.display = 'none'; ($event.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden')"
              />
              <Store :class="[tmpl.iconUrl ? 'hidden' : '', 'w-5 h-5 text-gray-400 dark:text-gray-500']" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors truncate">{{ tmpl.name }}</h3>
                <span v-if="tmpl.category" :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0', categoryColor(tmpl.category)]">
                  {{ tmpl.category }}
                </span>
              </div>
            </div>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">{{ tmpl.description }}</p>
          <p v-if="tmpl.composeTemplate" class="text-xs text-gray-500 dark:text-gray-500 font-mono truncate">{{ tmpl.slug }}</p>
        </div>
        <div class="px-6 py-3 bg-gray-50 dark:bg-gray-750 border-t border-gray-200 dark:border-gray-700">
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors"
          >
            <Rocket class="w-3.5 h-3.5" />
            {{ $t('marketplace.deploy') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
