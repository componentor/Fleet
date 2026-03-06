import { db, platformSettings, eq } from '@fleet/db';
import { logger } from './logger.js';

const SETTINGS_KEY = 'billing:allowed_currencies';
const DEFAULT_CURRENCIES = ['USD', 'EUR', 'GBP', 'NOK', 'SEK', 'DKK', 'CHF', 'CNY', 'JPY', 'AUD', 'CAD'];

let memoryCache: string[] | null = null;

export const currencyService = {
  async getAllowed(): Promise<string[]> {
    if (memoryCache) return memoryCache;

    try {
      const row = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, SETTINGS_KEY),
      });
      const currencies = (row?.value as string[]) ?? DEFAULT_CURRENCIES;
      memoryCache = currencies;
      return currencies;
    } catch (err) {
      logger.error({ err }, 'Failed to read allowed currencies');
      return DEFAULT_CURRENCIES;
    }
  },

  async setAllowed(currencies: string[]): Promise<string[]> {
    const cleaned = [...new Set(currencies.map(c => c.toUpperCase()))];
    if (cleaned.length === 0) throw new Error('At least one currency is required');
    if (cleaned.some(c => !/^[A-Z]{3}$/.test(c))) throw new Error('Invalid currency code');

    const existing = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, SETTINGS_KEY),
    });

    if (existing) {
      await db.update(platformSettings)
        .set({ value: cleaned, updatedAt: new Date() })
        .where(eq(platformSettings.id, existing.id));
    } else {
      await db.insert(platformSettings).values({ key: SETTINGS_KEY, value: cleaned });
    }

    memoryCache = cleaned;
    return cleaned;
  },

  async validateCurrency(currency: string): Promise<boolean> {
    const allowed = await this.getAllowed();
    return allowed.includes(currency.toUpperCase());
  },
};
