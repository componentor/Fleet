<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Mail, Loader2, Save, RotateCcw, Send, Eye, Code, Check } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const { t } = useI18n()
const api = useApi()

const loading = ref(true)
const saving = ref(false)
const sending = ref(false)
const resetting = ref(false)
const error = ref('')
const success = ref('')

interface EmailTemplate {
  id: string | null
  slug: string
  subject: string
  bodyHtml: string
  variables: string[]
  accountId: string | null
  enabled: boolean
  updatedAt: string | null
  isDefault: boolean
}

const templates = ref<EmailTemplate[]>([])
const selectedSlug = ref<string | null>(null)
const editSubject = ref('')
const editBodyHtml = ref('')
const editEnabled = ref(true)
const testEmail = ref('')
const testVariables = ref<Record<string, string>>({})
const previewMode = ref<'edit' | 'preview'>('edit')

const selectedTemplate = computed(() =>
  templates.value.find((t) => t.slug === selectedSlug.value) ?? null,
)

async function fetchTemplates() {
  loading.value = true
  try {
    templates.value = await api.get<EmailTemplate[]>('/emails/templates')
  } catch {
    templates.value = []
  } finally {
    loading.value = false
  }
}

function selectTemplate(slug: string) {
  selectedSlug.value = slug
  const tpl = templates.value.find((t) => t.slug === slug)
  if (tpl) {
    editSubject.value = tpl.subject
    editBodyHtml.value = tpl.bodyHtml
    editEnabled.value = tpl.enabled
    previewMode.value = 'edit'
    // Build test variables
    testVariables.value = {}
    for (const v of tpl.variables ?? []) {
      testVariables.value[v] = ''
    }
  }
  error.value = ''
  success.value = ''
}

async function saveTemplate() {
  if (!selectedSlug.value) return
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await api.patch(`/emails/templates/${selectedSlug.value}`, {
      subject: editSubject.value,
      bodyHtml: editBodyHtml.value,
      enabled: editEnabled.value,
    })
    success.value = 'Template saved'
    await fetchTemplates()
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save template'
  } finally {
    saving.value = false
  }
}

async function resetTemplate() {
  if (!selectedSlug.value) return
  if (!confirm(`Reset "${selectedSlug.value}" to default? This will delete any customizations.`)) return
  resetting.value = true
  error.value = ''
  try {
    await api.post(`/emails/templates/${selectedSlug.value}/reset`, {})
    success.value = 'Template reset to default'
    await fetchTemplates()
    selectTemplate(selectedSlug.value)
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to reset template'
  } finally {
    resetting.value = false
  }
}

async function sendTest() {
  if (!selectedSlug.value || !testEmail.value) return
  sending.value = true
  error.value = ''
  try {
    await api.post(`/emails/templates/${selectedSlug.value}/test`, {
      to: testEmail.value,
      variables: testVariables.value,
    })
    success.value = `Test email sent to ${testEmail.value}`
    setTimeout(() => { success.value = '' }, 3000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to send test email'
  } finally {
    sending.value = false
  }
}

function renderPreview(): string {
  let html = editBodyHtml.value
  for (const [key, val] of Object.entries(testVariables.value)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val || `[${key}]`)
  }
  return html
}

onMounted(() => {
  fetchTemplates()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Mail class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Email Templates</h1>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else class="flex flex-col lg:flex-row gap-6">
      <!-- Template list -->
      <div class="lg:w-64 shrink-0">
        <nav class="space-y-1">
          <button
            v-for="tpl in templates"
            :key="tpl.slug"
            @click="selectTemplate(tpl.slug)"
            :class="[
              'w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
              selectedSlug === tpl.slug
                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
            ]"
          >
            <div class="flex items-center justify-between">
              <span>{{ tpl.slug }}</span>
              <span v-if="tpl.isDefault" class="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">default</span>
              <span v-else class="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">custom</span>
            </div>
          </button>
        </nav>
      </div>

      <!-- Editor -->
      <div class="flex-1 min-w-0">
        <div v-if="!selectedSlug" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
          Select a template from the list to edit it.
        </div>

        <template v-else>
          <!-- Alerts -->
          <div v-if="error" class="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
          </div>
          <div v-if="success" class="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
          </div>

          <!-- Template editor card -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ selectedSlug }}</h2>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Variables: {{ selectedTemplate?.variables?.join(', ') || 'none' }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <input v-model="editEnabled" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                  Enabled
                </label>
              </div>
            </div>

            <div class="p-6 space-y-5">
              <!-- Subject -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Subject</label>
                <input
                  v-model="editSubject"
                  type="text"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>

              <!-- Body mode toggle -->
              <div class="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
                <button
                  @click="previewMode = 'edit'"
                  :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors', previewMode === 'edit' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700']"
                >
                  <Code class="w-3.5 h-3.5" /> HTML
                </button>
                <button
                  @click="previewMode = 'preview'"
                  :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors', previewMode === 'preview' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700']"
                >
                  <Eye class="w-3.5 h-3.5" /> Preview
                </button>
              </div>

              <!-- Body HTML editor -->
              <div v-if="previewMode === 'edit'">
                <textarea
                  v-model="editBodyHtml"
                  rows="16"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                />
              </div>

              <!-- Preview (sandboxed iframe to prevent XSS from template HTML) -->
              <div v-else class="border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 min-h-[200px]">
                <iframe
                  :srcdoc="renderPreview()"
                  sandbox=""
                  class="w-full min-h-[200px] border-0"
                  style="background: white;"
                />
              </div>

              <!-- Actions -->
              <div class="flex items-center gap-3 pt-2">
                <button
                  @click="saveTemplate"
                  :disabled="saving"
                  class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                  Save
                </button>
                <button
                  @click="resetTemplate"
                  :disabled="resetting"
                  class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  <Loader2 v-if="resetting" class="w-4 h-4 animate-spin" />
                  <RotateCcw v-else class="w-4 h-4" />
                  Reset to Default
                </button>
              </div>
            </div>
          </div>

          <!-- Test email card -->
          <div class="mt-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-base font-semibold text-gray-900 dark:text-white">Send Test Email</h3>
            </div>
            <div class="p-6 space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Recipient</label>
                <input
                  v-model="testEmail"
                  type="email"
                  placeholder="test@example.com"
                  class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>

              <!-- Test variables -->
              <div v-if="Object.keys(testVariables).length > 0">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Test Variables</label>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div v-for="(val, key) in testVariables" :key="key">
                    <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">{{ key }}</label>
                    <input
                      v-model="testVariables[key]"
                      type="text"
                      :placeholder="`[${key}]`"
                      class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-xs"
                    />
                  </div>
                </div>
              </div>

              <button
                @click="sendTest"
                :disabled="sending || !testEmail"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="sending" class="w-4 h-4 animate-spin" />
                <Send v-else class="w-4 h-4" />
                Send Test
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
