// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import type { ProfessorRating } from '../shared/types';
import type { BadgeState } from './badgeRenderer';
import { isVerdctNode } from './badgeRenderer';
import { VERDCT_TOOLTIP_ATTRIBUTE } from '../shared/constants';
import {
  VERDCT_BEST_ATTRIBUTE,
  VERDCT_BEST_CHIP_ATTRIBUTE,
  awardExplanation,
  difficultyAdjustedScore,
  evaluateBestSections,
  isEligibleForOverall,
  isEligibleForRated,
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
    legacyId: 477524,
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

function awardsOn(row: HTMLElement): string[] {
  return [...row.querySelectorAll(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`)].map(
    (chip) => chip.getAttribute(VERDCT_BEST_CHIP_ATTRIBUTE) ?? '',
  );
}

function isBest(row: HTMLElement): boolean {
  return row.hasAttribute(VERDCT_BEST_ATTRIBUTE);
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

  it('awards on score alone, whatever the review count', () => {
    const thin = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.9, numRatings: 3 }));
    const solid = addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 4.2, numRatings: 200 }));
    addRow('MAT 243', ready({ normalizedName: 'c', overallRating: 3.1 }));

    evaluateBestSections();

    // No floor on either award; the grey badge carries the caution instead.
    expect(awardsOn(thin).sort()).toEqual(['overall', 'rated']);
    expect(awardsOn(solid)).toEqual([]);
  });

  function hoverChip(row: HTMLElement, kind: string): HTMLElement {
    const chip = row
      .querySelector(`[${VERDCT_BEST_CHIP_ATTRIBUTE}="${kind}"]`)!
      .shadowRoot!.querySelector<HTMLElement>('span.chip')!;
    chip.dispatchEvent(new MouseEvent('mouseenter'));
    return chip;
  }

  function tooltipPanel(): HTMLElement {
    return document
      .querySelector(`[${VERDCT_TOOLTIP_ATTRIBUTE}]`)!
      .shadowRoot!.querySelector<HTMLElement>('.tip')!;
  }

  it('shows a real tooltip on hover, not a title that never appears', () => {
    const thin = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.9, numRatings: 3 }));
    addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 4.2, numRatings: 200 }));
    evaluateBestSections();

    const chip = hoverChip(thin, 'rated');
    // A native title inside a shadow root was the thing that never showed.
    expect(chip.hasAttribute('title')).toBe(false);

    const tip = tooltipPanel();
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toMatch(/only 3 ratings/i);

    chip.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip.hidden).toBe(true);
  });

  it('leaves the thin-sample caveat off a well-reviewed winner', () => {
    const solid = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.9, numRatings: 90 }));
    addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 4.2, numRatings: 200 }));
    evaluateBestSections();

    hoverChip(solid, 'rated');

    expect(tooltipPanel().textContent).not.toMatch(/only \d+ rating/i);
  });

  it('does not put a help cursor on something with no native tooltip', () => {
    const best = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.6 }));
    addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.0 }));
    evaluateBestSections();

    const style = best.querySelector(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`)!.shadowRoot!
      .querySelector('style')!.textContent!;
    expect(style).not.toMatch(/cursor:\s*help/);
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
    expect(chip!.shadowRoot!.textContent).toContain('Best');
    expect(other.querySelector(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`)).toBeNull();
  });

  it('separates the two awards when the top-rated professor is also the hardest', () => {
    // 4.8 but punishing; 4.4 at average difficulty is the better balance.
    const harsh = addRow(
      'MAT 243',
      ready({ normalizedName: 'a', overallRating: 4.8, difficulty: 4.8 }),
    );
    const balanced = addRow(
      'MAT 243',
      ready({ normalizedName: 'b', overallRating: 4.4, difficulty: 2.4 }),
    );
    addRow('MAT 243', ready({ normalizedName: 'c', overallRating: 3.0, difficulty: 3.0 }));

    evaluateBestSections();

    expect(awardsOn(harsh)).toEqual(['rated']);
    expect(awardsOn(balanced)).toEqual(['overall']);
  });

  it('gives one row both awards when it leads on rating and balance', () => {
    const clear = addRow(
      'MAT 243',
      ready({ normalizedName: 'a', overallRating: 4.8, difficulty: 2.0 }),
    );
    addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.2, difficulty: 4.0 }));

    evaluateBestSections();

    expect(awardsOn(clear).sort()).toEqual(['overall', 'rated']);
  });

  it('splits the awards on the reported real-world case', () => {
    // A 4.7 from 3 students against a 4.4 from 5: the first is genuinely the
    // highest, the second is the safer recommendation.
    const thin = addRow(
      'MAT 243',
      ready({ normalizedName: 'a', overallRating: 4.7, difficulty: 3.7, numRatings: 3 }),
    );
    const supported = addRow(
      'MAT 243',
      ready({ normalizedName: 'b', overallRating: 4.4, difficulty: 2.6, numRatings: 5 }),
    );
    addRow('MAT 243', ready({ normalizedName: 'c', overallRating: 3.1, numRatings: 40 }));

    evaluateBestSections();

    expect(awardsOn(thin)).toEqual(['rated']);
    expect(awardsOn(supported)).toEqual(['overall']);
  });

  it('claims no eligibility bar, because there is none', () => {
    expect(awardExplanation('rated', 'MAT 243')).not.toMatch(/at least \d+ ratings/i);
    expect(awardExplanation('overall', 'MAT 243')).not.toMatch(/at least \d+ ratings/i);
  });

  it('adds the thin-sample caveat to either award', () => {
    expect(awardExplanation('rated', 'MAT 243', 3)).toMatch(/only 3 ratings/i);
    expect(awardExplanation('overall', 'MAT 243', 3)).toMatch(/only 3 ratings/i);
  });

  it('explains each award in terms a reader can check', () => {
    const best = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.6 }));
    addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.0 }));
    evaluateBestSections();

    const chip = best.querySelector(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`)!;
    const inner = chip.shadowRoot!.querySelector('span.chip')!;
    // "Best" on its own invites the reading that it accounts for everything.
    expect(inner.getAttribute('aria-label')).toContain('MAT 243');
  });

  it('still awards best rated when difficulty is unknown', () => {
    const rated = addRow(
      'MAT 243',
      ready({ normalizedName: 'a', overallRating: 4.6, difficulty: null }),
    );
    const other = addRow(
      'MAT 243',
      ready({ normalizedName: 'b', overallRating: 3.0, difficulty: 3.0 }),
    );

    evaluateBestSections();

    // No difficulty means no balance score, so it cannot claim best overall.
    expect(awardsOn(rated)).toEqual(['rated']);
    expect(awardsOn(other)).toEqual(['overall']);
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

  it('never duplicates a label on repeated evaluation', () => {
    const best = addRow('MAT 243', ready({ normalizedName: 'a', overallRating: 4.6 }));
    addRow('MAT 243', ready({ normalizedName: 'b', overallRating: 3.0 }));

    evaluateBestSections();
    const first = awardsOn(best);
    evaluateBestSections();
    evaluateBestSections();

    // A row can hold both awards; what it must never do is grow copies.
    expect(awardsOn(best)).toEqual(first);
    expect(new Set(awardsOn(best)).size).toBe(awardsOn(best).length);
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

  describe('difficultyAdjustedScore', () => {
    it('leaves a rating alone at midpoint difficulty', () => {
      expect(difficultyAdjustedScore(rating({ overallRating: 4, difficulty: 3 }))).toBe(4);
    });

    it('discounts a harder course and credits an easier one', () => {
      const hard = difficultyAdjustedScore(rating({ overallRating: 4, difficulty: 5 }))!;
      const easy = difficultyAdjustedScore(rating({ overallRating: 4, difficulty: 1 }))!;

      expect(hard).toBeLessThan(4);
      expect(easy).toBeGreaterThan(4);
      // Symmetric around the midpoint.
      expect(4 - hard).toBeCloseTo(easy - 4, 5);
    });

    it('is null when difficulty is unknown', () => {
      expect(difficultyAdjustedScore(rating({ difficulty: null }))).toBeNull();
    });

    it('does not let easiness overturn a large rating gap', () => {
      const great = difficultyAdjustedScore(rating({ overallRating: 4.6, difficulty: 4 }))!;
      const easy = difficultyAdjustedScore(rating({ overallRating: 3.2, difficulty: 1 }))!;

      expect(great).toBeGreaterThan(easy);
    });
  });

  describe('awardExplanation', () => {
    it('says plainly that the rating award ignores difficulty', () => {
      expect(awardExplanation('rated', 'MAT 243')).toMatch(/does not account/i);
    });

    it('describes the overall award as a balance', () => {
      expect(awardExplanation('overall', 'MAT 243')).toMatch(/balance/i);
    });
  });

  describe('eligibility', () => {
    it.each([
      ['a solid high-confidence rating', {}, true],
      ['very few ratings', { numRatings: 2 }, true],
      ['an approximate name match', { matchConfidence: 'low' as const }, false],
      ['no match at all', { matchConfidence: 'none' as const, overallRating: null }, false],
      ['a listing with no score', { overallRating: null }, false],
    ])('best rated: %s', (_label, overrides, expected) => {
      expect(isEligibleForRated(rating(overrides))).toBe(expected);
    });

    it.each([
      ['a solid high-confidence rating', {}, true],
      ['very few ratings', { numRatings: 2 }, true],
      ['no difficulty to balance against', { difficulty: null }, false],
      ['an approximate name match', { matchConfidence: 'low' as const }, false],
    ])('best overall: %s', (_label, overrides, expected) => {
      expect(isEligibleForOverall(rating(overrides))).toBe(expected);
    });

    it('never lets a guessed name carry either award', () => {
      const guessed = rating({ matchConfidence: 'low', overallRating: 5 });
      expect(isEligibleForRated(guessed)).toBe(false);
      expect(isEligibleForOverall(guessed)).toBe(false);
    });
  });
});
