// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { scanClassSections } from './domScanner';

function resultRow({
  course = 'MAT 243',
  instructors = '<a href="https://search.asu.edu/profile/example">Ileana Ionascu</a>',
}: {
  course?: string;
  instructors?: string;
} = {}): string {
  return `
    <div class="focus class-accordion even">
      <div class="class-results-cell course d-none d-lg-inline">
        <span class="bold-hyperlink">${course}</span>
      </div>
      <div class="class-results-cell course d-lg-none">
        <span class="bold-hyperlink">${course} Course title</span>
      </div>
      <div class="class-results-cell instructor">${instructors}</div>
    </div>
  `;
}

describe('scanClassSections', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="class-results"></div>';
  });

  it('extracts one professor and the normalized course identifier', () => {
    document.querySelector('#class-results')!.innerHTML = resultRow({
      course: 'mat   243',
    });

    const [section] = scanClassSections();

    expect(section.courseId).toBe('MAT 243');
    expect(section.professorName).toBe('Ileana Ionascu');
    expect(section.rowElement.classList).toContain('class-accordion');
    expect(section.instructorElement.classList).toContain('instructor');
  });

  it('returns one section per linked instructor without duplicating names', () => {
    document.querySelector('#class-results')!.innerHTML = resultRow({
      instructors: `
        <a href="https://search.asu.edu/profile/one">Ada Lovelace</a>
        <a href="https://search.asu.edu/profile/two">Grace Hopper</a>
        <a href="https://search.asu.edu/profile/one">Ada Lovelace</a>
      `,
    });

    expect(scanClassSections().map(({ professorName }) => professorName)).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
    ]);
  });

  it.each(['Staff', '<span>Staff</span>', 'TBA', 'To be announced'])(
    'ignores the placeholder instructor %s',
    (instructors) => {
      document.querySelector('#class-results')!.innerHTML = resultRow({ instructors });

      expect(scanClassSections()).toEqual([]);
    },
  );

  it('ignores malformed rows instead of throwing', () => {
    document.querySelector('#class-results')!.innerHTML = `
      ${resultRow({ course: 'Not a course' })}
      <div class="class-accordion"><div class="class-results-cell course">CSE 110</div></div>
    `;

    expect(scanClassSections()).toEqual([]);
  });
});
