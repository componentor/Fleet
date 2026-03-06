<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { SquareTerminal } from 'lucide-vue-next'
import CompassSpinner from '@/components/CompassSpinner.vue'
import { useServicesStore } from '@/stores/services'
import { useApi } from '@/composables/useApi'
import { useTerminal } from '@/composables/useTerminal'
import '@xterm/xterm/css/xterm.css'

const { t } = useI18n()

const STORAGE_KEY = 'fleet_terminal_service'

const servicesStore = useServicesStore()
const api = useApi()
const { createTerminal, connect, disconnect, connectionState } = useTerminal()

const selectedService = ref('')
const terminalContainer = ref<HTMLElement | null>(null)
const terminalCreated = ref(false)
const loading = ref(true)
const terminalContainers = ref<{ containerId: string; nodeId: string; taskId: string }[]>([])
const selectedContainerId = ref('')

const connected = computed(() => connectionState.value === 'connected')

async function loadServices() {
  loading.value = true
  try {
    await servicesStore.fetchServices()
  } finally {
    loading.value = false
  }
}

async function fetchContainers(serviceId: string) {
  try {
    const info = await api.get<{ containers: { containerId: string; nodeId: string; taskId: string }[] }>(`/terminal/info/${serviceId}`)
    terminalContainers.value = info.containers ?? []
    if (terminalContainers.value.length > 0) {
      selectedContainerId.value = terminalContainers.value[0]!.containerId
    } else {
      selectedContainerId.value = ''
    }
  } catch {
    terminalContainers.value = []
    selectedContainerId.value = ''
  }
}

function getReplicaLabel(containerId?: string): string | undefined {
  if (terminalContainers.value.length <= 1) return undefined
  const idx = terminalContainers.value.findIndex((c) => c.containerId === containerId)
  return idx >= 0 ? t('terminal.replica', { n: idx + 1, id: containerId?.slice(0, 12) }) : undefined
}

function connectToService(serviceId: string) {
  if (!terminalCreated.value && terminalContainer.value) {
    createTerminal(terminalContainer.value)
    terminalCreated.value = true
  }

  connect(serviceId, selectedContainerId.value || undefined, getReplicaLabel(selectedContainerId.value))
  sessionStorage.setItem(STORAGE_KEY, serviceId)
}

function switchContainer(containerId: string) {
  selectedContainerId.value = containerId
  if (selectedService.value) {
    disconnect()
    connect(selectedService.value, containerId, getReplicaLabel(containerId))
  }
}

watch(selectedService, async (serviceId) => {
  disconnect()

  if (!serviceId) return

  await fetchContainers(serviceId)
  await nextTick()
  connectToService(serviceId)
})

onMounted(async () => {
  await loadServices()

  // Restore previous session's service selection and auto-reconnect
  const lastService = sessionStorage.getItem(STORAGE_KEY)
  if (lastService && servicesStore.services.some((s) => s.id === lastService)) {
    selectedService.value = lastService
  }
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <SquareTerminal class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ $t('terminal.title') }}</h1>
    </div>

    <!-- Service selector -->
    <div class="mb-6">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{{ $t('terminal.selectService') }}</label>
      <div class="flex items-center gap-3">
        <select
          v-model="selectedService"
          :disabled="loading"
          class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
        >
          <option value="" disabled>{{ loading ? $t('terminal.loadingServices') : $t('terminal.chooseService') }}</option>
          <option v-for="service in servicesStore.services" :key="service.id" :value="service.id">
            {{ service.name }}
          </option>
        </select>
        <CompassSpinner v-if="loading" size="w-5 h-5" class="shrink-0" />
      </div>
    </div>

    <!-- Terminal area -->
    <div class="bg-[#1a1b26] rounded-xl border border-gray-700 shadow-sm overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-red-500"></span>
          <span class="w-3 h-3 rounded-full bg-yellow-500"></span>
          <span class="w-3 h-3 rounded-full bg-green-500"></span>
          <span class="ml-2 text-xs text-gray-400">
            {{ selectedService ? `${$t('terminal.title')} - ${servicesStore.services.find(s => s.id === selectedService)?.name || selectedService}` : $t('terminal.title') }}
          </span>
          <select
            v-if="terminalContainers.length > 1"
            :value="selectedContainerId"
            @change="switchContainer(($event.target as HTMLSelectElement).value)"
            class="ml-2 px-2 py-0.5 rounded border border-gray-600 bg-gray-800 text-gray-300 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option v-for="(ctr, idx) in terminalContainers" :key="ctr.containerId" :value="ctr.containerId">
              {{ $t('terminal.replica', { n: idx + 1, id: ctr.containerId.slice(0, 12) }) }}
            </option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <span
            :class="[
              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
              connected
                ? 'bg-green-900/40 text-green-400'
                : 'bg-gray-700 text-gray-400'
            ]"
          >
            <span :class="['w-1.5 h-1.5 rounded-full', connected ? 'bg-green-400' : 'bg-gray-500']"></span>
            {{ connected ? $t('terminal.connected') : $t('terminal.disconnected') }}
          </span>
        </div>
      </div>
      <div class="h-[500px] pt-2 px-2 pb-4 bg-[#1a1b26]">
        <div v-if="!selectedService && !terminalCreated" class="h-full flex items-center justify-center">
          <p class="text-gray-500 text-sm">{{ $t('terminal.selectPrompt') }}</p>
        </div>
        <div v-else ref="terminalContainer" class="h-full"></div>
      </div>
    </div>
  </div>
</template>

