import { parseClockTime, parseDayTokens, type Meeting, type SectionDates } from '../shared/schedule';

/**
 * Everything a row says about one class section. Assembled once per row and
 * shared by every professor listed in it, since a two-instructor section is
 * still one section.
 */
export interface ScannedSectionDetails {
  /**
   * ASU's class number. Two sections of the same course taught by the same
   * professor differ only by this, so it is the identity a schedule is keyed on.
   */
  classNumber: string;
  /**
   * The term ASU printed on the row's syllabus link, when it has one. Used only
   * as a fallback: the page URL is the authority on which term is on screen.
   */
  termHint: string | null;
  courseId: string;
  courseTitle: string | null;
  instructors: string[];
  /** Empty when the section has no meeting time, as an async online one does. */
  meetings: Meeting[];
  location: string | null;
  dates: SectionDates | null;
  units: number | null;
  /** Set only for a variable-unit section, where the row prints a range. */
  unitsMax: number | null;
  seatsOpen: number | null;
  seatsTotal: number | null;
}

export interface ScannedClassSection {
  courseId: string;
  professorName: string;
  rowElement: HTMLElement;
  instructorElement: HTMLElement;
  /** Null when the row carried no readable class number. */
  details: ScannedSectionDetails | null;
}

/**
 * Verified against ASU Class Search's rendered result markup. Keep these page-
 * specific selectors isolated here so an ASU redesign only requires one update.
 */
export const ASU_CLASS_SEARCH_SELECTORS = {
  resultRow: '#class-results .class-accordion',
  courseLabel: '.class-results-cell.course .bold-hyperlink',
  instructorCell: '.class-results-cell.instructor',
  instructorProfileLink: 'a[href*="search.asu.edu/profile/"]',
  numberCell: '.class-results-cell.number',
  titleCell: '.class-results-cell.title',
  daysCell: '.class-results-cell.days',
  startCell: '.class-results-cell.start',
  endCell: '.class-results-cell.end',
  locationCell: '.class-results-cell.location',
  datesCell: '.class-results-cell.dates',
  unitsCell: '.class-results-cell.units',
  seatsCell: '.class-results-cell.seats',
  syllabusLink: 'a[href*="syllabus.apps.asu.edu"]',
  /** Screen-reader labels ASU prints inside each cell, e.g. "Start time: ". */
  screenReaderLabel: '.sr-only',
} as const;

const COURSE_ID_PATTERN = /\b([A-Z]{2,4})\s+(\d{3}[A-Z]?)\b/i;
const PLACEHOLDER_INSTRUCTORS = new Set([
  'staff',
  'tba',
  'to be announced',
  'instructor not assigned',
  // ASU's own wording on a section whose instructor is chosen at enrollment.
  'select instructor during enrollment',
]);

function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

/**
 * A cell's text without the screen-reader label ASU prefixes it with. Reading
 * the raw cell would turn "3:00 PM" into "Start time: 3:00 PM", so the labels
 * are stripped from a clone rather than parsed around.
 */
function visibleText(node: Element | null | undefined): string {
  if (!node) return '';
  const copy = node.cloneNode(true) as Element;
  for (const label of copy.querySelectorAll(ASU_CLASS_SEARCH_SELECTORS.screenReaderLabel)) {
    label.remove();
  }
  return cleanText(copy.textContent);
}

function visibleParagraphs(row: Element, selector: string): string[] {
  return Array.from(row.querySelectorAll<HTMLElement>(`${selector} p`), visibleText);
}

function extractCourseId(row: Element): string | null {
  const courseLabels = row.querySelectorAll<HTMLElement>(
    ASU_CLASS_SEARCH_SELECTORS.courseLabel,
  );

  for (const label of courseLabels) {
    const match = cleanText(label.textContent).match(COURSE_ID_PATTERN);
    if (match) {
      return `${match[1].toUpperCase()} ${match[2].toUpperCase()}`;
    }
  }

  return null;
}

function isProfessorName(value: string): boolean {
  return value.length > 0 && !PLACEHOLDER_INSTRUCTORS.has(value.toLowerCase());
}

function extractProfessorNames(instructorCell: HTMLElement): string[] {
  const linkedNames = Array.from(
    instructorCell.querySelectorAll<HTMLElement>(
      ASU_CLASS_SEARCH_SELECTORS.instructorProfileLink,
    ),
    (link) => cleanText(link.textContent),
  ).filter(isProfessorName);

  if (linkedNames.length > 0) {
    return [...new Set(linkedNames)];
  }

  // The cell's raw text begins with ASU's screen-reader label, so reading it
  // directly turns a Staff row into a professor called "Instructor: Staff" and
  // spends a RateMyProfessor lookup on it.
  const unlinkedName = visibleText(instructorCell);
  return isProfessorName(unlinkedName) ? [unlinkedName] : [];
}

/**
 * The class number, preferred from the cell's own id. ASU writes it there as
 * `detailsOpen=<class number>-<course id>`, which is cleaner than the cell text:
 * that also contains the "Syllabus" link when the section has one.
 */
function extractClassNumber(row: Element): string | null {
  const cell = row.querySelector<HTMLElement>(ASU_CLASS_SEARCH_SELECTORS.numberCell);
  if (!cell) return null;

  const fromId = /=(\d+)-/.exec(cell.id ?? '');
  if (fromId) return fromId[1];

  const fromText = /\b(\d{4,6})\b/.exec(visibleText(cell.firstElementChild ?? cell));
  return fromText ? fromText[1] : null;
}

/**
 * One meeting per printed row of days. A section meeting at different times on
 * different days prints several, and the three cells stay index-aligned, so an
 * unreadable time drops just that meeting rather than shifting the rest.
 */
function extractMeetings(row: Element): Meeting[] {
  const days = visibleParagraphs(row, ASU_CLASS_SEARCH_SELECTORS.daysCell);
  const starts = visibleParagraphs(row, ASU_CLASS_SEARCH_SELECTORS.startCell);
  const ends = visibleParagraphs(row, ASU_CLASS_SEARCH_SELECTORS.endCell);

  const meetings: Meeting[] = [];
  for (let index = 0; index < days.length; index += 1) {
    const parsedDays = parseDayTokens(days[index] ?? '');
    const startMinutes = parseClockTime(starts[index] ?? '');
    const endMinutes = parseClockTime(ends[index] ?? '');

    if (parsedDays.length === 0 || startMinutes === null || endMinutes === null) continue;
    if (endMinutes <= startMinutes) continue;

    meetings.push({ days: parsedDays, startMinutes, endMinutes });
  }

  return meetings;
}

const DATE_RANGE_PATTERN = /(\d{1,2}\/\d{1,2})\s*-\s*(\d{1,2}\/\d{1,2})(?:\s*\(([A-Z]+)\))?/i;

function extractDates(row: Element): SectionDates | null {
  const [printed] = visibleParagraphs(row, ASU_CLASS_SEARCH_SELECTORS.datesCell);
  const match = DATE_RANGE_PATTERN.exec(printed ?? '');
  if (!match) return null;
  return { start: match[1], end: match[2], sessionCode: match[3]?.toUpperCase() ?? null };
}

function extractUnits(row: Element): { units: number | null; unitsMax: number | null } {
  const printed = visibleText(row.querySelector(ASU_CLASS_SEARCH_SELECTORS.unitsCell));
  const numbers = printed.match(/\d+(?:\.\d+)?/g);
  if (!numbers?.length) return { units: null, unitsMax: null };

  const units = Number(numbers[0]);
  const maximum = numbers.length > 1 ? Number(numbers[numbers.length - 1]) : units;
  return { units, unitsMax: maximum > units ? maximum : null };
}

/** ASU's syllabus links are `/syllabus/<term>/<class number>`. */
function extractTermHint(row: Element): string | null {
  const link = row.querySelector<HTMLAnchorElement>(ASU_CLASS_SEARCH_SELECTORS.syllabusLink);
  const match = /\/syllabus\/(\d{4})\//.exec(link?.getAttribute('href') ?? '');
  return match ? match[1] : null;
}

function extractSeats(row: Element): { seatsOpen: number | null; seatsTotal: number | null } {
  const printed = visibleText(row.querySelector(ASU_CLASS_SEARCH_SELECTORS.seatsCell));
  const match = /(\d+)\s+of\s+(\d+)/i.exec(printed);
  if (!match) return { seatsOpen: null, seatsTotal: null };
  return { seatsOpen: Number(match[1]), seatsTotal: Number(match[2]) };
}

/** Everything one result row says about its section, or null without a class number. */
export function scanSectionDetails(
  row: Element,
  courseId: string,
  instructors: string[],
): ScannedSectionDetails | null {
  const classNumber = extractClassNumber(row);
  if (!classNumber) return null;

  const { units, unitsMax } = extractUnits(row);
  const { seatsOpen, seatsTotal } = extractSeats(row);
  const courseTitle = visibleText(row.querySelector(ASU_CLASS_SEARCH_SELECTORS.titleCell));

  return {
    classNumber,
    termHint: extractTermHint(row),
    courseId,
    courseTitle: courseTitle || null,
    instructors,
    meetings: extractMeetings(row),
    location: visibleText(row.querySelector(ASU_CLASS_SEARCH_SELECTORS.locationCell)) || null,
    dates: extractDates(row),
    units,
    unitsMax,
    seatsOpen,
    seatsTotal,
  };
}

/** One result row, parsed once for both the badges and the schedule. */
export interface ScannedRow {
  rowElement: HTMLElement;
  instructorElement: HTMLElement | null;
  details: ScannedSectionDetails | null;
  /** One entry per professor listed, which is what the badges are drawn from. */
  sections: ScannedClassSection[];
}

/**
 * Reads every result row once. A row taught by two people yields two badge
 * entries but one section: the schedule works in sections, so parsing per
 * professor would add the same class twice.
 */
export function scanRows(root: ParentNode = document): ScannedRow[] {
  const scanned: ScannedRow[] = [];

  for (const rowElement of root.querySelectorAll<HTMLElement>(
    ASU_CLASS_SEARCH_SELECTORS.resultRow,
  )) {
    const courseId = extractCourseId(rowElement);
    if (!courseId) continue;

    const instructorElement = rowElement.querySelector<HTMLElement>(
      ASU_CLASS_SEARCH_SELECTORS.instructorCell,
    );
    const professorNames = instructorElement ? extractProfessorNames(instructorElement) : [];
    const details = scanSectionDetails(rowElement, courseId, professorNames);

    const sections: ScannedClassSection[] = instructorElement
      ? professorNames.map((professorName) => ({
          courseId,
          professorName,
          rowElement,
          instructorElement,
          details,
        }))
      : [];

    scanned.push({ rowElement, instructorElement, details, sections });
  }

  return scanned;
}

export function scanClassSections(root: ParentNode = document): ScannedClassSection[] {
  return scanRows(root).flatMap((row) => row.sections);
}
