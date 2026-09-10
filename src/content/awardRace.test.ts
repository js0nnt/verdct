// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProfessorRating } from '../shared/types';
import type { BadgeState } from './badgeRenderer';
import {
  VERDCT_BEST_CHIP_ATTRIBUTE, evaluateBestSections, recordSection, resetBestSectionsForTests,
} from './bestSection';
import type { ScannedClassSection } from './domScanner';

function rating(o: Partial<ProfessorRating> = {}): ProfessorRating {
  return { normalizedName: 'x', displayName: 'X', overallRating: 4, difficulty: 3,
    wouldTakeAgainPct: 70, numRatings: 40, fetchedAt: 1, matchConfidence: 'high',
    trend: null, legacyId: 1, ...o };
}
let results: HTMLElement;
function makeRow(): ScannedClassSection {
  const row = document.createElement('div');
  const cell = document.createElement('div');
  row.append(cell); results.append(row);
  return { courseId: 'MAT 343', professorName: 'p', rowElement: row, instructorElement: cell };
}
function awardsOn(s: ScannedClassSection): string[] {
  return [...s.rowElement.querySelectorAll(`[${VERDCT_BEST_CHIP_ATTRIBUTE}]`)]
    .map((c) => c.getAttribute(VERDCT_BEST_CHIP_ATTRIBUTE) ?? '').sort();
}

describe('award settling under out-of-order resolution', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="r"></div>';
    results = document.querySelector('#r')!;
    resetBestSectionsForTests();
  });

  it('ends on the true winner however the lookups interleave', () => {
    // Three sections; the strongest eligible one resolves LAST.
    const weak = makeRow(), mid = makeRow(), strong = makeRow();
    const states: Array<[ScannedClassSection, BadgeState]> = [
      [weak,   { status: 'ready', rating: rating({ normalizedName: 'a', overallRating: 3.0 }) }],
      [mid,    { status: 'ready', rating: rating({ normalizedName: 'b', overallRating: 4.0 }) }],
      [strong, { status: 'ready', rating: rating({ normalizedName: 'c', overallRating: 4.8 }) }],
    ];
    // Mimic the content script: record + evaluate after EACH lookup resolves.
    for (const [section, state] of states) {
      recordSection(section, state);
      evaluateBestSections();
    }
    expect(awardsOn(strong)).toEqual(['overall', 'rated']);
    expect(awardsOn(mid)).toEqual([]);
    expect(awardsOn(weak)).toEqual([]);
  });

  it('revokes an award already granted when a better section arrives later', () => {
    const early = makeRow(), later = makeRow();
    recordSection(early, { status: 'ready', rating: rating({ normalizedName: 'a', overallRating: 4.0 }) });
    recordSection(later, { status: 'ready', rating: rating({ normalizedName: 'b', overallRating: 3.0 }) });
    evaluateBestSections();
    expect(awardsOn(early)).toEqual(['overall', 'rated']);

    const best = makeRow();
    recordSection(best, { status: 'ready', rating: rating({ normalizedName: 'c', overallRating: 4.9 }) });
    evaluateBestSections();

    expect(awardsOn(early)).toEqual([]);
    expect(awardsOn(best)).toEqual(['overall', 'rated']);
  });

  it('does not let an ineligible high score suppress the real winner', () => {
    const thin = makeRow(), real = makeRow(), other = makeRow();
    // The 4.7 with 3 ratings resolves first, then the eligible field.
    recordSection(thin, { status: 'ready', rating: rating({ normalizedName: 'a', overallRating: 4.7, numRatings: 3 }) });
    evaluateBestSections();
    recordSection(real, { status: 'ready', rating: rating({ normalizedName: 'b', overallRating: 4.4, numRatings: 5 }) });
    evaluateBestSections();
    recordSection(other, { status: 'ready', rating: rating({ normalizedName: 'c', overallRating: 3.1 }) });
    evaluateBestSections();

    expect(awardsOn(thin)).toEqual([]);
    expect(awardsOn(real)).toEqual(['overall', 'rated']);
  });
});
