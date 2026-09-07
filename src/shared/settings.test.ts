import { describe, expect, it, vi } from 'vitest';

import { SETTINGS_STORAGE_KEY } from './constants';
import { DEFAULT_SETTINGS, coerceSettings, readSettings, writeSettings } from './settings';
import type { StorageAreaLike } from './storage';

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

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

describe('coerceSettings', () => {
  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an array', []],
    ['an empty object', {}],
  ])('falls back to defaults for %s', (_label, value) => {
    expect(coerceSettings(value)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps a fully valid record', () => {
    const valid = {
      cacheTtlMs: 3 * DAY_MS,
      noMatchTtlMs: 2 * DAY_MS,
      goodRatingThreshold: 4.2,
      fairRatingThreshold: 3,
    };

    expect(coerceSettings(valid)).toEqual(valid);
  });

  it.each([
    ['a TTL below one hour', { cacheTtlMs: 1_000 }],
    ['a TTL beyond a year', { cacheTtlMs: 400 * DAY_MS }],
    ['a non-numeric TTL', { cacheTtlMs: 'forever' }],
    ['NaN', { cacheTtlMs: Number.NaN }],
    ['Infinity', { cacheTtlMs: Number.POSITIVE_INFINITY }],
  ])('replaces %s with the default', (_label, patch) => {
    expect(coerceSettings(patch).cacheTtlMs).toBe(DEFAULT_SETTINGS.cacheTtlMs);
  });

  it.each([
    ['above 5', 7],
    ['below 0', -2],
  ])('replaces a threshold %s with the default', (_label, value) => {
    expect(coerceSettings({ goodRatingThreshold: value }).goodRatingThreshold).toBe(
      DEFAULT_SETTINGS.goodRatingThreshold,
    );
  });

  it('refuses an inverted band where yellow would outrank green', () => {
    const coerced = coerceSettings({ goodRatingThreshold: 2, fairRatingThreshold: 4 });

    // Keeping fair above good would leave the yellow band unreachable.
    expect(coerced.goodRatingThreshold).toBe(2);
    expect(coerced.fairRatingThreshold).toBe(DEFAULT_SETTINGS.fairRatingThreshold);
  });

  it('allows the two thresholds to meet at the same value', () => {
    const coerced = coerceSettings({ goodRatingThreshold: 3, fairRatingThreshold: 3 });

    expect(coerced.goodRatingThreshold).toBe(3);
    expect(coerced.fairRatingThreshold).toBe(3);
  });
});

describe('readSettings', () => {
  it('returns defaults when nothing has been stored', async () => {
    expect(await readSettings(fakeArea())).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when storage throws', async () => {
    const failing: StorageAreaLike = {
      get: async () => {
        throw new Error('storage unavailable');
      },
      set: async () => undefined,
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await readSettings(failing)).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('sanitizes a corrupt stored record instead of trusting it', async () => {
    const area = fakeArea({ [SETTINGS_STORAGE_KEY]: { cacheTtlMs: -5, goodRatingThreshold: 99 } });

    expect(await readSettings(area)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('writeSettings', () => {
  it('merges a patch over what is already stored', async () => {
    const area = fakeArea();
    await writeSettings({ cacheTtlMs: 3 * DAY_MS }, area);
    const result = await writeSettings({ goodRatingThreshold: 4.5 }, area);

    expect(result.cacheTtlMs).toBe(3 * DAY_MS);
    expect(result.goodRatingThreshold).toBe(4.5);
    expect(await readSettings(area)).toEqual(result);
  });

  it('rejects an out-of-range patch rather than persisting it', async () => {
    const area = fakeArea();

    const result = await writeSettings({ goodRatingThreshold: 42 }, area);

    expect(result.goodRatingThreshold).toBe(DEFAULT_SETTINGS.goodRatingThreshold);
  });
});
