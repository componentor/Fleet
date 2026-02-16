<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'
import { SquareTerminal, Loader2 } from 'lucide-vue-next'
import { useServicesStore } from '@/stores/services'
import { useTerminal } from '@/composables/useTerminal'

const servicesStore = useServicesStore()
const { createTerminal, connect, disconnect } = useTerminal()

const selectedService = ref('')
const connected = ref(false)
const terminalContainer = ref<HTMLElement | null>(null)
const terminalCreated = ref(false)
const loading = ref(true)

async function loadServices() {
  loading.value = true
  try {
    await servicesStore.fetchServices()
  } finally {
    loading.value = false
  }
}

watch(selectedService, async (serviceId) => {
  disconnect()
  connected.value = false

  if (!serviceId) return

  if (!terminalCreated.value && terminalContainer.value) {
    createTerminal(terminalContainer.value)
    terminalCreated.value = true
  }

  await nextTick()
  connect(serviceId)
  connected.value = true
})

onMounted(() => {
  loadServices()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <SquareTerminal class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Terminal</h1>
    </div>

    <!-- Service selector -->
    <div class="mb-6">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Select Service</label>
      <div class="flex items-center gap-3">
        <select
          v-model="selectedService"
          :disabled="loading"
          class="w-full max-w-md px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
        >
          <option value="" disabled>{{ loading ? 'Loading services...' : 'Choose a service...' }}</option>
          <option v-for="service in servicesStore.services" :key="service.id" :value="service.id">
            {{ service.name }}
          </option>
        </select>
        <Loader2 v-if="loading" class="w-5 h-5 text-primary-600 dark:text-primary-400 animate-spin shrink-0" />
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
            {{ selectedService ? `Terminal - ${servicesStore.services.find(s => s.id === selectedService)?.name || selectedService}` : 'Terminal' }}
          </span>
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
            {{ connected ? 'Connected' : 'Disconnected' }}
          </span>
        </div>
      </div>
      <div ref="terminalContainer" class="h-[500px]">
        <div v-if="!selectedService && !terminalCreated" class="h-full flex items-center justify-center">
          <p class="text-gray-500 text-sm">Select a service to open a terminal session.</p>
        </div>
      </div>
    </div>
  </div>
</template>
