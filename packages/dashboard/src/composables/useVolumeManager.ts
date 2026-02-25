import { ref } from 'vue'
import { useApi } from './useApi'

const DATABASE_VOLUME_PATHS: Record<string, string> = {
  postgres: '/var/lib/postgresql/data',
  timescaledb: '/var/lib/postgresql/data',
  mysql: '/var/lib/mysql',
  mariadb: '/var/lib/mysql',
  mongo: '/data/db',
  redis: '/data',
  valkey: '/data',
  clickhouse: '/var/lib/clickhouse',
  influxdb: '/var/lib/influxdb2',
  minio: '/data',
  elasticsearch: '/usr/share/elasticsearch/data',
  cassandra: '/var/lib/cassandra',
  neo4j: '/data',
  cockroachdb: '/cockroach/cockroach-data',
}

export interface VolumeInfo {
  name: string
  displayName: string
  sizeGb: number
}

export interface StorageQuota {
  usedGb: number
  limitGb: number
}

export function useVolumeManager() {
  const api = useApi()

  const accountVolumes = ref<VolumeInfo[]>([])
  const storageQuota = ref<StorageQuota | null>(null)
  const volumesLoading = ref(false)
  const createLoading = ref(false)
  const createError = ref('')

  async function fetchVolumes() {
    volumesLoading.value = true
    try {
      const vols = await api.get<any[]>('/storage/volumes')
      accountVolumes.value = (vols ?? []).map((v: any) => ({
        name: v.name,
        displayName: v.displayName ?? v.name.replace(/^vol-[a-f0-9-]+-/, ''),
        sizeGb: v.sizeGb ?? 0,
      }))
    } catch {
      // ignore
    } finally {
      volumesLoading.value = false
    }
  }

  async function fetchQuota() {
    try {
      const q = await api.get<{ usedGb: number; limitGb: number }>('/storage/volumes/quota')
      storageQuota.value = { usedGb: Number(q.usedGb) || 0, limitGb: Number(q.limitGb) || 0 }
    } catch {
      // ignore
    }
  }

  async function fetchAll() {
    await Promise.all([fetchVolumes(), fetchQuota()])
  }

  async function createVolume(name: string, sizeGb: number, region?: string): Promise<VolumeInfo> {
    createLoading.value = true
    createError.value = ''
    try {
      const vol = await api.post<any>('/storage/volumes', { name, sizeGb, region })
      await fetchVolumes()
      return {
        name: vol.name,
        displayName: vol.displayName ?? name,
        sizeGb: vol.sizeGb ?? sizeGb,
      }
    } catch (err: any) {
      createError.value = err?.body?.error || 'Failed to create volume'
      throw err
    } finally {
      createLoading.value = false
    }
  }

  function remainingGb(): number | null {
    if (!storageQuota.value) return null
    return Math.max(0, storageQuota.value.limitGb - storageQuota.value.usedGb)
  }

  function isDatabaseImage(image: string): boolean {
    const base = image.split(':')[0]?.split('/').pop()?.toLowerCase() ?? ''
    return Object.keys(DATABASE_VOLUME_PATHS).some((db) => base.startsWith(db))
  }

  function suggestedVolumePath(image: string): string | null {
    const base = image.split(':')[0]?.split('/').pop()?.toLowerCase() ?? ''
    for (const [db, path] of Object.entries(DATABASE_VOLUME_PATHS)) {
      if (base.startsWith(db)) return path
    }
    return null
  }

  function suggestedVolumeName(serviceName: string): string {
    return `${serviceName}-data`
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }

  return {
    accountVolumes,
    storageQuota,
    volumesLoading,
    createLoading,
    createError,
    fetchVolumes,
    fetchQuota,
    fetchAll,
    createVolume,
    remainingGb,
    isDatabaseImage,
    suggestedVolumePath,
    suggestedVolumeName,
  }
}
