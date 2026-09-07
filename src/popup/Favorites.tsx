import { useCallback, useEffect, useState } from 'react';

import { readCachedRating } from '../background/cache';
import { readFavorites, removeFavorite } from '../shared/favorites';
import type { FavoriteProfessor, ProfessorRating } from '../shared/types';

interface FavoriteRow extends FavoriteProfessor {
  /** null when the rating has aged out of the cache since it was favorited. */
  rating: ProfessorRating | null;
}

const TONE_CLASS = {
  good: 'bg-[#bbf7d0] border-[#4ade80] text-[#14532d]',
  fair: 'bg-[#fde68a] border-[#f59e0b] text-[#713f12]',
  poor: 'bg-[#fecaca] border-[#f87171] text-[#7f1d1d]',
} as const;

function toneFor(rating: ProfessorRating | null): keyof typeof TONE_CLASS | null {
  if (!rating || rating.overallRating === null || rating.numRatings === 0) return null;
  if (rating.overallRating >= 4) return 'good';
  if (rating.overallRating >= 2.5) return 'fair';
  return 'poor';
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
    return <p className="mt-3 text-xs text-slate-500">Loading favorites…</p>;
  }

  return (
    <section className="mt-4 border-t border-slate-800 pt-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        Favorites
      </h2>

      {rows.length === 0 ? (
        <p className="mt-2 text-[11px] leading-4 text-slate-500">
          Hover a badge on Class Search and choose <span className="text-slate-300">Save to
          favorites</span> to shortlist a professor here.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map((row) => {
            const tone = toneFor(row.rating);
            return (
              <li key={row.normalizedName} className="flex items-center gap-2 text-sm">
                <span
                  className={`inline-flex min-w-[30px] shrink-0 justify-center rounded-md border px-1.5 text-[11px] font-bold tabular-nums ${
                    tone
                      ? TONE_CLASS[tone]
                      : 'border-dashed border-zinc-600 bg-transparent text-zinc-500'
                  }`}
                >
                  {row.rating?.overallRating?.toFixed(1) ?? '—'}
                </span>
                <span className="truncate text-slate-200">{row.displayName}</span>
                <button
                  type="button"
                  onClick={() => void handleRemove(row.normalizedName)}
                  aria-label={`Remove ${row.displayName} from favorites`}
                  className="ml-auto shrink-0 rounded px-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
