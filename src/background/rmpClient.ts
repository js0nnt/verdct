import {
  ASU_RMP_SCHOOL_ID,
  MINIMUM_RMP_REQUEST_INTERVAL_MS,
  RMP_GRAPHQL_ENDPOINT,
} from '../shared/constants';
import type { ProfessorRating } from '../shared/types';
import { findBestNameMatch, normalizeProfessorName } from './nameMatcher';

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

let requestQueue: Promise<unknown> = Promise.resolve();
let nextRequestAllowedAt = 0;

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
  };
}

export function matchTeacherCandidates(
  professorName: string,
  candidates: RmpTeacherCandidate[],
  fetchedAt = Date.now(),
): ProfessorRating {
  const match = findBestNameMatch(professorName, candidates);
  if (!match) return noMatchRating(professorName, fetchedAt);

  const candidate = match.candidate;
  const hasRatings = candidate.numRatings > 0;
  return {
    normalizedName: normalizeProfessorName(professorName),
    displayName: `${candidate.firstName} ${candidate.lastName}`,
    overallRating: hasRatings ? candidate.avgRating : null,
    difficulty: hasRatings ? candidate.avgDifficulty : null,
    wouldTakeAgainPct: hasRatings ? candidate.wouldTakeAgainPercent : null,
    numRatings: candidate.numRatings,
    fetchedAt,
    matchConfidence: match.confidence,
  };
}

function enqueueRequest<T>(task: () => Promise<T>, minimumDelayMs: number): Promise<T> {
  const scheduled = requestQueue.catch(() => undefined).then(async () => {
    const waitMs = Math.max(0, nextRequestAllowedAt - Date.now());
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    nextRequestAllowedAt = Date.now() + minimumDelayMs;
    return task();
  });
  requestQueue = scheduled;
  return scheduled;
}

export function lookupProfessorRating(
  professorName: string,
  options: LookupOptions = {},
): Promise<ProfessorRating> {
  const requestedName = professorName.trim();
  const now = options.now ?? Date.now;
  if (!requestedName) {
    return Promise.resolve(noMatchRating(professorName, now()));
  }

  return enqueueRequest(async () => {
    const response = await (options.fetcher ?? fetch)(RMP_GRAPHQL_ENDPOINT, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        Authorization: 'null',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operationName: 'VerdctTeacherSearch',
        query: TEACHER_SEARCH_QUERY,
        variables: {
          count: 20,
          query: {
            text: requestedName,
            schoolID: ASU_RMP_SCHOOL_ID,
            fallback: false,
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`RMP lookup failed with HTTP ${response.status}.`);
    }

    const payload: unknown = await response.json();
    if (isRecord(payload) && Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new Error('RMP returned a GraphQL error.');
    }

    return matchTeacherCandidates(requestedName, parseTeacherCandidates(payload), now());
  }, options.minimumDelayMs ?? MINIMUM_RMP_REQUEST_INTERVAL_MS);
}
