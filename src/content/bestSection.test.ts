// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import type { ProfessorRating } from '../shared/types';
import type { BadgeState } from './badgeRenderer';
import { isVerdctNode } from './badgeRenderer';
import {
  VERDCT_BEST_ATTRIBUTE,
  VERDCT_BEST_CHIP_ATTRIBUTE,
  evaluateBestSections,
  isEligibleToWin,
  recordSection,
  resetBestSectionsForTests,
} from './bestSection';
import type { ScannedClassSection } from './domScanner';

function rating(overrides: Partial<ProfessorRating> = {}): ProfessorRating {
  return {
    normalizedName: 'ada lovelace',
    displayName: 'Ada Lovelace',
    overallRating: 4,
    difficulty: 3,
    wouldTakeAgainPct: 70,
    numRatings: 40,
    fetchedAt: 1_000,
    matchConfidence: 'high',
    trend: null,
    ...overrides,
  };
}

let results: HTMLElement;

/** Appends a result row and records its resolved rating in one step. */
function addRow(courseId: string, state: BadgeState): HTMLElement {
  const row = document.createElement('div');
  row.className = 'class-accordion';
  const instructor = document.createElement('div');
  instructor.className = 'instructor';
  row.append(instructor);
  results.append(row);

  const section: ScannedClassSection = {
    courseId,
    professorName: state.status === 'ready' ? state.rating.displayName : 'Unknown',
    rowElement: row,
    instructorElement: instructor,
  };
  recordSection(section, state);
  return row;
}

function ready(overrides: Partial<ProfessorRating>): BadgeState {
  return { status: 'ready', rating: rating(overrides) };
}

function isBest(row: HTMLElement): boolean {
  return row.getAttribute(VERDCT_BEST_ATTRIBUTE) === 'true';
}

describe('best section highlighting', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<div id="class-results"></div>';
    results = document.querySelector<HTMLElement>('#class-results')!;
    resetBestSectionsForTests();
  });

  it('highlights only the top-rated section of a course', () => {
    const best = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.6 }));
    const middle = addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.5 }));
    const worst = addRow('MAT 243', ready({ normalizedName: 'c', overallRating: 2.1 }));

    evaluateBestSections();

    expect(isBest(best)).toBe(true);
    expect(isBest(middle)).toBe(false);
    expect(isBest(worst)).toBe(false);
  });

  it('highlights every section taught by the top professor', () => {
    const first = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.6 }));
    const second = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.6 }));
    const other = addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.0 }));

    evaluateBestSections();

    expect(isBest(first)).toBe(true);
    expect(isBest(second)).toBe(true);
    expect(isBest(other)).toBe(false);
  });

  it('stays silent when the course offers only one rated professor', () => {
    const only = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.6 }));
    const second = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.6 }));

    evaluateBestSections();

    // One professor across two sections is not a choice between professors.
    expect(isBest(only)).toBe(false);
    expect(isBest(second)).toBe(false);
  });

  it('never lets a thinly-rated professor win', () => {
    const thin = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.9, numRatings: 3 }));
    const solid = addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 4.2, numRatings: 200 }));
    const third = addRow('MAT 243', ready({ normalizedName: 'c', overallRating: 3.1 }));

    evaluateBestSections();

    expect(isBest(thin)).toBe(false);
    expect(isBest(solid)).toBe(true);
    expect(isBest(third)).toBe(false);
  });

  it('never lets an approximate name match win', () => {
    const guessed = addRow(
      'MAT 243',
      ready({ normalizedName: 'a', overallRating: 4.9, matchConfidence: 'low' }),
    );
    const certain = addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 4.0 }));
    const third = addRow('MAT 243', ready({ normalizedName: 'c', overallRating: 3.2 }));

    evaluateBestSections();

    expect(isBest(guessed)).toBe(false);
    expect(isBest(certain)).toBe(true);
  });

  it('scores each course separately', () => {
    const mat = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 3.2 }));
    addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.0 }));
    const cse = addRow('CSE 110', ready({ normalizedName: 'c', overallRating: 4.8 }));
    addRow('CSE 110', ready({ normalizedName: 'd', overallRating: 4.1 }));

    evaluateBestSections();

    // A 3.2 wins its own course even though another course rates higher.
    expect(isBest(mat)).toBe(true);
    expect(isBest(cse)).toBe(true);
  });

  it('moves the highlight when a better section loads later', () => {
    const early = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.0 }));
    addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.0 }));
    evaluateBestSections();
    expect(isBest(early)).toBe(true);

    const late = addRow('MAT 243', ready({ normalizedName: 'c', overallRating: 4.7 }));
    evaluateBestSections();

    expect(isBest(early)).toBe(false);
    expect(isBest(late)).toBe(true);
  });

  it('ignores unrated and failed rows', () => {
    const unmatched = addRow(
      'MAT 243',
      ready({ normalizedName: 'a', overallRating: null, numRatings: 0, matchConfidence: 'none' }),
    );
    const failed = addRow('MAT 243', { status: 'error', message: 'failed' });
    const loading = addRow('MAT 243', { status: 'loading' });
    const rated = addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.9 }));
    const alsoRated = addRow('MAT 243', ready({ normalizedName: 'c', overallRating: 3.1 }));

    evaluateBestSections();

    expect(isBest(unmatched)).toBe(false);
    expect(isBest(failed)).toBe(false);
    expect(isBest(loading)).toBe(false);
    expect(isBest(rated)).toBe(true);
    expect(isBest(alsoRated)).toBe(false);
  });

  it('drops rows ASU has detached from the page', () => {
    const removed = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.8 }));
    const remaining = addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 4.0 }));
    const third = addRow('MAT 243', ready({ normalizedName: 'c', overallRating: 3.0 }));
    evaluateBestSections();
    expect(isBest(removed)).toBe(true);

    removed.remove();
    evaluateBestSections();

    expect(isBest(remaining)).toBe(true);
    expect(isBest(third)).toBe(false);
  });

  it('labels the winning row so the highlight explains itself', () => {
    const best = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.6 }));
    const other = addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.0 }));

    evaluateBestSections();

    const chip = best.querySelector(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`);
    expect(chip).not.toBeNull();
    expect(chip!.shadowRoot!.textContent).toContain('Best rated');
    expect(other.querySelector(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`)).toBeNull();
  });

  it('moves the label when the winner changes', () => {
    const early = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.0 }));
    addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.0 }));
    evaluateBestSections();
    expect(early.querySelector(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`)).not.toBeNull();

    const late = addRow('MAT 243', ready({ normalizedName: 'c', overallRating: 4.7 }));
    evaluateBestSections();

    expect(early.querySelector(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`)).toBeNull();
    expect(late.querySelector(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`)).not.toBeNull();
  });

  it('never adds the label twice on repeated evaluation', () => {
    const best = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.6 }));
    addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.0 }));

    evaluateBestSections();
    evaluateBestSections();
    evaluateBestSections();

    expect(best.querySelectorAll(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`)).toHaveLength(1);
  });

  it('is ignored by the mutation filter, so rendering it cannot retrigger a scan', () => {
    const best = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.6 }));
    addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.0 }));
    evaluateBestSections();

    const chip = best.querySelector<HTMLElement>(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`)!;
    expect(isVerdctNode(chip)).toBe(true);
  });

  it('injects its stylesheet exactly once', () => {
    addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.6 }));
    addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.0 }));

    evaluateBestSections();
    evaluateBestSections();

    expect(document.head.querySelectorAll(`style[${VERDCT_BEST_ATTRIBUTE}]`)).toHaveLength(1);
  });

  describe('isEligibleToWin', () => {
    it.each([
      ['a solid high-confidence rating', { }, true],
      ['too few ratings', { numRatings: 4 }, false],
      ['an approximate name match', { matchConfidence: 'low' as const }, false],
      ['no match at all', { matchConfidence: 'none' as const, overallRating: null }, false],
      ['a listing with no score', { overallRating: null }, false],
    ])('rejects or accepts %s', (_label, overrides, expected) => {
      expect(isEligibleToWin(rating(overrides))).toBe(expected);
    });
  });
});
