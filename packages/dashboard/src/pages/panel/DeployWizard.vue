<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import {
  ArrowLeft, ArrowRight, Rocket, Loader2, CheckCircle2,
  Eye, EyeOff, Copy, RefreshCw, AlertTriangle, Database,
  Server, Globe, Shield, Cpu, HardDrive, Check, ExternalLink,
  Package, Info, ChevronDown,
} from 'lucide-vue-next'

const props = defineProps<{ slug: string }>()
const api = useApi()
const router = useRouter()

// ── Step management ──
const currentStep = ref(1)
const steps = [
  { number: 1, label: 'Overview', icon: Package },
  { number: 2, label: 'Configure', icon: Shield },
  { number: 3, label: 'Resources', icon: Cpu },
  { number: 4, label: 'Deploy', icon: Rocket },
]

// ── Template data ──
const template = ref<any>(null)
const templateLoading = ref(true)
const templateError = ref('')

// ── Step 2: Configuration ──
const config = ref<Record<string, string>>({})
const showPassword = ref<Record<string, boolean>>({})
const copied = ref<Record<string, boolean>>({})

// ── Step 3: Resources ──
const serviceResources = ref<Record<string, { replicas: number; cpuLimit: number; memoryLimit: number }>>({})
const resourceLimits = ref<any>(null)
const pricingConfig = ref<any>(null)

// ── Step 1: Image versions ──
const imageVersions = ref<Record<string, string>>({})
const availableTags = ref<Record<string, string[]>>({})
const tagsLoading = ref<Record<string, boolean>>({})

// ── Step 4/5: Deploy & Progress ──
const deploying = ref(false)
const deployed = ref(false)
const stackId = ref('')
const deployedServices = ref<any[]>([])
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)
const deployError = ref('')
const overallStatus = ref('')

// ── Computed: Variable groups ──
const appVariables = computed(() => {
  if (!template.value?.variables) return []
  return (template.value.variables as any[]).filter(
    (v: any) => v.type !== 'password' && !v.generate
  )
})

const securityVariables = computed(() => {
  if (!template.value?.variables) return []
  return (template.value.variables as any[]).filter(
    (v: any) => v.type === 'password' || v.generate
  )
})

const serviceDefinitions = computed(() => {
  return template.value?.serviceDefinitions ?? []
})

// ── Computed: Validation ──
const canProceed = computed(() => {
  if (currentStep.value === 1) return !!template.value
  if (currentStep.value === 2) {
    // Check all required variables have values
    const vars = template.value?.variables ?? []
    for (const v of vars) {
      if (v.required !== false && !v.generate && !config.value[v.name]?.trim()) {
        return false
      }
    }
    return true
  }
  return true
})

// ── Cost estimate ──
const estimatedMonthlyCost = computed(() => {
  if (!pricingConfig.value) return null
  const rates = pricingConfig.value
  const hasPricing = (rates.cpuCentsPerHour || 0) > 0
    || (rates.memoryCentsPerGbHour || 0) > 0
    || (rates.containerCentsPerHour || 0) > 0
  if (!hasPricing) return null

  let totalCents = 0
  const hoursPerMonth = 730

  const entries = Object.entries(serviceResources.value)
  if (entries.length === 0) {
    totalCents += hoursPerMonth * (rates.containerCentsPerHour || 0)
  } else {
    for (const [, res] of entries) {
      const r = res as { replicas: number; cpuLimit: number; memoryLimit: number }
      const replicas = r.replicas || 1
      const cpuCores = (r.cpuLimit || 0) / 1000
      totalCents += cpuCores * replicas * hoursPerMonth * (rates.cpuCentsPerHour || 0)
      const memGb = (r.memoryLimit || 0) / 1024
      totalCents += memGb * replicas * hoursPerMonth * (rates.memoryCentsPerGbHour || 0)
      totalCents += replicas * hoursPerMonth * (rates.containerCentsPerHour || 0)
    }
  }

  return Math.round(totalCents) / 100
})

// ── Service role descriptions ──
function getServiceRole(svc: any): string {
  const img = (svc.image ?? '').toLowerCase()
  if (/postgres/.test(img)) return 'PostgreSQL Database'
  if (/mysql/.test(img)) return 'MySQL Database'
  if (/mariadb/.test(img)) return 'MariaDB Database'
  if (/mongo/.test(img)) return 'MongoDB Database'
  if (/redis|valkey/.test(img)) return 'Redis Cache'
  if (/clickhouse/.test(img)) return 'ClickHouse Analytics DB'
  return 'Application'
}

function getServiceIcon(svc: any) {
  const img = (svc.image ?? '').toLowerCase()
  if (/postgres|mysql|mariadb|mongo|clickhouse/.test(img)) return Database
  if (/redis|valkey/.test(img)) return HardDrive
  return Server
}

// ── Password generation ──
function generatePassword(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function regeneratePassword(name: string) {
  config.value[name] = generatePassword()
}

async function copyToClipboard(name: string) {
  try {
    await navigator.clipboard.writeText(config.value[name] ?? '')
    copied.value[name] = true
    setTimeout(() => { copied.value[name] = false }, 2000)
  } catch {}
}

// ── Fetch image tags from Docker Hub ──
async function fetchImageTags(serviceName: string, image: string) {
  tagsLoading.value[serviceName] = true
  try {
    const imageBase = image.split(':')[0]!
    const result = await api.get<{ tags: string[]; defaultTag: string }>(
      `/marketplace/image-tags?image=${encodeURIComponent(image)}`,
    )
    // Build full image:tag strings for the dropdown
    availableTags.value[serviceName] = result.tags.map((tag) => `${imageBase}:${tag}`)
  } catch {
    // Graceful fallback — just show the default
    availableTags.value[serviceName] = [image]
  } finally {
    tagsLoading.value[serviceName] = false
  }
}

// ── Fetch template ──
async function fetchTemplate() {
  templateLoading.value = true
  templateError.value = ''
  try {
    const details = await api.get<any>(`/marketplace/templates/${props.slug}`)
    template.value = details

    // Pre-fill config with defaults and generated passwords
    const vars = details.variables ?? []
    const cfg: Record<string, string> = {}
    for (const v of vars) {
      if (v.generate) {
        cfg[v.name] = generatePassword()
      } else if (v.default !== undefined && v.default !== '') {
        cfg[v.name] = String(v.default)
      } else {
        cfg[v.name] = ''
      }
    }
    config.value = cfg

    // Pre-fill service resources and image versions
    const resources: Record<string, { replicas: number; cpuLimit: number; memoryLimit: number }> = {}
    for (const svc of (details.serviceDefinitions ?? [])) {
      resources[svc.name] = { replicas: 1, cpuLimit: 0, memoryLimit: 0 }
      imageVersions.value[svc.name] = svc.image
      // Fetch available tags in parallel (fire-and-forget)
      fetchImageTags(svc.name, svc.image)
    }
    serviceResources.value = resources
  } catch (err: any) {
    templateError.value = err?.message ?? 'Failed to load template'
  } finally {
    templateLoading.value = false
  }
}

async function fetchLimitsAndPricing() {
  try {
    const [limits, billingConfig] = await Promise.all([
      api.get<any>('/billing/resource-limits').catch(() => null),
      api.get<any>('/billing/config').catch(() => null),
    ])
    resourceLimits.value = limits
    pricingConfig.value = billingConfig?.pricingConfig ?? null
  } catch {}
}

// ── Navigation ──
function nextStep() {
  if (currentStep.value < 4) {
    currentStep.value++
  }
}

function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value--
  }
}

function goBack() {
  router.push({ name: 'panel-marketplace' })
}

// ── Deploy ──
async function executeDeploy() {
  deploying.value = true
  deployError.value = ''
  try {
    const deployConfig: Record<string, string> = {}
    for (const [key, val] of Object.entries(config.value)) {
      if (val.trim()) deployConfig[key] = val.trim()
    }

    const resourceOverrides: Record<string, any> = {}
    for (const [name, res] of Object.entries(serviceResources.value)) {
      if (res.replicas !== 1 || res.cpuLimit > 0 || res.memoryLimit > 0) {
        resourceOverrides[name] = {}
        if (res.replicas !== 1) resourceOverrides[name].replicas = res.replicas
        if (res.cpuLimit > 0) resourceOverrides[name].cpuLimit = res.cpuLimit
        if (res.memoryLimit > 0) resourceOverrides[name].memoryLimit = res.memoryLimit
      }
    }

    // Build image overrides for services where user changed the version
    const imageOverrides: Record<string, string> = {}
    for (const svc of serviceDefinitions.value) {
      const selected = imageVersions.value[svc.name]
      if (selected && selected !== svc.image) {
        imageOverrides[svc.name] = selected
      }
    }

    const result = await api.post<any>('/marketplace/deploy', {
      slug: props.slug,
      config: deployConfig,
      ...(Object.keys(imageOverrides).length > 0 ? { imageOverrides } : {}),
      ...(Object.keys(resourceOverrides).length > 0 ? { resourceOverrides } : {}),
    })

    stackId.value = result.stackId
    deployed.value = true
    deployedServices.value = (result.services ?? []).map((s: any) => ({
      ...s,
      status: s.dockerServiceId ? 'deploying' : 'failed',
    }))

    // Start polling for progress
    startPolling()
  } catch (err: any) {
    deployError.value = err?.body?.error || err?.message || 'Deployment failed'
  } finally {
    deploying.value = false
  }
}

function startPolling() {
  pollTimer.value = setInterval(async () => {
    try {
      const status = await api.get<any>(`/services/stack/${stackId.value}/status`)
      deployedServices.value = status.services ?? []
      overallStatus.value = status.overall

      if (status.overall === 'running' || status.overall === 'failed' || status.overall === 'partial') {
        stopPolling()
      }
    } catch {}
  }, 2000)
}

function stopPolling() {
  if (pollTimer.value) {
    clearInterval(pollTimer.value)
    pollTimer.value = null
  }
}

function goToServices() {
  router.push({ name: 'panel-services' })
}

function goToServiceDetail(serviceId: string) {
  router.push({ name: 'panel-service-detail', params: { id: serviceId } })
}

onMounted(() => {
  fetchTemplate()
  fetchLimitsAndPricing()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center gap-3 mb-8">
      <button
        @click="goBack"
        class="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>
      <Rocket class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Deploy {{ template?.name ?? '...' }}</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400">Step-by-step deployment wizard</p>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="templateLoading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <!-- Error -->
    <div v-else-if="templateError" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <AlertTriangle class="w-12 h-12 text-red-400 mx-auto mb-4" />
      <p class="text-sm text-red-600 dark:text-red-400">{{ templateError }}</p>
      <button @click="goBack" class="mt-4 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors">
        Back to Marketplace
      </button>
    </div>

    <template v-else-if="template">
      <!-- Step indicator -->
      <div class="mb-10" v-if="!deployed">
        <div class="flex items-center justify-between">
          <template v-for="(step, index) in steps" :key="step.number">
            <div class="flex items-center gap-2">
              <div
                :class="[
                  'w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300',
                  currentStep > step.number
                    ? 'bg-green-500 text-white'
                    : currentStep === step.number
                      ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/25'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                ]"
              >
                <CheckCircle2
                  v-if="currentStep > step.number"
                  class="w-5 h-5"
                />
                <component
                  v-else
                  :is="step.icon"
                  class="w-5 h-5"
                />
              </div>
              <span
                :class="[
                  'text-sm font-medium hidden sm:inline transition-colors',
                  currentStep >= step.number
                    ? 'text-gray-900 dark:text-white'
                    : 'text-gray-400 dark:text-gray-500'
                ]"
              >
                {{ step.label }}
              </span>
            </div>
            <div
              v-if="index < steps.length - 1"
              :class="[
                'flex-1 h-0.5 mx-4 transition-colors duration-300',
                currentStep > step.number
                  ? 'bg-green-500'
                  : 'bg-gray-200 dark:bg-gray-700'
              ]"
            ></div>
          </template>
        </div>
      </div>

      <!-- Step 1: Overview -->
      <div v-if="currentStep === 1 && !deployed" class="space-y-6">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-5 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-4">
              <div class="w-14 h-14 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center shrink-0">
                <img v-if="template.iconUrl" :src="template.iconUrl" class="w-8 h-8 rounded" :alt="template.name" />
                <Package v-else class="w-7 h-7 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h2 class="text-xl font-bold text-gray-900 dark:text-white">{{ template.name }}</h2>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{{ template.description }}</p>
              </div>
            </div>
          </div>

          <div class="p-6">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">What's included</h3>
            <div class="grid gap-3">
              <div
                v-for="svc in serviceDefinitions"
                :key="svc.name"
                class="flex items-center gap-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-700"
              >
                <div class="w-10 h-10 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 flex items-center justify-center shrink-0">
                  <component :is="getServiceIcon(svc)" class="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-gray-900 dark:text-white">{{ svc.name }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ getServiceRole(svc) }}</p>
                </div>
                <div class="shrink-0 flex items-center gap-1.5">
                  <div v-if="(availableTags[svc.name]?.length ?? 0) > 1" class="relative">
                    <select
                      v-model="imageVersions[svc.name]"
                      class="appearance-none text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded pl-2.5 pr-7 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent cursor-pointer"
                    >
                      <option v-for="tag in availableTags[svc.name]" :key="tag" :value="tag">{{ tag }}</option>
                    </select>
                    <ChevronDown class="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  </div>
                  <span v-else-if="tagsLoading[svc.name]" class="flex items-center gap-1.5 text-xs font-mono text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2.5 py-1.5 rounded">
                    {{ svc.image }}
                    <Loader2 class="w-3 h-3 animate-spin" />
                  </span>
                  <span v-else class="text-xs font-mono text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2.5 py-1.5 rounded">
                    {{ imageVersions[svc.name] || svc.image }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Connection info for multi-service -->
            <div v-if="serviceDefinitions.length > 1" class="mt-5 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800">
              <div class="flex items-start gap-2">
                <Info class="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <p class="text-xs text-blue-700 dark:text-blue-300">
                  All {{ serviceDefinitions.length }} services will be deployed on a shared network and can communicate with each other automatically. Credentials and connection details are pre-configured.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 2: Configuration -->
      <div v-if="currentStep === 2 && !deployed" class="space-y-6">
        <!-- Application settings -->
        <div v-if="appVariables.length > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-2">
              <Globe class="w-5 h-5 text-primary-600 dark:text-primary-400" />
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Application Settings</h2>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure your application's basic settings.</p>
          </div>
          <div class="p-6 space-y-4">
            <div v-for="v in appVariables" :key="v.name">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {{ v.label }}
                <span v-if="v.required !== false" class="text-red-500">*</span>
              </label>
              <input
                v-if="v.type === 'boolean'"
                type="checkbox"
                :checked="config[v.name] === 'true'"
                @change="config[v.name] = ($event.target as HTMLInputElement).checked ? 'true' : 'false'"
                class="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <input
                v-else-if="v.type === 'number'"
                v-model="config[v.name]"
                type="number"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                :placeholder="v.default ?? ''"
              />
              <input
                v-else
                v-model="config[v.name]"
                type="text"
                class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                :placeholder="v.default ?? ''"
              />
              <p v-if="v.required !== false && !config[v.name]?.trim()" class="mt-1 text-xs text-red-500">This field is required</p>
            </div>
          </div>
        </div>

        <!-- Security / Passwords -->
        <div v-if="securityVariables.length > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-2">
              <Shield class="w-5 h-5 text-green-600 dark:text-green-400" />
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Security & Credentials</h2>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Passwords and secrets are auto-generated. You can customize them below.</p>
          </div>
          <div class="p-6 space-y-4">
            <div v-for="v in securityVariables" :key="v.name">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {{ v.label }}
              </label>
              <div class="flex items-center gap-2">
                <div class="relative flex-1">
                  <input
                    v-model="config[v.name]"
                    :type="showPassword[v.name] ? 'text' : 'password'"
                    class="w-full px-3.5 py-2.5 pr-24 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    :placeholder="v.label"
                  />
                  <div class="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                    <button
                      type="button"
                      @click="showPassword[v.name] = !showPassword[v.name]"
                      class="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      :title="showPassword[v.name] ? 'Hide' : 'Show'"
                    >
                      <EyeOff v-if="showPassword[v.name]" class="w-4 h-4" />
                      <Eye v-else class="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      @click="copyToClipboard(v.name)"
                      class="p-1.5 rounded transition-colors"
                      :class="copied[v.name] ? 'text-green-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'"
                      title="Copy"
                    >
                      <Check v-if="copied[v.name]" class="w-4 h-4" />
                      <Copy v-else class="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      @click="regeneratePassword(v.name)"
                      class="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      title="Regenerate"
                    >
                      <RefreshCw class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div class="p-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800">
              <div class="flex items-start gap-2">
                <CheckCircle2 class="w-4 h-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                <p class="text-xs text-green-700 dark:text-green-300">
                  All passwords are securely generated. Save them somewhere safe — you'll need them to connect to your services.
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- No variables -->
        <div v-if="appVariables.length === 0 && securityVariables.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-center">
          <CheckCircle2 class="w-10 h-10 text-green-500 mx-auto mb-3" />
          <p class="text-sm text-gray-600 dark:text-gray-400">This template has no configuration — it's ready to deploy with defaults!</p>
        </div>
      </div>

      <!-- Step 3: Resources -->
      <div v-if="currentStep === 3 && !deployed" class="space-y-6">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-2">
              <Cpu class="w-5 h-5 text-primary-600 dark:text-primary-400" />
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Resource Allocation</h2>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure replicas, CPU, and memory for each service. Leave CPU/Memory at 0 to use platform defaults.</p>
          </div>

          <div class="p-6 space-y-4">
            <div v-for="(res, svcName) in serviceResources" :key="svcName" class="p-4 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-750">
              <p class="text-xs font-semibold text-gray-900 dark:text-white mb-3 font-mono">{{ svcName }}</p>
              <div class="grid grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Replicas</label>
                  <input
                    v-model.number="res.replicas"
                    type="number"
                    min="1"
                    max="100"
                    class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">CPU (millicores)</label>
                  <input
                    v-model.number="res.cpuLimit"
                    type="number"
                    min="0"
                    step="100"
                    :max="resourceLimits?.maxCpuPerContainer || 16000"
                    placeholder="Default"
                    class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Memory (MB)</label>
                  <input
                    v-model.number="res.memoryLimit"
                    type="number"
                    min="0"
                    step="64"
                    :max="resourceLimits?.maxMemoryPerContainer || 65536"
                    placeholder="Default"
                    class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            <!-- Cost estimate -->
            <div v-if="estimatedMonthlyCost !== null" class="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800">
              <Info class="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <p class="text-xs text-blue-700 dark:text-blue-300">
                Estimated monthly cost: ${{ estimatedMonthlyCost.toFixed(2) }}/mo
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 4: Review & Deploy / Progress -->
      <div v-if="currentStep === 4" class="space-y-6">
        <!-- Deploy error -->
        <div v-if="deployError" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div class="flex items-start gap-2">
            <AlertTriangle class="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p class="text-sm font-medium text-red-800 dark:text-red-300">Deployment failed</p>
              <p class="text-sm text-red-700 dark:text-red-400 mt-1">{{ deployError }}</p>
            </div>
          </div>
        </div>

        <!-- Review (before deploy) -->
        <template v-if="!deployed && !deploying">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Review & Deploy</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Everything looks good? Let's deploy your stack.</p>
            </div>
            <div class="p-6 space-y-5">
              <!-- Services summary -->
              <div>
                <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Services</h3>
                <div class="space-y-2">
                  <div v-for="svc in serviceDefinitions" :key="svc.name" class="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-750">
                    <component :is="getServiceIcon(svc)" class="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    <span class="text-sm font-medium text-gray-900 dark:text-white">{{ svc.name }}</span>
                    <span class="text-xs font-mono ml-auto" :class="imageVersions[svc.name] && imageVersions[svc.name] !== svc.image ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400'">
                      {{ imageVersions[svc.name] || svc.image }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Config summary -->
              <div v-if="Object.keys(config).length > 0">
                <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Configuration</h3>
                <div class="space-y-1.5">
                  <div v-for="v in (template.variables ?? [])" :key="v.name" class="flex items-center justify-between py-1.5">
                    <span class="text-sm text-gray-600 dark:text-gray-400">{{ v.label }}</span>
                    <span class="text-sm font-mono text-gray-900 dark:text-white">
                      {{ v.type === 'password' || v.generate ? '••••••••' : (config[v.name] || v.default || '—') }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Deploy button -->
          <div class="flex justify-center">
            <button
              @click="executeDeploy"
              :disabled="deploying"
              class="flex items-center gap-3 px-8 py-4 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-base font-semibold transition-all hover:shadow-lg hover:shadow-primary-600/25 active:scale-[0.98]"
            >
              <Rocket class="w-5 h-5" />
              Deploy {{ template.name }}
            </button>
          </div>
        </template>

        <!-- Deploying spinner -->
        <div v-if="deploying && !deployed" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
          <Loader2 class="w-10 h-10 text-primary-600 dark:text-primary-400 animate-spin mx-auto mb-4" />
          <p class="text-lg font-semibold text-gray-900 dark:text-white">Deploying your stack...</p>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Setting up services, networks, and volumes</p>
        </div>

        <!-- Deployment progress -->
        <template v-if="deployed">
          <!-- Success banner -->
          <div v-if="overallStatus === 'running'" class="p-5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 class="w-7 h-7 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p class="text-lg font-semibold text-green-800 dark:text-green-300">All services are running!</p>
                <p class="text-sm text-green-600 dark:text-green-400">Your {{ template.name }} stack is ready to use.</p>
              </div>
            </div>
          </div>

          <!-- Failure banner -->
          <div v-else-if="overallStatus === 'failed' || overallStatus === 'partial'" class="p-5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle class="w-7 h-7 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p class="text-lg font-semibold text-red-800 dark:text-red-300">
                  {{ overallStatus === 'failed' ? 'Deployment failed' : 'Some services failed' }}
                </p>
                <p class="text-sm text-red-600 dark:text-red-400">Check the service details below for more information.</p>
              </div>
            </div>
          </div>

          <!-- Service statuses -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Deployment Progress</h2>
            </div>
            <div class="divide-y divide-gray-200 dark:divide-gray-700">
              <div
                v-for="svc in deployedServices"
                :key="svc.id"
                class="flex items-center gap-4 px-6 py-4"
              >
                <!-- Status indicator -->
                <div
                  :class="[
                    'w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-500',
                    svc.status === 'running'
                      ? 'bg-green-100 dark:bg-green-900/30'
                      : svc.status === 'failed'
                        ? 'bg-red-100 dark:bg-red-900/30'
                        : 'bg-yellow-100 dark:bg-yellow-900/30'
                  ]"
                >
                  <CheckCircle2 v-if="svc.status === 'running'" class="w-5 h-5 text-green-600 dark:text-green-400" />
                  <AlertTriangle v-else-if="svc.status === 'failed'" class="w-5 h-5 text-red-600 dark:text-red-400" />
                  <Loader2 v-else class="w-5 h-5 text-yellow-600 dark:text-yellow-400 animate-spin" />
                </div>

                <!-- Service info -->
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-gray-900 dark:text-white">{{ svc.name }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ svc.image }}</p>
                </div>

                <!-- Status badge -->
                <span
                  :class="[
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    svc.status === 'running'
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                      : svc.status === 'failed'
                        ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                        : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                  ]"
                >
                  {{ svc.status }}
                </span>

                <!-- Action links -->
                <button
                  v-if="svc.status === 'running' || svc.status === 'failed'"
                  @click="goToServiceDetail(svc.id)"
                  class="text-xs text-primary-600 dark:text-primary-400 hover:underline font-medium flex items-center gap-1"
                >
                  Details <ExternalLink class="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          <!-- Action buttons -->
          <div class="flex items-center justify-center gap-4">
            <button
              @click="goBack"
              class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Back to Marketplace
            </button>
            <button
              @click="goToServices"
              class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
            >
              Go to Services
              <ArrowRight class="w-4 h-4" />
            </button>
          </div>
        </template>
      </div>

      <!-- Navigation (steps 1-3) -->
      <div v-if="!deployed && currentStep < 4" class="flex items-center justify-between mt-8">
        <button
          @click="prevStep"
          :disabled="currentStep === 1"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          <ArrowLeft class="w-4 h-4" />
          Back
        </button>
        <button
          @click="nextStep"
          :disabled="!canProceed"
          class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          {{ currentStep === 3 ? 'Review & Deploy' : 'Continue' }}
          <ArrowRight class="w-4 h-4" />
        </button>
      </div>

      <!-- Step 4 back button (before deploy) -->
      <div v-if="currentStep === 4 && !deployed && !deploying" class="flex items-center justify-between mt-8">
        <button
          @click="prevStep"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
        >
          <ArrowLeft class="w-4 h-4" />
          Back
        </button>
        <div></div>
      </div>
    </template>
  </div>
</template>
