export interface NamedCandidate {
  firstName: string;
  lastName: string;
}

export interface NameMatch<TCandidate extends NamedCandidate> {
  candidate: TCandidate;
  confidence: 'high' | 'low';
  score: number;
}

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md']);
const NAME_PREFIXES = new Set(['dr', 'prof', 'professor']);
const MINIMUM_MATCH_SCORE = 0.78;
const HIGH_CONFIDENCE_SCORE = 0.92;
const AMBIGUOUS_SCORE_GAP = 0.04;

function simplifyNamePart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeProfessorName(value: string): string {
  const commaParts = value.split(',').map(simplifyNamePart).filter(Boolean);
  const reordered = commaParts.length >= 2
    ? `${commaParts.slice(1).join(' ')} ${commaParts[0]}`
    : simplifyNamePart(value);
  const tokens = reordered
    .split(' ')
    .filter(Boolean)
    .filter((token) => !NAME_PREFIXES.has(token))
    .filter((token) => !NAME_SUFFIXES.has(token));

  return tokens.join(' ');
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous = current;
  }

  return previous[right.length];
}

function stringSimilarity(left: string, right: string): number {
  const longestLength = Math.max(left.length, right.length);
  if (longestLength === 0) return 1;
  return 1 - levenshteinDistance(left, right) / longestLength;
}

function tokenOverlap(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

export function scoreNameMatch(requestedName: string, candidateName: string): number {
  const requested = normalizeProfessorName(requestedName);
  const candidate = normalizeProfessorName(candidateName);
  if (!requested || !candidate) return 0;
  if (requested === candidate) return 1;

  const requestedTokens = requested.split(' ');
  const candidateTokens = candidate.split(' ');
  const requestedFirst = requestedTokens[0];
  const candidateFirst = candidateTokens[0];
  const requestedLast = requestedTokens.at(-1)!;
  const candidateLast = candidateTokens.at(-1)!;
  const lastSimilarity = stringSimilarity(requestedLast, candidateLast);

  if (lastSimilarity < 0.7) return 0;

  const firstSimilarity = requestedFirst[0] === candidateFirst[0] &&
    (requestedFirst.length === 1 || candidateFirst.length === 1)
    ? 0.9
    : stringSimilarity(requestedFirst, candidateFirst);

  return (
    lastSimilarity * 0.45 +
    firstSimilarity * 0.3 +
    tokenOverlap(requestedTokens, candidateTokens) * 0.15 +
    stringSimilarity(requested, candidate) * 0.1
  );
}

export function findBestNameMatch<TCandidate extends NamedCandidate>(
  requestedName: string,
  candidates: TCandidate[],
): NameMatch<TCandidate> | null {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreNameMatch(requestedName, `${candidate.firstName} ${candidate.lastName}`),
    }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];

  if (!best || best.score < MINIMUM_MATCH_SCORE) return null;
  if (
    best.score < HIGH_CONFIDENCE_SCORE &&
    runnerUp &&
    best.score - runnerUp.score < AMBIGUOUS_SCORE_GAP
  ) {
    return null;
  }

  return {
    candidate: best.candidate,
    confidence: best.score >= HIGH_CONFIDENCE_SCORE ? 'high' : 'low',
    score: best.score,
  };
}
