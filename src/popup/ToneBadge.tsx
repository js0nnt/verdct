/**
 * Mirrors the on-page badge exactly: a neutral pill whose only colour is a
 * small tone dot. Kept in one place so the popup preview and the real badge
 * cannot drift apart.
 */
const DOT_CLASS = {
  good: 'bg-tone-good dark:bg-tonedark-good',
  fair: 'bg-tone-fair dark:bg-tonedark-fair',
  poor: 'bg-tone-poor dark:bg-tonedark-poor',
} as const;

export type Tone = keyof typeof DOT_CLASS;

export function toneFor(
  rating: number | null,
  good = 4,
  fair = 2.5,
): Tone | null {
  if (rating === null) return null;
  if (rating >= good) return 'good';
  if (rating >= fair) return 'fair';
  return 'poor';
}

export function ToneBadge({ tone, value }: { tone: Tone | null; value: number | null }) {
  return (
    <span
      className={`inline-flex min-w-[34px] items-center justify-center gap-1.5 rounded-md border px-1.5 text-[11px] font-semibold tabular-nums ${
        tone
          ? 'border-line bg-surface text-ink dark:border-line-dark dark:bg-surface-dark dark:text-inkdark'
          : 'border-dashed border-line-strong bg-transparent text-ink-faint dark:border-line-darkstrong dark:text-inkdark-faint'
      }`}
    >
      {tone && <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${DOT_CLASS[tone]}`} />}
      {value === null ? '—' : value.toFixed(1)}
    </span>
  );
}
