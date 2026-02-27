import { createI18n } from 'vue-i18n'
import { unflattenMessages } from '@/utils/i18n-helpers'
import en from './locales/en.json'
import nb from './locales/nb.json'
import de from './locales/de.json'
import zh from './locales/zh.json'

const savedLocale = typeof localStorage !== 'undefined'
  ? localStorage.getItem('fleet_locale') || 'en'
  : 'en'

export const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'en',
  messages: { en, nb, de, zh },
})

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      )
    } else {
      result[key] = source[key]
    }
  }
  return result
}

/**
 * Fetch translation overrides from the public API and merge into vue-i18n.
 * Called once on app startup before mount. Non-critical — app works fine without overrides.
 */
export async function loadI18nOverrides(): Promise<void> {
  try {
    const res = await fetch('/api/v1/i18n/overrides')
    if (!res.ok) return

    const data = (await res.json()) as {
      customLocales: { code: string; name: string }[]
      overrides: Record<string, Record<string, string>>
    }

    // Register custom locales (no static file — start empty)
    const g = i18n.global as any
    for (const locale of data.customLocales) {
      if (!g.availableLocales.includes(locale.code)) {
        g.setLocaleMessage(locale.code, {})
      }
    }

    // Merge overrides into each locale
    for (const [locale, flatOverrides] of Object.entries(data.overrides)) {
      if (Object.keys(flatOverrides).length === 0) continue
      const nested = unflattenMessages(flatOverrides)
      const existing = g.getLocaleMessage(locale) as Record<string, unknown>
      g.setLocaleMessage(locale, deepMerge(existing, nested as Record<string, unknown>))
    }

    // Store custom locale list for locale selector dropdowns
    if (data.customLocales.length > 0) {
      localStorage.setItem('fleet_custom_locales', JSON.stringify(data.customLocales))
    } else {
      localStorage.removeItem('fleet_custom_locales')
    }
  } catch {
    // Non-critical — app works fine with static translations
  }
}
