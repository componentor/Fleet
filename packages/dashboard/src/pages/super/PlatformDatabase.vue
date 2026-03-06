<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Database, Table2, Play, ChevronLeft, ChevronRight, ArrowUpDown, Eye, Columns3, Terminal, Plus, Trash2, X, Check, Copy, Info, Shield, BarChart3 } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const api = useApi()
const toast = useToast()

const BASE = '/admin/platform-db'

// State
const loading = ref(true)
const tables = ref<{ name: string; rowCount?: number }[]>([])
const selectedTable = ref('')
const activeTab = ref<'data' | 'structure' | 'query' | 'connection' | 'access'>('data')

// Stats
const stats = ref<{ version: string; databaseSize: string; tableCount: number; activeConnections: number } | null>(null)

// Data view
const dataColumns = ref<string[]>([])
const dataRows = ref<Record<string, unknown>[]>([])
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
const queryLoading = ref(false)
const queryColumns = ref<string[]>([])
const queryRows = ref<Record<string, unknown>[]>([])
const queryRowCount = ref(0)
const queryTime = ref(0)
const queryError = ref('')

// Primary key info
const primaryKeyColumns = ref<string[]>([])

// Inline editing
const editingCell = ref<{ rowIndex: number; colName: string } | null>(null)
const editingValue = ref('')
const savingCell = ref(false)

// Add row
const showAddRowForm = ref(false)
const newRowValues = ref<Record<string, string | null>>({})
const addRowLoading = ref(false)

// Delete row
const deleteRowLoading = ref<number | null>(null)

// Create table
const showCreateTableForm = ref(false)
const newTableName = ref('')
const newTableColumns = ref<Array<{ name: string; type: string; nullable: boolean; defaultValue: string; primaryKey: boolean }>>([])
const createTableLoading = ref(false)

// Drop table
const dropTableLoading = ref(false)

// Connection info
const connectionInfo = ref<{ dialect: string; host: string; port: number; database: string; username: string; connectionString: string; cliCommand: string; sshTunnel: string } | null>(null)
const connectionLoading = ref(false)

// IP allowlist
const allowlist = ref<string[]>([])
const currentIp = ref('unknown')
const allowlistLoading = ref(false)
const newIpEntry = ref('')
const allowlistSaving = ref(false)

const dataTotalPages = computed(() => Math.max(1, Math.ceil(dataTotalRows.value / dataPageSize.value)))

// ---- Data fetching ----

async function fetchTables() {
  loading.value = true
  try {
    const data = await api.get<{ tables: { name: string; rowCount?: number }[]; dialect: string; error?: string }>(`${BASE}/tables`)
    if (data.error) {
      toast.error(data.error)
      tables.value = []
    } else {
      tables.value = data.tables ?? []
      if (tables.value.length && !selectedTable.value) {
        selectTable(tables.value[0]!.name)
      }
    }
  } catch (err: any) {
    toast.error(err?.message || 'Failed to load tables')
    tables.value = []
  } finally {
    loading.value = false
  }
}

async function fetchStats() {
  try {
    stats.value = await api.get(`${BASE}/stats`)
  } catch { stats.value = null }
}

function selectTable(name: string) {
  selectedTable.value = name
  dataPage.value = 1
  dataOrderBy.value = ''
  dataOrderDir.value = 'asc'
  primaryKeyColumns.value = []
  editingCell.value = null
  showAddRowForm.value = false
  if (activeTab.value === 'data') {
    fetchTableData()
  } else if (activeTab.value === 'structure') {
    fetchStructure()
  }
}

async function fetchTableData() {
  if (!selectedTable.value) return
  dataLoading.value = true
  try {
    const params = new URLSearchParams()
    params.set('page', String(dataPage.value))
    params.set('pageSize', String(dataPageSize.value))
    if (dataOrderBy.value) {
      params.set('sortBy', dataOrderBy.value)
      params.set('sortDir', dataOrderDir.value)
    }
    const data = await api.get<{ rows: Record<string, unknown>[]; total: number; page: number; pageSize: number }>(`${BASE}/tables/${encodeURIComponent(selectedTable.value)}/data?${params}`)
    dataRows.value = data.rows ?? []
    dataTotalRows.value = data.total ?? 0
    dataColumns.value = dataRows.value.length > 0 ? Object.keys(dataRows.value[0]!) : []
  } catch {
    dataRows.value = []
    dataTotalRows.value = 0
    dataColumns.value = []
  } finally {
    dataLoading.value = false
  }
  // Fetch PK info for editing
  if (primaryKeyColumns.value.length === 0) {
    try {
      const data = await api.get<{ columns: { name: string; isPrimaryKey: boolean }[] }>(`${BASE}/tables/${encodeURIComponent(selectedTable.value)}/columns`)
      primaryKeyColumns.value = (data.columns ?? []).filter(c => c.isPrimaryKey).map(c => c.name)
      // If we got columns from structure but dataColumns is empty, fill from structure
      if (dataColumns.value.length === 0) {
        dataColumns.value = (data.columns ?? []).map(c => c.name)
      }
    } catch { /* best effort */ }
  }
}

async function fetchStructure() {
  if (!selectedTable.value) return
  structureLoading.value = true
  try {
    const data = await api.get<{ columns: { name: string; type: string; nullable: boolean; defaultValue: string | null; isPrimaryKey: boolean }[] }>(`${BASE}/tables/${encodeURIComponent(selectedTable.value)}/columns`)
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
    const data = await api.post<{ rows: Record<string, unknown>[]; columns: string[]; rowCount: number; durationMs: number }>(`${BASE}/query`, {
      query: queryText.value,
    })
    queryColumns.value = data.columns ?? []
    queryRows.value = data.rows ?? []
    queryRowCount.value = data.rowCount ?? 0
    queryTime.value = data.durationMs ?? 0
  } catch (err: any) {
    queryError.value = err?.body?.error || err?.message || 'Query execution failed'
    queryTime.value = err?.body?.durationMs ?? 0
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

function onTabChange(tab: typeof activeTab.value) {
  activeTab.value = tab
  if (tab === 'data' && selectedTable.value) fetchTableData()
  if (tab === 'structure' && selectedTable.value) fetchStructure()
  if (tab === 'connection' && !connectionInfo.value) fetchConnectionInfo()
  if (tab === 'access') fetchAllowlist()
}

function handleQueryKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    executeQuery()
  }
}

// ---- Inline cell editing ----

const editInput = ref<HTMLInputElement | null>(null)

function startEditingCell(rowIndex: number, colName: string) {
  if (primaryKeyColumns.value.length === 0) return
  const rawValue = dataRows.value[rowIndex]?.[colName]
  editingCell.value = { rowIndex, colName }
  editingValue.value = rawValue === null || rawValue === undefined ? '' : String(rawValue)
  nextTick(() => {
    const el = Array.isArray(editInput.value) ? editInput.value[0] : editInput.value
    el?.focus()
  })
}

function cancelEditing() {
  editingCell.value = null
  editingValue.value = ''
}

function buildPkValues(rowIndex: number): Record<string, unknown> | null {
  const row = dataRows.value[rowIndex]
  if (!row) return null
  const pkValues: Record<string, unknown> = {}
  for (const pkCol of primaryKeyColumns.value) {
    pkValues[pkCol] = row[pkCol]
  }
  return pkValues
}

async function saveCell(setNull: boolean = false) {
  if (!editingCell.value) return
  const { rowIndex, colName } = editingCell.value
  const pkValues = buildPkValues(rowIndex)
  if (!pkValues) return

  savingCell.value = true
  try {
    await api.put(`${BASE}/tables/${encodeURIComponent(selectedTable.value)}/rows`, {
      primaryKeys: pkValues,
      updates: { [colName]: setNull ? null : editingValue.value },
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
    const row: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(newRowValues.value)) {
      row[key] = val === '' || val === null ? null : val
    }
    await api.post(`${BASE}/tables/${encodeURIComponent(selectedTable.value)}/rows`, { row })
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
    await api.del(`${BASE}/tables/${encodeURIComponent(selectedTable.value)}/rows`, { primaryKeys: pkValues })
    toast.success('Row deleted')
    await fetchTableData()
  } catch { /* error shown by useApi */ } finally {
    deleteRowLoading.value = null
  }
}

// ---- Create table ----

function openCreateTableForm() {
  newTableName.value = ''
  newTableColumns.value = [{ name: 'id', type: 'uuid', nullable: false, defaultValue: 'gen_random_uuid()', primaryKey: true }]
  showCreateTableForm.value = true
}

function addColumnDef() {
  newTableColumns.value.push({ name: '', type: 'text', nullable: true, defaultValue: '', primaryKey: false })
}

function removeColumnDef(index: number) {
  newTableColumns.value.splice(index, 1)
}

async function createTable() {
  if (!newTableName.value.trim()) return
  if (newTableColumns.value.length === 0) return
  createTableLoading.value = true
  try {
    await api.post(`${BASE}/tables`, {
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
    await api.del(`${BASE}/tables/${encodeURIComponent(tableName)}?confirm=true`)
    toast.success(`Table "${tableName}" dropped`)
    if (selectedTable.value === tableName) selectedTable.value = ''
    await fetchTables()
  } catch { /* error shown by useApi */ } finally {
    dropTableLoading.value = false
  }
}

// ---- Connection info ----

async function fetchConnectionInfo() {
  connectionLoading.value = true
  try {
    connectionInfo.value = await api.get(`${BASE}/connection-info`)
  } catch { connectionInfo.value = null } finally {
    connectionLoading.value = false
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('Copied to clipboard')
}

// ---- IP Allowlist ----

async function fetchAllowlist() {
  allowlistLoading.value = true
  try {
    const data = await api.get<{ allowlist: string[]; currentIp: string }>(`${BASE}/ip-allowlist`)
    allowlist.value = data.allowlist ?? []
    currentIp.value = data.currentIp ?? 'unknown'
  } catch { allowlist.value = [] } finally {
    allowlistLoading.value = false
  }
}

async function saveAllowlist() {
  allowlistSaving.value = true
  try {
    const data = await api.put<{ allowlist: string[] }>(`${BASE}/ip-allowlist`, { allowlist: allowlist.value })
    allowlist.value = data.allowlist
    toast.success('IP allowlist updated')
  } catch { /* error shown by useApi */ } finally {
    allowlistSaving.value = false
  }
}

function addIpEntry() {
  const ip = newIpEntry.value.trim()
  if (!ip) return
  if (allowlist.value.includes(ip)) {
    toast.error('IP already in allowlist')
    return
  }
  allowlist.value.push(ip)
  newIpEntry.value = ''
  saveAllowlist()
}

function removeIpEntry(index: number) {
  allowlist.value.splice(index, 1)
  saveAllowlist()
}

function formatCellValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function isNullish(val: unknown): boolean {
  return val === null || val === undefined
}

onMounted(() => {
  fetchTables()
  fetchStats()
})
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('super.platformDb.title') }}</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('super.platformDb.subtitle') }}</p>
      </div>
      <!-- Stats badges -->
      <div v-if="stats" class="flex items-center gap-3">
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
          <BarChart3 class="w-3 h-3" /> {{ stats.tableCount }} tables
        </span>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
          <Database class="w-3 h-3" /> {{ stats.databaseSize }}
        </span>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
          {{ stats.activeConnections }} connections
        </span>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-8 h-8" />
    </div>

    <!-- Main content -->
    <div v-else>
      <!-- Tab bar -->
      <div class="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 mb-4 w-fit">
        <button @click="onTabChange('data')" :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors', activeTab === 'data' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']">
          <Eye class="w-3.5 h-3.5" /> {{ t('super.platformDb.tabs.data') }}
        </button>
        <button @click="onTabChange('structure')" :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors', activeTab === 'structure' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']">
          <Columns3 class="w-3.5 h-3.5" /> {{ t('super.platformDb.tabs.structure') }}
        </button>
        <button @click="onTabChange('query')" :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors', activeTab === 'query' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']">
          <Terminal class="w-3.5 h-3.5" /> {{ t('super.platformDb.tabs.query') }}
        </button>
        <button @click="onTabChange('connection')" :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors', activeTab === 'connection' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']">
          <Database class="w-3.5 h-3.5" /> {{ t('super.platformDb.tabs.connection') }}
        </button>
        <button @click="onTabChange('access')" :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors', activeTab === 'access' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']">
          <Shield class="w-3.5 h-3.5" /> {{ t('super.platformDb.tabs.access') }}
        </button>
      </div>

      <!-- Data & Structure tabs have sidebar -->
      <div v-if="activeTab === 'data' || activeTab === 'structure'" class="flex gap-4">
        <!-- Tables sidebar -->
        <div class="w-56 shrink-0">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div class="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('super.platformDb.tables') }}</span>
              <button @click="openCreateTableForm" class="p-1 rounded text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors" :title="t('super.platformDb.createTable')">
                <Plus class="w-3.5 h-3.5" />
              </button>
            </div>
            <div v-if="tables.length === 0" class="px-3 py-6 text-center text-xs text-gray-500 dark:text-gray-400">
              No tables found.
            </div>
            <div v-else class="max-h-[600px] overflow-y-auto">
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
                <Table2 class="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span class="truncate flex-1">{{ table.name }}</span>
                <span v-if="table.rowCount !== undefined" class="text-[10px] text-gray-400 dark:text-gray-600 shrink-0">{{ table.rowCount }}</span>
                <button
                  @click.stop="dropTable(table.name)"
                  class="p-0.5 rounded opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all"
                  :title="t('super.platformDb.dropTable')"
                >
                  <Trash2 class="w-3 h-3" />
                </button>
              </button>
            </div>
          </div>
        </div>

        <!-- Main content area -->
        <div class="flex-1 min-w-0">
          <!-- No table selected -->
          <div v-if="!selectedTable" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
            <Table2 class="w-8 h-8 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
            <p class="text-gray-500 dark:text-gray-400 text-sm">{{ t('super.platformDb.selectTable') }}</p>
          </div>

          <!-- Data view -->
          <div v-if="activeTab === 'data' && selectedTable" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <!-- Data toolbar -->
            <div class="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ primaryKeyColumns.length > 0 ? t('super.platformDb.editHint') : t('super.platformDb.noPrimaryKey') }}
              </span>
              <button @click="openAddRowForm" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors">
                <Plus class="w-3.5 h-3.5" /> {{ t('super.platformDb.addRow') }}
              </button>
            </div>

            <!-- Add row form -->
            <div v-if="showAddRowForm" class="px-4 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <div class="flex items-center justify-between mb-3">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('super.platformDb.insertRow') }}</span>
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
                <button @click="showAddRowForm = false" class="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800">{{ t('super.platformDb.cancel') }}</button>
                <button @click="insertRow" :disabled="addRowLoading" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium transition-colors">
                  <CompassSpinner v-if="addRowLoading" size="w-3.5 h-3.5" />
                  {{ t('super.platformDb.insertRow') }}
                </button>
              </div>
            </div>

            <div v-if="dataLoading" class="flex items-center justify-center py-16">
              <CompassSpinner />
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
                      <td :colspan="dataColumns.length + (primaryKeyColumns.length > 0 ? 1 : 0)" class="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">{{ t('super.platformDb.noData') }}</td>
                    </tr>
                    <tr v-for="(row, i) in dataRows" :key="i" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                      <td
                        v-for="col in dataColumns"
                        :key="col"
                        class="px-4 py-2.5 text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-xs"
                        :class="{ 'cursor-pointer': primaryKeyColumns.length > 0 }"
                        :title="formatCellValue(row[col])"
                        @dblclick="startEditingCell(i, col)"
                      >
                        <!-- Editing mode -->
                        <div v-if="editingCell?.rowIndex === i && editingCell?.colName === col" class="flex items-center gap-1 -my-1">
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
                          <span v-if="isNullish(row[col])" class="text-gray-400 dark:text-gray-600 italic">NULL</span>
                          <span v-else class="truncate">{{ formatCellValue(row[col]) }}</span>
                        </template>
                      </td>
                      <!-- Delete button -->
                      <td v-if="primaryKeyColumns.length > 0" class="px-2 py-2.5">
                        <button @click="deleteRow(i)" :disabled="deleteRowLoading === i" class="p-1 rounded text-gray-400 hover:text-red-500 transition-colors" title="Delete row">
                          <CompassSpinner v-if="deleteRowLoading === i" size="w-3.5 h-3.5" />
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
                  <select v-model="dataPageSize" @change="dataPage = 1; fetchTableData()" class="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                    <option :value="25">25</option>
                    <option :value="50">50</option>
                    <option :value="100">100</option>
                    <option :value="500">500</option>
                  </select>
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
          <div v-if="activeTab === 'structure' && selectedTable" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div v-if="structureLoading" class="flex items-center justify-center py-16">
              <CompassSpinner />
            </div>
            <table v-else class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('super.platformDb.column') }}</th>
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('super.platformDb.type') }}</th>
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Key</th>
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('super.platformDb.nullable') }}</th>
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('super.platformDb.default') }}</th>
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
        </div>
      </div>

      <!-- Query tab -->
      <div v-if="activeTab === 'query'" class="space-y-4">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('super.platformDb.sqlQuery') }}</span>
            <button @click="executeQuery" :disabled="queryLoading || !queryText.trim()" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium transition-colors">
              <CompassSpinner v-if="queryLoading" size="w-3.5 h-3.5" />
              <Play v-else class="w-3.5 h-3.5" />
              {{ t('super.platformDb.execute') }}
            </button>
          </div>
          <textarea
            v-model="queryText"
            @keydown="handleQueryKeydown"
            placeholder="SELECT * FROM users LIMIT 10;"
            class="w-full h-40 px-4 py-3 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-white font-mono text-sm resize-y focus:outline-none placeholder-gray-400 dark:placeholder-gray-600"
          />
          <div class="px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-400 dark:text-gray-600">
            {{ t('super.platformDb.queryHint') }}
          </div>
        </div>

        <div v-if="queryError" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p class="text-sm text-red-700 dark:text-red-300 font-mono">{{ queryError }}</p>
          <p v-if="queryTime > 0" class="text-xs text-red-500 dark:text-red-400 mt-1">{{ queryTime }}ms</p>
        </div>

        <div v-if="queryRows.length > 0 || (queryRowCount === 0 && !queryError && !queryLoading && queryTime > 0)" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <span class="text-xs text-gray-500 dark:text-gray-400">{{ queryRowCount }} row{{ queryRowCount !== 1 ? 's' : '' }} returned</span>
            <span class="text-xs text-gray-400 dark:text-gray-600">{{ queryTime }}ms</span>
          </div>
          <div class="overflow-x-auto max-h-[500px]">
            <table class="w-full text-sm">
              <thead v-if="queryColumns.length > 0" class="sticky top-0">
                <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                  <th v-for="col in queryColumns" :key="col" class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">{{ col }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr v-for="(row, i) in queryRows" :key="i" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                  <td v-for="col in queryColumns" :key="col" class="px-4 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-xs truncate font-mono text-xs" :title="formatCellValue(row[col])">
                    <span v-if="isNullish(row[col])" class="text-gray-400 dark:text-gray-600 italic">NULL</span>
                    <span v-else>{{ formatCellValue(row[col]) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Connection tab -->
      <div v-if="activeTab === 'connection'">
        <div v-if="connectionLoading" class="flex items-center justify-center py-20">
          <CompassSpinner />
        </div>
        <div v-else-if="connectionInfo" class="space-y-4">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 space-y-5">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Database class="w-4 h-4 text-primary-600 dark:text-primary-400" />
              {{ t('super.platformDb.connectionDetails') }}
            </h3>

            <!-- Credentials grid -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <span class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{{ t('super.platformDb.host') }}</span>
                <div class="flex items-center gap-1.5">
                  <code class="text-sm text-gray-900 dark:text-white font-mono">{{ connectionInfo.host }}</code>
                  <button @click="copyToClipboard(connectionInfo.host)" class="p-0.5 text-gray-400 hover:text-primary-600 transition-colors"><Copy class="w-3 h-3" /></button>
                </div>
              </div>
              <div>
                <span class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{{ t('super.platformDb.port') }}</span>
                <div class="flex items-center gap-1.5">
                  <code class="text-sm text-gray-900 dark:text-white font-mono">{{ connectionInfo.port }}</code>
                  <button @click="copyToClipboard(String(connectionInfo.port))" class="p-0.5 text-gray-400 hover:text-primary-600 transition-colors"><Copy class="w-3 h-3" /></button>
                </div>
              </div>
              <div>
                <span class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{{ t('super.platformDb.database') }}</span>
                <div class="flex items-center gap-1.5">
                  <code class="text-sm text-gray-900 dark:text-white font-mono">{{ connectionInfo.database }}</code>
                  <button @click="copyToClipboard(connectionInfo.database)" class="p-0.5 text-gray-400 hover:text-primary-600 transition-colors"><Copy class="w-3 h-3" /></button>
                </div>
              </div>
              <div>
                <span class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{{ t('super.platformDb.username') }}</span>
                <div class="flex items-center gap-1.5">
                  <code class="text-sm text-gray-900 dark:text-white font-mono">{{ connectionInfo.username }}</code>
                  <button @click="copyToClipboard(connectionInfo.username)" class="p-0.5 text-gray-400 hover:text-primary-600 transition-colors"><Copy class="w-3 h-3" /></button>
                </div>
              </div>
            </div>

            <!-- Connection string -->
            <div>
              <span class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{{ t('super.platformDb.connString') }}</span>
              <div class="flex items-center gap-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg px-3 py-2">
                <code class="text-xs text-gray-700 dark:text-gray-300 font-mono flex-1 overflow-x-auto whitespace-nowrap">{{ connectionInfo.connectionString }}</code>
                <button @click="copyToClipboard(connectionInfo.connectionString)" class="p-1 text-gray-400 hover:text-primary-600 transition-colors shrink-0"><Copy class="w-3.5 h-3.5" /></button>
              </div>
            </div>

            <!-- CLI command -->
            <div>
              <span class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{{ t('super.platformDb.cliCommand') }}</span>
              <div class="flex items-center gap-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg px-3 py-2">
                <code class="text-xs text-gray-700 dark:text-gray-300 font-mono flex-1 overflow-x-auto whitespace-nowrap">{{ connectionInfo.cliCommand }}</code>
                <button @click="copyToClipboard(connectionInfo.cliCommand)" class="p-1 text-gray-400 hover:text-primary-600 transition-colors shrink-0"><Copy class="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </div>

          <!-- SSH Tunnel guide -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">{{ t('super.platformDb.sshTunnel') }}</h3>
            <div class="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <Info class="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div class="text-xs text-blue-700 dark:text-blue-300">
                <p>{{ t('super.platformDb.sshTunnelDesc') }}</p>
                <div class="flex items-center gap-2 mt-2 bg-blue-100 dark:bg-blue-900/30 px-3 py-2 rounded font-mono">
                  <code class="flex-1">{{ connectionInfo.sshTunnel }}</code>
                  <button @click="copyToClipboard(connectionInfo.sshTunnel)" class="p-0.5 text-blue-500 hover:text-blue-700 transition-colors shrink-0"><Copy class="w-3 h-3" /></button>
                </div>
                <p class="mt-2">{{ t('super.platformDb.sshTunnelAfter') }}</p>
              </div>
            </div>
          </div>

          <!-- External tools -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">{{ t('super.platformDb.externalTools') }}</h3>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div class="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                <p class="text-sm font-medium text-gray-900 dark:text-white">pgAdmin</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ t('super.platformDb.pgAdminDesc') }}</p>
              </div>
              <div class="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                <p class="text-sm font-medium text-gray-900 dark:text-white">DBeaver</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ t('super.platformDb.dbeaverDesc') }}</p>
              </div>
              <div class="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                <p class="text-sm font-medium text-gray-900 dark:text-white">TablePlus</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ t('super.platformDb.tablePlusDesc') }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Access Control tab -->
      <div v-if="activeTab === 'access'">
        <div v-if="allowlistLoading" class="flex items-center justify-center py-20">
          <CompassSpinner />
        </div>
        <div v-else class="space-y-4">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
              <Shield class="w-4 h-4 text-primary-600 dark:text-primary-400" />
              {{ t('super.platformDb.ipAllowlist') }}
            </h3>

            <div class="flex items-start gap-2 p-3 mb-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
              <Info class="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
              <div class="text-xs text-yellow-700 dark:text-yellow-300">
                <p>{{ t('super.platformDb.allowlistInfo') }}</p>
                <p class="mt-1 font-mono">{{ t('super.platformDb.yourIp') }}: {{ currentIp }}</p>
              </div>
            </div>

            <!-- Add IP form -->
            <div class="flex items-center gap-2 mb-4">
              <input
                v-model="newIpEntry"
                @keydown.enter="addIpEntry"
                placeholder="192.168.1.0/24 or 10.0.0.1"
                class="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
              />
              <button @click="addIpEntry" :disabled="!newIpEntry.trim() || allowlistSaving" class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                <Plus class="w-4 h-4" />
                {{ t('super.platformDb.addIp') }}
              </button>
            </div>

            <!-- Allowlist entries -->
            <div v-if="allowlist.length === 0" class="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
              {{ t('super.platformDb.noAllowlistEntries') }}
            </div>
            <div v-else class="space-y-2">
              <div v-for="(ip, i) in allowlist" :key="i" class="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                <code class="text-sm text-gray-900 dark:text-white font-mono">{{ ip }}</code>
                <button @click="removeIpEntry(i)" class="p-1 text-gray-400 hover:text-red-500 transition-colors" :title="t('super.platformDb.removeIp')">
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
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
          <span class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('super.platformDb.createTable') }}</span>
          <button @click="showCreateTableForm = false" class="p-1 text-gray-400 hover:text-gray-600"><X class="w-5 h-5" /></button>
        </div>
        <div class="px-6 py-4 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('super.platformDb.tableName') }}</label>
            <input v-model="newTableName" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono" placeholder="my_table" />
          </div>
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('super.platformDb.columns') }}</label>
              <button @click="addColumnDef" class="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"><Plus class="w-3.5 h-3.5" /> {{ t('super.platformDb.addColumn') }}</button>
            </div>
            <div class="space-y-2">
              <div v-for="(col, i) in newTableColumns" :key="i" class="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                <input v-model="col.name" placeholder="name" class="w-32 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                <input v-model="col.type" placeholder="text" class="w-36 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono" />
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
          <button @click="showCreateTableForm = false" class="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">{{ t('super.platformDb.cancel') }}</button>
          <button @click="createTable" :disabled="createTableLoading || !newTableName.trim() || newTableColumns.length === 0" class="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
            <CompassSpinner v-if="createTableLoading" size="w-4 h-4" class="inline mr-1" />
            {{ t('super.platformDb.createTable') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
