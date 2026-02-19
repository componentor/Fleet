<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Database, Table2, Search, Play, Loader2, ChevronLeft, ChevronRight, ArrowUpDown, Eye, Columns3, Terminal } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'

const props = defineProps<{ serviceId: string }>()
const api = useApi()

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
const structureColumns = ref<{ name: string; type: string; nullable: boolean; defaultValue: string | null }[]>([])
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

const dataTotalPages = computed(() => Math.max(1, Math.ceil(dataTotalRows.value / dataPageSize.value)))

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
    const params = selectedDb.value ? `?db=${encodeURIComponent(selectedDb.value)}` : ''
    const data = await api.get<{ tables: { name: string; type: string }[] }>(`/database/${props.serviceId}/tables${params}`)
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
}

async function fetchStructure() {
  if (!selectedTable.value) return
  structureLoading.value = true
  try {
    const params = selectedDb.value ? `?db=${encodeURIComponent(selectedDb.value)}` : ''
    const data = await api.get<{ columns: { name: string; type: string; nullable: boolean; defaultValue: string | null }[] }>(`/database/${props.serviceId}/tables/${selectedTable.value}/columns${params}`)
    structureColumns.value = data.columns ?? []
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
    const params = selectedDb.value ? `?db=${encodeURIComponent(selectedDb.value)}` : ''
    const data = await api.post<{ columns: string[]; rows: string[][]; rowCount: number; executionTimeMs: number; truncated: boolean }>(`/database/${props.serviceId}/query${params}`, {
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

watch(() => props.serviceId, () => {
  fetchInfo()
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
          <!-- Database selector -->
          <div v-if="dbInfo.databases.length > 1" class="flex items-center gap-2">
            <Database class="w-4 h-4 text-gray-400" />
            <select
              v-model="selectedDb"
              @change="onDbChange"
              class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option v-for="db in dbInfo.databases" :key="db" :value="db">{{ db }}</option>
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

        <!-- View toggle -->
        <div class="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          <button
            @click="onViewChange('data')"
            :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors', activeView === 'data' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']"
          >
            <Eye class="w-3.5 h-3.5" />
            Data
          </button>
          <button
            @click="onViewChange('structure')"
            :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors', activeView === 'structure' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']"
          >
            <Columns3 class="w-3.5 h-3.5" />
            Structure
          </button>
          <button
            @click="onViewChange('query')"
            :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors', activeView === 'query' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300']"
          >
            <Terminal class="w-3.5 h-3.5" />
            Query
          </button>
        </div>
      </div>

      <div class="flex gap-4">
        <!-- Tables sidebar -->
        <div class="w-56 shrink-0">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div class="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700">
              <span class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tables</span>
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
                  'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                  selectedTable === table.name
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-750'
                ]"
              >
                <Table2 class="w-3.5 h-3.5 shrink-0" :class="table.type === 'view' ? 'text-purple-500' : 'text-gray-400'" />
                <span class="truncate">{{ table.name }}</span>
                <span v-if="table.type === 'view'" class="text-[10px] text-purple-500 dark:text-purple-400 ml-auto shrink-0">view</span>
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
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr v-if="dataRows.length === 0">
                      <td :colspan="dataColumns.length || 1" class="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">No data.</td>
                    </tr>
                    <tr v-for="(row, i) in dataRows" :key="i" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                      <td
                        v-for="(cell, j) in row"
                        :key="j"
                        class="px-4 py-2.5 text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-xs truncate"
                        :title="cell"
                      >
                        <span v-if="cell === '\\N' || cell === 'NULL' || cell === ''" class="text-gray-400 dark:text-gray-600 italic">NULL</span>
                        <span v-else>{{ cell }}</span>
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
                  <button
                    @click="dataPage--; fetchTableData()"
                    :disabled="dataPage <= 1"
                    class="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-750 disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft class="w-4 h-4" />
                  </button>
                  <span class="text-xs text-gray-600 dark:text-gray-400">{{ dataPage }} / {{ dataTotalPages }}</span>
                  <button
                    @click="dataPage++; fetchTableData()"
                    :disabled="dataPage >= dataTotalPages"
                    class="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-750 disabled:opacity-30 transition-colors"
                  >
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
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Nullable</th>
                  <th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Default</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr v-if="structureColumns.length === 0">
                  <td colspan="4" class="px-4 py-8 text-center text-gray-500 dark:text-gray-400 text-sm">No columns found.</td>
                </tr>
                <tr v-for="col in structureColumns" :key="col.name" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                  <td class="px-4 py-2.5 font-mono text-gray-900 dark:text-white">{{ col.name }}</td>
                  <td class="px-4 py-2.5 font-mono text-gray-600 dark:text-gray-400">{{ col.type }}</td>
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
                  <button
                    @click="executeQuery"
                    :disabled="queryLoading || !queryText.trim()"
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                  >
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

            <!-- Query error -->
            <div v-if="queryError" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p class="text-sm text-red-700 dark:text-red-300 font-mono">{{ queryError }}</p>
            </div>

            <!-- Query results -->
            <div v-if="queryRows.length > 0 || (queryRowCount === 0 && !queryError && !queryLoading && queryTime > 0)" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  {{ queryRowCount }} row{{ queryRowCount !== 1 ? 's' : '' }} returned
                </span>
                <span class="text-xs text-gray-400 dark:text-gray-600">{{ queryTime }}ms</span>
              </div>
              <div class="overflow-x-auto max-h-96">
                <table class="w-full text-sm">
                  <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr v-for="(row, i) in queryRows" :key="i" class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                      <td
                        v-for="(cell, j) in row"
                        :key="j"
                        class="px-4 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-xs truncate font-mono text-xs"
                        :title="cell"
                      >
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
  </div>
</template>
