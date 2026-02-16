<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Store, Plus, Pencil, Trash2, Package, RefreshCw, Loader2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const api = useApi()

const templates = ref<any[]>([])
const loading = ref(true)
const error = ref('')
const success = ref('')
const syncing = ref(false)

// Create/Edit form
const showForm = ref(false)
const editingSlug = ref<string | null>(null)
const formName = ref('')
const formSlug = ref('')
const formDescription = ref('')
const formCategory = ref('')
const formCompose = ref('')
const saving = ref(false)

async function fetchTemplates() {
  loading.value = true
  try {
    templates.value = await api.get<any[]>('/marketplace/templates')
  } catch {
    templates.value = []
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingSlug.value = null
  formName.value = ''
  formSlug.value = ''
  formDescription.value = ''
  formCategory.value = ''
  formCompose.value = ''
  showForm.value = true
}

function openEdit(tmpl: any) {
  editingSlug.value = tmpl.slug
  formName.value = tmpl.name
  formSlug.value = tmpl.slug
  formDescription.value = tmpl.description || ''
  formCategory.value = tmpl.category || ''
  formCompose.value = tmpl.composeTemplate || ''
  showForm.value = true
}

async function saveTemplate() {
  saving.value = true
  error.value = ''
  try {
    if (editingSlug.value) {
      await api.patch(`/marketplace/templates/${editingSlug.value}`, {
        name: formName.value,
        description: formDescription.value,
        category: formCategory.value,
        composeTemplate: formCompose.value,
      })
      success.value = 'Template updated'
    } else {
      await api.post('/marketplace/templates', {
        slug: formSlug.value,
        name: formName.value,
        description: formDescription.value,
        category: formCategory.value,
        composeTemplate: formCompose.value,
        isBuiltin: true,
      })
      success.value = 'Template created'
    }
    showForm.value = false
    await fetchTemplates()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save template'
  } finally {
    saving.value = false
  }
}

async function deleteTemplate(slug: string) {
  if (!confirm(`Delete template "${slug}"? This cannot be undone.`)) return
  try {
    await api.del(`/marketplace/templates/${slug}`)
    await fetchTemplates()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to delete template'
  }
}

async function syncTemplates() {
  syncing.value = true
  error.value = ''
  try {
    await api.post('/marketplace/sync', {})
    success.value = 'Templates synced from disk'
    await fetchTemplates()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to sync templates'
  } finally {
    syncing.value = false
  }
}

onMounted(() => {
  fetchTemplates()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <Store class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">App Templates</h1>
      </div>
      <div class="flex items-center gap-3">
        <button
          @click="syncTemplates"
          :disabled="syncing"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
        >
          <RefreshCw :class="['w-4 h-4', syncing && 'animate-spin']" />
          Sync
        </button>
        <button
          @click="openCreate"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Plus class="w-4 h-4" />
          Add Template
        </button>
      </div>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>
    <div v-if="success" class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
      <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
    </div>

    <!-- Create/Edit form -->
    <div v-if="showForm" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">
        {{ editingSlug ? 'Edit Template' : 'Create Template' }}
      </h3>
      <form @submit.prevent="saveTemplate" class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Name</label>
            <input v-model="formName" type="text" placeholder="WordPress" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Slug</label>
            <input v-model="formSlug" type="text" placeholder="wordpress" :disabled="!!editingSlug" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono disabled:opacity-50" />
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Category</label>
            <input v-model="formCategory" type="text" placeholder="CMS" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Description</label>
            <input v-model="formDescription" type="text" placeholder="A popular CMS..." class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Compose Template (YAML)</label>
          <textarea
            v-model="formCompose"
            rows="8"
            required
            placeholder="version: '3.8'&#10;services:&#10;  app:&#10;    image: wordpress:latest"
            class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
          ></textarea>
        </div>
        <div class="flex items-center gap-3 pt-2">
          <button type="submit" :disabled="saving" class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
            {{ saving ? 'Saving...' : editingSlug ? 'Update' : 'Create' }}
          </button>
          <button type="button" @click="showForm = false" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
            Cancel
          </button>
        </div>
      </form>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <!-- Template grid -->
    <div v-else-if="templates.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <Package class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
      <p class="text-gray-500 dark:text-gray-400 text-sm">No app templates configured yet.</p>
      <p class="text-gray-400 dark:text-gray-500 text-xs mt-1">Create templates that users can deploy with one click.</p>
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="tmpl in templates"
        :key="tmpl.slug"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
      >
        <div class="p-6">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
                <Package class="w-5 h-5 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ tmpl.name }}</h3>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ tmpl.category }}</p>
              </div>
            </div>
            <span
              :class="[
                'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                tmpl.isBuiltin
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              ]"
            >
              {{ tmpl.isBuiltin ? 'Built-in' : 'Custom' }}
            </span>
          </div>
          <p class="mt-3 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{{ tmpl.description }}</p>
        </div>
        <div class="px-6 py-3 bg-gray-50 dark:bg-gray-750 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
          <button
            @click="openEdit(tmpl)"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <Pencil class="w-3.5 h-3.5" />
            Edit
          </button>
          <button
            @click="deleteTemplate(tmpl.slug)"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 class="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
