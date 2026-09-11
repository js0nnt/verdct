import { useCallback, useEffect, useState } from 'react';

import { readCachedRating } from '../background/cache';
import { readFavorites, removeFavorite } from '../shared/favorites';
import type { FavoriteProfessor, ProfessorRating } from '../shared/types';
import { ToneBadge, toneFor } from './ToneBadge';

interface FavoriteRow extends FavoriteProfessor {
  /** null when the rating has aged out of the cache since it was favorited. */
  rating: ProfessorRating | null;
}

export function Favorites() {
  const [rows, setRows] = useState<FavoriteRow[] | null>(null);

  const load = useCallback(() => {
    void readFavorites()
      .then((favorites) =>
        Promise.all(
          favorites.map(async (favorite) => ({
            ...favorite,
            rating: await readCachedRating(favorite.normalizedName),
          })),
        ),
      )
      .then(setRows);
  }, []);

  useEffect(load, [load]);

  async function handleRemove(normalizedName: string): Promise<void> {
    await removeFavorite(normalizedName);
    load();
  }

  if (rows === null) {
    return (
      <p className="mt-3 text-xs text-ink-faint dark:text-inkdark-faint">Loading favorites…</p>
    );
  }

  return (
    <section className="mt-5 border-t border-line pt-4 dark:border-line-dark">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint dark:text-inkdark-faint">
        Favorites
      </h2>

      {rows.length === 0 ? (
        <p className="mt-2 text-[11px] leading-4 text-ink-faint dark:text-inkdark-faint">
          Hover a badge on Class Search and choose{' '}
          <span className="text-ink-muted dark:text-inkdark-muted">Save to favorites</span> to
          shortlist a professor here.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map((row, position) => (
            <li
              key={row.normalizedName}
              style={{ animationDelay: `${Math.min(position, 8) * 30}ms` }}
              className="v-rise flex items-center gap-2 text-sm"
            >
              <ToneBadge
                tone={
                  row.rating && row.rating.numRatings > 0
                    ? toneFor(row.rating.overallRating)
                    : null
                }
                value={row.rating?.overallRating ?? null}
              />
              <span className="truncate">{row.displayName}</span>
              <button
                type="button"
                onClick={() => void handleRemove(row.normalizedName)}
                aria-label={`Remove ${row.displayName} from favorites`}
                className="ml-auto shrink-0 rounded px-1 text-xs text-ink-faint transition-colors duration-150 hover:bg-surface-sunken hover:text-ink dark:text-inkdark-faint dark:hover:bg-surface-darksunken dark:hover:text-inkdark"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
