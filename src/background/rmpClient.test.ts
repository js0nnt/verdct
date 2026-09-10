import { describe, expect, it, vi } from 'vitest';

import {
  lookupProfessorRating,
  matchTeacherCandidates,
  parseTeacherCandidates,
} from './rmpClient';

const validPayload = {
  data: {
    search: {
      teachers: {
        edges: [
          {
            node: {
              id: 'VGVhY2hlci00Nzc1MjQ=',
              legacyId: 477524,
              firstName: 'Hedvig',
              lastName: 'Mohacsy',
              avgRating: 3.5,
              avgDifficulty: 3.5,
              wouldTakeAgainPercent: 57,
              numRatings: 150,
              school: {
                id: 'U2Nob29sLTE1NzIz',
                name: 'Arizona State University',
              },
            },
          },
        ],
      },
    },
  },
};

describe('parseTeacherCandidates', () => {
  it('defensively parses the observed RMP response shape', () => {
    expect(parseTeacherCandidates(validPayload)).toEqual([
      expect.objectContaining({
        firstName: 'Hedvig',
        lastName: 'Mohacsy',
        avgRating: 3.5,
        numRatings: 150,
      }),
    ]);
  });

  it.each([null, {}, { data: {} }, { data: { search: { teachers: { edges: 'bad' } } } }])(
    'returns no candidates for malformed schema %#',
    (payload) => expect(parseTeacherCandidates(payload)).toEqual([]),
  );

  it('drops malformed and non-ASU teacher records', () => {
    const payload = structuredClone(validPayload);
    payload.data.search.teachers.edges[0].node.school.id = 'U2Nob29sLTk5';
    expect(parseTeacherCandidates(payload)).toEqual([]);
  });
});

describe('matchTeacherCandidates', () => {
  it('maps a confident match to the shared aggregate model', () => {
    const candidates = parseTeacherCandidates(validPayload);
    expect(matchTeacherCandidates('Mohacsy, H.', candidates, 1234)).toEqual({
      teacherId: 'VGVhY2hlci00Nzc1MjQ=',
      legacyId: 477524,
      normalizedName: 'h mohacsy',
      displayName: 'Hedvig Mohacsy',
      overallRating: 3.5,
      difficulty: 3.5,
      wouldTakeAgainPct: 57,
      numRatings: 150,
      fetchedAt: 1234,
      matchConfidence: 'low',
      trend: null,
    });
  });

  it('returns an explicit no-match result instead of guessing', () => {
    expect(matchTeacherCandidates('Ada Lovelace', parseTeacherCandidates(validPayload), 1234))
      .toMatchObject({ overallRating: null, matchConfidence: 'none', fetchedAt: 1234 });
  });
});

describe('lookupProfessorRating', () => {
  it('posts the school-scoped search and returns the matched rating', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(validPayload), { status: 200 }),
    );

    const rating = await lookupProfessorRating('Hedvig Mohacsy', {
      fetcher,
      minimumDelayMs: 0,
      now: () => 5678,
    });

    expect(rating).toMatchObject({ displayName: 'Hedvig Mohacsy', overallRating: 3.5 });
    const [, request] = fetcher.mock.calls[0]!;
    const body = JSON.parse(String(request?.body));
    expect(body.variables.query).toEqual({
      text: 'Hedvig Mohacsy',
      schoolID: 'U2Nob29sLTE1NzIz',
      fallback: false,
    });
  });

  it('surfaces network failures to the background handler', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }));
    await expect(lookupProfessorRating('Hedvig Mohacsy', {
      fetcher,
      minimumDelayMs: 0,
    })).rejects.toThrow('HTTP 503');
  });
});
