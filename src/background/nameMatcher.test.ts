import { describe, expect, it } from 'vitest';

import {
  findBestNameMatch,
  normalizeProfessorName,
  scoreNameMatch,
} from './nameMatcher';

describe('normalizeProfessorName', () => {
  it('normalizes comma order, accents, titles, and suffixes', () => {
    expect(normalizeProfessorName('Dr. Núñez, María L., PhD')).toBe('maria l nunez');
  });
});

describe('scoreNameMatch', () => {
  it('accepts a first initial when the last name matches', () => {
    expect(scoreNameMatch('Mohacsy, H.', 'Hedvig Mohacsy')).toBeGreaterThanOrEqual(0.78);
  });

  it('rejects a different last name', () => {
    expect(scoreNameMatch('David Fishman', 'David Oakes')).toBe(0);
  });
});

describe('findBestNameMatch', () => {
  const candidates = [
    { firstName: 'Hedvig', lastName: 'Mohacsy', id: 'correct' },
    { firstName: 'Helen', lastName: 'Morrison', id: 'other' },
  ];

  it('returns an exact match with high confidence', () => {
    expect(findBestNameMatch('Mohacsy, Hedvig', candidates)).toMatchObject({
      candidate: { id: 'correct' },
      confidence: 'high',
      score: 1,
    });
  });

  it('returns null when there is no confident match', () => {
    expect(findBestNameMatch('Ada Lovelace', candidates)).toBeNull();
  });

  it('rejects an ambiguous initial-only match', () => {
    expect(findBestNameMatch('J. Smith', [
      { firstName: 'John', lastName: 'Smith' },
      { firstName: 'Jane', lastName: 'Smith' },
    ])).toBeNull();
  });
});
