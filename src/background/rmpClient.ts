import {
  ASU_RMP_SCHOOL_ID,
  MAX_CONCURRENT_RMP_REQUESTS,
  MINIMUM_RMP_REQUEST_INTERVAL_MS,
  RMP_GRAPHQL_ENDPOINT,
} from '../shared/constants';
import type { ProfessorRating } from '../shared/types';
import { findBestNameMatch, normalizeProfessorName } from './nameMatcher';
import { MIN_TREND_SAMPLES, MAX_TREND_SAMPLES, computeTrend, parseRatingSamples } from './trend';

interface RmpTeacherCandidate {
  id: string;
  legacyId: number | null;
  firstName: string;
  lastName: string;
  avgRating: number | null;
  avgDifficulty: number | null;
  wouldTakeAgainPercent: number | null;
  numRatings: number;
}

interface LookupOptions {
  fetcher?: typeof fetch;
  minimumDelayMs?: number;
  now?: () => number;
}

/**
 * Constructed from the TeacherSearchPaginationQuery observed on RMP's own ASU
 * professor search on 2026-09-06. This intentionally requests only Verdct's
 * aggregate fields so schema changes remain localized to this module.
 */
const TEACHER_SEARCH_QUERY = `
  query VerdctTeacherSearch($count: Int!, $query: TeacherSearchQuery!) {
    search: newSearch {
      teachers(query: $query, first: $count) {
        didFallback
        edges {
          node {
            id
            legacyId
            firstName
            lastName
            avgRating
            avgDifficulty
            wouldTakeAgainPercent
            numRatings
            school {
              id
              name
            }
          }
        }
      }
    }
  }
`;

/**
 * Individual reviews, fetched only for a confident match that has enough of
 * them to be worth analysing. Kept as a second request rather than folded into
 * the search so the search response does not carry 20 reviews for each of 20
 * candidate teachers.
 */
const TEACHER_RATINGS_QUERY = `
  query VerdctTeacherRatings($id: ID!, $count: Int!) {
    node(id: $id) {
      ... on Teacher {
        ratings(first: $count) {
          edges {
            node {
              date
              clarityRating
              helpfulRating
            }
          }
        }
      }
    }
  }
`;

let activeRequests = 0;
let nextRequestAllowedAt = 0;
const waitingForSlot: Array<() => void> = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNumber(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function parseTeacherCandidates(payload: unknown): RmpTeacherCandidate[] {
  if (!isRecord(payload)) return [];
  const data = payload.data;
  if (!isRecord(data)) return [];
  const search = data.search;
  if (!isRecord(search)) return [];
  const teachers = search.teachers;
  if (!isRecord(teachers) || !Array.isArray(teachers.edges)) return [];

  const candidates: RmpTeacherCandidate[] = [];
  for (const edge of teachers.edges) {
    if (!isRecord(edge) || !isRecord(edge.node)) continue;
    const node = edge.node;
    const school = node.school;
    const firstName = typeof node.firstName === 'string' ? node.firstName.trim() : '';
    const lastName = typeof node.lastName === 'string' ? node.lastName.trim() : '';
    const id = typeof node.id === 'string' ? node.id : '';
    const numRatings = nonNegativeInteger(node.numRatings);

    if (
      !id ||
      !firstName ||
      !lastName ||
      numRatings === null ||
      !isRecord(school) ||
      school.id !== ASU_RMP_SCHOOL_ID
    ) {
      continue;
    }

    candidates.push({
      id,
      legacyId: nonNegativeInteger(node.legacyId),
      firstName,
      lastName,
      avgRating: finiteNumber(node.avgRating, 0, 5),
      avgDifficulty: finiteNumber(node.avgDifficulty, 0, 5),
      wouldTakeAgainPercent: finiteNumber(node.wouldTakeAgainPercent, 0, 100),
      numRatings,
    });
  }

  return candidates;
}

function noMatchRating(professorName: string, fetchedAt: number): ProfessorRating {
  return {
    normalizedName: normalizeProfessorName(professorName),
    displayName: professorName.trim(),
    overallRating: null,
    difficulty: null,
    wouldTakeAgainPct: null,
    numRatings: 0,
    fetchedAt,
    matchConfidence: 'none',
    trend: null,
    legacyId: null,
  };
}

export function matchTeacherCandidates(
  professorName: string,
  candidates: RmpTeacherCandidate[],
  fetchedAt = Date.now(),
): ProfessorRating & { teacherId?: string } {
  const match = findBestNameMatch(professorName, candidates);
  if (!match) return noMatchRating(professorName, fetchedAt);

  const candidate = match.candidate;
  const hasRatings = candidate.numRatings > 0;
  return {
    teacherId: candidate.id,
    normalizedName: normalizeProfessorName(professorName),
    displayName: `${candidate.firstName} ${candidate.lastName}`,
    overallRating: hasRatings ? candidate.avgRating : null,
    difficulty: hasRatings ? candidate.avgDifficulty : null,
    wouldTakeAgainPct: hasRatings ? candidate.wouldTakeAgainPercent : null,
    numRatings: candidate.numRatings,
    fetchedAt,
    matchConfidence: match.confidence,
    trend: null,
    legacyId: candidate.legacyId,
  };
}

function releaseSlot(): void {
  activeRequests -= 1;
  waitingForSlot.shift()?.();
}

/**
 * Bounded concurrency rather than a single file. `while` rather than `if`,
 * because several callers can be woken before any of them takes its slot.
 */
async function acquireSlot(minimumDelayMs: number): Promise<void> {
  while (activeRequests >= MAX_CONCURRENT_RMP_REQUESTS) {
    await new Promise<void>((resolve) => waitingForSlot.push(resolve));
  }
  activeRequests += 1;

  const waitMs = Math.max(0, nextRequestAllowedAt - Date.now());
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  nextRequestAllowedAt = Date.now() + minimumDelayMs;
}

async function enqueueRequest<T>(task: () => Promise<T>, minimumDelayMs: number): Promise<T> {
  await acquireSlot(minimumDelayMs);
  try {
    return await task();
  } finally {
    // Released even when the task throws, or one failure would leak a slot and
    // eventually stall every remaining lookup.
    releaseSlot();
  }
}

async function postGraphql(
  fetcher: typeof fetch,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetcher(RMP_GRAPHQL_ENDPOINT, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      Authorization: 'null',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`RMP lookup failed with HTTP ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (isRecord(payload) && Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error('RMP returned a GraphQL error.');
  }
  return payload;
}

/**
 * Best-effort: a trend is a nicety, so a failure here returns null rather than
 * discarding a rating the caller already has.
 */
export async function fetchRatingTrend(
  teacherId: string,
  options: LookupOptions = {},
): Promise<ProfessorRating['trend']> {
  try {
    const payload = await postGraphql(options.fetcher ?? fetch, {
      operationName: 'VerdctTeacherRatings',
      query: TEACHER_RATINGS_QUERY,
      variables: { id: teacherId, count: MAX_TREND_SAMPLES },
    });
    return computeTrend(parseRatingSamples(payload));
  } catch (error) {
    console.warn('[Verdct] Trend lookup failed; continuing without it', error);
    return null;
  }
}

export async function lookupProfessorRating(
  professorName: string,
  options: LookupOptions = {},
): Promise<ProfessorRating> {
  const requestedName = professorName.trim();
  const now = options.now ?? Date.now;
  if (!requestedName) {
    return noMatchRating(professorName, now());
  }

  const minimumDelayMs = options.minimumDelayMs ?? MINIMUM_RMP_REQUEST_INTERVAL_MS;

  const { teacherId, ...rating } = await enqueueRequest(async () => {
    const payload = await postGraphql(options.fetcher ?? fetch, {
      operationName: 'VerdctTeacherSearch',
      query: TEACHER_SEARCH_QUERY,
      variables: {
        count: 20,
        query: { text: requestedName, schoolID: ASU_RMP_SCHOOL_ID, fallback: false },
      },
    });

    return matchTeacherCandidates(requestedName, parseTeacherCandidates(payload), now());
  }, minimumDelayMs);

  // The second request is only worth making for a confident match with enough
  // reviews to split, so thinly-rated professors cost one request as before.
  if (!teacherId || rating.matchConfidence !== 'high' || rating.numRatings < MIN_TREND_SAMPLES) {
    return rating;
  }

  // Enqueued separately rather than nested: the queue is serial, so a nested
  // enqueue would wait on the request that is still holding it.
  const trend = await enqueueRequest(
    () => fetchRatingTrend(teacherId, options),
    minimumDelayMs,
  );

  return { ...rating, trend };
}
