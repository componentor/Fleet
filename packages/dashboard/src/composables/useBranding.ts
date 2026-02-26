import { ref } from 'vue'

const BASE_URL = import.meta.env.VITE_API_URL || ''

// Module-level singleton — shared across all components
let fetchPromise: Promise<void> | null = null

const brandTitle = ref<string>('Fleet')
const brandLogoUrl = ref<string | null>(null)
const brandFaviconUrl = ref<string | null>(null)
const brandGithubUrl = ref<string | null>(null)
const loaded = ref(false)

function applyBranding() {
  // Set document title
  document.title = brandTitle.value || 'Fleet'

  // Set favicon — override the default SVG when custom branding is set,
  // otherwise leave the default <link> from index.html intact.
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
  if (brandFaviconUrl.value) {
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.type = ''
    link.href = `${BASE_URL}${brandFaviconUrl.value}`
  }
}

async function fetchBranding() {
  try {
    // Try localStorage cache first for instant render
    const cached = localStorage.getItem('fleet_branding')
    if (cached) {
      try {
        const data = JSON.parse(cached)
        brandTitle.value = data.title || 'Fleet'
        brandLogoUrl.value = data.logoUrl
        brandFaviconUrl.value = data.faviconUrl
        brandGithubUrl.value = data.githubUrl ?? null
        applyBranding()
      } catch { /* invalid cache */ }
    }

    const res = await fetch(`${BASE_URL}/api/v1/branding/info`)
    if (res.ok) {
      const data = await res.json()
      brandTitle.value = data.title || 'Fleet'
      brandLogoUrl.value = data.logoUrl
      brandFaviconUrl.value = data.faviconUrl
      brandGithubUrl.value = data.githubUrl ?? null
      localStorage.setItem('fleet_branding', JSON.stringify(data))
      applyBranding()
    }
  } catch {
    // Branding is best-effort
  } finally {
    loaded.value = true
  }
}

function init() {
  if (!fetchPromise) {
    fetchPromise = fetchBranding()
  }
  return fetchPromise
}

function refresh() {
  fetchPromise = null
  return init()
}

export function useBranding() {
  init()
  return {
    brandTitle,
    brandLogoUrl: brandLogoUrl as typeof brandLogoUrl,
    brandFaviconUrl,
    brandGithubUrl,
    loaded,
    refresh,
    /** Full URL for logo image src */
    logoSrc: () => brandLogoUrl.value ? `${BASE_URL}${brandLogoUrl.value}` : null,
  }
}
