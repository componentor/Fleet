<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from '@/composables/useTheme'
import { Sun, Moon, Monitor, Server, Key, HardDrive, CheckCircle2, ArrowRight, ArrowLeft, Loader2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const router = useRouter()
const { theme, toggle } = useTheme()

const currentStep = ref(1)
const totalSteps = 4

const joinToken = ref('')
const managerAddress = ref('')
const nfsServer = ref('')
const nfsPath = ref('/exports/fleet')
const loading = ref(false)
const error = ref('')

const steps = computed(() => [
  { number: 1, label: t('setup.installDockerStep'), icon: Server },
  { number: 2, label: t('setup.joinSwarmStep'), icon: Key },
  { number: 3, label: t('setup.configureNfs'), icon: HardDrive },
  { number: 4, label: t('setup.stepComplete'), icon: CheckCircle2 },
])

const canProceed = computed(() => {
  switch (currentStep.value) {
    case 1: return true
    case 2: return joinToken.value.length > 0 && managerAddress.value.length > 0
    case 3: return nfsServer.value.length > 0 && nfsPath.value.length > 0
    case 4: return true
    default: return false
  }
})

function nextStep() {
  if (currentStep.value < totalSteps) {
    currentStep.value++
  }
}

function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value--
  }
}

async function completeSetup() {
  loading.value = true
  error.value = ''
  try {
    localStorage.setItem('fleet_setup_complete', 'true')
    await router.push('/panel')
  } catch (e: any) {
    error.value = e.message || 'Setup failed'
  } finally {
    loading.value = false
  }
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
        <h1 class="text-xl font-bold text-primary-600 dark:text-primary-400">{{ $t('setup.title') }}</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{{ $t('setup.configureHosting') }}</p>
      </div>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center px-6 py-12">
      <div class="w-full max-w-3xl">
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

        <!-- Step 1: Install Docker -->
        <div v-if="currentStep === 1" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('setup.installDockerStep') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('setup.ensureDocker') }}</p>
          </div>
          <div class="p-6 space-y-4">
            <p class="text-sm text-gray-600 dark:text-gray-400">{{ $t('setup.runJoinScript') }}</p>
            <div class="bg-gray-900 rounded-lg p-4 font-mono text-sm text-green-400 overflow-x-auto">
              <code>sudo bash join.sh</code>
            </div>
            <div class="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <p class="text-sm text-blue-700 dark:text-blue-300">{{ $t('setup.joinScriptNote') }}</p>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('setup.manualDockerNote') }}</p>
            <div class="bg-gray-900 rounded-lg p-4 font-mono text-sm text-green-400 overflow-x-auto">
              <code>curl -fsSL https://get.docker.com | sh</code>
            </div>
          </div>
        </div>

        <!-- Step 2: Join Swarm -->
        <div v-if="currentStep === 2" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('setup.joinSwarmStep') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('setup.connectSwarm') }}</p>
          </div>
          <div class="p-6 space-y-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('setup.joinToken') }}</label>
              <input
                v-model="joinToken"
                type="text"
                placeholder="SWMTKN-1-..."
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              />
              <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">{{ $t('setup.joinTokenHint') }} <code class="text-gray-500 dark:text-gray-400">docker swarm join-token worker</code></p>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('setup.managerAddress') }}</label>
              <input
                v-model="managerAddress"
                type="text"
                placeholder="192.168.1.100:2377"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              />
            </div>
          </div>
        </div>

        <!-- Step 3: Configure NFS -->
        <div v-if="currentStep === 3" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('setup.configureNfs') }}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ $t('setup.nfsDesc') }}</p>
          </div>
          <div class="p-6 space-y-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('setup.nfsServer') }}</label>
              <input
                v-model="nfsServer"
                type="text"
                placeholder="192.168.1.50"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('setup.nfsPath') }}</label>
              <input
                v-model="nfsPath"
                type="text"
                placeholder="/exports/fleet"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
              />
            </div>
          </div>
        </div>

        <!-- Step 4: Complete -->
        <div v-if="currentStep === 4" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="p-12 text-center">
            <CheckCircle2 class="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">{{ $t('setup.nodeComplete') }}</h2>
            <p class="text-gray-500 dark:text-gray-400 text-sm max-w-md mx-auto">
              {{ $t('setup.nodeCompleteDesc') }}
            </p>
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
            {{ $t('setup.back') }}
          </button>
          <div v-else></div>

          <button
            v-if="currentStep < totalSteps"
            @click="nextStep"
            :disabled="!canProceed"
            class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {{ $t('setup.next') }}
            <ArrowRight class="w-4 h-4" />
          </button>

          <button
            v-if="currentStep === totalSteps"
            @click="completeSetup"
            :disabled="loading"
            class="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
            <CheckCircle2 v-else class="w-4 h-4" />
            {{ loading ? $t('setup.finishing') : $t('setup.completeSetup') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
