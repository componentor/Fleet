import { createI18n } from 'vue-i18n'
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
