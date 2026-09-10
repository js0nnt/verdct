/**
 * In-memory chrome.* shim so the promotional shots can mount the real popup and
 * badge code as an ordinary page. Every pixel in the resulting screenshots is
 * the shipping UI — only the surrounding page and the seeded data are staged.
 */
import type { ScatterPoint } from '../src/shared/scatterGeometry';

export interface ShimSeed {
  courses: Record<string, ScatterPoint[]>;
  favorites: Array<{ normalizedName: string; displayName: string; addedAt: number }>;
  ratings: Record<string, unknown>;
  theme: 'light' | 'dark' | 'auto';
}

export function installChromeShim(seed: ShimSeed): void {
  const local: Record<string, unknown> = {
    'verdct:settings': {
      theme: seed.theme,
      cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
      noMatchTtlMs: 24 * 60 * 60 * 1000,
      goodRatingThreshold: 4,
      fairRatingThreshold: 2.5,
    },
    'verdct:favorites': seed.favorites,
    'verdct:ratings': seed.ratings,
  };

  const area = (store: Record<string, unknown>) => ({
    get: async (keys: string | string[] | null) => {
      const list = keys === null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
    },
    set: async (items: Record<string, unknown>) => void Object.assign(store, items),
    remove: async (key: string) => void delete store[key],
  });

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: area(local),
      session: area({}),
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
    tabs: { query: async () => [{ id: 1 }] },
    runtime: {
      lastError: undefined,
      sendMessage: (_message: unknown, callback?: (response: unknown) => void) => {
        callback?.({ ok: true, data: { courses: seed.courses, updatedAt: Date.now() } });
      },
    },
    action: {
      setBadgeText: async () => undefined,
      setBadgeBackgroundColor: async () => undefined,
      setTitle: async () => undefined,
    },
  };
}
