// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../shared/settings';
import type { ProfessorRating } from '../shared/types';
import {
  VERDCT_BADGE_ATTRIBUTE,
  configureBadges,
  isVerdctNode,
  ratingTone,
  resetBadgeRendererForTests,
  upsertBadge,
} from './badgeRenderer';
import type { ScannedClassSection } from './domScanner';

function rating(overrides: Partial<ProfessorRating> = {}): ProfessorRating {
  return {
    normalizedName: 'ada lovelace',
    displayName: 'Ada Lovelace',
    overallRating: 4.5,
    difficulty: 2.1,
    wouldTakeAgainPct: 92,
    numRatings: 31,
    fetchedAt: 1_000,
    matchConfidence: 'high',
    trend: null,
    legacyId: 477524,
    ...overrides,
  };
}

function buildSection(professorName = 'Ada Lovelace'): ScannedClassSection {
  document.body.innerHTML = `
    <div class="class-accordion">
      <div class="class-results-cell instructor">
        <a href="https://search.asu.edu/profile/1">Ada Lovelace</a>
        <a href="https://search.asu.edu/profile/2">Grace Hopper</a>
      </div>
    </div>
  `;
  const rowElement = document.querySelector<HTMLElement>('.class-accordion')!;
  const instructorElement = document.querySelector<HTMLElement>('.instructor')!;
  return { courseId: 'MAT 243', professorName, rowElement, instructorElement };
}

function badgeButton(section: ScannedClassSection, professorName: string): HTMLAnchorElement {
  const hosts = section.instructorElement.querySelectorAll<HTMLElement>(
    `[${VERDCT_BADGE_ATTRIBUTE}]`,
  );
  const host = [...hosts].find(
    (candidate) => candidate.getAttribute(VERDCT_BADGE_ATTRIBUTE) === professorName,
  )!;
  return host.shadowRoot!.querySelector('a')!;
}

describe('badge renderer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetBadgeRendererForTests();
  });

  it('inserts the badge directly after the matching instructor link', () => {
    const section = buildSection();
    upsertBadge(section, { status: 'ready', rating: rating() });

    const link = section.instructorElement.querySelector('a')!;
    const badge = link.nextElementSibling!;

    expect(badge.getAttribute(VERDCT_BADGE_ATTRIBUTE)).toBe('Ada Lovelace');
    expect(badgeButton(section, 'Ada Lovelace').textContent).toBe('4.5');
  });

  it('keeps each professor in a shared cell on its own badge', () => {
    const section = buildSection();
    upsertBadge(section, { status: 'ready', rating: rating() });
    upsertBadge(
      { ...section, professorName: 'Grace Hopper' },
      { status: 'ready', rating: rating({ displayName: 'Grace Hopper', overallRating: 2.0 }) },
    );

    expect(
      section.instructorElement.querySelectorAll(`[${VERDCT_BADGE_ATTRIBUTE}]`),
    ).toHaveLength(2);
    expect(badgeButton(section, 'Grace Hopper').className).toBe('poor');
  });

  it('updates in place instead of appending a second badge', () => {
    const section = buildSection();
    upsertBadge(section, { status: 'loading' });
    upsertBadge(section, { status: 'ready', rating: rating() });

    expect(
      section.instructorElement.querySelectorAll(`[${VERDCT_BADGE_ATTRIBUTE}]`),
    ).toHaveLength(1);
    expect(badgeButton(section, 'Ada Lovelace').className).toBe('good');
  });

  it('renders a neutral badge when no confident match was found', () => {
    const section = buildSection();
    upsertBadge(section, {
      status: 'ready',
      rating: rating({ matchConfidence: 'none', overallRating: null, numRatings: 0 }),
    });

    const button = badgeButton(section, 'Ada Lovelace');
    expect(button.className).toBe('unknown');
    expect(button.textContent).toBe('—');
  });

  it('renders a neutral badge when the lookup errored', () => {
    const section = buildSection();
    upsertBadge(section, { status: 'error', message: 'Rating lookup failed.' });

    expect(badgeButton(section, 'Ada Lovelace').className).toBe('unknown');
  });

  it('marks low-confidence matches', () => {
    const section = buildSection();
    upsertBadge(section, { status: 'ready', rating: rating({ matchConfidence: 'low' }) });

    expect(badgeButton(section, 'Ada Lovelace').textContent).toBe('4.5?');
  });

  it('appends to the cell when the instructor is not a link', () => {
    document.body.innerHTML = `
      <div class="class-accordion"><div class="class-results-cell instructor">Ada Lovelace</div></div>
    `;
    const instructorElement = document.querySelector<HTMLElement>('.instructor')!;
    const section: ScannedClassSection = {
      courseId: 'MAT 243',
      professorName: 'Ada Lovelace',
      rowElement: document.querySelector<HTMLElement>('.class-accordion')!,
      instructorElement,
    };

    upsertBadge(section, { status: 'ready', rating: rating() });

    expect(instructorElement.lastElementChild!.getAttribute(VERDCT_BADGE_ATTRIBUTE)).toBe(
      'Ada Lovelace',
    );
  });

  it('replaces an orphaned badge left behind by a row re-render', () => {
    const section = buildSection();
    const orphan = document.createElement('span');
    orphan.setAttribute(VERDCT_BADGE_ATTRIBUTE, 'Ada Lovelace');
    section.instructorElement.append(orphan);

    upsertBadge(section, { status: 'ready', rating: rating() });

    const hosts = section.instructorElement.querySelectorAll(`[${VERDCT_BADGE_ATTRIBUTE}]`);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].shadowRoot).not.toBeNull();
  });

  it('marks a badge provisional when it rests on very few ratings', () => {
    const section = buildSection();
    upsertBadge(section, {
      status: 'ready',
      rating: rating({ overallRating: 4.7, numRatings: 3 }),
    });

    const button = badgeButton(section, 'Ada Lovelace');
    // Grey rather than green: three students have not earned the same colour
    // as a hundred, and the grey is what replaced the old eligibility floor.
    expect(button.className).toBe('unknown');
    expect(button.dataset.sample).toBe('low');
    expect(button.getAttribute('aria-label')).toContain('provisional');
  });

  it('shows the review count inline when the sample is thin', () => {
    const section = buildSection();
    upsertBadge(section, { status: 'ready', rating: rating({ overallRating: 4.7, numRatings: 3 }) });

    // The number alone made a 4.7 look like a peer of a well-reviewed 4.4.
    expect(badgeButton(section, 'Ada Lovelace').textContent).toBe('4.7(3)');
    expect(badgeButton(section, 'Ada Lovelace').getAttribute('aria-label')).toContain(
      'provisional',
    );
  });

  it('leaves the count off a well-sampled badge', () => {
    const section = buildSection();
    upsertBadge(section, { status: 'ready', rating: rating({ overallRating: 4.4, numRatings: 40 }) });

    expect(badgeButton(section, 'Ada Lovelace').textContent).toBe('4.4');
  });

  it('does not mark a well-sampled badge provisional', () => {
    const section = buildSection();
    upsertBadge(section, { status: 'ready', rating: rating({ numRatings: 31 }) });

    expect(badgeButton(section, 'Ada Lovelace').dataset.sample).toBeUndefined();
  });

  it('clears the provisional flag when a badge is repainted with more ratings', () => {
    const section = buildSection();
    upsertBadge(section, { status: 'ready', rating: rating({ numRatings: 2 }) });
    expect(badgeButton(section, 'Ada Lovelace').dataset.sample).toBe('low');

    upsertBadge(section, { status: 'ready', rating: rating({ numRatings: 90 }) });

    expect(badgeButton(section, 'Ada Lovelace').dataset.sample).toBeUndefined();
  });

  it('links a matched professor to their RateMyProfessor page', () => {
    const section = buildSection();
    upsertBadge(section, { status: 'ready', rating: rating({ legacyId: 477524 }) });

    const badge = badgeButton(section, 'Ada Lovelace');
    expect(badge.getAttribute('href')).toBe('https://www.ratemyprofessors.com/professor/477524');
    expect(badge.target).toBe('_blank');
    // Opening a page in the user's session must not hand it a window opener.
    expect(badge.rel).toContain('noopener');
    expect(badge.getAttribute('aria-label')).toContain('new tab');
  });

  it('does not pretend to link when there is no professor to open', () => {
    const section = buildSection();
    upsertBadge(section, {
      status: 'ready',
      rating: rating({ matchConfidence: 'none', overallRating: null, numRatings: 0, legacyId: null }),
    });

    expect(badgeButton(section, 'Ada Lovelace').hasAttribute('href')).toBe(false);
  });

  it('drops a stale link when a badge is repainted without an id', () => {
    const section = buildSection();
    upsertBadge(section, { status: 'ready', rating: rating({ legacyId: 477524 }) });
    expect(badgeButton(section, 'Ada Lovelace').hasAttribute('href')).toBe(true);

    upsertBadge(section, { status: 'error', message: 'Rating lookup failed.' });

    expect(badgeButton(section, 'Ada Lovelace').hasAttribute('href')).toBe(false);
  });

  it('stays focusable without an href so keyboard users still get the popover', () => {
    const section = buildSection();
    upsertBadge(section, { status: 'loading' });

    expect(badgeButton(section, 'Ada Lovelace').tabIndex).toBe(0);
  });

  it('repaints open badges when thresholds change', () => {
    const section = buildSection();
    upsertBadge(section, { status: 'ready', rating: rating({ overallRating: 3.8 }) });
    expect(badgeButton(section, 'Ada Lovelace').className).toBe('fair');

    configureBadges({ ...DEFAULT_SETTINGS, goodRatingThreshold: 3.5 });

    expect(badgeButton(section, 'Ada Lovelace').className).toBe('good');
  });

  describe('ratingTone', () => {
    it.each([
      [4.5, 'good'],
      [4.0, 'good'],
      [3.9, 'fair'],
      [2.5, 'fair'],
      [2.4, 'poor'],
    ])('maps %s to %s when well reviewed', (overallRating, expected) => {
      expect(ratingTone(rating({ overallRating, numRatings: 40 }), DEFAULT_SETTINGS)).toBe(expected);
    });

    it('greys out any score resting on too few reviews', () => {
      expect(ratingTone(rating({ overallRating: 4.9, numRatings: 4 }), DEFAULT_SETTINGS)).toBe(
        'unknown',
      );
      expect(ratingTone(rating({ overallRating: 4.9, numRatings: 5 }), DEFAULT_SETTINGS)).toBe(
        'good',
      );
    });

    it('treats a listing with zero ratings as unknown', () => {
      expect(ratingTone(rating({ numRatings: 0 }), DEFAULT_SETTINGS)).toBe('unknown');
    });
  });

  describe('isVerdctNode', () => {
    it('recognizes injected badges and ignores page nodes', () => {
      const section = buildSection();
      upsertBadge(section, { status: 'ready', rating: rating() });

      const host = section.instructorElement.querySelector(`[${VERDCT_BADGE_ATTRIBUTE}]`)!;
      expect(isVerdctNode(host)).toBe(true);
      expect(isVerdctNode(section.instructorElement.querySelector('a')!)).toBe(false);
      expect(isVerdctNode(section.rowElement)).toBe(false);
    });
  });
});
