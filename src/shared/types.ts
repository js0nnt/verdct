/** Direction of a professor's recent reviews against their older ones. */
export type RatingTrend = 'rising' | 'falling' | 'steady';

export interface ProfessorRating {
  normalizedName: string;
  displayName: string;
  overallRating: number | null;
  difficulty: number | null;
  wouldTakeAgainPct: number | null;
  numRatings: number;
  fetchedAt: number;
  matchConfidence: 'high' | 'low' | 'none';
  /** null when there were too few reviews to say anything. */
  trend: RatingTrend | null;
}

export interface LookupProfessorMessage {
  type: 'verdct:lookup-professor';
  professorName: string;
}

export type LookupProfessorResponse =
  | { ok: true; rating: ProfessorRating }
  | { ok: false; error: string };

export interface VerdctSettings {
  /** TTL applied to ratings that matched a professor on RateMyProfessor. */
  cacheTtlMs: number;
  /** TTL applied to "no match found" results. */
  noMatchTtlMs: number;
  /** Ratings at or above this value render green. */
  goodRatingThreshold: number;
  /** Ratings at or above this value (but below good) render yellow; lower renders red. */
  fairRatingThreshold: number;
}

export interface CacheEntry {
  rating: ProfessorRating;
  /** Epoch ms of the last cache read or write, used for LRU eviction. */
  lastAccessedAt: number;
}

export type CacheStore = Record<string, CacheEntry>;

export interface CacheStats {
  entryCount: number;
  oldestFetchedAt: number | null;
}

export interface FavoriteProfessor {
  /** Same key the rating cache uses, so a favorite can be joined to its rating. */
  normalizedName: string;
  displayName: string;
  addedAt: number;
}
