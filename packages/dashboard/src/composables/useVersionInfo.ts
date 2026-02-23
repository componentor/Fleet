import { ref } from 'vue'

/** Shared reactive version state — updated by the Updates page, read by SuperLayout */
export const versionInfo = ref<{
  current: string
  latest: string | null
  updateAvailable: boolean
} | null>(null)

/**
 * Compare two semver-like version strings.
 * Returns true if a >= b.
 */
function isNewerOrEqual(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').replace(/-.*$/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').replace(/-.*$/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return true
    if (na < nb) return false
  }
  return true // equal
}

export function updateVersion(current: string, latest?: string | null, updateAvailable?: boolean) {
  // Never downgrade the displayed version (protects against stale API responses during restart)
  if (versionInfo.value?.current && current && !isNewerOrEqual(current, versionInfo.value.current)) {
    return
  }
  versionInfo.value = {
    current,
    latest: latest ?? versionInfo.value?.latest ?? null,
    updateAvailable: updateAvailable ?? false,
  }
}
