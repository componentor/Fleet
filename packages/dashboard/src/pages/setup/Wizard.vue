<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from '@/composables/useTheme'
import { useAuthStore } from '@/stores/auth'
import { Sun, Moon, Monitor, UserPlus, Globe, CheckCircle2, ArrowRight, ArrowLeft, Loader2, Shield, Crown, Network } from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()
const { theme, toggle } = useTheme()

// Step 0 = choose mode, steps 1-3 = leader wizard
const currentStep = ref(0)
const totalSteps = 3

// Step 1: Admin account
const name = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')

// Step 2: Platform config
const domain = ref(window.location.hostname === 'localhost' ? '' : window.location.hostname)
const platformName = ref('Hoster')

// State
const loading = ref(false)
const error = ref('')

const steps = [
  { number: 1, label: 'Admin Account', icon: UserPlus },
  { number: 2, label: 'Platform', icon: Globe },
  { number: 3, label: 'Complete', icon: CheckCircle2 },
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

const canProceed = computed(() => {
  switch (currentStep.value) {
    case 1:
      return (
        name.value.length > 0 &&
        email.value.length > 0 &&
        !emailError.value &&
        password.value.length >= 8 &&
        password.value === confirmPassword.value
      )
    case 2:
      return true
    case 3:
      return true
    default:
      return false
  }
})

function chooseLeader() {
  currentStep.value = 1
}

function chooseWorker() {
  router.push('/setup/node')
}

function nextStep() {
  error.value = ''
  if (currentStep.value === 2) {
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
    localStorage.setItem('hoster_user', JSON.stringify(data.user))
    localStorage.setItem('hoster_setup_done', 'true')
    currentStep.value = 3
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
          <h1 class="text-xl font-bold text-primary-600 dark:text-primary-400">Hoster Setup</h1>
        </div>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Set up your hosting platform in a few steps</p>
      </div>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center px-6 py-12">
      <div class="w-full max-w-3xl">

        <!-- Step 0: Choose mode -->
        <template v-if="currentStep === 0">
          <div class="text-center mb-8">
            <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Welcome to Hoster</h2>
            <p class="text-gray-500 dark:text-gray-400">How would you like to set up this server?</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <!-- Leader node -->
            <button
              @click="chooseLeader"
              class="group cursor-pointer bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary-500 dark:hover:border-primary-500 shadow-sm p-8 text-left transition-all"
            >
              <div class="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-4 group-hover:bg-primary-200 dark:group-hover:bg-primary-900/50 transition-colors">
                <Crown class="w-6 h-6 text-primary-600 dark:text-primary-400" />
              </div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Setup Leader Node</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Initialize a new Hoster platform. Create the first admin account, configure your domain, and start managing services.
              </p>
              <div class="flex items-center gap-1 mt-4 text-sm font-medium text-primary-600 dark:text-primary-400">
                Get started
                <ArrowRight class="w-4 h-4" />
              </div>
            </button>

            <!-- Worker node -->
            <button
              @click="chooseWorker"
              class="group cursor-pointer bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary-500 dark:hover:border-primary-500 shadow-sm p-8 text-left transition-all"
            >
              <div class="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mb-4 group-hover:bg-orange-200 dark:group-hover:bg-orange-900/50 transition-colors">
                <Network class="w-6 h-6 text-orange-600 dark:text-orange-400" />
              </div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Connect to Existing Node</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Join this server to an existing Hoster cluster. Install Docker, join the Swarm, and configure shared storage.
              </p>
              <div class="flex items-center gap-1 mt-4 text-sm font-medium text-orange-600 dark:text-orange-400">
                Connect node
                <ArrowRight class="w-4 h-4" />
              </div>
            </button>
          </div>
        </template>

        <!-- Leader wizard steps (1-3) -->
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

          <!-- Step 1: Admin Account -->
          <div v-if="currentStep === 1" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
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

          <!-- Step 2: Platform Configuration -->
          <div v-if="currentStep === 2" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
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
                  placeholder="Hoster"
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

          <!-- Step 3: Complete -->
          <div v-if="currentStep === 3" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
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
              </div>
            </div>
          </div>

          <!-- Navigation -->
          <div class="flex items-center justify-between mt-6">
            <button
              v-if="currentStep >= 1 && currentStep < 3"
              @click="prevStep"
              class="cursor-pointer flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              <ArrowLeft class="w-4 h-4" />
              Back
            </button>
            <div v-else></div>

            <button
              v-if="currentStep >= 1 && currentStep < 3"
              @click="nextStep"
              :disabled="!canProceed || loading"
              class="cursor-pointer flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
              <template v-if="currentStep === 2">
                {{ loading ? 'Setting up...' : 'Complete Setup' }}
              </template>
              <template v-else>
                Next
                <ArrowRight class="w-4 h-4" />
              </template>
            </button>

            <button
              v-if="currentStep === 3"
              @click="goToDashboard"
              class="cursor-pointer flex items-center gap-2 px-6 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
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
