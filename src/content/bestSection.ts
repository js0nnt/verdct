import { VERDCT_BEST_ATTRIBUTE, VERDCT_BEST_CHIP_ATTRIBUTE } from '../shared/constants';
import type { ProfessorRating } from '../shared/types';
import type { BadgeState } from './badgeRenderer';
import type { ScannedClassSection } from './domScanner';

export { VERDCT_BEST_ATTRIBUTE, VERDCT_BEST_CHIP_ATTRIBUTE };

/**
 * A course needs at least this many distinct rated professors before naming a
 * best section means anything — with one professor there is no choice to make.
 */
const MIN_DISTINCT_PROFESSORS = 2;

/**
 * A rating must clear this many reviews to win. Without it a 4.7 from 3
 * students would outrank a 4.5 from 200, which is exactly the misleading
 * comparison the provisional badge treatment exists to prevent.
 */
const MIN_RATINGS_TO_WIN = 5;

interface TrackedRow {
  courseId: string;
  /** Where the chip is injected; the badge already draws the eye here. */
  instructorElement: HTMLElement;
  /** Best eligible rating among the professors listed in this row. */
  score: number | null;
  /** Normalized names of eligible professors, for counting distinct choices. */
  professors: Set<string>;
}

const trackedRows = new Map<HTMLElement, TrackedRow>();
let styleInjected = false;

/**
 * Only high-confidence, well-sampled ratings can win. A recommendation is a
 * stronger claim than a badge, so it takes stronger evidence.
 */
export function isEligibleToWin(rating: ProfessorRating): boolean {
  return (
    rating.matchConfidence === 'high' &&
    rating.overallRating !== null &&
    rating.numRatings >= MIN_RATINGS_TO_WIN
  );
}

function ensureStyles(): void {
  if (styleInjected || document.head.querySelector(`style[${VERDCT_BEST_ATTRIBUTE}]`)) {
    styleInjected = true;
    return;
  }

  const style = document.createElement('style');
  style.setAttribute(VERDCT_BEST_ATTRIBUTE, '');
  // Scoped entirely to the marker attribute, so nothing here can affect a row
  // Verdct has not explicitly marked.
  style.textContent = `
    [${VERDCT_BEST_ATTRIBUTE}="true"] {
      background-image: linear-gradient(90deg, rgba(31, 157, 99, 0.09), rgba(31, 157, 99, 0) 50%) !important;
      box-shadow: inset 2px 0 0 0 #1f9d63;
    }
  `;
  document.head.append(style);
  styleInjected = true;
}

function ratingFromState(state: BadgeState): ProfessorRating | null {
  return state.status === 'ready' ? state.rating : null;
}

/** Records what a row's badge resolved to, for the next evaluation pass. */
export function recordSection(section: ScannedClassSection, state: BadgeState): void {
  const rating = ratingFromState(state);
  const existing = trackedRows.get(section.rowElement);
  const row: TrackedRow = existing?.courseId === section.courseId
    ? existing
    : {
        courseId: section.courseId,
        instructorElement: section.instructorElement,
        score: null,
        professors: new Set(),
      };

  if (rating && isEligibleToWin(rating)) {
    row.score = Math.max(row.score ?? -Infinity, rating.overallRating!);
    row.professors.add(rating.normalizedName);
  }

  trackedRows.set(section.rowElement, row);
}

const CHIP_STYLES = `
  :host { all: initial; }
  span {
    all: unset;
    display: inline-flex;
    align-items: center;
    margin-left: 6px;
    padding: 1px 6px;
    border: 1px solid rgba(31, 157, 99, 0.35);
    border-radius: 5px;
    background: rgba(31, 157, 99, 0.1);
    color: #14764a;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    line-height: 13px;
    text-transform: uppercase;
    white-space: nowrap;
    vertical-align: middle;
  }
`;

/** A tinted row alone does not say why it is tinted, so the winner is labelled. */
function setChip(tracked: TrackedRow, isBest: boolean): void {
  const cell = tracked.instructorElement;
  const existing = cell.querySelector<HTMLElement>(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`);

  if (!isBest) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const host = document.createElement('span');
  host.setAttribute(VERDCT_BEST_CHIP_ATTRIBUTE, '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CHIP_STYLES;
  const label = document.createElement('span');
  label.textContent = 'Best rated';
  shadow.append(style, label);
  cell.append(host);
}

function setBest(row: HTMLElement, tracked: TrackedRow, isBest: boolean): void {
  if (isBest) {
    row.setAttribute(VERDCT_BEST_ATTRIBUTE, 'true');
  } else if (row.hasAttribute(VERDCT_BEST_ATTRIBUTE)) {
    row.removeAttribute(VERDCT_BEST_ATTRIBUTE);
  }
  setChip(tracked, isBest);
}

/**
 * Recomputes the winning row per course. Runs after every lookup resolves, so
 * the highlight settles as ratings arrive rather than needing a final signal.
 */
export function evaluateBestSections(): void {
  // Rows detached by ASU re-rendering would otherwise leak and skew counts.
  for (const row of [...trackedRows.keys()]) {
    if (!row.isConnected) trackedRows.delete(row);
  }

  const byCourse = new Map<string, HTMLElement[]>();
  for (const [row, tracked] of trackedRows) {
    const rows = byCourse.get(tracked.courseId) ?? [];
    rows.push(row);
    byCourse.set(tracked.courseId, rows);
  }

  for (const rows of byCourse.values()) {
    const distinctProfessors = new Set<string>();
    let topScore = -Infinity;

    for (const row of rows) {
      const tracked = trackedRows.get(row)!;
      for (const professor of tracked.professors) distinctProfessors.add(professor);
      if (tracked.score !== null) topScore = Math.max(topScore, tracked.score);
    }

    const worthHighlighting =
      distinctProfessors.size >= MIN_DISTINCT_PROFESSORS && topScore > -Infinity;

    for (const row of rows) {
      // Ties all win: several sections taught by the same top professor are
      // genuinely equal choices, and silently picking one would be arbitrary.
      const tracked = trackedRows.get(row)!;
      setBest(row, tracked, worthHighlighting && tracked.score === topScore);
    }
  }

  if (trackedRows.size > 0) ensureStyles();
}

export function resetBestSectionsForTests(): void {
  trackedRows.clear();
  styleInjected = false;
}
