import { VERDCT_SCHEDULE_ATTRIBUTE } from '../shared/constants';
import {
  companionsOf,
  conflictsWith,
  formatClockTime,
  planSectionGroup,
  readSchedule,
  sectionKey,
  toggleScheduledSection,
  type ScheduledSection,
} from '../shared/schedule';
import {
  lookupRelated,
  lookupSection,
  pairsWith,
  requiredChoices,
  toScheduledFromCatalog,
  type CatalogSection,
} from './asuCatalog';
import { ASU_CLASS_SEARCH_SELECTORS, type ScannedSectionDetails } from './domScanner';
import { closePairPicker, componentNoun, openPairPicker } from './pairPicker';
import { EMBEDDED_TOKENS } from './theme';
import { hideTooltip, showTooltip } from './tooltip';

/**
 * The add-to-schedule control, injected into each row's class-number cell. It
 * sits there rather than beside the instructor because the class number is the
 * identity being added: two sections of the same course with the same professor
 * are told apart by nothing else.
 */
const CONTROL_STYLES = `
  :host { all: initial; }
  ${EMBEDDED_TOKENS}

  button {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    margin-top: 3px;
    padding: 0 6px;
    min-height: 18px;
    border: 1px solid var(--v-border-strong);
    border-radius: 6px;
    background: var(--v-surface);
    color: var(--v-text-muted);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 16px;
    text-transform: uppercase;
    white-space: nowrap;
    cursor: pointer;
  }

  button:hover { border-color: var(--v-text-muted); color: var(--v-text); }
  button:focus-visible { outline: 2px solid var(--v-text); outline-offset: 2px; }

  button.scheduled {
    border-color: rgba(31, 157, 99, 0.45);
    background: rgba(31, 157, 99, 0.1);
    color: #14764a;
  }

  /* Amber, not red: an overlap is a warning about a choice, not an error. A
     section already in the schedule keeps its green fill and takes the warning
     on its border, so "this is mine" and "this clashes" stay separate readings. */
  button.clash {
    border-color: var(--v-fair);
    color: #8a5a08;
  }
  button.clash:not(.scheduled) { background: rgba(196, 127, 16, 0.08); }

  /* Waiting on ASU's catalog to say what this section pairs with. */
  button.busy { cursor: progress; }
  button.busy .mark { animation: pulse 900ms ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.25; } }
  @media (prefers-reduced-motion: reduce) { button.busy .mark { animation: none; } }

  .mark { font-size: 11px; line-height: 12px; }
`;

interface ControlHandle {
  host: HTMLElement;
  button: HTMLButtonElement;
  details: ScannedSectionDetails;
  term: string;
  busy: boolean;
}

const controls = new Map<HTMLElement, ControlHandle>();
let scheduled: ScheduledSection[] = [];

/** Days and times as one line, or a plain statement that there are none. */
export function describeMeetings(details: ScannedSectionDetails): string {
  if (details.meetings.length === 0) return 'No meeting time';

  return details.meetings
    .map(
      (meeting) =>
        `${meeting.days.join(' ')} ${formatClockTime(meeting.startMinutes)}` +
        ` – ${formatClockTime(meeting.endMinutes)}`,
    )
    .join(', ');
}

/** The stored shape of a scanned row, ready to be added to the schedule. */
export function toScheduledSection(
  details: ScannedSectionDetails,
  term: string,
): Omit<ScheduledSection, 'addedAt'> {
  return {
    classNumber: details.classNumber,
    term,
    courseId: details.courseId,
    courseTitle: details.courseTitle,
    instructors: details.instructors,
    meetings: details.meetings,
    location: details.location,
    dates: details.dates,
    units: details.units,
    unitsMax: details.unitsMax,
    seatsOpen: details.seatsOpen,
    seatsTotal: details.seatsTotal,
    component: null,
    pairedWith: null,
  };
}

function storedEntry(term: string, classNumber: string): ScheduledSection | undefined {
  const key = sectionKey(term, classNumber);
  return scheduled.find((entry) => sectionKey(entry.term, entry.classNumber) === key);
}

function isScheduled(term: string, classNumber: string): boolean {
  return storedEntry(term, classNumber) !== undefined;
}

function nameOf(section: Pick<ScheduledSection, 'courseId' | 'classNumber'>): string {
  return `${section.courseId} (${section.classNumber})`;
}

/**
 * What this row clashes with. Computed for every row, scheduled or not, so the
 * warning arrives before the section is added rather than after.
 */
function clashes(details: ScannedSectionDetails, term: string): ScheduledSection[] {
  return conflictsWith({ ...toScheduledSection(details, term), addedAt: 0 }, scheduled);
}

function clashSentence(conflicting: ScheduledSection[]): string {
  const names = conflicting.map((section) => `${section.courseId} (${section.classNumber})`);
  const listed = names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : names[0];
  return ` Overlaps ${listed}, already in your schedule.`;
}

function explain(handle: ControlHandle): { title: string; body: string } {
  const { details, term } = handle;
  const stored = storedEntry(term, details.classNumber);
  const conflicting = clashes(details, term);

  const body =
    `${details.courseId} section ${details.classNumber}. ${describeMeetings(details)}.` +
    (conflicting.length > 0 ? clashSentence(conflicting) : '');

  if (stored?.pairedWith) {
    const lecture = storedEntry(term, stored.pairedWith);
    return {
      title: `Paired with ${lecture ? nameOf(lecture) : `section ${stored.pairedWith}`}`,
      body:
        `${body} It comes off your schedule with its lecture. To swap it, press ` +
        `+ Plan on another ${componentNoun(stored.component ?? 'section')}.`,
    };
  }

  const companions = stored ? companionsOf(scheduled, term, details.classNumber) : [];
  const pairing =
    companions.length > 0
      ? ` Planned with ${companions
          .map(
            (companion) =>
              `${componentNoun(companion.component ?? 'section')} ${companion.classNumber}`,
          )
          .join(' and ')}, which come${companions.length > 1 ? '' : 's'} off with it.`
      : '';

  return {
    title: stored ? 'In your schedule' : 'Add to your schedule',
    body: body + pairing,
  };
}

function paint(handle: ControlHandle): void {
  const { button, details, term } = handle;
  const stored = storedEntry(term, details.classNumber);
  const conflicting = clashes(details, term);

  button.className = [
    stored ? 'scheduled' : '',
    conflicting.length > 0 ? 'clash' : '',
    handle.busy ? 'busy' : '',
  ]
    .filter(Boolean)
    .join(' ');

  button.replaceChildren();
  button.append(markElement(handle.busy ? '…' : stored ? '✓' : '+'));
  // "Plan", not "Add": ASU's own maroon Add button on the same row enrols you in
  // the class, and a second control saying Add would read as the same act.
  button.append(
    document.createTextNode(stored ? (stored.pairedWith ? 'Paired' : 'Planned') : 'Plan'),
  );
  button.setAttribute('aria-busy', String(handle.busy));
  const inSchedule = stored !== undefined;

  button.setAttribute('aria-pressed', String(inSchedule));
  const { body } = explain(handle);
  button.setAttribute(
    'aria-label',
    stored?.pairedWith
      ? `${details.courseId} section ${details.classNumber} is paired with its lecture in ` +
          `your Verdct schedule. ${body}`
      : `${inSchedule ? 'Remove' : 'Add'} ${details.courseId} section ${details.classNumber} ` +
          `${inSchedule ? 'from' : 'to'} your Verdct schedule. ${body}`,
  );
}

function markElement(text: string): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.textContent = text;
  return mark;
}

/**
 * Re-reads the schedule and repaints every row. The storage listener would get
 * there too, but the clicked button should not wait on that round trip.
 */
async function refreshFromStorage(): Promise<void> {
  configureSchedule(await readSchedule());
}

function setBusy(handle: ControlHandle, busy: boolean): void {
  handle.busy = busy;
  paint(handle);
}

/** What a candidate recitation or lab would overlap, phrased for the picker. */
function clashNames(section: CatalogSection, lecture: CatalogSection): string[] {
  const candidate = { ...toScheduledFromCatalog(section), pairedWith: null, addedAt: 0 };
  const lectureEntry = { ...toScheduledFromCatalog(lecture), pairedWith: null, addedAt: 0 };
  // The lecture being planned counts: a recitation at the same hour as its own
  // lecture clashes like any other. What the lecture is already paired with
  // does not, since choosing again replaces it.
  const others = scheduled.filter(
    (entry) =>
      entry.term !== lecture.term ||
      (entry.classNumber !== lecture.classNumber && entry.pairedWith !== lecture.classNumber),
  );
  return conflictsWith(candidate, [...others, lectureEntry]).map(nameOf);
}

/** Plans a lecture, asking for its recitation and lab first when it has any. */
async function planLecture(handle: ControlHandle, lecture: CatalogSection): Promise<void> {
  const choices = requiredChoices(lecture, await lookupRelated(lecture));
  if (choices.length === 0) {
    await planSectionGroup(toScheduledFromCatalog(lecture), []);
    await refreshFromStorage();
    const { title, body } = explain(handle);
    showTooltip(handle.button, title, body);
    return;
  }

  openPairPicker({
    anchor: handle.button,
    lecture,
    choices,
    clashesFor: (section) => clashNames(section, lecture),
    onConfirm: async (chosen) => {
      await planSectionGroup(toScheduledFromCatalog(lecture), chosen.map(toScheduledFromCatalog));
      await refreshFromStorage();
      const { title, body } = explain(handle);
      showTooltip(handle.button, title, body);
    },
  });
}

/**
 * A recitation or lab joins a lecture that is already planned, replacing
 * whatever that lecture had of the same kind. On its own it cannot be planned:
 * ASU does not enroll anyone in a recitation without its lecture.
 */
async function planCompanion(handle: ControlHandle, companion: CatalogSection): Promise<void> {
  const candidates = scheduled.filter(
    (entry) =>
      entry.term === companion.term &&
      entry.courseId === companion.courseId &&
      entry.pairedWith === null,
  );

  for (const candidate of candidates) {
    const lecture = await lookupSection(candidate.term, candidate.classNumber).catch(() => null);
    if (!lecture || !pairsWith(lecture, companion)) continue;

    const kept = companionsOf(scheduled, candidate.term, candidate.classNumber).filter(
      (entry) => entry.component !== companion.component,
    );
    await planSectionGroup(candidate, [...kept, toScheduledFromCatalog(companion)]);
    await refreshFromStorage();
    showTooltip(
      handle.button,
      `Paired with ${nameOf(candidate)}`,
      `This is now the ${componentNoun(companion.component)} planned with that lecture.`,
    );
    return;
  }

  const noun = componentNoun(companion.component);
  if (candidates.length > 0) {
    // A lecture of this course is planned, just not one this section goes with,
    // as with a Downtown recitation against a Tempe lecture.
    showTooltip(
      handle.button,
      'Goes with a different lecture',
      `This ${noun} (${companion.classNumber}) belongs to a different ${companion.courseId} ` +
        `lecture than the one you planned. Pick a ${noun} that goes with ` +
        `${candidates.map(nameOf).join(' or ')} instead, or plan the lecture this one belongs to.`,
    );
    return;
  }
  showTooltip(
    handle.button,
    'Plan the lecture first',
    `ASU enrolls you in a ${noun} together with its lecture, never on its own. Press + Plan ` +
      `on a ${companion.courseId} lecture and choose this ${noun} (${companion.classNumber}) there.`,
  );
}

async function activate(handle: ControlHandle): Promise<void> {
  const { details, term, button } = handle;
  const stored = storedEntry(term, details.classNumber);

  if (stored?.pairedWith) {
    const { title, body } = explain(handle);
    showTooltip(button, title, body);
    return;
  }

  if (stored) {
    // Removing a lecture takes its recitation and lab with it.
    closePairPicker();
    await toggleScheduledSection(toScheduledSection(details, term));
    await refreshFromStorage();
    const { title, body } = explain(handle);
    showTooltip(button, title, body);
    return;
  }

  setBusy(handle, true);
  try {
    const section = await lookupSection(term, details.classNumber).catch((error: unknown) => {
      console.warn("[Verdct] Could not read ASU's catalog; planning the section alone", error);
      return null;
    });

    if (!section) {
      // Without the catalog there is no knowing what this section pairs with,
      // and refusing to plan it at all would be worse than planning it alone,
      // the way Verdct always has.
      await toggleScheduledSection(toScheduledSection(details, term));
      await refreshFromStorage();
      const { title, body } = explain(handle);
      showTooltip(button, title, body);
    } else if (section.enrollment) {
      await planLecture(handle, section);
    } else {
      await planCompanion(handle, section);
    }
  } catch (error) {
    console.warn('[Verdct] Could not plan the section', error);
    showTooltip(
      button,
      'Not planned',
      error instanceof Error && error.message === 'The schedule is full.'
        ? 'Your schedule is full. Remove something from it first.'
        : "Couldn't reach ASU's catalog to find what this section pairs with. Try again.",
    );
  } finally {
    setBusy(handle, false);
  }
}

function createControl(
  rowElement: HTMLElement,
  details: ScannedSectionDetails,
  term: string,
): ControlHandle | null {
  const cell = rowElement.querySelector<HTMLElement>(ASU_CLASS_SEARCH_SELECTORS.numberCell);
  if (!cell) return null;

  const host = document.createElement('span');
  host.setAttribute(VERDCT_SCHEDULE_ATTRIBUTE, details.classNumber);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CONTROL_STYLES;

  const button = document.createElement('button');
  button.type = 'button';

  shadow.append(style, button);
  cell.append(host);

  const handle: ControlHandle = { host, button, details, term, busy: false };

  button.addEventListener('click', (event) => {
    // ASU's row opens a details accordion on click; adding a section should not
    // also expand the row underneath the button.
    event.preventDefault();
    event.stopPropagation();
    if (handle.busy) return;
    hideTooltip();
    void activate(handle);
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  });
  button.addEventListener('mouseenter', () => {
    const { title, body } = explain(handle);
    showTooltip(button, title, body);
    // Asked ahead of the click, so a lecture's recitations are usually known by
    // the time the button is pressed. Both lookups are remembered for the page.
    if (!isScheduled(handle.term, handle.details.classNumber)) {
      void lookupSection(handle.term, handle.details.classNumber)
        .then((section) => (section?.enrollment ? lookupRelated(section) : null))
        .catch(() => undefined);
    }
  });
  button.addEventListener('focus', () => {
    const { title, body } = explain(handle);
    showTooltip(button, title, body);
  });
  button.addEventListener('mouseleave', hideTooltip);
  button.addEventListener('blur', hideTooltip);

  controls.set(rowElement, handle);
  return handle;
}

/** Creates the control for a scanned row, or refreshes it when one is there. */
export function upsertScheduleControl(
  rowElement: HTMLElement,
  details: ScannedSectionDetails,
  term: string,
): void {
  const existing = controls.get(rowElement);

  // ASU re-renders rows from cached markup, which leaves the host behind while
  // its handle is still ours; a stale host would give the row two buttons.
  if (existing && !existing.host.isConnected) {
    controls.delete(rowElement);
  }

  const handle = controls.get(rowElement) ?? createControl(rowElement, details, term);
  if (!handle) return;

  handle.details = details;
  handle.term = term;
  paint(handle);
}

/** Repaints every control against the current schedule. */
export function configureSchedule(sections: ScheduledSection[]): void {
  scheduled = sections;

  for (const [rowElement, handle] of controls) {
    if (!rowElement.isConnected || !handle.host.isConnected) {
      controls.delete(rowElement);
      continue;
    }
    paint(handle);
  }
}

export function resetScheduleControlsForTests(): void {
  controls.clear();
  scheduled = [];
}
