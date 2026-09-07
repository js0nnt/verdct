import type { RatingTrend } from '../shared/types';

export interface RatingSample {
  /** Epoch ms the review was posted. */
  postedAt: number;
  /** Review quality on RMP's 1–5 scale. */
  quality: number;
}

/**
 * Below this many usable reviews, a split-half comparison is noise. Twelve
 * gives six per side, which is still thin — hence the wide neutral band below.
 */
export const MIN_TREND_SAMPLES = 12;

/** Reviews older than this tell you about a different course, not a trend. */
export const MAX_TREND_SAMPLES = 20;

/**
 * How far the halves must diverge before this is called a direction. Individual
 * reviews are 1–5 integers, so half-point swings happen by chance constantly;
 * anything narrower than this would report noise as a trend.
 */
export const TREND_DELTA_THRESHOLD = 0.5;

/**
 * RMP returns dates like "2026-05-25 03:24:40 +0000 UTC", which `Date` will not
 * parse. Returns null rather than an Invalid Date so callers can drop the sample.
 */
export function parseRmpDate(value: unknown): number | null {
  if (typeof value !== 'string') return null;

  const normalized = value.replace(' +0000 UTC', 'Z').replace(' ', 'T');
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function ratingScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5
    ? value
    : null;
}

/**
 * RMP's headline rating is the mean of a review's clarity and helpfulness, so
 * the trend is computed on the same quantity the badge shows.
 */
export function parseRatingSamples(payload: unknown): RatingSample[] {
  if (!isRecord(payload)) return [];
  const node = isRecord(payload.data) ? payload.data.node : null;
  if (!isRecord(node) || !isRecord(node.ratings) || !Array.isArray(node.ratings.edges)) return [];

  const samples: RatingSample[] = [];
  for (const edge of node.ratings.edges) {
    if (!isRecord(edge) || !isRecord(edge.node)) continue;
    const clarity = ratingScore(edge.node.clarityRating);
    const helpful = ratingScore(edge.node.helpfulRating);
    const postedAt = parseRmpDate(edge.node.date);
    if (clarity === null || helpful === null || postedAt === null) continue;

    samples.push({ postedAt, quality: (clarity + helpful) / 2 });
  }

  return samples;
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Compares the recent half of a professor's reviews against the older half.
 * Returns null when there is too little data to say anything at all, which the
 * UI renders as no arrow rather than as "steady".
 */
export function computeTrend(samples: RatingSample[]): RatingTrend | null {
  if (samples.length < MIN_TREND_SAMPLES) return null;

  // Sorted explicitly rather than trusting RMP's ordering: if their default
  // order ever flipped, an inherited order would silently invert every arrow.
  const ordered = [...samples]
    .sort((left, right) => right.postedAt - left.postedAt)
    .slice(0, MAX_TREND_SAMPLES);

  const midpoint = Math.floor(ordered.length / 2);
  const recent = ordered.slice(0, midpoint).map((sample) => sample.quality);
  const older = ordered.slice(ordered.length - midpoint).map((sample) => sample.quality);
  const delta = mean(recent) - mean(older);

  if (delta >= TREND_DELTA_THRESHOLD) return 'rising';
  if (delta <= -TREND_DELTA_THRESHOLD) return 'falling';
  return 'steady';
}
