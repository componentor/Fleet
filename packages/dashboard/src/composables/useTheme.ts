import { useColorMode } from '@vueuse/core'
import { computed } from 'vue'

export type ThemeMode = 'system' | 'light' | 'dark'

export function useTheme() {
  const mode = useColorMode({
    attribute: 'class',
    modes: {
      light: 'light',
      dark: 'dark',
    },
    storageKey: 'fleet_theme',
    initialValue: 'system',
  })

  const theme = computed<ThemeMode>({
    get: () => (mode.store.value as ThemeMode) ?? 'system',
    set: (val: ThemeMode) => {
      mode.store.value = val
    },
  })

  const isDark = computed(() => mode.value === 'dark')

  function toggle() {
    const order: ThemeMode[] = ['system', 'light', 'dark']
    const current = order.indexOf(theme.value)
    theme.value = order[(current + 1) % order.length]!
  }

  return {
    theme,
    isDark,
    toggle,
  }
}
