<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useApi } from '@/composables/useApi'
import {
  HardDrive, Server, Shield, CheckCircle2, ArrowRight, ArrowLeft,
  Loader2, Plus, Trash2, RefreshCw, AlertTriangle, Database,
  Cloud, Monitor, Settings, Activity, BookOpen, ChevronDown,
  ChevronUp, Lock, Network, Terminal,
} from 'lucide-vue-next'

const api = useApi()

// ── State ────────────────────────────────────────────────────────────────

const loading = ref(false)
const error = ref('')
const success = ref('')

// Cluster state (loaded on mount)
const clusterData = ref<any>(null)
const isConfigured = ref(false)

// Wizard state
const showWizard = ref(false)
const currentStep = ref(1)
const totalSteps = 6

// Step 1: Mode and Provider Selection
const selectedMode = ref<'local' | 'distributed'>('local')
const selectedVolumeProvider = ref<'glusterfs' | 'ceph'>('glusterfs')
const selectedObjectProvider = ref<'minio' | 's3' | 'gcs'>('minio')

// Step 2: Nodes
interface StorageNode {
  hostname: string
  ipAddress: string
  role: 'storage' | 'storage+compute' | 'arbiter'
  storagePathRoot: string
  capacityGb: number | null
  testStatus: 'pending' | 'testing' | 'ok' | 'error'
  testMessage: string
}
const storageNodes = ref<StorageNode[]>([])
const showAddNode = ref(false)
const showSetupGuide = ref(false)
const newNode = ref<StorageNode>({
  hostname: '',
  ipAddress: '',
  role: 'storage',
  storagePathRoot: '/srv/fleet-storage',
  capacityGb: null,
  testStatus: 'pending',
  testMessage: '',
})

// Step 3: Config
const replicationFactor = ref(3)
const minioEndpoint = ref('')
const minioAccessKey = ref('')
const minioSecretKey = ref('')
const autoConfigureMinio = ref(true)

// S3 config
const s3Region = ref('us-east-1')
const s3AccessKeyId = ref('')
const s3SecretAccessKey = ref('')
const s3Endpoint = ref('')
const s3BucketPrefix = ref('')

// GCS config
const gcsProjectId = ref('')
const gcsKeyFile = ref('')
const gcsBucketPrefix = ref('')
const gcsLocation = ref('US')

// Ceph config
const cephMonitors = ref('')
const cephPool = ref('fleet-volumes')
const cephUser = ref('admin')
const cephKeyring = ref('/etc/ceph/ceph.client.admin.keyring')

// Migration wizard (post-setup)
const showMigrationWizard = ref(false)
const migrationWizardStep = ref(1)
const migrationTargetVolume = ref<'local' | 'glusterfs' | 'ceph'>('glusterfs')
const migrationTargetObject = ref<'local' | 'minio' | 's3' | 'gcs'>('minio')
const activeMigrationId = ref<string | null>(null)
const migrationLog = ref('')
const migrationPollInterval = ref<ReturnType<typeof setInterval> | null>(null)

// Step 4: Initialize
const initStatus = ref<'idle' | 'running' | 'success' | 'error'>('idle')
const initLogs = ref<string[]>([])

// Step 5: Migration
const migrationStatus = ref<'idle' | 'running' | 'complete'>('idle')
const migrationProgress = ref(0)
const migrationItem = ref('')
const hasMigratableData = ref(false)

// Step 6: Verify
const verifyHealth = ref<any>(null)

// ── Computed ─────────────────────────────────────────────────────────────

const steps = computed(() => [
  { number: 1, label: 'Choose Mode', icon: Monitor },
  { number: 2, label: 'Storage Nodes', icon: Server },
  { number: 3, label: 'Configure', icon: Settings },
  { number: 4, label: 'Initialize', icon: Database },
  { number: 5, label: 'Migrate Data', icon: HardDrive },
  { number: 6, label: 'Verify', icon: CheckCircle2 },
])

const canProceed = computed(() => {
  switch (currentStep.value) {
    case 1: return true
    case 2:
      if (selectedMode.value === 'local') return true
      return storageNodes.value.length >= replicationFactor.value
    case 3: {
      if (selectedMode.value === 'local') return true
      // Volume provider validation
      if (selectedVolumeProvider.value === 'ceph' && !cephMonitors.value) return false
      // Object provider validation
      if (selectedObjectProvider.value === 'minio' && !autoConfigureMinio.value && (!minioEndpoint.value || !minioAccessKey.value || !minioSecretKey.value)) return false
      if (selectedObjectProvider.value === 's3' && (!s3AccessKeyId.value || !s3SecretAccessKey.value)) return false
      if (selectedObjectProvider.value === 'gcs' && !gcsProjectId.value) return false
      return true
    }
    case 4: return initStatus.value === 'success'
    case 5: return migrationStatus.value !== 'running'
    case 6: return true
    default: return false
  }
})

// ── Lifecycle ────────────────────────────────────────────────────────────

onMounted(async () => {
  await loadCluster()
})

// ── API ──────────────────────────────────────────────────────────────────

async function loadCluster() {
  loading.value = true
  try {
    clusterData.value = await api.get('/admin/storage/cluster')
    isConfigured.value = !!clusterData.value?.cluster?.id
    if (isConfigured.value && clusterData.value.cluster.status !== 'inactive') {
      showWizard.value = false
    }
  } catch {
    // Not configured yet
    clusterData.value = null
    isConfigured.value = false
  } finally {
    loading.value = false
  }
}

function startWizard() {
  showWizard.value = true
  currentStep.value = 1
  error.value = ''
  success.value = ''
}

function addNode() {
  storageNodes.value.push({ ...newNode.value })
  newNode.value = {
    hostname: '',
    ipAddress: '',
    role: 'storage',
    storagePathRoot: '/srv/fleet-storage',
    capacityGb: null,
    testStatus: 'pending',
    testMessage: '',
  }
  showAddNode.value = false
}

function removeNode(index: number) {
  storageNodes.value.splice(index, 1)
}

async function testNode(index: number) {
  const node = storageNodes.value[index]!
  node.testStatus = 'testing'
  node.testMessage = 'Testing connectivity...'

  try {
    // For now, just validate via API health check
    const result = await api.post('/admin/storage/cluster/test', {}) as any
    node.testStatus = 'ok'
    node.testMessage = 'Connected'
  } catch (err: any) {
    node.testStatus = 'error'
    node.testMessage = err?.body?.error || 'Connection failed'
  }
}

async function initializeCluster() {
  initStatus.value = 'running'
  initLogs.value = []
  error.value = ''

  const isDistributed = selectedMode.value === 'distributed'

  try {
    // Register nodes first
    if (isDistributed) {
      initLogs.value.push('Registering storage nodes...')
      for (const node of storageNodes.value) {
        await api.post('/admin/storage/nodes', {
          hostname: node.hostname,
          ipAddress: node.ipAddress,
          role: node.role,
          storagePathRoot: node.storagePathRoot,
          capacityGb: node.capacityGb,
        })
        initLogs.value.push(`  + ${node.hostname} (${node.ipAddress})`)
      }
    }

    // Configure cluster
    initLogs.value.push('Configuring storage cluster...')

    // Build volume provider config
    let volumeConfig: any = {}
    let volumeProvider = 'local'
    if (isDistributed) {
      volumeProvider = selectedVolumeProvider.value
      const nodeList = storageNodes.value.map((n) => ({
        hostname: n.hostname,
        ip: n.ipAddress,
        brickPath: n.storagePathRoot,
      }))

      if (selectedVolumeProvider.value === 'glusterfs') {
        volumeConfig = { nodes: nodeList, replicaCount: replicationFactor.value }
      } else if (selectedVolumeProvider.value === 'ceph') {
        volumeConfig = {
          monitors: cephMonitors.value,
          pool: cephPool.value,
          user: cephUser.value,
          keyring: cephKeyring.value,
        }
      }
    }

    // Build object provider config
    let objectConfig: any = {}
    let objectProvider = 'local'
    if (isDistributed) {
      objectProvider = selectedObjectProvider.value
      if (selectedObjectProvider.value === 'minio' && !autoConfigureMinio.value) {
        objectConfig = {
          endpoint: minioEndpoint.value,
          accessKey: minioAccessKey.value,
          secretKey: minioSecretKey.value,
        }
      } else if (selectedObjectProvider.value === 's3') {
        objectConfig = {
          region: s3Region.value,
          accessKeyId: s3AccessKeyId.value,
          secretAccessKey: s3SecretAccessKey.value,
          ...(s3Endpoint.value ? { endpoint: s3Endpoint.value } : {}),
          ...(s3BucketPrefix.value ? { bucketPrefix: s3BucketPrefix.value } : {}),
        }
      } else if (selectedObjectProvider.value === 'gcs') {
        objectConfig = {
          projectId: gcsProjectId.value,
          ...(gcsKeyFile.value ? { keyFilename: gcsKeyFile.value } : {}),
          ...(gcsBucketPrefix.value ? { bucketPrefix: gcsBucketPrefix.value } : {}),
          location: gcsLocation.value,
        }
      }
    }

    const clusterConfig: any = {
      provider: volumeProvider,
      objectProvider,
      replicationFactor: isDistributed ? replicationFactor.value : 1,
      config: volumeConfig,
      objectConfig,
    }

    const result = await api.post('/admin/storage/cluster', clusterConfig) as any
    initLogs.value.push(`Cluster status: ${result.status}`)

    if (result.status === 'healthy') {
      initLogs.value.push('Storage cluster initialized successfully!')
      initStatus.value = 'success'
    } else {
      initLogs.value.push(`Warning: cluster status is ${result.status}`)
      initStatus.value = 'error'
      error.value = result.error || 'Cluster initialization returned non-healthy status'
    }
  } catch (err: any) {
    initStatus.value = 'error'
    error.value = err?.body?.error || 'Failed to initialize storage cluster'
    initLogs.value.push(`ERROR: ${error.value}`)
  }
}

async function startMigration() {
  migrationStatus.value = 'running'
  migrationProgress.value = 0
  migrationItem.value = 'Starting migration...'

  try {
    const toProvider = selectedMode.value === 'distributed' ? selectedVolumeProvider.value : 'local'
    const toObjectProvider = selectedMode.value === 'distributed' ? selectedObjectProvider.value : 'local'
    const result = await api.post('/admin/storage/migrate', {
      toProvider,
      toObjectProvider,
    }) as any

    // Poll for progress
    const migrationId = result.id
    const interval = setInterval(async () => {
      try {
        const status = await api.get(`/admin/storage/migrate/${migrationId}`) as any
        migrationProgress.value = status.progress ?? 0
        migrationItem.value = status.currentItem ?? ''

        if (status.status === 'completed') {
          clearInterval(interval)
          migrationStatus.value = 'complete'
        } else if (status.status === 'failed') {
          clearInterval(interval)
          migrationStatus.value = 'idle'
          error.value = 'Migration failed: ' + (status.log || 'Unknown error')
        }
      } catch {
        clearInterval(interval)
        migrationStatus.value = 'idle'
        error.value = 'Failed to check migration status'
      }
    }, 2000)
  } catch (err: any) {
    migrationStatus.value = 'idle'
    error.value = err?.body?.error || 'Failed to start migration'
  }
}

async function verifyCluster() {
  try {
    verifyHealth.value = await api.get('/admin/storage/health')
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to verify cluster health'
  }
}

function nextStep() {
  error.value = ''
  if (currentStep.value === 4 && initStatus.value === 'idle') {
    initializeCluster()
    return
  }
  if (currentStep.value === 6) {
    // Activate and close wizard
    showWizard.value = false
    loadCluster()
    return
  }
  if (currentStep.value === 5 && migrationStatus.value === 'idle' && !hasMigratableData.value) {
    // Skip migration step if no data to migrate
    currentStep.value = 6
    verifyCluster()
    return
  }
  if (currentStep.value < totalSteps) {
    currentStep.value++
    if (currentStep.value === 6) verifyCluster()
  }
}

function prevStep() {
  error.value = ''
  if (currentStep.value > 1) currentStep.value--
}

// ── Migration Wizard (post-setup) ──────────────────────────────────────

function openMigrationWizard() {
  showMigrationWizard.value = true
  migrationWizardStep.value = 1
  migrationTargetVolume.value = clusterData.value?.cluster?.provider === 'local' ? 'glusterfs' : 'local'
  migrationTargetObject.value = clusterData.value?.cluster?.objectProvider === 'local' ? 'minio' : 'local'
  activeMigrationId.value = null
  migrationLog.value = ''
  migrationProgress.value = 0
  error.value = ''
}

function closeMigrationWizard() {
  showMigrationWizard.value = false
  if (migrationPollInterval.value) {
    clearInterval(migrationPollInterval.value)
    migrationPollInterval.value = null
  }
  loadCluster()
}

async function startProviderMigration() {
  migrationWizardStep.value = 3
  migrationStatus.value = 'running'
  migrationProgress.value = 0
  migrationLog.value = ''
  error.value = ''

  try {
    const result = await api.post('/admin/storage/migrate', {
      toProvider: migrationTargetVolume.value,
      toObjectProvider: migrationTargetObject.value,
    }) as any

    activeMigrationId.value = result.id

    // Poll for progress
    migrationPollInterval.value = setInterval(async () => {
      if (!activeMigrationId.value) return
      try {
        const status = await api.get(`/admin/storage/migrate/${activeMigrationId.value}`) as any
        migrationProgress.value = status.progress ?? 0
        migrationItem.value = status.currentItem ?? ''
        migrationLog.value = status.log ?? ''

        if (status.status === 'completed') {
          clearInterval(migrationPollInterval.value!)
          migrationPollInterval.value = null
          migrationStatus.value = 'complete'
          migrationWizardStep.value = 4
        } else if (status.status === 'failed') {
          clearInterval(migrationPollInterval.value!)
          migrationPollInterval.value = null
          migrationStatus.value = 'idle'
          error.value = 'Migration failed. Check the log for details.'
        } else if (status.status === 'paused') {
          clearInterval(migrationPollInterval.value!)
          migrationPollInterval.value = null
          migrationStatus.value = 'idle'
        }
      } catch {
        // Keep polling
      }
    }, 2000)
  } catch (err: any) {
    migrationStatus.value = 'idle'
    error.value = err?.body?.error || 'Failed to start migration'
  }
}

async function pauseActiveMigration() {
  if (!activeMigrationId.value) return
  try {
    await api.post(`/admin/storage/migrate/${activeMigrationId.value}/pause`, {})
    migrationStatus.value = 'idle'
    migrationItem.value = 'Paused'
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to pause migration'
  }
}

async function resumeActiveMigration() {
  if (!activeMigrationId.value) return
  try {
    await api.post(`/admin/storage/migrate/${activeMigrationId.value}/resume`, {})
    migrationStatus.value = 'running'

    // Restart polling
    migrationPollInterval.value = setInterval(async () => {
      if (!activeMigrationId.value) return
      try {
        const status = await api.get(`/admin/storage/migrate/${activeMigrationId.value}`) as any
        migrationProgress.value = status.progress ?? 0
        migrationItem.value = status.currentItem ?? ''
        migrationLog.value = status.log ?? ''

        if (status.status === 'completed') {
          clearInterval(migrationPollInterval.value!)
          migrationPollInterval.value = null
          migrationStatus.value = 'complete'
          migrationWizardStep.value = 4
        } else if (status.status === 'failed' || status.status === 'paused') {
          clearInterval(migrationPollInterval.value!)
          migrationPollInterval.value = null
          migrationStatus.value = 'idle'
        }
      } catch {
        // Keep polling
      }
    }, 2000)
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to resume migration'
  }
}

async function rollbackActiveMigration() {
  if (!activeMigrationId.value) return
  try {
    await api.post(`/admin/storage/migrate/${activeMigrationId.value}/rollback`, {})
    success.value = 'Migration rolled back successfully'
    closeMigrationWizard()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to rollback migration'
  }
}
</script>

<template>
  <div>
    <!-- Page Header -->
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-3">
        <HardDrive class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Storage</h1>
      </div>
      <div v-if="!showWizard && !showMigrationWizard" class="flex items-center gap-3">
        <button
          v-if="isConfigured"
          @click="openMigrationWizard"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium transition-colors"
        >
          <RefreshCw class="w-4 h-4" />
          Migrate Storage
        </button>
        <button
          @click="startWizard"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Settings class="w-4 h-4" />
          {{ isConfigured ? 'Reconfigure Storage' : 'Configure Storage' }}
        </button>
      </div>
    </div>

    <!-- Current Status (when not in wizard mode) -->
    <template v-if="!showWizard && !loading">
      <!-- Cluster Overview -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <div class="flex items-center gap-3 mb-3">
            <Database class="w-5 h-5 text-primary-600 dark:text-primary-400" />
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Volume Provider</h3>
          </div>
          <p class="text-lg font-semibold text-gray-900 dark:text-white capitalize">
            {{ clusterData?.cluster?.provider ?? 'local' }}
          </p>
        </div>

        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <div class="flex items-center gap-3 mb-3">
            <Cloud class="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Object Provider</h3>
          </div>
          <p class="text-lg font-semibold text-gray-900 dark:text-white capitalize">
            {{ clusterData?.cluster?.objectProvider ?? 'local' }}
          </p>
        </div>

        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <div class="flex items-center gap-3 mb-3">
            <Activity class="w-5 h-5" :class="clusterData?.cluster?.status === 'healthy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'" />
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Status</h3>
          </div>
          <p class="text-lg font-semibold capitalize" :class="clusterData?.cluster?.status === 'healthy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
            {{ clusterData?.cluster?.status ?? 'Not configured' }}
          </p>
        </div>
      </div>

      <!-- Replication Info -->
      <div v-if="clusterData?.cluster?.replicationFactor > 1" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Replication</h2>
        </div>
        <div class="p-6">
          <div class="flex items-center gap-4">
            <Shield class="w-8 h-8 text-green-600 dark:text-green-400" />
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white">
                {{ clusterData.cluster.replicationFactor }}-way replication active
              </p>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Your data is replicated across {{ clusterData.cluster.replicationFactor }} nodes. Up to {{ clusterData.cluster.replicationFactor - 1 }} node(s) can fail without data loss.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Storage Nodes -->
      <div v-if="clusterData?.nodes?.length" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Storage Nodes</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Hostname</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">IP</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Role</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Capacity</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-for="node in clusterData.nodes" :key="node.id" class="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ node.hostname }}</td>
                <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{{ node.ipAddress }}</td>
                <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 capitalize">{{ node.role }}</td>
                <td class="px-6 py-4">
                  <span
                    class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                    :class="node.status === 'active' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'"
                  >
                    {{ node.status }}
                  </span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{{ node.capacityGb ? `${node.capacityGb} GB` : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- No storage configured -->
      <div v-if="!isConfigured" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
        <HardDrive class="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
        <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">No Storage Configured</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
          Set up your storage system to enable volume replication, object storage for uploads and backups, and automatic failover across nodes.
        </p>
        <button
          @click="startWizard"
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Settings class="w-4 h-4" />
          Configure Storage
        </button>
      </div>
    </template>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-12 gap-3 text-gray-500 dark:text-gray-400">
      <Loader2 class="w-5 h-5 animate-spin" />
      <span class="text-sm">Loading storage configuration...</span>
    </div>

    <!-- ═══ WIZARD ═══ -->
    <template v-if="showWizard">
      <!-- Step Indicator -->
      <div class="mb-10">
        <div class="flex items-center justify-between">
          <template v-for="(step, index) in steps" :key="step.number">
            <div class="flex items-center gap-2">
              <div
                :class="[
                  'w-10 h-10 rounded-full flex items-center justify-center transition-colors',
                  currentStep >= step.number
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                ]"
              >
                <component :is="currentStep > step.number ? CheckCircle2 : step.icon" class="w-5 h-5" />
              </div>
              <span
                :class="[
                  'text-sm font-medium hidden lg:inline',
                  currentStep >= step.number ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'
                ]"
              >
                {{ step.label }}
              </span>
            </div>
            <div
              v-if="index < steps.length - 1"
              :class="['flex-1 h-0.5 mx-4', currentStep > step.number ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-700']"
            ></div>
          </template>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
        <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
      </div>

      <!-- Step 1: Choose Mode -->
      <div v-if="currentStep === 1" class="space-y-6">
        <div class="text-center mb-8">
          <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Choose Storage Mode</h2>
          <p class="text-gray-500 dark:text-gray-400">Select how you want Fleet to manage storage across your infrastructure.</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
          <button
            @click="selectedMode = 'local'"
            :class="[
              'group bg-white dark:bg-gray-800 rounded-xl border-2 shadow-sm p-8 text-left transition-all',
              selectedMode === 'local'
                ? 'border-primary-500 ring-2 ring-primary-500/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-primary-400'
            ]"
          >
            <div class="w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-4">
              <Monitor class="w-6 h-6 text-gray-600 dark:text-gray-400" />
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Local / Single Node</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              For development or single-server setups. No replication. Uses local filesystem and NFS. This is the current default.
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              <span class="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">Simple setup</span>
              <span class="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">No replication</span>
            </div>
          </button>

          <button
            @click="selectedMode = 'distributed'"
            :class="[
              'group bg-white dark:bg-gray-800 rounded-xl border-2 shadow-sm p-8 text-left transition-all',
              selectedMode === 'distributed'
                ? 'border-primary-500 ring-2 ring-primary-500/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-primary-400'
            ]"
          >
            <div class="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-4">
              <Shield class="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Distributed Cluster</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              Production-grade. Replicates data across 3+ nodes with automatic failover and self-healing.
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              <span class="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">3-way replication</span>
              <span class="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">Auto-failover</span>
              <span class="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">Self-healing</span>
            </div>
          </button>
        </div>

        <!-- Provider Selection (when distributed is selected) -->
        <div v-if="selectedMode === 'distributed'" class="max-w-3xl mx-auto space-y-6 mt-8">
          <!-- Volume Provider -->
          <div>
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Volume Storage Provider</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                @click="selectedVolumeProvider = 'glusterfs'"
                :class="[
                  'p-4 rounded-lg border-2 text-left transition-all',
                  selectedVolumeProvider === 'glusterfs'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                ]"
              >
                <p class="text-sm font-semibold text-gray-900 dark:text-white">GlusterFS</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Distributed replicated filesystem. Great for bare metal and VMs. POSIX-compatible, auto-heal, Docker volume plugin.
                </p>
                <div class="mt-2 flex flex-wrap gap-1">
                  <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">Bare metal</span>
                  <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">GCP VMs</span>
                </div>
              </button>
              <button
                @click="selectedVolumeProvider = 'ceph'"
                :class="[
                  'p-4 rounded-lg border-2 text-left transition-all',
                  selectedVolumeProvider === 'ceph'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                ]"
              >
                <p class="text-sm font-semibold text-gray-900 dark:text-white">Ceph RBD</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Enterprise-grade block storage. Scales to exabytes. Erasure coding, snapshots, thin provisioning. Industry standard.
                </p>
                <div class="mt-2 flex flex-wrap gap-1">
                  <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">Datacenter</span>
                  <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">Petabyte+</span>
                </div>
              </button>
            </div>
          </div>

          <!-- Object Provider -->
          <div>
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Object Storage Provider</h3>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <button
                @click="selectedObjectProvider = 'minio'"
                :class="[
                  'p-4 rounded-lg border-2 text-left transition-all',
                  selectedObjectProvider === 'minio'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                ]"
              >
                <p class="text-sm font-semibold text-gray-900 dark:text-white">MinIO</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Self-hosted S3-compatible. Runs on your own nodes. No vendor lock-in.
                </p>
              </button>
              <button
                @click="selectedObjectProvider = 's3'"
                :class="[
                  'p-4 rounded-lg border-2 text-left transition-all',
                  selectedObjectProvider === 's3'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                ]"
              >
                <p class="text-sm font-semibold text-gray-900 dark:text-white">AWS S3</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Amazon S3 or S3-compatible services (Backblaze B2, Wasabi, etc.)
                </p>
              </button>
              <button
                @click="selectedObjectProvider = 'gcs'"
                :class="[
                  'p-4 rounded-lg border-2 text-left transition-all',
                  selectedObjectProvider === 'gcs'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                ]"
              >
                <p class="text-sm font-semibold text-gray-900 dark:text-white">Google Cloud</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Google Cloud Storage. Native GCS integration for GCP deployments.
                </p>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 2: Add Storage Nodes -->
      <div v-if="currentStep === 2" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Storage Nodes</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            <template v-if="selectedMode === 'distributed'">
              Add at least {{ replicationFactor }} nodes to form the storage cluster. Each node stores a full copy of your data.
            </template>
            <template v-else>
              Local mode uses the current server. No additional nodes needed.
            </template>
          </p>
        </div>

        <div v-if="selectedMode === 'local'" class="p-6">
          <div class="flex items-center gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <Monitor class="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <p class="text-sm text-blue-700 dark:text-blue-300">
              Local mode uses this server's filesystem. All volumes and objects are stored on a single node. You can upgrade to distributed mode later.
            </p>
          </div>
        </div>

        <div v-else class="p-6 space-y-4">
          <!-- Setup Guide Toggle -->
          <button
            @click="showSetupGuide = !showSetupGuide"
            class="w-full flex items-center justify-between p-4 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors text-left"
          >
            <div class="flex items-center gap-3">
              <BookOpen class="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <div>
                <p class="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Node Setup Guide</p>
                <p class="text-xs text-indigo-600/70 dark:text-indigo-400/70 mt-0.5">
                  Prerequisites, firewall ports, security, and step-by-step instructions
                </p>
              </div>
            </div>
            <component :is="showSetupGuide ? ChevronUp : ChevronDown" class="w-5 h-5 text-indigo-500 dark:text-indigo-400 shrink-0" />
          </button>

          <!-- Expanded Setup Guide -->
          <div v-if="showSetupGuide" class="space-y-4">
            <!-- Overview -->
            <div class="p-4 rounded-lg bg-white dark:bg-gray-750 border border-gray-200 dark:border-gray-600 space-y-3">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Server class="w-4 h-4 text-gray-500" />
                Overview
              </h4>
              <p class="text-sm text-gray-600 dark:text-gray-400">
                Each storage node is a server (bare metal or VM) that stores and replicates your data. Nodes can be
                <span class="font-medium text-gray-900 dark:text-white">dedicated</span> (better I/O) or
                <span class="font-medium text-gray-900 dark:text-white">shared with compute</span> (runs services too).
                You need at least <span class="font-medium text-gray-900 dark:text-white">{{ replicationFactor }} nodes</span> for {{ replicationFactor }}-way replication.
              </p>
              <div class="flex flex-wrap gap-2 text-xs">
                <span class="px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Minimum 50 GB disk space</span>
                <span class="px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Ubuntu 22.04+ / Debian 12+</span>
                <span class="px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Root / sudo access required</span>
              </div>
            </div>

            <!-- Static IP & Networking -->
            <div class="p-4 rounded-lg bg-white dark:bg-gray-750 border border-gray-200 dark:border-gray-600 space-y-3">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Network class="w-4 h-4 text-gray-500" />
                Network Requirements
              </h4>
              <div class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <div class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>
                  <p><span class="font-medium text-gray-900 dark:text-white">Static IP required.</span> Each storage node must have a fixed IP address (static assignment or DHCP reservation). Changing IPs will break the storage cluster.</p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                  <p><span class="font-medium text-gray-900 dark:text-white">Private network recommended.</span> Storage traffic should stay on a private/internal network (e.g. <code class="text-xs px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700">10.0.x.x</code>). Do not expose storage ports to the public internet.</p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                  <p><span class="font-medium text-gray-900 dark:text-white">Low latency between nodes.</span> All storage nodes should be in the same datacenter or availability zone. High latency will degrade performance and replication speed.</p>
                </div>
              </div>
            </div>

            <!-- Docker Swarm Relationship -->
            <div class="p-4 rounded-lg bg-white dark:bg-gray-750 border border-gray-200 dark:border-gray-600 space-y-3">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Database class="w-4 h-4 text-gray-500" />
                Docker Swarm &amp; Storage Nodes
              </h4>
              <div class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <div class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"></span>
                  <p><span class="font-medium text-gray-900 dark:text-white">Storage-only nodes do NOT need Docker Swarm.</span> Dedicated storage nodes run only the storage services ({{ selectedVolumeProvider === 'glusterfs' ? 'GlusterFS' : 'Ceph' }}{{ selectedObjectProvider === 'minio' ? ' + MinIO' : '' }}). They are managed by Fleet over SSH.</p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"></span>
                  <p><span class="font-medium text-gray-900 dark:text-white">Storage+Compute nodes are part of Docker Swarm.</span> These nodes join the swarm as workers AND run storage. Use this when you want fewer servers doing both jobs.</p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"></span>
                  <p><span class="font-medium text-gray-900 dark:text-white">Swarm worker nodes need the volume client.</span> Any Docker Swarm node that runs containers with storage volumes needs the {{ selectedVolumeProvider === 'glusterfs' ? 'GlusterFS client' : 'Ceph RBD client' }} installed so it can mount volumes.</p>
                </div>
              </div>
            </div>

            <!-- Firewall / Ports -->
            <div class="p-4 rounded-lg bg-white dark:bg-gray-750 border border-gray-200 dark:border-gray-600 space-y-3">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Lock class="w-4 h-4 text-gray-500" />
                Required Firewall Ports
              </h4>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                Open these ports between storage nodes and from Swarm workers to storage nodes. Only allow traffic from your internal network.
              </p>
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-gray-200 dark:border-gray-600">
                      <th class="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Port</th>
                      <th class="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Protocol</th>
                      <th class="text-left py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Service</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
                    <tr>
                      <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">22</td>
                      <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                      <td class="py-2 text-gray-600 dark:text-gray-300">SSH — Fleet manages nodes via SSH</td>
                    </tr>
                    <!-- GlusterFS ports -->
                    <template v-if="selectedVolumeProvider === 'glusterfs'">
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">24007</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">GlusterFS daemon (glusterd)</td>
                      </tr>
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">24008</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">GlusterFS management</td>
                      </tr>
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">49152–49251</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">GlusterFS bricks (one port per volume)</td>
                      </tr>
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">111</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP/UDP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">RPCBind / Portmapper</td>
                      </tr>
                    </template>
                    <!-- Ceph ports -->
                    <template v-if="selectedVolumeProvider === 'ceph'">
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">6789</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">Ceph Monitor (MON) — v1 protocol</td>
                      </tr>
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">3300</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">Ceph Monitor (MON) — v2 protocol</td>
                      </tr>
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">6800–7300</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">Ceph OSD (Object Storage Daemons)</td>
                      </tr>
                    </template>
                    <!-- MinIO ports -->
                    <template v-if="selectedObjectProvider === 'minio'">
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">9000</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">MinIO S3 API</td>
                      </tr>
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">9001</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">MinIO Console (optional — admin UI)</td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
              <div class="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                <p class="text-xs text-yellow-700 dark:text-yellow-300">
                  <span class="font-medium">Important:</span> Never expose storage ports ({{ selectedVolumeProvider === 'glusterfs' ? '24007, 49152+' : '6789, 6800+' }}{{ selectedObjectProvider === 'minio' ? ', 9000' : '' }}) to the public internet. Use <code class="px-1 py-0.5 rounded bg-yellow-100 dark:bg-yellow-800/50">ufw</code> or <code class="px-1 py-0.5 rounded bg-yellow-100 dark:bg-yellow-800/50">iptables</code> to restrict access to your internal network CIDR only.
                </p>
              </div>
            </div>

            <!-- Security Recommendations -->
            <div class="p-4 rounded-lg bg-white dark:bg-gray-750 border border-gray-200 dark:border-gray-600 space-y-3">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Shield class="w-4 h-4 text-gray-500" />
                Security Recommendations
              </h4>
              <ul class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span>
                  <p>Use <span class="font-medium text-gray-900 dark:text-white">SSH key authentication</span> (disable password login). Fleet connects to nodes via SSH for management operations.</p>
                </li>
                <li class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span>
                  <p>Place storage nodes on a <span class="font-medium text-gray-900 dark:text-white">dedicated VLAN or subnet</span> separate from public-facing services if possible.</p>
                </li>
                <li v-if="selectedVolumeProvider === 'glusterfs'" class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span>
                  <p>GlusterFS uses <span class="font-medium text-gray-900 dark:text-white">IP-based authentication</span>. Ensure only trusted IPs can reach port 24007. Consider TLS encryption for GlusterFS (available in v3.12+).</p>
                </li>
                <li v-if="selectedVolumeProvider === 'ceph'" class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span>
                  <p>Ceph uses <span class="font-medium text-gray-900 dark:text-white">CephX authentication</span> by default. Keep the keyring file secure and restrict access to the admin user.</p>
                </li>
                <li v-if="selectedObjectProvider === 'minio'" class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span>
                  <p>Enable <span class="font-medium text-gray-900 dark:text-white">TLS on MinIO</span> for production. Use strong access key and secret key (auto-generated during setup).</p>
                </li>
                <li class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span>
                  <p>Keep the operating system and storage software <span class="font-medium text-gray-900 dark:text-white">up to date</span> with security patches. Enable <code class="text-xs px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700">unattended-upgrades</code> for automatic security updates.</p>
                </li>
              </ul>
            </div>

            <!-- Quick Setup Commands -->
            <div class="p-4 rounded-lg bg-white dark:bg-gray-750 border border-gray-200 dark:border-gray-600 space-y-3">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Terminal class="w-4 h-4 text-gray-500" />
                Quick Setup — Run on Each Storage Node
              </h4>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                SSH into each node and run the following commands to prepare it for Fleet storage.
              </p>
              <div class="bg-gray-900 rounded-lg p-4 font-mono text-xs text-green-400 overflow-x-auto space-y-1">
                <p class="text-gray-500"># Update system packages</p>
                <p>sudo apt update && sudo apt upgrade -y</p>
                <p>&nbsp;</p>
                <template v-if="selectedVolumeProvider === 'glusterfs'">
                  <p class="text-gray-500"># Install GlusterFS server</p>
                  <p>sudo apt install -y glusterfs-server</p>
                  <p>sudo systemctl enable --now glusterd</p>
                  <p>&nbsp;</p>
                </template>
                <template v-if="selectedVolumeProvider === 'ceph'">
                  <p class="text-gray-500"># Install Ceph (via cephadm for production)</p>
                  <p>sudo apt install -y cephadm ceph-common</p>
                  <p>&nbsp;</p>
                </template>
                <template v-if="selectedObjectProvider === 'minio'">
                  <p class="text-gray-500"># MinIO will be auto-configured during initialization</p>
                  <p class="text-gray-500"># (or install manually if using custom MinIO endpoint)</p>
                  <p>&nbsp;</p>
                </template>
                <p class="text-gray-500"># Create storage directory</p>
                <p>sudo mkdir -p /srv/fleet-storage</p>
                <p>sudo chown root:root /srv/fleet-storage</p>
                <p>sudo chmod 755 /srv/fleet-storage</p>
                <p>&nbsp;</p>
                <p class="text-gray-500"># Configure firewall (adjust CIDR to your internal network)</p>
                <p>sudo ufw allow from 10.0.0.0/8 to any port 22 proto tcp</p>
                <template v-if="selectedVolumeProvider === 'glusterfs'">
                  <p>sudo ufw allow from 10.0.0.0/8 to any port 24007:24008 proto tcp</p>
                  <p>sudo ufw allow from 10.0.0.0/8 to any port 49152:49251 proto tcp</p>
                  <p>sudo ufw allow from 10.0.0.0/8 to any port 111</p>
                </template>
                <template v-if="selectedVolumeProvider === 'ceph'">
                  <p>sudo ufw allow from 10.0.0.0/8 to any port 3300 proto tcp</p>
                  <p>sudo ufw allow from 10.0.0.0/8 to any port 6789 proto tcp</p>
                  <p>sudo ufw allow from 10.0.0.0/8 to any port 6800:7300 proto tcp</p>
                </template>
                <template v-if="selectedObjectProvider === 'minio'">
                  <p>sudo ufw allow from 10.0.0.0/8 to any port 9000:9001 proto tcp</p>
                </template>
                <p>sudo ufw enable</p>
              </div>

              <!-- Client install on Swarm workers -->
              <div class="mt-3">
                <p class="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                  On Docker Swarm workers (so containers can mount volumes):
                </p>
                <div class="bg-gray-900 rounded-lg p-4 font-mono text-xs text-green-400 overflow-x-auto space-y-1">
                  <template v-if="selectedVolumeProvider === 'glusterfs'">
                    <p class="text-gray-500"># Install GlusterFS client on each Swarm worker</p>
                    <p>sudo apt install -y glusterfs-client</p>
                  </template>
                  <template v-if="selectedVolumeProvider === 'ceph'">
                    <p class="text-gray-500"># Install Ceph client on each Swarm worker</p>
                    <p>sudo apt install -y ceph-common</p>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- Node list -->
          <div v-if="storageNodes.length" class="space-y-3">
            <div
              v-for="(node, index) in storageNodes"
              :key="index"
              class="flex items-center gap-4 p-4 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <Server class="w-5 h-5 text-gray-400 shrink-0" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900 dark:text-white">{{ node.hostname }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ node.ipAddress }} &middot; {{ node.storagePathRoot }}</p>
              </div>
              <span
                class="text-xs px-2 py-1 rounded-full capitalize"
                :class="node.role === 'storage' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'"
              >
                {{ node.role }}
              </span>
              <div class="flex items-center gap-2">
                <CheckCircle2 v-if="node.testStatus === 'ok'" class="w-4 h-4 text-green-500" />
                <AlertTriangle v-else-if="node.testStatus === 'error'" class="w-4 h-4 text-red-500" />
                <Loader2 v-else-if="node.testStatus === 'testing'" class="w-4 h-4 animate-spin text-gray-400" />
                <button @click="testNode(index)" class="text-xs text-primary-600 dark:text-primary-400 hover:underline">Test</button>
                <button @click="removeNode(index)" class="text-red-500 hover:text-red-700">
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <!-- Add node form -->
          <div v-if="showAddNode" class="p-4 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10 space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Hostname</label>
                <input v-model="newNode.hostname" type="text" placeholder="storage-1" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">IP Address</label>
                <input v-model="newNode.ipAddress" type="text" placeholder="10.0.1.10" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Storage Path</label>
                <input v-model="newNode.storagePathRoot" type="text" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Role</label>
                <select v-model="newNode.role" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="storage">Storage only</option>
                  <option value="storage+compute">Storage + Compute</option>
                  <option value="arbiter">Arbiter (metadata only)</option>
                </select>
              </div>
            </div>
            <div class="flex gap-2">
              <button @click="addNode" :disabled="!newNode.hostname || !newNode.ipAddress" class="px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium">Add</button>
              <button @click="showAddNode = false" class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium">Cancel</button>
            </div>
          </div>

          <button
            v-if="!showAddNode"
            @click="showAddNode = true"
            class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-primary-400 hover:text-primary-600 transition-colors text-sm w-full justify-center"
          >
            <Plus class="w-4 h-4" />
            Add Storage Node
          </button>
        </div>
      </div>

      <!-- Step 3: Configure -->
      <div v-if="currentStep === 3" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Configure Replication</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Set the replication factor and object storage settings.</p>
        </div>
        <div class="p-6 space-y-6">
          <template v-if="selectedMode === 'distributed'">
            <!-- Replication factor -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Replication Factor</label>
              <div class="flex gap-4">
                <button
                  v-for="factor in [2, 3]"
                  :key="factor"
                  @click="replicationFactor = factor"
                  :class="[
                    'flex-1 p-4 rounded-lg border-2 text-left transition-all',
                    replicationFactor === factor
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                  ]"
                >
                  <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ factor }}-way Replica</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {{ factor === 2 ? 'Survives 1 node failure. Minimum setup.' : 'Survives 2 node failures. Recommended for production.' }}
                  </p>
                </button>
              </div>
            </div>

            <!-- Ceph config (when Ceph is selected) -->
            <div v-if="selectedVolumeProvider === 'ceph'" class="space-y-3">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Ceph Configuration</label>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Monitor Addresses</label>
                  <input v-model="cephMonitors" type="text" placeholder="10.0.1.10,10.0.1.11,10.0.1.12" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Pool Name</label>
                  <input v-model="cephPool" type="text" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Auth User</label>
                  <input v-model="cephUser" type="text" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Keyring Path</label>
                  <input v-model="cephKeyring" type="text" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              </div>
            </div>

            <!-- Object storage config based on selected provider -->
            <div class="space-y-3">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Object Storage — {{ selectedObjectProvider === 'minio' ? 'MinIO' : selectedObjectProvider === 's3' ? 'AWS S3' : 'Google Cloud Storage' }}
              </label>

              <!-- MinIO config -->
              <template v-if="selectedObjectProvider === 'minio'">
                <label class="flex items-center gap-2 mb-3 cursor-pointer">
                  <input type="checkbox" v-model="autoConfigureMinio" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                  <span class="text-sm text-gray-700 dark:text-gray-300">Auto-configure on storage nodes (recommended)</span>
                </label>
                <div v-if="!autoConfigureMinio" class="space-y-3 pl-6">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">MinIO Endpoint</label>
                    <input v-model="minioEndpoint" type="text" placeholder="http://10.0.1.10:9000" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Access Key</label>
                      <input v-model="minioAccessKey" type="text" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Secret Key</label>
                      <input v-model="minioSecretKey" type="password" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                  </div>
                </div>
              </template>

              <!-- S3 config -->
              <template v-if="selectedObjectProvider === 's3'">
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Region</label>
                    <input v-model="s3Region" type="text" placeholder="us-east-1" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Bucket Prefix <span class="text-gray-400">(optional)</span></label>
                    <input v-model="s3BucketPrefix" type="text" placeholder="my-fleet" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Access Key ID</label>
                    <input v-model="s3AccessKeyId" type="text" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Secret Access Key</label>
                    <input v-model="s3SecretAccessKey" type="password" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Custom Endpoint <span class="text-gray-400">(for S3-compatible services like Backblaze B2, Wasabi)</span></label>
                  <input v-model="s3Endpoint" type="text" placeholder="Leave empty for AWS S3" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              </template>

              <!-- GCS config -->
              <template v-if="selectedObjectProvider === 'gcs'">
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">GCP Project ID</label>
                    <input v-model="gcsProjectId" type="text" placeholder="my-project-123" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Storage Location</label>
                    <select v-model="gcsLocation" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                      <option value="US">US (Multi-region)</option>
                      <option value="EU">EU (Multi-region)</option>
                      <option value="ASIA">Asia (Multi-region)</option>
                      <option value="us-central1">us-central1</option>
                      <option value="us-east1">us-east1</option>
                      <option value="europe-west1">europe-west1</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Service Account Key File <span class="text-gray-400">(path on server)</span></label>
                    <input v-model="gcsKeyFile" type="text" placeholder="/etc/fleet/gcs-key.json (optional with workload identity)" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Bucket Prefix <span class="text-gray-400">(optional)</span></label>
                    <input v-model="gcsBucketPrefix" type="text" placeholder="my-fleet" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                </div>
                <div class="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <p class="text-xs text-blue-700 dark:text-blue-300">
                    If running on GCP with workload identity, you can leave the key file empty. The GCS client will use the default credentials automatically.
                  </p>
                </div>
              </template>
            </div>
          </template>

          <template v-else>
            <div class="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <CheckCircle2 class="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
              <p class="text-sm text-green-700 dark:text-green-300">
                Local mode requires no additional configuration. Storage will use the local filesystem on this server.
              </p>
            </div>
          </template>
        </div>
      </div>

      <!-- Step 4: Initialize -->
      <div v-if="currentStep === 4" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Initialize Storage Cluster</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">This will set up the storage system and verify everything is working.</p>
        </div>
        <div class="p-6">
          <div v-if="initStatus === 'idle'" class="text-center py-8">
            <Database class="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Click the button below to initialize the {{ selectedMode === 'distributed' ? 'GlusterFS cluster and MinIO' : 'local storage system' }}.
            </p>
            <button
              @click="initializeCluster"
              class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
            >
              Initialize
            </button>
          </div>

          <!-- Progress log -->
          <div v-if="initStatus !== 'idle'" class="space-y-3">
            <div class="bg-gray-900 rounded-lg p-4 font-mono text-xs text-green-400 max-h-64 overflow-y-auto">
              <div v-for="(log, i) in initLogs" :key="i" class="py-0.5">{{ log }}</div>
              <div v-if="initStatus === 'running'" class="flex items-center gap-2 py-0.5">
                <Loader2 class="w-3 h-3 animate-spin" />
                Working...
              </div>
            </div>

            <div v-if="initStatus === 'success'" class="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <CheckCircle2 class="w-5 h-5 text-green-600 dark:text-green-400" />
              <p class="text-sm font-medium text-green-700 dark:text-green-300">Storage cluster initialized successfully!</p>
            </div>

            <div v-if="initStatus === 'error'" class="flex items-center gap-3">
              <button
                @click="initializeCluster"
                class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium"
              >
                <RefreshCw class="w-4 h-4" />
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 5: Migrate -->
      <div v-if="currentStep === 5" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Migrate Existing Data</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Move your existing volumes, uploads, and backups to the new storage system.</p>
        </div>
        <div class="p-6">
          <div v-if="!hasMigratableData" class="flex items-center gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <CheckCircle2 class="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <p class="text-sm text-blue-700 dark:text-blue-300">No existing data to migrate. You can skip this step.</p>
          </div>

          <div v-else>
            <div v-if="migrationStatus === 'idle'" class="space-y-4">
              <div class="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                <p class="text-sm text-yellow-700 dark:text-yellow-300">
                  Services will continue running during migration. A brief switchover happens at the end when the active provider is changed.
                </p>
              </div>
              <button
                @click="startMigration"
                class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium"
              >
                Start Migration
              </button>
            </div>

            <div v-if="migrationStatus === 'running'" class="space-y-4">
              <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                <div class="bg-primary-600 h-3 rounded-full transition-all" :style="{ width: migrationProgress + '%' }"></div>
              </div>
              <p class="text-sm text-gray-500 dark:text-gray-400">{{ migrationProgress }}% — {{ migrationItem }}</p>
            </div>

            <div v-if="migrationStatus === 'complete'" class="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <CheckCircle2 class="w-5 h-5 text-green-600 dark:text-green-400" />
              <p class="text-sm font-medium text-green-700 dark:text-green-300">Migration complete!</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 6: Verify -->
      <div v-if="currentStep === 6" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="p-12 text-center">
          <CheckCircle2 class="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Storage Configured!</h2>
          <p class="text-gray-500 dark:text-gray-400 text-sm max-w-md mx-auto mb-6">
            Your storage system is ready. All volumes and objects will now use the {{ selectedMode === 'distributed' ? 'distributed cluster' : 'local filesystem' }}.
          </p>

          <div v-if="verifyHealth" class="inline-flex flex-col items-start gap-2 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-6 py-4 mb-4">
            <div><span class="font-medium text-gray-900 dark:text-white">Volume Provider:</span> {{ verifyHealth?.cluster?.provider ?? 'local' }}</div>
            <div><span class="font-medium text-gray-900 dark:text-white">Object Provider:</span> {{ verifyHealth?.cluster?.objectProvider ?? 'local' }}</div>
            <div><span class="font-medium text-gray-900 dark:text-white">Replication:</span> {{ verifyHealth?.cluster?.replicationFactor ?? 1 }}x</div>
            <div>
              <span class="font-medium text-gray-900 dark:text-white">Status:</span>
              <span :class="verifyHealth?.cluster?.status === 'healthy' ? 'text-green-600' : 'text-yellow-600'" class="ml-1 capitalize">
                {{ verifyHealth?.cluster?.status ?? 'unknown' }}
              </span>
            </div>
            <div v-if="verifyHealth?.nodes?.length"><span class="font-medium text-gray-900 dark:text-white">Nodes:</span> {{ verifyHealth.nodes.length }}</div>
          </div>
        </div>
      </div>

      <!-- Navigation -->
      <div class="flex items-center justify-between mt-6">
        <button
          v-if="currentStep > 1"
          @click="prevStep"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
        >
          <ArrowLeft class="w-4 h-4" />
          Back
        </button>
        <div v-else></div>

        <button
          @click="nextStep"
          :disabled="!canProceed"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          <template v-if="currentStep === 6">
            Finish
            <CheckCircle2 class="w-4 h-4" />
          </template>
          <template v-else-if="currentStep === 4 && initStatus === 'idle'">
            Initialize
          </template>
          <template v-else>
            Next
            <ArrowRight class="w-4 h-4" />
          </template>
        </button>
      </div>
    </template>

    <!-- ═══ MIGRATION WIZARD MODAL ═══ -->
    <template v-if="showMigrationWizard">
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div class="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
          <!-- Modal Header -->
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800 rounded-t-2xl z-10">
            <div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Migrate Storage Provider</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Move all data between storage providers with zero downtime.
              </p>
            </div>
            <button
              @click="closeMigrationWizard"
              class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <div class="p-6">
            <!-- Step indicators -->
            <div class="flex items-center gap-2 mb-6">
              <template v-for="s in 4" :key="s">
                <div
                  :class="[
                    'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors',
                    migrationWizardStep >= s
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  ]"
                >
                  {{ s }}
                </div>
                <div
                  v-if="s < 4"
                  :class="['flex-1 h-0.5', migrationWizardStep > s ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-700']"
                ></div>
              </template>
            </div>

            <!-- Error -->
            <div v-if="error" class="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
            </div>

            <!-- Step 1: Choose target providers -->
            <div v-if="migrationWizardStep === 1" class="space-y-6">
              <div>
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Current configuration: <span class="font-medium text-gray-900 dark:text-white">{{ clusterData?.cluster?.provider ?? 'local' }}</span> volumes,
                  <span class="font-medium text-gray-900 dark:text-white">{{ clusterData?.cluster?.objectProvider ?? 'local' }}</span> objects.
                  Select the target providers below.
                </p>
              </div>

              <!-- Target Volume Provider -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Target Volume Provider</label>
                <div class="grid grid-cols-3 gap-3">
                  <button
                    v-for="vp in (['local', 'glusterfs', 'ceph'] as const)"
                    :key="vp"
                    @click="migrationTargetVolume = vp"
                    :disabled="vp === clusterData?.cluster?.provider"
                    :class="[
                      'p-3 rounded-lg border-2 text-left text-sm transition-all',
                      migrationTargetVolume === vp
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : vp === clusterData?.cluster?.provider
                          ? 'border-gray-200 dark:border-gray-700 opacity-40 cursor-not-allowed'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    ]"
                  >
                    <p class="font-semibold text-gray-900 dark:text-white capitalize">{{ vp === 'glusterfs' ? 'GlusterFS' : vp === 'ceph' ? 'Ceph RBD' : 'Local' }}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {{ vp === 'local' ? 'Single node NFS' : vp === 'glusterfs' ? 'Distributed replicated' : 'Enterprise block storage' }}
                    </p>
                    <span v-if="vp === clusterData?.cluster?.provider" class="text-xs text-gray-400 italic">Current</span>
                  </button>
                </div>
              </div>

              <!-- Target Object Provider -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Target Object Provider</label>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <button
                    v-for="op in (['local', 'minio', 's3', 'gcs'] as const)"
                    :key="op"
                    @click="migrationTargetObject = op"
                    :disabled="op === clusterData?.cluster?.objectProvider"
                    :class="[
                      'p-3 rounded-lg border-2 text-left text-sm transition-all',
                      migrationTargetObject === op
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : op === clusterData?.cluster?.objectProvider
                          ? 'border-gray-200 dark:border-gray-700 opacity-40 cursor-not-allowed'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    ]"
                  >
                    <p class="font-semibold text-gray-900 dark:text-white">{{ op === 'local' ? 'Local' : op === 'minio' ? 'MinIO' : op === 's3' ? 'AWS S3' : 'GCS' }}</p>
                    <span v-if="op === clusterData?.cluster?.objectProvider" class="text-xs text-gray-400 italic">Current</span>
                  </button>
                </div>
              </div>

              <div class="flex justify-end">
                <button
                  @click="migrationWizardStep = 2"
                  :disabled="migrationTargetVolume === clusterData?.cluster?.provider && migrationTargetObject === clusterData?.cluster?.objectProvider"
                  class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                >
                  Next
                  <ArrowRight class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Step 2: Confirm -->
            <div v-if="migrationWizardStep === 2" class="space-y-6">
              <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">Migration Summary</h3>
                <div class="space-y-2 text-sm">
                  <div class="flex items-center justify-between">
                    <span class="text-gray-500 dark:text-gray-400">Volume Provider</span>
                    <span class="text-gray-900 dark:text-white">
                      <span class="capitalize">{{ clusterData?.cluster?.provider ?? 'local' }}</span>
                      <ArrowRight class="w-3 h-3 inline mx-1" />
                      <span class="font-semibold capitalize">{{ migrationTargetVolume === 'glusterfs' ? 'GlusterFS' : migrationTargetVolume === 'ceph' ? 'Ceph RBD' : 'Local' }}</span>
                    </span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-gray-500 dark:text-gray-400">Object Provider</span>
                    <span class="text-gray-900 dark:text-white">
                      <span class="capitalize">{{ clusterData?.cluster?.objectProvider ?? 'local' }}</span>
                      <ArrowRight class="w-3 h-3 inline mx-1" />
                      <span class="font-semibold">{{ migrationTargetObject === 'local' ? 'Local' : migrationTargetObject === 'minio' ? 'MinIO' : migrationTargetObject === 's3' ? 'AWS S3' : 'GCS' }}</span>
                    </span>
                  </div>
                </div>
              </div>

              <div class="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                <div class="flex gap-3">
                  <AlertTriangle class="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
                  <div class="text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
                    <p class="font-medium">Before you proceed:</p>
                    <ul class="list-disc pl-4 space-y-0.5">
                      <li>Services will remain online during migration</li>
                      <li>A brief switchover occurs when data is fully copied</li>
                      <li>You can pause and resume the migration at any time</li>
                      <li>Rollback is available if anything goes wrong</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div class="flex items-center justify-between">
                <button
                  @click="migrationWizardStep = 1"
                  class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors"
                >
                  <ArrowLeft class="w-4 h-4" />
                  Back
                </button>
                <button
                  @click="startProviderMigration"
                  class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
                >
                  <RefreshCw class="w-4 h-4" />
                  Start Migration
                </button>
              </div>
            </div>

            <!-- Step 3: Progress -->
            <div v-if="migrationWizardStep === 3" class="space-y-6">
              <!-- Progress bar -->
              <div>
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {{ migrationStatus === 'running' ? 'Migrating...' : migrationStatus === 'idle' ? 'Paused' : 'Complete' }}
                  </span>
                  <span class="text-sm font-semibold text-gray-900 dark:text-white">{{ migrationProgress }}%</span>
                </div>
                <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                  <div
                    class="h-3 rounded-full transition-all duration-500"
                    :class="migrationStatus === 'running' ? 'bg-primary-600' : 'bg-yellow-500'"
                    :style="{ width: migrationProgress + '%' }"
                  ></div>
                </div>
                <p v-if="migrationItem" class="text-xs text-gray-500 dark:text-gray-400 mt-2">{{ migrationItem }}</p>
              </div>

              <!-- Live log -->
              <div v-if="migrationLog" class="bg-gray-900 rounded-lg p-4 font-mono text-xs text-green-400 max-h-48 overflow-y-auto whitespace-pre-wrap">{{ migrationLog }}</div>

              <!-- Controls -->
              <div class="flex items-center gap-3">
                <button
                  v-if="migrationStatus === 'running'"
                  @click="pauseActiveMigration"
                  class="flex items-center gap-2 px-4 py-2 rounded-lg border border-yellow-300 dark:border-yellow-600 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 text-sm font-medium transition-colors"
                >
                  Pause
                </button>
                <button
                  v-if="migrationStatus === 'idle' && activeMigrationId"
                  @click="resumeActiveMigration"
                  class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
                >
                  Resume
                </button>
                <button
                  v-if="activeMigrationId && migrationStatus !== 'complete'"
                  @click="rollbackActiveMigration"
                  class="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors"
                >
                  Rollback
                </button>
              </div>
            </div>

            <!-- Step 4: Complete -->
            <div v-if="migrationWizardStep === 4" class="text-center py-6 space-y-4">
              <CheckCircle2 class="w-14 h-14 text-green-500 mx-auto" />
              <h3 class="text-xl font-bold text-gray-900 dark:text-white">Migration Complete</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                All data has been migrated to the new providers. The storage system is now using
                <span class="font-semibold text-gray-900 dark:text-white capitalize">{{ migrationTargetVolume === 'glusterfs' ? 'GlusterFS' : migrationTargetVolume === 'ceph' ? 'Ceph RBD' : 'Local' }}</span> for volumes and
                <span class="font-semibold text-gray-900 dark:text-white">{{ migrationTargetObject === 'local' ? 'Local' : migrationTargetObject === 'minio' ? 'MinIO' : migrationTargetObject === 's3' ? 'AWS S3' : 'GCS' }}</span> for objects.
              </p>

              <div class="flex items-center justify-center gap-3 pt-2">
                <button
                  @click="rollbackActiveMigration"
                  class="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors"
                >
                  Rollback
                </button>
                <button
                  @click="closeMigrationWizard"
                  class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
                >
                  <CheckCircle2 class="w-4 h-4" />
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
