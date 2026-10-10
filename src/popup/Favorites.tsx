import { useCallback, useEffect, useState } from 'react';

import { readCachedRating } from '../background/cache';
import { readFavorites, removeFavorite } from '../shared/favorites';
import type { FavoriteProfessor, ProfessorRating } from '../shared/types';
import { useLeaving } from './motion';
import { ProfessorName } from './ProfessorName';
import { RemoveButton } from './RemoveButton';
import { SectionLabel } from './SectionLabel';
import { ToneBadge, toneFor } from './ToneBadge';

interface FavoriteRow extends FavoriteProfessor {
  /** null when the rating has aged out of the cache since it was favorited. */
  rating: ProfessorRating | null;
}

export function Favorites() {
  const [rows, setRows] = useState<FavoriteRow[] | null>(null);
  const { leaving, leave } = useLeaving();

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

  function handleRemove(normalizedName: string): void {
    leave(normalizedName, async () => {
      await removeFavorite(normalizedName);
      load();
    });
  }

  if (rows === null) return null;

  return (
    <section className="mt-7">
      <div className="v-rise flex items-baseline justify-between" style={{ ['--i' as string]: 3 }}>
        <SectionLabel>Favorites</SectionLabel>
        {rows.length > 0 && (
          <span className="text-[10.5px] tabular-nums text-ink-faint dark:text-inkdark-faint">
            {rows.length}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p
          className="v-rise mt-2 text-[11px] leading-4 text-ink-faint dark:text-inkdark-faint"
          style={{ ['--i' as string]: 4 }}
        >
          Hover a badge on Class Search and choose{' '}
          <span className="text-ink-muted dark:text-inkdark-muted">Save to favorites</span> to
          shortlist a professor here.
        </p>
      ) : (
        <ul className="mt-1.5">
          {rows.map((row, position) => (
            <li
              key={row.normalizedName}
              data-leaving={leaving.has(row.normalizedName)}
              className="v-collapse v-rise -mx-2"
              style={{ ['--i' as string]: position + 4 }}
            >
              <div>
                <div className="group flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-200 hover:bg-surface-sunken dark:hover:bg-surface-darksunken">
                  <ToneBadge
                    tone={
                      row.rating && row.rating.numRatings > 0
                        ? toneFor(row.rating.overallRating)
                        : null
                    }
                    value={row.rating?.overallRating ?? null}
                  />
                  <span className="min-w-0 text-[12.5px] font-medium">
                    <ProfessorName name={row.displayName} legacyId={row.rating?.legacyId ?? null} />
                  </span>
                  <RemoveButton
                    label={`Remove ${row.displayName} from favorites`}
                    onClick={() => handleRemove(row.normalizedName)}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
