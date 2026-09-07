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
    <main className="w-80 bg-slate-950 p-5 text-slate-100">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-400">Verdct</p>
      <h1 className="mt-2 text-xl font-semibold">See the verdict before you register.</h1>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        Open ASU Class Search and ratings appear next to each instructor. Hover a badge for
        difficulty, would-take-again, and rating count.
      </p>

      <dl className="mt-4 flex items-baseline justify-between border-t border-slate-800 pt-3 text-sm">
        <dt className="text-slate-400">Cached professors</dt>
        <dd className="font-semibold tabular-nums">{stats ? stats.entryCount : '—'}</dd>
      </dl>
      <p className="mt-1 text-xs text-slate-500">
        {stats ? formatAge(stats.oldestFetchedAt) : 'Reading cache…'}
      </p>

      <Favorites />

      <Settings onCacheCleared={refreshStats} />
    </main>
  );
}
