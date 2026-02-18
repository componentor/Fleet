<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Store, Rocket, Loader2, Search, X, Settings2, FileCode2, AlertTriangle, DollarSign } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const api = useApi()
const router = useRouter()

const templates = ref<any[]>([])
const categories = ref<string[]>([])
const loading = ref(true)
const deploying = ref(false)
const error = ref('')
const success = ref('')
const search = ref('')
const selectedCategory = ref('')

// Deploy config modal
const showDeployModal = ref(false)
const deployTemplate = ref<any>(null)
const deployName = ref('')
const deployEnvVars = ref<{ key: string; value: string }[]>([])
const activeTab = ref<'configure' | 'compose'>('configure')
const composeYaml = ref('')
const templateDetails = ref<any>(null)

// Resource overrides per service
const serviceResources = ref<Record<string, { replicas: number; cpuLimit: number; memoryLimit: number }>>({})

// Account resource limits & pricing
const resourceLimits = ref<any>(null)
const pricingConfig = ref<any>(null)

const filteredTemplates = computed(() => {
  let result = templates.value
  if (selectedCategory.value) {
    result = result.filter(t => t.category === selectedCategory.value)
  }
  if (search.value) {
    const q = search.value.toLowerCase()
    result = result.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q)
    )
  }
  return result
})

// Estimate monthly cost based on resource config
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
  // If no services defined yet, estimate for 1 container
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

function categoryColor(category: string) {
  switch (category) {
    case 'CMS': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    case 'Database': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    case 'Web Server': return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
    case 'Runtime': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
    case 'Storage': return 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300'
    default: return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }
}

async function fetchTemplates() {
  loading.value = true
  try {
    const [templateData, categoryData] = await Promise.all([
      api.get<any[]>('/marketplace/templates'),
      api.get<string[]>('/marketplace/templates/categories').catch(() => []),
    ])
    templates.value = templateData
    categories.value = Array.isArray(categoryData) ? categoryData : []
  } catch {
    templates.value = []
  } finally {
    loading.value = false
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
  } catch {
    // non-critical
  }
}

async function openDeployModal(tmpl: any) {
  deployTemplate.value = tmpl
  deployName.value = tmpl.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  activeTab.value = 'configure'

  const vars = tmpl.variables || []
  deployEnvVars.value = vars.map((v: any) => ({
    key: v.name,
    value: v.defaultValue || '',
  }))
  if (deployEnvVars.value.length === 0) {
    deployEnvVars.value = []
  }

  try {
    const details = await api.get<any>(`/marketplace/templates/${tmpl.slug}`)
    templateDetails.value = details
    composeYaml.value = details.composeTemplate || ''

    const resources: Record<string, { replicas: number; cpuLimit: number; memoryLimit: number }> = {}
    for (const svc of (details.serviceDefinitions || [])) {
      resources[svc.name] = { replicas: 1, cpuLimit: 0, memoryLimit: 0 }
    }
    serviceResources.value = resources
  } catch {
    templateDetails.value = null
    composeYaml.value = ''
    serviceResources.value = {}
  }

  showDeployModal.value = true
}

function addEnvVar() {
  deployEnvVars.value.push({ key: '', value: '' })
}

function removeEnvVar(index: number) {
  deployEnvVars.value.splice(index, 1)
}

const deployError = ref('')

async function confirmDeploy() {
  if (!deployTemplate.value) return
  deploying.value = true
  deployError.value = ''
  error.value = ''
  success.value = ''
  try {
    const config: Record<string, string> = {}
    for (const env of deployEnvVars.value) {
      if (env.key.trim()) {
        config[env.key.trim()] = env.value
      }
    }

    const resourceOverrides: Record<string, { replicas?: number; cpuLimit?: number; memoryLimit?: number }> = {}
    for (const [name, res] of Object.entries(serviceResources.value)) {
      const r = res as { replicas: number; cpuLimit: number; memoryLimit: number }
      if (r.replicas !== 1 || r.cpuLimit > 0 || r.memoryLimit > 0) {
        resourceOverrides[name] = {}
        if (r.replicas !== 1) resourceOverrides[name].replicas = r.replicas
        if (r.cpuLimit > 0) resourceOverrides[name].cpuLimit = r.cpuLimit
        if (r.memoryLimit > 0) resourceOverrides[name].memoryLimit = r.memoryLimit
      }
    }

    const result = await api.post<any>('/marketplace/deploy', {
      slug: deployTemplate.value.slug,
      config,
      ...(composeYaml.value !== (templateDetails.value?.composeTemplate ?? '') ? { composeOverride: composeYaml.value } : {}),
      ...(Object.keys(resourceOverrides).length > 0 ? { resourceOverrides } : {}),
    })

    // Check if any services failed within the successful deployment
    const failedCount = (result?.services ?? []).filter((s: any) => !s.dockerServiceId).length
    if (failedCount > 0) {
      success.value = t('marketplace.deployPartial', { name: deployTemplate.value.name, count: failedCount })
    } else {
      success.value = t('marketplace.deploySuccess', { name: deployTemplate.value.name })
    }
    showDeployModal.value = false
  } catch (err: any) {
    deployError.value = err?.body?.error || t('marketplace.deployFailed', { name: deployTemplate.value.slug })
  } finally {
    deploying.value = false
  }
}

function goToServices() {
  router.push({ name: 'panel-services' })
}

function formatCost(dollars: number | null) {
  if (dollars === null) return '—'
  return `$${dollars.toFixed(2)}`
}

onMounted(() => {
  fetchTemplates()
  fetchLimitsAndPricing()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Store class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('marketplace.title') }}</h1>
    </div>

    <div v-if="error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    </div>
    <div v-if="success" class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center justify-between">
      <p class="text-sm text-green-700 dark:text-green-300">{{ success }}</p>
      <button @click="goToServices" class="ml-4 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors shrink-0">
        {{ $t('marketplace.viewServices') }}
      </button>
    </div>

    <!-- Filters -->
    <div class="flex items-center gap-3 mb-6 flex-wrap">
      <div class="relative flex-1 min-w-48 max-w-sm">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          v-model="search"
          type="text"
          :placeholder="$t('marketplace.search')"
          class="w-full pl-10 pr-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
        />
      </div>
      <select
        v-model="selectedCategory"
        class="px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
      >
        <option value="">{{ $t('marketplace.allCategories') }}</option>
        <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
      </select>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
    </div>

    <div v-else-if="filteredTemplates.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ $t('marketplace.noApps') }}</p>
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="tmpl in filteredTemplates"
        :key="tmpl.slug"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
      >
        <div class="p-6">
          <div class="flex items-start justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ tmpl.name }}</h3>
            <span v-if="tmpl.category" :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', categoryColor(tmpl.category)]">
              {{ tmpl.category }}
            </span>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">{{ tmpl.description }}</p>
          <p v-if="tmpl.composeTemplate" class="text-xs text-gray-500 dark:text-gray-500 font-mono truncate">{{ tmpl.slug }}</p>
        </div>
        <div class="px-6 py-3 bg-gray-50 dark:bg-gray-750 border-t border-gray-200 dark:border-gray-700">
          <button
            @click="openDeployModal(tmpl)"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors"
          >
            <Rocket class="w-3.5 h-3.5" />
            {{ $t('marketplace.deploy') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Deploy config modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showDeployModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" @click="showDeployModal = false"></div>
          <div class="relative w-full max-w-2xl bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 max-h-[90vh] flex flex-col">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
                  <Settings2 class="w-4.5 h-4.5 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <h3 class="text-lg font-semibold text-gray-900 dark:text-white">{{ $t('marketplace.deployConfig') }}</h3>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ deployTemplate?.name }}</p>
                </div>
              </div>
              <button @click="showDeployModal = false" class="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <X class="w-5 h-5" />
              </button>
            </div>

            <!-- Tabs -->
            <div class="flex border-b border-gray-200 dark:border-gray-700 px-6 shrink-0">
              <button
                @click="activeTab = 'configure'"
                :class="[
                  'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px',
                  activeTab === 'configure'
                    ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                ]"
              >
                <Settings2 class="w-4 h-4" />
                {{ $t('marketplace.tabConfigure') }}
              </button>
              <button
                @click="activeTab = 'compose'"
                :class="[
                  'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px',
                  activeTab === 'compose'
                    ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                ]"
              >
                <FileCode2 class="w-4 h-4" />
                {{ $t('marketplace.tabCompose') }}
              </button>
            </div>

            <!-- Body -->
            <div class="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              <!-- Configure tab -->
              <template v-if="activeTab === 'configure'">
                <p v-if="deployTemplate?.description" class="text-sm text-gray-600 dark:text-gray-400">
                  {{ deployTemplate.description }}
                </p>

                <!-- Service name -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('marketplace.serviceName') }}</label>
                  <input
                    v-model="deployName"
                    type="text"
                    :placeholder="$t('marketplace.serviceNamePlaceholder')"
                    class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
                  />
                </div>

                <!-- Environment variables -->
                <div>
                  <div class="flex items-center justify-between mb-2">
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('marketplace.envVars') }}</label>
                    <button type="button" @click="addEnvVar" class="text-xs text-primary-600 dark:text-primary-400 hover:underline font-medium">
                      + {{ $t('common.add') }}
                    </button>
                  </div>
                  <div v-if="deployEnvVars.length === 0" class="text-xs text-gray-400 dark:text-gray-500 py-2">
                    {{ $t('marketplace.noEnvVars') }}
                  </div>
                  <div v-else class="space-y-2">
                    <div v-for="(env, i) in deployEnvVars" :key="i" class="flex items-center gap-2">
                      <input
                        v-model="env.key"
                        type="text"
                        :placeholder="$t('marketplace.keyPlaceholder')"
                        class="w-2/5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-xs font-mono"
                      />
                      <input
                        v-model="env.value"
                        type="text"
                        :placeholder="$t('marketplace.valuePlaceholder')"
                        class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-xs font-mono"
                      />
                      <button type="button" @click="removeEnvVar(i)" class="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <X class="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Per-service resource configuration -->
                <div v-if="Object.keys(serviceResources).length > 0">
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{{ $t('marketplace.resourceConfig') }}</label>
                  <div class="space-y-4">
                    <div v-for="(res, svcName) in serviceResources" :key="svcName" class="p-4 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-750">
                      <p class="text-xs font-semibold text-gray-900 dark:text-white mb-3 font-mono">{{ svcName }}</p>
                      <div class="grid grid-cols-3 gap-3">
                        <div>
                          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">{{ $t('marketplace.replicas') }}</label>
                          <input
                            v-model.number="res.replicas"
                            type="number"
                            min="0"
                            max="100"
                            class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">{{ $t('marketplace.cpuMillicores') }}</label>
                          <input
                            v-model.number="res.cpuLimit"
                            type="number"
                            min="0"
                            step="100"
                            :max="resourceLimits?.maxCpuPerContainer || 16000"
                            :placeholder="String(resourceLimits?.maxCpuPerContainer || 0)"
                            class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">{{ $t('marketplace.memoryMb') }}</label>
                          <input
                            v-model.number="res.memoryLimit"
                            type="number"
                            min="0"
                            step="64"
                            :max="resourceLimits?.maxMemoryPerContainer || 65536"
                            :placeholder="String(resourceLimits?.maxMemoryPerContainer || 0)"
                            class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Resource limit disclaimer -->
                  <div v-if="resourceLimits" class="mt-3 flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
                    <AlertTriangle class="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <p class="text-xs text-amber-700 dark:text-amber-300">
                      {{ $t('marketplace.resourceLimitDisclaimer', {
                        cpu: resourceLimits.maxCpuPerContainer ?? '∞',
                        memory: resourceLimits.maxMemoryPerContainer ?? '∞',
                        replicas: resourceLimits.maxReplicas ?? '∞'
                      }) }}
                    </p>
                  </div>

                  <!-- Pricing estimate -->
                  <div v-if="estimatedMonthlyCost !== null" class="mt-3 flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800">
                    <DollarSign class="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <p class="text-xs text-blue-700 dark:text-blue-300">
                      {{ $t('marketplace.estimatedCost', { cost: formatCost(estimatedMonthlyCost) }) }}
                    </p>
                  </div>
                  <div v-else-if="pricingConfig === null && !loading" class="mt-3 flex items-center gap-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600">
                    <DollarSign class="w-4 h-4 text-gray-400 shrink-0" />
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      {{ $t('marketplace.noPricing') }}
                    </p>
                  </div>
                </div>
              </template>

              <!-- Compose tab -->
              <template v-if="activeTab === 'compose'">
                <div>
                  <div class="flex items-center justify-between mb-2">
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{ $t('marketplace.composeEditor') }}</label>
                    <span class="text-xs text-gray-400 dark:text-gray-500">YAML</span>
                  </div>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    {{ $t('marketplace.composeEditorHint') }}
                  </p>
                  <textarea
                    v-model="composeYaml"
                    rows="20"
                    spellcheck="false"
                    class="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-900 text-green-400 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-xs font-mono leading-relaxed resize-y"
                  ></textarea>
                </div>
              </template>
            </div>

            <!-- Deploy error inside modal -->
            <div v-if="deployError" class="mx-6 mb-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p class="text-sm text-red-700 dark:text-red-300">{{ deployError }}</p>
            </div>

            <!-- Footer -->
            <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 shrink-0">
              <button type="button" @click="showDeployModal = false" class="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700">
                {{ $t('common.cancel') }}
              </button>
              <button
                @click="confirmDeploy"
                :disabled="deploying"
                class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <Loader2 v-if="deploying" class="w-4 h-4 animate-spin" />
                <Rocket v-else class="w-4 h-4" />
                {{ deploying ? $t('marketplace.deploying') : $t('marketplace.deploy') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-active .relative,
.modal-leave-active .relative {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .relative {
  transform: scale(0.95);
  opacity: 0;
}
.modal-leave-to .relative {
  transform: scale(0.95);
  opacity: 0;
}
</style>
