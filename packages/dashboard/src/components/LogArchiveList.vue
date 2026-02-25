<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, Trash2, Loader2, Archive } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const props = defineProps<{
  apiBasePath: string
  showType?: boolean
  showDelete?: boolean
}>()

const { t } = useI18n()
const api = useApi()

interface ArchiveItem {
  id: string
  logType: string
  accountId: string | null
  dateFrom: string
  dateTo: string
  recordCount: number
  sizeBytes: number | null
  filename: string
  status: string | null
  createdAt: string | null
  expiresAt: string | null
}

const archives = ref<ArchiveItem[]>([])
const loading = ref(true)
const page = ref(1)
const totalPages = ref(1)
const total = ref(0)
const deletingId = ref<string | null>(null)
const downloadingId = ref<string | null>(null)

async function fetchArchives() {
  loading.value = true
  try {
    const data = await api.get<{ data: ArchiveItem[]; pagination: { totalPages: number; total: number } }>(
      `${props.apiBasePath}?page=${page.value}&limit=25`,
    )
    archives.value = data.data
    totalPages.value = data.pagination.totalPages
    total.value = data.pagination.total
  } catch {
    archives.value = []
  } finally {
    loading.value = false
  }
}

async function downloadArchive(archive: ArchiveItem) {
  downloadingId.value = archive.id
  try {
    const blob = await api.downloadBlob(`${props.apiBasePath}/${archive.id}/download`)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = archive.filename
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    // Download failed
  } finally {
    downloadingId.value = null
  }
}

async function deleteArchive(archive: ArchiveItem) {
  if (!confirm(t('logArchives.deleteConfirm'))) return
  deletingId.value = archive.id
  try {
    await api.del(`${props.apiBasePath}/${archive.id}`)
    await fetchArchives()
  } catch {
    // Delete failed
  } finally {
    deletingId.value = null
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

onMounted(fetchArchives)
</script>

<template>
  <div>
    <div v-if="loading" class="flex items-center justify-center py-12">
      <Loader2 class="w-6 h-6 animate-spin text-gray-400" />
    </div>
    <div v-else-if="archives.length === 0" class="text-center py-12">
      <Archive class="w-10 h-10 mx-auto text-gray-400 mb-3" />
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('logArchives.noArchives') }}</p>
    </div>
    <div v-else>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th v-if="showType" class="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('logArchives.type') }}</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('logArchives.dateRange') }}</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('logArchives.records') }}</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('logArchives.size') }}</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('logArchives.status') }}</th>
              <th class="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ $t('logArchives.createdAt') }}</th>
              <th class="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-700/50">
            <tr v-for="archive in archives" :key="archive.id" class="hover:bg-gray-50 dark:hover:bg-gray-700/30">
              <td v-if="showType" class="px-4 py-3">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" :class="archive.logType === 'audit' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'">
                  {{ archive.logType === 'audit' ? $t('logArchives.auditLog') : $t('logArchives.errorLog') }}
                </span>
              </td>
              <td class="px-4 py-3 text-gray-700 dark:text-gray-300">
                {{ formatDate(archive.dateFrom) }} — {{ formatDate(archive.dateTo) }}
              </td>
              <td class="px-4 py-3 text-gray-700 dark:text-gray-300">{{ archive.recordCount.toLocaleString() }}</td>
              <td class="px-4 py-3 text-gray-700 dark:text-gray-300">{{ formatBytes(archive.sizeBytes) }}</td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" :class="{
                  'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300': archive.status === 'completed',
                  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300': archive.status === 'pending',
                  'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300': archive.status === 'failed',
                }">
                  {{ archive.status === 'completed' ? $t('logArchives.completed') : archive.status === 'pending' ? $t('logArchives.pending') : $t('logArchives.failed') }}
                </span>
              </td>
              <td class="px-4 py-3 text-gray-500 dark:text-gray-400">{{ formatDate(archive.createdAt) }}</td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-2">
                  <button
                    @click="downloadArchive(archive)"
                    :disabled="downloadingId === archive.id || archive.status !== 'completed'"
                    class="p-1.5 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                    :title="$t('logArchives.download')"
                  >
                    <Loader2 v-if="downloadingId === archive.id" class="w-4 h-4 animate-spin" />
                    <Download v-else class="w-4 h-4" />
                  </button>
                  <button
                    v-if="showDelete !== false"
                    @click="deleteArchive(archive)"
                    :disabled="deletingId === archive.id"
                    class="p-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                    :title="$t('logArchives.delete')"
                  >
                    <Loader2 v-if="deletingId === archive.id" class="w-4 h-4 animate-spin" />
                    <Trash2 v-else class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
        <span class="text-sm text-gray-500 dark:text-gray-400">{{ total }} {{ $t('logArchives.title').toLowerCase() }}</span>
        <div class="flex items-center gap-2">
          <button @click="page--; fetchArchives()" :disabled="page <= 1" class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">{{ $t('activity.previous') }}</button>
          <span class="text-sm text-gray-500 dark:text-gray-400">{{ page }} / {{ totalPages }}</span>
          <button @click="page++; fetchArchives()" :disabled="page >= totalPages" class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">{{ $t('activity.next') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
