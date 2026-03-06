<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useApi } from '@/composables/useApi'
import { useServicesStore } from '@/stores/services'
import { useServiceBilling, usePlanLocale, type ServiceSubscription, type ServiceTier } from '@/composables/useServiceBilling'
import { useCurrency } from '@/composables/useCurrency'
import { ArrowLeft, Play, Square, RotateCcw, Trash2, Cpu, MemoryStick, HardDrive, Layers } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'

const props = defineProps<{ stackId: string }>()
const { t } = useI18n()
const router = useRouter()
const api = useApi()
const store = useServicesStore()
const serviceBilling = useServiceBilling()
const { planName } = usePlanLocale()
const { formatCents } = useCurrency()

const loading = ref(true)
const actionLoading = ref(false)
const stackSubscription = ref<ServiceSubscription | null>(null)
const showDeleteConfirm = ref(false)
const deleteVolumeSelections = ref<Record<string, boolean>>({})

// Fetch data
onMounted(async () => {
  await store.fetchServices()
  // Try to fetch stack subscription
  try {
    const subs = await api.get<any[]>('/billing/service-subscriptions')
    stackSubscription.value = subs?.find((s: any) => s.stackId === props.stackId) ?? null
  } catch { /* ignore */ }
  loading.value = false
})

const stackServices = computed(() =>
  store.services.filter((s: any) => s.stackId === props.stackId)
)

const stackName = computed(() => {
  if (stackServices.value.length === 0) return 'Stack'
  if (stackServices.value.length === 1) return (stackServices.value[0] as any)?.name ?? 'Stack'
  return stackServices.value.map((s: any) => s.name).join(' + ')
})

const stackStatus = computed(() => {
  const svcs = stackServices.value
  if (svcs.some((s: any) => s.status === 'failed')) return 'failed'
  if (svcs.some((s: any) => s.status === 'deploying')) return 'deploying'
  if (svcs.every((s: any) => s.status === 'running')) return 'running'
  if (svcs.every((s: any) => s.status === 'stopped')) return 'stopped'
  return 'mixed'
})

const statusColor = computed(() => {
  switch (stackStatus.value) {
    case 'running': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
    case 'deploying': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
    case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
  }
})

// Aggregate resource usage
const totalCpu = computed(() => stackServices.value.reduce((sum: number, s: any) => sum + (s.cpuLimit ?? 0), 0))
const totalMemory = computed(() => stackServices.value.reduce((sum: number, s: any) => sum + (s.memoryLimit ?? 0), 0))
const totalReplicas = computed(() => stackServices.value.reduce((sum: number, s: any) => sum + (s.replicas ?? 1), 0))

const plan = computed(() => stackSubscription.value?.plan as ServiceTier | null)

// Volumes (deduplicated)
const stackVolumes = computed(() => {
  const seen = new Set<string>()
  const vols: Array<{ source: string; target: string; services: string[] }> = []
  for (const svc of stackServices.value) {
    const svcVols = ((svc as any).volumes as Array<{ source: string; target: string }>) ?? []
    for (const v of svcVols) {
      if (!v.source) continue
      if (seen.has(v.source)) {
        const existing = vols.find(ev => ev.source === v.source)
        if (existing) existing.services.push((svc as any).name)
      } else {
        seen.add(v.source)
        vols.push({ source: v.source, target: v.target, services: [(svc as any).name] })
      }
    }
  }
  return vols
})

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`
  return `${mb} MB`
}

function svcStatusColor(status: string) {
  switch (status) {
    case 'running': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
    case 'deploying': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
    case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    case 'stopped': return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
    default: return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
  }
}

async function startAll() {
  actionLoading.value = true
  try {
    const stopped = stackServices.value.filter((s: any) => s.status === 'stopped')
    await Promise.all(stopped.map((s: any) => api.post(`/services/${s.id}/start`, {})))
    await store.fetchServices()
  } catch { /* ignore */ }
  actionLoading.value = false
}

async function stopAll() {
  actionLoading.value = true
  try {
    const running = stackServices.value.filter((s: any) => s.status === 'running')
    await Promise.all(running.map((s: any) => api.post(`/services/${s.id}/stop`, {})))
    await store.fetchServices()
  } catch { /* ignore */ }
  actionLoading.value = false
}

async function restartAll() {
  actionLoading.value = true
  try {
    await api.post(`/services/stack/${props.stackId}/restart`, {})
    await store.fetchServices()
  } catch { /* ignore */ }
  actionLoading.value = false
}

function promptDelete() {
  deleteVolumeSelections.value = {}
  for (const vol of stackVolumes.value) {
    deleteVolumeSelections.value[vol.source] = true
  }
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  actionLoading.value = true
  try {
    const deleteVolumeNames = Object.entries(deleteVolumeSelections.value)
      .filter(([, v]) => v)
      .map(([name]) => name)
    await api.del(`/services/stack/${props.stackId}`, { deleteVolumeNames })
    router.push('/panel/services')
  } catch { /* ignore */ }
  actionLoading.value = false
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-6 space-y-6">
    <!-- Header -->
    <div class="flex items-center gap-4">
      <button @click="router.push('/panel/services')" class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
        <ArrowLeft class="w-5 h-5 text-gray-500 dark:text-gray-400" />
      </button>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-3">
          <Layers class="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white truncate">{{ stackName }}</h1>
          <span :class="['px-2 py-0.5 rounded-full text-xs font-medium', statusColor]">{{ stackStatus }}</span>
        </div>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ stackServices.length }} service{{ stackServices.length !== 1 ? 's' : '' }}</p>
      </div>
      <div class="flex items-center gap-2">
        <button v-if="stackServices.some((s: any) => s.status === 'stopped')" @click="startAll" :disabled="actionLoading" class="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50 transition-colors">
          <Play class="w-3.5 h-3.5 inline mr-1" /> Start All
        </button>
        <button v-if="stackServices.some((s: any) => s.status === 'running')" @click="stopAll" :disabled="actionLoading" class="px-3 py-1.5 rounded-lg bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium disabled:opacity-50 transition-colors">
          <Square class="w-3.5 h-3.5 inline mr-1" /> Stop All
        </button>
        <button @click="restartAll" :disabled="actionLoading" class="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium disabled:opacity-50 transition-colors">
          <RotateCcw class="w-3.5 h-3.5 inline mr-1" /> Restart
        </button>
        <button @click="promptDelete" :disabled="actionLoading" class="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 transition-colors">
          <Trash2 class="w-3.5 h-3.5 inline mr-1" /> Delete
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-12">
      <CompassSpinner color="text-primary-600" />
    </div>

    <template v-else>
      <!-- Tier Card -->
      <div v-if="plan" class="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-blue-900 dark:text-blue-200">{{ planName(plan) }} Tier</h3>
          <span v-if="!plan.isFree" class="text-sm font-bold text-blue-900 dark:text-blue-100">{{ formatCents(plan.priceCents) }}/mo</span>
          <span v-else class="text-sm font-bold text-blue-900 dark:text-blue-100">Free</span>
        </div>
        <div class="grid grid-cols-3 gap-4">
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="text-blue-700 dark:text-blue-300 flex items-center gap-1"><Cpu class="w-3 h-3" /> CPU</span>
              <span class="font-medium text-blue-900 dark:text-blue-100">{{ totalCpu }} / {{ plan.cpuLimit }} cores</span>
            </div>
            <div class="h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all" :class="plan.cpuLimit > 0 && totalCpu / plan.cpuLimit > 0.9 ? 'bg-red-500' : 'bg-blue-500'" :style="{ width: plan.cpuLimit > 0 ? Math.min(100, (totalCpu / plan.cpuLimit) * 100) + '%' : '0%' }" />
            </div>
          </div>
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="text-blue-700 dark:text-blue-300 flex items-center gap-1"><MemoryStick class="w-3 h-3" /> Memory</span>
              <span class="font-medium text-blue-900 dark:text-blue-100">{{ formatMb(totalMemory) }} / {{ formatMb(plan.memoryLimit) }}</span>
            </div>
            <div class="h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all" :class="plan.memoryLimit > 0 && totalMemory / plan.memoryLimit > 0.9 ? 'bg-red-500' : 'bg-blue-500'" :style="{ width: plan.memoryLimit > 0 ? Math.min(100, (totalMemory / plan.memoryLimit) * 100) + '%' : '0%' }" />
            </div>
          </div>
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="text-blue-700 dark:text-blue-300 flex items-center gap-1"><HardDrive class="w-3 h-3" /> Containers</span>
              <span class="font-medium text-blue-900 dark:text-blue-100">{{ totalReplicas }} / {{ plan.containerLimit }}</span>
            </div>
            <div class="h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all" :class="plan.containerLimit > 0 && totalReplicas / plan.containerLimit > 0.9 ? 'bg-red-500' : 'bg-blue-500'" :style="{ width: plan.containerLimit > 0 ? Math.min(100, (totalReplicas / plan.containerLimit) * 100) + '%' : '0%' }" />
            </div>
          </div>
        </div>
      </div>

      <!-- Services Table -->
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Services</h3>
        </div>
        <table class="w-full">
          <thead>
            <tr class="border-b border-gray-100 dark:border-gray-700">
              <th class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-6 py-3">Name</th>
              <th class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-6 py-3">Status</th>
              <th class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-6 py-3">CPU</th>
              <th class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-6 py-3">Memory</th>
              <th class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-6 py-3">Replicas</th>
              <th class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-6 py-3">Domain</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="svc in stackServices"
              :key="(svc as any).id"
              class="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer transition-colors"
              @click="router.push(`/panel/services/${(svc as any).id}`)"
            >
              <td class="px-6 py-3 text-sm font-medium text-gray-900 dark:text-white">{{ (svc as any).name }}</td>
              <td class="px-6 py-3">
                <span :class="['px-2 py-0.5 rounded-full text-xs font-medium', svcStatusColor((svc as any).status)]">{{ (svc as any).status }}</span>
              </td>
              <td class="px-6 py-3 text-sm text-gray-600 dark:text-gray-400">{{ (svc as any).cpuLimit ?? '-' }}</td>
              <td class="px-6 py-3 text-sm text-gray-600 dark:text-gray-400">{{ (svc as any).memoryLimit ? formatMb((svc as any).memoryLimit) : '-' }}</td>
              <td class="px-6 py-3 text-sm text-gray-600 dark:text-gray-400">{{ (svc as any).replicas ?? 1 }}</td>
              <td class="px-6 py-3 text-sm text-gray-600 dark:text-gray-400 font-mono text-xs">{{ (svc as any).domain || '-' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="stackServices.length === 0" class="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No services in this stack.
        </div>
      </div>

      <!-- Volumes -->
      <div v-if="stackVolumes.length > 0" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Volumes</h3>
        </div>
        <div class="divide-y divide-gray-100 dark:divide-gray-700">
          <div v-for="vol in stackVolumes" :key="vol.source" class="px-6 py-3 flex items-center justify-between">
            <div>
              <span class="text-sm font-mono text-gray-900 dark:text-white">{{ vol.source }}</span>
              <span class="text-xs text-gray-400 ml-2">→ {{ vol.target }}</span>
            </div>
            <span class="text-xs text-gray-500 dark:text-gray-400">{{ vol.services.join(', ') }}</span>
          </div>
        </div>
      </div>

      <!-- Billing -->
      <div v-if="stackSubscription" class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-4">Billing</h3>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <span class="text-gray-500 dark:text-gray-400 block">Plan</span>
            <span class="font-medium text-gray-900 dark:text-white">{{ stackSubscription.plan ? planName(stackSubscription.plan) : 'Unknown' }}</span>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block">Price</span>
            <span class="font-medium text-gray-900 dark:text-white">
              {{ stackSubscription.plan?.isFree ? 'Free' : formatCents(stackSubscription.plan?.priceCents ?? 0) + '/mo' }}
            </span>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block">Status</span>
            <span class="font-medium text-gray-900 dark:text-white capitalize">{{ stackSubscription.status }}</span>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block">Cycle</span>
            <span class="font-medium text-gray-900 dark:text-white capitalize">{{ stackSubscription.billingCycle }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- Delete Confirmation Modal -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showDeleteConfirm" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="showDeleteConfirm = false">
          <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Delete Stack</h3>
            </div>
            <div class="px-6 py-4 space-y-3">
              <p class="text-sm text-gray-600 dark:text-gray-400">
                This will delete all {{ stackServices.length }} service{{ stackServices.length !== 1 ? 's' : '' }} in this stack.
              </p>
              <div v-if="stackVolumes.length > 0">
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Also delete volumes:</p>
                <label v-for="vol in stackVolumes" :key="vol.source" class="flex items-center gap-2 text-sm cursor-pointer mb-1">
                  <input type="checkbox" v-model="deleteVolumeSelections[vol.source]" class="rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500" />
                  <span class="font-mono text-xs text-gray-600 dark:text-gray-400">{{ vol.source }}</span>
                </label>
              </div>
            </div>
            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button @click="showDeleteConfirm = false" class="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:underline">Cancel</button>
              <button @click="confirmDelete" :disabled="actionLoading" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors">
                {{ actionLoading ? 'Deleting...' : 'Delete Stack' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
