import { SCHEDULE_LIMIT, SCHEDULE_STORAGE_KEY } from './constants';
import { createWriteQueue, defaultStorageArea, type StorageAreaLike } from './storage';

export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

/** Monday first, matching how a week reads on a calendar rather than a Date's 0=Sunday. */
export const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * ASU prints days as single-letter tokens with Th, Sa and Su doubled up, so
 * "T Th" is Tuesday and Thursday rather than three separate days. Order matters
 * on the longer tokens: matching "T" before "Th" would turn Thursday into
 * Tuesday and drop the "h".
 */
const DAY_TOKENS: Array<[string, Weekday]> = [
  ['Su', 'Sun'],
  ['Sa', 'Sat'],
  ['Th', 'Thu'],
  ['M', 'Mon'],
  ['T', 'Tue'],
  ['W', 'Wed'],
  ['F', 'Fri'],
];

export interface Meeting {
  days: Weekday[];
  /** Minutes after midnight, so two meetings compare as plain numbers. */
  startMinutes: number;
  endMinutes: number;
}

export interface SectionDates {
  /** As ASU prints them, "8/20" and "12/4" — no year is shown on the row. */
  start: string;
  end: string;
  /** A, B and C sessions share a term but not a calendar; DYN sections vary. */
  sessionCode: string | null;
}

export interface ScheduledSection {
  /**
   * ASU's class number. This is the only identifier that separates two sections
   * of the same course taught by the same professor, which is exactly the case
   * a schedule has to get right.
   */
  classNumber: string;
  /** ASU's term code, e.g. "2267". Sections from different terms never clash. */
  term: string;
  courseId: string;
  courseTitle: string | null;
  instructors: string[];
  /** Empty for an asynchronous online section, which has no meeting time. */
  meetings: Meeting[];
  location: string | null;
  dates: SectionDates | null;
  /** Minimum units; `unitsMax` is set only when the section is variable-unit. */
  units: number | null;
  unitsMax: number | null;
  seatsOpen: number | null;
  seatsTotal: number | null;
  addedAt: number;
}

export interface ScheduleConflict {
  /** Class numbers of the two sections that overlap. */
  left: string;
  right: string;
  day: Weekday;
  /** The overlapping window itself, not either section's full meeting. */
  startMinutes: number;
  endMinutes: number;
}

/** Stable identity for a stored section: a class number is only unique within a term. */
export function sectionKey(term: string, classNumber: string): string {
  return `${term}:${classNumber}`;
}

const TIME_PATTERN = /^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/i;

/** "3:00 PM" to minutes after midnight. Null when ASU printed nothing. */
export function parseClockTime(value: string): number | null {
  const match = TIME_PATTERN.exec(value.replace(/\s+/g, ' ').trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;

  const isAfternoon = match[3].toUpperCase() === 'P';
  // 12 AM is midnight and 12 PM is noon, so the 12 is the exception both ways.
  const hours24 = (hour % 12) + (isAfternoon ? 12 : 0);
  return hours24 * 60 + minute;
}

export function formatClockTime(minutes: number): string {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** "M W F" or "TTh" to weekdays, ignoring anything that is not a day token. */
export function parseDayTokens(value: string): Weekday[] {
  const days: Weekday[] = [];
  let rest = value.replace(/\s+/g, '');

  while (rest.length > 0) {
    const token = DAY_TOKENS.find(([prefix]) => rest.startsWith(prefix));
    if (!token) {
      rest = rest.slice(1);
      continue;
    }
    if (!days.includes(token[1])) days.push(token[1]);
    rest = rest.slice(token[0].length);
  }

  return WEEKDAYS.filter((day) => days.includes(day));
}

/**
 * "8/20" to a comparable month-day ordinal. No year is printed on the row, and
 * none is needed: every section being compared belongs to the same term.
 */
function dateOrdinal(value: string): number | null {
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return month * 100 + day;
}

/**
 * Whether two sections are in session at the same time of year. A term's A and
 * B sessions each run half of it, so a 9am Monday class in the first half does
 * not actually clash with a 9am Monday class in the second.
 */
export function datesOverlap(left: SectionDates | null, right: SectionDates | null): boolean {
  // An unparsed range is treated as running the whole term. Missing out a real
  // clash is worse than warning about one that turns out to be fine.
  if (!left || !right) return true;

  const leftStart = dateOrdinal(left.start);
  const leftEnd = dateOrdinal(left.end);
  const rightStart = dateOrdinal(right.start);
  const rightEnd = dateOrdinal(right.end);
  if (leftStart === null || leftEnd === null || rightStart === null || rightEnd === null) {
    return true;
  }
  // A range that appears to run backwards has wrapped the new year, which puts
  // it across the whole calendar rather than in any one half of it.
  if (leftEnd < leftStart || rightEnd < rightStart) return true;

  return leftStart <= rightEnd && rightStart <= leftEnd;
}

/**
 * Every day two meetings overlap on, with the overlapping window. A pair that
 * clashes on both Monday and Wednesday is two problems, not one, so each day is
 * reported. Classes that merely touch — one ending exactly when the next
 * begins — do not overlap.
 */
function meetingOverlaps(
  left: Meeting,
  right: Meeting,
): Array<{ day: Weekday; startMinutes: number; endMinutes: number }> {
  const start = Math.max(left.startMinutes, right.startMinutes);
  const end = Math.min(left.endMinutes, right.endMinutes);
  if (start >= end) return [];

  return WEEKDAYS.filter((day) => left.days.includes(day) && right.days.includes(day)).map(
    (day) => ({ day, startMinutes: start, endMinutes: end }),
  );
}

/**
 * Every pair of sections that cannot both be attended. Reported per day, since
 * a Monday/Wednesday class clashing with a Wednesday-only one is one problem on
 * one day, and saying which day is what makes the warning actionable.
 */
export function findConflicts(sections: ScheduledSection[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];

  for (let i = 0; i < sections.length; i += 1) {
    for (let j = i + 1; j < sections.length; j += 1) {
      const left = sections[i];
      const right = sections[j];
      if (left.term !== right.term) continue;
      if (!datesOverlap(left.dates, right.dates)) continue;

      for (const leftMeeting of left.meetings) {
        for (const rightMeeting of right.meetings) {
          for (const overlap of meetingOverlaps(leftMeeting, rightMeeting)) {
            conflicts.push({
              left: left.classNumber,
              right: right.classNumber,
              ...overlap,
            });
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Which already-scheduled sections a candidate would clash with. The row
 * controls on Class Search use this to warn before a section is added, rather
 * than letting it in and reporting the problem afterwards.
 */
export function conflictsWith(
  candidate: ScheduledSection,
  scheduled: ScheduledSection[],
): ScheduledSection[] {
  const others = scheduled.filter(
    (section) => sectionKey(section.term, section.classNumber) !==
      sectionKey(candidate.term, candidate.classNumber),
  );

  return others.filter((section) =>
    findConflicts([candidate, section]).length > 0,
  );
}

export interface ScheduleTotals {
  sections: number;
  /** Summed minimum units, and the summed maximum when any section is variable. */
  units: number;
  unitsMax: number;
  /** Sections with no meeting time at all — asynchronous online, typically. */
  asynchronous: number;
}

export function scheduleTotals(sections: ScheduledSection[]): ScheduleTotals {
  let units = 0;
  let unitsMax = 0;
  let asynchronous = 0;

  for (const section of sections) {
    units += section.units ?? 0;
    unitsMax += section.unitsMax ?? section.units ?? 0;
    if (section.meetings.length === 0) asynchronous += 1;
  }

  return { sections: sections.length, units, unitsMax, asynchronous };
}

const SEASONS: Record<string, string> = { '1': 'Spring', '4': 'Summer', '7': 'Fall' };

/**
 * ASU term codes are century, two-digit year, season: 2267 is Fall 2026. An
 * unrecognized code is shown as-is rather than mislabelled.
 */
export function termLabel(term: string): string {
  const match = /^([12])(\d{2})([147])$/.exec(term);
  if (!match) return term;
  const year = (match[1] === '2' ? 2000 : 1900) + Number(match[2]);
  return `${SEASONS[match[3]]} ${year}`;
}

/** The term the current Class Search results belong to. */
export function termFromSearch(search: string): string | null {
  try {
    const term = new URLSearchParams(search).get('term');
    return term && /^\d{4}$/.test(term) ? term : null;
  } catch {
    return null;
  }
}

const enqueueWrite = createWriteQueue();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseMeeting(value: unknown): Meeting | null {
  if (!isRecord(value)) return null;
  const { days, startMinutes, endMinutes } = value;
  if (
    !Array.isArray(days) ||
    typeof startMinutes !== 'number' ||
    typeof endMinutes !== 'number' ||
    !Number.isFinite(startMinutes) ||
    !Number.isFinite(endMinutes) ||
    endMinutes <= startMinutes
  ) {
    return null;
  }

  const parsedDays = WEEKDAYS.filter((day) => days.includes(day));
  return parsedDays.length > 0 ? { days: parsedDays, startMinutes, endMinutes } : null;
}

function parseDates(value: unknown): SectionDates | null {
  if (!isRecord(value)) return null;
  const { start, end, sessionCode } = value;
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  return { start, end, sessionCode: typeof sessionCode === 'string' ? sessionCode : null };
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The schedule is user data that outlives an upgrade, so every field is
 * revalidated on read. A record that no longer parses is dropped rather than
 * being allowed to throw somewhere further along.
 */
export function parseSchedule(value: unknown): ScheduledSection[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const sections: ScheduledSection[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { classNumber, term, courseId, instructors, meetings, addedAt } = entry;
    if (
      typeof classNumber !== 'string' ||
      !classNumber ||
      typeof term !== 'string' ||
      !term ||
      typeof courseId !== 'string' ||
      !courseId ||
      typeof addedAt !== 'number' ||
      !Number.isFinite(addedAt)
    ) {
      continue;
    }

    const key = sectionKey(term, classNumber);
    if (seen.has(key)) continue;
    seen.add(key);

    sections.push({
      classNumber,
      term,
      courseId,
      courseTitle: optionalString(entry.courseTitle),
      instructors: Array.isArray(instructors)
        ? instructors.filter((name): name is string => typeof name === 'string')
        : [],
      meetings: Array.isArray(meetings)
        ? meetings.map(parseMeeting).filter((meeting): meeting is Meeting => meeting !== null)
        : [],
      location: optionalString(entry.location),
      dates: parseDates(entry.dates),
      units: optionalNumber(entry.units),
      unitsMax: optionalNumber(entry.unitsMax),
      seatsOpen: optionalNumber(entry.seatsOpen),
      seatsTotal: optionalNumber(entry.seatsTotal),
      addedAt,
    });
  }

  return sections.slice(0, SCHEDULE_LIMIT);
}

export async function readSchedule(
  area: StorageAreaLike = defaultStorageArea(),
): Promise<ScheduledSection[]> {
  try {
    const stored = await area.get(SCHEDULE_STORAGE_KEY);
    return parseSchedule(stored[SCHEDULE_STORAGE_KEY]);
  } catch (error) {
    console.warn('[Verdct] Could not read the schedule', error);
    return [];
  }
}

/**
 * Adds or removes a section and reports whether it is now scheduled, so the row
 * control can repaint without a second read.
 */
export function toggleScheduledSection(
  section: Omit<ScheduledSection, 'addedAt'>,
  area: StorageAreaLike = defaultStorageArea(),
  now: () => number = Date.now,
): Promise<boolean> {
  return enqueueWrite(async () => {
    const current = await readSchedule(area);
    const key = sectionKey(section.term, section.classNumber);
    const without = current.filter(
      (entry) => sectionKey(entry.term, entry.classNumber) !== key,
    );
    const isAdding = without.length === current.length;

    // Oldest first, so the grid keeps a stable order as sections are added.
    const next = isAdding
      ? [...without, { ...section, addedAt: now() }].slice(0, SCHEDULE_LIMIT)
      : without;

    await area.set({ [SCHEDULE_STORAGE_KEY]: next });
    return isAdding;
  });
}

export function removeScheduledSection(
  term: string,
  classNumber: string,
  area: StorageAreaLike = defaultStorageArea(),
): Promise<void> {
  return enqueueWrite(async () => {
    const key = sectionKey(term, classNumber);
    const remaining = (await readSchedule(area)).filter(
      (entry) => sectionKey(entry.term, entry.classNumber) !== key,
    );
    await area.set({ [SCHEDULE_STORAGE_KEY]: remaining });
  });
}

export function clearSchedule(area: StorageAreaLike = defaultStorageArea()): Promise<void> {
  return enqueueWrite(async () => {
    await area.set({ [SCHEDULE_STORAGE_KEY]: [] });
  });
}
