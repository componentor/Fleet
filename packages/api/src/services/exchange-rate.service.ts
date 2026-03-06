import { db, platformSettings, eq } from '@fleet/db';
import { logger } from './logger.js';

const SETTINGS_KEY = 'billing:exchange_rates';
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours
const API_URL = 'https://open.er-api.com/v6/latest/USD';

export interface ExchangeRates {
  baseCurrency: string;
  rates: Record<string, number>;
  updatedAt: string;
}

// In-memory cache to avoid DB reads on every request
let memoryCache: ExchangeRates | null = null;

async function readFromDb(): Promise<ExchangeRates | null> {
  try {
    const row = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, SETTINGS_KEY),
    });
    if (!row?.value) return null;
    return row.value as ExchangeRates;
  } catch (err) {
    logger.error({ err }, 'Failed to read exchange rates from DB');
    return null;
  }
}

async function writeToDb(data: ExchangeRates): Promise<void> {
  const existing = await db.query.platformSettings.findFirst({
    where: eq(platformSettings.key, SETTINGS_KEY),
  });
  if (existing) {
    await db.update(platformSettings)
      .set({ value: data, updatedAt: new Date() })
      .where(eq(platformSettings.id, existing.id));
  } else {
    await db.insert(platformSettings).values({ key: SETTINGS_KEY, value: data });
  }
}

function isStale(data: ExchangeRates): boolean {
  const age = Date.now() - new Date(data.updatedAt).getTime();
  return age > STALE_MS;
}

async function fetchFromApi(): Promise<ExchangeRates> {
  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error(`Exchange rate API returned ${res.status}`);
  }
  const json = await res.json() as { result: string; rates: Record<string, number> };
  if (json.result !== 'success') {
    throw new Error('Exchange rate API returned non-success result');
  }
  return {
    baseCurrency: 'USD',
    rates: json.rates,
    updatedAt: new Date().toISOString(),
  };
}

export const exchangeRateService = {
  /** Get cached rates, auto-refreshing if stale (>24h) */
  async getRates(): Promise<ExchangeRates> {
    // Check memory cache first
    if (memoryCache && !isStale(memoryCache)) {
      return memoryCache;
    }

    // Check DB
    const dbData = await readFromDb();
    if (dbData && !isStale(dbData)) {
      memoryCache = dbData;
      return dbData;
    }

    // Fetch fresh rates
    try {
      const fresh = await fetchFromApi();
      await writeToDb(fresh);
      memoryCache = fresh;
      return fresh;
    } catch (err) {
      logger.error({ err }, 'Failed to fetch exchange rates');
      // Fall back to stale data if available
      if (dbData) {
        memoryCache = dbData;
        return dbData;
      }
      if (memoryCache) return memoryCache;
      // Ultimate fallback: 1:1 rates
      return { baseCurrency: 'USD', rates: { USD: 1 }, updatedAt: new Date().toISOString() };
    }
  },

  /** Force-fetch fresh rates from API */
  async refreshRates(): Promise<ExchangeRates> {
    const fresh = await fetchFromApi();
    await writeToDb(fresh);
    memoryCache = fresh;
    return fresh;
  },

  /** Convert an amount from one currency to another */
  async convert(amount: number, from: string, to: string): Promise<number> {
    if (from === to) return amount;
    const { rates } = await this.getRates();

    const fromRate = rates[from.toUpperCase()];
    const toRate = rates[to.toUpperCase()];

    if (!fromRate || !toRate) {
      logger.warn({ from, to }, 'Missing exchange rate, returning original amount');
      return amount;
    }

    // Convert: amount in "from" → USD → "to"
    const usdAmount = amount / fromRate;
    const converted = usdAmount * toRate;

    // Round to 2 decimal places
    return Math.round(converted * 100) / 100;
  },

  /** Convert cents between currencies, returns rounded cents */
  async convertCents(cents: number, from: string, to: string): Promise<number> {
    if (from === to) return cents;
    const amount = cents / 100;
    const converted = await this.convert(amount, from, to);
    return Math.round(converted * 100);
  },

  /** Manually set rates (admin override) */
  async setRates(rates: Record<string, number>): Promise<ExchangeRates> {
    const data: ExchangeRates = {
      baseCurrency: 'USD',
      rates,
      updatedAt: new Date().toISOString(),
    };
    await writeToDb(data);
    memoryCache = data;
    return data;
  },
};
