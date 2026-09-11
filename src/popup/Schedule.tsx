import { useCallback, useEffect, useMemo, useState } from 'react';

import { readCachedRating } from '../background/cache';
import { normalizeProfessorName } from '../background/nameMatcher';
import {
  clearSchedule,
  findConflicts,
  formatClockTime,
  removeScheduledSection,
  readSchedule,
  scheduleTotals,
  termLabel,
  type ScheduledSection,
} from '../shared/schedule';
import { ToneBadge, toneFor } from './ToneBadge';
import { WeekGrid } from './WeekGrid';

/** Ratings joined to the schedule, keyed by the normalized instructor name. */
type RatingsByName = Map<string, number | null>;

function meetingLine(section: ScheduledSection): string {
  if (section.meetings.length === 0) return 'No meeting time';
  return section.meetings
    .map(
      (meeting) =>
        `${meeting.days.join(' ')} · ${formatClockTime(meeting.startMinutes)} – ` +
        `${formatClockTime(meeting.endMinutes)}`,
    )
    .join(' · ');
}

function unitsLine(sections: ScheduledSection[]): string {
  const totals = scheduleTotals(sections);
  const units = totals.unitsMax > totals.units
    ? `${totals.units}–${totals.unitsMax}`
    : `${totals.units}`;
  return `${totals.sections} section${totals.sections === 1 ? '' : 's'} · ${units} units`;
}

/**
 * An asynchronous section leaves no mark on the grid, so the grid alone would
 * understate the load. Saying how many are missing from it keeps the week
 * honest without inventing a block for a class that never meets.
 */
function asynchronousNote(sections: ScheduledSection[]): string | null {
  const { asynchronous } = scheduleTotals(sections);
  if (asynchronous === 0) return null;
  return asynchronous === 1
    ? 'One section has no meeting time and is not on the grid.'
    : `${asynchronous} sections have no meeting time and are not on the grid.`;
}

export function Schedule() {
  const [sections, setSections] = useState<ScheduledSection[] | null>(null);
  const [activeTerm, setActiveTerm] = useState<string | null>(null);
  const [ratings, setRatings] = useState<RatingsByName>(new Map());

  const load = useCallback(() => {
    void readSchedule().then(setSections);
  }, []);

  useEffect(() => {
    load();
    // Adding a section on Class Search should land here without reopening the popup.
    const onChanged = (_changes: unknown, areaName: string): void => {
      if (areaName === 'local') load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [load]);

  useEffect(() => {
    if (!sections) return;
    const names = new Set(
      sections.flatMap((section) => section.instructors.map(normalizeProfessorName)),
    );

    void Promise.all(
      [...names].map(
        async (name) => [name, (await readCachedRating(name))?.overallRating ?? null] as const,
      ),
    ).then((entries) => setRatings(new Map(entries)));
  }, [sections]);

  const terms = useMemo(
    () => [...new Set((sections ?? []).map((section) => section.term))].sort(),
    [sections],
  );
  const term = activeTerm && terms.includes(activeTerm) ? activeTerm : terms[0];
  const shown = useMemo(
    () => (sections ?? []).filter((section) => section.term === term),
    [sections, term],
  );

  const conflicts = useMemo(() => findConflicts(shown), [shown]);
  /** A bare class number says nothing on its own, so clashes name the course too. */
  const nameOf = useCallback(
    (classNumber: string) => {
      const match = shown.find((section) => section.classNumber === classNumber);
      return match ? `${match.courseId} (${classNumber})` : classNumber;
    },
    [shown],
  );
  const conflicted = useMemo(
    () => new Set(conflicts.flatMap((conflict) => [conflict.left, conflict.right])),
    [conflicts],
  );

  async function handleRemove(section: ScheduledSection): Promise<void> {
    await removeScheduledSection(section.term, section.classNumber);
    load();
  }

  async function handleClear(): Promise<void> {
    await clearSchedule();
    load();
  }

  if (sections === null) {
    return <p className="text-xs text-ink-faint dark:text-inkdark-faint">Reading your schedule…</p>;
  }

  if (sections.length === 0) {
    return (
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint dark:text-inkdark-faint">
          Schedule
        </h2>
        <p className="mt-2 text-[11px] leading-4 text-ink-faint dark:text-inkdark-faint">
          Run a search on ASU Class Search and press{' '}
          <span className="text-ink-muted dark:text-inkdark-muted">+ Plan</span> beside a class
          number to build a schedule here. Sections are tracked by class number, so two sections of
          the same course with the same professor stay separate.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint dark:text-inkdark-faint">
          Schedule
        </h2>
        <button
          type="button"
          onClick={() => void handleClear()}
          className="text-[10.5px] text-ink-faint hover:text-ink dark:text-inkdark-faint dark:hover:text-inkdark"
        >
          Clear all
        </button>
      </div>

      {terms.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {terms.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={candidate === term}
              onClick={() => setActiveTerm(candidate)}
              className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${
                candidate === term
                  ? 'border-line-strong bg-surface-sunken text-ink dark:border-line-darkstrong dark:bg-surface-darksunken dark:text-inkdark'
                  : 'border-line text-ink-muted dark:border-line-dark dark:text-inkdark-muted'
              }`}
            >
              {termLabel(candidate)}
            </button>
          ))}
        </div>
      )}

      <p className="mt-1.5 text-[11px] text-ink-muted dark:text-inkdark-muted">
        {termLabel(term)} · {unitsLine(shown)}
      </p>

      <WeekGrid sections={shown} />

      {asynchronousNote(shown) && (
        <p className="mt-1.5 text-[10.5px] text-ink-faint dark:text-inkdark-faint">
          {asynchronousNote(shown)}
        </p>
      )}

      {conflicts.length > 0 && (
        <div className="mt-3 rounded-md border border-tone-poor/40 bg-tone-poor/[0.07] px-2.5 py-2 dark:border-tonedark-poor/40 dark:bg-tonedark-poor/10">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-tone-poor dark:text-tonedark-poor">
            {conflicts.length} overlap{conflicts.length === 1 ? '' : 's'}
          </p>
          <ul className="mt-1 space-y-0.5">
            {conflicts.map((conflict, position) => (
              <li
                key={`${conflict.left}-${conflict.right}-${conflict.day}-${conflict.startMinutes}`}
                style={{ animationDelay: `${Math.min(position, 6) * 40}ms` }}
                className="v-rise text-[10.5px] leading-4 text-ink-muted dark:text-inkdark-muted"
              >
                {nameOf(conflict.left)} and {nameOf(conflict.right)} both meet {conflict.day}{' '}
                {formatClockTime(conflict.startMinutes)} – {formatClockTime(conflict.endMinutes)}.
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {shown.map((section, position) => (
          <li
            key={`${section.term}:${section.classNumber}`}
            // Staggered by position so the list assembles downwards rather than
            // appearing all at once, which reads as a page that simply loaded.
            style={{ animationDelay: `${Math.min(position, 8) * 30}ms` }}
            className="v-rise rounded-md border border-line px-2.5 py-2 transition-colors duration-200 hover:border-line-strong dark:border-line-dark dark:hover:border-line-darkstrong"
          >
            <div className="flex items-baseline gap-1.5">
              <span className="text-[12px] font-semibold">{section.courseId}</span>
              <span className="text-[10.5px] tabular-nums text-ink-faint dark:text-inkdark-faint">
                #{section.classNumber}
              </span>
              {conflicted.has(section.classNumber) && (
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-tone-poor dark:text-tonedark-poor">
                  Overlap
                </span>
              )}
              <button
                type="button"
                onClick={() => void handleRemove(section)}
                aria-label={`Remove ${section.courseId} section ${section.classNumber} from your schedule`}
                className="ml-auto shrink-0 rounded px-1 text-xs text-ink-faint hover:bg-surface-sunken hover:text-ink dark:text-inkdark-faint dark:hover:bg-surface-darksunken dark:hover:text-inkdark"
              >
                ×
              </button>
            </div>

            {section.courseTitle && (
              <p className="truncate text-[10.5px] text-ink-muted dark:text-inkdark-muted">
                {section.courseTitle}
              </p>
            )}

            <p className="mt-1 text-[10.5px] tabular-nums text-ink-muted dark:text-inkdark-muted">
              {meetingLine(section)}
            </p>
            <p className="text-[10.5px] text-ink-faint dark:text-inkdark-faint">
              {[
                section.location,
                section.dates && `${section.dates.start} – ${section.dates.end}`,
                section.seatsTotal !== null && `${section.seatsOpen} of ${section.seatsTotal} seats`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>

            {section.instructors.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {section.instructors.map((instructor) => {
                  const rating = ratings.get(normalizeProfessorName(instructor)) ?? null;
                  return (
                    <li key={instructor} className="flex items-center gap-2 text-[11px]">
                      <ToneBadge tone={toneFor(rating)} value={rating} />
                      <span className="truncate">{instructor}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
