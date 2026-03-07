<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Store, Plus, Pencil, Trash2, Package, RefreshCw, X } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const api = useApi()

const templates = ref<any[]>([])
const loading = ref(true)
const error = ref('')
const success = ref('')
const syncing = ref(false)

// Create/Edit modal
const showModal = ref(false)
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
  showModal.value = true
}

function openEdit(tmpl: any) {
  editingSlug.value = tmpl.slug
  formName.value = tmpl.name
  formSlug.value = tmpl.slug
  formDescription.value = tmpl.description || ''
  formCategory.value = tmpl.category || ''
  formCompose.value = tmpl.composeTemplate || ''
  showModal.value = true
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
      success.value = t('super.marketplace.templateUpdated')
    } else {
      await api.post('/marketplace/templates', {
        slug: formSlug.value,
        name: formName.value,
        description: formDescription.value,
        category: formCategory.value,
        composeTemplate: formCompose.value,
        isBuiltin: true,
      })
      success.value = t('super.marketplace.templateCreated')
    }
    showModal.value = false
    await fetchTemplates()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || t('super.marketplace.saveFailed')
  } finally {
    saving.value = false
  }
}

async function deleteTemplate(slug: string) {
  if (!confirm(t('super.marketplace.deleteConfirm', { slug }))) return
  try {
    await api.del(`/marketplace/templates/${slug}`)
    await fetchTemplates()
  } catch (err: any) {
    error.value = err?.body?.error || t('super.marketplace.deleteFailed')
  }
}

async function syncTemplates() {
  syncing.value = true
  error.value = ''
  try {
    await api.post('/marketplace/sync', {})
    success.value = t('super.marketplace.synced')
    await fetchTemplates()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || t('super.marketplace.syncFailed')
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
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <Store class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('super.marketplace.title') }}</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{{ $t('super.marketplace.subtitle') }}</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button
          @click="syncTemplates"
          :disabled="syncing"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
        >
          <RefreshCw :class="['w-4 h-4', syncing && 'animate-spin']" />
          {{ $t('super.marketplace.sync') }}
        </button>
        <button
          @click="openCreate"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Plus class="w-4 h-4" />
          {{ $t('super.marketplace.addTemplate') }}
        </button>
      </div>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>
    <div v-if="success" class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
      <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
    </div>

    <!-- Create/Edit modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" @click="showModal = false"></div>
          <div class="relative w-full max-w-2xl bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 max-h-[90vh] flex flex-col">
            <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ editingSlug ? $t('super.marketplace.editTemplate') : $t('super.marketplace.createTemplate') }}
              </h3>
              <button @click="showModal = false" class="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <X class="w-5 h-5" />
              </button>
            </div>
            <form @submit.prevent="saveTemplate" class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.marketplace.nameLabel') }}</label>
                  <input v-model="formName" type="text" placeholder="WordPress" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.marketplace.slugLabel') }}</label>
                  <input v-model="formSlug" type="text" placeholder="wordpress" :disabled="!!editingSlug" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono disabled:opacity-50" />
                </div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.marketplace.categoryLabel') }}</label>
                  <input v-model="formCategory" type="text" placeholder="CMS" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.marketplace.descriptionLabel') }}</label>
                  <input v-model="formDescription" type="text" :placeholder="$t('super.marketplace.descriptionPlaceholder')" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('super.marketplace.composeLabel') }}</label>
                <textarea
                  v-model="formCompose"
                  rows="10"
                  required
                  placeholder="version: '3.8'&#10;services:&#10;  app:&#10;    image: wordpress:latest"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                ></textarea>
              </div>
            </form>
            <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <button type="button" @click="showModal = false" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700">
                {{ $t('common.cancel') }}
              </button>
              <button @click="saveTemplate" :disabled="saving" class="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {{ saving ? $t('common.saving') : editingSlug ? $t('common.update') : $t('common.create') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <!-- Template grid -->
    <div v-else-if="templates.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <Package class="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
      <p class="text-gray-500 dark:text-gray-400 text-sm">{{ $t('super.marketplace.noTemplates') }}</p>
      <p class="text-gray-400 dark:text-gray-500 text-xs mt-1">{{ $t('super.marketplace.noTemplatesDesc') }}</p>
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
              {{ tmpl.isBuiltin ? $t('super.marketplace.builtIn') : $t('super.marketplace.custom') }}
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
            {{ $t('common.edit') }}
          </button>
          <button
            @click="deleteTemplate(tmpl.slug)"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 class="w-3.5 h-3.5" />
            {{ $t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-active .relative,
.modal-leave-active .relative {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .relative {
  transform: scale(0.95);
  opacity: 0;
}
.modal-leave-to .relative {
  transform: scale(0.95);
  opacity: 0;
}
</style>
