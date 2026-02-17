<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from '@/composables/useTheme'
import { useAuthStore } from '@/stores/auth'
import {
  Sun, Moon, Monitor, UserPlus, Globe, CheckCircle2, ArrowRight, ArrowLeft,
  Loader2, Shield, Crown, Network, Container, AlertTriangle, RefreshCw,
} from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()
const { theme, toggle } = useTheme()

// Step 0 = choose mode, 1 = Docker/Swarm, 2 = Admin Account, 3 = Platform, 4 = Complete
const currentStep = ref(0)
const totalSteps = 4

// Docker detection state
interface DockerState {
  available: boolean
  swarm: 'active' | 'inactive' | 'pending' | 'error'
  role?: 'manager' | 'worker'
  nodeId?: string
}
const dockerState = ref<DockerState | null>(null)
const dockerLoading = ref(false)
const swarmInitLoading = ref(false)

// Step 2: Admin account
const name = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')

// Step 3: Platform config
const domain = ref(window.location.hostname === 'localhost' ? '' : window.location.hostname)
const platformName = ref('Fleet')

// State
const loading = ref(false)
const error = ref('')

const steps = [
  { number: 1, label: 'Docker', icon: Container },
  { number: 2, label: 'Admin Account', icon: UserPlus },
  { number: 3, label: 'Platform', icon: Globe },
  { number: 4, label: 'Complete', icon: CheckCircle2 },
]

const passwordError = computed(() => {
  if (!password.value) return ''
  if (password.value.length < 8) return 'Password must be at least 8 characters'
  if (confirmPassword.value && password.value !== confirmPassword.value) return 'Passwords do not match'
  return ''
})

const emailError = computed(() => {
  if (!email.value) return ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) return 'Invalid email address'
  return ''
})

const dockerSkipped = ref(false)

const canProceed = computed(() => {
  switch (currentStep.value) {
    case 1:
      return dockerSkipped.value || (dockerState.value?.available && dockerState.value?.swarm === 'active')
    case 2:
      return (
        name.value.length > 0 &&
        email.value.length > 0 &&
        !emailError.value &&
        password.value.length >= 8 &&
        password.value === confirmPassword.value
      )
    case 3:
      return true
    case 4:
      return true
    default:
      return false
  }
})

async function detectDocker() {
  dockerLoading.value = true
  try {
    const res = await fetch('/api/v1/setup/status')
    const data = await res.json()
    dockerState.value = data.docker ?? null
  } catch {
    dockerState.value = { available: false, swarm: 'inactive' }
  } finally {
    dockerLoading.value = false
  }
}

async function initSwarm() {
  swarmInitLoading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/v1/setup/swarm-init', { method: 'POST' })
    const data = await res.json()
    if (!res.ok) {
      error.value = data.error || 'Failed to initialize Swarm'
      return
    }
    dockerState.value = data.docker ?? { available: true, swarm: 'active', role: 'manager' }
  } catch (e: any) {
    error.value = e.message || 'Failed to initialize Swarm'
  } finally {
    swarmInitLoading.value = false
  }
}

function chooseLeader() {
  currentStep.value = 1
  detectDocker()
}

function chooseWorker() {
  router.push('/setup/node')
}

function nextStep() {
  error.value = ''
  if (currentStep.value === 3) {
    performSetup()
  } else if (currentStep.value < totalSteps) {
    currentStep.value++
  }
}

function prevStep() {
  error.value = ''
  if (currentStep.value > 1) {
    currentStep.value--
  } else if (currentStep.value === 1) {
    currentStep.value = 0
  }
}

async function performSetup() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/v1/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.value,
        email: email.value,
        password: password.value,
        domain: domain.value || undefined,
        platformName: platformName.value || undefined,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      error.value = data.error || 'Setup failed'
      return
    }

    // Store tokens (auto-login)
    authStore.setTokens(data.tokens)
    localStorage.setItem('fleet_user', JSON.stringify(data.user))
    localStorage.setItem('fleet_setup_done', 'true')
    currentStep.value = 4
  } catch (e: any) {
    error.value = e.message || 'Setup failed'
  } finally {
    loading.value = false
  }
}

async function goToDashboard() {
  await authStore.loadUser()
  await router.push('/admin')
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
    <!-- Theme toggle -->
    <button
      @click="toggle"
      class="fixed top-4 right-4 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors z-10"
      :title="`Theme: ${theme}`"
    >
      <Sun v-if="theme === 'light'" class="w-5 h-5" />
      <Moon v-else-if="theme === 'dark'" class="w-5 h-5" />
      <Monitor v-else class="w-5 h-5" />
    </button>

    <!-- Header -->
    <div class="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div class="max-w-3xl mx-auto px-6 py-4">
        <div class="flex items-center gap-2">
          <Shield class="w-6 h-6 text-primary-600 dark:text-primary-400" />
          <h1 class="text-xl font-bold text-primary-600 dark:text-primary-400">Fleet Setup</h1>
        </div>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Set up your hosting platform in a few steps</p>
      </div>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center px-6 py-12">
      <div class="w-full max-w-3xl">

        <!-- Step 0: Choose mode -->
        <template v-if="currentStep === 0">
          <div class="text-center mb-8">
            <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Welcome to Fleet</h2>
            <p class="text-gray-500 dark:text-gray-400">How would you like to set up this server?</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <button
              @click="chooseLeader"
              class="group bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary-500 dark:hover:border-primary-500 shadow-sm p-8 text-left transition-all"
            >
              <div class="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-4 group-hover:bg-primary-200 dark:group-hover:bg-primary-900/50 transition-colors">
                <Crown class="w-6 h-6 text-primary-600 dark:text-primary-400" />
              </div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Setup Leader Node</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Initialize a new Fleet platform. Create the first admin account, configure your domain, and start managing services.
              </p>
              <div class="flex items-center gap-1 mt-4 text-sm font-medium text-primary-600 dark:text-primary-400">
                Get started
                <ArrowRight class="w-4 h-4" />
              </div>
            </button>

            <button
              @click="chooseWorker"
              class="group bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary-500 dark:hover:border-primary-500 shadow-sm p-8 text-left transition-all"
            >
              <div class="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mb-4 group-hover:bg-orange-200 dark:group-hover:bg-orange-900/50 transition-colors">
                <Network class="w-6 h-6 text-orange-600 dark:text-orange-400" />
              </div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Connect to Existing Node</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Join this server to an existing Fleet cluster. Install Docker, join the Swarm, and configure shared storage.
              </p>
              <div class="flex items-center gap-1 mt-4 text-sm font-medium text-orange-600 dark:text-orange-400">
                Connect node
                <ArrowRight class="w-4 h-4" />
              </div>
            </button>
          </div>
        </template>

        <!-- Leader wizard steps (1-4) -->
        <template v-if="currentStep >= 1">
          <!-- Step indicator -->
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
                    <component
                      :is="currentStep > step.number ? CheckCircle2 : step.icon"
                      class="w-5 h-5"
                    />
                  </div>
                  <span
                    :class="[
                      'text-sm font-medium hidden sm:inline',
                      currentStep >= step.number
                        ? 'text-gray-900 dark:text-white'
                        : 'text-gray-500 dark:text-gray-400'
                    ]"
                  >
                    {{ step.label }}
                  </span>
                </div>
                <div
                  v-if="index < steps.length - 1"
                  :class="[
                    'flex-1 h-0.5 mx-4',
                    currentStep > step.number
                      ? 'bg-primary-600'
                      : 'bg-gray-200 dark:bg-gray-700'
                  ]"
                ></div>
              </template>
            </div>
          </div>

          <!-- Error -->
          <div v-if="error" class="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
          </div>

          <!-- Step 1: Docker & Swarm -->
          <div v-if="currentStep === 1" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Docker & Swarm</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Fleet uses Docker Swarm to orchestrate your services.</p>
            </div>
            <div class="p-6 space-y-5">
              <!-- Loading -->
              <div v-if="dockerLoading" class="flex items-center justify-center py-8 gap-3 text-gray-500 dark:text-gray-400">
                <Loader2 class="w-5 h-5 animate-spin" />
                <span class="text-sm">Detecting Docker...</span>
              </div>

              <template v-else-if="dockerState">
                <!-- Docker status -->
                <div class="flex items-center gap-3 p-4 rounded-lg" :class="dockerState.available ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'">
                  <CheckCircle2 v-if="dockerState.available" class="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
                  <AlertTriangle v-else class="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
                  <div>
                    <p class="text-sm font-medium" :class="dockerState.available ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'">
                      {{ dockerState.available ? 'Docker is installed and running' : 'Docker is not available' }}
                    </p>
                    <p v-if="!dockerState.available" class="text-xs text-red-600 dark:text-red-400 mt-1">
                      Install Docker first: <code class="bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded">curl -fsSL https://get.docker.com | sh</code>
                    </p>
                  </div>
                </div>

                <!-- Swarm status -->
                <div v-if="dockerState.available" class="flex items-center gap-3 p-4 rounded-lg" :class="dockerState.swarm === 'active' ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'">
                  <CheckCircle2 v-if="dockerState.swarm === 'active'" class="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
                  <AlertTriangle v-else class="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
                  <div class="flex-1">
                    <p class="text-sm font-medium" :class="dockerState.swarm === 'active' ? 'text-green-800 dark:text-green-300' : 'text-yellow-800 dark:text-yellow-300'">
                      <template v-if="dockerState.swarm === 'active'">
                        Swarm is active ({{ dockerState.role ?? 'manager' }})
                      </template>
                      <template v-else>
                        Docker Swarm is not initialized
                      </template>
                    </p>
                    <p v-if="dockerState.swarm === 'active' && dockerState.nodeId" class="text-xs text-green-600 dark:text-green-400 mt-0.5">
                      Node ID: {{ dockerState.nodeId }}
                    </p>
                  </div>
                  <button
                    v-if="dockerState.swarm !== 'active'"
                    @click="initSwarm"
                    :disabled="swarmInitLoading"
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                  >
                    <Loader2 v-if="swarmInitLoading" class="w-3.5 h-3.5 animate-spin" />
                    {{ swarmInitLoading ? 'Initializing...' : 'Initialize Swarm' }}
                  </button>
                </div>

                <!-- Refresh & Skip -->
                <div v-if="!dockerState.available || dockerState.swarm !== 'active'" class="flex flex-col items-center gap-3">
                  <button
                    @click="detectDocker"
                    :disabled="dockerLoading"
                    class="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                  >
                    <RefreshCw class="w-4 h-4" />
                    Re-check
                  </button>
                  <button
                    @click="dockerSkipped = true; nextStep()"
                    class="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline underline-offset-2 transition-colors"
                  >
                    Skip — I'll configure Docker later
                  </button>
                </div>
              </template>
            </div>
          </div>

          <!-- Step 2: Admin Account -->
          <div v-if="currentStep === 2" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Create Admin Account</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">This will be the super administrator of your platform.</p>
            </div>
            <div class="p-6 space-y-5">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Full Name</label>
                <input
                  v-model="name"
                  type="text"
                  placeholder="John Doe"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email Address</label>
                <input
                  v-model="email"
                  type="email"
                  placeholder="admin@example.com"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
                <p v-if="emailError" class="mt-1 text-xs text-red-500">{{ emailError }}</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Password</label>
                <input
                  v-model="password"
                  type="password"
                  placeholder="Minimum 8 characters"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Confirm Password</label>
                <input
                  v-model="confirmPassword"
                  type="password"
                  placeholder="Repeat your password"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
                <p v-if="passwordError" class="mt-1 text-xs text-red-500">{{ passwordError }}</p>
              </div>
            </div>
          </div>

          <!-- Step 3: Platform Configuration -->
          <div v-if="currentStep === 3" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Platform Configuration</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Basic platform settings. You can change these later in admin settings.</p>
            </div>
            <div class="p-6 space-y-5">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Platform Name</label>
                <input
                  v-model="platformName"
                  type="text"
                  placeholder="Fleet"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Platform Domain</label>
                <input
                  v-model="domain"
                  type="text"
                  placeholder="panel.example.com"
                  class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">Leave empty for localhost development. Can be changed later.</p>
              </div>
              <div class="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <p class="text-sm text-blue-700 dark:text-blue-300">A secure JWT secret will be auto-generated for signing authentication tokens.</p>
              </div>
            </div>
          </div>

          <!-- Step 4: Complete -->
          <div v-if="currentStep === 4" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="p-12 text-center">
              <CheckCircle2 class="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Setup Complete</h2>
              <p class="text-gray-500 dark:text-gray-400 text-sm max-w-md mx-auto mb-6">
                Your platform is ready. You're logged in as the super administrator.
              </p>
              <div class="inline-flex flex-col items-start gap-2 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-6 py-4">
                <div><span class="font-medium text-gray-900 dark:text-white">Admin:</span> {{ email }}</div>
                <div v-if="domain"><span class="font-medium text-gray-900 dark:text-white">Domain:</span> {{ domain }}</div>
                <div v-if="platformName"><span class="font-medium text-gray-900 dark:text-white">Platform:</span> {{ platformName }}</div>
                <div v-if="dockerState?.swarm === 'active'">
                  <span class="font-medium text-gray-900 dark:text-white">Swarm:</span> Active ({{ dockerState.role ?? 'manager' }})
                </div>
                <div v-else-if="dockerSkipped" class="text-yellow-600 dark:text-yellow-400">
                  <span class="font-medium text-gray-900 dark:text-white">Docker:</span> Skipped — configure in Admin Settings
                </div>
              </div>
            </div>
          </div>

          <!-- Navigation -->
          <div class="flex items-center justify-between mt-6">
            <button
              v-if="currentStep >= 1 && currentStep < 4"
              @click="prevStep"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              <ArrowLeft class="w-4 h-4" />
              Back
            </button>
            <div v-else></div>

            <button
              v-if="currentStep >= 1 && currentStep < 4"
              @click="nextStep"
              :disabled="!canProceed || loading"
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
              <template v-if="currentStep === 3">
                {{ loading ? 'Setting up...' : 'Complete Setup' }}
              </template>
              <template v-else>
                Next
                <ArrowRight class="w-4 h-4" />
              </template>
            </button>

            <button
              v-if="currentStep === 4"
              @click="goToDashboard"
              class="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
            >
              Go to Admin Dashboard
              <ArrowRight class="w-4 h-4" />
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
