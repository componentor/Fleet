import { ref, computed, watch } from 'vue'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'fleet_theme'

function detectSystemPreference(): ThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveInitialTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  const detected = detectSystemPreference()
  localStorage.setItem(STORAGE_KEY, detected)
  return detected
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.classList.toggle('dark', mode === 'dark')
  document.documentElement.classList.toggle('light', mode === 'light')
}

const theme = ref<ThemeMode>(resolveInitialTheme())
applyTheme(theme.value)

watch(theme, (val) => {
  localStorage.setItem(STORAGE_KEY, val)
  applyTheme(val)
})

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  theme.value = e.matches ? 'dark' : 'light'
})

export function useTheme() {
  const isDark = computed(() => theme.value === 'dark')

  function toggle() {
    const next: ThemeMode = theme.value === 'dark' ? 'light' : 'dark'
    if ((document as any).startViewTransition) {
      ;(document as any).startViewTransition(() => { theme.value = next })
    } else {
      theme.value = next
    }
  }

  return {
    theme,
    isDark,
    toggle,
  }
}
