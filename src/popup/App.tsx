import { useEffect, useState } from 'react';

import { readCacheStats } from '../background/cache';
import type { CacheStats } from '../shared/types';

function formatAge(fetchedAt: number | null): string {
  if (fetchedAt === null) return 'nothing cached yet';
  const days = Math.floor((Date.now() - fetchedAt) / (24 * 60 * 60 * 1_000));
  if (days <= 0) return 'all cached today';
  return `oldest entry ${days} day${days === 1 ? '' : 's'} old`;
}

export function App() {
  const [stats, setStats] = useState<CacheStats | null>(null);

  useEffect(() => {
    void readCacheStats().then(setStats);
  }, []);

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
        <dd className="font-semibold">{stats ? stats.entryCount : '—'}</dd>
      </dl>
      <p className="mt-1 text-xs text-slate-500">
        {stats ? formatAge(stats.oldestFetchedAt) : 'Reading cache…'}
      </p>

      <ul className="mt-4 space-y-1 text-xs text-slate-400">
        <li>
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green-400" />
          4.0 and above
        </li>
        <li>
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-500" />
          2.5 to 3.9
        </li>
        <li>
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-400" />
          Below 2.5
        </li>
        <li>
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-zinc-300" />
          No rating found
        </li>
      </ul>
    </main>
  );
}
