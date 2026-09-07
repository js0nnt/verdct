import { describe, expect, it, vi } from 'vitest';

import { FAVORITES_LIMIT, FAVORITES_STORAGE_KEY } from './constants';
import { parseFavorites, readFavorites, removeFavorite, toggleFavorite } from './favorites';
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

const ada = { normalizedName: 'ada lovelace', displayName: 'Ada Lovelace' };
const grace = { normalizedName: 'grace hopper', displayName: 'Grace Hopper' };

describe('parseFavorites', () => {
  it.each([
    ['null', null],
    ['an object', {}],
    ['a string', 'nope'],
  ])('returns nothing for %s', (_label, value) => {
    expect(parseFavorites(value)).toEqual([]);
  });

  it('drops malformed entries but keeps the valid ones', () => {
    const parsed = parseFavorites([
      { ...ada, addedAt: 5 },
      { normalizedName: '', displayName: 'Blank', addedAt: 5 },
      { normalizedName: 'x', displayName: 'No timestamp' },
      { normalizedName: 'y', displayName: 'Bad timestamp', addedAt: Number.NaN },
      'not an object',
    ]);

    expect(parsed).toEqual([{ ...ada, addedAt: 5 }]);
  });

  it('keeps only the first of a duplicated professor', () => {
    const parsed = parseFavorites([
      { ...ada, addedAt: 2 },
      { ...ada, addedAt: 1 },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].addedAt).toBe(2);
  });

  it('caps a stored list that has grown past the limit', () => {
    const oversized = Array.from({ length: FAVORITES_LIMIT + 25 }, (_, index) => ({
      normalizedName: `prof ${index}`,
      displayName: `Prof ${index}`,
      addedAt: index,
    }));

    expect(parseFavorites(oversized)).toHaveLength(FAVORITES_LIMIT);
  });
});

describe('toggleFavorite', () => {
  it('adds a professor and reports the new state', async () => {
    const area = fakeArea();

    expect(await toggleFavorite(ada, area, () => 100)).toBe(true);
    expect(await readFavorites(area)).toEqual([{ ...ada, addedAt: 100 }]);
  });

  it('removes on a second toggle', async () => {
    const area = fakeArea();
    await toggleFavorite(ada, area, () => 100);

    expect(await toggleFavorite(ada, area, () => 200)).toBe(false);
    expect(await readFavorites(area)).toEqual([]);
  });

  it('puts the newest favorite first', async () => {
    const area = fakeArea();
    await toggleFavorite(ada, area, () => 100);
    await toggleFavorite(grace, area, () => 200);

    expect((await readFavorites(area)).map((favorite) => favorite.displayName)).toEqual([
      'Grace Hopper',
      'Ada Lovelace',
    ]);
  });

  it('drops the oldest rather than refusing an add at the cap', async () => {
    const area = fakeArea({
      [FAVORITES_STORAGE_KEY]: Array.from({ length: FAVORITES_LIMIT }, (_, index) => ({
        normalizedName: `prof ${index}`,
        displayName: `Prof ${index}`,
        addedAt: FAVORITES_LIMIT - index,
      })),
    });

    await toggleFavorite(ada, area, () => 9_999);
    const favorites = await readFavorites(area);

    expect(favorites).toHaveLength(FAVORITES_LIMIT);
    expect(favorites[0].normalizedName).toBe('ada lovelace');
    expect(favorites.some((f) => f.normalizedName === `prof ${FAVORITES_LIMIT - 1}`)).toBe(false);
  });

  it('serializes concurrent toggles instead of losing writes', async () => {
    const area = fakeArea();

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        toggleFavorite(
          { normalizedName: `prof ${index}`, displayName: `Prof ${index}` },
          area,
          () => 100 + index,
        ),
      ),
    );

    expect(await readFavorites(area)).toHaveLength(12);
  });
});

describe('removeFavorite', () => {
  it('removes only the named professor', async () => {
    const area = fakeArea();
    await toggleFavorite(ada, area, () => 100);
    await toggleFavorite(grace, area, () => 200);

    await removeFavorite('ada lovelace', area);

    expect((await readFavorites(area)).map((f) => f.normalizedName)).toEqual(['grace hopper']);
  });

  it('is a no-op for someone who was never favorited', async () => {
    const area = fakeArea();
    await toggleFavorite(ada, area, () => 100);

    await removeFavorite('nobody', area);

    expect(await readFavorites(area)).toHaveLength(1);
  });
});

describe('readFavorites', () => {
  it('returns an empty list when storage throws', async () => {
    const failing: StorageAreaLike = {
      get: async () => {
        throw new Error('storage unavailable');
      },
      set: async () => undefined,
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await readFavorites(failing)).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
