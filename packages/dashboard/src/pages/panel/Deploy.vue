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
} from 'lucide-vue-next'
import { useServicesStore } from '@/stores/services'
import { useAuthStore } from '@/stores/auth'
import { useApi } from '@/composables/useApi'
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

const deployMethod = ref<'github' | 'docker' | 'upload' | null>(null)

// Docker form state
const serviceName = ref('')
const dockerImage = ref('')
const replicas = ref(1)
const domain = ref('')
const loading = ref(false)
const error = ref('')

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

// Shared env vars and ports for both deploy methods
const envVars = ref<{ key: string; value: string }[]>([])
const ports = ref<{ container: number | null; published: number | null }[]>([])

// Upload form state
const uploadFile = ref<File | null>(null)
const uploadServiceName = ref('')
const uploadBuildFile = ref('')
const uploadDragOver = ref(false)
const uploadLoading = ref(false)

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

async function deployUpload() {
  if (!uploadServiceName.value || !uploadFile.value) return
  uploadLoading.value = true
  error.value = ''
  try {
    const formData = new FormData()
    formData.append('file', uploadFile.value)
    formData.append('name', uploadServiceName.value)
    if (uploadBuildFile.value) formData.append('buildFile', uploadBuildFile.value)
    if (buildEnvVarsPayload()) formData.append('env', JSON.stringify(buildEnvVarsPayload()))
    if (buildPortsPayload()) formData.append('ports', JSON.stringify(buildPortsPayload()))
    if (domain.value) formData.append('domain', domain.value)
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
function addPort() {
  ports.value.push({ container: null, published: null })
}
function removePort(index: number) {
  ports.value.splice(index, 1)
}

function buildEnvVarsPayload(): Record<string, string> | undefined {
  const filtered = envVars.value.filter((e) => e.key.trim())
  if (filtered.length === 0) return undefined
  const obj: Record<string, string> = {}
  for (const e of filtered) obj[e.key.trim()] = e.value
  return obj
}

function buildPortsPayload():
  | { container: number; published: number; protocol: string }[]
  | undefined {
  const filtered = ports.value.filter((p) => p.container)
  if (filtered.length === 0) return undefined
  return filtered.map((p) => ({
    container: p.container!,
    published: p.published || p.container!,
    protocol: 'tcp',
  }))
}

async function deployDocker() {
  if (!serviceName.value || !dockerImage.value) return
  loading.value = true
  error.value = ''
  try {
    await store.createService({
      name: serviceName.value,
      image: dockerImage.value,
      replicas: replicas.value,
      domain: domain.value || undefined,
      envVars: buildEnvVarsPayload(),
      ports: buildPortsPayload(),
    } as any)
    router.push('/panel/services')
  } catch (err: any) {
    error.value = err?.body?.error || err?.message || t('deploy.deploymentFailed')
  } finally {
    loading.value = false
  }
}

async function deployGithub() {
  if (!selectedRepo.value || !ghServiceName.value) return
  loading.value = true
  error.value = ''
  try {
    await store.createService({
      name: ghServiceName.value,
      image: 'ghcr.io/placeholder',
      githubRepo: selectedRepo.value.fullName,
      githubBranch: selectedBranch.value,
      autoDeploy: autoDeploy.value,
      envVars: buildEnvVarsPayload(),
      ports: buildPortsPayload(),
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
  ports.value = []
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
  },
)

// Handle OAuth return
onMounted(() => {
  if (route.query.github_connected) {
    const token = route.query.token as string | undefined
    const refreshToken = route.query.refresh_token as string | undefined
    if (token && refreshToken) {
      authStore.setTokens({ accessToken: token, refreshToken })
    }
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
    <div v-if="!deployMethod" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl">
      <button
        @click="deployMethod = 'docker'"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all group"
      >
        <div class="w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center mb-4">
          <FileCode2 class="w-6 h-6 text-white" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ $t('deploy.dockerImage') }}</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ $t('deploy.dockerImageDesc') }}
        </p>
      </button>

      <button
        @click="deployMethod = 'github'"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all group"
      >
        <div
          class="w-12 h-12 rounded-lg bg-gray-900 dark:bg-white flex items-center justify-center mb-4"
        >
          <Github class="w-6 h-6 text-white dark:text-gray-900" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ $t('deploy.fromGithub') }}</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ $t('deploy.fromGithubDesc') }}
        </p>
      </button>

      <button
        @click="deployMethod = 'upload'"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all group"
      >
        <div class="w-12 h-12 rounded-lg bg-purple-600 flex items-center justify-center mb-4">
          <FolderUp class="w-6 h-6 text-white" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ $t('deploy.fromUpload') }}</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ $t('deploy.fromUploadDesc') }}
        </p>
      </button>

      <RouterLink
        to="/panel/marketplace"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-green-300 dark:hover:border-green-600 hover:shadow-md transition-all group"
      >
        <div class="w-12 h-12 rounded-lg bg-green-600 flex items-center justify-center mb-4">
          <Store class="w-6 h-6 text-white" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ $t('deploy.fromMarketplace') }}</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ $t('deploy.fromMarketplaceDesc') }}
        </p>
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
        <form @submit.prevent="deployDocker" class="p-6 space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >{{ $t('deploy.serviceName') }}</label
            >
            <input
              v-model="serviceName"
              type="text"
              placeholder="my-app"
              required
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
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
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
            />
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
              <input
                v-model="domain"
                type="text"
                placeholder="app.example.com"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>
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

          <!-- Port Mappings -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >{{ $t('deploy.portMappings') }}</label
              >
              <button
                type="button"
                @click="addPort"
                class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
              >
                <Plus class="w-3.5 h-3.5" /> {{ $t('deploy.add') }}
              </button>
            </div>
            <div v-for="(port, i) in ports" :key="i" class="flex items-center gap-2 mb-2">
              <div class="flex-1">
                <input
                  v-model.number="port.container"
                  type="number"
                  :placeholder="$t('deploy.containerPort')"
                  min="1"
                  max="65535"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>
              <span class="text-gray-400 dark:text-gray-500 text-sm shrink-0">:</span>
              <div class="flex-1">
                <input
                  v-model.number="port.published"
                  type="number"
                  :placeholder="String(port.container || $t('deploy.hostPort'))"
                  min="1"
                  max="65535"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>
              <button
                type="button"
                @click="removePort(i)"
                class="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
              >
                <X class="w-4 h-4" />
              </button>
            </div>
            <p v-if="ports.length === 0" class="text-xs text-gray-400 dark:text-gray-500">
              {{ $t('deploy.noPorts') }}
            </p>
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

            <!-- Port Mappings -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >{{ $t('deploy.portMappings') }}</label
                >
                <button
                  type="button"
                  @click="addPort"
                  class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
                >
                  <Plus class="w-3.5 h-3.5" /> {{ $t('deploy.add') }}
                </button>
              </div>
              <div v-for="(port, i) in ports" :key="i" class="flex items-center gap-2 mb-2">
                <div class="flex-1">
                  <input
                    v-model.number="port.container"
                    type="number"
                    :placeholder="$t('deploy.containerPort')"
                    min="1"
                    max="65535"
                    class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                  />
                </div>
                <span class="text-gray-400 dark:text-gray-500 text-sm shrink-0">:</span>
                <div class="flex-1">
                  <input
                    v-model.number="port.published"
                    type="number"
                    :placeholder="String(port.container || $t('deploy.hostPort'))"
                    min="1"
                    max="65535"
                    class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                  />
                </div>
                <button
                  type="button"
                  @click="removePort(i)"
                  class="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>
              <p v-if="ports.length === 0" class="text-xs text-gray-400 dark:text-gray-500">
                {{ $t('deploy.noPorts') }}
              </p>
            </div>

            <!-- Deploy Button -->
            <div class="pt-2 flex justify-end">
              <button
                @click="deployGithub"
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
              <input
                v-model="domain"
                type="text"
                placeholder="app.example.com"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
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

          <!-- Port Mappings -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('deploy.portMappings') }}</label>
              <button type="button" @click="addPort" class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                <Plus class="w-3.5 h-3.5" /> {{ $t('deploy.add') }}
              </button>
            </div>
            <div v-for="(port, i) in ports" :key="i" class="flex items-center gap-2 mb-2">
              <div class="flex-1">
                <input v-model.number="port.container" type="number" :placeholder="$t('deploy.containerPort')" min="1" max="65535" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
              </div>
              <span class="text-gray-400 dark:text-gray-500 text-sm shrink-0">:</span>
              <div class="flex-1">
                <input v-model.number="port.published" type="number" :placeholder="String(port.container || $t('deploy.hostPort'))" min="1" max="65535" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
              </div>
              <button type="button" @click="removePort(i)" class="p-1.5 text-gray-400 hover:text-red-500 transition-colors"><X class="w-4 h-4" /></button>
            </div>
            <p v-if="ports.length === 0" class="text-xs text-gray-400 dark:text-gray-500">{{ $t('deploy.noPorts') }}</p>
          </div>

          <div class="pt-2 flex justify-end">
            <button
              @click="deployUpload"
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
  </div>
</template>
