import { describe, expect, it } from 'vitest';

import { parseDayTokens, type Meeting, type ScheduledSection } from './schedule';
import { hourMarks, layoutWeek } from './scheduleLayout';

function meeting(days: string, start: number, end: number): Meeting {
  return { days: parseDayTokens(days), startMinutes: start, endMinutes: end };
}

function section(classNumber: string, meetings: Meeting[]): ScheduledSection {
  return {
    classNumber,
    term: '2267',
    courseId: `MAT ${classNumber}`,
    courseTitle: null,
    instructors: [],
    meetings,
    location: null,
    dates: null,
    units: 3,
    unitsMax: null,
    seatsOpen: null,
    seatsTotal: null,
    addedAt: 1,
  };
}

describe('layoutWeek', () => {
  it('places one block per day a meeting falls on', () => {
    const layout = layoutWeek([section('1', [meeting('M W F', 600, 660)])]);

    expect(layout.blocks.map((block) => block.day)).toEqual(['Mon', 'Wed', 'Fri']);
    expect(layout.blocks.every((block) => block.lanes === 1)).toBe(true);
  });

  it('returns an empty layout when nothing meets', () => {
    expect(layoutWeek([section('1', [])])).toEqual({
      days: [],
      startMinutes: 0,
      endMinutes: 0,
      blocks: [],
    });
  });

  it('rounds the grid out to whole hours', () => {
    const layout = layoutWeek([section('1', [meeting('M', 610, 700)])]);

    expect(layout.startMinutes).toBe(600);
    // A single short class would leave no room to read, so the grid has a floor.
    expect(layout.endMinutes).toBe(600 + 180);
  });

  it('spans the full range when classes are spread across the day', () => {
    const layout = layoutWeek([
      section('1', [meeting('M', 545, 635)]),
      section('2', [meeting('M', 1100, 1175)]),
    ]);

    expect(layout.startMinutes).toBe(540);
    expect(layout.endMinutes).toBe(1200);
  });

  it('draws the days between the first and last used, so a free day shows', () => {
    const layout = layoutWeek([section('1', [meeting('T Th', 600, 660)])]);
    expect(layout.days).toEqual(['Tue', 'Wed', 'Thu']);
  });

  it('does not pad the edges of the week with unused days', () => {
    const layout = layoutWeek([section('1', [meeting('W', 600, 660)])]);
    expect(layout.days).toEqual(['Wed']);
  });

  it('splits the column between two classes at the same hour', () => {
    const layout = layoutWeek([
      section('1', [meeting('M', 600, 700)]),
      section('2', [meeting('M', 630, 730)]),
    ]);

    expect(layout.blocks.map((block) => block.lane).sort()).toEqual([0, 1]);
    expect(layout.blocks.every((block) => block.lanes === 2)).toBe(true);
    expect(layout.blocks.every((block) => block.conflicted)).toBe(true);
  });

  it('gives back-to-back classes the full column each', () => {
    const layout = layoutWeek([
      section('1', [meeting('M', 600, 660)]),
      section('2', [meeting('M', 660, 720)]),
    ]);

    expect(layout.blocks.every((block) => block.lanes === 1)).toBe(true);
    expect(layout.blocks.some((block) => block.conflicted)).toBe(false);
  });

  it('keeps a later non-overlapping class out of an earlier clash', () => {
    const layout = layoutWeek([
      section('1', [meeting('M', 600, 700)]),
      section('2', [meeting('M', 630, 730)]),
      section('3', [meeting('M', 800, 900)]),
    ]);

    const alone = layout.blocks.find((block) => block.classNumber === '3')!;
    expect(alone.lanes).toBe(1);
    expect(alone.conflicted).toBe(false);
  });

  it('reuses a lane once its previous class has ended', () => {
    // 1 runs long; 2 and 3 fit one after the other alongside it.
    const layout = layoutWeek([
      section('1', [meeting('M', 600, 900)]),
      section('2', [meeting('M', 610, 700)]),
      section('3', [meeting('M', 710, 800)]),
    ]);

    const byClass = new Map(layout.blocks.map((block) => [block.classNumber, block]));
    expect(byClass.get('2')!.lane).toBe(byClass.get('3')!.lane);
    expect(layout.blocks.every((block) => block.lanes === 2)).toBe(true);
  });

  it('marks only the blocks that actually overlap', () => {
    const layout = layoutWeek([
      section('1', [meeting('M', 600, 900)]),
      section('2', [meeting('M', 610, 700)]),
      section('3', [meeting('T', 610, 700)]),
    ]);

    const tuesday = layout.blocks.find((block) => block.day === 'Tue')!;
    expect(tuesday.conflicted).toBe(false);
    expect(layout.blocks.filter((block) => block.conflicted)).toHaveLength(2);
  });

  it('lays out each day independently', () => {
    const layout = layoutWeek([
      section('1', [meeting('M W', 600, 700)]),
      section('2', [meeting('M', 630, 730)]),
    ]);

    const wednesday = layout.blocks.find((block) => block.day === 'Wed')!;
    expect(wednesday.lanes).toBe(1);
    expect(wednesday.conflicted).toBe(false);
  });
});

describe('hourMarks', () => {
  it('marks every hour across the grid, both ends included', () => {
    const layout = layoutWeek([section('1', [meeting('M', 600, 780)])]);
    expect(hourMarks(layout)).toEqual([600, 660, 720, 780]);
  });
});
