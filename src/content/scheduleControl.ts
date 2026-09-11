import { VERDCT_SCHEDULE_ATTRIBUTE } from '../shared/constants';
import {
  conflictsWith,
  formatClockTime,
  sectionKey,
  toggleScheduledSection,
  type ScheduledSection,
} from '../shared/schedule';
import { ASU_CLASS_SEARCH_SELECTORS, type ScannedSectionDetails } from './domScanner';
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

  .mark { font-size: 11px; line-height: 12px; }
`;

interface ControlHandle {
  host: HTMLElement;
  button: HTMLButtonElement;
  details: ScannedSectionDetails;
  term: string;
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
  };
}

function isScheduled(term: string, classNumber: string): boolean {
  const key = sectionKey(term, classNumber);
  return scheduled.some((entry) => sectionKey(entry.term, entry.classNumber) === key);
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
  const inSchedule = isScheduled(term, details.classNumber);
  const conflicting = clashes(details, term);

  const body =
    `${details.courseId} section ${details.classNumber}. ${describeMeetings(details)}.` +
    (conflicting.length > 0 ? clashSentence(conflicting) : '');

  return {
    title: inSchedule ? 'In your schedule' : 'Add to your schedule',
    body,
  };
}

function paint(handle: ControlHandle): void {
  const { button, details, term } = handle;
  const inSchedule = isScheduled(term, details.classNumber);
  const conflicting = clashes(details, term);

  button.className = [inSchedule ? 'scheduled' : '', conflicting.length > 0 ? 'clash' : '']
    .filter(Boolean)
    .join(' ');

  button.replaceChildren();
  button.append(markElement(inSchedule ? '✓' : '+'));
  // "Plan", not "Add": ASU's own maroon Add button on the same row enrols you in
  // the class, and a second control saying Add would read as the same act.
  button.append(document.createTextNode(inSchedule ? 'Planned' : 'Plan'));

  button.setAttribute('aria-pressed', String(inSchedule));
  const { body } = explain(handle);
  button.setAttribute(
    'aria-label',
    `${inSchedule ? 'Remove' : 'Add'} ${details.courseId} section ${details.classNumber} ` +
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
 * Mirrors the write into the local copy of the schedule so the clicked button,
 * and every other row's clash warning, is correct on the same tick.
 */
function applyLocally(handle: ControlHandle, nowScheduled: boolean): void {
  const key = sectionKey(handle.term, handle.details.classNumber);
  const without = scheduled.filter(
    (entry) => sectionKey(entry.term, entry.classNumber) !== key,
  );
  scheduled = nowScheduled
    ? [...without, { ...toScheduledSection(handle.details, handle.term), addedAt: Date.now() }]
    : without;
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

  const handle: ControlHandle = { host, button, details, term };

  button.addEventListener('click', (event) => {
    // ASU's row opens a details accordion on click; adding a section should not
    // also expand the row underneath the button.
    event.preventDefault();
    event.stopPropagation();
    void toggleScheduledSection(toScheduledSection(handle.details, handle.term)).then(
      (nowScheduled) => {
        // The storage listener repaints every row, this one included, but the
        // clicked button should not wait on that round trip to answer.
        applyLocally(handle, nowScheduled);
        paint(handle);
        const { title, body } = explain(handle);
        showTooltip(button, title, body);
      },
    );
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  });
  button.addEventListener('mouseenter', () => {
    const { title, body } = explain(handle);
    showTooltip(button, title, body);
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
