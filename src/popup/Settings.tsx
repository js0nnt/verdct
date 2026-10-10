import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

import { clearRatingCache, readCacheStats } from '../background/cache';
import { writeSettings } from '../shared/settings';
import type { CacheStats, ThemePreference, VerdctSettings } from '../shared/types';
import { SectionLabel } from './SectionLabel';
import { Segmented } from './Segmented';
import { ToneBadge } from './ToneBadge';

const THEME_CHOICES: Array<{ id: ThemePreference; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'auto', label: 'Auto' },
];

function formatAge(fetchedAt: number | null): string {
  if (fetchedAt === null) return 'Nothing cached yet';
  const days = Math.floor((Date.now() - fetchedAt) / (24 * 60 * 60 * 1_000));
  if (days <= 0) return 'All fetched today';
  return `Oldest is ${days} day${days === 1 ? '' : 's'} old`;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

const TTL_CHOICES: Array<{ id: string; label: string; value: number }> = [1, 3, 7, 14, 30].map(
  (days) => ({ id: String(days * DAY_MS), label: `${days}d`, value: days * DAY_MS }),
);

interface ThresholdRowProps {
  label: string;
  tone: 'good' | 'fair';
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function ThresholdRow({ label, tone, value, min, max, onChange }: ThresholdRowProps) {
  // Every slider spans the whole 0–5 scale, so a thumb sits where its value
  // falls on that scale. The bound set by the other slider is enforced by
  // clamping instead of by narrowing this slider's range, which would slide
  // the thumb around under the pointer as the other value moved.
  const style = { '--v-range-at': value / 5 } as CSSProperties;

  return (
    <div className="py-2">
      <div className="flex items-center justify-between text-[12px]">
        <label htmlFor={`verdct-${tone}`}>{label}</label>
        <ToneBadge tone={tone} value={value} />
      </div>
      <input
        id={`verdct-${tone}`}
        type="range"
        min={0}
        max={5}
        step={0.1}
        value={value}
        onChange={(event) =>
          onChange(Math.min(max, Math.max(min, Number(event.target.value))))
        }
        data-tone={tone}
        className="v-range mt-1.5 w-full"
        style={style}
      />
    </div>
  );
}

function Group({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <div className="v-rise mt-6 first:mt-0" style={{ ['--i' as string]: index }}>
      <SectionLabel>{title}</SectionLabel>
      <div className="mt-2.5">{children}</div>
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

  // A stored value from before these choices existed still shows, rather than
  // leaving no option selected.
  const ttlChoices = TTL_CHOICES.some((choice) => choice.value === settings.cacheTtlMs)
    ? TTL_CHOICES
    : [
        ...TTL_CHOICES,
        {
          id: String(settings.cacheTtlMs),
          label: `${Math.round(settings.cacheTtlMs / DAY_MS)}d`,
          value: settings.cacheTtlMs,
        },
      ];

  return (
    <section>
      <Group index={0} title="Appearance">
        <Segmented
          label="Theme"
          options={THEME_CHOICES}
          value={settings.theme}
          onChange={(theme) => update({ theme })}
          fill
        />
        <p className="mt-2 text-[11px] leading-4 text-ink-faint dark:text-inkdark-faint">
          Auto follows your system. Badges on Class Search always stay light, since ASU's page is.
        </p>
      </Group>

      <Group index={1} title="Badge colors">
        {/* Each slider is bounded by the other, so the amber band can never invert. */}
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
        <p className="mt-1 text-[11px] leading-4 text-ink-faint dark:text-inkdark-faint">
          Below {settings.fairRatingThreshold.toFixed(1)} shows red. Open Class Search tabs restyle
          immediately.
        </p>
      </Group>

      <Group index={2} title="Keep ratings for">
        <Segmented
          label="Keep ratings for"
          options={ttlChoices}
          value={String(settings.cacheTtlMs)}
          onChange={(id) => update({ cacheTtlMs: Number(id) })}
          fill
        />
        <p className="mt-2 text-[11px] leading-4 text-ink-faint dark:text-inkdark-faint">
          Longer means fewer requests to RateMyProfessor. Unmatched names are always retried after a
          day.
        </p>
      </Group>

      <Group index={3} title="Cache">
        <div className="flex items-center justify-between rounded-2xl bg-surface-sunken px-4 py-3 dark:bg-surface-darksunken">
          <div>
            <p className="text-[22px] font-semibold leading-none tracking-tight tabular-nums">
              {stats ? stats.entryCount : '—'}
            </p>
            <p className="mt-1 text-[10.5px] text-ink-faint dark:text-inkdark-faint">
              {stats ? `professors · ${formatAge(stats.oldestFetchedAt)}` : 'Reading cache…'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={clearing || stats?.entryCount === 0}
            className="h-8 rounded-full bg-surface px-3 text-[11px] font-semibold text-ink-muted shadow-[0_0_0_1px_rgba(0,0,0,0.08)] transition-[color,transform,opacity] duration-200 hover:text-ink active:scale-95 disabled:opacity-40 dark:bg-[#3a3a3a] dark:text-inkdark-muted dark:shadow-none dark:hover:text-inkdark"
          >
            {clearing ? 'Clearing…' : 'Clear'}
          </button>
        </div>
      </Group>
    </section>
  );
}
