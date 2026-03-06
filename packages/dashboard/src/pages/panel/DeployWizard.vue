<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useApi } from '@/composables/useApi'
import {
  ArrowLeft, ArrowRight, Rocket, Loader2, CheckCircle2,
  Eye, EyeOff, Copy, RefreshCw, AlertTriangle, Database,
  Server, Globe, Shield, Cpu, HardDrive, Check, ExternalLink,
  Package, Info, ChevronDown, Link, Link2, X,
} from 'lucide-vue-next'
import DomainPicker from '@/components/DomainPicker.vue'
import TierSelector from '@/components/TierSelector.vue'
import { useDomainPicker } from '@/composables/useDomainPicker'
import { useServiceBilling } from '@/composables/useServiceBilling'

const props = defineProps<{ slug: string }>()
const { t } = useI18n()
const api = useApi()
const router = useRouter()
const { fetchDomains: fetchAccountDomains } = useDomainPicker()
const { fetchTiers, freeTier, tiers } = useServiceBilling()

// Plan selection for the stack
const selectedStackPlanId = ref<string | null>(null)

// ── Step management ──
const currentStep = ref(1)
const steps = computed(() => [
  { number: 1, label: t('deployWizard.steps.overview'), icon: Package },
  { number: 2, label: t('deployWizard.steps.configure'), icon: Shield },
  { number: 3, label: t('deployWizard.steps.storage'), icon: HardDrive },
  { number: 4, label: 'Plan', icon: Cpu },
  { number: 5, label: t('deployWizard.steps.deploy'), icon: Rocket },
])

// ── Template data ──
const template = ref<any>(null)
const templateLoading = ref(true)
const templateError = ref('')

// ── Step 2: Configuration ──
const config = ref<Record<string, string>>({})
const showPassword = ref<Record<string, boolean>>({})
const copied = ref<Record<string, boolean>>({})
const serviceDomains = ref<Record<string, string>>({})

// ── Step 3: Storage ──
const volumeConfigs = ref<Record<string, { mode: 'create' | 'existing'; sizeGb: number; existingVolumeName: string }>>({})
const existingVolumes = ref<Array<{ name: string; displayName: string; sizeGb: number }>>([])
const storageQuota = ref<{ usedGb: number; limitGb: number } | null>(null)

// Volume sharing
const quickDeployVolumeStrategy = ref<'shared' | 'split'>('shared')
const volumeShareGroups = ref<Record<string, {
  volumeNames: string[]
  mode: 'create' | 'existing'
  sizeGb: number
  existingVolumeName: string
}>>({})
const volumeGroupMembership = ref<Record<string, string>>({})
const linkDropdownOpen = ref<string | null>(null)

// ── Step 4: Resources ──
const serviceResources = ref<Record<string, { replicas: number; cpuLimit: number; memoryLimit: number }>>({})
const resourceLimits = ref<any>(null)
const pricingConfig = ref<any>(null)

// ── Step 1: Image versions ──
const imageVersions = ref<Record<string, string>>({})
const availableTags = ref<Record<string, string[]>>({})
const tagsLoading = ref<Record<string, boolean>>({})

// ── Step 5: Deploy & Progress ──
const deploying = ref(false)
const deployed = ref(false)
const stackId = ref('')
const deployedServices = ref<any[]>([])
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)
const deployError = ref('')
const overallStatus = ref('')

// ── Computed: Variable groups ──
const domainVariableNames = computed(() => {
  const names = new Set<string>()
  for (const svc of (template.value?.serviceDefinitions ?? [])) {
    const d = (svc as any).domain as string | undefined
    if (d) {
      const match = d.match(/\{\{(\w+)\}\}/)
      if (match?.[1]) names.add(match[1])
    }
  }
  return names
})

const appVariables = computed(() => {
  if (!template.value?.variables) return []
  return (template.value.variables as any[]).filter(
    (v: any) => v.type !== 'password' && !v.generate && !domainVariableNames.value.has(v.name)
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

const webFacingServices = computed(() => {
  return serviceDefinitions.value.filter((svc: any) => (svc.ports?.length ?? 0) > 0)
})

const templateVolumes = computed(() => {
  if (!template.value) return []
  const vols: string[] = template.value.volumes ?? []
  const svcs: any[] = template.value.serviceDefinitions ?? []
  return vols.map((volName) => {
    const usedBy = svcs
      .filter((s) => (s.volumes ?? []).some((v: any) => v.source === volName))
      .map((s) => ({
        name: s.name,
        target: (s.volumes ?? []).find((v: any) => v.source === volName)?.target ?? '',
      }))
    return { name: volName, usedBy }
  })
})

const hasVolumes = computed(() => templateVolumes.value.length > 0)

const visibleSteps = computed(() => {
  if (hasVolumes.value) return steps.value
  return steps.value.filter((s) => s.number !== 3)
})

const groupedVolumeNames = computed(() => {
  const s = new Set<string>()
  for (const group of Object.values(volumeShareGroups.value)) {
    for (const vn of group.volumeNames) s.add(vn)
  }
  return s
})

const ungroupedVolumes = computed(() =>
  templateVolumes.value.filter(v => !groupedVolumeNames.value.has(v.name))
)

const totalNewStorageGb = computed(() => {
  let total = 0
  // Grouped volumes — one size per group
  for (const group of Object.values(volumeShareGroups.value)) {
    if (group.mode === 'create') total += group.sizeGb
  }
  // Ungrouped volumes — individual sizes
  for (const [name, cfg] of Object.entries(volumeConfigs.value)) {
    if (!groupedVolumeNames.value.has(name) && cfg.mode === 'create') {
      total += cfg.sizeGb
    }
  }
  return total
})

const remainingAfterDeploy = computed(() => {
  if (!storageQuota.value) return null
  return storageQuota.value.limitGb - storageQuota.value.usedGb - totalNewStorageGb.value
})

const isOverQuota = computed(() => {
  if (remainingAfterDeploy.value === null) return false
  return remainingAfterDeploy.value < 0
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
  if (currentStep.value === 3) {
    if (isOverQuota.value) return false
    // Validate grouped volume configs
    for (const group of Object.values(volumeShareGroups.value)) {
      if (group.mode === 'existing' && !group.existingVolumeName) return false
      if (group.mode === 'create' && group.sizeGb < 1) return false
    }
    // Validate ungrouped volume configs
    for (const [name, cfg] of Object.entries(volumeConfigs.value)) {
      if (groupedVolumeNames.value.has(name)) continue
      if (cfg.mode === 'existing' && !cfg.existingVolumeName) return false
      if (cfg.mode === 'create' && cfg.sizeGb < 1) return false
    }
    return true
  }
  return true
})

// ── One-click deploy for simple templates ──
const isSimpleTemplate = computed(() => {
  if (!template.value) return false
  const vars = template.value.variables ?? []
  // Simple = all variables are either auto-generated or have defaults
  return vars.every((v: any) => v.generate || (v.default !== undefined && v.default !== '') || v.required === false)
})

async function quickDeploy() {
  // Apply volume strategy before deploying
  if (quickDeployVolumeStrategy.value === 'shared' && templateVolumes.value.length >= 2) {
    setAllShared(true)
  }
  // Skip config steps but stop at plan selection (step 4)
  currentStep.value = 4
}

// ── Volume sharing helpers ──
function setAllShared(shared: boolean) {
  volumeShareGroups.value = {}
  volumeGroupMembership.value = {}

  if (shared && templateVolumes.value.length >= 2) {
    const groupId = crypto.randomUUID()
    const allNames = templateVolumes.value.map(v => v.name)
    const maxSize = Math.max(...allNames.map(n => volumeConfigs.value[n]?.sizeGb ?? 5))
    volumeShareGroups.value[groupId] = {
      volumeNames: allNames,
      mode: 'create',
      sizeGb: maxSize,
      existingVolumeName: '',
    }
    for (const n of allNames) {
      volumeGroupMembership.value[n] = groupId
    }
  }
}

function linkVolumes(volumeA: string, volumeB: string) {
  const groupIdA = volumeGroupMembership.value[volumeA]
  const groupIdB = volumeGroupMembership.value[volumeB]

  if (groupIdA && groupIdB && groupIdA === groupIdB) return

  if (groupIdA && !groupIdB) {
    volumeShareGroups.value[groupIdA]!.volumeNames.push(volumeB)
    volumeShareGroups.value[groupIdA]!.sizeGb = Math.max(
      volumeShareGroups.value[groupIdA]!.sizeGb,
      volumeConfigs.value[volumeB]?.sizeGb ?? 5,
    )
    volumeGroupMembership.value[volumeB] = groupIdA
  } else if (!groupIdA && groupIdB) {
    volumeShareGroups.value[groupIdB]!.volumeNames.push(volumeA)
    volumeShareGroups.value[groupIdB]!.sizeGb = Math.max(
      volumeShareGroups.value[groupIdB]!.sizeGb,
      volumeConfigs.value[volumeA]?.sizeGb ?? 5,
    )
    volumeGroupMembership.value[volumeA] = groupIdB
  } else if (groupIdA && groupIdB) {
    const bMembers = volumeShareGroups.value[groupIdB]!.volumeNames
    volumeShareGroups.value[groupIdA]!.volumeNames.push(...bMembers)
    volumeShareGroups.value[groupIdA]!.sizeGb = Math.max(
      volumeShareGroups.value[groupIdA]!.sizeGb,
      volumeShareGroups.value[groupIdB]!.sizeGb,
    )
    for (const m of bMembers) volumeGroupMembership.value[m] = groupIdA
    delete volumeShareGroups.value[groupIdB]
  } else {
    const groupId = crypto.randomUUID()
    const sizeA = volumeConfigs.value[volumeA]?.sizeGb ?? 5
    const sizeB = volumeConfigs.value[volumeB]?.sizeGb ?? 5
    volumeShareGroups.value[groupId] = {
      volumeNames: [volumeA, volumeB],
      mode: volumeConfigs.value[volumeA]?.mode ?? 'create',
      sizeGb: Math.max(sizeA, sizeB),
      existingVolumeName: '',
    }
    volumeGroupMembership.value[volumeA] = groupId
    volumeGroupMembership.value[volumeB] = groupId
  }
  linkDropdownOpen.value = null
}

function unlinkVolume(volumeName: string) {
  const groupId = volumeGroupMembership.value[volumeName]
  if (!groupId) return

  const group = volumeShareGroups.value[groupId]!
  group.volumeNames = group.volumeNames.filter(n => n !== volumeName)
  delete volumeGroupMembership.value[volumeName]

  if (group.volumeNames.length <= 1) {
    const remaining = group.volumeNames[0]
    if (remaining) delete volumeGroupMembership.value[remaining]
    delete volumeShareGroups.value[groupId]
  }
}

function allServicesForGroup(group: { volumeNames: string[] }) {
  const svcs: Array<{ name: string; target: string; volume: string }> = []
  for (const vn of group.volumeNames) {
    const vol = templateVolumes.value.find(v => v.name === vn)
    if (vol) {
      for (const svc of vol.usedBy) {
        svcs.push({ name: svc.name, target: svc.target, volume: vn })
      }
    }
  }
  return svcs
}

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
  if (/postgres/.test(img)) return t('deployWizard.roles.postgres')
  if (/mysql/.test(img)) return t('deployWizard.roles.mysql')
  if (/mariadb/.test(img)) return t('deployWizard.roles.mariadb')
  if (/mongo/.test(img)) return t('deployWizard.roles.mongo')
  if (/redis|valkey/.test(img)) return t('deployWizard.roles.redis')
  if (/clickhouse/.test(img)) return t('deployWizard.roles.clickhouse')
  return t('deployWizard.roles.application')
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
    const fullTags = result.tags.map((tag) => `${imageBase}:${tag}`)
    availableTags.value[serviceName] = fullTags
    // Default to latest tag from Docker Hub
    if (fullTags.length > 0 && fullTags[0] !== undefined) {
      imageVersions.value[serviceName] = fullTags[0]
    }
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

    // Pre-fill service resources, image versions, and domain defaults
    const resources: Record<string, { replicas: number; cpuLimit: number; memoryLimit: number }> = {}
    const domains: Record<string, string> = {}
    for (const svc of (details.serviceDefinitions ?? [])) {
      resources[svc.name] = { replicas: 1, cpuLimit: 0, memoryLimit: 0 }
      domains[svc.name] = ''
      imageVersions.value[svc.name] = svc.image
      // Fetch available tags in parallel (fire-and-forget)
      fetchImageTags(svc.name, svc.image)
    }
    serviceResources.value = resources
    serviceDomains.value = domains

    // Initialize volume configs with defaults
    const volConfigs: Record<string, { mode: 'create' | 'existing'; sizeGb: number; existingVolumeName: string }> = {}
    for (const volName of (details.volumes ?? [])) {
      volConfigs[volName] = { mode: 'create', sizeGb: 5, existingVolumeName: '' }
    }
    volumeConfigs.value = volConfigs

    // Pre-fetch storage data so it's ready by step 3
    if ((details.volumes ?? []).length > 0) {
      fetchStorageData()
    }
  } catch (err: any) {
    templateError.value = err?.message ?? t('deployWizard.errors.failedToLoadTemplate')
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

async function fetchStorageData() {
  try {
    const [volumes, quota] = await Promise.all([
      api.get<any[]>('/storage/volumes'),
      api.get<{ usedGb: number; limitGb: number }>('/storage/volumes/quota'),
    ])
    existingVolumes.value = (volumes ?? []).map((v: any) => ({
      name: v.name,
      displayName: v.displayName ?? v.name,
      sizeGb: v.sizeGb ?? 0,
    }))
    storageQuota.value = { usedGb: Number(quota.usedGb) || 0, limitGb: Number(quota.limitGb) || 0 }
  } catch {}
}

async function openBillingPortal() {
  try {
    const result = await api.post<{ url: string }>('/billing/portal', {
      returnUrl: window.location.href,
    })
    window.location.href = result.url
  } catch {}
}

// ── Navigation ──
function nextStep() {
  if (currentStep.value < 5) {
    currentStep.value++
    // Auto-skip storage step when template has no volumes
    if (currentStep.value === 3 && !hasVolumes.value) {
      currentStep.value++
    }
  }
}

function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value--
    // Auto-skip storage step when template has no volumes
    if (currentStep.value === 3 && !hasVolumes.value) {
      currentStep.value--
    }
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

    // Build volume groups for shared volumes
    const volGroups: Array<{
      name: string; volumes: string[];
      mode: 'create' | 'existing'; sizeGb?: number; existingVolumeName?: string
    }> = []
    for (const group of Object.values(volumeShareGroups.value)) {
      volGroups.push({
        name: group.volumeNames[0]!,
        volumes: group.volumeNames,
        mode: group.mode,
        ...(group.mode === 'create' ? { sizeGb: group.sizeGb } : {}),
        ...(group.mode === 'existing' && group.existingVolumeName
          ? { existingVolumeName: group.existingVolumeName } : {}),
      })
    }

    // Build volume overrides — only for ungrouped volumes
    const volOverrides: Record<string, any> = {}
    for (const [name, cfg] of Object.entries(volumeConfigs.value)) {
      if (groupedVolumeNames.value.has(name)) continue
      volOverrides[name] = { mode: cfg.mode }
      if (cfg.mode === 'create') {
        volOverrides[name].sizeGb = cfg.sizeGb
      } else if (cfg.mode === 'existing' && cfg.existingVolumeName) {
        volOverrides[name].existingVolumeName = cfg.existingVolumeName
      }
    }

    // Build domain overrides for services where user assigned a domain
    const domainOverrides: Record<string, string> = {}
    for (const [name, domain] of Object.entries(serviceDomains.value)) {
      if (domain.trim()) domainOverrides[name] = domain.trim()
    }

    // Inject domain picker values into config for domain variables that are also
    // used in env var interpolation (e.g. GHOST_URL is used in both domain: and env:)
    for (const svc of serviceDefinitions.value) {
      const d = (svc as any).domain as string | undefined
      if (!d) continue
      const match = d.match(/\{\{(\w+)\}\}/)
      if (!match) continue
      const varName = match[1]!
      const pickerDomain = serviceDomains.value[svc.name]?.trim()
      if (pickerDomain && !deployConfig[varName]) {
        deployConfig[varName] = pickerDomain
      }
    }

    const result = await api.post<any>('/marketplace/deploy', {
      slug: props.slug,
      config: deployConfig,
      ...(selectedStackPlanId.value ? { planId: selectedStackPlanId.value } : {}),
      ...(Object.keys(imageOverrides).length > 0 ? { imageOverrides } : {}),
      ...(Object.keys(resourceOverrides).length > 0 ? { resourceOverrides } : {}),
      ...(Object.keys(volOverrides).length > 0 ? { volumeOverrides: volOverrides } : {}),
      ...(volGroups.length > 0 ? { volumeGroups: volGroups } : {}),
      ...(Object.keys(domainOverrides).length > 0 ? { domainOverrides } : {}),
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
    deployError.value = err?.body?.error || err?.message || t('deployWizard.errors.deploymentFailed')
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
  fetchAccountDomains()
  fetchTiers()
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
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('deployWizard.title', { name: template?.name ?? '...' }) }}</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('deployWizard.subtitle') }}</p>
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
        {{ t('deployWizard.backToMarketplace') }}
      </button>
    </div>

    <template v-else-if="template">
      <!-- Step indicator -->
      <div class="mb-10" v-if="!deployed">
        <div class="flex items-center justify-between">
          <template v-for="(step, index) in visibleSteps" :key="step.number">
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
              v-if="index < visibleSteps.length - 1"
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
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">{{ t('deployWizard.whatsIncluded') }}</h3>
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
                  {{ t('deployWizard.multiServiceInfo', { count: serviceDefinitions.length }) }}
                </p>
              </div>
            </div>

            <!-- Quick deploy for simple templates -->
            <div v-if="isSimpleTemplate" class="mt-5 p-4 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800">
              <div class="flex items-center justify-between gap-4">
                <div class="flex items-start gap-2">
                  <CheckCircle2 class="w-4 h-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                  <div>
                    <p class="text-sm font-medium text-green-800 dark:text-green-200">{{ t('deployWizard.readyForOneClick') }}</p>
                    <p class="text-xs text-green-600 dark:text-green-400 mt-0.5">{{ t('deployWizard.noRequiredConfig') }}</p>
                  </div>
                </div>
                <button
                  @click="quickDeploy"
                  :disabled="deploying"
                  class="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold transition-all hover:shadow-lg active:scale-[0.98]"
                >
                  <Loader2 v-if="deploying" class="w-4 h-4 animate-spin" />
                  <Rocket v-else class="w-4 h-4" />
                  {{ deploying ? t('deployWizard.deploying') : t('deployWizard.quickDeploy') }}
                </button>
              </div>
              <!-- Quick deploy volume strategy -->
              <div v-if="templateVolumes.length >= 2" class="mt-3 pt-3 border-t border-green-200 dark:border-green-800 flex items-center gap-3">
                <span class="text-xs font-medium text-green-800 dark:text-green-200">{{ t('deployWizard.storage.label') }}:</span>
                <div class="flex gap-1.5">
                  <button
                    @click="quickDeployVolumeStrategy = 'shared'"
                    :class="[
                      'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                      quickDeployVolumeStrategy === 'shared'
                        ? 'bg-green-600 text-white'
                        : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50'
                    ]"
                  >
                    {{ t('deployWizard.storage.sharedVolume') }}
                  </button>
                  <button
                    @click="quickDeployVolumeStrategy = 'split'"
                    :class="[
                      'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                      quickDeployVolumeStrategy === 'split'
                        ? 'bg-green-600 text-white'
                        : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50'
                    ]"
                  >
                    {{ t('deployWizard.storage.separateVolumes') }}
                  </button>
                </div>
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
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('deployWizard.config.applicationSettings') }}</h2>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('deployWizard.config.applicationSettingsDesc') }}</p>
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
              <p v-if="v.required !== false && !config[v.name]?.trim()" class="mt-1 text-xs text-red-500">{{ t('deployWizard.config.fieldRequired') }}</p>
            </div>
          </div>
        </div>

        <!-- Domain Configuration -->
        <div v-if="webFacingServices.length > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-2">
              <Link class="w-5 h-5 text-primary-600 dark:text-primary-400" />
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('deployWizard.config.domainConfiguration') }}</h2>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('deployWizard.config.domainConfigurationDesc') }}</p>
          </div>
          <div class="p-6 space-y-4">
            <div v-for="svc in webFacingServices" :key="svc.name">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {{ svc.name }}
              </label>
              <DomainPicker
                :model-value="serviceDomains[svc.name] ?? ''"
                @update:model-value="serviceDomains[svc.name] = $event"
                :placeholder="t('deployWizard.config.domainPlaceholder')"
              />
            </div>
          </div>
        </div>

        <!-- Security / Passwords -->
        <div v-if="securityVariables.length > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-2">
              <Shield class="w-5 h-5 text-green-600 dark:text-green-400" />
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('deployWizard.config.securityCredentials') }}</h2>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('deployWizard.config.securityCredentialsDesc') }}</p>
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
                      :title="showPassword[v.name] ? t('deployWizard.config.hide') : t('deployWizard.config.show')"
                    >
                      <EyeOff v-if="showPassword[v.name]" class="w-4 h-4" />
                      <Eye v-else class="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      @click="copyToClipboard(v.name)"
                      class="p-1.5 rounded transition-colors"
                      :class="copied[v.name] ? 'text-green-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'"
                      :title="t('deployWizard.config.copy')"
                    >
                      <Check v-if="copied[v.name]" class="w-4 h-4" />
                      <Copy v-else class="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      @click="regeneratePassword(v.name)"
                      class="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      :title="t('deployWizard.config.regenerate')"
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
                  {{ t('deployWizard.config.passwordsSafetyNotice') }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- No variables -->
        <div v-if="appVariables.length === 0 && securityVariables.length === 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-center">
          <CheckCircle2 class="w-10 h-10 text-green-500 mx-auto mb-3" />
          <p class="text-sm text-gray-600 dark:text-gray-400">{{ t('deployWizard.config.noConfiguration') }}</p>
        </div>
      </div>

      <!-- Step 3: Storage -->
      <div v-if="currentStep === 3 && !deployed" class="space-y-6">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-2">
              <HardDrive class="w-5 h-5 text-primary-600 dark:text-primary-400" />
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('deployWizard.storage.title') }}</h2>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('deployWizard.storage.description') }}</p>
          </div>

          <div class="p-6 space-y-5">
            <!-- Storage quota bar -->
            <div v-if="storageQuota" class="p-4 rounded-lg bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('deployWizard.storage.storageUsage') }}</span>
                <span class="text-xs font-mono text-gray-500 dark:text-gray-400">
                  {{ t('deployWizard.storage.quotaSummary', { used: storageQuota.usedGb.toFixed(1), new: totalNewStorageGb, limit: storageQuota.limitGb }) }}
                </span>
              </div>
              <div class="w-full h-2.5 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden">
                <div class="h-full rounded-full flex">
                  <div
                    class="h-full bg-primary-500 transition-all"
                    :style="{ width: Math.min(100, (storageQuota.usedGb / storageQuota.limitGb) * 100) + '%' }"
                  ></div>
                  <div
                    :class="[
                      'h-full transition-all',
                      isOverQuota ? 'bg-red-500' : 'bg-primary-300 dark:bg-primary-700'
                    ]"
                    :style="{ width: Math.min(100 - (storageQuota.usedGb / storageQuota.limitGb) * 100, (totalNewStorageGb / storageQuota.limitGb) * 100) + '%' }"
                  ></div>
                </div>
              </div>
              <div class="flex items-center justify-between mt-1.5">
                <span class="text-xs text-gray-400">
                  {{ remainingAfterDeploy !== null ? (remainingAfterDeploy >= 0 ? t('deployWizard.storage.gbRemaining', { amount: remainingAfterDeploy.toFixed(1) }) : t('deployWizard.storage.overLimitBy', { amount: Math.abs(remainingAfterDeploy).toFixed(1) })) : '' }}
                </span>
              </div>
            </div>

            <!-- Over-quota warning -->
            <div v-if="isOverQuota" class="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <div class="flex items-start gap-3">
                <AlertTriangle class="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div class="flex-1">
                  <p class="text-sm font-medium text-red-800 dark:text-red-300">{{ t('deployWizard.storage.quotaExceeded') }}</p>
                  <p class="text-xs text-red-600 dark:text-red-400 mt-1">
                    {{ t('deployWizard.storage.quotaExceededDesc') }}
                  </p>
                </div>
                <button
                  @click="openBillingPortal"
                  class="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors"
                >
                  <ExternalLink class="w-3 h-3" />
                  {{ t('deployWizard.storage.upgradePlan') }}
                </button>
              </div>
            </div>

            <!-- Volume sharing toggle (when 2+ volumes) -->
            <div v-if="templateVolumes.length >= 2" class="flex items-center gap-3">
              <span class="text-xs font-medium text-gray-600 dark:text-gray-400">{{ t('deployWizard.storage.volumeStrategy') }}:</span>
              <div class="flex gap-1.5">
                <button
                  @click="setAllShared(false)"
                  :class="[
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    Object.keys(volumeShareGroups).length === 0
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
                  ]"
                >
                  {{ t('deployWizard.storage.separateVolumes') }}
                </button>
                <button
                  @click="setAllShared(true)"
                  :class="[
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    Object.keys(volumeShareGroups).length > 0 && ungroupedVolumes.length === 0
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
                  ]"
                >
                  {{ t('deployWizard.storage.sharedVolume') }}
                </button>
              </div>
            </div>

            <!-- Grouped volume cards -->
            <div v-for="(group, groupId) in volumeShareGroups" :key="groupId"
              class="p-4 rounded-lg border-l-4 border-l-blue-500 border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10">
              <div class="flex items-center justify-between mb-3">
                <div>
                  <div class="flex items-center gap-2">
                    <Link2 class="w-4 h-4 text-blue-500" />
                    <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('deployWizard.storage.sharedVolume') }}</p>
                  </div>
                  <div class="mt-1.5 space-y-1">
                    <div v-for="svc in allServicesForGroup(group)" :key="svc.name + svc.volume"
                      class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span class="font-medium text-gray-700 dark:text-gray-300">{{ svc.name }}</span>
                      <span class="text-gray-400">→</span>
                      <span class="font-mono">{{ svc.target }}</span>
                      <span class="text-gray-300 dark:text-gray-600">({{ svc.volume }})</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Members list with unlink -->
              <div class="flex flex-wrap gap-1.5 mb-3">
                <span v-for="vn in group.volumeNames" :key="vn"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                  {{ vn }}
                  <button v-if="group.volumeNames.length > 1" @click="unlinkVolume(vn)"
                    class="ml-0.5 p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                    :title="t('deployWizard.storage.unlink')">
                    <X class="w-2.5 h-2.5" />
                  </button>
                </span>
              </div>

              <!-- Mode toggle -->
              <div class="flex gap-2 mb-3">
                <button
                  @click="group.mode = 'create'"
                  :class="[
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    group.mode === 'create'
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
                  ]"
                >
                  {{ t('deployWizard.storage.createNew') }}
                </button>
                <button
                  @click="group.mode = 'existing'"
                  :disabled="existingVolumes.length === 0"
                  :class="[
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    group.mode === 'existing'
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600',
                    existingVolumes.length === 0 ? 'opacity-50 cursor-not-allowed' : ''
                  ]"
                >
                  {{ existingVolumes.length === 0 ? t('deployWizard.storage.useExistingNone') : t('deployWizard.storage.useExisting') }}
                </button>
              </div>

              <!-- Create New: size input -->
              <div v-if="group.mode === 'create'" class="flex items-center gap-3">
                <label class="text-xs text-gray-500 dark:text-gray-400 shrink-0">{{ t('deployWizard.storage.sizeGb') }}</label>
                <div class="flex items-center">
                  <button type="button" @click="group.sizeGb = Math.max(1, group.sizeGb - 1)" class="px-2 py-1.5 rounded-l-lg border border-r-0 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs hover:bg-gray-100 dark:hover:bg-gray-500">−</button>
                  <input
                    v-model.number="group.sizeGb"
                    type="number"
                    min="1"
                    :max="storageQuota ? Math.max(1, Math.floor(storageQuota.limitGb - storageQuota.usedGb)) : 1000"
                    class="w-16 px-2.5 py-1.5 border-y border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs text-center focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <button type="button" @click="group.sizeGb = Math.min(storageQuota ? Math.max(1, Math.floor(storageQuota.limitGb - storageQuota.usedGb)) : 1000, group.sizeGb + 1)" class="px-2 py-1.5 rounded-r-lg border border-l-0 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs hover:bg-gray-100 dark:hover:bg-gray-500">+</button>
                </div>
                <span class="text-xs text-gray-400">
                  {{ storageQuota ? t('deployWizard.storage.maxAvailable', { amount: Math.max(0, Math.floor(storageQuota.limitGb - storageQuota.usedGb)) }) : '' }}
                </span>
              </div>

              <!-- Use Existing: dropdown -->
              <div v-if="group.mode === 'existing'">
                <select
                  v-model="group.existingVolumeName"
                  class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">{{ t('deployWizard.storage.selectVolume') }}</option>
                  <option v-for="ev in existingVolumes" :key="ev.name" :value="ev.name">
                    {{ ev.displayName }} ({{ ev.sizeGb }} GB)
                  </option>
                </select>
              </div>
            </div>

            <!-- Ungrouped volume cards -->
            <div v-for="vol in ungroupedVolumes" :key="vol.name" class="p-4 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-750">
              <div class="flex items-center justify-between mb-3">
                <div>
                  <p class="text-sm font-semibold text-gray-900 dark:text-white font-mono">{{ vol.name }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {{ t('deployWizard.storage.usedBy') }}: <span v-for="(svc, i) in vol.usedBy" :key="svc.name">{{ i > 0 ? ', ' : '' }}<span class="font-medium">{{ svc.name }}</span> ({{ svc.target }})</span>
                  </p>
                </div>
                <!-- Link button (only when other ungrouped volumes exist) -->
                <div v-if="ungroupedVolumes.length >= 2" class="relative">
                  <button
                    @click.stop="linkDropdownOpen = linkDropdownOpen === vol.name ? null : vol.name"
                    class="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                    :title="t('deployWizard.storage.linkWithAnother')"
                  >
                    <Link2 class="w-4 h-4" />
                  </button>
                  <!-- Link dropdown -->
                  <div v-if="linkDropdownOpen === vol.name"
                    class="absolute right-0 top-full mt-1 z-10 w-48 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-1">
                    <p class="px-3 py-1.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{{ t('deployWizard.storage.linkWith') }}</p>
                    <button v-for="other in ungroupedVolumes.filter(v => v.name !== vol.name)" :key="other.name"
                      @click="linkVolumes(vol.name, other.name)"
                      class="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-mono transition-colors"
                    >
                      {{ other.name }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- Mode toggle -->
              <div class="flex gap-2 mb-3">
                <button
                  @click="volumeConfigs[vol.name]!.mode = 'create'"
                  :class="[
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    volumeConfigs[vol.name]?.mode === 'create'
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
                  ]"
                >
                  {{ t('deployWizard.storage.createNew') }}
                </button>
                <button
                  @click="volumeConfigs[vol.name]!.mode = 'existing'"
                  :disabled="existingVolumes.length === 0"
                  :class="[
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    volumeConfigs[vol.name]?.mode === 'existing'
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600',
                    existingVolumes.length === 0 ? 'opacity-50 cursor-not-allowed' : ''
                  ]"
                >
                  {{ existingVolumes.length === 0 ? t('deployWizard.storage.useExistingNone') : t('deployWizard.storage.useExisting') }}
                </button>
              </div>

              <!-- Create New: size input -->
              <div v-if="volumeConfigs[vol.name]?.mode === 'create'" class="flex items-center gap-3">
                <label class="text-xs text-gray-500 dark:text-gray-400 shrink-0">{{ t('deployWizard.storage.sizeGb') }}</label>
                <div class="flex items-center">
                  <button type="button" @click="volumeConfigs[vol.name]!.sizeGb = Math.max(1, volumeConfigs[vol.name]!.sizeGb - 1)" class="px-2 py-1.5 rounded-l-lg border border-r-0 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs hover:bg-gray-100 dark:hover:bg-gray-500">−</button>
                  <input
                    v-model.number="volumeConfigs[vol.name]!.sizeGb"
                    type="number"
                    min="1"
                    :max="storageQuota ? Math.max(1, Math.floor(storageQuota.limitGb - storageQuota.usedGb)) : 1000"
                    class="w-16 px-2.5 py-1.5 border-y border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs text-center focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <button type="button" @click="volumeConfigs[vol.name]!.sizeGb = Math.min(storageQuota ? Math.max(1, Math.floor(storageQuota.limitGb - storageQuota.usedGb)) : 1000, volumeConfigs[vol.name]!.sizeGb + 1)" class="px-2 py-1.5 rounded-r-lg border border-l-0 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs hover:bg-gray-100 dark:hover:bg-gray-500">+</button>
                </div>
                <span class="text-xs text-gray-400">
                  {{ storageQuota ? t('deployWizard.storage.maxAvailable', { amount: Math.max(0, Math.floor(storageQuota.limitGb - storageQuota.usedGb)) }) : '' }}
                </span>
              </div>

              <!-- Use Existing: dropdown -->
              <div v-if="volumeConfigs[vol.name]?.mode === 'existing'">
                <select
                  v-model="volumeConfigs[vol.name]!.existingVolumeName"
                  class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">{{ t('deployWizard.storage.selectVolume') }}</option>
                  <option v-for="ev in existingVolumes" :key="ev.name" :value="ev.name">
                    {{ ev.displayName }} ({{ ev.sizeGb }} GB)
                  </option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 4: Plan Selection -->
      <div v-if="currentStep === 4 && !deployed" class="space-y-6">
        <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div class="flex items-center gap-2">
              <Cpu class="w-5 h-5 text-primary-600 dark:text-primary-400" />
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Choose a Plan</h2>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Select a plan for this stack. Resource limits are determined by your chosen tier.</p>
          </div>

          <div class="p-6">
            <TierSelector v-model="selectedStackPlanId" />
          </div>
        </div>
      </div>

      <!-- Step 5: Review & Deploy / Progress -->
      <div v-if="currentStep === 5" class="space-y-6">
        <!-- Deploy error -->
        <div v-if="deployError" class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div class="flex items-start gap-2">
            <AlertTriangle class="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p class="text-sm font-medium text-red-800 dark:text-red-300">{{ t('deployWizard.errors.deploymentFailed') }}</p>
              <p class="text-sm text-red-700 dark:text-red-400 mt-1">{{ deployError }}</p>
            </div>
          </div>
        </div>

        <!-- Review (before deploy) -->
        <template v-if="!deployed && !deploying">
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('deployWizard.review.title') }}</h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('deployWizard.review.description') }}</p>
            </div>
            <div class="p-6 space-y-5">
              <!-- Services summary -->
              <div>
                <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{{ t('deployWizard.review.services') }}</h3>
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

              <!-- Storage summary -->
              <div v-if="hasVolumes">
                <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{{ t('deployWizard.review.storage') }}</h3>
                <div class="space-y-1.5">
                  <!-- Grouped (shared) volumes -->
                  <div v-for="(group, groupId) in volumeShareGroups" :key="groupId"
                    class="py-2 px-3 rounded bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <Link2 class="w-3.5 h-3.5 text-blue-500" />
                        <span class="text-xs font-medium text-blue-700 dark:text-blue-300">{{ t('deployWizard.storage.sharedVolume') }}</span>
                        <span class="text-xs text-blue-600 dark:text-blue-400 font-mono">
                          ({{ group.volumeNames.join(', ') }})
                        </span>
                      </div>
                      <span class="text-sm text-gray-900 dark:text-white">
                        <template v-if="group.mode === 'create'">{{ t('deployWizard.review.newVolume', { size: group.sizeGb }) }}</template>
                        <template v-else>{{ t('deployWizard.review.existingVolume', { name: existingVolumes.find(v => v.name === group.existingVolumeName)?.displayName || group.existingVolumeName }) }}</template>
                      </span>
                    </div>
                  </div>
                  <!-- Ungrouped volumes -->
                  <div v-for="vol in ungroupedVolumes" :key="vol.name" class="flex items-center justify-between py-1.5">
                    <span class="text-sm text-gray-600 dark:text-gray-400 font-mono">{{ vol.name }}</span>
                    <span class="text-sm text-gray-900 dark:text-white">
                      <template v-if="volumeConfigs[vol.name]?.mode === 'create'">
                        {{ t('deployWizard.review.newVolume', { size: volumeConfigs[vol.name]!.sizeGb }) }}
                      </template>
                      <template v-else>
                        {{ t('deployWizard.review.existingVolume', { name: existingVolumes.find(v => v.name === volumeConfigs[vol.name]?.existingVolumeName)?.displayName || volumeConfigs[vol.name]!.existingVolumeName }) }}
                      </template>
                    </span>
                  </div>
                </div>
              </div>

              <!-- Config summary -->
              <div v-if="Object.keys(config).length > 0">
                <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">{{ t('deployWizard.review.configuration') }}</h3>
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
              :disabled="deploying || !selectedStackPlanId"
              class="flex items-center gap-3 px-8 py-4 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-base font-semibold transition-all hover:shadow-lg hover:shadow-primary-600/25 active:scale-[0.98]"
            >
              <Rocket class="w-5 h-5" />
              {{ t('deployWizard.review.deployButton', { name: template.name }) }}
            </button>
          </div>
        </template>

        <!-- Deploying spinner -->
        <div v-if="deploying && !deployed" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-12 text-center">
          <Loader2 class="w-10 h-10 text-primary-600 dark:text-primary-400 animate-spin mx-auto mb-4" />
          <p class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('deployWizard.progress.deployingStack') }}</p>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('deployWizard.progress.settingUp') }}</p>
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
                <p class="text-lg font-semibold text-green-800 dark:text-green-300">{{ t('deployWizard.progress.allRunning') }}</p>
                <p class="text-sm text-green-600 dark:text-green-400">{{ t('deployWizard.progress.stackReady', { name: template.name }) }}</p>
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
                  {{ overallStatus === 'failed' ? t('deployWizard.errors.deploymentFailed') : t('deployWizard.errors.someServicesFailed') }}
                </p>
                <p class="text-sm text-red-600 dark:text-red-400">{{ t('deployWizard.errors.checkDetails') }}</p>
              </div>
            </div>
          </div>

          <!-- Service statuses -->
          <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('deployWizard.progress.title') }}</h2>
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
                  {{ t('deployWizard.progress.details') }} <ExternalLink class="w-3 h-3" />
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
              {{ t('deployWizard.backToMarketplace') }}
            </button>
            <button
              @click="goToServices"
              class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
            >
              {{ t('deployWizard.goToServices') }}
              <ArrowRight class="w-4 h-4" />
            </button>
          </div>
        </template>
      </div>

      <!-- Navigation (steps 1-4) -->
      <div v-if="!deployed && currentStep < 5" class="flex items-center justify-between mt-8">
        <button
          @click="prevStep"
          :disabled="currentStep === 1"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          <ArrowLeft class="w-4 h-4" />
          {{ t('deployWizard.nav.back') }}
        </button>
        <button
          @click="nextStep"
          :disabled="!canProceed"
          class="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          {{ currentStep === 4 ? t('deployWizard.nav.reviewAndDeploy') : t('deployWizard.nav.continue') }}
          <ArrowRight class="w-4 h-4" />
        </button>
      </div>

      <!-- Step 5 back button (before deploy) -->
      <div v-if="currentStep === 5 && !deployed && !deploying" class="flex items-center justify-between mt-8">
        <button
          @click="prevStep"
          class="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
        >
          <ArrowLeft class="w-4 h-4" />
          {{ t('deployWizard.nav.back') }}
        </button>
        <div></div>
      </div>
    </template>
  </div>
</template>
