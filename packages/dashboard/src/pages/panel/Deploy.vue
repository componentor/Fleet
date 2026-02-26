<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  Rocket,
  Github,
  FileCode2,
  Store,
  Loader2,
  Plus,
  X,
  Search,
  Lock,
  Globe,
  GitBranch,
  ArrowLeft,
  Check,
  FolderUp,
  Archive,
  AlertTriangle,
  CheckCircle2,
  Shield,
  MapPin,
  HardDrive,
  Package,
  Copy,
  RefreshCw,
} from 'lucide-vue-next'
import { useServicesStore } from '@/stores/services'
import { useAuthStore } from '@/stores/auth'
import { useApi } from '@/composables/useApi'
import { useVolumeManager } from '@/composables/useVolumeManager'
import InlineVolumeCreator from '@/components/InlineVolumeCreator.vue'
import DomainPicker from '@/components/DomainPicker.vue'
import { useI18n } from 'vue-i18n'

interface GitHubRepo {
  id: number
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
  description: string | null
  language: string | null
  updatedAt: string
}

interface GitHubBranch {
  name: string
  protected: boolean
}

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const store = useServicesStore()
const authStore = useAuthStore()
const api = useApi()
const volumeManager = useVolumeManager()

const deployMethod = ref<'github' | 'docker' | 'upload' | 'registry' | null>(null)

// Region selection (shared across all deploy methods)
const regions = ref<Array<{ key: string; label: string; nodeCount: number }>>([])
const selectedRegion = ref<string | null>(null)

async function fetchRegions() {
  try {
    regions.value = await api.get<any[]>('/services/regions')
  } catch {}
}

// Docker form state
const serviceName = ref('')
const dockerImage = ref('')
const replicas = ref(1)
const domain = ref('')
const loading = ref(false)
const error = ref('')

// Validation
const validationErrors = ref<Record<string, string>>({})

function validateServiceName(name: string): string | null {
  if (!name.trim()) return 'Service name is required'
  if (!/^[a-z0-9][a-z0-9_-]*[a-z0-9]$/i.test(name) && name.length > 1) return 'Must contain only letters, numbers, hyphens, and underscores'
  if (name.length < 2) return 'Must be at least 2 characters'
  if (name.length > 63) return 'Must be 63 characters or fewer'
  return null
}

function validateDomain(d: string): string | null {
  if (!d) return null
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(d)) return 'Invalid domain format'
  return null
}

function validateDockerImage(image: string): string | null {
  if (!image.trim()) return 'Docker image is required'
  if (image.includes(' ')) return 'Image name cannot contain spaces'
  return null
}

// Confirmation modal
const showConfirmModal = ref(false)
const confirmAction = ref<(() => Promise<void>) | null>(null)
const confirmConfig = ref<{ name: string; image?: string; domain?: string; repo?: string; method: string }>({ name: '', method: '' })
const previewData = ref<any>(null)
const previewLoading = ref(false)

async function fetchPreview(config: any) {
  previewLoading.value = true
  try {
    previewData.value = await api.post('/services/preview', config)
  } catch {
    previewData.value = null
  } finally {
    previewLoading.value = false
  }
}

function openConfirmModal(config: { name: string; image?: string; domain?: string; repo?: string; method: string }, action: () => Promise<void>) {
  confirmConfig.value = config
  confirmAction.value = action
  showConfirmModal.value = true
  fetchPreview({
    name: config.name,
    image: config.image || 'ghcr.io/placeholder',
    ...(config.domain ? { domain: config.domain } : {}),
  })
}

async function executeConfirmedDeploy() {
  showConfirmModal.value = false
  if (confirmAction.value) await confirmAction.value()
}

// GitHub flow state
const githubStep = ref<'checking' | 'connect' | 'repos' | 'configure'>('checking')
const githubConnected = ref(false)
const githubLoading = ref(false)

// Repos
const repos = ref<GitHubRepo[]>([])
const repoSearch = ref('')
const reposLoading = ref(false)

// Selected repo & branches
const selectedRepo = ref<GitHubRepo | null>(null)
const branches = ref<GitHubBranch[]>([])
const selectedBranch = ref('')
const branchesLoading = ref(false)

// GitHub deploy config
const ghServiceName = ref('')
const autoDeploy = ref(true)

// Shared env vars for both deploy methods
const envVars = ref<{ key: string; value: string }[]>([])

// Upload form state
const uploadFile = ref<File | null>(null)
const uploadServiceName = ref('')
const uploadBuildFile = ref('')
const uploadDragOver = ref(false)
const uploadLoading = ref(false)

// Registry form state
const registryServiceName = ref('')
const registryImage = ref('')
const registryTag = ref('latest')
const registryPollEnabled = ref(false)
const registryPollInterval = ref(300)
const registryLoading = ref(false)
const availableRegistries = ref<Array<{ registry: string; username: string; scope: 'platform' | 'account' }>>([])
const selectedRegistry = ref<string>('')
const webhookUrl = ref('')

async function fetchAvailableRegistries() {
  try {
    const data = await api.get<{ registries: typeof availableRegistries.value }>('/registry-credentials/available')
    availableRegistries.value = data.registries
  } catch {}
}

function generateWebhookUrl(serviceId: string) {
  const base = window.location.origin
  return `${base}/api/v1/deployments/registry/webhook/${serviceId}`
}

const fullRegistryImage = computed(() => {
  const reg = selectedRegistry.value
  const img = registryImage.value
  const tag = registryTag.value || 'latest'
  if (!img) return ''
  if (reg && reg !== 'docker.io') return `${reg}/${img}:${tag}`
  return `${img}:${tag}`
})

function confirmRegistryDeploy() {
  if (!registryServiceName.value || !registryImage.value) return
  validationErrors.value = {}
  const nameErr = validateServiceName(registryServiceName.value)
  if (nameErr) { validationErrors.value.registryServiceName = nameErr; return }
  const domErr = validateDomain(domain.value)
  if (domErr) { validationErrors.value.domain = domErr; return }
  openConfirmModal(
    { name: registryServiceName.value, image: fullRegistryImage.value, domain: domain.value, method: 'Registry' },
    executeRegistryDeploy,
  )
}

async function executeRegistryDeploy() {
  registryLoading.value = true
  error.value = ''
  try {
    await store.createService({
      name: registryServiceName.value,
      image: fullRegistryImage.value,
      replicas: replicas.value,
      domain: domain.value || undefined,
      region: selectedRegion.value || undefined,
      envVars: buildEnvVarsPayload(),
      volumes: buildVolumesPayload(),
      sourceType: 'registry',
      registryPollEnabled: registryPollEnabled.value,
      registryPollInterval: registryPollInterval.value,
    } as any)
    router.push('/panel/services')
  } catch (err: any) {
    error.value = err?.body?.error || err?.message || 'Deployment failed'
  } finally {
    registryLoading.value = false
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
}

// Volume state (shared across deploy methods)
const deployVolumes = ref<Array<{ source: string; target: string; readonly: boolean }>>([])

function addDeployVolume() {
  deployVolumes.value.push({ source: '', target: '', readonly: false })
}

function removeDeployVolume(index: number) {
  deployVolumes.value.splice(index, 1)
}

async function handleDeployVolumeCreated(index: number, vol: { name: string; displayName: string; sizeGb: number }) {
  try {
    const created = await volumeManager.createVolume(vol.name, vol.sizeGb)
    deployVolumes.value[index]!.source = created.name
  } catch {
    // Toast already shown by useApi
  }
}

function buildVolumesPayload(): Array<{ source: string; target: string; readonly: boolean }> | undefined {
  const valid = deployVolumes.value.filter((v) => v.source && v.target)
  return valid.length > 0 ? valid : undefined
}

const showDbWarning = computed(() => {
  if (!dockerImage.value) return false
  if (!volumeManager.isDatabaseImage(dockerImage.value)) return false
  return deployVolumes.value.filter((v) => v.source && v.target).length === 0
})

function onUploadFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  uploadFile.value = input.files?.[0] || null
}

function onUploadDrop(e: DragEvent) {
  uploadDragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) {
    const ext = file.name.toLowerCase()
    if (ext.endsWith('.zip') || ext.endsWith('.tar') || ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) {
      uploadFile.value = file
    }
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function confirmUploadDeploy() {
  if (!uploadServiceName.value || !uploadFile.value) return
  validationErrors.value = {}
  const nameErr = validateServiceName(uploadServiceName.value)
  if (nameErr) { validationErrors.value.uploadServiceName = nameErr; return }
  const domErr = validateDomain(domain.value)
  if (domErr) { validationErrors.value.domain = domErr; return }
  openConfirmModal(
    { name: uploadServiceName.value, domain: domain.value, method: 'File Upload' },
    executeUploadDeploy,
  )
}

async function executeUploadDeploy() {
  uploadLoading.value = true
  error.value = ''
  try {
    const formData = new FormData()
    formData.append('file', uploadFile.value!)
    formData.append('name', uploadServiceName.value)
    if (uploadBuildFile.value) formData.append('buildFile', uploadBuildFile.value)
    if (buildEnvVarsPayload()) formData.append('env', JSON.stringify(buildEnvVarsPayload()))
    if (buildVolumesPayload()) formData.append('volumes', JSON.stringify(buildVolumesPayload()))
    if (domain.value) formData.append('domain', domain.value)
    if (selectedRegion.value) formData.append('region', selectedRegion.value)
    formData.append('replicas', String(replicas.value))

    await api.upload('/upload/deploy', formData)
    router.push('/panel/services')
  } catch (err: any) {
    error.value = err?.body?.error || err?.message || t('deploy.deploymentFailed')
  } finally {
    uploadLoading.value = false
  }
}


const filteredRepos = computed(() => {
  if (!repoSearch.value.trim()) return repos.value
  const q = repoSearch.value.toLowerCase()
  return repos.value.filter(
    (r) =>
      r.fullName.toLowerCase().includes(q) ||
      (r.description && r.description.toLowerCase().includes(q)),
  )
})

function addEnvVar() {
  envVars.value.push({ key: '', value: '' })
}
function removeEnvVar(index: number) {
  envVars.value.splice(index, 1)
}
function buildEnvVarsPayload(): Record<string, string> | undefined {
  const filtered = envVars.value.filter((e) => e.key.trim())
  if (filtered.length === 0) return undefined
  const obj: Record<string, string> = {}
  for (const e of filtered) obj[e.key.trim()] = e.value
  return obj
}

function validateDockerForm(): boolean {
  validationErrors.value = {}
  const nameErr = validateServiceName(serviceName.value)
  if (nameErr) validationErrors.value.serviceName = nameErr
  const imgErr = validateDockerImage(dockerImage.value)
  if (imgErr) validationErrors.value.dockerImage = imgErr
  const domErr = validateDomain(domain.value)
  if (domErr) validationErrors.value.domain = domErr
  return Object.keys(validationErrors.value).length === 0
}

function confirmDockerDeploy() {
  if (!validateDockerForm()) return
  openConfirmModal(
    { name: serviceName.value, image: dockerImage.value, domain: domain.value, method: 'Docker Image' },
    executeDockerDeploy,
  )
}

async function executeDockerDeploy() {
  loading.value = true
  error.value = ''
  try {
    await store.createService({
      name: serviceName.value,
      image: dockerImage.value,
      replicas: replicas.value,
      domain: domain.value || undefined,
      region: selectedRegion.value || undefined,
      envVars: buildEnvVarsPayload(),
      volumes: buildVolumesPayload(),
    } as any)
    router.push('/panel/services')
  } catch (err: any) {
    error.value = err?.body?.error || err?.message || t('deploy.deploymentFailed')
  } finally {
    loading.value = false
  }
}

function confirmGithubDeploy() {
  if (!selectedRepo.value || !ghServiceName.value) return
  validationErrors.value = {}
  const nameErr = validateServiceName(ghServiceName.value)
  if (nameErr) { validationErrors.value.ghServiceName = nameErr; return }
  openConfirmModal(
    { name: ghServiceName.value, repo: selectedRepo.value.fullName, method: 'GitHub' },
    executeGithubDeploy,
  )
}

async function executeGithubDeploy() {
  loading.value = true
  error.value = ''
  try {
    await store.createService({
      name: ghServiceName.value,
      image: 'ghcr.io/placeholder',
      githubRepo: selectedRepo.value!.fullName,
      githubBranch: selectedBranch.value,
      autoDeploy: autoDeploy.value,
      region: selectedRegion.value || undefined,
      envVars: buildEnvVarsPayload(),
      volumes: buildVolumesPayload(),
    } as any)
    router.push('/panel/services')
  } catch (err: any) {
    error.value = err?.body?.error || err?.message || t('deploy.deploymentFailed')
  } finally {
    loading.value = false
  }
}

async function checkGithubStatus() {
  githubStep.value = 'checking'
  githubLoading.value = true
  try {
    const data = await api.get<{ connected: boolean }>('/deployments/github/status')
    githubConnected.value = data.connected
    if (data.connected) {
      await fetchRepos()
    } else {
      githubStep.value = 'connect'
    }
  } catch (err: any) {
    error.value = err?.body?.error || err?.message || t('deploy.github.failedConnection')
    githubStep.value = 'connect'
  } finally {
    githubLoading.value = false
  }
}

async function fetchRepos() {
  reposLoading.value = true
  try {
    const data = await api.get<GitHubRepo[]>('/deployments/github/repos')
    repos.value = data
    githubStep.value = 'repos'
  } catch (err: any) {
    error.value = err?.body?.error || err?.message || t('deploy.github.failedRepos')
  } finally {
    reposLoading.value = false
  }
}

async function selectRepo(repo: GitHubRepo) {
  selectedRepo.value = repo
  ghServiceName.value = repo.name
  selectedBranch.value = repo.defaultBranch
  branchesLoading.value = true
  githubStep.value = 'configure'
  try {
    const [owner, repoName] = repo.fullName.split('/')
    const data = await api.get<GitHubBranch[]>(
      `/deployments/github/repos/${owner}/${repoName}/branches`,
    )
    branches.value = data
  } catch (err: any) {
    error.value = err?.body?.error || err?.message || t('deploy.github.failedBranches')
  } finally {
    branchesLoading.value = false
  }
}

function goBackToRepos() {
  selectedRepo.value = null
  branches.value = []
  ghServiceName.value = ''
  selectedBranch.value = ''
  envVars.value = []
  githubStep.value = 'repos'
}

function connectGithub() {
  window.location.href = '/api/v1/auth/github?returnTo=/panel/deploy'
}

function timeAgo(dateString: string): string {
  const now = new Date()
  const date = new Date(dateString)
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return t('deploy.timeAgo.justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('deploy.timeAgo.minutes', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('deploy.timeAgo.hours', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('deploy.timeAgo.days', { n: days })
  const months = Math.floor(days / 30)
  if (months < 12) return t('deploy.timeAgo.months', { n: months })
  const years = Math.floor(months / 12)
  return t('deploy.timeAgo.years', { n: years })
}

// Watch for deploy method change to trigger GitHub flow
watch(
  () => deployMethod.value,
  (method) => {
    if (method === 'github') {
      if (githubConnected.value) {
        fetchRepos()
      } else {
        checkGithubStatus()
      }
    }
    if (method === 'registry') {
      fetchAvailableRegistries()
    }
    // Reset volumes when switching deploy method
    deployVolumes.value = []
  },
)

// Auto-suggest volume for database images
watch(dockerImage, (newImage) => {
  if (!newImage) return
  const path = volumeManager.suggestedVolumePath(newImage)
  if (path && deployVolumes.value.length === 0) {
    deployVolumes.value.push({ source: '', target: path, readonly: false })
  }
})

// Handle OAuth return — token is now in URL fragment (#) to prevent server-side leakage
onMounted(() => {
  fetchRegions()
  volumeManager.fetchAll()
  const hashParams = new URLSearchParams(window.location.hash.slice(1))
  const isGithubConnected = hashParams.get('github_connected') || route.query.github_connected
  if (isGithubConnected) {
    // Clear fragment and query params — do NOT accept tokens from URL fragments
    window.location.hash = ''
    router.replace({ query: {} })
    githubConnected.value = true
    deployMethod.value = 'github'
  }
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Rocket class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('deploy.title') }}</h1>
    </div>

    <div
      v-if="error"
      class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
    >
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- Deploy method selection -->
    <div v-if="!deployMethod" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-4xl">
      <button
        @click="deployMethod = 'docker'"
        class="group relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-600"
      >
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0 transition-colors group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30">
            <FileCode2 class="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div class="min-w-0">
            <h3 class="text-base font-semibold text-gray-900 dark:text-white mb-1">{{ $t('deploy.dockerImage') }}</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{{ $t('deploy.dockerImageDesc') }}</p>
          </div>
        </div>
      </button>

      <button
        @click="deployMethod = 'github'"
        class="group relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-gray-400 dark:hover:border-gray-500"
      >
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0 transition-colors group-hover:bg-gray-200 dark:group-hover:bg-gray-600">
            <Github class="w-6 h-6 text-gray-900 dark:text-white" />
          </div>
          <div class="min-w-0">
            <h3 class="text-base font-semibold text-gray-900 dark:text-white mb-1">{{ $t('deploy.fromGithub') }}</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{{ $t('deploy.fromGithubDesc') }}</p>
          </div>
        </div>
      </button>

      <button
        @click="deployMethod = 'upload'"
        class="group relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-purple-300 dark:hover:border-purple-600"
      >
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center shrink-0 transition-colors group-hover:bg-purple-100 dark:group-hover:bg-purple-900/30">
            <FolderUp class="w-6 h-6 text-purple-600 dark:text-purple-400" />
          </div>
          <div class="min-w-0">
            <h3 class="text-base font-semibold text-gray-900 dark:text-white mb-1">{{ $t('deploy.fromUpload') }}</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{{ $t('deploy.fromUploadDesc') }}</p>
          </div>
        </div>
      </button>

      <button
        @click="deployMethod = 'registry'"
        class="group relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-600"
      >
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center shrink-0 transition-colors group-hover:bg-amber-100 dark:group-hover:bg-amber-900/30">
            <Package class="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div class="min-w-0">
            <h3 class="text-base font-semibold text-gray-900 dark:text-white mb-1">From Registry</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">Deploy from a Docker registry with auto-deploy on push</p>
          </div>
        </div>
      </button>

      <RouterLink
        to="/panel/marketplace"
        class="group relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-green-300 dark:hover:border-green-600"
      >
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-lg bg-green-50 dark:bg-green-900/20 flex items-center justify-center shrink-0 transition-colors group-hover:bg-green-100 dark:group-hover:bg-green-900/30">
            <Store class="w-6 h-6 text-green-600 dark:text-green-400" />
          </div>
          <div class="min-w-0">
            <h3 class="text-base font-semibold text-gray-900 dark:text-white mb-1">{{ $t('deploy.fromMarketplace') }}</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{{ $t('deploy.fromMarketplaceDesc') }}</p>
          </div>
        </div>
      </RouterLink>
    </div>

    <!-- Docker image deploy form -->
    <div v-if="deployMethod === 'docker'" class="max-w-2xl">
      <button
        @click="deployMethod = null; error = ''"
        class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition-colors"
      >
        &larr; {{ $t('deploy.backToOptions') }}
      </button>
      <div
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm"
      >
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('deploy.deployDockerImage') }}</h2>
        </div>
        <form @submit.prevent="confirmDockerDeploy" class="p-6 space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >{{ $t('deploy.serviceName') }}</label
            >
            <input
              v-model="serviceName"
              type="text"
              placeholder="my-app"
              required
              :class="['w-full px-3.5 py-2.5 rounded-lg border bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm', validationErrors.serviceName ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600']"
            />
            <p v-if="validationErrors.serviceName" class="mt-1 text-xs text-red-500">{{ validationErrors.serviceName }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >{{ $t('deploy.dockerImage') }}</label
            >
            <input
              v-model="dockerImage"
              type="text"
              placeholder="nginx:latest"
              required
              :class="['w-full px-3.5 py-2.5 rounded-lg border bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono', validationErrors.dockerImage ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600']"
            />
            <p v-if="validationErrors.dockerImage" class="mt-1 text-xs text-red-500">{{ validationErrors.dockerImage }}</p>
          </div>
          <div class="grid grid-cols-2 gap-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                >{{ $t('deploy.replicas') }}</label
              >
              <input
                v-model.number="replicas"
                type="number"
                min="1"
                max="100"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                >{{ $t('deploy.domainOptional') }}</label
              >
              <DomainPicker
                :model-value="domain"
                @update:model-value="domain = $event"
                placeholder="app.example.com"
              />
            </div>
          </div>

          <!-- Region Selector -->
          <div v-if="regions.length > 0">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              <span class="inline-flex items-center gap-1.5">
                <MapPin class="w-3.5 h-3.5" />
                Region
              </span>
            </label>
            <select
              v-model="selectedRegion"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            >
              <option :value="null">Auto (any region)</option>
              <option v-for="r in regions" :key="r.key" :value="r.key">{{ r.label }} ({{ r.nodeCount }} {{ r.nodeCount === 1 ? 'node' : 'nodes' }})</option>
            </select>
            <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">Choose where your containers run for lower latency</p>
          </div>

          <!-- Environment Variables -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >{{ $t('deploy.envVars') }}</label
              >
              <button
                type="button"
                @click="addEnvVar"
                class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
              >
                <Plus class="w-3.5 h-3.5" /> {{ $t('deploy.add') }}
              </button>
            </div>
            <div v-for="(env, i) in envVars" :key="i" class="flex items-center gap-2 mb-2">
              <input
                v-model="env.key"
                type="text"
                :placeholder="$t('deploy.keyPlaceholder')"
                class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              />
              <input
                v-model="env.value"
                type="text"
                :placeholder="$t('deploy.valuePlaceholder')"
                class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              />
              <button
                type="button"
                @click="removeEnvVar(i)"
                class="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
              >
                <X class="w-4 h-4" />
              </button>
            </div>
            <p v-if="envVars.length === 0" class="text-xs text-gray-400 dark:text-gray-500">
              {{ $t('deploy.noEnvVars') }}
            </p>
          </div>

          <!-- Persistent Storage -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                <span class="inline-flex items-center gap-1.5">
                  <HardDrive class="w-3.5 h-3.5" />
                  {{ $t('deploy.persistentStorage') || 'Persistent Storage' }}
                </span>
              </label>
              <button
                type="button"
                @click="addDeployVolume"
                class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
              >
                <Plus class="w-3.5 h-3.5" /> {{ $t('deploy.add') }}
              </button>
            </div>
            <div v-if="deployVolumes.length > 0" class="space-y-2">
              <InlineVolumeCreator
                v-for="(vol, i) in deployVolumes"
                :key="i"
                :model-value="vol"
                :account-volumes="volumeManager.accountVolumes.value"
                :storage-quota="volumeManager.storageQuota.value"
                :create-loading="volumeManager.createLoading.value"
                :suggested-name="serviceName ? volumeManager.suggestedVolumeName(serviceName) : undefined"
                @update:model-value="deployVolumes[i] = $event"
                @volume-created="handleDeployVolumeCreated(i, $event)"
                @remove="removeDeployVolume(i)"
              />
            </div>
            <p v-else class="text-xs text-gray-400 dark:text-gray-500">
              {{ $t('deploy.noVolumes') || 'No volumes. Add one to persist data across restarts.' }}
            </p>
          </div>

          <!-- DB without volume warning -->
          <div v-if="showDbWarning" class="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
            <div class="flex items-start gap-2">
              <AlertTriangle class="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p class="text-sm font-medium text-amber-800 dark:text-amber-200">{{ $t('deploy.dbWithoutVolume') || 'Database without persistent storage' }}</p>
                <p class="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{{ $t('deploy.dbWithoutVolumeDesc', { path: volumeManager.suggestedVolumePath(dockerImage) }) || 'Data will be lost when the container restarts.' }}</p>
              </div>
            </div>
          </div>

          <div class="pt-2 flex justify-end">
            <button
              type="submit"
              :disabled="loading || !serviceName || !dockerImage"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
              <Rocket v-else class="w-4 h-4" />
              {{ loading ? $t('deploy.deploying') : $t('deploy.deploy') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- GitHub deploy flow -->
    <div v-if="deployMethod === 'github'" class="max-w-2xl">
      <button
        @click="deployMethod = null; error = ''; githubStep = 'checking'"
        class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition-colors"
      >
        &larr; {{ $t('deploy.backToOptions') }}
      </button>

      <!-- Step: Checking GitHub connection -->
      <div
        v-if="githubStep === 'checking'"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 flex flex-col items-center justify-center"
      >
        <Loader2 class="w-8 h-8 text-primary-500 animate-spin mb-4" />
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('deploy.github.checkingConnection') }}</p>
      </div>

      <!-- Step: Connect GitHub Account -->
      <div
        v-if="githubStep === 'connect'"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8"
      >
        <div class="flex flex-col items-center text-center">
          <div
            class="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-5"
          >
            <Github class="w-8 h-8 text-gray-900 dark:text-white" />
          </div>
          <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            {{ $t('deploy.github.connectTitle') }}
          </h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 max-w-sm mb-6">
            {{ $t('deploy.github.connectDesc') }}
          </p>
          <button
            @click="connectGithub"
            class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
          >
            <Github class="w-4 h-4" />
            {{ $t('deploy.github.connectButton') }}
          </button>
        </div>
      </div>

      <!-- Step: Browse Repos -->
      <div v-if="githubStep === 'repos'">
        <div
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm"
        >
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ $t('deploy.github.selectRepo') }}
            </h2>
          </div>

          <!-- Search -->
          <div class="px-6 pt-4">
            <div class="relative">
              <Search
                class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
              />
              <input
                v-model="repoSearch"
                type="text"
                :placeholder="$t('deploy.github.searchRepos')"
                class="w-full pl-10 pr-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>
          </div>

          <!-- Loading state -->
          <div v-if="reposLoading" class="p-12 flex flex-col items-center justify-center">
            <Loader2 class="w-6 h-6 text-primary-500 animate-spin mb-3" />
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('deploy.github.loadingRepos') }}</p>
          </div>

          <!-- Repo list -->
          <div v-else class="p-4 max-h-96 overflow-y-auto space-y-2">
            <p
              v-if="filteredRepos.length === 0"
              class="text-sm text-gray-500 dark:text-gray-400 text-center py-8"
            >
              {{ repoSearch ? $t('deploy.github.noReposSearch') : $t('deploy.github.noRepos') }}
            </p>

            <button
              v-for="repo in filteredRepos"
              :key="repo.id"
              @click="selectRepo(repo)"
              class="w-full text-left p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-600 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {{ repo.fullName }}
                    </span>
                    <span
                      v-if="repo.private"
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                    >
                      <Lock class="w-3 h-3" />
                      {{ $t('deploy.github.private') }}
                    </span>
                    <span
                      v-else
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                    >
                      <Globe class="w-3 h-3" />
                      {{ $t('deploy.github.public') }}
                    </span>
                  </div>
                  <p
                    v-if="repo.description"
                    class="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mb-1.5"
                  >
                    {{ repo.description }}
                  </p>
                  <div class="flex items-center gap-3">
                    <span
                      v-if="repo.language"
                      class="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400"
                    >
                      <span class="w-2.5 h-2.5 rounded-full bg-primary-500 inline-block"></span>
                      {{ repo.language }}
                    </span>
                    <span class="text-xs text-gray-400 dark:text-gray-500">
                      {{ $t('deploy.github.updated', { time: timeAgo(repo.updatedAt) }) }}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- Step: Configure & Deploy -->
      <div v-if="githubStep === 'configure' && selectedRepo">
        <div
          class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm"
        >
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ $t('deploy.github.configureDeployment') }}
            </h2>
          </div>

          <div class="p-6 space-y-5">
            <!-- Selected Repo Card -->
            <div
              class="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750"
            >
              <div class="flex items-center gap-3 min-w-0">
                <div
                  class="w-10 h-10 rounded-lg bg-gray-900 dark:bg-white flex items-center justify-center shrink-0"
                >
                  <Github class="w-5 h-5 text-white dark:text-gray-900" />
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {{ selectedRepo.fullName }}
                  </p>
                  <div class="flex items-center gap-2 mt-0.5">
                    <span
                      v-if="selectedRepo.private"
                      class="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                    >
                      <Lock class="w-3 h-3" />
                      {{ $t('deploy.github.private') }}
                    </span>
                    <span
                      v-else
                      class="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400"
                    >
                      <Globe class="w-3 h-3" />
                      {{ $t('deploy.github.public') }}
                    </span>
                    <span
                      v-if="selectedRepo.language"
                      class="text-xs text-gray-500 dark:text-gray-400"
                    >
                      {{ selectedRepo.language }}
                    </span>
                  </div>
                </div>
              </div>
              <button
                @click="goBackToRepos"
                class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 shrink-0"
              >
                {{ $t('deploy.github.change') }}
              </button>
            </div>

            <!-- Branch Select -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                <span class="inline-flex items-center gap-1.5">
                  <GitBranch class="w-3.5 h-3.5" />
                  {{ $t('deploy.github.branch') }}
                </span>
              </label>
              <div v-if="branchesLoading" class="flex items-center gap-2 py-2">
                <Loader2 class="w-4 h-4 text-primary-500 animate-spin" />
                <span class="text-sm text-gray-500 dark:text-gray-400">{{ $t('deploy.github.loadingBranches') }}</span>
              </div>
              <select
                v-else
                v-model="selectedBranch"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              >
                <option
                  v-for="b in branches"
                  :key="b.name"
                  :value="b.name"
                >
                  {{ b.name }}{{ b.protected ? ` (${$t('deploy.github.protected')})` : '' }}
                </option>
              </select>
            </div>

            <!-- Service Name -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                >{{ $t('deploy.serviceName') }}</label
              >
              <input
                v-model="ghServiceName"
                type="text"
                placeholder="my-app"
                required
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>

            <!-- Auto-deploy Toggle -->
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300"
                  >{{ $t('deploy.github.autoDeploy') }}</label
                >
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {{ $t('deploy.github.autoDeployDesc') }}
                </p>
              </div>
              <label class="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                <input v-model="autoDeploy" type="checkbox" class="sr-only peer" />
                <div
                  class="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"
                ></div>
              </label>
            </div>

            <!-- Environment Variables -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >{{ $t('deploy.envVars') }}</label
                >
                <button
                  type="button"
                  @click="addEnvVar"
                  class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
                >
                  <Plus class="w-3.5 h-3.5" /> {{ $t('deploy.add') }}
                </button>
              </div>
              <div v-for="(env, i) in envVars" :key="i" class="flex items-center gap-2 mb-2">
                <input
                  v-model="env.key"
                  type="text"
                  :placeholder="$t('deploy.keyPlaceholder')"
                  class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                />
                <input
                  v-model="env.value"
                  type="text"
                  :placeholder="$t('deploy.valuePlaceholder')"
                  class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                />
                <button
                  type="button"
                  @click="removeEnvVar(i)"
                  class="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>
              <p v-if="envVars.length === 0" class="text-xs text-gray-400 dark:text-gray-500">
                {{ $t('deploy.noEnvVars') }}
              </p>
            </div>

            <!-- Persistent Storage -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  <span class="inline-flex items-center gap-1.5">
                    <HardDrive class="w-3.5 h-3.5" />
                    {{ $t('deploy.persistentStorage') || 'Persistent Storage' }}
                  </span>
                </label>
                <button
                  type="button"
                  @click="addDeployVolume"
                  class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
                >
                  <Plus class="w-3.5 h-3.5" /> {{ $t('deploy.add') }}
                </button>
              </div>
              <div v-if="deployVolumes.length > 0" class="space-y-2">
                <InlineVolumeCreator
                  v-for="(vol, i) in deployVolumes"
                  :key="i"
                  :model-value="vol"
                  :account-volumes="volumeManager.accountVolumes.value"
                  :storage-quota="volumeManager.storageQuota.value"
                  :create-loading="volumeManager.createLoading.value"
                  :suggested-name="ghServiceName ? volumeManager.suggestedVolumeName(ghServiceName) : undefined"
                  @update:model-value="deployVolumes[i] = $event"
                  @volume-created="handleDeployVolumeCreated(i, $event)"
                  @remove="removeDeployVolume(i)"
                />
              </div>
              <p v-else class="text-xs text-gray-400 dark:text-gray-500">
                {{ $t('deploy.noVolumes') || 'No volumes. Add one to persist data across restarts.' }}
              </p>
            </div>

            <!-- Deploy Button -->
            <div class="pt-2 flex justify-end">
              <button
                @click="confirmGithubDeploy"
                :disabled="loading || !selectedRepo || !ghServiceName"
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
                <Rocket v-else class="w-4 h-4" />
                {{ loading ? $t('deploy.deploying') : $t('deploy.deploy') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Upload deploy form -->
    <div v-if="deployMethod === 'upload'" class="max-w-2xl">
      <button
        @click="deployMethod = null; error = ''; uploadFile = null; uploadServiceName = ''"
        class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition-colors"
      >
        &larr; {{ $t('deploy.backToOptions') }}
      </button>
      <div
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm"
      >
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('deploy.fromUpload') }}</h2>
        </div>
        <div class="p-6 space-y-5">
          <!-- Drop zone -->
          <div>
            <label
              :class="[
                'flex items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-colors',
                uploadDragOver
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500 bg-gray-50 dark:bg-gray-900/50',
              ]"
              @dragover.prevent="uploadDragOver = true"
              @dragleave="uploadDragOver = false"
              @drop.prevent="onUploadDrop"
            >
              <div class="text-center">
                <Archive v-if="!uploadFile" class="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <FolderUp v-else class="w-10 h-10 text-primary-500 mx-auto mb-3" />
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  {{ uploadFile ? $t('deploy.fileSelected', { name: uploadFile.name, size: formatFileSize(uploadFile.size) }) : $t('deploy.dragDrop') }}
                </p>
                <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">{{ $t('deploy.supportedFormats') }}</p>
              </div>
              <input
                type="file"
                accept=".zip,.tar,.tar.gz,.tgz"
                class="hidden"
                @change="onUploadFileSelect"
              />
            </label>
          </div>

          <!-- Service Name -->
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('deploy.serviceName') }}</label>
            <input
              v-model="uploadServiceName"
              type="text"
              placeholder="my-app"
              required
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>

          <!-- Build File (optional) -->
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('deploy.buildFile') }}</label>
            <input
              v-model="uploadBuildFile"
              type="text"
              placeholder="Dockerfile"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
            />
            <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">{{ $t('deploy.buildFileHint') }}</p>
          </div>

          <div class="grid grid-cols-2 gap-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('deploy.replicas') }}</label>
              <input
                v-model.number="replicas"
                type="number"
                min="1"
                max="100"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('deploy.domainOptional') }}</label>
              <DomainPicker
                :model-value="domain"
                @update:model-value="domain = $event"
                placeholder="app.example.com"
              />
            </div>
          </div>

          <!-- Environment Variables -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('deploy.envVars') }}</label>
              <button type="button" @click="addEnvVar" class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                <Plus class="w-3.5 h-3.5" /> {{ $t('deploy.add') }}
              </button>
            </div>
            <div v-for="(env, i) in envVars" :key="i" class="flex items-center gap-2 mb-2">
              <input v-model="env.key" type="text" :placeholder="$t('deploy.keyPlaceholder')" class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
              <input v-model="env.value" type="text" :placeholder="$t('deploy.valuePlaceholder')" class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
              <button type="button" @click="removeEnvVar(i)" class="p-1.5 text-gray-400 hover:text-red-500 transition-colors"><X class="w-4 h-4" /></button>
            </div>
            <p v-if="envVars.length === 0" class="text-xs text-gray-400 dark:text-gray-500">{{ $t('deploy.noEnvVars') }}</p>
          </div>

          <!-- Persistent Storage -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                <span class="inline-flex items-center gap-1.5">
                  <HardDrive class="w-3.5 h-3.5" />
                  {{ $t('deploy.persistentStorage') || 'Persistent Storage' }}
                </span>
              </label>
              <button
                type="button"
                @click="addDeployVolume"
                class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
              >
                <Plus class="w-3.5 h-3.5" /> {{ $t('deploy.add') }}
              </button>
            </div>
            <div v-if="deployVolumes.length > 0" class="space-y-2">
              <InlineVolumeCreator
                v-for="(vol, i) in deployVolumes"
                :key="i"
                :model-value="vol"
                :account-volumes="volumeManager.accountVolumes.value"
                :storage-quota="volumeManager.storageQuota.value"
                :create-loading="volumeManager.createLoading.value"
                :suggested-name="uploadServiceName ? volumeManager.suggestedVolumeName(uploadServiceName) : undefined"
                @update:model-value="deployVolumes[i] = $event"
                @volume-created="handleDeployVolumeCreated(i, $event)"
                @remove="removeDeployVolume(i)"
              />
            </div>
            <p v-else class="text-xs text-gray-400 dark:text-gray-500">
              {{ $t('deploy.noVolumes') || 'No volumes. Add one to persist data across restarts.' }}
            </p>
          </div>

          <div class="pt-2 flex justify-end">
            <button
              @click="confirmUploadDeploy"
              :disabled="uploadLoading || !uploadServiceName || !uploadFile"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Loader2 v-if="uploadLoading" class="w-4 h-4 animate-spin" />
              <Rocket v-else class="w-4 h-4" />
              {{ uploadLoading ? $t('deploy.uploading') : $t('deploy.deploy') }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <!-- Registry deploy form -->
    <div v-if="deployMethod === 'registry'" class="max-w-2xl">
      <button
        @click="deployMethod = null; error = ''"
        class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition-colors"
      >
        &larr; {{ $t('deploy.backToOptions') }}
      </button>
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Deploy from Registry</h2>
        </div>
        <form @submit.prevent="confirmRegistryDeploy" class="p-6 space-y-5">
          <!-- Service Name -->
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('deploy.serviceName') }}</label>
            <input
              v-model="registryServiceName"
              type="text"
              placeholder="my-app"
              required
              :class="['w-full px-3.5 py-2.5 rounded-lg border bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm', validationErrors.registryServiceName ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600']"
            />
            <p v-if="validationErrors.registryServiceName" class="mt-1 text-xs text-red-500">{{ validationErrors.registryServiceName }}</p>
          </div>

          <!-- Registry selector -->
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Registry</label>
            <select
              v-model="selectedRegistry"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            >
              <option value="">Docker Hub (public)</option>
              <option value="docker.io">Docker Hub (authenticated)</option>
              <option v-for="reg in availableRegistries.filter(r => r.registry !== 'docker.io')" :key="reg.registry" :value="reg.registry">
                {{ reg.registry }} ({{ reg.scope === 'account' ? 'your credential' : 'platform' }})
              </option>
            </select>
            <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">Select a registry or leave as Docker Hub for public images</p>
          </div>

          <!-- Image name & tag -->
          <div class="grid grid-cols-3 gap-4">
            <div class="col-span-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Image</label>
              <input
                v-model="registryImage"
                type="text"
                :placeholder="selectedRegistry ? 'org/app' : 'nginx'"
                required
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Tag</label>
              <input
                v-model="registryTag"
                type="text"
                placeholder="latest"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              />
            </div>
          </div>

          <!-- Full image preview -->
          <div v-if="fullRegistryImage" class="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
            <p class="text-xs text-gray-500 dark:text-gray-400">Full image reference:</p>
            <p class="text-sm font-mono text-gray-900 dark:text-white mt-0.5">{{ fullRegistryImage }}</p>
          </div>

          <!-- Replicas & Domain -->
          <div class="grid grid-cols-2 gap-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('deploy.replicas') }}</label>
              <input
                v-model.number="replicas"
                type="number"
                min="1"
                max="100"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('deploy.domainOptional') }}</label>
              <DomainPicker
                :model-value="domain"
                @update:model-value="domain = $event"
                placeholder="app.example.com"
              />
            </div>
          </div>

          <!-- Region Selector -->
          <div v-if="regions.length > 0">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              <span class="inline-flex items-center gap-1.5">
                <MapPin class="w-3.5 h-3.5" />
                Region
              </span>
            </label>
            <select
              v-model="selectedRegion"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            >
              <option :value="null">Auto (any region)</option>
              <option v-for="r in regions" :key="r.key" :value="r.key">{{ r.label }} ({{ r.nodeCount }} {{ r.nodeCount === 1 ? 'node' : 'nodes' }})</option>
            </select>
          </div>

          <!-- Auto-deploy: Tag polling -->
          <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Auto-deploy on push</label>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Automatically redeploy when a new image is pushed to the registry
                </p>
              </div>
              <label class="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                <input v-model="registryPollEnabled" type="checkbox" class="sr-only peer" />
                <div class="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
              </label>
            </div>

            <div v-if="registryPollEnabled" class="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-700">
              <!-- Polling interval -->
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  <span class="inline-flex items-center gap-1">
                    <RefreshCw class="w-3 h-3" />
                    Poll interval
                  </span>
                </label>
                <select
                  v-model.number="registryPollInterval"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                >
                  <option :value="60">Every 1 minute</option>
                  <option :value="300">Every 5 minutes</option>
                  <option :value="900">Every 15 minutes</option>
                  <option :value="1800">Every 30 minutes</option>
                </select>
                <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">How often to check for new image digests</p>
              </div>

              <!-- Webhook URL info -->
              <div class="rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 p-3">
                <p class="text-xs font-medium text-blue-800 dark:text-blue-200 mb-1">Webhook URL (available after deploy)</p>
                <p class="text-xs text-blue-600 dark:text-blue-400">
                  After deployment, a webhook URL will be generated for your service. You can configure your registry to send push notifications to this URL for instant deploys.
                </p>
              </div>
            </div>
          </div>

          <!-- Environment Variables -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('deploy.envVars') }}</label>
              <button type="button" @click="addEnvVar" class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                <Plus class="w-3.5 h-3.5" /> {{ $t('deploy.add') }}
              </button>
            </div>
            <div v-for="(env, i) in envVars" :key="i" class="flex items-center gap-2 mb-2">
              <input v-model="env.key" type="text" :placeholder="$t('deploy.keyPlaceholder')" class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
              <input v-model="env.value" type="text" :placeholder="$t('deploy.valuePlaceholder')" class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
              <button type="button" @click="removeEnvVar(i)" class="p-1.5 text-gray-400 hover:text-red-500 transition-colors"><X class="w-4 h-4" /></button>
            </div>
            <p v-if="envVars.length === 0" class="text-xs text-gray-400 dark:text-gray-500">{{ $t('deploy.noEnvVars') }}</p>
          </div>

          <!-- Persistent Storage -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                <span class="inline-flex items-center gap-1.5">
                  <HardDrive class="w-3.5 h-3.5" />
                  {{ $t('deploy.persistentStorage') || 'Persistent Storage' }}
                </span>
              </label>
              <button type="button" @click="addDeployVolume" class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                <Plus class="w-3.5 h-3.5" /> {{ $t('deploy.add') }}
              </button>
            </div>
            <div v-if="deployVolumes.length > 0" class="space-y-2">
              <InlineVolumeCreator
                v-for="(vol, i) in deployVolumes"
                :key="i"
                :model-value="vol"
                :account-volumes="volumeManager.accountVolumes.value"
                :storage-quota="volumeManager.storageQuota.value"
                :create-loading="volumeManager.createLoading.value"
                :suggested-name="registryServiceName ? volumeManager.suggestedVolumeName(registryServiceName) : undefined"
                @update:model-value="deployVolumes[i] = $event"
                @volume-created="handleDeployVolumeCreated(i, $event)"
                @remove="removeDeployVolume(i)"
              />
            </div>
            <p v-else class="text-xs text-gray-400 dark:text-gray-500">
              {{ $t('deploy.noVolumes') || 'No volumes. Add one to persist data across restarts.' }}
            </p>
          </div>

          <div class="pt-2 flex justify-end">
            <button
              type="submit"
              :disabled="registryLoading || !registryServiceName || !registryImage"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <Loader2 v-if="registryLoading" class="w-4 h-4 animate-spin" />
              <Rocket v-else class="w-4 h-4" />
              {{ registryLoading ? $t('deploy.deploying') : $t('deploy.deploy') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Confirmation Modal -->
    <Teleport to="body">
      <div v-if="showConfirmModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" @click="showConfirmModal = false" />
        <div class="relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xl max-w-md w-full overflow-hidden">
          <div class="px-6 py-5 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                <Rocket class="w-5 h-5 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Confirm Deployment</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400">Review your configuration before deploying</p>
              </div>
            </div>
          </div>
          <div class="px-6 py-4 space-y-3">
            <div class="flex items-center justify-between py-1.5">
              <span class="text-sm text-gray-500 dark:text-gray-400">Method</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">{{ confirmConfig.method }}</span>
            </div>
            <div class="flex items-center justify-between py-1.5">
              <span class="text-sm text-gray-500 dark:text-gray-400">Service Name</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white font-mono">{{ confirmConfig.name }}</span>
            </div>
            <div v-if="confirmConfig.image" class="flex items-center justify-between py-1.5">
              <span class="text-sm text-gray-500 dark:text-gray-400">Image</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white font-mono">{{ confirmConfig.image }}</span>
            </div>
            <div v-if="confirmConfig.repo" class="flex items-center justify-between py-1.5">
              <span class="text-sm text-gray-500 dark:text-gray-400">Repository</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white font-mono">{{ confirmConfig.repo }}</span>
            </div>
            <div v-if="confirmConfig.domain" class="flex items-center justify-between py-1.5">
              <span class="text-sm text-gray-500 dark:text-gray-400">Domain</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">{{ confirmConfig.domain }}</span>
            </div>

            <!-- Preview warnings -->
            <div v-if="previewLoading" class="flex items-center gap-2 py-2 text-xs text-gray-400">
              <Loader2 class="w-3.5 h-3.5 animate-spin" />
              Checking configuration...
            </div>
            <div v-else-if="previewData?.warnings?.length" class="rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 p-3 space-y-1.5">
              <div v-for="(warning, idx) in previewData.warnings" :key="idx" class="flex items-start gap-2">
                <AlertTriangle class="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span class="text-xs text-amber-700 dark:text-amber-300">{{ warning }}</span>
              </div>
            </div>
            <div v-else-if="previewData?.valid" class="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2 class="w-3.5 h-3.5" />
              Configuration looks good
            </div>
          </div>
          <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-3">
            <button
              @click="showConfirmModal = false"
              class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              @click="executeConfirmedDeploy"
              class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
            >
              <Rocket class="w-4 h-4" />
              Deploy Now
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
