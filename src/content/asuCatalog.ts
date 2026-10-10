import { ASU_CATALOG_API } from '../shared/constants';
import {
  parseClockTime,
  parseDayTokens,
  type Meeting,
  type ScheduledSection,
  type SectionDates,
} from '../shared/schedule';

/**
 * ASU's catalog is PeopleSoft underneath, and PeopleSoft decides which
 * recitations and labs go with which lecture:
 *
 * - A lecture is an *enrollment* section (CLASSTYPE "E"). Its recitations and
 *   labs are *non-enrollment* sections ("N"): a student enrolls in the lecture
 *   and picks one of each alongside it.
 * - A non-enrollment section belongs to a lecture when it is in the same
 *   course offering and either carries the lecture's association number or
 *   carries none, in which case it goes with any lecture in that offering.
 *
 * Class Search's own Select button asks the API for exactly that set, and
 * Verdct asks the same question rather than re-deriving the rule from the page.
 */
export interface CatalogSection {
  classNumber: string;
  term: string;
  /** PeopleSoft's course id. Not the "CHM 113" a student sees; that is `courseId`. */
  catalogCourseId: string;
  offerNumber: string;
  /** Null when ASU left it blank: the section pairs with any lecture in its offering. */
  association: string | null;
  /** "Lecture", "Recitation", "Laboratory" and so on, as ASU names them. */
  component: string;
  /** True for a section a student enrolls in directly, rather than alongside one. */
  enrollment: boolean;
  /** PeopleSoft marks some components optional; those are offered, not required. */
  optional: boolean;
  courseId: string;
  courseTitle: string | null;
  instructors: string[];
  meetings: Meeting[];
  location: string | null;
  dates: SectionDates | null;
  units: number | null;
  unitsMax: number | null;
  seatsOpen: number | null;
  seatsTotal: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => (typeof entry === 'string' ? entry : '')) : [];
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

const PLACEHOLDER_INSTRUCTORS = new Set(['staff', 'tba', 'to be announced']);
/**
 * The API prefixes some names with an honorific the results page leaves off —
 * "Mrs Stacy Sendler" — which would stop the name matching its rating.
 */
const HONORIFIC = /^(?:mr|mrs|ms|miss|mx|dr|prof|professor)\.?\s+/i;

/** Meetings are three parallel lists — days, starts, ends — one entry per meeting. */
function meetingsOf(clas: Record<string, unknown>, outer: Record<string, unknown>): Meeting[] {
  const days = stringList(outer.DAYLIST).length > 0 ? stringList(outer.DAYLIST) : [text(clas.DAYLIST)];
  const starts = stringList(clas.STARTTIMES);
  const ends = stringList(clas.ENDTIMES);

  const meetings: Meeting[] = [];
  days.forEach((printed, index) => {
    const parsedDays = parseDayTokens(printed);
    const start = parseClockTime(starts[index] ?? '');
    const end = parseClockTime(ends[index] ?? '');
    if (parsedDays.length === 0 || start === null || end === null || end <= start) return;
    meetings.push({ days: parsedDays, startMinutes: start, endMinutes: end });
  });
  return meetings;
}

/** "8/20/2026" to "8/20", matching how the results page prints a range. */
function monthDay(value: string): string {
  return value.split('/').slice(0, 2).join('/');
}

function datesOf(clas: Record<string, unknown>): SectionDates | null {
  const [first] = Array.isArray(clas.MEETINGDATES) ? clas.MEETINGDATES : [];
  const [start, end] = stringList(first);
  if (!start || !end) return null;
  return { start: monthDay(start), end: monthDay(end), sessionCode: text(clas.SESSIONCODE) || null };
}

/** Sent as an array by some records and as a JSON string by others. */
function locationOf(raw: unknown): string | null {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;
  const names = list.map((entry) => (isRecord(entry) ? text(entry.NAME) : '')).filter(Boolean);
  return names.length > 0 ? [...new Set(names)].join(', ') : null;
}

function seatsOf(raw: unknown): { seatsOpen: number | null; seatsTotal: number | null } {
  if (!isRecord(raw)) return { seatsOpen: null, seatsTotal: null };
  const total = numberOrNull(raw.ENRL_CAP);
  const enrolled = numberOrNull(raw.ENRL_TOT);
  if (total === null || enrolled === null) return { seatsOpen: null, seatsTotal: null };
  return { seatsOpen: Math.max(0, total - enrolled), seatsTotal: total };
}

/**
 * One entry of the API's `classes` list. Returns null for anything missing the
 * fields pairing depends on, so a change on ASU's side degrades to "no
 * pairing known" rather than to a wrong pairing.
 */
export function parseCatalogClass(raw: unknown): CatalogSection | null {
  if (!isRecord(raw) || !isRecord(raw.CLAS)) return null;
  const clas = raw.CLAS;

  const classNumber = text(clas.CLASSNBR);
  const term = text(clas.STRM);
  const catalogCourseId = text(clas.CRSEID);
  const offerNumber = text(clas.CRSEOFFERNBR);
  const classType = text(clas.CLASSTYPE);
  const subject = text(clas.SUBJECT);
  const catalogNumber = text(clas.CATALOGNBR);
  if (!classNumber || !term || !catalogCourseId || !offerNumber || !classType || !subject) {
    return null;
  }

  const association = text(clas.ASSOCIATEDCLASS);
  const unitsMinimum = numberOrNull(clas.UNITSMINIMUM);
  const unitsMaximum = numberOrNull(clas.UNITSMAXIMUM);

  return {
    classNumber,
    term,
    catalogCourseId,
    offerNumber,
    association: association && association !== '0' ? association : null,
    component: text(clas.DESCR2) || text(clas.COMPONENTPRIMARY) || 'Section',
    enrollment: classType === 'E',
    optional: text(clas.OPTIONALSECTION) === 'Y',
    courseId: `${subject} ${catalogNumber}`.trim(),
    courseTitle: text(clas.TITLE) || null,
    instructors: stringList(clas.INSTRUCTORSLIST)
      .map((name) => name.trim().replace(HONORIFIC, ''))
      .filter((name) => name && !PLACEHOLDER_INSTRUCTORS.has(name.toLowerCase())),
    meetings: meetingsOf(clas, raw),
    location: locationOf(raw.LOCATIONBUILDING ?? clas.LOCATIONBUILDING),
    dates: datesOf(clas),
    units: unitsMinimum,
    unitsMax: unitsMaximum !== null && unitsMinimum !== null && unitsMaximum > unitsMinimum
      ? unitsMaximum
      : null,
    ...seatsOf(raw.seatInfo),
  };
}

/** Whether a recitation or lab can be taken alongside a given lecture. */
export function pairsWith(lecture: CatalogSection, companion: CatalogSection): boolean {
  return (
    lecture.enrollment &&
    !companion.enrollment &&
    lecture.term === companion.term &&
    lecture.catalogCourseId === companion.catalogCourseId &&
    lecture.offerNumber === companion.offerNumber &&
    (companion.association === null || companion.association === lecture.association)
  );
}

export interface ComponentChoice {
  component: string;
  options: CatalogSection[];
}

/**
 * What a student has to pick to plan a lecture: one section of each required
 * component, each list in the order its sections meet across the week.
 */
export function requiredChoices(lecture: CatalogSection, related: CatalogSection[]): ComponentChoice[] {
  const byComponent = new Map<string, CatalogSection[]>();
  for (const section of related) {
    if (section.optional || !pairsWith(lecture, section)) continue;
    const list = byComponent.get(section.component) ?? [];
    if (!list.some((entry) => entry.classNumber === section.classNumber)) list.push(section);
    byComponent.set(section.component, list);
  }

  const firstMeeting = (section: CatalogSection): number => {
    const meeting = section.meetings[0];
    if (!meeting) return Number.MAX_SAFE_INTEGER;
    // Monday 8am sorts before Tuesday 7am: day first, then time.
    const dayIndex = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(meeting.days[0]);
    return dayIndex * 24 * 60 + meeting.startMinutes;
  };

  return [...byComponent.entries()]
    .map(([component, options]) => ({
      component,
      options: [...options].sort((left, right) => firstMeeting(left) - firstMeeting(right)),
    }))
    .sort((left, right) => left.component.localeCompare(right.component));
}

export function toScheduledFromCatalog(
  section: CatalogSection,
): Omit<ScheduledSection, 'addedAt' | 'pairedWith'> {
  return {
    classNumber: section.classNumber,
    term: section.term,
    courseId: section.courseId,
    courseTitle: section.courseTitle,
    instructors: section.instructors,
    meetings: section.meetings,
    location: section.location,
    dates: section.dates,
    units: section.units,
    unitsMax: section.unitsMax,
    seatsOpen: section.seatsOpen,
    seatsTotal: section.seatsTotal,
    component: section.component,
  };
}

/** Long enough for a slow campus connection, short enough not to strand a click. */
const REQUEST_TIMEOUT_MS = 8_000;

async function query(params: Record<string, string>): Promise<CatalogSection[]> {
  const search = new URLSearchParams({ refine: 'Y', searchType: 'all', ...params });
  const response = await fetch(`${ASU_CATALOG_API}?${search}`, {
    // Class Search sends this exact header, a bearer of the string "null", and
    // the API refuses requests without it.
    headers: { Authorization: 'Bearer null' },
    // Public catalog data; no ASU sign-in is needed or sent.
    credentials: 'omit',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ASU catalog answered ${response.status}`);
  const body: unknown = await response.json();
  const classes = isRecord(body) && Array.isArray(body.classes) ? body.classes : [];
  return classes.map(parseCatalogClass).filter((entry): entry is CatalogSection => entry !== null);
}

const sectionCache = new Map<string, Promise<CatalogSection | null>>();
const relatedCache = new Map<string, Promise<CatalogSection[]>>();

/** One section by class number, remembered for the life of the page. */
export function lookupSection(term: string, classNumber: string): Promise<CatalogSection | null> {
  const key = `${term}:${classNumber}`;
  let pending = sectionCache.get(key);
  if (!pending) {
    pending = query({ term, classNbr: classNumber, campusOrOnlineSelection: 'A' }).then(
      (found) => found.find((entry) => entry.classNumber === classNumber) ?? null,
    );
    // A failure is not remembered, so the next click tries again.
    pending.catch(() => sectionCache.delete(key));
    sectionCache.set(key, pending);
  }
  return pending;
}

/**
 * Everything that can be taken alongside a lecture, asked the way Class
 * Search's Select button asks it.
 */
export function lookupRelated(lecture: CatalogSection): Promise<CatalogSection[]> {
  const key = `${lecture.term}:${lecture.classNumber}`;
  let pending = relatedCache.get(key);
  if (!pending) {
    pending = query({
      term: lecture.term,
      course_id: lecture.catalogCourseId,
      crseOffrNbr: lecture.offerNumber,
      campusOrOnlineSelection: 'A',
      ...(lecture.association ? { associatedClass: lecture.association } : {}),
    }).then((found) => found.filter((entry) => pairsWith(lecture, entry)));
    pending.catch(() => relatedCache.delete(key));
    relatedCache.set(key, pending);
  }
  return pending;
}

export function resetCatalogCacheForTests(): void {
  sectionCache.clear();
  relatedCache.clear();
}
