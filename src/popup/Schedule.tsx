import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { readCachedRating } from '../background/cache';
import { normalizeProfessorName } from '../background/nameMatcher';
import {
  classNumberList,
  clearSchedule,
  findConflicts,
  formatClockTime,
  groupSections,
  removeScheduledSection,
  readSchedule,
  scheduleTotals,
  termLabel,
  type ScheduledSection,
} from '../shared/schedule';
import type { ReportStatus } from './App';
import { useCopy, useLeaving } from './motion';
import { ProfessorName } from './ProfessorName';
import { RemoveButton } from './RemoveButton';
import { SectionLabel } from './SectionLabel';
import { Segmented } from './Segmented';
import { ToneBadge, toneFor } from './ToneBadge';
import { WeekGrid } from './WeekGrid';

/**
 * Ratings joined to the schedule, keyed by the normalized instructor name.
 * The RateMyProfessor id rides along so a name can link to its page.
 */
type RatingsByName = Map<string, { rating: number | null; legacyId: number | null }>;

/** How long "Clear all" waits for its confirming second press. */
const CLEAR_CONFIRM_MS = 3_000;

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

function unitsText(sections: ScheduledSection[]): string {
  const totals = scheduleTotals(sections);
  return totals.unitsMax > totals.units ? `${totals.units}–${totals.unitsMax}` : `${totals.units}`;
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

function CopyIcon() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
      <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.75" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.25 9.25v-5.5a1.5 1.5 0 0 1 1.5-1.5h5.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true" className="v-check">
      <path d="M2.75 7.25l2.75 2.75 5.75-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A class number that copies itself, since registration asks for it one at a time. */
function NumberChip({
  classNumber,
  copied,
  onCopy,
}: {
  classNumber: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`Copy class number ${classNumber}`}
      title="Copy class number"
      className={`flex h-5 items-center gap-1 rounded-full px-1.5 text-[10.5px] font-medium tabular-nums transition-colors duration-200 ${
        copied
          ? 'bg-tone-good/12 text-tone-good dark:bg-tonedark-good/15 dark:text-tonedark-good'
          : 'bg-surface-sunken text-ink-muted hover:text-ink dark:bg-surface-darksunken dark:text-inkdark-muted dark:hover:text-inkdark'
      }`}
    >
      {copied ? <CheckIcon /> : <span className="opacity-60">#</span>}
      {classNumber}
    </button>
  );
}

export function Schedule({ onStatus }: { onStatus: ReportStatus }) {
  const [sections, setSections] = useState<ScheduledSection[] | null>(null);
  const [activeTerm, setActiveTerm] = useState<string | null>(null);
  const [ratings, setRatings] = useState<RatingsByName>(new Map());
  const [confirmingClear, setConfirmingClear] = useState(false);
  const clearTimer = useRef<number | undefined>(undefined);
  const { leaving, leave } = useLeaving();
  const { copied, copy } = useCopy();

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

  useEffect(() => () => window.clearTimeout(clearTimer.current), []);

  useEffect(() => {
    if (!sections) return;
    const names = new Set(
      sections.flatMap((section) => section.instructors.map(normalizeProfessorName)),
    );

    void Promise.all(
      [...names].map(async (name) => {
        const cached = await readCachedRating(name);
        return [
          name,
          { rating: cached?.overallRating ?? null, legacyId: cached?.legacyId ?? null },
        ] as const;
      }),
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
      if (!match) return classNumber;
      // A recitation shares its lecture's course id, so it says which it is.
      const kind = match.pairedWith && match.component ? ` ${match.component.toLowerCase()}` : '';
      return `${match.courseId}${kind} (${classNumber})`;
    },
    [shown],
  );
  const groups = useMemo(() => groupSections(shown), [shown]);
  const conflicted = useMemo(
    () => new Set(conflicts.flatMap((conflict) => [conflict.left, conflict.right])),
    [conflicts],
  );

  const status =
    sections === null
      ? null
      : shown.length === 0
        ? 'Nothing planned'
        : `${termLabel(term)} · ${unitsText(shown)} units`;
  useEffect(() => {
    if (status) onStatus(status);
  }, [status, onStatus]);

  function handleRemove(section: ScheduledSection): void {
    leave(`${section.term}:${section.classNumber}`, () =>
      removeScheduledSection(section.term, section.classNumber).then(load),
    );
  }

  /**
   * Two presses, because a whole schedule is a lot to lose to one stray click.
   * The first only arms the button, and it disarms itself after a moment.
   */
  function handleClear(): void {
    window.clearTimeout(clearTimer.current);
    if (!confirmingClear) {
      setConfirmingClear(true);
      clearTimer.current = window.setTimeout(() => setConfirmingClear(false), CLEAR_CONFIRM_MS);
      return;
    }
    setConfirmingClear(false);
    void clearSchedule().then(load);
  }

  if (sections === null) return null;

  if (sections.length === 0) {
    return (
      <section>
        <div className="v-rise" style={{ ['--i' as string]: 0 }}>
          <SectionLabel>Schedule</SectionLabel>
        </div>
        <div
          className="v-rise mt-3 rounded-2xl bg-surface-sunken px-6 pb-6 pt-5 text-center dark:bg-surface-darksunken"
          style={{ ['--i' as string]: 1 }}
        >
          <EmptyWeek />
          <p className="mt-3 text-[12px] font-semibold">Your week is empty</p>
          <p className="mx-auto mt-1 max-w-[240px] text-[11px] leading-4 text-ink-muted dark:text-inkdark-muted">
            On ASU Class Search, press{' '}
            <span className="font-semibold text-ink dark:text-inkdark">+ Plan</span> beside a class
            number. It lands here, on a calendar, with any overlaps called out.
          </p>
        </div>
      </section>
    );
  }

  const allCopied = copied === 'all';

  return (
    <section>
      {terms.length > 1 && (
        <div className="v-rise mb-3" style={{ ['--i' as string]: 0 }}>
          <Segmented
            label="Term"
            options={terms.map((candidate) => ({ id: candidate, label: termLabel(candidate) }))}
            value={term}
            onChange={setActiveTerm}
          />
        </div>
      )}

      <div className="v-rise flex items-end justify-between gap-3" style={{ ['--i' as string]: 0 }}>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">
            {unitsText(shown)}
          </span>
          <span className="text-[11px] text-ink-muted dark:text-inkdark-muted">
            units · {shown.length} section{shown.length === 1 ? '' : 's'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => copy('all', classNumberList(shown))}
          title={classNumberList(shown)}
          className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold transition-[background-color,color,transform] duration-200 active:scale-95 ${
            allCopied
              ? 'bg-tone-good/12 text-tone-good dark:bg-tonedark-good/15 dark:text-tonedark-good'
              : 'bg-ink text-white hover:bg-black dark:bg-inkdark dark:text-[#1a1a1a] dark:hover:bg-white'
          }`}
        >
          {allCopied ? <CheckIcon /> : <CopyIcon />}
          <span aria-live="polite">{allCopied ? 'Copied' : 'Copy class #s'}</span>
        </button>
      </div>

      <div className="v-rise mt-4" style={{ ['--i' as string]: 1 }}>
        <WeekGrid sections={shown} />
      </div>

      {asynchronousNote(shown) && (
        <p
          className="v-rise mt-2 text-[10.5px] text-ink-faint dark:text-inkdark-faint"
          style={{ ['--i' as string]: 2 }}
        >
          {asynchronousNote(shown)}
        </p>
      )}

      {conflicts.length > 0 && (
        <div
          className="v-rise mt-3 rounded-2xl bg-tone-poor/[0.08] px-3.5 py-2.5 dark:bg-tonedark-poor/[0.12]"
          style={{ ['--i' as string]: 2 }}
        >
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-tone-poor dark:text-tonedark-poor">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {conflicts.length} overlap{conflicts.length === 1 ? '' : 's'}
          </p>
          <ul className="mt-1 space-y-0.5">
            {conflicts.map((conflict) => (
              <li
                key={`${conflict.left}-${conflict.right}-${conflict.day}-${conflict.startMinutes}`}
                className="text-[10.5px] leading-4 text-ink-muted dark:text-inkdark-muted"
              >
                {nameOf(conflict.left)} and {nameOf(conflict.right)} both meet {conflict.day}{' '}
                {formatClockTime(conflict.startMinutes)} – {formatClockTime(conflict.endMinutes)}.
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="v-rise mt-6 flex items-baseline justify-between" style={{ ['--i' as string]: 3 }}>
        <SectionLabel>Sections</SectionLabel>
        <button
          type="button"
          onClick={handleClear}
          className={`text-[10.5px] font-medium transition-colors duration-200 ${
            confirmingClear
              ? 'text-tone-poor dark:text-tonedark-poor'
              : 'text-ink-faint hover:text-ink dark:text-inkdark-faint dark:hover:text-inkdark'
          }`}
        >
          {confirmingClear ? 'Press again to clear' : 'Clear all'}
        </button>
      </div>

      <ul className="mt-1">
        {groups.map(({ primary: section, companions }, position) => {
          const key = `${section.term}:${section.classNumber}`;
          const chip = (target: ScheduledSection) => {
            const chipKey = `${target.term}:${target.classNumber}`;
            return (
              <NumberChip
                classNumber={target.classNumber}
                copied={copied === chipKey}
                onCopy={() => copy(chipKey, target.classNumber)}
              />
            );
          };
          const overlap = (target: ScheduledSection) =>
            conflicted.has(target.classNumber) && (
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-tone-poor dark:text-tonedark-poor">
                Overlap
              </span>
            );
          const removeLabel =
            companions.length > 0
              ? `Remove ${section.courseId} section ${section.classNumber} and its ` +
                `${companions.map((companion) => (companion.component ?? 'section').toLowerCase()).join(' and ')} ` +
                'from your schedule'
              : `Remove ${section.courseId} section ${section.classNumber} from your schedule`;
          return (
            <li
              key={key}
              data-leaving={leaving.has(key)}
              className="v-collapse v-rise"
              style={{ ['--i' as string]: position + 4 }}
            >
              <div>
                <div className="group border-b border-line py-3 dark:border-line-dark">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold tracking-tight">{section.courseId}</span>
                    {chip(section)}
                    {overlap(section)}
                    <RemoveButton label={removeLabel} onClick={() => handleRemove(section)} />
                  </div>

                  {section.courseTitle && (
                    <p className="mt-0.5 truncate text-[11px] text-ink-muted dark:text-inkdark-muted">
                      {section.courseTitle}
                    </p>
                  )}

                  <p className="mt-1.5 text-[11px] font-medium tabular-nums">{meetingLine(section)}</p>
                  <p className="text-[10.5px] text-ink-faint dark:text-inkdark-faint">
                    {[
                      section.location,
                      section.dates && `${section.dates.start} – ${section.dates.end}`,
                      section.seatsTotal !== null &&
                        `${section.seatsOpen} of ${section.seatsTotal} seats`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>

                  {section.instructors.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {section.instructors.map((instructor) => {
                        const known = ratings.get(normalizeProfessorName(instructor));
                        return (
                          <li key={instructor} className="flex items-center gap-2 text-[11.5px]">
                            <ToneBadge
                              tone={toneFor(known?.rating ?? null)}
                              value={known?.rating ?? null}
                            />
                            <ProfessorName name={instructor} legacyId={known?.legacyId ?? null} />
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* What the lecture was planned with. Hung off a rail rather
                      than listed as cards of their own, since they come and go
                      only with the lecture. */}
                  {companions.length > 0 && (
                    <ul className="mt-2.5 space-y-2 border-l-2 border-line pl-3 dark:border-line-dark">
                      {companions.map((companion) => {
                        const [instructor] = companion.instructors;
                        const known = instructor
                          ? ratings.get(normalizeProfessorName(instructor))
                          : undefined;
                        return (
                          <li key={companion.classNumber}>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted dark:text-inkdark-muted">
                                {companion.component ?? 'Section'}
                              </span>
                              {chip(companion)}
                              {overlap(companion)}
                            </div>
                            <p className="mt-1 text-[11px] font-medium tabular-nums">
                              {meetingLine(companion)}
                            </p>
                            <p className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-ink-faint dark:text-inkdark-faint">
                              {instructor && (
                                <>
                                  <ToneBadge
                                    tone={toneFor(known?.rating ?? null)}
                                    value={known?.rating ?? null}
                                  />
                                  <ProfessorName
                                    name={instructor}
                                    legacyId={known?.legacyId ?? null}
                                  />
                                </>
                              )}
                              {companion.location && (
                                <span className="truncate">
                                  {instructor ? '· ' : ''}
                                  {companion.location}
                                </span>
                              )}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A faint week of columns with a couple of blocks, standing in for the calendar. */
function EmptyWeek() {
  const blocks = [
    [0, 8, 14],
    [1, 22, 12],
    [2, 8, 14],
    [3, 22, 12],
    [4, 34, 10],
  ];
  return (
    <svg viewBox="0 0 110 60" className="mx-auto h-[66px] w-[120px]" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((column) => (
        <rect
          key={column}
          x={column * 22 + 1}
          y="1"
          width="20"
          height="58"
          rx="4"
          className="fill-none stroke-line-strong dark:stroke-line-darkstrong"
          strokeWidth="1"
        />
      ))}
      {blocks.map(([column, y, height], position) => (
        <rect
          key={position}
          x={column * 22 + 4}
          y={y}
          width="14"
          height={height}
          rx="2.5"
          style={{ ['--i' as string]: position }}
          className="v-block fill-line-strong dark:fill-line-darkstrong"
        />
      ))}
    </svg>
  );
}
