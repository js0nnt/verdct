import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_FAIR_RATING_THRESHOLD,
  DEFAULT_GOOD_RATING_THRESHOLD,
  DEFAULT_NO_MATCH_TTL_MS,
  SETTINGS_STORAGE_KEY,
} from './constants';
import { defaultStorageArea, type StorageAreaLike } from './storage';
import type { VerdctSettings } from './types';

export const DEFAULT_SETTINGS: VerdctSettings = {
  cacheTtlMs: DEFAULT_CACHE_TTL_MS,
  noMatchTtlMs: DEFAULT_NO_MATCH_TTL_MS,
  goodRatingThreshold: DEFAULT_GOOD_RATING_THRESHOLD,
  fairRatingThreshold: DEFAULT_FAIR_RATING_THRESHOLD,
};

const ONE_HOUR_MS = 60 * 60 * 1_000;
const ONE_YEAR_MS = 365 * 24 * ONE_HOUR_MS;

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

/**
 * Stored settings are user-editable and survive extension upgrades, so every
 * field is validated rather than trusted.
 */
export function coerceSettings(value: unknown): VerdctSettings {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };
  const raw = value as Record<string, unknown>;

  const good = boundedNumber(raw.goodRatingThreshold, DEFAULT_SETTINGS.goodRatingThreshold, 0, 5);
  const fair = boundedNumber(raw.fairRatingThreshold, DEFAULT_SETTINGS.fairRatingThreshold, 0, 5);

  return {
    cacheTtlMs: boundedNumber(raw.cacheTtlMs, DEFAULT_SETTINGS.cacheTtlMs, ONE_HOUR_MS, ONE_YEAR_MS),
    noMatchTtlMs: boundedNumber(
      raw.noMatchTtlMs,
      DEFAULT_SETTINGS.noMatchTtlMs,
      ONE_HOUR_MS,
      ONE_YEAR_MS,
    ),
    goodRatingThreshold: good,
    // A fair threshold above the good threshold would leave the yellow band
    // inverted, so fall back to the default ordering instead.
    fairRatingThreshold: fair <= good ? fair : DEFAULT_SETTINGS.fairRatingThreshold,
  };
}

export async function readSettings(
  area: StorageAreaLike = defaultStorageArea(),
): Promise<VerdctSettings> {
  try {
    const stored = await area.get(SETTINGS_STORAGE_KEY);
    return coerceSettings(stored[SETTINGS_STORAGE_KEY]);
  } catch (error) {
    console.warn('[Verdct] Falling back to default settings', error);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(
  patch: Partial<VerdctSettings>,
  area: StorageAreaLike = defaultStorageArea(),
): Promise<VerdctSettings> {
  const next = coerceSettings({ ...(await readSettings(area)), ...patch });
  await area.set({ [SETTINGS_STORAGE_KEY]: next });
  return next;
}
