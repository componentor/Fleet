<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApi } from '@/composables/useApi'
import {
  HardDrive, Server, Shield, CheckCircle2, ArrowRight, ArrowLeft,
  Loader2, Plus, Trash2, RefreshCw, AlertTriangle, Database,
  Cloud, Monitor, Settings, Activity, BookOpen, ChevronDown,
  ChevronUp, Lock, Network, Terminal, Wifi, WifiOff, Cpu,
  MapPin, Globe,
} from 'lucide-vue-next'

const { t } = useI18n()
const api = useApi()

// ── State ────────────────────────────────────────────────────────────────

const loading = ref(false)
const error = ref('')
const success = ref('')

// Cluster state (loaded on mount)
const clusterData = ref<any>(null)
const isConfigured = ref(false)

// Multi-cluster state
const clusters = ref<any[]>([])
const locations = ref<{ locationKey: string; label: string }[]>([])

// Wizard cluster identity fields
const clusterName = ref('')
const clusterScope = ref<'regional' | 'global'>('regional')
const clusterRegion = ref<string | null>(null)
const clusterAllowServices = ref(true)
const clusterAllowBackups = ref(true)
const editingClusterId = ref<string | null>(null) // non-null = editing existing cluster

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
const showPickNode = ref(false)
const showSetupGuide = ref(false)
const swarmNodes = ref<any[]>([])
const loadingSwarmNodes = ref(false)

// Probe diagnostics per node ID
interface ProbeResult {
  loading: boolean
  ports: { port: number; service: string; open: boolean; latencyMs: number | null }[]
  metrics: { cpuCount: number | null; memTotal: number | null; memFree: number | null; diskTotal: number | null; diskUsed: number | null; diskFree: number | null; diskType: string | null; containerCount: number | null }
  recommendations: { suitableForStorage: boolean; diskSpaceAdequate: boolean; nfsPorts: boolean; glusterfsPorts: boolean; suggestedRole: string }
  error: string
}
const probeResults = ref<Record<string, ProbeResult>>({})
const newNode = ref<StorageNode>({
  hostname: '',
  ipAddress: '',
  role: 'storage',
  storagePathRoot: '/srv/fleet-storage',
  capacityGb: null,
  testStatus: 'pending',
  testMessage: '',
})

// Install prerequisites
const installingPrereqs = ref(false)
const prereqInstallResult = ref<any>(null)

async function installPrerequisites() {
  installingPrereqs.value = true
  prereqInstallResult.value = null
  try {
    const result = await api.post('/admin/storage/prerequisites/install', {})
    prereqInstallResult.value = result
  } catch (err: any) {
    prereqInstallResult.value = { success: false, error: err?.body?.error || 'Failed to install dependencies' }
  } finally {
    installingPrereqs.value = false
  }
}

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

// ── Danger Zone ─────────────────────────────────────────────────────────
const showResetConfirm = ref(false)
const resetPassword = ref('')
const resetting = ref(false)
const detachingNodeId = ref<string | null>(null)
const detachPassword = ref('')
const detaching = ref(false)
const showAttachNode = ref(false)
const attachNode = ref<StorageNode>({
  hostname: '',
  ipAddress: '',
  role: 'storage',
  storagePathRoot: '/srv/fleet-storage',
  capacityGb: null,
  testStatus: 'pending',
  testMessage: '',
})
const attaching = ref(false)

// ── Computed ─────────────────────────────────────────────────────────────

/** Hostnames and IPs already registered as storage nodes */
const attachedHostnames = computed(() => new Set((clusterData.value?.nodes ?? []).map((n: any) => n.hostname)))
const attachedIps = computed(() => new Set((clusterData.value?.nodes ?? []).map((n: any) => n.ipAddress)))

function isNodeAttached(sn: any): boolean {
  return attachedHostnames.value.has(sn.hostname) || attachedIps.value.has(sn.ipAddress)
}

const steps = computed(() => [
  { number: 1, label: t('storageSetup.stepChooseMode'), icon: Monitor },
  { number: 2, label: t('storageSetup.stepStorageNodes'), icon: Server },
  { number: 3, label: t('storageSetup.stepConfigure'), icon: Settings },
  { number: 4, label: t('storageSetup.stepInitialize'), icon: Database },
  { number: 5, label: t('storageSetup.stepMigrateData'), icon: HardDrive },
  { number: 6, label: t('storageSetup.stepVerify'), icon: CheckCircle2 },
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
  await Promise.all([loadCluster(), fetchSwarmNodes(), fetchLocations()])
})

// ── API ──────────────────────────────────────────────────────────────────

async function loadCluster() {
  loading.value = true
  try {
    clusterData.value = await api.get('/admin/storage/cluster')
    isConfigured.value = !!clusterData.value?.cluster?.id
    clusters.value = clusterData.value?.clusters ?? []
    if (isConfigured.value && clusterData.value.cluster.status !== 'inactive') {
      showWizard.value = false
    }
  } catch {
    // Not configured yet
    clusterData.value = null
    isConfigured.value = false
    clusters.value = []
  } finally {
    loading.value = false
  }
}

async function toggleCapability(clusterId: string, field: 'allowServices' | 'allowBackups', currentValue: boolean) {
  try {
    await api.patch(`/admin/storage/clusters/${clusterId}/capabilities`, {
      [field]: !currentValue,
    })
    // Update local state immediately
    const cl = clusters.value.find((c: any) => c.id === clusterId)
    if (cl) cl[field] = !currentValue
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to update capability'
  }
}

async function fetchLocations() {
  try {
    locations.value = await api.get<any[]>('/billing/admin/locations') as any[] ?? []
  } catch {
    locations.value = []
  }
}

function startWizard(existingCluster?: any) {
  showWizard.value = true
  currentStep.value = 1
  error.value = ''
  success.value = ''

  if (existingCluster) {
    editingClusterId.value = existingCluster.id
    clusterName.value = existingCluster.name ?? ''
    clusterScope.value = existingCluster.scope ?? 'regional'
    clusterRegion.value = existingCluster.region ?? null
    selectedMode.value = existingCluster.provider === 'local' ? 'local' : 'distributed'
    if (existingCluster.provider !== 'local') {
      selectedVolumeProvider.value = existingCluster.provider as any
    }
    if (existingCluster.objectProvider !== 'local') {
      selectedObjectProvider.value = existingCluster.objectProvider as any
    }
    replicationFactor.value = existingCluster.replicationFactor ?? 3
    clusterAllowServices.value = existingCluster.allowServices ?? true
    clusterAllowBackups.value = existingCluster.allowBackups ?? true
  } else {
    editingClusterId.value = null
    clusterName.value = ''
    clusterScope.value = 'regional'
    clusterRegion.value = null
    clusterAllowServices.value = true
    clusterAllowBackups.value = true
  }
}

async function fetchSwarmNodes() {
  loadingSwarmNodes.value = true
  try {
    swarmNodes.value = await api.get<any[]>('/nodes')
    // Auto-probe all swarm nodes for diagnostics
    for (const sn of swarmNodes.value) {
      if (sn.id) probeNode(sn.id)
    }
  } catch {
    swarmNodes.value = []
  } finally {
    loadingSwarmNodes.value = false
  }
}

// Swarm nodes not yet added as storage nodes
const availableSwarmNodes = computed(() => {
  const usedHostnames = new Set(storageNodes.value.map(n => n.hostname))
  const usedIps = new Set(storageNodes.value.map(n => n.ipAddress))
  return swarmNodes.value.filter(n => !usedHostnames.has(n.hostname) && !usedIps.has(n.ipAddress))
})

function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let val = bytes
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
  return `${val.toFixed(1)} ${units[i]}`
}

async function probeNode(nodeId: string) {
  const existing = probeResults.value[nodeId]
  if (existing?.loading) return
  probeResults.value[nodeId] = {
    loading: true,
    ports: existing?.ports ?? [],
    metrics: existing?.metrics ?? { cpuCount: null, memTotal: null, memFree: null, diskTotal: null, diskUsed: null, diskFree: null, diskType: null, containerCount: null },
    recommendations: existing?.recommendations ?? { suitableForStorage: false, diskSpaceAdequate: false, nfsPorts: false, glusterfsPorts: false, suggestedRole: 'storage' },
    error: '',
  }
  try {
    const result = await api.post(`/nodes/${nodeId}/probe`, {}) as any
    probeResults.value[nodeId] = {
      loading: false,
      ports: result.ports ?? [],
      metrics: result.metrics ?? {},
      recommendations: result.recommendations ?? {},
      error: '',
    }
  } catch (err: any) {
    probeResults.value[nodeId] = {
      ...probeResults.value[nodeId]!,
      loading: false,
      error: err?.body?.error || t('storageSetup.probeFailed'),
    }
  }
}

function pickSwarmNode(swarmNode: any) {
  const probe = probeResults.value[swarmNode.id]
  const diskTotalGb = probe?.metrics?.diskTotal ? Math.round(probe.metrics.diskTotal / (1024 * 1024 * 1024)) : null
  const suggestedRole = probe?.recommendations?.suggestedRole ?? 'storage+compute'
  storageNodes.value.push({
    hostname: swarmNode.hostname ?? 'unknown',
    ipAddress: swarmNode.ipAddress ?? '0.0.0.0',
    role: suggestedRole as StorageNode['role'],
    storagePathRoot: '/srv/fleet-storage',
    capacityGb: diskTotalGb,
    testStatus: 'pending',
    testMessage: '',
  })
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
  node.testMessage = t('storageSetup.testingConnectivity')

  // Find the swarm node ID by matching hostname/IP
  const swarmNode = swarmNodes.value.find(sn => sn.hostname === node.hostname || sn.ipAddress === node.ipAddress)
  if (!swarmNode?.id) {
    // Fall back to generic test
    try {
      await api.post('/admin/storage/cluster/test', {}) as any
      node.testStatus = 'ok'
      node.testMessage = t('storageSetup.connected')
    } catch (err: any) {
      node.testStatus = 'error'
      node.testMessage = err?.body?.error || t('storageSetup.connectionFailed')
    }
    return
  }

  try {
    const result = await api.post(`/nodes/${swarmNode.id}/probe`, {}) as any
    const allPorts = result.ports ?? []
    const openPorts = allPorts.filter((p: any) => p.open)
    const closedRequired = allPorts.filter((p: any) => !p.open && p.required)
    const closedOptional = allPorts.filter((p: any) => !p.open && !p.required)

    // Update probe results cache
    probeResults.value[swarmNode.id] = {
      loading: false,
      ports: allPorts,
      metrics: result.metrics ?? {},
      recommendations: result.recommendations ?? {},
      error: '',
    }

    // Auto-fill capacity from probe
    if (result.metrics?.diskTotal && !node.capacityGb) {
      node.capacityGb = Math.round(result.metrics.diskTotal / (1024 * 1024 * 1024))
    }

    if (closedRequired.length === 0) {
      node.testStatus = 'ok'
      node.testMessage = closedOptional.length > 0
        ? t('storageSetup.readyAutoConfigPending', { auto: closedOptional.length })
        : t('storageSetup.allPortsOpen', { count: openPorts.length })
    } else {
      node.testStatus = 'error'
      node.testMessage = t('storageSetup.requiredPortsClosed', { count: closedRequired.length, ports: closedRequired.map((p: any) => `${p.port} ${p.service}`).join(', ') })
    }
  } catch (err: any) {
    node.testStatus = 'error'
    node.testMessage = err?.body?.error || t('storageSetup.connectionFailed')
  }
}

async function initializeCluster() {
  initStatus.value = 'running'
  initLogs.value = []
  error.value = ''

  const isDistributed = selectedMode.value === 'distributed'

  try {
    // Configure cluster first (so we get the clusterId for node registration)
    initLogs.value.push(t('storageSetup.configuringCluster'))

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
      name: clusterName.value || undefined,
      region: clusterRegion.value || null,
      scope: clusterScope.value,
      provider: volumeProvider,
      objectProvider,
      replicationFactor: isDistributed ? replicationFactor.value : 1,
      config: volumeConfig,
      objectConfig,
      allowServices: clusterAllowServices.value,
      allowBackups: clusterAllowBackups.value,
    }

    const result = await api.post('/admin/storage/cluster', clusterConfig) as any
    const newClusterId = result.clusterId

    // Register nodes with the cluster
    if (isDistributed && storageNodes.value.length > 0) {
      initLogs.value.push(t('storageSetup.registeringNodes'))
      for (const node of storageNodes.value) {
        await api.post('/admin/storage/nodes', {
          clusterId: newClusterId,
          hostname: node.hostname,
          ipAddress: node.ipAddress,
          role: node.role,
          storagePathRoot: node.storagePathRoot,
          capacityGb: node.capacityGb,
        })
        initLogs.value.push(`  + ${node.hostname} (${node.ipAddress})`)
      }
    }

    // Show prerequisite installation results
    if (result.prerequisites) {
      const pkgs = result.prerequisites.packages?.join(', ') || ''
      if (result.prerequisites.installed) {
        initLogs.value.push(`Installed prerequisites on all nodes: ${pkgs}`)
      } else {
        initLogs.value.push(`WARNING: Some nodes failed prerequisite installation (${pkgs}). Check node logs.`)
      }
    }

    initLogs.value.push(t('storageSetup.clusterStatusLog', { status: result.status }))

    if (result.status === 'healthy') {
      initLogs.value.push(t('storageSetup.initSuccess'))
      initStatus.value = 'success'
    } else {
      initLogs.value.push(t('storageSetup.clusterStatusWarning', { status: result.status }))
      initStatus.value = 'error'
      error.value = result.error || t('storageSetup.initNonHealthy')
    }
  } catch (err: any) {
    initStatus.value = 'error'
    error.value = err?.body?.error || t('storageSetup.initFailed')
    initLogs.value.push(`ERROR: ${error.value}`)
  }
}

async function startMigration() {
  migrationStatus.value = 'running'
  migrationProgress.value = 0
  migrationItem.value = t('storageSetup.startingMigration')

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
          error.value = t('storageSetup.migrationFailed') + ': ' + (status.log || t('storageSetup.unknownError'))
        }
      } catch {
        clearInterval(interval)
        migrationStatus.value = 'idle'
        error.value = t('storageSetup.migrationStatusCheckFailed')
      }
    }, 2000)
  } catch (err: any) {
    migrationStatus.value = 'idle'
    error.value = err?.body?.error || t('storageSetup.startMigrationFailed')
  }
}

async function verifyCluster() {
  try {
    verifyHealth.value = await api.get('/admin/storage/health')
  } catch (err: any) {
    error.value = err?.body?.error || t('storageSetup.verifyFailed')
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
          error.value = t('storageSetup.migrationFailedCheckLog')
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
    error.value = err?.body?.error || t('storageSetup.startMigrationFailed')
  }
}

async function pauseActiveMigration() {
  if (!activeMigrationId.value) return
  try {
    await api.post(`/admin/storage/migrate/${activeMigrationId.value}/pause`, {})
    migrationStatus.value = 'idle'
    migrationItem.value = t('storageSetup.paused')
  } catch (err: any) {
    error.value = err?.body?.error || t('storageSetup.pauseFailed')
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
    error.value = err?.body?.error || t('storageSetup.resumeFailed')
  }
}

async function rollbackActiveMigration() {
  if (!activeMigrationId.value) return
  try {
    await api.post(`/admin/storage/migrate/${activeMigrationId.value}/rollback`, {})
    success.value = t('storageSetup.rollbackSuccess')
    closeMigrationWizard()
  } catch (err: any) {
    error.value = err?.body?.error || t('storageSetup.rollbackFailed')
  }
}

// ── Repair Services ──────────────────────────────────────────────────────

const repairLoading = ref(false)
const repairResult = ref<{ repaired: string[]; failed: { name: string; error: string }[] } | null>(null)

async function repairServices() {
  repairLoading.value = true
  repairResult.value = null
  error.value = ''
  try {
    const result = await api.post('/admin/storage/repair-services', {}) as any
    repairResult.value = { repaired: result.repaired || [], failed: result.failed || [] }
    if (result.repaired?.length) {
      success.value = `Repaired ${result.repaired.length} service(s)`
    } else {
      success.value = 'All services are already using the correct volume driver'
    }
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to repair services'
  } finally {
    repairLoading.value = false
  }
}

// ── Danger Zone ─────────────────────────────────────────────────────────

function toggleAttachForm() {
  showAttachNode.value = !showAttachNode.value
  if (showAttachNode.value) {
    fetchSwarmNodes()
  }
}

function pickSwarmNodeForAttach(sn: any) {
  attachNode.value.hostname = sn.hostname
  attachNode.value.ipAddress = sn.ipAddress
  attachNode.value.role = 'storage'
}

async function resetAllNodes() {
  if (!resetPassword.value) return
  resetting.value = true
  error.value = ''
  try {
    await api.post('/admin/storage/nodes/reset', { password: resetPassword.value })
    success.value = t('storageSetup.resetSuccess')
    showResetConfirm.value = false
    resetPassword.value = ''
    await loadCluster()
  } catch (err: any) {
    error.value = err?.body?.error || t('storageSetup.resetFailed')
  } finally {
    resetting.value = false
  }
}

async function detachNode(nodeId: string) {
  if (!detachPassword.value) return
  detaching.value = true
  error.value = ''
  try {
    await api.post(`/admin/storage/nodes/${nodeId}/detach`, { password: detachPassword.value })
    success.value = t('storageSetup.detachSuccess')
    detachingNodeId.value = null
    detachPassword.value = ''
    await loadCluster()
  } catch (err: any) {
    error.value = err?.body?.error || t('storageSetup.detachFailed')
  } finally {
    detaching.value = false
  }
}

async function attachNewNode() {
  if (!attachNode.value.hostname || !attachNode.value.ipAddress) return
  attaching.value = true
  error.value = ''
  try {
    await api.post('/admin/storage/nodes', {
      hostname: attachNode.value.hostname,
      ipAddress: attachNode.value.ipAddress,
      role: attachNode.value.role,
      storagePathRoot: attachNode.value.storagePathRoot,
      capacityGb: attachNode.value.capacityGb,
    })
    success.value = t('storageSetup.attachSuccess')
    showAttachNode.value = false
    attachNode.value = { hostname: '', ipAddress: '', role: 'storage', storagePathRoot: '/srv/fleet-storage', capacityGb: null, testStatus: 'pending', testMessage: '' }
    await loadCluster()
  } catch (err: any) {
    error.value = err?.body?.error || t('storageSetup.attachFailed')
  } finally {
    attaching.value = false
  }
}
</script>

<template>
  <div>
    <!-- Page Header -->
    <div class="flex flex-wrap items-center justify-between gap-y-3 mb-8">
      <div class="flex items-center gap-3">
        <HardDrive class="w-7 h-7 text-primary-600 dark:text-primary-400" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('storageSetup.title') }}</h1>
      </div>
      <div v-if="!showWizard && !showMigrationWizard" class="flex items-center gap-3">
        <button
          v-if="isConfigured"
          @click="openMigrationWizard"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium transition-colors"
        >
          <RefreshCw class="w-4 h-4" />
          {{ t('storageSetup.migrateStorage') }}
        </button>
        <button
          v-if="isConfigured"
          @click="startWizard()"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium transition-colors"
        >
          <Plus class="w-4 h-4" />
          Add Cluster
        </button>
        <button
          @click="startWizard()"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Settings class="w-4 h-4" />
          {{ isConfigured ? t('storageSetup.reconfigureStorage') : t('storageSetup.configureStorage') }}
        </button>
      </div>
    </div>

    <!-- Current Status (when not in wizard mode) -->
    <template v-if="!showWizard && !loading">

      <!-- Multi-Cluster List -->
      <div v-if="clusters.length > 1" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Storage Clusters</h2>
          <button
            @click="startWizard()"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors"
          >
            <Plus class="w-3.5 h-3.5" />
            Add Cluster
          </button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Scope</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Region</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Provider</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Object Storage</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Nodes</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Capabilities</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th class="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr v-for="cl in clusters" :key="cl.id" class="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{{ cl.name ?? 'default' }}</td>
                <td class="px-6 py-4">
                  <span
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                    :class="cl.scope === 'global'
                      ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                      : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'"
                  >
                    <component :is="cl.scope === 'global' ? Globe : MapPin" class="w-3 h-3" />
                    {{ cl.scope }}
                  </span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{{ cl.region ?? 'All regions' }}</td>
                <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 capitalize">{{ cl.provider }}</td>
                <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 capitalize">{{ cl.objectProvider }}</td>
                <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{{ cl.storageNodes?.length ?? 0 }}</td>
                <td class="px-6 py-4">
                  <div class="flex flex-wrap gap-1">
                    <button
                      @click="toggleCapability(cl.id, 'allowServices', cl.allowServices !== false)"
                      class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors"
                      :class="cl.allowServices !== false
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                        : 'bg-gray-100 dark:bg-gray-700/50 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 line-through'"
                      :title="cl.allowServices !== false ? 'Click to disable services' : 'Click to enable services'"
                    >
                      Services
                    </button>
                    <button
                      @click="toggleCapability(cl.id, 'allowBackups', cl.allowBackups !== false)"
                      class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors"
                      :class="cl.allowBackups !== false
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50'
                        : 'bg-gray-100 dark:bg-gray-700/50 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 line-through'"
                      :title="cl.allowBackups !== false ? 'Click to disable backups' : 'Click to enable backups'"
                    >
                      Backups
                    </button>
                  </div>
                </td>
                <td class="px-6 py-4">
                  <span
                    class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                    :class="cl.status === 'healthy' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'"
                  >
                    {{ cl.status }}
                  </span>
                </td>
                <td class="px-6 py-4 text-right">
                  <button
                    @click="startWizard(cl)"
                    class="text-xs text-primary-600 dark:text-primary-400 hover:underline font-medium"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Cluster Overview -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <div class="flex items-center gap-3 mb-3">
            <Database class="w-5 h-5 text-primary-600 dark:text-primary-400" />
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ t('storageSetup.volumeProvider') }}</h3>
          </div>
          <p class="text-lg font-semibold text-gray-900 dark:text-white capitalize">
            {{ clusterData?.cluster?.provider ?? 'local' }}
          </p>
        </div>

        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <div class="flex items-center gap-3 mb-3">
            <Cloud class="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ t('storageSetup.objectProvider') }}</h3>
          </div>
          <p class="text-lg font-semibold text-gray-900 dark:text-white capitalize">
            {{ clusterData?.cluster?.objectProvider ?? 'local' }}
          </p>
        </div>

        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <div class="flex items-center gap-3 mb-3">
            <Network class="w-5 h-5" :class="clusterData?.platformVolumeMode === 'distributed' ? 'text-green-600 dark:text-green-400' : 'text-gray-400'" />
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Manager Storage</h3>
          </div>
          <p class="text-lg font-semibold capitalize" :class="clusterData?.platformVolumeMode === 'distributed' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'">
            {{ clusterData?.platformVolumeMode === 'distributed' ? 'Global' : 'Local' }}
          </p>
          <p v-if="clusterData?.cluster?.provider !== 'local' && clusterData?.platformVolumeMode !== 'distributed'" class="text-xs text-yellow-600 mt-1">
            Platform volumes not yet migrated
          </p>
        </div>

        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <div class="flex items-center gap-3 mb-3">
            <Activity class="w-5 h-5" :class="clusterData?.cluster?.status === 'healthy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'" />
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ t('storageSetup.status') }}</h3>
          </div>
          <p class="text-lg font-semibold capitalize" :class="clusterData?.cluster?.status === 'healthy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
            {{ clusterData?.cluster?.status ?? t('storageSetup.notConfigured') }}
          </p>
        </div>
      </div>

      <!-- Replication Info -->
      <div v-if="clusterData?.cluster?.replicationFactor > 1" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('storageSetup.replication') }}</h2>
        </div>
        <div class="p-6">
          <div class="flex items-center gap-4">
            <Shield class="w-8 h-8 text-green-600 dark:text-green-400" />
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white">
                {{ t('storageSetup.replicationActive', { factor: clusterData.cluster.replicationFactor }) }}
              </p>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ t('storageSetup.replicationDesc', { factor: clusterData.cluster.replicationFactor, failCount: clusterData.cluster.replicationFactor - 1 }) }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Storage Nodes -->
      <div v-if="clusterData?.nodes?.length" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('storageSetup.storageNodes') }}</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('storageSetup.hostname') }}</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('storageSetup.ip') }}</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('storageSetup.role') }}</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('storageSetup.status') }}</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('storageSetup.capacity') }}</th>
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

      <!-- Attach Node (visible when storage is configured) -->
      <div v-if="isConfigured" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 rounded-t-xl flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('storageSetup.attachNodeTitle') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{{ t('storageSetup.attachNodeDesc') }}</p>
          </div>
          <button
            @click="toggleAttachForm"
            class="shrink-0 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
          >
            <Plus class="w-4 h-4 inline -mt-0.5 mr-1" />
            {{ t('storageSetup.attachNode') }}
          </button>
        </div>

        <!-- Attach Node Form -->
        <div v-if="showAttachNode" class="p-6 space-y-4">

          <!-- Pick from existing swarm nodes -->
          <div v-if="swarmNodes.length || loadingSwarmNodes" class="space-y-2">
            <p class="text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('storageSetup.pickFromSwarm') }}</p>
            <div v-if="loadingSwarmNodes && !swarmNodes.length" class="flex items-center gap-2 py-3 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 class="w-4 h-4 animate-spin" />
              {{ t('storageSetup.loadingNodes') }}
            </div>
            <div v-else class="grid grid-cols-1 gap-2">
              <div
                v-for="sn in swarmNodes"
                :key="sn.id"
                class="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors"
                :class="isNodeAttached(sn)
                  ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 opacity-60'
                  : 'border-gray-200 dark:border-gray-700 hover:border-primary-400 dark:hover:border-primary-600 cursor-pointer hover:bg-primary-50 dark:hover:bg-primary-900/10'"
                @click="!isNodeAttached(sn) && pickSwarmNodeForAttach(sn)"
              >
                <Server class="w-4 h-4 text-gray-400 shrink-0" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ sn.hostname }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ sn.ipAddress }} &middot; {{ sn.role }}</p>
                </div>
                <span
                  v-if="isNodeAttached(sn)"
                  class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                >
                  {{ t('storageSetup.alreadyAttached') }}
                </span>
                <Plus v-else class="w-4 h-4 text-primary-500 shrink-0" />
              </div>
            </div>
          </div>

          <div v-if="swarmNodes.length" class="relative">
            <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-gray-200 dark:border-gray-700"></div></div>
            <div class="relative flex justify-center text-xs"><span class="bg-white dark:bg-gray-800 px-2 text-gray-500 dark:text-gray-400">{{ t('storageSetup.manualEntry') }}</span></div>
          </div>

          <!-- Manual form -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.hostname') }}</label>
              <input v-model="attachNode.hostname" type="text" placeholder="node-4" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.ipAddress') }}</label>
              <input v-model="attachNode.ipAddress" type="text" placeholder="10.0.1.4" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.role') }}</label>
              <select v-model="attachNode.role" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                <option value="storage">{{ t('storageSetup.roleStorageOnly') }}</option>
                <option value="storage+compute">{{ t('storageSetup.roleStorageCompute') }}</option>
                <option value="arbiter">{{ t('storageSetup.roleArbiter') }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.storagePath') }}</label>
              <input v-model="attachNode.storagePathRoot" type="text" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
            </div>
          </div>
          <div class="flex items-center gap-3">
            <button
              @click="attachNewNode"
              :disabled="attaching || !attachNode.hostname || !attachNode.ipAddress"
              class="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Loader2 v-if="attaching" class="w-4 h-4 animate-spin inline -mt-0.5 mr-1" />
              {{ attaching ? t('common.saving') : t('storageSetup.attachNode') }}
            </button>
            <button @click="showAttachNode = false" class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Maintenance (only when distributed storage is configured) -->
      <div v-if="isConfigured && clusterData?.cluster?.provider !== 'local'" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Maintenance</h2>
        </div>
        <div class="p-6 space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white">Repair Service Volume Mounts</p>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Update Docker services to use the correct volume driver configuration. Use this if services are stuck with "missing plugin" errors.
              </p>
            </div>
            <button
              @click="repairServices"
              :disabled="repairLoading"
              class="shrink-0 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Loader2 v-if="repairLoading" class="w-4 h-4 animate-spin inline -mt-0.5 mr-1" />
              {{ repairLoading ? 'Repairing...' : 'Repair Services' }}
            </button>
          </div>
          <div v-if="repairResult" class="text-sm">
            <div v-if="repairResult.repaired.length" class="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 mb-2">
              <p class="font-medium text-green-700 dark:text-green-400">Repaired {{ repairResult.repaired.length }} service(s):</p>
              <ul class="mt-1 text-green-600 dark:text-green-400/80">
                <li v-for="name in repairResult.repaired" :key="name">{{ name }}</li>
              </ul>
            </div>
            <div v-if="repairResult.failed.length" class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p class="font-medium text-red-700 dark:text-red-400">Failed ({{ repairResult.failed.length }}):</p>
              <ul class="mt-1 text-red-600 dark:text-red-400/80">
                <li v-for="f in repairResult.failed" :key="f.name">{{ f.name }}: {{ f.error }}</li>
              </ul>
            </div>
            <div v-if="!repairResult.repaired.length && !repairResult.failed.length" class="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600">
              <p class="text-gray-600 dark:text-gray-400">All services are already using the correct configuration.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Danger Zone (only when storage is configured and nodes exist) -->
      <div v-if="isConfigured || clusterData?.nodes?.length" class="bg-white dark:bg-gray-800 rounded-xl border border-red-300 dark:border-red-800 shadow-sm mb-8">
        <div class="px-6 py-4 border-b border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-t-xl">
          <h2 class="text-lg font-semibold text-red-700 dark:text-red-400">{{ t('storageSetup.dangerZone') }}</h2>
        </div>
        <div class="p-6 space-y-6">

          <!-- Detach Individual Node -->
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ t('storageSetup.detachNodeTitle') }}</p>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('storageSetup.detachNodeDesc') }}</p>
            </div>
          </div>

          <div v-if="clusterData?.nodes?.length" class="space-y-2">
            <div
              v-for="node in clusterData.nodes"
              :key="node.id"
              class="flex items-center justify-between px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
            >
              <div class="flex items-center gap-4">
                <Server class="w-4 h-4 text-gray-400" />
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">{{ node.hostname }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ node.ipAddress }} &middot; {{ node.role }}</p>
                </div>
              </div>
              <button
                @click="detachingNodeId = node.id; detachPassword = ''"
                class="px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-xs font-medium transition-colors"
              >
                {{ t('storageSetup.detach') }}
              </button>
            </div>
          </div>
          <p v-else class="text-sm text-gray-500 dark:text-gray-400">{{ t('storageSetup.noNodesToDetach') }}</p>

          <!-- Detach Confirmation Modal -->
          <div v-if="detachingNodeId" class="border border-red-200 dark:border-red-800 rounded-lg p-4 bg-red-50 dark:bg-red-900/20">
            <p class="text-sm font-medium text-red-700 dark:text-red-400 mb-2">
              {{ t('storageSetup.detachConfirmTitle', { hostname: clusterData?.nodes?.find((n: any) => n.id === detachingNodeId)?.hostname }) }}
            </p>
            <p class="text-sm text-red-600 dark:text-red-400/80 mb-3">{{ t('storageSetup.detachConfirmDesc') }}</p>
            <input
              v-model="detachPassword"
              type="password"
              :placeholder="t('settings.confirmPassword')"
              class="w-full px-3 py-2 rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm mb-3"
              @keydown.enter="detachNode(detachingNodeId!)"
            />
            <div class="flex items-center gap-3">
              <button
                @click="detachNode(detachingNodeId!)"
                :disabled="detaching || !detachPassword"
                class="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="detaching" class="w-4 h-4 animate-spin inline -mt-0.5 mr-1" />
                {{ detaching ? t('storageSetup.detaching') : t('storageSetup.confirmDetach') }}
              </button>
              <button @click="detachingNodeId = null; detachPassword = ''" class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                {{ t('common.cancel') }}
              </button>
            </div>
          </div>

          <hr class="border-gray-200 dark:border-gray-700" />

          <!-- Reset All Storage -->
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-red-700 dark:text-red-400">{{ t('storageSetup.resetAllTitle') }}</p>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('storageSetup.resetAllDesc') }}</p>
            </div>
            <button
              @click="showResetConfirm = !showResetConfirm; resetPassword = ''"
              class="shrink-0 px-4 py-2 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors"
            >
              {{ t('storageSetup.resetAll') }}
            </button>
          </div>

          <!-- Reset Confirmation -->
          <div v-if="showResetConfirm" class="border border-red-200 dark:border-red-800 rounded-lg p-4 bg-red-50 dark:bg-red-900/20">
            <div class="flex items-start gap-3 mb-3">
              <AlertTriangle class="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div>
                <p class="text-sm font-medium text-red-700 dark:text-red-400">{{ t('storageSetup.resetConfirmTitle') }}</p>
                <p class="text-sm text-red-600 dark:text-red-400/80 mt-1">{{ t('storageSetup.resetConfirmDesc') }}</p>
              </div>
            </div>
            <input
              v-model="resetPassword"
              type="password"
              :placeholder="t('settings.confirmPassword')"
              class="w-full px-3 py-2 rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm mb-3"
              @keydown.enter="resetAllNodes"
            />
            <div class="flex items-center gap-3">
              <button
                @click="resetAllNodes"
                :disabled="resetting || !resetPassword"
                class="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="resetting" class="w-4 h-4 animate-spin inline -mt-0.5 mr-1" />
                {{ resetting ? t('storageSetup.resettingStorage') : t('storageSetup.confirmReset') }}
              </button>
              <button @click="showResetConfirm = false; resetPassword = ''" class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                {{ t('common.cancel') }}
              </button>
            </div>
          </div>

        </div>
      </div>

      <!-- No storage configured -->
      <div v-if="!isConfigured" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
        <HardDrive class="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
        <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">{{ t('storageSetup.noStorageConfigured') }}</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
          {{ t('storageSetup.noStorageDesc') }}
        </p>
        <button
          @click="startWizard"
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
        >
          <Settings class="w-4 h-4" />
          {{ t('storageSetup.configureStorage') }}
        </button>
      </div>
    </template>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-12 gap-3 text-gray-500 dark:text-gray-400">
      <Loader2 class="w-5 h-5 animate-spin" />
      <span class="text-sm">{{ t('storageSetup.loading') }}</span>
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
          <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">{{ t('storageSetup.chooseStorageMode') }}</h2>
          <p class="text-gray-500 dark:text-gray-400">{{ t('storageSetup.chooseModeDesc') }}</p>
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
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ t('storageSetup.localSingleNode') }}</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('storageSetup.localDesc') }}
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              <span class="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{{ t('storageSetup.simpleSetup') }}</span>
              <span class="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{{ t('storageSetup.noReplication') }}</span>
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
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ t('storageSetup.distributedCluster') }}</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('storageSetup.distributedDesc') }}
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              <span class="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">{{ t('storageSetup.threeWayReplication') }}</span>
              <span class="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">{{ t('storageSetup.autoFailover') }}</span>
              <span class="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">{{ t('storageSetup.selfHealing') }}</span>
            </div>
          </button>
        </div>

        <!-- Cluster Identity (name, scope, region) -->
        <div class="max-w-3xl mx-auto space-y-6 mt-8">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 space-y-4">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Cluster Identity</h3>

            <!-- Cluster Name -->
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Cluster Name</label>
              <input
                v-model="clusterName"
                type="text"
                placeholder="e.g. eu-storage, global-cdn"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
              />
            </div>

            <!-- Scope Toggle -->
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Cluster Scope</label>
              <div class="grid grid-cols-2 gap-3">
                <button
                  @click="clusterScope = 'regional'"
                  :class="[
                    'flex items-center gap-3 px-4 py-3 rounded-lg border-2 text-left transition-all text-sm',
                    clusterScope === 'regional'
                      ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-blue-400'
                  ]"
                >
                  <MapPin class="w-5 h-5 text-blue-500 shrink-0" />
                  <div>
                    <p class="font-medium text-gray-900 dark:text-white">Regional</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Data stays in one region. GDPR compliant.</p>
                  </div>
                </button>
                <button
                  @click="clusterScope = 'global'"
                  :class="[
                    'flex items-center gap-3 px-4 py-3 rounded-lg border-2 text-left transition-all text-sm',
                    clusterScope === 'global'
                      ? 'border-purple-500 ring-2 ring-purple-500/20 bg-purple-50 dark:bg-purple-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-purple-400'
                  ]"
                >
                  <Globe class="w-5 h-5 text-purple-500 shrink-0" />
                  <div>
                    <p class="font-medium text-gray-900 dark:text-white">Global</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Geo-replicated. Slow writes, fast local reads.</p>
                  </div>
                </button>
              </div>
            </div>

            <!-- Region (only for regional scope) -->
            <div v-if="clusterScope === 'regional'">
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Region</label>
              <select
                v-model="clusterRegion"
                class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
              >
                <option :value="null">No specific region</option>
                <option v-for="loc in locations" :key="loc.locationKey" :value="loc.locationKey">{{ loc.label }}</option>
              </select>
            </div>

            <!-- Global scope info -->
            <div v-if="clusterScope === 'global'" class="flex items-start gap-3 p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
              <Globe class="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
              <div class="text-xs text-purple-700 dark:text-purple-300">
                <p class="font-medium">Global replication</p>
                <p class="mt-0.5">Data replicates to all nodes across regions. Writes are slow (cross-region), reads are fast (local). Ideal for large file distribution like game updates or CDN assets.</p>
              </div>
            </div>
          </div>

          <!-- Cluster Capabilities -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 space-y-4">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Cluster Capabilities</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400">Choose what this cluster can be used for. Existing volumes and backups remain accessible even if a capability is disabled.</p>

            <div class="space-y-3">
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  v-model="clusterAllowServices"
                  type="checkbox"
                  class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Services & Volumes</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">Allow this cluster to host service volumes and user deployments</p>
                </div>
              </label>

              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  v-model="clusterAllowBackups"
                  type="checkbox"
                  class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-amber-600 focus:ring-amber-500"
                />
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">Backups</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">Allow this cluster to store backup archives</p>
                </div>
              </label>
            </div>

            <div v-if="!clusterAllowServices && !clusterAllowBackups" class="flex items-start gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertTriangle class="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p class="text-xs text-red-700 dark:text-red-300">This cluster won't accept any new volumes or backups. Existing resources will remain accessible.</p>
            </div>
          </div>
        </div>

        <!-- Provider Selection (when distributed is selected) -->
        <div v-if="selectedMode === 'distributed'" class="max-w-3xl mx-auto space-y-6 mt-8">
          <!-- Volume Provider -->
          <div>
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{{ t('storageSetup.volumeStorageProvider') }}</h3>
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
                  {{ t('storageSetup.glusterfsDesc') }}
                </p>
                <div class="mt-2 flex flex-wrap gap-1">
                  <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">{{ t('storageSetup.bareMetal') }}</span>
                  <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">{{ t('storageSetup.gcpVms') }}</span>
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
                  {{ t('storageSetup.cephDesc') }}
                </p>
                <div class="mt-2 flex flex-wrap gap-1">
                  <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">{{ t('storageSetup.datacenter') }}</span>
                  <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">{{ t('storageSetup.petabytePlus') }}</span>
                </div>
              </button>
            </div>
          </div>

          <!-- Object Provider -->
          <div>
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{{ t('storageSetup.objectStorageProvider') }}</h3>
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
                  {{ t('storageSetup.minioDesc') }}
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
                  {{ t('storageSetup.s3Desc') }}
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
                  {{ t('storageSetup.gcsDesc') }}
                </p>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 2: Add Storage Nodes -->
      <div v-if="currentStep === 2" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('storageSetup.storageNodes') }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            <template v-if="selectedMode === 'distributed'">
              {{ t('storageSetup.addNodesDesc', { count: replicationFactor }) }}
            </template>
            <template v-else>
              {{ t('storageSetup.localNoNodes') }}
            </template>
          </p>
        </div>

        <div v-if="selectedMode === 'local'" class="p-6">
          <div class="flex items-center gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <Monitor class="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <p class="text-sm text-blue-700 dark:text-blue-300">
              {{ t('storageSetup.localModeInfo') }}
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
                <p class="text-sm font-semibold text-indigo-700 dark:text-indigo-300">{{ t('storageSetup.nodeSetupGuide') }}</p>
                <p class="text-xs text-indigo-600/70 dark:text-indigo-400/70 mt-0.5">
                  {{ t('storageSetup.nodeSetupGuideDesc') }}
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
                {{ t('storageSetup.overview') }}
              </h4>
              <p class="text-sm text-gray-600 dark:text-gray-400">
                {{ t('storageSetup.overviewPart1') }}
                <span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.dedicated') }}</span> {{ t('storageSetup.overviewPart2') }}
                <span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.sharedWithCompute') }}</span> {{ t('storageSetup.overviewPart3') }}
                {{ t('storageSetup.overviewMinNodes', { count: replicationFactor }) }}
              </p>
              <div class="flex flex-wrap gap-2 text-xs">
                <span class="px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{{ t('storageSetup.minDiskSpace') }}</span>
                <span class="px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{{ t('storageSetup.osRequirement') }}</span>
                <span class="px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{{ t('storageSetup.rootRequired') }}</span>
              </div>
            </div>

            <!-- Static IP & Networking -->
            <div class="p-4 rounded-lg bg-white dark:bg-gray-750 border border-gray-200 dark:border-gray-600 space-y-3">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Network class="w-4 h-4 text-gray-500" />
                {{ t('storageSetup.networkRequirements') }}
              </h4>
              <div class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <div class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>
                  <p><span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.staticIpRequired') }}</span> {{ t('storageSetup.staticIpDesc') }}</p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                  <p><span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.privateNetworkRecommended') }}</span> {{ t('storageSetup.privateNetworkDesc') }}</p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                  <p><span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.lowLatency') }}</span> {{ t('storageSetup.lowLatencyDesc') }}</p>
                </div>
              </div>
            </div>

            <!-- Docker Swarm Relationship -->
            <div class="p-4 rounded-lg bg-white dark:bg-gray-750 border border-gray-200 dark:border-gray-600 space-y-3">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Database class="w-4 h-4 text-gray-500" />
                {{ t('storageSetup.swarmAndStorage') }}
              </h4>
              <div class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <div class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"></span>
                  <p><span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.storageOnlyNoSwarm') }}</span> {{ t('storageSetup.storageOnlyNoSwarmDesc', { services: (selectedVolumeProvider === 'glusterfs' ? 'GlusterFS' : 'Ceph') + (selectedObjectProvider === 'minio' ? ' + MinIO' : '') }) }}</p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"></span>
                  <p><span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.storageComputeSwarm') }}</span> {{ t('storageSetup.storageComputeSwarmDesc') }}</p>
                </div>
                <div class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"></span>
                  <p><span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.swarmNeedsClient') }}</span> {{ t('storageSetup.swarmNeedsClientDesc', { client: selectedVolumeProvider === 'glusterfs' ? 'GlusterFS client' : 'Ceph RBD client' }) }}</p>
                </div>
              </div>
            </div>

            <!-- Firewall / Ports -->
            <div class="p-4 rounded-lg bg-white dark:bg-gray-750 border border-gray-200 dark:border-gray-600 space-y-3">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Lock class="w-4 h-4 text-gray-500" />
                {{ t('storageSetup.requiredFirewallPorts') }}
              </h4>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('storageSetup.firewallPortsDesc') }}
              </p>
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-gray-200 dark:border-gray-600">
                      <th class="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('storageSetup.port') }}</th>
                      <th class="text-left py-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('storageSetup.protocol') }}</th>
                      <th class="text-left py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{{ t('storageSetup.service') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
                    <!-- YOU must install these -->
                    <tr>
                      <td colspan="3" class="pt-3 pb-1">
                        <span class="text-[10px] font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">You install before proceeding</span>
                      </td>
                    </tr>
                    <tr>
                      <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">22</td>
                      <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                      <td class="py-2 text-gray-600 dark:text-gray-300">{{ t('storageSetup.sshServiceDesc') }}</td>
                    </tr>
                    <template v-if="selectedVolumeProvider === 'glusterfs'">
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">24007</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">{{ t('storageSetup.glusterfsDaemon') }} — <code class="text-[10px] bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded">apt install glusterfs-server</code></td>
                      </tr>
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">111</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP/UDP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">{{ t('storageSetup.rpcbind') }} — comes with glusterfs-server</td>
                      </tr>
                    </template>
                    <template v-if="selectedVolumeProvider === 'ceph'">
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">6789</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">{{ t('storageSetup.cephMonV1') }}</td>
                      </tr>
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">3300</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">{{ t('storageSetup.cephMonV2') }}</td>
                      </tr>
                      <tr>
                        <td class="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-white">6800–7300</td>
                        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">TCP</td>
                        <td class="py-2 text-gray-600 dark:text-gray-300">{{ t('storageSetup.cephOsd') }}</td>
                      </tr>
                    </template>
                    <!-- Fleet auto-configures these -->
                    <tr>
                      <td colspan="3" class="pt-4 pb-1">
                        <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Auto-configured by Fleet during initialization</span>
                      </td>
                    </tr>
                    <template v-if="selectedVolumeProvider === 'glusterfs'">
                      <tr class="text-gray-400 dark:text-gray-500">
                        <td class="py-2 pr-4 font-mono text-xs">24008</td>
                        <td class="py-2 pr-4">TCP</td>
                        <td class="py-2">{{ t('storageSetup.glusterfsManagement') }} — activates when volumes are created</td>
                      </tr>
                      <tr class="text-gray-400 dark:text-gray-500">
                        <td class="py-2 pr-4 font-mono text-xs">49152–49251</td>
                        <td class="py-2 pr-4">TCP</td>
                        <td class="py-2">{{ t('storageSetup.glusterfsBricks') }} — activates when volumes are created</td>
                      </tr>
                    </template>
                    <template v-if="selectedObjectProvider === 'minio'">
                      <tr class="text-gray-400 dark:text-gray-500">
                        <td class="py-2 pr-4 font-mono text-xs">9000</td>
                        <td class="py-2 pr-4">TCP</td>
                        <td class="py-2">{{ t('storageSetup.minioS3Api') }} — deployed by Fleet</td>
                      </tr>
                      <tr class="text-gray-400 dark:text-gray-500">
                        <td class="py-2 pr-4 font-mono text-xs">9001</td>
                        <td class="py-2 pr-4">TCP</td>
                        <td class="py-2">{{ t('storageSetup.minioConsole') }} — deployed by Fleet</td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
              <div class="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                <p class="text-xs text-yellow-700 dark:text-yellow-300">
                  <span class="font-medium">{{ t('storageSetup.important') }}</span> {{ t('storageSetup.neverExposePorts', { ports: (selectedVolumeProvider === 'glusterfs' ? '24007, 49152+' : '6789, 6800+') + (selectedObjectProvider === 'minio' ? ', 9000' : '') }) }}
                </p>
              </div>
            </div>

            <!-- Security Recommendations -->
            <div class="p-4 rounded-lg bg-white dark:bg-gray-750 border border-gray-200 dark:border-gray-600 space-y-3">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Shield class="w-4 h-4 text-gray-500" />
                {{ t('storageSetup.securityRecommendations') }}
              </h4>
              <ul class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span>
                  <p>{{ t('storageSetup.secSshKeyPart1') }} <span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.sshKeyAuth') }}</span> {{ t('storageSetup.secSshKeyPart2') }}</p>
                </li>
                <li class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span>
                  <p>{{ t('storageSetup.secVlanPart1') }} <span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.dedicatedVlan') }}</span> {{ t('storageSetup.secVlanPart2') }}</p>
                </li>
                <li v-if="selectedVolumeProvider === 'glusterfs'" class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span>
                  <p>{{ t('storageSetup.secGlusterfsPart1') }} <span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.ipBasedAuth') }}</span>{{ t('storageSetup.secGlusterfsPart2') }}</p>
                </li>
                <li v-if="selectedVolumeProvider === 'ceph'" class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span>
                  <p>{{ t('storageSetup.secCephPart1') }} <span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.cephxAuth') }}</span> {{ t('storageSetup.secCephPart2') }}</p>
                </li>
                <li v-if="selectedObjectProvider === 'minio'" class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span>
                  <p>{{ t('storageSetup.secMinioPart1') }} <span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.tlsOnMinio') }}</span> {{ t('storageSetup.secMinioPart2') }}</p>
                </li>
                <li class="flex items-start gap-2">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0"></span>
                  <p>{{ t('storageSetup.secUpdatesPart1') }} <span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.upToDate') }}</span> {{ t('storageSetup.secUpdatesPart2') }}</p>
                </li>
              </ul>
            </div>

            <!-- Quick Setup Commands -->
            <div class="p-4 rounded-lg bg-white dark:bg-gray-750 border border-gray-200 dark:border-gray-600 space-y-3">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Terminal class="w-4 h-4 text-gray-500" />
                {{ t('storageSetup.quickSetup') }}
              </h4>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('storageSetup.quickSetupDesc') }}
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
                  {{ t('storageSetup.swarmWorkersInstall') }}
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
                <button @click="testNode(index)" class="text-xs text-primary-600 dark:text-primary-400 hover:underline">{{ t('storageSetup.test') }}</button>
                <button @click="removeNode(index)" class="text-red-500 hover:text-red-700">
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <!-- Pick from existing swarm nodes -->
          <div v-if="availableSwarmNodes.length && !showAddNode" class="space-y-2">
            <p class="text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('storageSetup.pickFromSwarm') }}</p>
            <div class="grid grid-cols-1 gap-3">
              <div
                v-for="sn in availableSwarmNodes"
                :key="sn.id"
                class="rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-400 dark:hover:border-primary-600 transition-colors overflow-hidden"
              >
                <!-- Node header row -->
                <div class="flex items-center gap-3 p-3 cursor-pointer hover:bg-primary-50 dark:hover:bg-primary-900/10" @click="pickSwarmNode(sn)">
                  <Server class="w-4 h-4 text-gray-400 shrink-0" />
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ sn.hostname }}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">{{ sn.ipAddress }} &middot; {{ sn.role }}</p>
                  </div>
                  <Plus class="w-4 h-4 text-primary-500 shrink-0" />
                </div>

                <!-- Diagnostics panel -->
                <div v-if="probeResults[sn.id]" class="px-3 pb-3 border-t border-gray-100 dark:border-gray-700/50">
                  <!-- Loading state -->
                  <div v-if="probeResults[sn.id]?.loading" class="flex items-center gap-2 py-2 text-xs text-gray-500 dark:text-gray-400">
                    <Loader2 class="w-3 h-3 animate-spin" />
                    {{ t('storageSetup.probing') }}
                  </div>

                  <!-- Error state -->
                  <div v-else-if="probeResults[sn.id]?.error" class="flex items-center gap-2 py-2 text-xs text-red-600 dark:text-red-400">
                    <AlertTriangle class="w-3 h-3" />
                    {{ probeResults[sn.id]!.error }}
                    <button @click.stop="probeNode(sn.id)" class="ml-auto text-primary-600 dark:text-primary-400 hover:underline">{{ t('storageSetup.retry') }}</button>
                  </div>

                  <!-- Results -->
                  <template v-else>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2">
                      <!-- Disk Type -->
                      <div class="flex items-center gap-1.5 text-xs">
                        <HardDrive class="w-3 h-3 text-gray-400" />
                        <span class="text-gray-500 dark:text-gray-400">{{ t('storageSetup.diskType') }}:</span>
                        <span class="font-medium text-gray-900 dark:text-white uppercase">{{ probeResults[sn.id]!.metrics.diskType || '—' }}</span>
                      </div>

                      <!-- Disk Capacity -->
                      <div class="flex items-center gap-1.5 text-xs">
                        <Database class="w-3 h-3 text-gray-400" />
                        <span class="text-gray-500 dark:text-gray-400">{{ t('storageSetup.capacity') }}:</span>
                        <span class="font-medium text-gray-900 dark:text-white">{{ formatBytes(probeResults[sn.id]!.metrics.diskTotal) }}</span>
                      </div>

                      <!-- Disk Free -->
                      <div class="flex items-center gap-1.5 text-xs">
                        <Activity class="w-3 h-3 text-gray-400" />
                        <span class="text-gray-500 dark:text-gray-400">{{ t('storageSetup.free') }}:</span>
                        <span class="font-medium" :class="probeResults[sn.id]!.recommendations.diskSpaceAdequate ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">{{ formatBytes(probeResults[sn.id]!.metrics.diskFree) }}</span>
                      </div>

                      <!-- CPU / RAM -->
                      <div class="flex items-center gap-1.5 text-xs">
                        <Cpu class="w-3 h-3 text-gray-400" />
                        <span class="text-gray-500 dark:text-gray-400">{{ probeResults[sn.id]!.metrics.cpuCount ?? '—' }} CPU</span>
                        <span class="text-gray-300 dark:text-gray-600">|</span>
                        <span class="text-gray-500 dark:text-gray-400">{{ formatBytes(probeResults[sn.id]!.metrics.memTotal) }}</span>
                      </div>
                    </div>

                    <!-- Port status chips -->
                    <div class="flex flex-wrap gap-1 py-1">
                      <span
                        v-for="p in probeResults[sn.id]!.ports"
                        :key="p.port"
                        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                        :class="p.open
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          : (p as any).required
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'"
                        :title="p.open ? '' : (p as any).required ? t('storageSetup.requiredNotRunning') : t('storageSetup.autoConfigured')"
                      >
                        <component :is="p.open ? Wifi : WifiOff" class="w-2.5 h-2.5" />
                        {{ p.port }} {{ p.service }}
                      </span>
                    </div>

                    <!-- Recommendation badge -->
                    <div class="flex items-center gap-2 pt-1">
                      <span
                        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                        :class="probeResults[sn.id]!.recommendations.suitableForStorage ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'"
                      >
                        <CheckCircle2 v-if="probeResults[sn.id]!.recommendations.suitableForStorage" class="w-3 h-3" />
                        <AlertTriangle v-else class="w-3 h-3" />
                        {{ probeResults[sn.id]!.recommendations.suitableForStorage ? t('storageSetup.suitableForStorage') : t('storageSetup.lowDiskSpace') }}
                      </span>
                      <span class="text-[10px] text-gray-500 dark:text-gray-400">
                        {{ t('storageSetup.suggestedRole') }}: <span class="font-medium text-gray-700 dark:text-gray-300">{{ probeResults[sn.id]!.recommendations.suggestedRole }}</span>
                      </span>
                      <button @click.stop="probeNode(sn.id)" class="ml-auto text-[10px] text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1">
                        <RefreshCw class="w-2.5 h-2.5" />
                        {{ t('storageSetup.rescan') }}
                      </button>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <div v-if="loadingSwarmNodes && !swarmNodes.length" class="flex items-center justify-center py-4 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 class="w-4 h-4 animate-spin mr-2" />
            {{ t('storageSetup.loadingNodes') }}
          </div>

          <!-- Add node form (manual entry) -->
          <div v-if="showAddNode" class="p-4 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10 space-y-3">
            <p class="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('storageSetup.manualEntry') }}</p>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.hostname') }}</label>
                <input v-model="newNode.hostname" type="text" placeholder="storage-1" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.ipAddress') }}</label>
                <input v-model="newNode.ipAddress" type="text" placeholder="10.0.1.10" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.storagePath') }}</label>
                <input v-model="newNode.storagePathRoot" type="text" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.role') }}</label>
                <select v-model="newNode.role" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="storage">{{ t('storageSetup.roleStorageOnly') }}</option>
                  <option value="storage+compute">{{ t('storageSetup.roleStorageCompute') }}</option>
                  <option value="arbiter">{{ t('storageSetup.roleArbiter') }}</option>
                </select>
              </div>
            </div>
            <div class="flex gap-2">
              <button @click="addNode" :disabled="!newNode.hostname || !newNode.ipAddress" class="px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium">{{ t('storageSetup.add') }}</button>
              <button @click="showAddNode = false" class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-xs font-medium">{{ t('storageSetup.cancel') }}</button>
            </div>
          </div>

          <button
            v-if="!showAddNode"
            @click="showAddNode = true"
            class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-primary-400 hover:text-primary-600 transition-colors text-sm w-full justify-center"
          >
            <Plus class="w-4 h-4" />
            {{ t('storageSetup.addManualNode') }}
          </button>

          <!-- Install Client Dependencies -->
          <div class="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 space-y-3">
            <div class="flex items-center gap-3">
              <Settings class="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
              <div>
                <p class="text-sm font-semibold text-blue-800 dark:text-blue-200">Install Client Dependencies on Swarm Nodes</p>
                <p class="text-xs text-blue-600/80 dark:text-blue-400/70 mt-0.5">
                  Automatically install {{ selectedVolumeProvider === 'glusterfs' ? 'glusterfs-client' : 'ceph-common' }} on all Docker Swarm nodes so they can mount distributed volumes.
                </p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <button
                @click="installPrerequisites"
                :disabled="installingPrereqs"
                class="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="installingPrereqs" class="w-4 h-4 animate-spin" />
                <Settings v-else class="w-4 h-4" />
                {{ installingPrereqs ? 'Installing...' : 'Install Now' }}
              </button>
              <span class="text-xs text-blue-600/70 dark:text-blue-400/60">This will also run automatically during initialization (Step 4)</span>
            </div>
            <!-- Install result -->
            <div v-if="prereqInstallResult" class="space-y-2">
              <div v-if="prereqInstallResult.error" class="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                <AlertTriangle class="w-3.5 h-3.5 shrink-0" />
                {{ prereqInstallResult.error }}
              </div>
              <template v-else>
                <div v-for="(node, i) in (prereqInstallResult.results || [])" :key="i" class="flex items-center gap-2 text-xs">
                  <CheckCircle2 v-if="node.success" class="w-3.5 h-3.5 text-green-500 shrink-0" />
                  <AlertTriangle v-else class="w-3.5 h-3.5 text-red-500 shrink-0" />
                  <span class="font-medium text-gray-900 dark:text-white">{{ node.nodeId || node.hostname || `Node ${i + 1}` }}</span>
                  <span :class="node.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
                    {{ node.success ? 'Installed successfully' : (node.error || 'Failed') }}
                  </span>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 3: Configure -->
      <div v-if="currentStep === 3" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('storageSetup.configureReplication') }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('storageSetup.configureReplicationDesc') }}</p>
        </div>
        <div class="p-6 space-y-6">
          <template v-if="selectedMode === 'distributed'">
            <!-- Replication factor -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{{ t('storageSetup.replicationFactor') }}</label>
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
                  <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('storageSetup.nWayReplica', { n: factor }) }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {{ factor === 2 ? t('storageSetup.twoWayDesc') : t('storageSetup.threeWayDesc') }}
                  </p>
                </button>
              </div>
            </div>

            <!-- Ceph config (when Ceph is selected) -->
            <div v-if="selectedVolumeProvider === 'ceph'" class="space-y-3">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('storageSetup.cephConfiguration') }}</label>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.monitorAddresses') }}</label>
                  <input v-model="cephMonitors" type="text" placeholder="10.0.1.10,10.0.1.11,10.0.1.12" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.poolName') }}</label>
                  <input v-model="cephPool" type="text" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.authUser') }}</label>
                  <input v-model="cephUser" type="text" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.keyringPath') }}</label>
                  <input v-model="cephKeyring" type="text" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              </div>
            </div>

            <!-- Object storage config based on selected provider -->
            <div class="space-y-3">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('storageSetup.objectStorageLabel') }} — {{ selectedObjectProvider === 'minio' ? 'MinIO' : selectedObjectProvider === 's3' ? 'AWS S3' : 'Google Cloud Storage' }}
              </label>

              <!-- MinIO config -->
              <template v-if="selectedObjectProvider === 'minio'">
                <label class="flex items-center gap-2 mb-3 cursor-pointer">
                  <input type="checkbox" v-model="autoConfigureMinio" class="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                  <span class="text-sm text-gray-700 dark:text-gray-300">{{ t('storageSetup.autoConfigureMinio') }}</span>
                </label>
                <div v-if="!autoConfigureMinio" class="space-y-3 pl-6">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.minioEndpoint') }}</label>
                    <input v-model="minioEndpoint" type="text" placeholder="http://10.0.1.10:9000" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.accessKey') }}</label>
                      <input v-model="minioAccessKey" type="text" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.secretKey') }}</label>
                      <input v-model="minioSecretKey" type="password" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                  </div>
                </div>
              </template>

              <!-- S3 config -->
              <template v-if="selectedObjectProvider === 's3'">
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.region') }}</label>
                    <input v-model="s3Region" type="text" placeholder="us-east-1" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.bucketPrefix') }} <span class="text-gray-400">({{ t('storageSetup.optional') }})</span></label>
                    <input v-model="s3BucketPrefix" type="text" placeholder="my-fleet" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.accessKeyId') }}</label>
                    <input v-model="s3AccessKeyId" type="text" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.secretAccessKey') }}</label>
                    <input v-model="s3SecretAccessKey" type="password" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.customEndpoint') }} <span class="text-gray-400">({{ t('storageSetup.customEndpointHint') }})</span></label>
                  <input v-model="s3Endpoint" type="text" :placeholder="t('storageSetup.leaveEmptyForS3')" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              </template>

              <!-- GCS config -->
              <template v-if="selectedObjectProvider === 'gcs'">
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.gcpProjectId') }}</label>
                    <input v-model="gcsProjectId" type="text" placeholder="my-project-123" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.storageLocation') }}</label>
                    <select v-model="gcsLocation" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                      <option value="US">{{ t('storageSetup.usMultiRegion') }}</option>
                      <option value="EU">{{ t('storageSetup.euMultiRegion') }}</option>
                      <option value="ASIA">{{ t('storageSetup.asiaMultiRegion') }}</option>
                      <option value="us-central1">us-central1</option>
                      <option value="us-east1">us-east1</option>
                      <option value="europe-west1">europe-west1</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.serviceAccountKeyFile') }} <span class="text-gray-400">({{ t('storageSetup.pathOnServer') }})</span></label>
                    <input v-model="gcsKeyFile" type="text" :placeholder="t('storageSetup.gcsKeyFilePlaceholder')" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('storageSetup.bucketPrefix') }} <span class="text-gray-400">({{ t('storageSetup.optional') }})</span></label>
                    <input v-model="gcsBucketPrefix" type="text" placeholder="my-fleet" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                </div>
                <div class="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <p class="text-xs text-blue-700 dark:text-blue-300">
                    {{ t('storageSetup.gcsWorkloadIdentityNote') }}
                  </p>
                </div>
              </template>
            </div>
          </template>

          <template v-else>
            <div class="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <CheckCircle2 class="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
              <p class="text-sm text-green-700 dark:text-green-300">
                {{ t('storageSetup.localNoConfig') }}
              </p>
            </div>
          </template>
        </div>
      </div>

      <!-- Step 4: Initialize -->
      <div v-if="currentStep === 4" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('storageSetup.initializeStorageCluster') }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('storageSetup.initializeDesc') }}</p>
        </div>
        <div class="p-6">
          <div v-if="initStatus === 'idle'" class="text-center py-8">
            <Database class="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {{ selectedMode === 'distributed' ? t('storageSetup.clickInitDistributed') : t('storageSetup.clickInitLocal') }}
            </p>
            <button
              @click="initializeCluster"
              class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
            >
              {{ t('storageSetup.initialize') }}
            </button>
          </div>

          <!-- Progress log -->
          <div v-if="initStatus !== 'idle'" class="space-y-3">
            <div class="bg-gray-900 rounded-lg p-4 font-mono text-xs text-green-400 max-h-64 overflow-y-auto">
              <div v-for="(log, i) in initLogs" :key="i" class="py-0.5">{{ log }}</div>
              <div v-if="initStatus === 'running'" class="flex items-center gap-2 py-0.5">
                <Loader2 class="w-3 h-3 animate-spin" />
                {{ t('storageSetup.working') }}
              </div>
            </div>

            <div v-if="initStatus === 'success'" class="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <CheckCircle2 class="w-5 h-5 text-green-600 dark:text-green-400" />
              <p class="text-sm font-medium text-green-700 dark:text-green-300">{{ t('storageSetup.initSuccess') }}</p>
            </div>

            <div v-if="initStatus === 'error'" class="flex items-center gap-3">
              <button
                @click="initializeCluster"
                class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium"
              >
                <RefreshCw class="w-4 h-4" />
                {{ t('storageSetup.retry') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 5: Migrate -->
      <div v-if="currentStep === 5" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('storageSetup.migrateExistingData') }}</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('storageSetup.migrateExistingDesc') }}</p>
        </div>
        <div class="p-6">
          <div v-if="!hasMigratableData" class="flex items-center gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <CheckCircle2 class="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <p class="text-sm text-blue-700 dark:text-blue-300">{{ t('storageSetup.noDataToMigrate') }}</p>
          </div>

          <div v-else>
            <div v-if="migrationStatus === 'idle'" class="space-y-4">
              <div class="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                <p class="text-sm text-yellow-700 dark:text-yellow-300">
                  {{ t('storageSetup.migrationOnlineNotice') }}
                </p>
              </div>
              <button
                @click="startMigration"
                class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium"
              >
                {{ t('storageSetup.startMigration') }}
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
              <p class="text-sm font-medium text-green-700 dark:text-green-300">{{ t('storageSetup.migrationComplete') }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 6: Verify -->
      <div v-if="currentStep === 6" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="p-12 text-center">
          <CheckCircle2 class="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">{{ t('storageSetup.storageConfigured') }}</h2>
          <p class="text-gray-500 dark:text-gray-400 text-sm max-w-md mx-auto mb-6">
            {{ selectedMode === 'distributed' ? t('storageSetup.readyDistributed') : t('storageSetup.readyLocal') }}
          </p>

          <div v-if="verifyHealth" class="inline-flex flex-col items-start gap-2 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-6 py-4 mb-4">
            <div><span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.volumeProvider') }}:</span> {{ verifyHealth?.cluster?.provider ?? 'local' }}</div>
            <div><span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.objectProvider') }}:</span> {{ verifyHealth?.cluster?.objectProvider ?? 'local' }}</div>
            <div><span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.replication') }}:</span> {{ verifyHealth?.cluster?.replicationFactor ?? 1 }}x</div>
            <div>
              <span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.status') }}:</span>
              <span :class="verifyHealth?.cluster?.status === 'healthy' ? 'text-green-600' : 'text-yellow-600'" class="ml-1 capitalize">
                {{ verifyHealth?.cluster?.status ?? 'unknown' }}
              </span>
            </div>
            <div v-if="verifyHealth?.nodes?.length"><span class="font-medium text-gray-900 dark:text-white">{{ t('storageSetup.nodes') }}:</span> {{ verifyHealth.nodes.length }}</div>
            <div>
              <span class="font-medium text-gray-900 dark:text-white">Manager Storage:</span>
              <span v-if="verifyHealth?.platformVolumeMode === 'distributed'" class="ml-1 text-green-600">Global ({{ verifyHealth?.cluster?.provider }})</span>
              <span v-else class="ml-1" :class="verifyHealth?.cluster?.provider !== 'local' ? 'text-yellow-600' : 'text-gray-600 dark:text-gray-400'">
                Local
                <span v-if="verifyHealth?.cluster?.provider !== 'local'" class="text-xs"> — platform volumes not yet migrated</span>
              </span>
            </div>
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
          {{ t('storageSetup.back') }}
        </button>
        <div v-else></div>

        <button
          @click="nextStep"
          :disabled="!canProceed"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          <template v-if="currentStep === 6">
            {{ t('storageSetup.finish') }}
            <CheckCircle2 class="w-4 h-4" />
          </template>
          <template v-else-if="currentStep === 4 && initStatus === 'idle'">
            {{ t('storageSetup.initialize') }}
          </template>
          <template v-else>
            {{ t('storageSetup.next') }}
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
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('storageSetup.migrateStorageProvider') }}</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {{ t('storageSetup.migrateStorageProviderDesc') }}
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
                  {{ t('storageSetup.currentConfig') }}: <span class="font-medium text-gray-900 dark:text-white">{{ clusterData?.cluster?.provider ?? 'local' }}</span> {{ t('storageSetup.volumes') }},
                  <span class="font-medium text-gray-900 dark:text-white">{{ clusterData?.cluster?.objectProvider ?? 'local' }}</span> {{ t('storageSetup.objects') }}.
                  {{ t('storageSetup.selectTargetProviders') }}
                </p>
              </div>

              <!-- Target Volume Provider -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{{ t('storageSetup.targetVolumeProvider') }}</label>
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
                      {{ vp === 'local' ? t('storageSetup.singleNodeNfs') : vp === 'glusterfs' ? t('storageSetup.distributedReplicated') : t('storageSetup.enterpriseBlockStorage') }}
                    </p>
                    <span v-if="vp === clusterData?.cluster?.provider" class="text-xs text-gray-400 italic">{{ t('storageSetup.current') }}</span>
                  </button>
                </div>
              </div>

              <!-- Target Object Provider -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{{ t('storageSetup.targetObjectProvider') }}</label>
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
                    <span v-if="op === clusterData?.cluster?.objectProvider" class="text-xs text-gray-400 italic">{{ t('storageSetup.current') }}</span>
                  </button>
                </div>
              </div>

              <div class="flex justify-end">
                <button
                  @click="migrationWizardStep = 2"
                  :disabled="migrationTargetVolume === clusterData?.cluster?.provider && migrationTargetObject === clusterData?.cluster?.objectProvider"
                  class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                >
                  {{ t('storageSetup.next') }}
                  <ArrowRight class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Step 2: Confirm -->
            <div v-if="migrationWizardStep === 2" class="space-y-6">
              <div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">{{ t('storageSetup.migrationSummary') }}</h3>
                <div class="space-y-2 text-sm">
                  <div class="flex items-center justify-between">
                    <span class="text-gray-500 dark:text-gray-400">{{ t('storageSetup.volumeProvider') }}</span>
                    <span class="text-gray-900 dark:text-white">
                      <span class="capitalize">{{ clusterData?.cluster?.provider ?? 'local' }}</span>
                      <ArrowRight class="w-3 h-3 inline mx-1" />
                      <span class="font-semibold capitalize">{{ migrationTargetVolume === 'glusterfs' ? 'GlusterFS' : migrationTargetVolume === 'ceph' ? 'Ceph RBD' : 'Local' }}</span>
                    </span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-gray-500 dark:text-gray-400">{{ t('storageSetup.objectProvider') }}</span>
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
                    <p class="font-medium">{{ t('storageSetup.beforeYouProceed') }}</p>
                    <ul class="list-disc pl-4 space-y-0.5">
                      <li>{{ t('storageSetup.servicesOnline') }}</li>
                      <li>{{ t('storageSetup.briefSwitchover') }}</li>
                      <li>{{ t('storageSetup.pauseResume') }}</li>
                      <li>{{ t('storageSetup.rollbackAvailable') }}</li>
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
                  {{ t('storageSetup.back') }}
                </button>
                <button
                  @click="startProviderMigration"
                  class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
                >
                  <RefreshCw class="w-4 h-4" />
                  {{ t('storageSetup.startMigration') }}
                </button>
              </div>
            </div>

            <!-- Step 3: Progress -->
            <div v-if="migrationWizardStep === 3" class="space-y-6">
              <!-- Progress bar -->
              <div>
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {{ migrationStatus === 'running' ? t('storageSetup.migrating') : migrationStatus === 'idle' ? t('storageSetup.paused') : t('storageSetup.complete') }}
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
                  {{ t('storageSetup.pause') }}
                </button>
                <button
                  v-if="migrationStatus === 'idle' && activeMigrationId"
                  @click="resumeActiveMigration"
                  class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
                >
                  {{ t('storageSetup.resume') }}
                </button>
                <button
                  v-if="activeMigrationId && migrationStatus !== 'complete'"
                  @click="rollbackActiveMigration"
                  class="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors"
                >
                  {{ t('storageSetup.rollback') }}
                </button>
              </div>
            </div>

            <!-- Step 4: Complete -->
            <div v-if="migrationWizardStep === 4" class="text-center py-6 space-y-4">
              <CheckCircle2 class="w-14 h-14 text-green-500 mx-auto" />
              <h3 class="text-xl font-bold text-gray-900 dark:text-white">{{ t('storageSetup.migrationComplete') }}</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                {{ t('storageSetup.migrationCompleteDesc', { volumeProvider: migrationTargetVolume === 'glusterfs' ? 'GlusterFS' : migrationTargetVolume === 'ceph' ? 'Ceph RBD' : 'Local', objectProvider: migrationTargetObject === 'local' ? 'Local' : migrationTargetObject === 'minio' ? 'MinIO' : migrationTargetObject === 's3' ? 'AWS S3' : 'GCS' }) }}
              </p>

              <div class="flex items-center justify-center gap-3 pt-2">
                <button
                  @click="rollbackActiveMigration"
                  class="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors"
                >
                  {{ t('storageSetup.rollback') }}
                </button>
                <button
                  @click="closeMigrationWizard"
                  class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
                >
                  <CheckCircle2 class="w-4 h-4" />
                  {{ t('storageSetup.done') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
