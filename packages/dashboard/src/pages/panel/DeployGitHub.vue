<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  Rocket, Github, Loader2, Plus, X, Globe, RefreshCw,
  AlertTriangle, ExternalLink, Lock, KeyRound, Info,
} from 'lucide-vue-next'
import { useServicesStore } from '@/stores/services'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

interface ManifestEnvVar {
  key: string
  description: string
  value: string
  required: boolean
  generate: boolean
  fromUrl: boolean
}

interface ManifestPort {
  target: number
  published: number | null
  protocol: string
}

interface FleetManifest {
  name?: string
  description?: string
  icon?: string
  website?: string
  env?: Record<string, string | { description?: string; value?: string; required?: boolean; generate?: boolean }>
  ports?: Array<{ target: number; published?: number; protocol?: string }>
  buildFile?: string
  branch?: string
}

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const store = useServicesStore()
const api = useApi()

// ── State ────────────────────────────────────────────────────────────────
const loading = ref(true)
const deploying = ref(false)
const error = ref('')

// Query params
const repoParam = computed(() => (route.query.repo as string) || '')
const branchParam = computed(() => (route.query.branch as string) || '')
const nameParam = computed(() => (route.query.name as string) || '')

// Manifest data
const manifest = ref<FleetManifest | null>(null)
const resolvedBranch = ref('')
const manifestError = ref('')

// Form state
const serviceName = ref('')
const branch = ref('')
const domain = ref('')
const replicas = ref(1)
const envVars = ref<ManifestEnvVar[]>([])
const ports = ref<ManifestPort[]>([])
const autoDeploy = ref(true)

// ── Lifecycle ────────────────────────────────────────────────────────────
onMounted(async () => {
  if (!repoParam.value) {
    error.value = 'Missing required "repo" query parameter. URL should be /deploy/gh?repo=owner/repo'
    loading.value = false
    return
  }

  await fetchManifest()
})

// ── API ──────────────────────────────────────────────────────────────────
async function fetchManifest() {
  loading.value = true
  error.value = ''
  manifestError.value = ''

  try {
    const params = new URLSearchParams({ repo: repoParam.value })
    if (branchParam.value) params.set('branch', branchParam.value)

    const data = await api.get<{
      manifest: FleetManifest | null
      branch: string
      repo: string
      error?: string
      details?: string[]
    }>(`/deployments/github/manifest?${params}`)

    if (data.error) {
      manifestError.value = data.details ? data.details.join(', ') : data.error
    }

    manifest.value = data.manifest
    resolvedBranch.value = data.branch

    // Pre-fill form from manifest + URL params
    initializeForm()
  } catch (err: any) {
    error.value = err?.body?.error || 'Failed to fetch repository information'
  } finally {
    loading.value = false
  }
}

function initializeForm() {
  const m = manifest.value
  const repo = repoParam.value

  // Service name: URL param > manifest name > repo name
  const repoName = repo.split('/')[1] || repo
  serviceName.value = nameParam.value || m?.name || repoName
  // Sanitize: lowercase, replace non-alphanumeric with hyphens
  serviceName.value = serviceName.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

  // Branch
  branch.value = branchParam.value || m?.branch || resolvedBranch.value || 'main'

  // Parse URL env params: env[KEY]=value
  const urlEnvVars: Record<string, string> = {}
  for (const [key, val] of Object.entries(route.query)) {
    const match = key.match(/^env\[(.+)]$/)
    if (match && match[1] && typeof val === 'string') {
      urlEnvVars[match[1]] = val
    }
  }

  // Build env vars from manifest + URL params
  const envList: ManifestEnvVar[] = []
  const seen = new Set<string>()

  if (m?.env) {
    for (const [key, def] of Object.entries(m.env)) {
      seen.add(key)
      const isObj = typeof def === 'object'
      const generated = isObj && def.generate ? generateSecret() : ''
      envList.push({
        key,
        description: isObj ? (def.description || '') : '',
        value: urlEnvVars[key] ?? (isObj ? (def.value || generated) : def),
        required: isObj ? (def.required !== false) : true,
        generate: isObj ? !!def.generate : false,
        fromUrl: key in urlEnvVars,
      })
    }
  }

  // Add any URL env vars not in manifest
  for (const [key, val] of Object.entries(urlEnvVars)) {
    if (!seen.has(key)) {
      envList.push({
        key,
        description: '',
        value: val,
        required: false,
        generate: false,
        fromUrl: true,
      })
    }
  }

  envVars.value = envList

  // Ports
  if (m?.ports?.length) {
    ports.value = m.ports.map((p) => ({
      target: p.target,
      published: p.published ?? null,
      protocol: p.protocol || 'tcp',
    }))
  } else {
    ports.value = []
  }
}

function generateSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function regenerateEnvVar(index: number) {
  const env = envVars.value[index]
  if (env) {
    env.value = generateSecret()
  }
}

function addEnvVar() {
  envVars.value.push({ key: '', description: '', value: '', required: false, generate: false, fromUrl: false })
}

function removeEnvVar(index: number) {
  envVars.value.splice(index, 1)
}

function addPort() {
  ports.value.push({ target: 0, published: null, protocol: 'tcp' })
}

function removePort(index: number) {
  ports.value.splice(index, 1)
}

// ── Validation ───────────────────────────────────────────────────────────
const validationErrors = computed(() => {
  const errors: string[] = []
  if (!serviceName.value.trim()) errors.push('Service name is required')
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(serviceName.value)) errors.push('Service name must be lowercase alphanumeric')

  for (const env of envVars.value) {
    if (env.required && !env.value.trim()) {
      errors.push(`Environment variable "${env.key}" is required`)
    }
  }
  return errors
})

const canDeploy = computed(() => validationErrors.value.length === 0 && !deploying.value)

// ── Deploy ───────────────────────────────────────────────────────────────
async function deploy() {
  if (!canDeploy.value) return
  deploying.value = true
  error.value = ''

  try {
    // Build env vars payload
    const envPayload: Record<string, string> = {}
    for (const env of envVars.value) {
      if (env.key.trim()) envPayload[env.key.trim()] = env.value
    }

    // Build ports payload
    const portsPayload = ports.value
      .filter((p) => p.target > 0)
      .map((p) => ({
        target: p.target,
        published: p.published || p.target,
        protocol: p.protocol || 'tcp',
      }))

    // Create service
    const service = await store.createService({
      name: serviceName.value,
      image: 'ghcr.io/placeholder',
      githubRepo: repoParam.value,
      githubBranch: branch.value,
      autoDeploy: autoDeploy.value,
      sourceType: 'github',
      env: Object.keys(envPayload).length > 0 ? envPayload : undefined,
      ports: portsPayload.length > 0 ? portsPayload : undefined,
      domain: domain.value || undefined,
      replicas: replicas.value,
    } as any)

    // Trigger initial deployment
    try {
      await api.post('/deployments/trigger', { serviceId: service.id })
    } catch {
      // Service created but trigger failed — user can trigger manually
    }

    router.push(`/panel/services/${service.id}`)
  } catch (err: any) {
    error.value = err?.body?.error || err?.message || 'Deployment failed'
  } finally {
    deploying.value = false
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────
const repoUrl = computed(() => `https://github.com/${repoParam.value}`)
const repoOwner = computed(() => repoParam.value.split('/')[0] || '')
const repoName = computed(() => repoParam.value.split('/')[1] || '')
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-8">
      <Rocket class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('deployGh.title') }}</h1>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 flex flex-col items-center justify-center">
      <Loader2 class="w-8 h-8 text-primary-500 animate-spin mb-4" />
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('deployGh.fetchingRepo') }}</p>
    </div>

    <!-- Error (fatal) -->
    <div v-else-if="error && !manifest && envVars.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-center">
      <AlertTriangle class="w-12 h-12 text-red-400 mx-auto mb-4" />
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ $t('deployGh.errorTitle') }}</h2>
      <p class="text-sm text-red-600 dark:text-red-400 mb-6">{{ error }}</p>
      <RouterLink to="/panel/deploy" class="text-sm text-primary-600 dark:text-primary-400 hover:underline">
        {{ $t('deployGh.backToDeploy') }}
      </RouterLink>
    </div>

    <!-- Deploy Form -->
    <template v-else>
      <!-- Error banner -->
      <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      </div>

      <!-- Manifest warning -->
      <div v-if="manifestError" class="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-start gap-3">
        <AlertTriangle class="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
        <div>
          <p class="text-sm font-medium text-yellow-700 dark:text-yellow-300">{{ $t('deployGh.manifestWarning') }}</p>
          <p class="text-xs text-yellow-600 dark:text-yellow-400 mt-1">{{ manifestError }}</p>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <!-- Repo Card -->
        <div class="px-6 py-5 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-start gap-4">
            <div v-if="manifest?.icon" class="w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-gray-100 dark:bg-gray-700">
              <img :src="manifest.icon" :alt="manifest.name || repoName" class="w-full h-full object-cover" />
            </div>
            <div v-else class="w-12 h-12 rounded-lg bg-gray-900 dark:bg-white flex items-center justify-center shrink-0">
              <Github class="w-6 h-6 text-white dark:text-gray-900" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <h2 class="text-lg font-semibold text-gray-900 dark:text-white truncate">
                  {{ manifest?.name || repoParam }}
                </h2>
                <a :href="repoUrl" target="_blank" rel="noopener" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0">
                  <ExternalLink class="w-4 h-4" />
                </a>
              </div>
              <p v-if="manifest?.description" class="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                {{ manifest.description }}
              </p>
              <p v-else class="text-sm text-gray-400 dark:text-gray-500">
                {{ repoParam }}
              </p>
              <div class="flex items-center gap-3 mt-2">
                <span class="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                  <Globe class="w-3 h-3" />
                  {{ repoOwner }}
                </span>
                <span v-if="manifest?.website" class="text-xs">
                  <a :href="manifest.website" target="_blank" rel="noopener" class="text-primary-600 dark:text-primary-400 hover:underline">{{ $t('deployGh.website') }}</a>
                </span>
              </div>
            </div>
          </div>
          <div v-if="!manifest" class="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <div class="flex items-start gap-2">
              <Info class="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <p class="text-xs text-blue-700 dark:text-blue-300">
                {{ $t('deployGh.noManifest') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Form -->
        <div class="p-6 space-y-5">
          <!-- Service Name -->
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('deploy.serviceName') }}</label>
            <input
              v-model="serviceName"
              type="text"
              placeholder="my-app"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>

          <!-- Branch -->
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('deploy.github.branch') }}</label>
            <input
              v-model="branch"
              type="text"
              placeholder="main"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>

          <!-- Domain & Replicas -->
          <div class="grid grid-cols-2 gap-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('deploy.domainOptional') }}</label>
              <input
                v-model="domain"
                type="text"
                placeholder="app.example.com"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              />
            </div>
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
          </div>

          <!-- Auto-deploy Toggle -->
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('deploy.github.autoDeploy') }}</label>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ $t('deploy.github.autoDeployDesc') }}</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
              <input v-model="autoDeploy" type="checkbox" class="sr-only peer" />
              <div class="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
            </label>
          </div>

          <!-- Environment Variables -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('deploy.envVars') }}</label>
              <button type="button" @click="addEnvVar" class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                <Plus class="w-3.5 h-3.5" /> {{ $t('deploy.add') }}
              </button>
            </div>

            <div v-if="envVars.length" class="space-y-3">
              <div
                v-for="(env, i) in envVars"
                :key="i"
                class="rounded-lg border p-3 space-y-2"
                :class="env.required && !env.value.trim()
                  ? 'border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-900/10'
                  : 'border-gray-200 dark:border-gray-700'"
              >
                <div class="flex items-center gap-2">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <code class="text-xs font-mono font-semibold text-gray-900 dark:text-white">{{ env.key || 'KEY' }}</code>
                      <span v-if="env.required" class="text-xs text-red-500 font-medium">{{ $t('deployGh.required') }}</span>
                      <span v-if="env.generate" class="inline-flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400">
                        <KeyRound class="w-3 h-3" />
                        {{ $t('deployGh.autoGenerated') }}
                      </span>
                    </div>
                    <p v-if="env.description" class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ env.description }}</p>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <button v-if="env.generate" @click="regenerateEnvVar(i)" type="button" class="p-1 text-gray-400 hover:text-primary-500 transition-colors" :title="$t('deployGh.regenerate')">
                      <RefreshCw class="w-3.5 h-3.5" />
                    </button>
                    <button @click="removeEnvVar(i)" type="button" class="p-1 text-gray-400 hover:text-red-500 transition-colors">
                      <X class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <!-- Key input (only for user-added vars without a key) -->
                <input
                  v-if="!env.key"
                  v-model="env.key"
                  type="text"
                  :placeholder="$t('deploy.keyPlaceholder')"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                />
                <!-- Value input -->
                <input
                  v-model="env.value"
                  :type="env.generate ? 'password' : 'text'"
                  :placeholder="env.required ? $t('deployGh.requiredPlaceholder') : $t('deploy.valuePlaceholder')"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                />
              </div>
            </div>
            <p v-else class="text-xs text-gray-400 dark:text-gray-500">{{ $t('deploy.noEnvVars') }}</p>
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
                <input
                  v-model.number="port.target"
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
                  :placeholder="String(port.target || $t('deploy.hostPort'))"
                  min="1"
                  max="65535"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>
              <button type="button" @click="removePort(i)" class="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                <X class="w-4 h-4" />
              </button>
            </div>
            <p v-if="ports.length === 0" class="text-xs text-gray-400 dark:text-gray-500">{{ $t('deploy.noPorts') }}</p>
          </div>

          <!-- Validation Errors -->
          <div v-if="validationErrors.length > 0 && !deploying" class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <ul class="space-y-1">
              <li v-for="(err, i) in validationErrors" :key="i" class="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                <AlertTriangle class="w-3 h-3 shrink-0 mt-0.5" />
                {{ err }}
              </li>
            </ul>
          </div>

          <!-- Deploy Button -->
          <div class="pt-2 flex items-center justify-between">
            <RouterLink to="/panel/deploy" class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
              &larr; {{ $t('deploy.backToOptions') }}
            </RouterLink>
            <button
              @click="deploy"
              :disabled="!canDeploy"
              class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              <Loader2 v-if="deploying" class="w-4 h-4 animate-spin" />
              <Rocket v-else class="w-4 h-4" />
              {{ deploying ? $t('deploy.deploying') : $t('deploy.deploy') }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
