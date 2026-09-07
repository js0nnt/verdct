import { FAVORITES_LIMIT, FAVORITES_STORAGE_KEY } from './constants';
import { createWriteQueue, defaultStorageArea, type StorageAreaLike } from './storage';
import type { FavoriteProfessor } from './types';

const enqueueWrite = createWriteQueue();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Favorites are user data that survives upgrades, so every entry is validated. */
export function parseFavorites(value: unknown): FavoriteProfessor[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const favorites: FavoriteProfessor[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { normalizedName, displayName, addedAt } = entry;
    if (
      typeof normalizedName !== 'string' ||
      !normalizedName ||
      typeof displayName !== 'string' ||
      typeof addedAt !== 'number' ||
      !Number.isFinite(addedAt) ||
      seen.has(normalizedName)
    ) {
      continue;
    }

    seen.add(normalizedName);
    favorites.push({ normalizedName, displayName, addedAt });
  }

  return favorites.slice(0, FAVORITES_LIMIT);
}

export async function readFavorites(
  area: StorageAreaLike = defaultStorageArea(),
): Promise<FavoriteProfessor[]> {
  try {
    const stored = await area.get(FAVORITES_STORAGE_KEY);
    return parseFavorites(stored[FAVORITES_STORAGE_KEY]);
  } catch (error) {
    console.warn('[Verdct] Could not read favorites', error);
    return [];
  }
}

/**
 * Adds or removes a professor and reports the resulting state, so a caller can
 * repaint without a second read.
 */
export function toggleFavorite(
  professor: Omit<FavoriteProfessor, 'addedAt'>,
  area: StorageAreaLike = defaultStorageArea(),
  now: () => number = Date.now,
): Promise<boolean> {
  return enqueueWrite(async () => {
    const current = await readFavorites(area);
    const without = current.filter(
      (favorite) => favorite.normalizedName !== professor.normalizedName,
    );
    const isAdding = without.length === current.length;

    // Newest first, and the cap drops the oldest rather than refusing the add.
    const next = isAdding
      ? [{ ...professor, addedAt: now() }, ...without].slice(0, FAVORITES_LIMIT)
      : without;

    await area.set({ [FAVORITES_STORAGE_KEY]: next });
    return isAdding;
  });
}

export function removeFavorite(
  normalizedName: string,
  area: StorageAreaLike = defaultStorageArea(),
): Promise<void> {
  return enqueueWrite(async () => {
    const remaining = (await readFavorites(area)).filter(
      (favorite) => favorite.normalizedName !== normalizedName,
    );
    await area.set({ [FAVORITES_STORAGE_KEY]: remaining });
  });
}
