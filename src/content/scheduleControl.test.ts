// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { VERDCT_SCHEDULE_ATTRIBUTE } from '../shared/constants';
import { parseDayTokens, type ScheduledSection } from '../shared/schedule';
import type { ScannedSectionDetails } from './domScanner';
import {
  configureSchedule,
  describeMeetings,
  resetScheduleControlsForTests,
  toScheduledSection,
  upsertScheduleControl,
} from './scheduleControl';
import { resetTooltipForTests } from './tooltip';

const TERM = '2267';

function details(overrides: Partial<ScannedSectionDetails> = {}): ScannedSectionDetails {
  return {
    classNumber: '60678',
    termHint: TERM,
    courseId: 'MAT 243',
    courseTitle: 'Discrete Mathematical Structures',
    instructors: ['Hedvig Mohacsy'],
    meetings: [{ days: parseDayTokens('M W'), startMinutes: 900, endMinutes: 975 }],
    location: 'Tempe - COORL1-10',
    dates: { start: '8/20', end: '12/4', sessionCode: 'C' },
    units: 3,
    unitsMax: null,
    seatsOpen: 8,
    seatsTotal: 60,
    ...overrides,
  };
}

function scheduled(overrides: Partial<ScheduledSection> = {}): ScheduledSection {
  return { ...toScheduledSection(details(), TERM), addedAt: 1, ...overrides };
}

function makeRow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'class-accordion';
  const numberCell = document.createElement('div');
  numberCell.className = 'class-results-cell number';
  row.append(numberCell);
  document.querySelector('#class-results')!.append(row);
  return row;
}

function buttonIn(row: HTMLElement): HTMLButtonElement {
  const host = row.querySelector<HTMLElement>(`[${VERDCT_SCHEDULE_ATTRIBUTE}]`)!;
  return host.shadowRoot!.querySelector('button')!;
}

describe('the add-to-schedule control', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="class-results"></div>';
    resetScheduleControlsForTests();
    resetTooltipForTests();
  });

  it('injects one button into the class-number cell', () => {
    const row = makeRow();
    upsertScheduleControl(row, details(), TERM);

    const cell = row.querySelector('.class-results-cell.number')!;
    expect(cell.querySelectorAll(`[${VERDCT_SCHEDULE_ATTRIBUTE}]`)).toHaveLength(1);
    expect(buttonIn(row).textContent).toBe('+Plan');
  });

  it('does not add a second button when the row is rescanned', () => {
    const row = makeRow();
    upsertScheduleControl(row, details(), TERM);
    upsertScheduleControl(row, details(), TERM);

    expect(row.querySelectorAll(`[${VERDCT_SCHEDULE_ATTRIBUTE}]`)).toHaveLength(1);
  });

  it('marks the row as added once its section is in the schedule', () => {
    const row = makeRow();
    upsertScheduleControl(row, details(), TERM);
    configureSchedule([scheduled()]);

    const button = buttonIn(row);
    expect(button.textContent).toBe('✓Planned');
    expect(button.className).toBe('scheduled');
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves a different section of the same course unmarked', () => {
    const row = makeRow();
    upsertScheduleControl(row, details({ classNumber: '99999' }), TERM);
    configureSchedule([scheduled()]);

    expect(buttonIn(row).textContent).toBe('+Plan');
  });

  it('leaves the same class number in another term unmarked', () => {
    const row = makeRow();
    upsertScheduleControl(row, details(), TERM);
    configureSchedule([scheduled({ term: '2261' })]);

    expect(buttonIn(row).textContent).toBe('+Plan');
  });

  it('warns on a row that would clash before it is added', () => {
    const row = makeRow();
    upsertScheduleControl(row, details({ classNumber: '99999' }), TERM);
    configureSchedule([scheduled({ courseId: 'CSE 110' })]);

    const button = buttonIn(row);
    expect(button.className).toBe('clash');
    expect(button.getAttribute('aria-label')).toContain('Overlaps CSE 110 (60678)');
  });

  it('names every section a row clashes with', () => {
    const row = makeRow();
    upsertScheduleControl(row, details({ classNumber: '99999' }), TERM);
    configureSchedule([
      scheduled({ classNumber: '11111', courseId: 'CSE 110' }),
      scheduled({ classNumber: '22222', courseId: 'PHY 121' }),
    ]);

    expect(buttonIn(row).getAttribute('aria-label')).toContain(
      'Overlaps CSE 110 (11111) and PHY 121 (22222)',
    );
  });

  it('shows a scheduled section that clashes as both added and clashing', () => {
    const row = makeRow();
    upsertScheduleControl(row, details(), TERM);
    configureSchedule([scheduled(), scheduled({ classNumber: '11111', courseId: 'CSE 110' })]);

    expect(buttonIn(row).className).toBe('scheduled clash');
  });

  it('does not warn about a section in the other half of the term', () => {
    const row = makeRow();
    upsertScheduleControl(
      row,
      details({ classNumber: '99999', dates: { start: '8/20', end: '10/9', sessionCode: 'A' } }),
      TERM,
    );
    configureSchedule([
      scheduled({ courseId: 'CSE 110', dates: { start: '10/14', end: '12/4', sessionCode: 'B' } }),
    ]);

    expect(buttonIn(row).className).toBe('');
  });

  it('never warns about an online section with no meeting time', () => {
    const row = makeRow();
    upsertScheduleControl(row, details({ classNumber: '99999', meetings: [] }), TERM);
    configureSchedule([scheduled({ courseId: 'CSE 110' })]);

    expect(buttonIn(row).className).toBe('');
  });

  it('forgets a row ASU has removed from the page', () => {
    const row = makeRow();
    upsertScheduleControl(row, details(), TERM);
    row.remove();

    // Repainting a detached row would keep its handle alive for the life of the page.
    expect(() => configureSchedule([scheduled()])).not.toThrow();

    const replacement = makeRow();
    upsertScheduleControl(replacement, details(), TERM);
    expect(replacement.querySelectorAll(`[${VERDCT_SCHEDULE_ATTRIBUTE}]`)).toHaveLength(1);
  });

  it('does nothing for a row with no class-number cell', () => {
    const row = document.createElement('div');
    document.querySelector('#class-results')!.append(row);

    expect(() => upsertScheduleControl(row, details(), TERM)).not.toThrow();
    expect(row.querySelector(`[${VERDCT_SCHEDULE_ATTRIBUTE}]`)).toBeNull();
  });
});

describe('describeMeetings', () => {
  it('reads one meeting as days and a time range', () => {
    expect(describeMeetings(details())).toBe('Mon Wed 3:00 PM – 4:15 PM');
  });

  it('lists every meeting a section has', () => {
    expect(
      describeMeetings(
        details({
          meetings: [
            { days: parseDayTokens('M W'), startMinutes: 540, endMinutes: 590 },
            { days: parseDayTokens('F'), startMinutes: 810, endMinutes: 920 },
          ],
        }),
      ),
    ).toBe('Mon Wed 9:00 AM – 9:50 AM, Fri 1:30 PM – 3:20 PM');
  });

  it('says plainly when a section has no meeting time', () => {
    expect(describeMeetings(details({ meetings: [] }))).toBe('No meeting time');
  });
});
