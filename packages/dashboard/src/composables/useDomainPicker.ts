import { ref, computed } from 'vue'
import { useApi } from './useApi'

export interface DomainOption {
  domain: string
  type: 'purchased' | 'external' | 'subdomain'
  status: 'active' | 'pending'
  verified: boolean
  assignedServiceId: string | null
  assignedServiceName: string | null
}

// Module-level cache — shared across all components that use this composable
const cachedDomains = ref<DomainOption[]>([])
const loading = ref(false)
let fetchPromise: Promise<void> | null = null

export function useDomainPicker() {
  const api = useApi()

  async function fetchDomains(force = false): Promise<void> {
    if (cachedDomains.value.length > 0 && !force) return
    if (fetchPromise && !force) return fetchPromise

    loading.value = true
    fetchPromise = (async () => {
      try {
        const [zones, registrations, claims, services] = await Promise.all([
          api.get<any[]>('/dns/zones').catch(() => []),
          api.get<any[]>('/domains/registrations').catch(() => []),
          api.get<any[]>('/shared-domains/mine').catch(() => []),
          api.get<any[]>('/services').catch(() => []),
        ])

        // Build a map of domain -> service for "in use" indicators
        const domainServiceMap = new Map<string, { id: string; name: string }>()
        for (const svc of services) {
          if (svc.domain) {
            domainServiceMap.set(svc.domain, { id: svc.id, name: svc.name })
          }
        }

        const purchased: DomainOption[] = registrations.map((r: any) => ({
          domain: r.domain,
          type: 'purchased' as const,
          status: (r.status === 'active' ? 'active' : 'pending') as 'active' | 'pending',
          verified: true,
          assignedServiceId: domainServiceMap.get(r.domain)?.id ?? null,
          assignedServiceName: domainServiceMap.get(r.domain)?.name ?? null,
        }))

        const purchasedSet = new Set(purchased.map(p => p.domain))

        const external: DomainOption[] = zones
          .filter((z: any) => !purchasedSet.has(z.domain))
          .map((z: any) => ({
            domain: z.domain,
            type: 'external' as const,
            status: (z.verified ? 'active' : 'pending') as 'active' | 'pending',
            verified: z.verified,
            assignedServiceId: domainServiceMap.get(z.domain)?.id ?? null,
            assignedServiceName: domainServiceMap.get(z.domain)?.name ?? null,
          }))

        const subdomain: DomainOption[] = claims.map((cl: any) => ({
          domain: cl.fullDomain,
          type: 'subdomain' as const,
          status: (cl.status === 'active' ? 'active' : 'pending') as 'active' | 'pending',
          verified: true,
          assignedServiceId: cl.serviceId ?? domainServiceMap.get(cl.fullDomain)?.id ?? null,
          assignedServiceName: cl.serviceName ?? domainServiceMap.get(cl.fullDomain)?.name ?? null,
        }))

        cachedDomains.value = [...purchased, ...external, ...subdomain]
      } catch {
        cachedDomains.value = []
      } finally {
        loading.value = false
      }
    })()

    return fetchPromise
  }

  const purchasedDomains = computed(() => cachedDomains.value.filter(d => d.type === 'purchased'))
  const externalDomains = computed(() => cachedDomains.value.filter(d => d.type === 'external'))
  const subdomainDomains = computed(() => cachedDomains.value.filter(d => d.type === 'subdomain'))

  function invalidateCache() {
    cachedDomains.value = []
    fetchPromise = null
  }

  return {
    domains: cachedDomains,
    loading,
    fetchDomains,
    purchasedDomains,
    externalDomains,
    subdomainDomains,
    invalidateCache,
  }
}
