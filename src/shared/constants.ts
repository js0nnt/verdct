export const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
/**
 * No-match results expire sooner than real ratings so a professor who only just
 * appeared on RateMyProfessor is picked up within a day instead of a week.
 */
export const DEFAULT_NO_MATCH_TTL_MS = 24 * 60 * 60 * 1_000;
export const CACHE_ENTRY_LIMIT = 500;
export const BACKGROUND_HEALTH_CHECK = 'verdct:background-health-check';
export const LOOKUP_PROFESSOR_MESSAGE = 'verdct:lookup-professor';
export const RMP_GRAPHQL_ENDPOINT = 'https://www.ratemyprofessors.com/graphql';
export const ASU_RMP_SCHOOL_ID = 'U2Nob29sLTE1NzIz';
export const MINIMUM_RMP_REQUEST_INTERVAL_MS = 750;

export const CACHE_STORAGE_KEY = 'verdct:ratings';
export const SETTINGS_STORAGE_KEY = 'verdct:settings';

/** Ratings at or above this score render green; below GOOD, at or above FAIR renders yellow. */
export const DEFAULT_GOOD_RATING_THRESHOLD = 4;
export const DEFAULT_FAIR_RATING_THRESHOLD = 2.5;
