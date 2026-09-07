import { useEffect, useState } from 'react';

import { clearRatingCache, readCacheStats } from '../background/cache';
import { writeSettings } from '../shared/settings';
import type { CacheStats, ThemePreference, VerdctSettings } from '../shared/types';
import { ToneBadge } from './ToneBadge';

const THEME_CHOICES: Array<{ id: ThemePreference; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'auto', label: 'Auto' },
];

function formatAge(fetchedAt: number | null): string {
  if (fetchedAt === null) return 'nothing cached yet';
  const days = Math.floor((Date.now() - fetchedAt) / (24 * 60 * 60 * 1_000));
  if (days <= 0) return 'all cached today';
  return `oldest entry ${days} day${days === 1 ? '' : 's'} old`;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

const TTL_CHOICES: Array<{ label: string; value: number }> = [
  { label: '1 day', value: DAY_MS },
  { label: '3 days', value: 3 * DAY_MS },
  { label: '7 days', value: 7 * DAY_MS },
  { label: '14 days', value: 14 * DAY_MS },
  { label: '30 days', value: 30 * DAY_MS },
];

interface ThresholdRowProps {
  label: string;
  tone: 'good' | 'fair';
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function ThresholdRow({ label, tone, value, min, max, onChange }: ThresholdRowProps) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-ink-muted dark:text-inkdark-muted">
        <label htmlFor={`verdct-${tone}`}>{label}</label>
        <ToneBadge tone={tone} value={value} />
      </div>
      <input
        id={`verdct-${tone}`}
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1.5 w-full accent-ink dark:accent-inkdark"
      />
    </div>
  );
}

interface SettingsProps {
  settings: VerdctSettings;
  onSettingsChange: (settings: VerdctSettings) => void;
}

export function Settings({ settings, onSettingsChange }: SettingsProps) {
  const [clearing, setClearing] = useState(false);
  const [stats, setStats] = useState<CacheStats | null>(null);

  useEffect(() => {
    void readCacheStats().then(setStats);
  }, []);

  /** Optimistic: the control tracks the pointer, storage catches up behind it. */
  function update(patch: Partial<VerdctSettings>): void {
    onSettingsChange({ ...settings, ...patch });
    void writeSettings(patch).then(onSettingsChange);
  }

  async function handleClear(): Promise<void> {
    setClearing(true);
    await clearRatingCache();
    setStats(await readCacheStats());
    setClearing(false);
  }

  return (
    <section>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint dark:text-inkdark-faint">
        Appearance
      </h2>
      <div
        role="group"
        aria-label="Theme"
        className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-line p-1 dark:border-line-dark"
      >
        {THEME_CHOICES.map((choice) => (
          <button
            key={choice.id}
            type="button"
            aria-pressed={settings.theme === choice.id}
            onClick={() => update({ theme: choice.id })}
            className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
              settings.theme === choice.id
                ? 'bg-surface-sunken text-ink dark:bg-surface-darksunken dark:text-inkdark'
                : 'text-ink-faint hover:text-ink-muted dark:text-inkdark-faint dark:hover:text-inkdark-muted'
            }`}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] leading-4 text-ink-faint dark:text-inkdark-faint">
        Auto follows your system. Badges on Class Search always stay light, since ASU's page is.
      </p>

      <h2 className="mt-5 border-t border-line pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint dark:border-line-dark dark:text-inkdark-faint">
        Ratings
      </h2>

      <div className="mt-3">
        <label htmlFor="verdct-ttl" className="text-xs text-ink-muted dark:text-inkdark-muted">
          Keep ratings for
        </label>
        <select
          id="verdct-ttl"
          value={settings.cacheTtlMs}
          onChange={(event) => update({ cacheTtlMs: Number(event.target.value) })}
          className="mt-1.5 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink dark:border-line-dark dark:bg-surface-darksunken dark:text-inkdark"
        >
          {TTL_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] leading-4 text-ink-faint dark:text-inkdark-faint">
          Longer means fewer requests to RateMyProfessor. Unmatched names are always retried after a
          day.
        </p>
      </div>

      {/* Each slider is bounded by the other, so the yellow band can never invert. */}
      <ThresholdRow
        label="Green at or above"
        tone="good"
        value={settings.goodRatingThreshold}
        min={Number((settings.fairRatingThreshold + 0.1).toFixed(1))}
        max={5}
        onChange={(goodRatingThreshold) => update({ goodRatingThreshold })}
      />
      <ThresholdRow
        label="Amber at or above"
        tone="fair"
        value={settings.fairRatingThreshold}
        min={0}
        max={Number((settings.goodRatingThreshold - 0.1).toFixed(1))}
        onChange={(fairRatingThreshold) => update({ fairRatingThreshold })}
      />
      <p className="mt-1.5 text-[11px] leading-4 text-ink-faint dark:text-inkdark-faint">
        Below {settings.fairRatingThreshold.toFixed(1)} shows red. Open Class Search tabs restyle
        immediately.
      </p>

      <dl className="mt-5 flex items-baseline justify-between border-t border-line pt-3 text-sm dark:border-line-dark">
        <dt className="text-ink-muted dark:text-inkdark-muted">Cached professors</dt>
        <dd className="font-semibold tabular-nums">{stats ? stats.entryCount : '—'}</dd>
      </dl>
      <p className="mt-1 text-[11px] text-ink-faint dark:text-inkdark-faint">
        {stats ? formatAge(stats.oldestFetchedAt) : 'Reading cache…'}
      </p>

      <button
        type="button"
        onClick={() => void handleClear()}
        disabled={clearing}
        className="mt-3 w-full rounded-md border border-line px-2 py-1.5 text-xs font-semibold text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-50 dark:border-line-dark dark:text-inkdark-muted dark:hover:border-line-darkstrong dark:hover:text-inkdark"
      >
        {clearing ? 'Clearing…' : 'Clear cached ratings'}
      </button>
    </section>
  );
}
