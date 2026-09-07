export const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
/**
 * No-match results expire sooner than real ratings so a professor who only just
 * appeared on RateMyProfessor is picked up within a day instead of a week.
 */
export const DEFAULT_NO_MATCH_TTL_MS = 24 * 60 * 60 * 1_000;
export const CACHE_ENTRY_LIMIT = 500;
export const BACKGROUND_HEALTH_CHECK = 'verdct:background-health-check';
export const LOOKUP_PROFESSOR_MESSAGE = 'verdct:lookup-professor';
export const REPORT_COURSE_DATA_MESSAGE = 'verdct:report-course-data';
export const GET_COURSE_DATA_MESSAGE = 'verdct:get-course-data';

/** Per-tab scratch space, cleared when the browser session ends. */
export const TAB_DATA_KEY_PREFIX = 'verdct:tab:';

/** Below this, the badges already make the comparison and a chart adds nothing. */
export const MIN_POINTS_TO_COMPARE = 3;
export const RMP_GRAPHQL_ENDPOINT = 'https://www.ratemyprofessors.com/graphql';
export const ASU_RMP_SCHOOL_ID = 'U2Nob29sLTE1NzIz';
export const MINIMUM_RMP_REQUEST_INTERVAL_MS = 750;

export const CACHE_STORAGE_KEY = 'verdct:ratings';
export const SETTINGS_STORAGE_KEY = 'verdct:settings';
export const FAVORITES_STORAGE_KEY = 'verdct:favorites';

/** Plenty for a semester of shortlisting, and bounds what the popup renders. */
export const FAVORITES_LIMIT = 100;

/** Ratings at or above this score render green; below GOOD, at or above FAIR renders yellow. */
export const DEFAULT_GOOD_RATING_THRESHOLD = 4;
export const DEFAULT_FAIR_RATING_THRESHOLD = 2.5;

/**
 * Attributes marking DOM that Verdct injected. The content script matches
 * against these to ignore its own mutations; a marker missing from
 * VERDCT_INJECTED_SELECTOR causes a redundant rescan on every render, so keep
 * the selector in step whenever a new injected element is added.
 */
export const VERDCT_BADGE_ATTRIBUTE = 'data-verdct-badge';
export const VERDCT_POPOVER_ATTRIBUTE = 'data-verdct-popover-layer';
export const VERDCT_BEST_ATTRIBUTE = 'data-verdct-best';
export const VERDCT_BEST_CHIP_ATTRIBUTE = 'data-verdct-best-chip';

export const VERDCT_INJECTED_SELECTOR =
  `[${VERDCT_BADGE_ATTRIBUTE}], [${VERDCT_POPOVER_ATTRIBUTE}], [${VERDCT_BEST_CHIP_ATTRIBUTE}]`;
