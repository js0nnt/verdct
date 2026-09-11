import { WEEKDAYS, type ScheduledSection, type Weekday } from './schedule';

/** One meeting of one section, placed on one day of the week grid. */
export interface WeekBlock {
  classNumber: string;
  courseId: string;
  day: Weekday;
  startMinutes: number;
  endMinutes: number;
  /**
   * Which column this block takes within its overlap group, and how many
   * columns that group needs. Two classes at the same hour sit side by side
   * rather than one hiding the other.
   */
  lane: number;
  lanes: number;
  /** True when this block actually overlaps another, not merely shares a group. */
  conflicted: boolean;
}

export interface WeekLayout {
  /** Days the grid draws, left to right. */
  days: Weekday[];
  /** Grid bounds in minutes after midnight, rounded out to whole hours. */
  startMinutes: number;
  endMinutes: number;
  blocks: WeekBlock[];
}

const MINUTES_PER_HOUR = 60;

/** A 50-minute class alone would otherwise render a one-hour grid with no room to read. */
const MINIMUM_SPAN_MINUTES = 3 * MINUTES_PER_HOUR;

function overlaps(left: WeekBlock, right: WeekBlock): boolean {
  return left.startMinutes < right.endMinutes && right.startMinutes < left.endMinutes;
}

/**
 * Greedy lane packing within one day: blocks are placed in start order into the
 * first lane whose previous block has already ended. Everything that overlaps
 * transitively shares a lane count, so a block never straddles the boundary
 * between two groups.
 */
function assignLanes(dayBlocks: WeekBlock[]): void {
  const ordered = [...dayBlocks].sort(
    (left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes,
  );

  let group: WeekBlock[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;

  const closeGroup = (): void => {
    for (const block of group) block.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
    groupEnd = -Infinity;
  };

  for (const block of ordered) {
    // A block starting after everything so far has ended begins a fresh group.
    if (block.startMinutes >= groupEnd) closeGroup();

    let lane = laneEnds.findIndex((end) => end <= block.startMinutes);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.endMinutes);
    } else {
      laneEnds[lane] = block.endMinutes;
    }

    block.lane = lane;
    group.push(block);
    groupEnd = Math.max(groupEnd, block.endMinutes);
  }
  closeGroup();

  for (const block of dayBlocks) {
    block.conflicted = dayBlocks.some((other) => other !== block && overlaps(block, other));
  }
}

function floorToHour(minutes: number): number {
  return Math.floor(minutes / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
}

function ceilToHour(minutes: number): number {
  return Math.ceil(minutes / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
}

/**
 * Turns scheduled sections into positioned week blocks. Days between the first
 * and last day used are always drawn, even when empty: a free Wednesday between
 * Tuesday and Thursday classes is worth seeing. Days outside that span are not,
 * since an empty Friday column at the edge only makes every block narrower.
 */
export function layoutWeek(sections: ScheduledSection[]): WeekLayout {
  const blocks: WeekBlock[] = [];

  for (const section of sections) {
    for (const meeting of section.meetings) {
      for (const day of meeting.days) {
        blocks.push({
          classNumber: section.classNumber,
          courseId: section.courseId,
          day,
          startMinutes: meeting.startMinutes,
          endMinutes: meeting.endMinutes,
          lane: 0,
          lanes: 1,
          conflicted: false,
        });
      }
    }
  }

  if (blocks.length === 0) {
    return { days: [], startMinutes: 0, endMinutes: 0, blocks: [] };
  }

  for (const day of WEEKDAYS) {
    const dayBlocks = blocks.filter((block) => block.day === day);
    if (dayBlocks.length > 0) assignLanes(dayBlocks);
  }

  const usedDays = WEEKDAYS.filter((day) => blocks.some((block) => block.day === day));
  const first = WEEKDAYS.indexOf(usedDays[0]);
  const last = WEEKDAYS.indexOf(usedDays[usedDays.length - 1]);

  const earliest = floorToHour(Math.min(...blocks.map((block) => block.startMinutes)));
  const latest = ceilToHour(Math.max(...blocks.map((block) => block.endMinutes)));

  return {
    days: WEEKDAYS.slice(first, last + 1),
    startMinutes: earliest,
    endMinutes: Math.max(latest, earliest + MINIMUM_SPAN_MINUTES),
    blocks,
  };
}

/** Whole-hour marks across the grid, for the time gutter and its rules. */
export function hourMarks(layout: WeekLayout): number[] {
  const marks: number[] = [];
  for (let minute = layout.startMinutes; minute <= layout.endMinutes; minute += MINUTES_PER_HOUR) {
    marks.push(minute);
  }
  return marks;
}
