import { CACHE_ENTRY_LIMIT, CACHE_STORAGE_KEY } from '../shared/constants';
import { readSettings } from '../shared/settings';
import { createWriteQueue, defaultStorageArea, type StorageAreaLike } from '../shared/storage';
import type {
  CacheEntry,
  CacheStats,
  CacheStore,
  ProfessorRating,
  RatingTrend,
  VerdctSettings,
} from '../shared/types';

interface CacheOptions {
  area?: StorageAreaLike;
  now?: () => number;
  settings?: VerdctSettings;
}

/**
 * Reading an entry refreshes its LRU timestamp, but only once an hour so a page
 * full of repeated professors does not trigger a storage write per badge.
 */
const LRU_TOUCH_INTERVAL_MS = 60 * 60 * 1_000;

const enqueueWrite = createWriteQueue();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Stored entries are validated on read so a corrupt or outdated record can never crash a lookup. */
function parseEntry(value: unknown): CacheEntry | null {
  if (!isRecord(value) || !isRecord(value.rating)) return null;
  const rating = value.rating;
  const confidence = rating.matchConfidence;

  if (
    typeof rating.normalizedName !== 'string' ||
    typeof rating.displayName !== 'string' ||
    typeof rating.fetchedAt !== 'number' ||
    !Number.isFinite(rating.fetchedAt) ||
    typeof rating.numRatings !== 'number' ||
    (confidence !== 'high' && confidence !== 'low' && confidence !== 'none')
  ) {
    return null;
  }

  const optionalNumber = (input: unknown): number | null =>
    typeof input === 'number' && Number.isFinite(input) ? input : null;

  // Entries cached before trends existed simply have no trend, rather than
  // being discarded and refetched.
  const trend: RatingTrend | null =
    rating.trend === 'rising' || rating.trend === 'falling' || rating.trend === 'steady'
      ? rating.trend
      : null;

  return {
    rating: {
      normalizedName: rating.normalizedName,
      displayName: rating.displayName,
      overallRating: optionalNumber(rating.overallRating),
      difficulty: optionalNumber(rating.difficulty),
      wouldTakeAgainPct: optionalNumber(rating.wouldTakeAgainPct),
      numRatings: rating.numRatings,
      fetchedAt: rating.fetchedAt,
      matchConfidence: confidence,
      trend,
      // Entries cached before links existed simply have no id, rather than
      // being discarded and refetched.
      legacyId: optionalNumber(rating.legacyId),
    },
    lastAccessedAt:
      typeof value.lastAccessedAt === 'number' && Number.isFinite(value.lastAccessedAt)
        ? value.lastAccessedAt
        : rating.fetchedAt,
  };
}

function parseStore(value: unknown): CacheStore {
  if (!isRecord(value)) return {};
  const store: CacheStore = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = parseEntry(entry);
    if (parsed) store[key] = parsed;
  }
  return store;
}

async function loadStore(area: StorageAreaLike): Promise<CacheStore> {
  try {
    const stored = await area.get(CACHE_STORAGE_KEY);
    return parseStore(stored[CACHE_STORAGE_KEY]);
  } catch (error) {
    console.warn('[Verdct] Rating cache read failed; treating cache as empty', error);
    return {};
  }
}

export function entryTtlMs(entry: CacheEntry, settings: VerdctSettings): number {
  return entry.rating.matchConfidence === 'none' ? settings.noMatchTtlMs : settings.cacheTtlMs;
}

export function isExpired(entry: CacheEntry, settings: VerdctSettings, now: number): boolean {
  const age = now - entry.rating.fetchedAt;
  // A clock change can push fetchedAt into the future; treat that as stale too.
  return age < 0 || age >= entryTtlMs(entry, settings);
}

/** Drops expired entries, then evicts least-recently-used entries above the cap. */
export function pruneStore(store: CacheStore, settings: VerdctSettings, now: number): CacheStore {
  const live = Object.entries(store).filter(([, entry]) => !isExpired(entry, settings, now));

  if (live.length <= CACHE_ENTRY_LIMIT) {
    return Object.fromEntries(live);
  }

  return Object.fromEntries(
    live
      .sort(([, left], [, right]) => right.lastAccessedAt - left.lastAccessedAt)
      .slice(0, CACHE_ENTRY_LIMIT),
  );
}

export async function readCachedRating(
  normalizedName: string,
  options: CacheOptions = {},
): Promise<ProfessorRating | null> {
  const area = options.area ?? defaultStorageArea();
  const now = (options.now ?? Date.now)();
  const settings = options.settings ?? (await readSettings(area));

  const store = await loadStore(area);
  const entry = store[normalizedName];
  if (!entry || isExpired(entry, settings, now)) return null;

  if (now - entry.lastAccessedAt >= LRU_TOUCH_INTERVAL_MS) {
    void enqueueWrite(async () => {
      const current = await loadStore(area);
      const currentEntry = current[normalizedName];
      if (!currentEntry) return;
      current[normalizedName] = { ...currentEntry, lastAccessedAt: now };
      await area.set({ [CACHE_STORAGE_KEY]: current });
    }).catch((error: unknown) => {
      console.warn('[Verdct] Rating cache LRU touch failed', error);
    });
  }

  return entry.rating;
}

export async function writeCachedRating(
  rating: ProfessorRating,
  options: CacheOptions = {},
): Promise<void> {
  const area = options.area ?? defaultStorageArea();
  const now = (options.now ?? Date.now)();
  const settings = options.settings ?? (await readSettings(area));

  await enqueueWrite(async () => {
    const store = await loadStore(area);
    store[rating.normalizedName] = { rating, lastAccessedAt: now };
    await area.set({ [CACHE_STORAGE_KEY]: pruneStore(store, settings, now) });
  }).catch((error: unknown) => {
    // A cache write failure must never fail the lookup the user is waiting on.
    console.warn('[Verdct] Rating cache write failed', error);
  });
}

export async function clearRatingCache(options: CacheOptions = {}): Promise<void> {
  const area = options.area ?? defaultStorageArea();
  await enqueueWrite(() => area.set({ [CACHE_STORAGE_KEY]: {} }));
}

export async function readCacheStats(options: CacheOptions = {}): Promise<CacheStats> {
  const area = options.area ?? defaultStorageArea();
  const now = (options.now ?? Date.now)();
  const settings = options.settings ?? (await readSettings(area));

  const entries = Object.values(pruneStore(await loadStore(area), settings, now));
  return {
    entryCount: entries.length,
    oldestFetchedAt: entries.length
      ? entries.reduce((oldest, entry) => Math.min(oldest, entry.rating.fetchedAt), Infinity)
      : null,
  };
}
