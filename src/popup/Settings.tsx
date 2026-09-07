import { useEffect, useState } from 'react';

import { clearRatingCache } from '../background/cache';
import { DEFAULT_SETTINGS, readSettings, writeSettings } from '../shared/settings';
import type { VerdctSettings } from '../shared/types';

const DAY_MS = 24 * 60 * 60 * 1_000;

const TTL_CHOICES: Array<{ label: string; value: number }> = [
  { label: '1 day', value: DAY_MS },
  { label: '3 days', value: 3 * DAY_MS },
  { label: '7 days', value: 7 * DAY_MS },
  { label: '14 days', value: 14 * DAY_MS },
  { label: '30 days', value: 30 * DAY_MS },
];

/** Mirrors the on-page badge tones so the popup previews the real thresholds. */
const TONE_SWATCH = {
  good: 'bg-[#bbf7d0] border-[#4ade80] text-[#14532d]',
  fair: 'bg-[#fde68a] border-[#f59e0b] text-[#713f12]',
  poor: 'bg-[#fecaca] border-[#f87171] text-[#7f1d1d]',
} as const;

function Badge({ tone, value }: { tone: keyof typeof TONE_SWATCH; value: number }) {
  return (
    <span
      className={`inline-flex min-w-[30px] justify-center rounded-md border px-1.5 text-[11px] font-bold tabular-nums ${TONE_SWATCH[tone]}`}
    >
      {value.toFixed(1)}
    </span>
  );
}

interface ThresholdRowProps {
  label: string;
  tone: keyof typeof TONE_SWATCH;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function ThresholdRow({ label, tone, value, min, max, onChange }: ThresholdRowProps) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <label htmlFor={`verdct-${tone}`}>{label}</label>
        <Badge tone={tone} value={value} />
      </div>
      <input
        id={`verdct-${tone}`}
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1.5 w-full accent-emerald-400"
      />
    </div>
  );
}

export function Settings({ onCacheCleared }: { onCacheCleared: () => void }) {
  const [settings, setSettings] = useState<VerdctSettings>(DEFAULT_SETTINGS);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    void readSettings().then(setSettings);
  }, []);

  /** Optimistic: the slider tracks the pointer, storage catches up behind it. */
  function update(patch: Partial<VerdctSettings>): void {
    setSettings((current) => ({ ...current, ...patch }));
    void writeSettings(patch).then(setSettings);
  }

  async function handleClear(): Promise<void> {
    setClearing(true);
    await clearRatingCache();
    onCacheCleared();
    setClearing(false);
  }

  return (
    <section className="mt-4 border-t border-slate-800 pt-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Settings</h2>

      <div className="mt-3">
        <label htmlFor="verdct-ttl" className="text-xs text-slate-300">
          Keep ratings for
        </label>
        <select
          id="verdct-ttl"
          value={settings.cacheTtlMs}
          onChange={(event) => update({ cacheTtlMs: Number(event.target.value) })}
          className="mt-1.5 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
        >
          {TTL_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">
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
        label="Yellow at or above"
        tone="fair"
        value={settings.fairRatingThreshold}
        min={0}
        max={Number((settings.goodRatingThreshold - 0.1).toFixed(1))}
        onChange={(fairRatingThreshold) => update({ fairRatingThreshold })}
      />
      <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
        Below {settings.fairRatingThreshold.toFixed(1)} shows red. Open Class Search tabs restyle
        immediately.
      </p>

      <button
        type="button"
        onClick={() => void handleClear()}
        disabled={clearing}
        className="mt-4 w-full rounded-md border border-slate-700 px-2 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
      >
        {clearing ? 'Clearing…' : 'Clear cached ratings'}
      </button>
    </section>
  );
}
