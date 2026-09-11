// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { scanClassSections, scanRows } from './domScanner';

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

  it('ignores a Staff row carrying the screen-reader label ASU prints', () => {
    // The live cell reads "Instructor: Staff"; taking that literally spends a
    // RateMyProfessor lookup on a professor who does not exist.
    document.querySelector('#class-results')!.innerHTML = resultRow({
      instructors: '<span class="sr-only">Instructor: </span>Staff',
    });

    expect(scanClassSections()).toEqual([]);
  });

  it('ignores a section whose instructor is chosen at enrollment', () => {
    document.querySelector('#class-results')!.innerHTML = resultRow({
      instructors: '<span class="sr-only">Instructor: </span>Select instructor during enrollment',
    });

    expect(scanClassSections()).toEqual([]);
  });

  it('ignores malformed rows instead of throwing', () => {
    document.querySelector('#class-results')!.innerHTML = `
      ${resultRow({ course: 'Not a course' })}
      <div class="class-accordion"><div class="class-results-cell course">CSE 110</div></div>
    `;

    expect(scanClassSections()).toEqual([]);
  });
});

/**
 * Reproduces ASU's real result markup, screen-reader labels and all, captured
 * from a live Fall 2026 MAT 243 search. The cells are only ever parsed from the
 * rendered page, so a fixture that skipped the labels would prove nothing.
 */
function detailRow({
  classNumber = '60678',
  days = '<p class="mb-1 text-nowrap"><span class="sr-only">Days: </span>M W</p>',
  start = '<p class="mb-1 text-nowrap"><span class="sr-only">Start time: </span>3:00 PM</p>',
  end = '<p class="mb-1 text-nowrap"><span class="sr-only">End time: </span>4:15 PM</p>',
  dates = '<p class="mb-1 text-nowrap"><span class="sr-only">Session dates: </span>8/20 - 12/4 (C)</p>',
  units = '<span><span class="sr-only">3 units: </span>3</span>',
  seats = '<div class="text-nowrap"><span class="sr-only">Open seats: </span>8 of 60<span class="d-lg-none">&nbsp;open seats</span></div>',
  syllabus = true,
}: {
  classNumber?: string;
  days?: string;
  start?: string;
  end?: string;
  dates?: string;
  units?: string;
  seats?: string;
  syllabus?: boolean;
} = {}): string {
  const syllabusLink = syllabus
    ? `<a href="https://syllabus.apps.asu.edu/syllabus/2267/${classNumber}">Syllabus</a>`
    : '';

  return `
    <div class="focus class-accordion odd">
      <div class="class-results-cell course text-nowrap d-none d-lg-inline">
        <span class="bold-hyperlink"><span class="sr-only">Course: </span>MAT 243</span>
      </div>
      <div class="class-results-cell title d-none d-lg-inline">
        <span class="bold-hyperlink"><span class="sr-only">Course title: </span>Discrete Mathematical Structures</span>
      </div>
      <div class="class-results-cell number" id="detailsOpen=${classNumber}-107272">
        <div><span class="sr-only">Class number: </span>${classNumber}</div>
        ${syllabusLink}
      </div>
      <div class="class-results-cell instructor" id="relatedClassesOpen=${classNumber}-107272">
        <span><span class="sr-only">Instructor: </span>
          <a href="https://search.asu.edu/profile/hmohacsy">Hedvig Mohacsy</a>
        </span>
      </div>
      <div class="class-results-cell pull-left days ">${days}</div>
      <div class="class-results-cell pull-left start ">${start}</div>
      <div class="class-results-cell end ">${end}</div>
      <div class="class-results-cell text-nowrap location ">
        <p class="mb-0"><span class="sr-only">Location: </span>
          <a href="http://www.asu.edu/map/interactive/?psCode=COOR">Tempe - COORL1-10</a>
        </p>
      </div>
      <div class="class-results-cell d-none d-lg-block dates">${dates}</div>
      <div class="class-results-cell d-none d-lg-block units">${units}</div>
      <div class="class-results-cell seats">${seats}</div>
    </div>
  `;
}

function detailsOf(markup: string) {
  document.querySelector('#class-results')!.innerHTML = markup;
  return scanRows()[0].details!;
}

describe('section details', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="class-results"></div>';
  });

  it('reads everything one row says about its section', () => {
    expect(detailsOf(detailRow())).toEqual({
      classNumber: '60678',
      termHint: '2267',
      courseId: 'MAT 243',
      courseTitle: 'Discrete Mathematical Structures',
      instructors: ['Hedvig Mohacsy'],
      meetings: [{ days: ['Mon', 'Wed'], startMinutes: 900, endMinutes: 975 }],
      location: 'Tempe - COORL1-10',
      dates: { start: '8/20', end: '12/4', sessionCode: 'C' },
      units: 3,
      unitsMax: null,
      seatsOpen: 8,
      seatsTotal: 60,
    });
  });

  it('takes the class number from the cell id rather than its text', () => {
    // The cell text also carries the "Syllabus" link on sections that have one.
    expect(detailsOf(detailRow({ classNumber: '62125' })).classNumber).toBe('62125');
  });

  it('still finds the class number when the syllabus link is missing', () => {
    const details = detailsOf(detailRow({ syllabus: false }));
    expect(details.classNumber).toBe('60678');
    expect(details.termHint).toBeNull();
  });

  it('reads an online section as having no meeting time', () => {
    const details = detailsOf(
      detailRow({
        days: '<p class="mb-1">&nbsp;</p>',
        start: '<p class="mb-1">&nbsp;</p>',
        end: '<p class="mb-1">&nbsp;</p>',
      }),
    );

    expect(details.meetings).toEqual([]);
  });

  it('keeps several meeting patterns aligned across the three cells', () => {
    const details = detailsOf(
      detailRow({
        days:
          '<p><span class="sr-only">Days: </span>M W</p>' +
          '<p><span class="sr-only">Days: </span>F</p>',
        start:
          '<p><span class="sr-only">Start time: </span>9:00 AM</p>' +
          '<p><span class="sr-only">Start time: </span>1:30 PM</p>',
        end:
          '<p><span class="sr-only">End time: </span>9:50 AM</p>' +
          '<p><span class="sr-only">End time: </span>3:20 PM</p>',
      }),
    );

    expect(details.meetings).toEqual([
      { days: ['Mon', 'Wed'], startMinutes: 540, endMinutes: 590 },
      { days: ['Fri'], startMinutes: 810, endMinutes: 920 },
    ]);
  });

  it('drops one unreadable meeting without shifting the others', () => {
    const details = detailsOf(
      detailRow({
        days:
          '<p><span class="sr-only">Days: </span>M</p>' +
          '<p><span class="sr-only">Days: </span>F</p>',
        start: '<p>&nbsp;</p><p><span class="sr-only">Start time: </span>1:30 PM</p>',
        end: '<p>&nbsp;</p><p><span class="sr-only">End time: </span>3:20 PM</p>',
      }),
    );

    expect(details.meetings).toEqual([{ days: ['Fri'], startMinutes: 810, endMinutes: 920 }]);
  });

  it('reads a variable-unit section as a range', () => {
    const details = detailsOf(
      detailRow({
        units:
          '<span><span class="sr-only">1 to 3 units: </span>1</span><span>&nbsp;-&nbsp;3</span>',
      }),
    );

    expect(details).toMatchObject({ units: 1, unitsMax: 3 });
  });

  it('reads a full section as having no open seats', () => {
    const details = detailsOf(
      detailRow({ seats: '<div><span class="sr-only">Open seats: </span>0 of 60</div>' }),
    );

    expect(details).toMatchObject({ seatsOpen: 0, seatsTotal: 60 });
  });

  it('leaves unreadable cells null rather than guessing', () => {
    const details = detailsOf(detailRow({ dates: '', units: '', seats: '<div>Reserved</div>' }));

    expect(details).toMatchObject({
      dates: null,
      units: null,
      unitsMax: null,
      seatsOpen: null,
      seatsTotal: null,
    });
  });

  it('gives every professor in a row the same section', () => {
    document.querySelector('#class-results')!.innerHTML = detailRow().replace(
      '<a href="https://search.asu.edu/profile/hmohacsy">Hedvig Mohacsy</a>',
      '<a href="https://search.asu.edu/profile/one">Ada Lovelace</a>' +
        '<a href="https://search.asu.edu/profile/two">Grace Hopper</a>',
    );

    const sections = scanClassSections();
    expect(sections).toHaveLength(2);
    expect(sections[0].details).toBe(sections[1].details);
    expect(sections[0].details!.instructors).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('keeps a Staff row as a section even though it gets no badge', () => {
    document.querySelector('#class-results')!.innerHTML = detailRow().replace(
      '<a href="https://search.asu.edu/profile/hmohacsy">Hedvig Mohacsy</a>',
      'Staff',
    );

    const [row] = scanRows();
    expect(row.sections).toEqual([]);
    expect(row.details).toMatchObject({ classNumber: '60678', instructors: [] });
  });

  it('reports no details for a row with no class number', () => {
    document.querySelector('#class-results')!.innerHTML = `
      <div class="class-accordion">
        <div class="class-results-cell course"><span class="bold-hyperlink">MAT 243</span></div>
        <div class="class-results-cell instructor">
          <a href="https://search.asu.edu/profile/x">Ada Lovelace</a>
        </div>
      </div>
    `;

    expect(scanRows()[0].details).toBeNull();
  });
});
