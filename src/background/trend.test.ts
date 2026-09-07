import { describe, expect, it } from 'vitest';

import {
  MAX_TREND_SAMPLES,
  MIN_TREND_SAMPLES,
  computeTrend,
  parseRatingSamples,
  parseRmpDate,
  type RatingSample,
} from './trend';

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Newest first, one day apart, so ordering is unambiguous. */
function samples(qualities: number[]): RatingSample[] {
  return qualities.map((quality, index) => ({
    postedAt: 1_000_000_000_000 - index * DAY_MS,
    quality,
  }));
}

describe('parseRmpDate', () => {
  it('parses the Go-style timestamp RMP returns', () => {
    expect(parseRmpDate('2026-05-25 03:24:40 +0000 UTC')).toBe(
      Date.parse('2026-05-25T03:24:40Z'),
    );
  });

  it.each([
    ['an empty string', ''],
    ['nonsense', 'last tuesday'],
    ['a number', 1_234],
    ['null', null],
    ['undefined', undefined],
  ])('returns null for %s', (_label, value) => {
    expect(parseRmpDate(value)).toBeNull();
  });
});

describe('parseRatingSamples', () => {
  function payload(nodes: unknown[]): unknown {
    return { data: { node: { ratings: { edges: nodes.map((node) => ({ node })) } } } };
  }

  it('averages clarity and helpfulness, matching how RMP scores a review', () => {
    const parsed = parseRatingSamples(
      payload([{ date: '2026-05-25 03:24:40 +0000 UTC', clarityRating: 5, helpfulRating: 4 }]),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0].quality).toBe(4.5);
  });

  it('drops reviews missing a usable date or score rather than guessing', () => {
    const parsed = parseRatingSamples(
      payload([
        { date: '2026-05-25 03:24:40 +0000 UTC', clarityRating: 5, helpfulRating: 4 },
        { date: 'not a date', clarityRating: 5, helpfulRating: 4 },
        { date: '2026-05-25 03:24:40 +0000 UTC', clarityRating: null, helpfulRating: 4 },
        { date: '2026-05-25 03:24:40 +0000 UTC', clarityRating: 9, helpfulRating: 4 },
        'not an object',
      ]),
    );

    expect(parsed).toHaveLength(1);
  });

  it.each([
    ['null', null],
    ['an unrelated shape', { data: { node: {} } }],
    ['a missing edges array', { data: { node: { ratings: {} } } }],
    ['a GraphQL error body', { errors: [{ message: 'nope' }] }],
  ])('returns nothing for %s', (_label, value) => {
    expect(parseRatingSamples(value)).toEqual([]);
  });
});

describe('computeTrend', () => {
  it('returns null below the sample floor, so the UI shows no arrow at all', () => {
    const tooFew = samples(Array.from({ length: MIN_TREND_SAMPLES - 1 }, () => 3));

    expect(computeTrend(tooFew)).toBeNull();
  });

  it('reports rising when recent reviews clearly beat older ones', () => {
    // Six recent 5s against six older 2s.
    expect(computeTrend(samples([5, 5, 5, 5, 5, 5, 2, 2, 2, 2, 2, 2]))).toBe('rising');
  });

  it('reports falling when recent reviews are clearly worse', () => {
    expect(computeTrend(samples([2, 2, 2, 2, 2, 2, 5, 5, 5, 5, 5, 5]))).toBe('falling');
  });

  it('reports steady for a flat history', () => {
    expect(computeTrend(samples(Array.from({ length: 14 }, () => 3.5)))).toBe('steady');
  });

  it('calls a sub-threshold drift steady rather than inventing a direction', () => {
    // Recent mean 3.5, older mean 3.25: real, but well inside the noise band.
    const drift = samples([4, 4, 3, 3, 3.5, 3.5, 3, 3, 3.5, 3.5, 3.25, 3.25]);

    expect(computeTrend(drift)).toBe('steady');
  });

  it('reads chronologically rather than trusting the given order', () => {
    const rising = samples([5, 5, 5, 5, 5, 5, 2, 2, 2, 2, 2, 2]);
    // Same reviews, shuffled: the dates still say recent ones are better.
    const shuffled = [...rising].sort((left, right) => left.quality - right.quality);

    expect(computeTrend(shuffled)).toBe('rising');
  });

  it('ignores history beyond the most recent window', () => {
    // The 20 newest reviews are flat, so the verdict is steady however bad the
    // professor's ancient history was.
    const window = Array.from({ length: MAX_TREND_SAMPLES }, () => 4);
    const ancient = Array.from({ length: 20 }, () => 1);

    expect(computeTrend(samples([...window, ...ancient]))).toBe('steady');
  });
});
