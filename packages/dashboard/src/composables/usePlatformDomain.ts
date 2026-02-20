import { ref, computed } from 'vue'
import { useApi } from './useApi'

// Module-level cache — one fetch per session, shared across all components
const cachedDomain = ref<string | null>(null)
let fetchPromise: Promise<void> | null = null

export function usePlatformDomain() {
  const api = useApi()

  function fetchDomain(): Promise<void> {
    if (cachedDomain.value) return Promise.resolve()
    // Deduplicate concurrent calls
    if (fetchPromise) return fetchPromise

    fetchPromise = api
      .get<{ domain: string | null }>('/settings/platform-domain')
      .then((data) => {
        cachedDomain.value = data.domain || window.location.hostname
      })
      .catch(() => {
        cachedDomain.value = window.location.hostname
      })

    return fetchPromise
  }

  const domain = computed(() => cachedDomain.value || window.location.hostname)

  return { domain, fetchDomain }
}
