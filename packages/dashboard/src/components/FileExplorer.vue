<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  Folder,
  FileText,
  FileCode2,
  LayoutGrid,
  List,
  Plus,
  FolderPlus,
  Upload,
  Download,
  Trash2,
  ArrowLeft,
  ChevronRight,
  Save,
  X,
  Loader2,
  RefreshCw,
  Archive,
  File as FileIcon,
  Terminal,
  Copy,
} from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useAccountStore } from '@/stores/account'
import { usePlatformDomain } from '@/composables/usePlatformDomain'
import { useI18n } from 'vue-i18n'

interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  modified: string
}

const props = defineProps<{
  serviceId: string
}>()

const { t } = useI18n()
const api = useApi()

const currentPath = ref('/')
const entries = ref<FileEntry[]>([])
const loading = ref(false)
const error = ref('')

const viewMode = ref<'grid' | 'table'>(
  (localStorage.getItem('fleet_file_view') as 'grid' | 'table') || 'table'
)

// Editor state
const editingFile = ref<{ path: string; content: string; modified: string } | null>(null)
const saving = ref(false)

// New file/folder dialog
const showNewDialog = ref<'file' | 'folder' | null>(null)
const newName = ref('')

// Upload / drag-and-drop state
const uploading = ref(false)
const dragOver = ref(false)
const uploadProgress = ref('')
const showRebuild = ref(false)
const rebuildFile = ref<File | null>(null)
const rebuilding = ref(false)

// SFTP connection info
const accountStore = useAccountStore()
const showSftpInfo = ref(false)
const sftpCopied = ref('')

const { domain: sftpHost, fetchDomain: fetchPlatformDomain } = usePlatformDomain()
const sftpPort = '2222'
const sftpUsername = computed(() => {
  const accountId = accountStore.currentAccount?.id
  return accountId ? `${accountId}/${props.serviceId}` : ''
})
const sftpCommand = computed(() => `sftp -P ${sftpPort} ${sftpUsername.value}@${sftpHost.value}`)

function copySftp(text: string, label: string) {
  navigator.clipboard.writeText(text)
  sftpCopied.value = label
  setTimeout(() => { sftpCopied.value = '' }, 2000)
}

const breadcrumbs = computed(() => {
  if (currentPath.value === '/') return [{ name: 'root', path: '/' }]
  const parts = currentPath.value.split('/').filter(Boolean)
  const crumbs = [{ name: 'root', path: '/' }]
  let accumulated = ''
  for (const part of parts) {
    accumulated += `/${part}`
    crumbs.push({ name: part, path: accumulated })
  }
  return crumbs
})

function setViewMode(mode: 'grid' | 'table') {
  viewMode.value = mode
  localStorage.setItem('fleet_file_view', mode)
}

async function fetchEntries() {
  loading.value = true
  error.value = ''
  try {
    const data = await api.get<{ entries: FileEntry[]; currentPath: string }>(
      `/files/${props.serviceId}/list?path=${encodeURIComponent(currentPath.value)}`
    )
    entries.value = data.entries
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to load files'
  } finally {
    loading.value = false
  }
}

function navigateTo(path: string) {
  currentPath.value = path
  editingFile.value = null
}

function goUp() {
  if (currentPath.value === '/') return
  const parts = currentPath.value.split('/').filter(Boolean)
  parts.pop()
  currentPath.value = parts.length ? `/${parts.join('/')}` : '/'
}

function handleEntryClick(entry: FileEntry) {
  if (entry.type === 'directory') {
    const newPath = currentPath.value === '/'
      ? `/${entry.name}`
      : `${currentPath.value}/${entry.name}`
    navigateTo(newPath)
  } else {
    openFile(entry)
  }
}

async function openFile(entry: FileEntry) {
  const filePath = currentPath.value === '/'
    ? entry.name
    : `${currentPath.value.replace(/^\//, '')}/${entry.name}`
  try {
    const data = await api.get<{ content: string; path: string; size: number; modified: string }>(
      `/files/${props.serviceId}/read?path=${encodeURIComponent(filePath)}`
    )
    editingFile.value = { path: filePath, content: data.content, modified: data.modified }
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to open file'
  }
}

async function saveFile() {
  if (!editingFile.value) return
  saving.value = true
  try {
    await api.put(`/files/${props.serviceId}/write`, {
      path: editingFile.value.path,
      content: editingFile.value.content,
    })
    editingFile.value = null
    await fetchEntries()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to save file'
  } finally {
    saving.value = false
  }
}

async function createEntry() {
  if (!newName.value.trim()) return
  const path = currentPath.value === '/'
    ? newName.value.trim()
    : `${currentPath.value.replace(/^\//, '')}/${newName.value.trim()}`
  try {
    if (showNewDialog.value === 'folder') {
      await api.post(`/files/${props.serviceId}/mkdir`, { path })
    } else {
      await api.put(`/files/${props.serviceId}/write`, { path, content: '' })
    }
    showNewDialog.value = null
    newName.value = ''
    await fetchEntries()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to create'
  }
}

async function deleteEntry(entry: FileEntry) {
  if (!confirm(t('fileExplorer.deleteConfirm', { name: entry.name }))) return
  const path = currentPath.value === '/'
    ? entry.name
    : `${currentPath.value.replace(/^\//, '')}/${entry.name}`
  try {
    await api.del(`/files/${props.serviceId}/delete`, { path })
    await fetchEntries()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to delete'
  }
}

async function downloadFile(entry: FileEntry) {
  const path = currentPath.value === '/'
    ? entry.name
    : `${currentPath.value.replace(/^\//, '')}/${entry.name}`
  try {
    const blob = await api.downloadBlob(
      `/files/${props.serviceId}/download?path=${encodeURIComponent(path)}`
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = entry.name
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    error.value = 'Failed to download file'
  }
}

async function downloadArchive(format: 'zip' | 'tar') {
  try {
    const blob = await api.downloadBlob(
      `/files/${props.serviceId}/download-archive?format=${format}`
    )
    const ext = format === 'zip' ? 'zip' : 'tar.gz'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `project.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    error.value = 'Failed to download archive'
  }
}

async function handleFileUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return
  uploading.value = true
  error.value = ''
  const basePath = currentPath.value === '/' ? '' : currentPath.value.replace(/^\//, '')
  try {
    for (let i = 0; i < files.length; i++) {
      uploadProgress.value = files.length > 1 ? `${i + 1}/${files.length}` : ''
      const formData = new FormData()
      formData.append('file', files[i]!)
      formData.append('path', basePath)
      await api.upload(`/files/${props.serviceId}/upload`, formData)
    }
    await fetchEntries()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to upload file'
  } finally {
    uploading.value = false
    uploadProgress.value = ''
    input.value = ''
  }
}

async function handleDrop(e: DragEvent) {
  dragOver.value = false
  if (!e.dataTransfer?.items) return
  uploading.value = true
  uploadProgress.value = ''
  error.value = ''

  try {
    const items = Array.from(e.dataTransfer.items)
    const filesToUpload: Array<{ file: File; relativePath: string }> = []

    // Use webkitGetAsEntry for folder support
    const entries = items
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => entry != null)

    for (const entry of entries) {
      await readEntryRecursive(entry, '', filesToUpload)
    }

    if (filesToUpload.length === 0) return

    const basePath = currentPath.value === '/' ? '' : currentPath.value.replace(/^\//, '')

    for (let i = 0; i < filesToUpload.length; i++) {
      const { file, relativePath } = filesToUpload[i]!
      uploadProgress.value = `${i + 1}/${filesToUpload.length}`
      const formData = new FormData()
      formData.append('file', file)
      const uploadPath = basePath ? `${basePath}/${relativePath}` : relativePath
      formData.append('path', uploadPath)
      await api.upload(`/files/${props.serviceId}/upload`, formData)
    }

    await fetchEntries()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to upload files'
  } finally {
    uploading.value = false
    uploadProgress.value = ''
  }
}

function readEntryRecursive(
  entry: FileSystemEntry,
  parentPath: string,
  results: Array<{ file: File; relativePath: string }>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      ;(entry as FileSystemFileEntry).file((file) => {
        const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name
        results.push({ file, relativePath })
        resolve()
      }, reject)
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader()
      const dirPath = parentPath ? `${parentPath}/${entry.name}` : entry.name
      const readAll = (allEntries: FileSystemEntry[] = []) => {
        dirReader.readEntries(async (batch) => {
          if (batch.length === 0) {
            // Done reading this directory
            for (const child of allEntries) {
              await readEntryRecursive(child, dirPath, results)
            }
            resolve()
          } else {
            // readEntries may return in batches
            readAll([...allEntries, ...batch])
          }
        }, reject)
      }
      readAll()
    } else {
      resolve()
    }
  })
}

function onRebuildFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  rebuildFile.value = input.files?.[0] || null
}

async function triggerRebuild() {
  if (!rebuildFile.value) return
  rebuilding.value = true
  try {
    const formData = new FormData()
    formData.append('file', rebuildFile.value)
    await api.upload(`/upload/${props.serviceId}/rebuild`, formData)
    rebuildFile.value = null
    showRebuild.value = false
    await fetchEntries()
  } catch (err: any) {
    error.value = err?.body?.error || 'Rebuild failed'
  } finally {
    rebuilding.value = false
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  const codeExts = ['ts', 'js', 'tsx', 'jsx', 'vue', 'py', 'go', 'rs', 'java', 'rb', 'php', 'sh', 'bash', 'yml', 'yaml', 'json', 'toml', 'xml', 'html', 'css', 'scss', 'sql', 'graphql']
  if (codeExts.includes(ext || '')) return FileCode2
  return FileText
}

watch(currentPath, () => fetchEntries())

onMounted(() => {
  fetchEntries()
  fetchPlatformDomain()
})
</script>

<template>
  <div>
    <!-- Error -->
    <div v-if="error" class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- File Editor Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="editingFile" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" @click="editingFile = null"></div>
          <div class="relative w-full max-w-4xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-xl shadow-2xl flex flex-col">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('fileExplorer.editFile') }}</h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono">{{ editingFile.path }}</p>
              </div>
              <button @click="editingFile = null" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X class="w-5 h-5" />
              </button>
            </div>
            <div class="flex-1 overflow-hidden p-4">
              <textarea
                v-model="editingFile.content"
                class="w-full h-full min-h-[400px] px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                spellcheck="false"
              ></textarea>
            </div>
            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                @click="editingFile = null"
                class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {{ t('fileExplorer.cancel') || 'Cancel' }}
              </button>
              <button
                @click="saveFile"
                :disabled="saving"
                class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
                <Save v-else class="w-4 h-4" />
                {{ saving ? t('fileExplorer.saving') : t('fileExplorer.saveFile') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- New file/folder dialog -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showNewDialog" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" @click="showNewDialog = null"></div>
          <div class="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-2xl">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                {{ showNewDialog === 'file' ? t('fileExplorer.newFile') : t('fileExplorer.newFolder') }}
              </h3>
            </div>
            <form @submit.prevent="createEntry" class="p-6">
              <input
                v-model="newName"
                type="text"
                :placeholder="showNewDialog === 'file' ? t('fileExplorer.fileName') : t('fileExplorer.folderName')"
                required
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                autofocus
              />
              <div class="mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  @click="showNewDialog = null; newName = ''"
                  class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {{ t('fileExplorer.cancel') || 'Cancel' }}
                </button>
                <button
                  type="submit"
                  :disabled="!newName.trim()"
                  class="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  {{ t('fileExplorer.create') || 'Create' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Toolbar -->
    <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-4">
      <div class="px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
        <!-- Breadcrumbs -->
        <div class="flex items-center gap-1 text-sm min-w-0 flex-1">
          <button
            v-if="currentPath !== '/'"
            @click="goUp"
            class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
          >
            <ArrowLeft class="w-4 h-4" />
          </button>
          <template v-for="(crumb, i) in breadcrumbs" :key="crumb.path">
            <ChevronRight v-if="i > 0" class="w-3 h-3 text-gray-400 shrink-0" />
            <button
              @click="navigateTo(crumb.path)"
              :class="[
                'truncate hover:text-primary-600 dark:hover:text-primary-400 transition-colors',
                i === breadcrumbs.length - 1
                  ? 'font-medium text-gray-900 dark:text-white'
                  : 'text-gray-500 dark:text-gray-400',
              ]"
            >
              {{ crumb.name }}
            </button>
          </template>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-2">
          <button
            @click="setViewMode('grid')"
            :class="['p-1.5 rounded transition-colors', viewMode === 'grid' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300']"
            :title="t('fileExplorer.gridView')"
          >
            <LayoutGrid class="w-4 h-4" />
          </button>
          <button
            @click="setViewMode('table')"
            :class="['p-1.5 rounded transition-colors', viewMode === 'table' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300']"
            :title="t('fileExplorer.tableView')"
          >
            <List class="w-4 h-4" />
          </button>
          <div class="w-px h-5 bg-gray-200 dark:bg-gray-700"></div>
          <button
            @click="showNewDialog = 'file'"
            class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <Plus class="w-3.5 h-3.5" />
            {{ t('fileExplorer.newFile') }}
          </button>
          <button
            @click="showNewDialog = 'folder'"
            class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <FolderPlus class="w-3.5 h-3.5" />
            {{ t('fileExplorer.newFolder') }}
          </button>
          <label class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors cursor-pointer">
            <Upload class="w-3.5 h-3.5" />
            {{ uploading ? '...' : t('fileExplorer.uploadFiles') }}
            <input type="file" class="hidden" @change="handleFileUpload" :disabled="uploading" multiple />
          </label>
          <button
            @click="showSftpInfo = !showSftpInfo"
            :class="[
              'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors',
              showSftpInfo
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
            ]"
          >
            <Terminal class="w-3.5 h-3.5" />
            SFTP
          </button>
          <div class="relative group">
            <button
              class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <Download class="w-3.5 h-3.5" />
              {{ t('fileExplorer.downloadAll') }}
            </button>
            <div class="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 hidden group-hover:block z-10 min-w-[140px]">
              <button
                @click="downloadArchive('zip')"
                class="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {{ t('fileExplorer.downloadAsZip') }}
              </button>
              <button
                @click="downloadArchive('tar')"
                class="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {{ t('fileExplorer.downloadAsTar') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- SFTP Connection Info -->
    <div v-if="showSftpInfo" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-4 p-4">
      <h4 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">SFTP Connection</h4>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">Connect via any SFTP client (FileZilla, WinSCP, Cyberduck, or command line). Use your API key as the password.</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Host</label>
          <div class="flex items-center gap-2">
            <code class="flex-1 px-2.5 py-1.5 rounded-md bg-gray-100 dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 font-mono truncate">{{ sftpHost }}</code>
            <button @click="copySftp(sftpHost, 'host')" class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0">
              <Copy class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Port</label>
          <div class="flex items-center gap-2">
            <code class="flex-1 px-2.5 py-1.5 rounded-md bg-gray-100 dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 font-mono">{{ sftpPort }}</code>
            <button @click="copySftp(sftpPort, 'port')" class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0">
              <Copy class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Username</label>
          <div class="flex items-center gap-2">
            <code class="flex-1 px-2.5 py-1.5 rounded-md bg-gray-100 dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 font-mono truncate">{{ sftpUsername }}</code>
            <button @click="copySftp(sftpUsername, 'username')" class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0">
              <Copy class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Password</label>
          <code class="block px-2.5 py-1.5 rounded-md bg-gray-100 dark:bg-gray-900 text-sm text-gray-500 dark:text-gray-400 font-mono italic">Your API key</code>
        </div>
      </div>
      <div class="mt-3">
        <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Command</label>
        <div class="flex items-center gap-2">
          <code class="flex-1 px-2.5 py-1.5 rounded-md bg-gray-100 dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 font-mono truncate">{{ sftpCommand }}</code>
          <button @click="copySftp(sftpCommand, 'command')" class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0">
            <Copy class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <p v-if="sftpCopied" class="text-xs text-green-600 dark:text-green-400 mt-2">Copied {{ sftpCopied }} to clipboard</p>
    </div>

    <!-- Drag-and-drop overlay -->
    <div
      v-if="dragOver"
      class="fixed inset-0 z-40 pointer-events-none"
    ></div>

    <!-- Main file area with drag-and-drop -->
    <div
      @dragover.prevent="dragOver = true"
      @dragleave.self="dragOver = false"
      @drop.prevent="handleDrop"
      :class="[
        'relative rounded-xl transition-colors',
        dragOver ? 'ring-2 ring-primary-500 ring-offset-2 dark:ring-offset-gray-900' : '',
      ]"
    >
      <!-- Drop zone indicator -->
      <div
        v-if="dragOver"
        class="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-primary-500/10 border-2 border-dashed border-primary-500 pointer-events-none"
      >
        <div class="text-center">
          <Upload class="w-10 h-10 text-primary-500 mx-auto mb-2" />
          <p class="text-sm font-medium text-primary-600 dark:text-primary-400">{{ t('fileExplorer.dropHere') }}</p>
        </div>
      </div>

      <!-- Upload progress -->
      <div v-if="uploading && uploadProgress" class="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div class="flex items-center gap-2">
          <Loader2 class="w-4 h-4 text-blue-500 animate-spin" />
          <p class="text-sm text-blue-700 dark:text-blue-300">{{ t('fileExplorer.uploadingFiles') }} ({{ uploadProgress }})</p>
        </div>
      </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <Loader2 class="w-6 h-6 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <!-- Empty -->
    <div v-else-if="entries.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <Upload class="w-10 h-10 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
      <p class="text-gray-500 dark:text-gray-400 text-sm">{{ t('fileExplorer.emptyDirectory') }}</p>
      <p class="text-gray-400 dark:text-gray-500 text-xs mt-1">{{ t('fileExplorer.dropToUpload') }}</p>
    </div>

    <!-- Table View -->
    <div v-else-if="viewMode === 'table'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="border-b border-gray-200 dark:border-gray-700">
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('fileExplorer.name') }}</th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-24">{{ t('fileExplorer.size') }}</th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-44">{{ t('fileExplorer.modified') }}</th>
            <th class="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-24"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
          <tr
            v-for="entry in entries"
            :key="entry.name"
            @click="handleEntryClick(entry)"
            class="hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer transition-colors"
          >
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                <component
                  :is="entry.type === 'directory' ? Folder : getFileIcon(entry.name)"
                  :class="['w-4 h-4 shrink-0', entry.type === 'directory' ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500']"
                />
                <span class="text-sm text-gray-900 dark:text-white truncate">{{ entry.name }}</span>
              </div>
            </td>
            <td class="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{{ formatSize(entry.size) }}</td>
            <td class="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{{ formatDate(entry.modified) }}</td>
            <td class="px-4 py-3 text-right" @click.stop>
              <div class="flex items-center justify-end gap-1">
                <button
                  v-if="entry.type === 'file'"
                  @click="downloadFile(entry)"
                  class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  :title="t('fileExplorer.download')"
                >
                  <Download class="w-3.5 h-3.5" />
                </button>
                <button
                  @click="deleteEntry(entry)"
                  class="p-1 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Grid View -->
    <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
      <div
        v-for="entry in entries"
        :key="entry.name"
        @click="handleEntryClick(entry)"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 cursor-pointer hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all group"
      >
        <div class="flex flex-col items-center text-center">
          <component
            :is="entry.type === 'directory' ? Folder : getFileIcon(entry.name)"
            :class="['w-8 h-8 mb-2', entry.type === 'directory' ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500']"
          />
          <p class="text-xs font-medium text-gray-900 dark:text-white truncate w-full">{{ entry.name }}</p>
          <p class="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{{ formatSize(entry.size) }}</p>
        </div>
        <div class="mt-2 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" @click.stop>
          <button
            v-if="entry.type === 'file'"
            @click="downloadFile(entry)"
            class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <Download class="w-3 h-3" />
          </button>
          <button
            @click="deleteEntry(entry)"
            class="p-1 text-gray-400 hover:text-red-500"
          >
            <Trash2 class="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>

    </div><!-- end drag-and-drop wrapper -->

    <!-- Rebuild Section -->
    <div class="mt-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
      <button
        @click="showRebuild = !showRebuild"
        class="w-full px-6 py-4 flex items-center justify-between text-left"
      >
        <div class="flex items-center gap-3">
          <RefreshCw class="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">{{ t('fileExplorer.rebuild') }}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('fileExplorer.rebuildDesc') }}</p>
          </div>
        </div>
        <ChevronRight :class="['w-4 h-4 text-gray-400 transition-transform', showRebuild ? 'rotate-90' : '']" />
      </button>
      <div v-if="showRebuild" class="px-6 pb-6 border-t border-gray-200 dark:border-gray-700 pt-4">
        <label class="block">
          <div class="flex items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-primary-400 dark:hover:border-primary-500 transition-colors cursor-pointer bg-gray-50 dark:bg-gray-900/50">
            <div class="text-center">
              <Archive class="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ rebuildFile ? rebuildFile.name : t('deploy.dragDrop') }}
              </p>
              <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">{{ t('deploy.supportedFormats') }}</p>
            </div>
          </div>
          <input
            type="file"
            accept=".zip,.tar,.tar.gz,.tgz"
            class="hidden"
            @change="onRebuildFileSelect"
          />
        </label>
        <button
          v-if="rebuildFile"
          @click="triggerRebuild"
          :disabled="rebuilding"
          class="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          <Loader2 v-if="rebuilding" class="w-4 h-4 animate-spin" />
          <RefreshCw v-else class="w-4 h-4" />
          {{ rebuilding ? t('fileExplorer.rebuilding') : t('fileExplorer.rebuild') }}
        </button>
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
  transition: transform 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .relative {
  transform: scale(0.95);
}
</style>
