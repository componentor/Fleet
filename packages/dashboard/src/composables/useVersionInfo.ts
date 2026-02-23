import { ref } from 'vue'

/** Shared reactive version state — updated by the Updates page, read by SuperLayout */
export const versionInfo = ref<{
  current: string
  latest: string | null
  updateAvailable: boolean
} | null>(null)

export function updateVersion(current: string, latest?: string | null, updateAvailable?: boolean) {
  versionInfo.value = {
    current,
    latest: latest ?? versionInfo.value?.latest ?? null,
    updateAvailable: updateAvailable ?? false,
  }
}
