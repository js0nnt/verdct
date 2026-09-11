import {
  MIN_CONFIDENT_RATINGS,
  VERDCT_BEST_ATTRIBUTE,
  VERDCT_BEST_CHIP_ATTRIBUTE,
} from '../shared/constants';
import type { ProfessorRating } from '../shared/types';
import type { BadgeState } from './badgeRenderer';
import { configureAwards } from './badgeRenderer';
import type { ScannedClassSection } from './domScanner';
import { EMBEDDED_TOKENS } from './theme';
import { hideTooltip, showTooltip } from './tooltip';

export { VERDCT_BEST_ATTRIBUTE, VERDCT_BEST_CHIP_ATTRIBUTE };

/** Which distinction a section holds within its course. */
export type AwardKind = 'rated' | 'overall';

export interface AwardInfo {
  kinds: AwardKind[];
  courseId: string;
  /** Set when the winning rating rests on very few reviews. */
  thinSample: number | null;
}

/**
 * A course needs at least this many distinct rated professors before naming a
 * best section means anything — with one professor there is no choice to make.
 */
const MIN_DISTINCT_PROFESSORS = 2;

/**
 * Neither award has a review floor. Both are judged purely on their score, and
 * a thinly-reviewed rating is marked on the badge itself — grey, with the count
 * inline — rather than being silently excluded from the running. Hiding the
 * reason inside an eligibility rule made a correct ranking look broken.
 */

/**
 * Rating alone says nothing about workload, so a demanding grader with devoted
 * students can hold the top score while being the harder choice. The overall
 * score discounts a rating by how far difficulty sits above the middle of the
 * scale, and credits one that sits below it.
 *
 * The weight is a judgement call, not a measurement: at 0.35 a professor a full
 * point harder than average gives up roughly a third of a rating point, which
 * is enough to reorder genuinely close calls without letting easiness dominate.
 */
const DIFFICULTY_WEIGHT = 0.35;
const DIFFICULTY_MIDPOINT = 3;

export const AWARD_LABEL: Record<AwardKind, string> = {
  rated: 'Best rated',
  overall: 'Best overall',
};

export function awardExplanation(
  kind: AwardKind,
  courseId: string,
  thinSample: number | null = null,
): string {
  const caveat = thinSample
    ? ` Based on only ${thinSample} rating${thinSample === 1 ? '' : 's'}, so treat it with care.`
    : '';
  return kind === 'rated'
    ? `Highest rating in ${courseId}. Does not account for how hard the course is.${caveat}`
    : `Best balance of rating and difficulty in ${courseId}.${caveat}`;
}

interface TrackedRow {
  courseId: string;
  /** Where chips are injected; the badge already draws the eye here. */
  instructorElement: HTMLElement;
  /** Best raw rating among the professors listed in this row. */
  ratingScore: number | null;
  /** How many reviews back that best raw rating. */
  ratingSample: number;
  /** Best difficulty-adjusted rating among them. */
  overallScore: number | null;
  /** How many reviews back that balance score. */
  overallSample: number;
  /** Normalized names of eligible professors, for counting distinct choices. */
  professors: Set<string>;
}

const trackedRows = new Map<HTMLElement, TrackedRow>();
let styleInjected = false;

/**
 * A guessed name must never carry an award, whichever kind, since the whole
 * claim would be about the wrong person.
 */
export function isEligibleForRated(rating: ProfessorRating): boolean {
  return rating.matchConfidence === 'high' && rating.overallRating !== null;
}

/** Same bar: only a difficulty score is additionally required to balance against. */
export function isEligibleForOverall(rating: ProfessorRating): boolean {
  return isEligibleForRated(rating) && rating.difficulty !== null;
}

/** Rating discounted by difficulty. Null when difficulty is unknown. */
export function difficultyAdjustedScore(rating: ProfessorRating): number | null {
  if (rating.overallRating === null || rating.difficulty === null) return null;
  return rating.overallRating - DIFFICULTY_WEIGHT * (rating.difficulty - DIFFICULTY_MIDPOINT);
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
    [${VERDCT_BEST_ATTRIBUTE}] {
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
        ratingScore: null,
        ratingSample: 0,
        overallScore: null,
        overallSample: 0,
        professors: new Set(),
      };

  if (rating && isEligibleForRated(rating)) {
    if (rating.overallRating! > (row.ratingScore ?? -Infinity)) {
      row.ratingScore = rating.overallRating!;
      row.ratingSample = rating.numRatings;
    }
    row.professors.add(rating.normalizedName);

    if (isEligibleForOverall(rating)) {
      const adjusted = difficultyAdjustedScore(rating)!;
      if (adjusted > (row.overallScore ?? -Infinity)) {
        row.overallScore = adjusted;
        row.overallSample = rating.numRatings;
      }
    }
  }

  trackedRows.set(section.rowElement, row);
}

const CHIP_STYLES = `
  :host { all: initial; }
  ${EMBEDDED_TOKENS}

  span.chip {
    all: unset;
    display: inline-flex;
    align-items: center;
    margin-left: 6px;
    padding: 1px 6px;
    border: 1px solid rgba(31, 157, 99, 0.4);
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
    cursor: default;
  }
  /* Both awards share one colour: the labels already distinguish them, and a
     greyed chip read as disabled rather than as the weaker of two claims. */
`;

function chipHost(kind: AwardKind, courseId: string, thinSample: number | null): HTMLElement {
  const host = document.createElement('span');
  host.setAttribute(VERDCT_BEST_CHIP_ATTRIBUTE, kind);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CHIP_STYLES;

  const chip = document.createElement('span');
  chip.className = `chip ${kind}`;
  chip.textContent = AWARD_LABEL[kind];
  // Hovering the chip has to say what it actually means; "best" alone invites
  // the reading that it accounts for everything.
  const explanation = awardExplanation(kind, courseId, thinSample);
  chip.tabIndex = 0;
  chip.setAttribute('aria-label', `${AWARD_LABEL[kind]}. ${explanation}`);

  chip.addEventListener('mouseenter', () => showTooltip(chip, AWARD_LABEL[kind], explanation));
  chip.addEventListener('focus', () => showTooltip(chip, AWARD_LABEL[kind], explanation));
  chip.addEventListener('mouseleave', hideTooltip);
  chip.addEventListener('blur', hideTooltip);

  shadow.append(style, chip);
  return host;
}

/** A tinted row alone does not say why it is tinted, so winners are labelled. */
function setChips(tracked: TrackedRow, kinds: AwardKind[], thinSample: number | null): void {
  const cell = tracked.instructorElement;
  const existing = new Map<string, HTMLElement>();
  for (const node of cell.querySelectorAll<HTMLElement>(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`)) {
    existing.set(node.getAttribute(VERDCT_BEST_CHIP_ATTRIBUTE) ?? '', node);
  }

  for (const [kind, node] of existing) {
    if (!kinds.includes(kind as AwardKind)) node.remove();
  }

  for (const kind of kinds) {
    if (!existing.has(kind)) cell.append(chipHost(kind, tracked.courseId, thinSample));
  }
}

function setBest(
  row: HTMLElement,
  tracked: TrackedRow,
  kinds: AwardKind[],
  thinSample: number | null,
): void {
  if (kinds.length > 0) {
    row.setAttribute(VERDCT_BEST_ATTRIBUTE, kinds.join(' '));
  } else if (row.hasAttribute(VERDCT_BEST_ATTRIBUTE)) {
    row.removeAttribute(VERDCT_BEST_ATTRIBUTE);
  }
  setChips(tracked, kinds, thinSample);
}

/**
 * Recomputes the winners per course. Runs after every lookup resolves, so the
 * highlight settles as ratings arrive rather than needing a final signal.
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

  const awards = new Map<string, AwardInfo>();

  for (const rows of byCourse.values()) {
    const distinctProfessors = new Set<string>();
    let topRating = -Infinity;
    let topOverall = -Infinity;

    for (const row of rows) {
      const tracked = trackedRows.get(row)!;
      for (const professor of tracked.professors) distinctProfessors.add(professor);
      if (tracked.ratingScore !== null) topRating = Math.max(topRating, tracked.ratingScore);
      if (tracked.overallScore !== null) topOverall = Math.max(topOverall, tracked.overallScore);
    }

    const worthHighlighting = distinctProfessors.size >= MIN_DISTINCT_PROFESSORS;

    for (const row of rows) {
      // Ties all win: several sections taught by the same top professor are
      // genuinely equal choices, and silently picking one would be arbitrary.
      const tracked = trackedRows.get(row)!;
      const kinds: AwardKind[] = [];
      if (worthHighlighting) {
        if (topRating > -Infinity && tracked.ratingScore === topRating) kinds.push('rated');
        if (topOverall > -Infinity && tracked.overallScore === topOverall) kinds.push('overall');
      }

      // Either award can now rest on a thin sample, so flag whichever does.
      const samples = [
        kinds.includes('rated') ? tracked.ratingSample : null,
        kinds.includes('overall') ? tracked.overallSample : null,
      ].filter((n): n is number => n !== null && n < MIN_CONFIDENT_RATINGS);
      const thinSample = samples.length > 0 ? Math.min(...samples) : null;

      setBest(row, tracked, kinds, thinSample);
      for (const professor of tracked.professors) {
        if (kinds.length > 0) {
          awards.set(professor, { kinds, courseId: tracked.courseId, thinSample });
        }
      }
    }
  }

  // The popover repeats the distinction, so hovering a badge explains it too.
  configureAwards(awards);
  if (trackedRows.size > 0) ensureStyles();
}

export function resetBestSectionsForTests(): void {
  trackedRows.clear();
  styleInjected = false;
  configureAwards(new Map());
}
