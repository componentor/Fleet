<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Database, Table2, Play, Loader2, ChevronLeft, ChevronRight, ArrowUpDown, Eye, Columns3, Terminal, Plus, Trash2, X, Check, Download, Upload, KeyRound, Copy, EyeOff, Eye as EyeIcon, Info } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'

const props = defineProps<{ serviceId: string }>()
const api = useApi()
const toast = useToast()

// State
const loading = ref(true)
const dbInfo = ref<{ isDatabase: boolean; engine: string | null; databases: string[]; database: string; status: string } | null>(null)
const selectedDb = ref('')
const tables = ref<{ name: string; type: string }[]>([])
const tablesLoading = ref(false)
const selectedTable = ref('')
const activeView = ref<'data' | 'structure' | 'query'>('data')

// Data view
const dataColumns = ref<string[]>([])
const dataRows = ref<string[][]>([])
const dataTotalRows = ref(0)
const dataPage = ref(1)
const dataPageSize = ref(50)
const dataLoading = ref(false)
const dataOrderBy = ref('')
const dataOrderDir = ref<'asc' | 'desc'>('asc')

// Structure view
const structureColumns = ref<{ name: string; type: string; nullable: boolean; defaultValue: string | null; isPrimaryKey: boolean }[]>([])
const structureLoading = ref(false)

// Query view
const queryText = ref('')
const queryReadOnly = ref(true)
const queryLoading = ref(false)
const queryColumns = ref<string[]>([])
const queryRows = ref<string[][]>([])
const queryRowCount = ref(0)
const queryTime = ref(0)
const queryError = ref('')

// Primary key info
const primaryKeyColumns = ref<string[]>([])

// Inline editing state
const editingCell = ref<{ rowIndex: number; colIndex: number } | null>(null)
const editingValue = ref('')
const savingCell = ref(false)

// Add row state
const showAddRowForm = ref(false)
const newRowValues = ref<Record<string, string | null>>({})
const addRowLoading = ref(false)

// Delete row state
const deleteRowLoading = ref<number | null>(null)

// Create table state
const showCreateTableForm = ref(false)
const newTableName = ref('')
const newTableColumns = ref<Array<{ name: string; type: string; nullable: boolean; defaultValue: string; primaryKey: boolean }>>([])
const createTableLoading = ref(false)

// Drop table state
const dropTableLoading = ref(false)

// Connection guide state
const showConnectionGuide = ref(false)
const credentials = ref<{ engine: string; host: string; port: number; user: string; password: string; database: string } | null>(null)
const credentialsLoading = ref(false)
const showPassword = ref(false)

// Export / Import state
const exportLoading = ref(false)
const importLoading = ref(false)
const importFileInput = ref<HTMLInputElement | null>(null)

const dataTotalPages = computed(() => Math.max(1, Math.ceil(dataTotalRows.value / dataPageSize.value)))
const dbParams = computed(() => selectedDb.value ? `?db=${encodeURIComponent(selectedDb.value)}` : '')

async function fetchInfo() {
  loading.value = true
  try {
    dbInfo.value = await api.get(`/database/${props.serviceId}/info`)
    if (dbInfo.value?.database) {
      selectedDb.value = dbInfo.value.database
    } else if (dbInfo.value?.databases?.length) {
      selectedDb.value = dbInfo.value.databases[0]!
    }
    if (dbInfo.value?.status === 'available') {
      await fetchTables()
    }
  } catch {
    dbInfo.value = null
  } finally {
    loading.value = false
  }
}

async function fetchTables() {
  tablesLoading.value = true
  try {
    const data = await api.get<{ tables: { name: string; type: string }[] }>(`/database/${props.serviceId}/tables${dbParams.value}`)
    tables.value = data.tables ?? []
    if (tables.value.length && !selectedTable.value) {
      selectTable(tables.value[0]!.name)
    }
  } catch {
    tables.value = []
  } finally {
    tablesLoading.value = false
  }
}

function selectTable(name: string) {
  selectedTable.value = name
  dataPage.value = 1
  dataOrderBy.value = ''
  dataOrderDir.value = 'asc'
  primaryKeyColumns.value = []
  editingCell.value = null
  showAddRowForm.value = false
  if (activeView.value === 'data') {
    fetchTableData()
  } else if (activeView.value === 'structure') {
    fetchStructure()
  }
}

async function fetchTableData() {
  if (!selectedTable.value) return
  dataLoading.value = true
  try {
    const params = new URLSearchParams()
    if (selectedDb.value) params.set('db', selectedDb.value)
    params.set('page', String(dataPage.value))
    params.set('pageSize', String(dataPageSize.value))
    if (dataOrderBy.value) {
      params.set('orderBy', dataOrderBy.value)
      params.set('orderDir', dataOrderDir.value)
    }
    const data = await api.get<{ columns: string[]; rows: string[][]; totalRows: number; page: number; pageSize: number }>(`/database/${props.serviceId}/tables/${selectedTable.value}/data?${params}`)
    dataColumns.value = data.columns ?? []
    dataRows.value = data.rows ?? []
    dataTotalRows.value = data.totalRows ?? 0
  } catch {
    dataColumns.value = []
    dataRows.value = []
    dataTotalRows.value = 0
  } finally {
    dataLoading.value = false
  }
  // Ensure we have PK info for editing
  if (primaryKeyColumns.value.length === 0) {
    try {
      const data = await api.get<{ columns: { name: string; isPrimaryKey: boolean }[] }>(`/database/${props.serviceId}/tables/${selectedTable.value}/columns${dbParams.value}`)
      primaryKeyColumns.value = (data.columns ?? []).filter(c => c.isPrimaryKey).map(c => c.name)
    } catch { /* best effort */ }
  }
}

async function fetchStructure() {
  if (!selectedTable.value) return
  structureLoading.value = true
  try {
    const data = await api.get<{ columns: { name: string; type: string; nullable: boolean; defaultValue: string | null; isPrimaryKey: boolean }[] }>(`/database/${props.serviceId}/tables/${selectedTable.value}/columns${dbParams.value}`)
    structureColumns.value = data.columns ?? []
    primaryKeyColumns.value = (data.columns ?? []).filter(c => c.isPrimaryKey).map(c => c.name)
  } catch {
    structureColumns.value = []
  } finally {
    structureLoading.value = false
  }
}

async function executeQuery() {
  if (!queryText.value.trim()) return
  queryLoading.value = true
  queryError.value = ''
  queryColumns.value = []
  queryRows.value = []
  try {
    const data = await api.post<{ columns: string[]; rows: string[][]; rowCount: number; executionTimeMs: number; truncated: boolean }>(`/database/${props.serviceId}/query${dbParams.value}`, {
      query: queryText.value,
      readOnly: queryReadOnly.value,
    })
    queryColumns.value = data.columns ?? []
    queryRows.value = data.rows ?? []
    queryRowCount.value = data.rowCount ?? 0
    queryTime.value = data.executionTimeMs ?? 0
  } catch (err: any) {
    queryError.value = err?.body?.error || err?.message || 'Query execution failed'
  } finally {
    queryLoading.value = false
  }
}

function sortByColumn(col: string) {
  if (dataOrderBy.value === col) {
    dataOrderDir.value = dataOrderDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    dataOrderBy.value = col
    dataOrderDir.value = 'asc'
  }
  dataPage.value = 1
  fetchTableData()
}

function onViewChange(view: 'data' | 'structure' | 'query') {
  activeView.value = view
  if (view === 'data' && selectedTable.value) fetchTableData()
  if (view === 'structure' && selectedTable.value) fetchStructure()
}

function onDbChange() {
  tables.value = []
  selectedTable.value = ''
  fetchTables()
}

function handleQueryKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    executeQuery()
  }
}

// ---- Inline cell editing ----

const editInput = ref<HTMLInputElement | null>(null)

function startEditingCell(rowIndex: number, colIndex: number) {
  if (primaryKeyColumns.value.length === 0) return
  const rawValue = dataRows.value[rowIndex]?.[colIndex] ?? ''
  editingCell.value = { rowIndex, colIndex }
  editingValue.value = (rawValue === '\\N' || rawValue === 'NULL' || rawValue === '') ? '' : rawValue
  nextTick(() => editInput.value?.focus())
}

function cancelEditing() {
  editingCell.value = null
  editingValue.value = ''
}

function buildPkValues(rowIndex: number): Record<string, string> | null {
  const pkValues: Record<string, string> = {}
  for (const pkCol of primaryKeyColumns.value) {
    const pkIndex = dataColumns.value.indexOf(pkCol)
    if (pkIndex === -1) return null
    pkValues[pkCol] = dataRows.value[rowIndex]![pkIndex]!
  }
  return pkValues
}

async function saveCell(setNull: boolean = false) {
  if (!editingCell.value) return
  const { rowIndex, colIndex } = editingCell.value
  const columnName = dataColumns.value[colIndex]
  if (!columnName) return

  const pkValues = buildPkValues(rowIndex)
  if (!pkValues) return

  savingCell.value = true
  try {
    await api.put(`/database/${props.serviceId}/tables/${selectedTable.value}/rows${dbParams.value}`, {
      primaryKey: pkValues,
      updates: { [columnName]: setNull ? null : editingValue.value },
    })
    editingCell.value = null
    await fetchTableData()
    toast.success('Cell updated')
  } catch { /* error shown by useApi */ } finally {
    savingCell.value = false
  }
}

// ---- Add row ----

function openAddRowForm() {
  newRowValues.value = {}
  for (const col of dataColumns.value) {
    newRowValues.value[col] = ''
  }
  showAddRowForm.value = true
}

async function insertRow() {
  addRowLoading.value = true
  try {
    const values: Record<string, string | null> = {}
    for (const [key, val] of Object.entries(newRowValues.value)) {
      values[key] = val === '' ? null : val
    }
    await api.post(`/database/${props.serviceId}/tables/${selectedTable.value}/rows${dbParams.value}`, { values })
    showAddRowForm.value = false
    toast.success('Row inserted')
    await fetchTableData()
  } catch { /* error shown by useApi */ } finally {
    addRowLoading.value = false
  }
}

// ---- Delete row ----

async function deleteRow(rowIndex: number) {
  if (primaryKeyColumns.value.length === 0) return
  const pkValues = buildPkValues(rowIndex)
  if (!pkValues) return

  const pkDisplay = Object.entries(pkValues).map(([k, v]) => `${k}=${v}`).join(', ')
  if (!confirm(`Delete row where ${pkDisplay}?`)) return

  deleteRowLoading.value = rowIndex
  try {
    await api.del(`/database/${props.serviceId}/tables/${selectedTable.value}/rows${dbParams.value}`, { primaryKey: pkValues })
    toast.success('Row deleted')
    await fetchTableData()
  } catch { /* error shown by useApi */ } finally {
    deleteRowLoading.value = null
  }
}

// ---- Create table ----

function openCreateTableForm() {
  newTableName.value = ''
  newTableColumns.value = [{ name: 'id', type: 'SERIAL', nullable: false, defaultValue: '', primaryKey: true }]
  showCreateTableForm.value = true
}

function addColumnDef() {
  newTableColumns.value.push({ name: '', type: 'VARCHAR(255)', nullable: true, defaultValue: '', primaryKey: false })
}

function removeColumnDef(index: number) {
  newTableColumns.value.splice(index, 1)
}

async function createTable() {
  if (!newTableName.value.trim() || newTableColumns.value.length === 0) return
  createTableLoading.value = true
  try {
    await api.post(`/database/${props.serviceId}/tables${dbParams.value}`, {
      name: newTableName.value,
      columns: newTableColumns.value.map(c => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        defaultValue: c.defaultValue || undefined,
        primaryKey: c.primaryKey,
      })),
    })
    showCreateTableForm.value = false
    toast.success('Table created')
    await fetchTables()
    selectTable(newTableName.value)
  } catch { /* error shown by useApi */ } finally {
    createTableLoading.value = false
  }
}

// ---- Drop table ----

async function dropTable(tableName: string) {
  if (!confirm(`Drop table "${tableName}"? This cannot be undone and all data will be lost.`)) return
  dropTableLoading.value = true
  try {
    await api.del(`/database/${props.serviceId}/tables/${tableName}${dbParams.value}`)
    toast.success(`Table "${tableName}" dropped`)
    if (selectedTable.value === tableName) selectedTable.value = ''
    await fetchTables()
  } catch { /* error shown by useApi */ } finally {
    dropTableLoading.value = false
  }
}

// ---- Connection guide ----

async function toggleConnectionGuide() {
  showConnectionGuide.value = !showConnectionGuide.value
  if (showConnectionGuide.value && !credentials.value) {
    credentialsLoading.value = true
    try {
      credentials.value = await api.get(`/database/${props.serviceId}/credentials`)
    } catch { credentials.value = null } finally {
      credentialsLoading.value = false
    }
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('Copied to clipboard')
}

function getConnectionString(): string {
  if (!credentials.value) return ''
  const c = credentials.value
  if (c.engine === 'postgres') {
    return `postgresql://${c.user}:${c.password}@<YOUR_HOST>:${c.port}/${c.database}`
  }
  return `mysql://${c.user}:${c.password}@<YOUR_HOST>:${c.port}/${c.database}`
}

function getCliCommand(): string {
  if (!credentials.value) return ''
  const c = credentials.value
  if (c.engine === 'postgres') {
    return `psql -h <YOUR_HOST> -p ${c.port} -U ${c.user} -d ${c.database}`
  }
  return `mysql -h <YOUR_HOST> -P ${c.port} -u ${c.user} -p ${c.database}`
}

// ---- Export / Import ----

async function exportDatabase() {
  exportLoading.value = true
  try {
    // Get a short-lived download token, then open the URL directly so the
    // browser streams the file natively (progress bar, no memory buffering).
    const { token } = await api.post<{ token: string }>(`/database/${props.serviceId}/export${dbParams.value}`, {})
    const downloadUrl = `/api/v1/database/${props.serviceId}/export?token=${encodeURIComponent(token)}`
    // Use a hidden iframe so the current page stays intact
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = downloadUrl
    document.body.appendChild(iframe)
    // Clean up iframe after download starts
    setTimeout(() => {
      try { document.body.removeChild(iframe) } catch {}
    }, 120_000)
    toast.success('Database export started — check your downloads')
  } catch { /* error shown by useApi */ } finally {
    exportLoading.value = false
  }
}

function triggerImport() {
  importFileInput.value?.click()
}

async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (!confirm(`Import "${file.name}" into the database? This may overwrite existing data.`)) {
    input.value = ''
    return
  }

  importLoading.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    await api.upload(`/database/${props.serviceId}/import${dbParams.value}`, formData)
    toast.success('Database imported successfully')
    // Refresh tables after import
    await fetchTables()
    if (selectedTable.value) fetchTableData()
  } catch { /* error shown by useApi */ } finally {
    importLoading.value = false
    input.value = ''
  }
}

watch(() => props.serviceId, () => {
  fetchInfo()
  credentials.value = null
  showConnectionGuide.value = false
  showPassword.value = false
}, { immediate: true })
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <!-- Not a database -->
    <div v-else-if="!dbInfo?.isDatabase" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <Database class="w-10 h-10 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
      <p class="text-gray-500 dark:text-gray-400 text-sm">This service is not a supported database engine.</p>
    </div>

    <!-- Unavailable -->
    <div v-else-if="dbInfo?.status !== 'available'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <Database class="w-10 h-10 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
      <p class="text-gray-500 dark:text-gray-400 text-sm">Database container is not running. Start the service to manage the database.</p>
    </div>

    <!-- Database Manager -->
    <div v-else>
      <!-- Toolbar -->
      <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div class="flex items-center gap-3">
          <div v-if="dbInfo.databases.length > 1" class="flex items-center gap-2">
            <Database class="w-4 h-4 text-gray-400" />
            <select v-model="selectedDb" @change="onDbChange" class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent">
              <option v-for="d in dbInfo.databases" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
          <span v-else class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <Database class="w-4 h-4 text-gray-400" />
            {{ selectedDb || dbInfo.engine }}
          </span>
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 uppercase">
            {{ dbInfo.engine }}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <!-- Export / Import / Connection buttons -->
          <button @click="exportDatabase" :disabled="exportLoading" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-750 text-xs font-medium transition-colors disabled:opacity-50" title="Export database dump">
            <Loader2 v-if="exportLoading" class="w-3.5 h-3.5 animate-spin" />
            <Download v-else class="w-3.5 h-3.5" />
            Export
          </button>
          <button @click="triggerImport" :disabled="importLoading" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-750 text-xs font-medium transition-colors disabled:opacity-50" title="Import SQL dump">
            <Loader2 v-if="importLoading" class="w-3.5 h-3.5 animate-spin" />
            <Upload v-else class="w-3.5 h-3.5" />
            Import
          </button>
          <input ref="importFileInput" type="file" accept=".sql,.gz,.dump" class="hidden" @change="handleImportFile" />
          <button @click="toggleConnectionGuide" :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors', showConnectionGuide ? 'border-primary-300 dark:border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-750']" title="Connection guide">
            <KeyRound class="w-3.5 h-3.5" />
            Connect
          </button>

          <!-- View toggle -->
          <div class="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 ml-1">
            <button @click="onViewChange('data')" :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors', activeView === 'data' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']">
              <Eye class="w-3.5 h-3.5" /> Data
            </button>
            <button @click="onViewChange('structure')" :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors', activeView === 'structure' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']">
              <Columns3 class="w-3.5 h-3.5" /> Structure
            </button>
            <button @click="onViewChange('query')" :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors', activeView === 'query' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']">
              <Terminal class="w-3.5 h-3.5" /> Query
            </button>
          </div>
        </div>
      </div>

      <!-- Connection guide -->
      <div v-if="showConnectionGuide" class="mb-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <span class="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
            <KeyRound class="w-4 h-4 text-primary-600 dark:text-primary-400" />
            Connection Details
          </span>
          <button @click="showConnectionGuide = false" class="p-1 text-gray-400 hover:text-gray-600"><X class="w-4 h-4" /></button>
        </div>
        <div v-if="credentialsLoading" class="flex items-center justify-center py-8">
          <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
        </div>
        <div v-else-if="credentials" class="p-4 space-y-4">
          <!-- Credentials grid -->
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <span class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Host</span>
              <div class="flex items-center gap-1.5">
                <code class="text-sm text-gray-900 dark:text-white font-mono">{{ credentials.host }}</code>
                <button @click="copyToClipboard(credentials.host)" class="p-0.5 text-gray-400 hover:text-primary-600 transition-colors"><Copy class="w-3 h-3" /></button>
              </div>
            </div>
            <div>
              <span class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Port</span>
              <div class="flex items-center gap-1.5">
                <code class="text-sm text-gray-900 dark:text-white font-mono">{{ credentials.port }}</code>
                <button @click="copyToClipboard(String(credentials.port))" class="p-0.5 text-gray-400 hover:text-primary-600 transition-colors"><Copy class="w-3 h-3" /></button>
              </div>
            </div>
            <div>
              <span class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Database</span>
              <div class="flex items-center gap-1.5">
                <code class="text-sm text-gray-900 dark:text-white font-mono">{{ credentials.database }}</code>
                <button @click="copyToClipboard(credentials.database)" class="p-0.5 text-gray-400 hover:text-primary-600 transition-colors"><Copy class="w-3 h-3" /></button>
              </div>
            </div>
            <div>
              <span class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">User</span>
              <div class="flex items-center gap-1.5">
                <code class="text-sm text-gray-900 dark:text-white font-mono">{{ credentials.user }}</code>
                <button @click="copyToClipboard(credentials.user)" class="p-0.5 text-gray-400 hover:text-primary-600 transition-colors"><Copy class="w-3 h-3" /></button>
              </div>
            </div>
            <div class="col-span-2">
              <span class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Password</span>
              <div class="flex items-center gap-1.5">
                <code class="text-sm text-gray-900 dark:text-white font-mono">{{ showPassword ? credentials.password : '••••••••••••' }}</code>
                <button @click="showPassword = !showPassword" class="p-0.5 text-gray-400 hover:text-primary-600 transition-colors" :title="showPassword ? 'Hide password' : 'Show password'">
                  <EyeOff v-if="showPassword" class="w-3 h-3" />
                  <EyeIcon v-else class="w-3 h-3" />
                </button>
                <button @click="copyToClipboard(credentials.password)" class="p-0.5 text-gray-400 hover:text-primary-600 transition-colors"><Copy class="w-3 h-3" /></button>
              </div>
            </div>
          </div>

          <!-- Connection string -->
          <div>
            <span class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Connection String</span>
            <div class="flex items-center gap-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg px-3 py-2">
              <code class="text-xs text-gray-700 dark:text-gray-300 font-mono flex-1 overflow-x-auto whitespace-nowrap">{{ getConnectionString() }}</code>
              <button @click="copyToClipboard(getConnectionString())" class="p-1 text-gray-400 hover:text-primary-600 transition-colors shrink-0"><Copy class="w-3.5 h-3.5" /></button>
            </div>
          </div>

          <!-- CLI command -->
          <div>
            <span class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">CLI Command</span>
            <div class="flex items-center gap-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg px-3 py-2">
              <code class="text-xs text-gray-700 dark:text-gray-300 font-mono flex-1 overflow-x-auto whitespace-nowrap">{{ getCliCommand() }}</code>
              <button @click="copyToClipboard(getCliCommand())" class="p-1 text-gray-400 hover:text-primary-600 transition-colors shrink-0"><Copy class="w-3.5 h-3.5" /></button>
            </div>
          </div>

          <!-- Info note -->
          <div class="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <Info class="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div class="text-xs text-blue-700 dark:text-blue-300">
              <p>Replace <code class="bg-blue-100 dark:bg-blue-900/30 px-1 rounded">&lt;YOUR_HOST&gt;</code> with your server's IP address or domain name. The database port must be published and accessible from your network.</p>
              <p class="mt-1">For services on an internal network, consider using an SSH tunnel:</p>
              <code class="block mt-1 bg-blue-100 dark:bg-blue-900/30 px-2 py-1 rounded font-mono">ssh -L {{ credentials.port }}:{{ credentials.host }}:{{ credentials.port }} user@your-server</code>
            </div>
          </div>
        </div>
      </div>

      <div class="flex gap-4">
        <!-- Tables sidebar -->
        <div class="w-56 shrink-0">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div class="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tables</span>
              <button @click="openCreateTableForm" class="p-1 rounded text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors" title="Create table">
                <Plus class="w-3.5 h-3.5" />
              </button>
            </div>
            <div v-if="tablesLoading" class="flex items-center justify-center py-8">
              <Loader2 class="w-5 h-5 text-gray-400 animate-spin" />
            </div>
            <div v-else-if="tables.length === 0" class="px-3 py-6 text-center text-xs text-gray-500 dark:text-gray-400">
              No tables found.
            </div>
            <div v-else class="max-h-[500px] overflow-y-auto">
              <button
                v-for="table in tables"
                :key="table.name"
                @click="selectTable(table.name)"
                :class="[
                  'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors group',
                  selectedTable === table.name
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-750'
                ]"
              >
                <Table2 class="w-3.5 h-3.5 shrink-0" :class="table.type === 'view' ? 'text-purple-500' : 'text-gray-400'" />
                <span class="truncate flex-1">{{ table.name }}</span>
                <span v-if="table.type === 'view'" class="text-[10px] text-purple-500 dark:text-purple-400 shrink-0">view</span>
                <button
                  v-if="table.type !== 'view'"
                  @click.stop="dropTable(table.name)"
                  class="p-0.5 rounded opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all"
                  title="Drop table"
                >
                  <Trash2 class="w-3 h-3" />
                </button>
              </button>
            </div>
          </div>
        </div>

        <!-- Main content -->
        <div class="flex-1 min-w-0">
          <!-- No table selected -->
          <div v-if="!selectedTable && activeView !== 'query'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
            <Table2 class="w-8 h-8 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
            <p class="text-gray-500 dark:text-gray-400 text-sm">Select a table to view its data.</p>
          </div>

          <!-- Data view -->
          <div v-if="activeView === 'data' && selectedTable" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <!-- Data toolbar -->
            <div class="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ primaryKeyColumns.length > 0 ? 'Double-click a cell to edit' : 'No primary key — editing disabled' }}
              </span>
              <button @click="openAddRowForm" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors">
                <Plus class="w-3.5 h-3.5" /> Add Row
              </button>
            </div>

            <!-- Add row form -->
            <div v-if="showAddRowForm" class="px-4 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <div class="flex items-center justify-between mb-3">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Insert New Row</span>
                <button @click="showAddRowForm = false" class="p-1 text-gray-400 hover:text-gray-600"><X class="w-4 h-4" /></button>
              </div>
              <div class="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto">
                <div v-for="col in dataColumns" :key="col" class="flex flex-col gap-1">
                  <label class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ col }}</label>
                  <div class="flex items-center gap-1">
                    <input
                      v-if="newRowValues[col] !== null"
                      v-model="newRowValues[col]"
                      class="flex-1 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-primary-500"
                      :placeholder="col"
                    />
                    <span v-else class="flex-1 px-2 py-1.5 text-sm italic text-gray-400 dark:text-gray-600">NULL</span>
                    <button
                      @click="newRowValues[col] = newRowValues[col] === null ? '' : null"
                      :class="['px-1.5 py-1.5 text-[10px] rounded border transition-colors font-medium', newRowValues[col] === null ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300' : 'border-gray-300 dark:border-gray-600 text-gray-400 hover:text-yellow-600']"
                      title="Toggle NULL"
                    >NULL</button>
                  </div>
                </div>
              </div>
              <div class="flex justify-end gap-2 mt-3">
                <button @click="showAddRowForm = false" class="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800">Cancel</button>
                <button @click="insertRow" :disabled="addRowLoading" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium transition-colors">
                  <Loader2 v-if="addRowLoading" class="w-3.5 h-3.5 animate-spin" />
                  Insert Row
                </button>
              </div>
            </div>

            <div v-if="dataLoading" class="flex items-center justify-center py-16">
              <Loader2 class="w-6 h-6 text-primary-600 dark:text-primary-400 animate-spin" />
            </div>
            <template v-else>
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                      <th
                        v-for="col in dataColumns"
                        :key="col"
                        @click="sortByColumn(col)"
                        class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 select-none"
                      >
                        <span class="inline-flex items-center gap-1">
                          {{ col }}
                          <ArrowUpDown v-if="dataOrderBy !== col" class="w-3 h-3 opacity-30" />
                          <span v-else class="text-primary-600 dark:text-primary-400">{{ dataOrderDir === 'asc' ? '↑' : '↓' }}</span>
                        </span>
                      </th>
                      <th v-if="primaryKeyColumns.length > 0" class="w-10"></th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr v-if="dataRows.length === 0">
                      <td :colspan="dataColumns.length + (primaryKeyColumns.length > 0 ? 1 : 0)" class="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">No data.</td>
                    </tr>
                    <tr v-for="(row, i) in dataRows" :key="i" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                      <td
                        v-for="(cell, j) in row"
                        :key="j"
                        class="px-4 py-2.5 text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-xs"
                        :class="{ 'cursor-pointer': primaryKeyColumns.length > 0 }"
                        :title="cell"
                        @dblclick="startEditingCell(i, j)"
                      >
                        <!-- Editing mode -->
                        <div v-if="editingCell?.rowIndex === i && editingCell?.colIndex === j" class="flex items-center gap-1 -my-1">
                          <input
                            ref="editInput"
                            v-model="editingValue"
                            class="px-2 py-1 text-sm border border-primary-400 dark:border-primary-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-primary-500 w-40"
                            @keydown.enter="saveCell(false)"
                            @keydown.escape="cancelEditing"
                          />
                          <button @click="saveCell(false)" :disabled="savingCell" class="p-1 text-green-600 hover:text-green-700" title="Save"><Check class="w-3.5 h-3.5" /></button>
                          <button @click="saveCell(true)" :disabled="savingCell" class="px-1 py-0.5 text-[10px] font-medium text-yellow-600 hover:text-yellow-700" title="Set NULL">NULL</button>
                          <button @click="cancelEditing" class="p-1 text-gray-400 hover:text-gray-600" title="Cancel"><X class="w-3.5 h-3.5" /></button>
                        </div>
                        <!-- Display mode -->
                        <template v-else>
                          <span v-if="cell === '\\N' || cell === 'NULL' || cell === ''" class="text-gray-400 dark:text-gray-600 italic">NULL</span>
                          <span v-else class="truncate">{{ cell }}</span>
                        </template>
                      </td>
                      <!-- Delete button -->
                      <td v-if="primaryKeyColumns.length > 0" class="px-2 py-2.5">
                        <button @click="deleteRow(i)" :disabled="deleteRowLoading === i" class="p-1 rounded text-gray-400 hover:text-red-500 transition-colors" title="Delete row">
                          <Loader2 v-if="deleteRowLoading === i" class="w-3.5 h-3.5 animate-spin" />
                          <Trash2 v-else class="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Pagination -->
              <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  {{ dataTotalRows }} row{{ dataTotalRows !== 1 ? 's' : '' }}
                </span>
                <div class="flex items-center gap-2">
                  <button @click="dataPage--; fetchTableData()" :disabled="dataPage <= 1" class="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-750 disabled:opacity-30 transition-colors">
                    <ChevronLeft class="w-4 h-4" />
                  </button>
                  <span class="text-xs text-gray-600 dark:text-gray-400">{{ dataPage }} / {{ dataTotalPages }}</span>
                  <button @click="dataPage++; fetchTableData()" :disabled="dataPage >= dataTotalPages" class="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-750 disabled:opacity-30 transition-colors">
                    <ChevronRight class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </template>
          </div>

          <!-- Structure view -->
          <div v-if="activeView === 'structure' && selectedTable" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div v-if="structureLoading" class="flex items-center justify-center py-16">
              <Loader2 class="w-6 h-6 text-primary-600 dark:text-primary-400 animate-spin" />
            </div>
            <table v-else class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Column</th>
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Key</th>
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Nullable</th>
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Default</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr v-if="structureColumns.length === 0">
                  <td colspan="5" class="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">No columns found.</td>
                </tr>
                <tr v-for="col in structureColumns" :key="col.name" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                  <td class="px-4 py-2.5 font-mono text-gray-900 dark:text-white">{{ col.name }}</td>
                  <td class="px-4 py-2.5 font-mono text-gray-600 dark:text-gray-400">{{ col.type }}</td>
                  <td class="px-4 py-2.5">
                    <span v-if="col.isPrimaryKey" class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">PK</span>
                  </td>
                  <td class="px-4 py-2.5">
                    <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', col.nullable ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300']">
                      {{ col.nullable ? 'YES' : 'NO' }}
                    </span>
                  </td>
                  <td class="px-4 py-2.5 font-mono text-gray-600 dark:text-gray-400">
                    <span v-if="col.defaultValue !== null">{{ col.defaultValue }}</span>
                    <span v-else class="text-gray-400 dark:text-gray-600 italic">none</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Query view -->
          <div v-if="activeView === 'query'" class="space-y-4">
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">SQL Query</span>
                <div class="flex items-center gap-3">
                  <label class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <input v-model="queryReadOnly" type="checkbox" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                    Read-only
                  </label>
                  <button @click="executeQuery" :disabled="queryLoading || !queryText.trim()" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium transition-colors">
                    <Loader2 v-if="queryLoading" class="w-3.5 h-3.5 animate-spin" />
                    <Play v-else class="w-3.5 h-3.5" />
                    Execute
                  </button>
                </div>
              </div>
              <textarea
                v-model="queryText"
                @keydown="handleQueryKeydown"
                placeholder="SELECT * FROM users LIMIT 10;"
                class="w-full h-32 px-4 py-3 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white font-mono text-sm resize-y focus:outline-none placeholder-gray-400 dark:placeholder-gray-600"
              />
              <div class="px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-400 dark:text-gray-600">
                Press Ctrl+Enter to execute
              </div>
            </div>

            <div v-if="queryError" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p class="text-sm text-red-700 dark:text-red-300 font-mono">{{ queryError }}</p>
            </div>

            <div v-if="queryRows.length > 0 || (queryRowCount === 0 && !queryError && !queryLoading && queryTime > 0)" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <span class="text-xs text-gray-500 dark:text-gray-400">{{ queryRowCount }} row{{ queryRowCount !== 1 ? 's' : '' }} returned</span>
                <span class="text-xs text-gray-400 dark:text-gray-600">{{ queryTime }}ms</span>
              </div>
              <div class="overflow-x-auto max-h-96">
                <table class="w-full text-sm">
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr v-for="(row, i) in queryRows" :key="i" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                      <td v-for="(cell, j) in row" :key="j" class="px-4 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-xs truncate font-mono text-xs" :title="cell">
                        <span v-if="cell === '\\N' || cell === 'NULL'" class="text-gray-400 dark:text-gray-600 italic">NULL</span>
                        <span v-else>{{ cell }}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Table Modal -->
    <div v-if="showCreateTableForm" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="showCreateTableForm = false">
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <span class="text-lg font-semibold text-gray-900 dark:text-white">Create Table</span>
          <button @click="showCreateTableForm = false" class="p-1 text-gray-400 hover:text-gray-600"><X class="w-5 h-5" /></button>
        </div>
        <div class="px-6 py-4 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Table Name</label>
            <input v-model="newTableName" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="my_table" />
          </div>
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Columns</label>
              <button @click="addColumnDef" class="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"><Plus class="w-3.5 h-3.5" /> Add Column</button>
            </div>
            <div class="space-y-2">
              <div v-for="(col, i) in newTableColumns" :key="i" class="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                <input v-model="col.name" placeholder="name" class="w-32 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                <input v-model="col.type" placeholder="VARCHAR(255)" class="w-36 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono" />
                <label class="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                  <input type="checkbox" v-model="col.primaryKey" class="rounded border-gray-300 text-primary-600" /> PK
                </label>
                <label class="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                  <input type="checkbox" v-model="col.nullable" class="rounded border-gray-300 text-primary-600" /> Nullable
                </label>
                <button @click="removeColumnDef(i)" class="p-1 text-gray-400 hover:text-red-500" :disabled="newTableColumns.length <= 1">
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button @click="showCreateTableForm = false" class="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">Cancel</button>
          <button @click="createTable" :disabled="createTableLoading || !newTableName.trim() || newTableColumns.length === 0" class="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
            <Loader2 v-if="createTableLoading" class="w-4 h-4 animate-spin inline mr-1" />
            Create Table
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
