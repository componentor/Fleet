<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Rocket, Github, FileCode2, Store, Loader2, Plus, X } from 'lucide-vue-next'
import { useServicesStore } from '@/stores/services'

const router = useRouter()
const store = useServicesStore()

const deployMethod = ref<'github' | 'docker' | null>(null)

const serviceName = ref('')
const dockerImage = ref('')
const replicas = ref(1)
const domain = ref('')
const loading = ref(false)
const error = ref('')

const repoUrl = ref('')
const branch = ref('main')
const ghServiceName = ref('')

// Shared env vars and ports for both deploy methods
const envVars = ref<{ key: string; value: string }[]>([])
const ports = ref<{ container: number | null; published: number | null }[]>([])

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
  const filtered = envVars.value.filter(e => e.key.trim())
  if (filtered.length === 0) return undefined
  const obj: Record<string, string> = {}
  for (const e of filtered) obj[e.key.trim()] = e.value
  return obj
}

function buildPortsPayload(): { container: number; published: number; protocol: string }[] | undefined {
  const filtered = ports.value.filter(p => p.container)
  if (filtered.length === 0) return undefined
  return filtered.map(p => ({
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
    error.value = err?.body?.error || err?.message || 'Deployment failed'
  } finally {
    loading.value = false
  }
}

async function deployGithub() {
  if (!repoUrl.value || !ghServiceName.value) return
  loading.value = true
  error.value = ''
  try {
    await store.createService({
      name: ghServiceName.value,
      image: 'ghcr.io/placeholder',
      githubRepo: repoUrl.value,
      githubBranch: branch.value,
      autoDeploy: true,
      envVars: buildEnvVarsPayload(),
      ports: buildPortsPayload(),
    } as any)
    router.push('/panel/services')
  } catch (err: any) {
    error.value = err?.body?.error || err?.message || 'Deployment failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Rocket class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Deploy</h1>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>

    <!-- Deploy method selection -->
    <div v-if="!deployMethod" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl">
      <button
        @click="deployMethod = 'docker'"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all group"
      >
        <div class="w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center mb-4">
          <FileCode2 class="w-6 h-6 text-white" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Docker Image</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">Deploy from a Docker Hub or private registry image.</p>
      </button>

      <button
        @click="deployMethod = 'github'"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all group"
      >
        <div class="w-12 h-12 rounded-lg bg-gray-900 dark:bg-white flex items-center justify-center mb-4">
          <Github class="w-6 h-6 text-white dark:text-gray-900" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">From GitHub</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">Deploy from a GitHub repository with automatic builds.</p>
      </button>

      <RouterLink
        to="/panel/marketplace"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-green-300 dark:hover:border-green-600 hover:shadow-md transition-all group"
      >
        <div class="w-12 h-12 rounded-lg bg-green-600 flex items-center justify-center mb-4">
          <Store class="w-6 h-6 text-white" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">From Marketplace</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">Deploy a pre-configured app from the marketplace.</p>
      </RouterLink>
    </div>

    <!-- Docker image deploy form -->
    <div v-if="deployMethod === 'docker'" class="max-w-2xl">
      <button @click="deployMethod = null; error = ''" class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition-colors">
        &larr; Back to options
      </button>
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Deploy Docker Image</h2>
        </div>
        <form @submit.prevent="deployDocker" class="p-6 space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Service Name</label>
            <input v-model="serviceName" type="text" placeholder="my-app" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Docker Image</label>
            <input v-model="dockerImage" type="text" placeholder="nginx:latest" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
          </div>
          <div class="grid grid-cols-2 gap-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Replicas</label>
              <input v-model.number="replicas" type="number" min="1" max="100" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Domain (optional)</label>
              <input v-model="domain" type="text" placeholder="app.example.com" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
            </div>
          </div>

          <!-- Environment Variables -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Environment Variables</label>
              <button type="button" @click="addEnvVar" class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                <Plus class="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <div v-for="(env, i) in envVars" :key="i" class="flex items-center gap-2 mb-2">
              <input v-model="env.key" type="text" placeholder="KEY" class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
              <input v-model="env.value" type="text" placeholder="value" class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
              <button type="button" @click="removeEnvVar(i)" class="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                <X class="w-4 h-4" />
              </button>
            </div>
            <p v-if="envVars.length === 0" class="text-xs text-gray-400 dark:text-gray-500">No environment variables configured.</p>
          </div>

          <!-- Port Mappings -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Port Mappings</label>
              <button type="button" @click="addPort" class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                <Plus class="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <div v-for="(port, i) in ports" :key="i" class="flex items-center gap-2 mb-2">
              <div class="flex-1">
                <input v-model.number="port.container" type="number" placeholder="Container port" min="1" max="65535" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
              </div>
              <span class="text-gray-400 dark:text-gray-500 text-sm shrink-0">:</span>
              <div class="flex-1">
                <input v-model.number="port.published" type="number" :placeholder="String(port.container || 'Host port')" min="1" max="65535" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
              </div>
              <button type="button" @click="removePort(i)" class="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                <X class="w-4 h-4" />
              </button>
            </div>
            <p v-if="ports.length === 0" class="text-xs text-gray-400 dark:text-gray-500">No ports exposed. Add a port mapping to make the service accessible.</p>
          </div>

          <div class="pt-2 flex justify-end">
            <button type="submit" :disabled="loading || !serviceName || !dockerImage" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
              <Rocket v-else class="w-4 h-4" />
              {{ loading ? 'Deploying...' : 'Deploy' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- GitHub deploy form -->
    <div v-if="deployMethod === 'github'" class="max-w-2xl">
      <button @click="deployMethod = null; error = ''" class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition-colors">
        &larr; Back to options
      </button>
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Deploy from GitHub</h2>
        </div>
        <form @submit.prevent="deployGithub" class="p-6 space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Service Name</label>
            <input v-model="ghServiceName" type="text" placeholder="my-app" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Repository URL</label>
            <input v-model="repoUrl" type="url" placeholder="https://github.com/user/repo" required class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Branch</label>
            <input v-model="branch" type="text" placeholder="main" class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
          </div>

          <!-- Environment Variables -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Environment Variables</label>
              <button type="button" @click="addEnvVar" class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                <Plus class="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <div v-for="(env, i) in envVars" :key="i" class="flex items-center gap-2 mb-2">
              <input v-model="env.key" type="text" placeholder="KEY" class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
              <input v-model="env.value" type="text" placeholder="value" class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono" />
              <button type="button" @click="removeEnvVar(i)" class="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                <X class="w-4 h-4" />
              </button>
            </div>
            <p v-if="envVars.length === 0" class="text-xs text-gray-400 dark:text-gray-500">No environment variables configured.</p>
          </div>

          <!-- Port Mappings -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Port Mappings</label>
              <button type="button" @click="addPort" class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                <Plus class="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <div v-for="(port, i) in ports" :key="i" class="flex items-center gap-2 mb-2">
              <div class="flex-1">
                <input v-model.number="port.container" type="number" placeholder="Container port" min="1" max="65535" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
              </div>
              <span class="text-gray-400 dark:text-gray-500 text-sm shrink-0">:</span>
              <div class="flex-1">
                <input v-model.number="port.published" type="number" :placeholder="String(port.container || 'Host port')" min="1" max="65535" class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm" />
              </div>
              <button type="button" @click="removePort(i)" class="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                <X class="w-4 h-4" />
              </button>
            </div>
            <p v-if="ports.length === 0" class="text-xs text-gray-400 dark:text-gray-500">No ports exposed.</p>
          </div>

          <div class="pt-2 flex justify-end">
            <button type="submit" :disabled="loading || !repoUrl || !ghServiceName" class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
              <Rocket v-else class="w-4 h-4" />
              {{ loading ? 'Deploying...' : 'Deploy' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
