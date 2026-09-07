import { useCallback, useEffect, useState } from 'react';

import { readCacheStats } from '../background/cache';
import type { CacheStats } from '../shared/types';
import { Favorites } from './Favorites';
import { Settings } from './Settings';

function formatAge(fetchedAt: number | null): string {
  if (fetchedAt === null) return 'nothing cached yet';
  const days = Math.floor((Date.now() - fetchedAt) / (24 * 60 * 60 * 1_000));
  if (days <= 0) return 'all cached today';
  return `oldest entry ${days} day${days === 1 ? '' : 's'} old`;
}

export function App() {
  const [stats, setStats] = useState<CacheStats | null>(null);

  const refreshStats = useCallback(() => {
    void readCacheStats().then(setStats);
  }, []);

  useEffect(refreshStats, [refreshStats]);

  return (
    <main className="w-80 bg-surface p-5 text-ink dark:bg-surface-dark dark:text-inkdark">
      <header className="flex items-center gap-2.5">
        <span className="verdct-mark h-5 w-5 rounded-md" aria-hidden="true" />
        <p className="text-[13px] font-semibold tracking-tight">Verdct</p>
      </header>

      <h1 className="mt-3 text-lg font-semibold leading-snug tracking-tight">
        See the verdict before you register.
      </h1>
      <p className="mt-2 text-[13px] leading-5 text-ink-muted dark:text-inkdark-muted">
        Open ASU Class Search and ratings appear next to each instructor. Hover a badge for
        difficulty, would-take-again, and rating count.
      </p>

      <dl className="mt-4 flex items-baseline justify-between border-t border-line pt-3 text-sm dark:border-line-dark">
        <dt className="text-ink-muted dark:text-inkdark-muted">Cached professors</dt>
        <dd className="font-semibold tabular-nums">{stats ? stats.entryCount : '—'}</dd>
      </dl>
      <p className="mt-1 text-xs text-ink-faint dark:text-inkdark-faint">
        {stats ? formatAge(stats.oldestFetchedAt) : 'Reading cache…'}
      </p>

      <Favorites />

      <Settings onCacheCleared={refreshStats} />
    </main>
  );
}
