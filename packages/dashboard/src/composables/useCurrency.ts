import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const STORAGE_KEY = 'fleet-currency'

const localeCurrencyMap: Record<string, string> = {
  en: 'USD',
  nb: 'NOK',
  de: 'EUR',
  zh: 'CNY',
}

// BCP 47 locale for Intl.NumberFormat
const localeBcp47Map: Record<string, string> = {
  en: 'en-US',
  nb: 'nb-NO',
  de: 'de-DE',
  zh: 'zh-CN',
}

// Module-level shared state (singleton across all component instances)
const allowedCurrencies = ref<string[]>(['USD', 'EUR', 'GBP', 'NOK', 'SEK', 'DKK', 'CHF', 'CNY', 'JPY', 'AUD', 'CAD'])
const selectedCurrency = ref<string>(localStorage.getItem(STORAGE_KEY) ?? 'USD')
const loaded = ref(false)

export function useCurrency() {
  const { locale } = useI18n()

  const bcp47 = computed(() => localeBcp47Map[locale.value] ?? 'en-US')

  async function fetchAllowed() {
    if (loaded.value) return
    try {
      const res = await fetch('/api/v1/billing/public/currencies')
      if (res.ok) {
        const data = await res.json()
        if (data.currencies?.length) {
          allowedCurrencies.value = data.currencies
        }
      }
    } catch { /* fallback to ['USD'] */ }
    loaded.value = true

    // Set initial selection: locale preference > localStorage > first allowed
    const localePref = localeCurrencyMap[locale.value]
    if (localePref && allowedCurrencies.value.includes(localePref)) {
      selectedCurrency.value = localePref
    } else {
      const stored = localStorage.getItem(STORAGE_KEY)
      selectedCurrency.value =
        stored && allowedCurrencies.value.includes(stored)
          ? stored
          : allowedCurrencies.value[0] ?? 'USD'
    }
  }

  // Persist selection to localStorage
  watch(selectedCurrency, (val) => {
    localStorage.setItem(STORAGE_KEY, val)
  })

  // When locale changes, auto-select the locale's preferred currency if allowed
  watch(locale, (loc) => {
    const pref = localeCurrencyMap[loc]
    if (pref && allowedCurrencies.value.includes(pref)) {
      selectedCurrency.value = pref
    }
  })

  function formatCurrency(amount: number, currency?: string): string {
    return new Intl.NumberFormat(bcp47.value, {
      style: 'currency',
      currency: currency ?? selectedCurrency.value,
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  function formatCents(cents: number, currency?: string): string {
    return formatCurrency(cents / 100, currency)
  }

  return {
    allowedCurrencies,
    selectedCurrency,
    loaded,
    bcp47,
    fetchAllowed,
    formatCurrency,
    formatCents,
  }
}
