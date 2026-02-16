import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Service, CreateServiceInput, UpdateServiceInput } from '@hoster/types'
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

  async function deleteService(id: string) {
    loading.value = true
    try {
      await api.del(`/services/${id}`)
      services.value = services.value.filter((s) => s.id !== id)
      if (currentService.value?.id === id) {
        currentService.value = null
      }
    } finally {
      loading.value = false
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
  }
})
