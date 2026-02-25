import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Service, CreateServiceInput, UpdateServiceInput } from '@fleet/types'
import { useApi } from '@/composables/useApi'

export const useServicesStore = defineStore('services', () => {
  const api = useApi()

  const services = ref<Service[]>([])
  const currentService = ref<Service | null>(null)
  const loading = ref(false)

  async function fetchServices() {
    loading.value = true
    try {
      const data = await api.get<Service[]>('/services')
      services.value = data
      return data
    } finally {
      loading.value = false
    }
  }

  async function getService(id: string) {
    loading.value = true
    try {
      const data = await api.get<Service>(`/services/${id}`)
      currentService.value = data
      return data
    } finally {
      loading.value = false
    }
  }

  async function createService(input: CreateServiceInput) {
    loading.value = true
    try {
      const data = await api.post<Service>('/services', input)
      services.value.push(data)
      return data
    } finally {
      loading.value = false
    }
  }

  async function updateService(id: string, input: UpdateServiceInput) {
    loading.value = true
    try {
      const data = await api.patch<Service>(`/services/${id}`, input)
      const index = services.value.findIndex((s) => s.id === id)
      if (index !== -1) {
        services.value[index] = data
      }
      if (currentService.value?.id === id) {
        currentService.value = data
      }
      return data
    } finally {
      loading.value = false
    }
  }

  async function deleteService(id: string, opts?: { deleteVolumes?: boolean }) {
    // Optimistic: remove from local state immediately
    const previous = services.value
    services.value = services.value.filter((s) => s.id !== id)
    if (currentService.value?.id === id) {
      currentService.value = null
    }
    try {
      const qs = opts?.deleteVolumes ? '?deleteVolumes=true' : ''
      await api.del(`/services/${id}${qs}`)
    } catch (err) {
      // Rollback on failure
      services.value = previous
      throw err
    }
  }

  async function deleteStack(stackId: string, opts?: { deleteVolumes?: boolean }) {
    // Optimistic: remove all services in this stack immediately
    const previous = services.value
    services.value = services.value.filter((s) => s.stackId !== stackId)
    if (currentService.value?.stackId === stackId) {
      currentService.value = null
    }
    try {
      const qs = opts?.deleteVolumes ? '?deleteVolumes=true' : ''
      await api.del(`/services/stack/${stackId}${qs}`)
    } catch (err) {
      // Rollback on failure
      services.value = previous
      throw err
    }
  }

  return {
    services,
    currentService,
    loading,
    fetchServices,
    getService,
    createService,
    updateService,
    deleteService,
    deleteStack,
  }
})
