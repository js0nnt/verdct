// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { VERDCT_SCATTER_ATTRIBUTE } from '../shared/constants';
import type { ProfessorRating } from '../shared/types';
import { isVerdctNode } from './badgeRenderer';
import { recordScatterPoint, refreshScatter, resetScatterForTests } from './scatterWidget';

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
    ...overrides,
  };
}

function shadow(): ShadowRoot | null {
  return document.querySelector(`[${VERDCT_SCATTER_ATTRIBUTE}]`)?.shadowRoot ?? null;
}

function launcher(): HTMLButtonElement | null {
  return shadow()?.querySelector('.launcher') ?? null;
}

function addPoints(courseId: string, count: number, base: Partial<ProfessorRating> = {}): void {
  for (let index = 0; index < count; index += 1) {
    recordScatterPoint(
      courseId,
      rating({ normalizedName: `prof ${courseId} ${index}`, displayName: `Prof ${index}`, ...base }),
    );
  }
}

describe('scatter widget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetScatterForTests();
  });

  it('stays out of the way until a course has enough rated professors', () => {
    addPoints('MAT 243', 2);
    refreshScatter();

    // Two points is a comparison the badges already make; a chart adds nothing.
    expect(launcher()?.hidden).toBe(true);
  });

  it('offers the comparison once three professors are rated', () => {
    addPoints('MAT 243', 3);
    refreshScatter();

    expect(launcher()?.hidden).toBe(false);
    expect(launcher()?.textContent).toContain('Compare 3 professors');
  });

  it('ignores professors with no usable position', () => {
    addPoints('MAT 243', 3);
    recordScatterPoint('MAT 243', rating({ normalizedName: 'x', overallRating: null }));
    recordScatterPoint('MAT 243', rating({ normalizedName: 'y', difficulty: null }));
    recordScatterPoint('MAT 243', rating({ normalizedName: 'z', numRatings: 0 }));
    refreshScatter();

    expect(launcher()?.textContent).toContain('Compare 3 professors');
  });

  it('counts a professor once no matter how many sections they teach', () => {
    addPoints('MAT 243', 3);
    recordScatterPoint('MAT 243', rating({ normalizedName: 'prof MAT 243 0' }));
    recordScatterPoint('MAT 243', rating({ normalizedName: 'prof MAT 243 0' }));
    refreshScatter();

    expect(launcher()?.textContent).toContain('Compare 3 professors');
  });

  it('plots one dot and one accessible title per professor when opened', () => {
    addPoints('MAT 243', 4);
    refreshScatter();
    launcher()!.click();

    const panel = shadow()!.querySelector('.panel')!;
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(panel.querySelectorAll('circle.point')).toHaveLength(4);
    expect(panel.querySelectorAll('circle.point title')).toHaveLength(4);
    expect(panel.querySelector('.title')!.textContent).toContain('MAT 243');
  });

  it('hides the launcher while the panel is open and restores it on close', () => {
    addPoints('MAT 243', 3);
    refreshScatter();
    launcher()!.click();
    expect(launcher()!.hidden).toBe(true);

    shadow()!.querySelector<HTMLButtonElement>('.close')!.click();

    expect(launcher()!.hidden).toBe(false);
    expect(shadow()!.querySelector('.panel')!.hasAttribute('hidden')).toBe(true);
  });

  it('offers course pills only when more than one course qualifies', () => {
    addPoints('MAT 243', 3);
    refreshScatter();
    launcher()!.click();
    expect(shadow()!.querySelectorAll('.course')).toHaveLength(0);

    addPoints('CSE 110', 3);
    refreshScatter();

    const pills = shadow()!.querySelectorAll('.course');
    expect(pills).toHaveLength(2);
    expect([...pills].map((pill) => pill.textContent)).toEqual(['CSE 110', 'MAT 243']);
  });

  it('switches the plotted course when a pill is chosen', () => {
    addPoints('MAT 243', 3);
    addPoints('CSE 110', 5);
    refreshScatter();
    launcher()!.click();

    const matPill = [...shadow()!.querySelectorAll<HTMLButtonElement>('.course')].find(
      (pill) => pill.textContent === 'MAT 243',
    )!;
    matPill.click();

    expect(shadow()!.querySelector('.title')!.textContent).toContain('MAT 243');
    expect(shadow()!.querySelectorAll('circle.point')).toHaveLength(3);
  });

  it('labels every point when none of them collide', () => {
    // Spread across the plot so the collision avoidance never has to drop one.
    const spread = [
      { overallRating: 1.5, difficulty: 1.5 },
      { overallRating: 3, difficulty: 3 },
      { overallRating: 4.8, difficulty: 4.8 },
    ];
    spread.forEach((position, index) => {
      recordScatterPoint(
        'MAT 243',
        rating({ normalizedName: `p${index}`, displayName: `First Last${index}`, ...position }),
      );
    });
    refreshScatter();
    launcher()!.click();

    expect(shadow()!.querySelectorAll('text.label')).toHaveLength(3);
  });

  it('is ignored by the mutation filter, so rendering cannot retrigger a scan', () => {
    addPoints('MAT 243', 3);
    refreshScatter();

    expect(isVerdctNode(document.querySelector(`[${VERDCT_SCATTER_ATTRIBUTE}]`)!)).toBe(true);
  });
});
