<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ShieldCheck, Plus, Trash2, Pencil, X, ChevronDown, ChevronRight, Zap, LifeBuoy, Shield, Calculator, Eye, Wrench } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

const api = useApi()
const { t } = useI18n()

interface RolePreset {
  key: string
  icon: any
  color: string
  permissions: Record<string, string[]>
}

const ROLE_PRESETS: RolePreset[] = [
  {
    key: 'customerSupport',
    icon: LifeBuoy,
    color: 'blue',
    permissions: {
      dashboard: ['read'],
      accounts: ['read', 'impersonate'],
      users: ['read'],
      services: ['read'],
      support: ['read', 'write'],
      events: ['read'],
      errors: ['read'],
      statusPosts: ['read', 'write'],
    },
  },
  {
    key: 'securityAdmin',
    icon: Shield,
    color: 'red',
    permissions: {
      dashboard: ['read'],
      users: ['read', 'write'],
      accounts: ['read'],
      events: ['read'],
      errors: ['read'],
      status: ['read'],
      services: ['read'],
      jobs: ['read'],
    },
  },
  {
    key: 'billingAdmin',
    icon: Calculator,
    color: 'green',
    permissions: {
      dashboard: ['read'],
      accounts: ['read', 'write'],
      billing: ['read', 'write'],
      resellers: ['read', 'write'],
      users: ['read'],
    },
  },
  {
    key: 'auditor',
    icon: Eye,
    color: 'purple',
    permissions: {
      dashboard: ['read'],
      accounts: ['read'],
      users: ['read'],
      services: ['read'],
      storage: ['read'],
      events: ['read'],
      errors: ['read'],
      billing: ['read'],
      jobs: ['read'],
      support: ['read'],
      status: ['read'],
    },
  },
  {
    key: 'platformOps',
    icon: Wrench,
    color: 'amber',
    permissions: {
      dashboard: ['read', 'write'],
      nodes: ['read', 'write'],
      status: ['read'],
      statusPosts: ['read', 'write'],
      services: ['read', 'write'],
      storage: ['read', 'write'],
      marketplace: ['read', 'write'],
      sharedDomains: ['read', 'write'],
      jobs: ['read', 'write'],
      errors: ['read', 'write'],
      updates: ['read', 'write'],
    },
  },
]

const presetColors: Record<string, string> = {
  blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300',
  red: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
  green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
  purple: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300',
  amber: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
}

const creatingPreset = ref<string | null>(null)

const availablePresets = computed(() => {
  const existingNames = new Set(roles.value.map(r => r.name.toLowerCase()))
  return ROLE_PRESETS.filter(p => !existingNames.has(t(`roles.presets.${p.key}.name`).toLowerCase()))
})

async function createFromPreset(preset: RolePreset) {
  creatingPreset.value = preset.key
  error.value = ''
  success.value = ''
  try {
    await api.post('/admin/roles', {
      name: t(`roles.presets.${preset.key}.name`),
      description: t(`roles.presets.${preset.key}.description`),
      permissions: preset.permissions,
    })
    success.value = t('roles.createSuccess')
    await fetchRoles()
  } catch (err: any) {
    error.value = err?.body?.error || t('roles.createError')
  } finally {
    creatingPreset.value = null
  }
}

interface Role {
  id: string
  name: string
  description: string | null
  permissions: Record<string, string[]>
  isBuiltin: boolean
  userCount: number
  createdAt: string
  updatedAt: string
}

const SECTIONS = [
  'dashboard',
  'nodes',
  'status',
  'statusPosts',
  'users',
  'accounts',
  'services',
  'storage',
  'marketplace',
  'events',
  'errors',
  'jobs',
  'billing',
  'resellers',
  'emailTemplates',
  'sharedDomains',
  'settings',
  'updates',
  'support',
  'roles',
  'database',
] as const

function sectionLabel(section: string): string {
  return t(`roles.sections.${section}`, section)
}

function sectionPerms(section: string) {
  if (!editPermissions[section]) {
    editPermissions[section] = { read: false, write: false, impersonate: false }
  }
  return editPermissions[section]!
}

// State
const loading = ref(true)
const roles = ref<Role[]>([])
const error = ref('')
const success = ref('')

// Create form
const showCreateForm = ref(false)
const createForm = ref({ name: '', description: '' })
const creating = ref(false)

// Editing
const expandedRoleId = ref<string | null>(null)
const editForm = ref({ name: '', description: '' })
const editPermissions = reactive<Record<string, { read: boolean; write: boolean; impersonate: boolean }>>(
  Object.fromEntries(SECTIONS.map(s => [s, { read: false, write: false, impersonate: false }]))
)
const saving = ref(false)

// Delete confirm
const deletingId = ref<string | null>(null)
const deleting = ref(false)

async function fetchRoles() {
  loading.value = true
  error.value = ''
  try {
    const data = await api.get<Role[]>('/admin/roles')
    roles.value = Array.isArray(data) ? data : (data as any).data ?? []
  } catch {
    roles.value = []
    error.value = t('roles.loadError')
  } finally {
    loading.value = false
  }
}

async function createRole() {
  if (!createForm.value.name.trim()) return
  creating.value = true
  error.value = ''
  success.value = ''
  try {
    await api.post('/admin/roles', {
      name: createForm.value.name.trim(),
      description: createForm.value.description.trim() || null,
      permissions: {},
    })
    createForm.value = { name: '', description: '' }
    showCreateForm.value = false
    success.value = t('roles.createSuccess')
    await fetchRoles()
  } catch (err: any) {
    error.value = err?.body?.error || t('roles.createError')
  } finally {
    creating.value = false
  }
}

function expandRole(role: Role) {
  if (expandedRoleId.value === role.id) {
    expandedRoleId.value = null
    return
  }
  expandedRoleId.value = role.id
  editForm.value = { name: role.name, description: role.description || '' }

  // Build permissions checkbox state
  for (const section of SECTIONS) {
    const perms = role.permissions[section] || []
    editPermissions[section]!.read = perms.includes('read')
    editPermissions[section]!.write = perms.includes('write')
    editPermissions[section]!.impersonate = perms.includes('impersonate')
  }
}

function buildPermissions(): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const section of SECTIONS) {
    const levels: string[] = []
    if (editPermissions[section]?.read) levels.push('read')
    if (editPermissions[section]?.write) levels.push('write')
    if (section === 'accounts' && editPermissions[section]?.impersonate) levels.push('impersonate')
    if (levels.length > 0) {
      result[section] = levels
    }
  }
  return result
}

async function saveRole() {
  if (!expandedRoleId.value) return
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await api.patch(`/admin/roles/${expandedRoleId.value}`, {
      name: editForm.value.name.trim(),
      description: editForm.value.description.trim() || null,
      permissions: buildPermissions(),
    })
    success.value = t('roles.updateSuccess')
    expandedRoleId.value = null
    await fetchRoles()
  } catch (err: any) {
    error.value = err?.body?.error || t('roles.updateError')
  } finally {
    saving.value = false
  }
}

function confirmDelete(id: string) {
  deletingId.value = id
}

async function deleteRole() {
  if (!deletingId.value) return
  deleting.value = true
  error.value = ''
  success.value = ''
  try {
    await api.del(`/admin/roles/${deletingId.value}`)
    success.value = t('roles.deleteSuccess')
    deletingId.value = null
    if (expandedRoleId.value === deletingId.value) {
      expandedRoleId.value = null
    }
    await fetchRoles()
  } catch (err: any) {
    error.value = err?.body?.error || t('roles.deleteError')
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  fetchRoles()
})
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <ShieldCheck class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('roles.title') }}</h1>
      </div>
      <button
        @click="showCreateForm = !showCreateForm; error = ''; success = ''"
        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
      >
        <Plus class="w-4 h-4" />
        {{ t('roles.createRole') }}
      </button>
    </div>

    <!-- Success alert -->
    <div v-if="success" class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center justify-between">
      <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
      <button @click="success = ''" class="text-green-400 hover:text-green-600 dark:hover:text-green-300">
        <X class="w-4 h-4" />
      </button>
    </div>

    <!-- Error alert -->
    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center justify-between">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      <button @click="error = ''" class="text-red-400 hover:text-red-600 dark:hover:text-red-300">
        <X class="w-4 h-4" />
      </button>
    </div>

    <!-- Create form -->
    <div v-if="showCreateForm" class="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">{{ t('roles.createTitle') }}</h2>
      <form @submit.prevent="createRole" class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('roles.nameLabel') }}</label>
            <input
              v-model="createForm.name"
              type="text"
              :placeholder="t('roles.namePlaceholder')"
              required
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('roles.descriptionLabel') }}</label>
            <input
              v-model="createForm.description"
              type="text"
              :placeholder="t('roles.descriptionPlaceholder')"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
        </div>
        <div class="flex items-center gap-3 pt-1">
          <button
            type="submit"
            :disabled="creating || !createForm.name.trim()"
            class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            <CompassSpinner v-if="creating" size="w-4 h-4" />
            {{ t('common.create') }}
          </button>
          <button
            type="button"
            @click="showCreateForm = false; createForm = { name: '', description: '' }"
            class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </form>
    </div>

    <!-- Quick-create presets -->
    <div v-if="availablePresets.length > 0 && !loading" class="mb-6">
      <h2 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{{ t('roles.quickCreate') }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        <button
          v-for="preset in availablePresets"
          :key="preset.key"
          @click="createFromPreset(preset)"
          :disabled="creatingPreset !== null"
          :class="[
            'flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all hover:shadow-sm disabled:opacity-50',
            presetColors[preset.color],
          ]"
        >
          <div class="shrink-0">
            <CompassSpinner v-if="creatingPreset === preset.key" size="w-5 h-5" />
            <component v-else :is="preset.icon" class="w-5 h-5" />
          </div>
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">{{ t(`roles.presets.${preset.key}.name`) }}</div>
            <div class="text-xs opacity-75 truncate">{{ t(`roles.presets.${preset.key}.description`) }}</div>
          </div>
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <CompassSpinner size="w-16 h-16" />
    </div>

    <!-- Roles table -->
    <div v-else class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div v-if="roles.length === 0" class="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
        {{ t('roles.noRoles') }}
      </div>

      <div v-else>
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700">
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('roles.tableName') }}</th>
              <th class="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('roles.tableDescription') }}</th>
              <th class="px-6 py-3.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('roles.tableUsers') }}</th>
              <th class="px-6 py-3.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('roles.tableType') }}</th>
              <th class="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('roles.tableActions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <template v-for="role in roles" :key="role.id">
              <!-- Role row -->
              <tr
                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer"
                @click="expandRole(role)"
              >
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2">
                    <component
                      :is="expandedRoleId === role.id ? ChevronDown : ChevronRight"
                      class="w-4 h-4 text-gray-400 flex-shrink-0"
                    />
                    <span class="text-sm font-medium text-gray-900 dark:text-white">{{ role.name }}</span>
                  </div>
                </td>
                <td class="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                  {{ role.description || '--' }}
                </td>
                <td class="px-6 py-4 text-center text-sm text-gray-600 dark:text-gray-400">
                  {{ role.userCount }}
                </td>
                <td class="px-6 py-4 text-center">
                  <span
                    v-if="role.isBuiltin"
                    class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                  >
                    {{ t('roles.builtIn') }}
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  >
                    {{ t('roles.custom') }}
                  </span>
                </td>
                <td class="px-6 py-4 text-right" @click.stop>
                  <div class="flex items-center justify-end gap-2">
                    <button
                      @click="expandRole(role)"
                      class="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      :title="t('roles.editTooltip')"
                    >
                      <Pencil class="w-4 h-4" />
                    </button>
                    <button
                      @click="confirmDelete(role.id)"
                      :disabled="role.isBuiltin"
                      :class="[
                        'p-1.5 rounded transition-colors',
                        role.isBuiltin
                          ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                          : 'text-gray-400 hover:text-red-600 dark:hover:text-red-400'
                      ]"
                      :title="role.isBuiltin ? t('roles.cannotDeleteBuiltin') : t('roles.deleteTooltip')"
                    >
                      <Trash2 class="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>

              <!-- Expanded editor -->
              <tr v-if="expandedRoleId === role.id">
                <td colspan="5" class="px-6 py-5 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700/50">
                  <div class="space-y-5">
                    <!-- Name & Description -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('roles.nameLabel') }}</label>
                        <input
                          v-model="editForm.name"
                          type="text"
                          :disabled="role.isBuiltin"
                          class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm disabled:opacity-50"
                        />
                      </div>
                      <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ t('roles.descriptionLabel') }}</label>
                        <input
                          v-model="editForm.description"
                          type="text"
                          :placeholder="t('roles.descriptionPlaceholder')"
                          class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                        />
                      </div>
                    </div>

                    <!-- Permissions grid -->
                    <div>
                      <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">{{ t('roles.permissions') }}</h3>
                      <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                        <table class="w-full">
                          <thead>
                            <tr class="bg-gray-100 dark:bg-gray-700/50">
                              <th class="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('roles.permSection') }}</th>
                              <th class="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-24">{{ t('roles.permRead') }}</th>
                              <th class="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-24">{{ t('roles.permWrite') }}</th>
                              <th class="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-24">{{ t('roles.permImpersonate') }}</th>
                            </tr>
                          </thead>
                          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                            <tr
                              v-for="section in SECTIONS"
                              :key="section"
                              class="hover:bg-gray-50 dark:hover:bg-gray-750/50"
                            >
                              <td class="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 font-medium">
                                {{ sectionLabel(section) }}
                              </td>
                              <td class="px-4 py-2.5 text-center">
                                <input
                                  type="checkbox"
                                  v-model="sectionPerms(section).read"
                                  class="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 dark:bg-gray-700 dark:checked:bg-primary-600"
                                />
                              </td>
                              <td class="px-4 py-2.5 text-center">
                                <input
                                  type="checkbox"
                                  v-model="sectionPerms(section).write"
                                  class="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 dark:bg-gray-700 dark:checked:bg-primary-600"
                                />
                              </td>
                              <td class="px-4 py-2.5 text-center">
                                <input
                                  v-if="section === 'accounts'"
                                  type="checkbox"
                                  v-model="sectionPerms(section).impersonate"
                                  class="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 dark:bg-gray-700 dark:checked:bg-primary-600"
                                />
                                <span v-else class="text-gray-300 dark:text-gray-600">--</span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <!-- Save / Cancel buttons -->
                    <div class="flex items-center gap-3 pt-1">
                      <button
                        @click="saveRole"
                        :disabled="saving || !editForm.name.trim()"
                        class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                      >
                        <CompassSpinner v-if="saving" size="w-4 h-4" />
                        {{ t('roles.saveChanges') }}
                      </button>
                      <button
                        @click="expandedRoleId = null"
                        class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        {{ t('common.cancel') }}
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Delete confirmation dialog -->
    <Teleport to="body">
      <div v-if="deletingId" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="fixed inset-0 bg-black/50" @click="deletingId = null" />
        <div class="relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-full max-w-md">
          <div class="p-6">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ t('roles.deleteTitle') }}</h2>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">
              {{ t('roles.deleteConfirm') }}
            </p>
            <div class="flex justify-end gap-3">
              <button
                @click="deletingId = null"
                class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                @click="deleteRole"
                :disabled="deleting"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <CompassSpinner v-if="deleting" size="w-4 h-4" />
                {{ t('common.delete') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
