import { describe, expect, it } from 'vitest';

import { SCHEDULE_LIMIT, SCHEDULE_STORAGE_KEY } from './constants';
import {
  clearSchedule,
  conflictsWith,
  datesOverlap,
  findConflicts,
  formatClockTime,
  parseClockTime,
  parseDayTokens,
  parseSchedule,
  readSchedule,
  removeScheduledSection,
  scheduleTotals,
  sectionKey,
  termFromSearch,
  termLabel,
  toggleScheduledSection,
  type Meeting,
  type ScheduledSection,
} from './schedule';
import type { StorageAreaLike } from './storage';

function fakeArea(initial: Record<string, unknown> = {}): StorageAreaLike & {
  data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    get: async (keys) => {
      const list = keys === null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    set: async (items) => {
      Object.assign(data, items);
    },
  };
}

function meeting(days: string, start: number, end: number): Meeting {
  return { days: parseDayTokens(days), startMinutes: start, endMinutes: end };
}

function section(overrides: Partial<ScheduledSection> = {}): ScheduledSection {
  return {
    classNumber: '60678',
    term: '2267',
    courseId: 'MAT 243',
    courseTitle: 'Discrete Mathematical Structures',
    instructors: ['Hedvig Mohacsy'],
    meetings: [meeting('M W', 15 * 60, 16 * 60 + 15)],
    location: 'Tempe - COORL1-10',
    dates: { start: '8/20', end: '12/4', sessionCode: 'C' },
    units: 3,
    unitsMax: null,
    seatsOpen: 8,
    seatsTotal: 60,
    addedAt: 1,
    ...overrides,
  };
}

describe('parseClockTime', () => {
  it.each([
    ['12:00 AM', 0],
    ['9:05 AM', 545],
    ['11:45 AM', 705],
    ['12:00 PM', 720],
    ['12:30 PM', 750],
    ['3:00 PM', 900],
    ['10:15 pm', 1335],
  ])('reads %s', (input, expected) => {
    expect(parseClockTime(input)).toBe(expected);
  });

  it.each(['', ' ', '25:00 PM', 'noon', '3:75 PM', '3:00'])('rejects %s', (input) => {
    expect(parseClockTime(input)).toBeNull();
  });

  it('round-trips through formatClockTime', () => {
    for (const printed of ['12:00 AM', '9:05 AM', '12:00 PM', '3:00 PM', '11:45 PM']) {
      expect(formatClockTime(parseClockTime(printed)!)).toBe(printed);
    }
  });
});

describe('parseDayTokens', () => {
  it.each([
    ['M W', ['Mon', 'Wed']],
    ['M W F', ['Mon', 'Wed', 'Fri']],
    ['T Th', ['Tue', 'Thu']],
    ['TTh', ['Tue', 'Thu']],
    ['Sa Su', ['Sat', 'Sun']],
  ])('reads %s', (input, expected) => {
    expect(parseDayTokens(input)).toEqual(expected);
  });

  it('does not mistake Thursday for Tuesday', () => {
    expect(parseDayTokens('Th')).toEqual(['Thu']);
  });

  it('always returns days in week order and without repeats', () => {
    expect(parseDayTokens('F M M W')).toEqual(['Mon', 'Wed', 'Fri']);
  });

  it('returns nothing for the blank cell an online section prints', () => {
    expect(parseDayTokens(' ')).toEqual([]);
  });
});

describe('datesOverlap', () => {
  const full = { start: '8/20', end: '12/4', sessionCode: 'C' };
  const firstHalf = { start: '8/20', end: '10/9', sessionCode: 'A' };
  const secondHalf = { start: '10/14', end: '12/4', sessionCode: 'B' };

  it('separates the two halves of a term', () => {
    expect(datesOverlap(firstHalf, secondHalf)).toBe(false);
  });

  it('overlaps a half session with the full term', () => {
    expect(datesOverlap(firstHalf, full)).toBe(true);
    expect(datesOverlap(secondHalf, full)).toBe(true);
  });

  it('assumes an overlap when either range is missing or unreadable', () => {
    expect(datesOverlap(null, full)).toBe(true);
    expect(datesOverlap({ start: 'soon', end: 'later', sessionCode: null }, full)).toBe(true);
  });
});

describe('findConflicts', () => {
  it('reports the overlapping window and the day it falls on', () => {
    const conflicts = findConflicts([
      section(),
      section({ classNumber: '99999', courseId: 'CSE 110', meetings: [meeting('W F', 960, 1050)] }),
    ]);

    expect(conflicts).toEqual([
      { left: '60678', right: '99999', day: 'Wed', startMinutes: 960, endMinutes: 975 },
    ]);
  });

  it('does not flag classes that merely touch', () => {
    expect(
      findConflicts([
        section({ meetings: [meeting('M', 600, 660)] }),
        section({ classNumber: '2', meetings: [meeting('M', 660, 720)] }),
      ]),
    ).toEqual([]);
  });

  it('does not flag the same hour on different days', () => {
    expect(
      findConflicts([
        section({ meetings: [meeting('M W', 600, 660)] }),
        section({ classNumber: '2', meetings: [meeting('T Th', 600, 660)] }),
      ]),
    ).toEqual([]);
  });

  it('does not flag sections in different halves of the term', () => {
    expect(
      findConflicts([
        section({ dates: { start: '8/20', end: '10/9', sessionCode: 'A' } }),
        section({ classNumber: '2', dates: { start: '10/14', end: '12/4', sessionCode: 'B' } }),
      ]),
    ).toEqual([]);
  });

  it('does not flag sections in different terms', () => {
    expect(
      findConflicts([section(), section({ classNumber: '2', term: '2261' })]),
    ).toEqual([]);
  });

  it('leaves an asynchronous online section out of every clash', () => {
    expect(
      findConflicts([section(), section({ classNumber: '2', meetings: [] })]),
    ).toEqual([]);
  });

  it('reports one entry per shared day when a pair clashes twice', () => {
    const conflicts = findConflicts([
      section({ meetings: [meeting('M W', 600, 700)] }),
      section({ classNumber: '2', meetings: [meeting('M', 650, 750), meeting('W', 650, 750)] }),
    ]);

    expect(conflicts.map((conflict) => conflict.day)).toEqual(['Mon', 'Wed']);
  });

  it('separates two sections of the same course taught by the same professor', () => {
    const morning = section({ classNumber: '11111', meetings: [meeting('M W', 600, 660)] });
    const afternoon = section({ classNumber: '22222', meetings: [meeting('M W', 900, 960)] });

    expect(sectionKey('2267', '11111')).not.toBe(sectionKey('2267', '22222'));
    expect(findConflicts([morning, afternoon])).toEqual([]);
  });
});

describe('conflictsWith', () => {
  const scheduled = [
    section({ classNumber: '11111', courseId: 'CSE 110', meetings: [meeting('M W', 900, 960)] }),
  ];

  it('names what a candidate would clash with before it is added', () => {
    const candidate = section({ classNumber: '22222', meetings: [meeting('M', 930, 990)] });
    expect(conflictsWith(candidate, scheduled).map((entry) => entry.classNumber)).toEqual(['11111']);
  });

  it('never reports a section as clashing with itself', () => {
    expect(conflictsWith(scheduled[0], scheduled)).toEqual([]);
  });
});

describe('scheduleTotals', () => {
  it('sums units and counts the sections with no meeting time', () => {
    expect(
      scheduleTotals([
        section(),
        section({ classNumber: '2', units: 4, meetings: [] }),
        section({ classNumber: '3', units: 1, unitsMax: 3 }),
      ]),
    ).toEqual({ sections: 3, units: 8, unitsMax: 10, asynchronous: 1 });
  });
});

describe('termLabel', () => {
  it.each([
    ['2267', 'Fall 2026'],
    ['2261', 'Spring 2026'],
    ['2264', 'Summer 2026'],
  ])('reads %s as %s', (term, expected) => {
    expect(termLabel(term)).toBe(expected);
  });

  it('shows an unrecognized code rather than mislabelling it', () => {
    expect(termLabel('9999')).toBe('9999');
  });
});

describe('termFromSearch', () => {
  it('reads the term the results belong to', () => {
    expect(termFromSearch('?subject=MAT&term=2267')).toBe('2267');
  });

  it.each(['', '?subject=MAT', '?term=fall'])('returns nothing for %s', (search) => {
    expect(termFromSearch(search)).toBeNull();
  });
});

describe('parseSchedule', () => {
  it.each([
    ['null', null],
    ['an object', {}],
    ['a string', 'nope'],
  ])('returns nothing for %s', (_label, value) => {
    expect(parseSchedule(value)).toEqual([]);
  });

  it('drops entries with no class number, term or course', () => {
    expect(
      parseSchedule([
        section(),
        { ...section(), classNumber: '' },
        { ...section(), term: '' },
        { ...section(), courseId: '' },
        { ...section(), addedAt: Number.NaN },
        'not an object',
      ]),
    ).toEqual([section()]);
  });

  it('keeps one entry per class number within a term', () => {
    expect(parseSchedule([section(), section()])).toHaveLength(1);
    expect(parseSchedule([section(), section({ term: '2261' })])).toHaveLength(2);
  });

  it('discards a meeting whose days or times no longer parse', () => {
    const parsed = parseSchedule([
      {
        ...section(),
        meetings: [
          { days: ['Mon'], startMinutes: 600, endMinutes: 660 },
          { days: [], startMinutes: 600, endMinutes: 660 },
          { days: ['Mon'], startMinutes: 660, endMinutes: 600 },
          { days: ['Funday'], startMinutes: 600, endMinutes: 660 },
        ],
      },
    ]);

    expect(parsed[0].meetings).toEqual([{ days: ['Mon'], startMinutes: 600, endMinutes: 660 }]);
  });

  it('replaces unusable optional fields with nulls rather than dropping the section', () => {
    const parsed = parseSchedule([
      { ...section(), location: 42, units: 'three', dates: 'August', seatsOpen: null },
    ]);

    expect(parsed[0]).toMatchObject({
      classNumber: '60678',
      location: null,
      units: null,
      dates: null,
      seatsOpen: null,
    });
  });
});

describe('the stored schedule', () => {
  it('adds a section, reports that it was added, and reads it back', async () => {
    const area = fakeArea();
    const { addedAt: _addedAt, ...candidate } = section();

    await expect(toggleScheduledSection(candidate, area, () => 99)).resolves.toBe(true);
    await expect(readSchedule(area)).resolves.toEqual([{ ...candidate, addedAt: 99 }]);
  });

  it('removes a section the second time it is toggled', async () => {
    const area = fakeArea();
    const { addedAt: _addedAt, ...candidate } = section();

    await toggleScheduledSection(candidate, area, () => 1);
    await expect(toggleScheduledSection(candidate, area, () => 2)).resolves.toBe(false);
    await expect(readSchedule(area)).resolves.toEqual([]);
  });

  it('keeps two sections of the same course apart by class number', async () => {
    const area = fakeArea();
    const { addedAt: _a, ...first } = section({ classNumber: '11111' });
    const { addedAt: _b, ...second } = section({ classNumber: '22222' });

    await toggleScheduledSection(first, area, () => 1);
    await toggleScheduledSection(second, area, () => 2);

    const stored = await readSchedule(area);
    expect(stored.map((entry) => entry.classNumber)).toEqual(['11111', '22222']);
  });

  it('keeps sections in the order they were added', async () => {
    const area = fakeArea();
    for (const classNumber of ['1', '2', '3']) {
      const { addedAt: _addedAt, ...candidate } = section({ classNumber });
      await toggleScheduledSection(candidate, area, () => Number(classNumber));
    }

    const stored = await readSchedule(area);
    expect(stored.map((entry) => entry.classNumber)).toEqual(['1', '2', '3']);
  });

  it('removes only the named section, and only in its own term', async () => {
    const area = fakeArea({
      [SCHEDULE_STORAGE_KEY]: [section(), section({ term: '2261' })],
    });

    await removeScheduledSection('2267', '60678', area);

    const stored = await readSchedule(area);
    expect(stored.map((entry) => entry.term)).toEqual(['2261']);
  });

  it('clears everything', async () => {
    const area = fakeArea({ [SCHEDULE_STORAGE_KEY]: [section()] });
    await clearSchedule(area);
    await expect(readSchedule(area)).resolves.toEqual([]);
  });

  it('caps what it stores', async () => {
    const area = fakeArea({
      [SCHEDULE_STORAGE_KEY]: Array.from({ length: SCHEDULE_LIMIT + 10 }, (_value, index) =>
        section({ classNumber: String(index) }),
      ),
    });

    await expect(readSchedule(area)).resolves.toHaveLength(SCHEDULE_LIMIT);
  });

  it('reports an empty schedule rather than throwing when storage fails', async () => {
    const area: StorageAreaLike = {
      get: () => Promise.reject(new Error('storage is gone')),
      set: async () => undefined,
    };

    await expect(readSchedule(area)).resolves.toEqual([]);
  });
});

describe('a clash on more than one day', () => {
  it('is reported once per day rather than only on the first', () => {
    const conflicts = findConflicts([
      section({ meetings: [meeting('M W', 900, 975)] }),
      section({ classNumber: '2', courseId: 'CSE 110', meetings: [meeting('M W', 900, 975)] }),
    ]);

    expect(conflicts.map((conflict) => conflict.day)).toEqual(['Mon', 'Wed']);
  });
});
