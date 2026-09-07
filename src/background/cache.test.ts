import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CACHE_ENTRY_LIMIT, CACHE_STORAGE_KEY } from '../shared/constants';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { StorageAreaLike } from '../shared/storage';
import type { ProfessorRating } from '../shared/types';
import {
  clearRatingCache,
  isExpired,
  pruneStore,
  readCacheStats,
  readCachedRating,
  writeCachedRating,
} from './cache';

function fakeArea(initial: Record<string, unknown> = {}): StorageAreaLike & {
  data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    get: async (keys) => {
      const list = keys === null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    set: async (items) => {
      Object.assign(data, items);
    },
  };
}

function rating(overrides: Partial<ProfessorRating> = {}): ProfessorRating {
  return {
    normalizedName: 'ada lovelace',
    displayName: 'Ada Lovelace',
    overallRating: 4.5,
    difficulty: 2.1,
    wouldTakeAgainPct: 92,
    numRatings: 31,
    fetchedAt: 1_000,
    matchConfidence: 'high',
    ...overrides,
  };
}

const DAY_MS = 24 * 60 * 60 * 1_000;

describe('rating cache', () => {
  let area: ReturnType<typeof fakeArea>;

  beforeEach(() => {
    area = fakeArea();
  });

  it('round-trips a rating within the TTL', async () => {
    await writeCachedRating(rating(), { area, now: () => 1_000 });

    expect(await readCachedRating('ada lovelace', { area, now: () => 1_000 + DAY_MS })).toEqual(
      rating(),
    );
  });

  it('returns null once the entry passes its TTL', async () => {
    await writeCachedRating(rating(), { area, now: () => 1_000 });

    const now = 1_000 + DEFAULT_SETTINGS.cacheTtlMs;
    expect(await readCachedRating('ada lovelace', { area, now: () => now })).toBeNull();
  });

  it('expires no-match entries on the shorter no-match TTL', () => {
    const entry = {
      rating: rating({ matchConfidence: 'none', overallRating: null }),
      lastAccessedAt: 1_000,
    };
    const justBefore = 1_000 + DEFAULT_SETTINGS.noMatchTtlMs - 1;

    expect(isExpired(entry, DEFAULT_SETTINGS, justBefore)).toBe(false);
    expect(isExpired(entry, DEFAULT_SETTINGS, justBefore + 1)).toBe(true);
    // The same age is still fresh for a real match.
    expect(
      isExpired({ ...entry, rating: rating() }, DEFAULT_SETTINGS, justBefore + 1),
    ).toBe(false);
  });

  it('treats a future fetchedAt as stale rather than caching it forever', () => {
    const entry = { rating: rating({ fetchedAt: 5_000 }), lastAccessedAt: 5_000 };

    expect(isExpired(entry, DEFAULT_SETTINGS, 1_000)).toBe(true);
  });

  it('evicts least-recently-used entries beyond the cap', () => {
    const store = Object.fromEntries(
      Array.from({ length: CACHE_ENTRY_LIMIT + 10 }, (_, index) => [
        `prof ${index}`,
        {
          rating: rating({ normalizedName: `prof ${index}`, fetchedAt: 1_000 }),
          lastAccessedAt: index,
        },
      ]),
    );

    const pruned = pruneStore(store, DEFAULT_SETTINGS, 1_000);

    expect(Object.keys(pruned)).toHaveLength(CACHE_ENTRY_LIMIT);
    // The ten oldest reads are gone; the most recent survives.
    expect(pruned['prof 0']).toBeUndefined();
    expect(pruned['prof 9']).toBeUndefined();
    expect(pruned['prof 10']).toBeDefined();
    expect(pruned[`prof ${CACHE_ENTRY_LIMIT + 9}`]).toBeDefined();
  });

  it('drops expired entries during pruning', () => {
    const store = {
      fresh: { rating: rating({ normalizedName: 'fresh', fetchedAt: 1_000 }), lastAccessedAt: 1_000 },
      stale: { rating: rating({ normalizedName: 'stale', fetchedAt: 0 }), lastAccessedAt: 0 },
    };

    const pruned = pruneStore(store, DEFAULT_SETTINGS, DEFAULT_SETTINGS.cacheTtlMs + 500);

    expect(Object.keys(pruned)).toEqual(['fresh']);
  });

  it('ignores corrupt stored entries instead of throwing', async () => {
    area = fakeArea({
      [CACHE_STORAGE_KEY]: {
        broken: { rating: { normalizedName: 42 } },
        alsoBroken: 'not an entry',
      },
    });

    expect(await readCachedRating('broken', { area, now: () => 1_000 })).toBeNull();
    expect(await readCacheStats({ area, now: () => 1_000 })).toEqual({
      entryCount: 0,
      oldestFetchedAt: null,
    });
  });

  it('survives a storage read failure by reporting a cache miss', async () => {
    const failing: StorageAreaLike = {
      get: async () => {
        throw new Error('storage unavailable');
      },
      set: async () => undefined,
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await readCachedRating('ada lovelace', { area: failing, now: () => 1_000 })).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('serializes concurrent writes without losing entries', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        writeCachedRating(rating({ normalizedName: `prof ${index}` }), { area, now: () => 1_000 }),
      ),
    );

    expect(await readCacheStats({ area, now: () => 1_000 })).toEqual({
      entryCount: 25,
      oldestFetchedAt: 1_000,
    });
  });

  it('clears every cached entry', async () => {
    await writeCachedRating(rating(), { area, now: () => 1_000 });
    await clearRatingCache({ area });

    expect(await readCachedRating('ada lovelace', { area, now: () => 1_000 })).toBeNull();
  });
});
