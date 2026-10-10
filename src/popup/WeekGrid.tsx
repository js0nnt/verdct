import { formatClockTime, type ScheduledSection } from '../shared/schedule';
import { hourMarks, layoutWeek } from '../shared/scheduleLayout';

const HOUR_HEIGHT_PX = 34;
/** Enough for a 50-minute class to still show its course id. */
const MINIMUM_BLOCK_PX = 15;
const GUTTER_WIDTH_PX = 28;

/** "Recitation" → "REC", "Laboratory" → "LAB": enough to tell blocks apart. */
function componentTag(component: string): string {
  return component.slice(0, 3).toUpperCase();
}

function hourLabel(minutes: number): string {
  const hour24 = Math.floor(minutes / 60) % 24;
  const suffix = hour24 < 12 ? 'a' : 'p';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}${suffix}`;
}

/**
 * The week as a calendar rather than a list. Blocks are positioned by minute
 * inside each day column, and overlapping ones split the column between them so
 * a clash is visible as two narrow blocks rather than one hiding the other.
 */
export function WeekGrid({ sections }: { sections: ScheduledSection[] }) {
  const layout = layoutWeek(sections);
  if (layout.blocks.length === 0) return null;

  const marks = hourMarks(layout);
  // Ordered by start time across the whole week, not per column, so the
  // morning fills in before the afternoon whichever day it falls on.
  const blockOrder = new Map(
    [...layout.blocks]
      .sort((left, right) => left.startMinutes - right.startMinutes)
      .map((block, position) => [block, position]),
  );
  const spanMinutes = layout.endMinutes - layout.startMinutes;
  const bodyHeight = (spanMinutes / 60) * HOUR_HEIGHT_PX;

  return (
    <div className="select-none">
      <div className="flex" style={{ paddingLeft: GUTTER_WIDTH_PX }}>
        {layout.days.map((day) => (
          <div
            key={day}
            className="flex-1 pb-1 text-center text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint dark:text-inkdark-faint"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="relative flex" style={{ height: bodyHeight }}>
        <div className="relative shrink-0" style={{ width: GUTTER_WIDTH_PX }}>
          {marks.slice(0, -1).map((minute) => (
            <span
              key={minute}
              className="absolute right-1 -translate-y-1/2 text-[9px] tabular-nums text-ink-faint dark:text-inkdark-faint"
              style={{ top: ((minute - layout.startMinutes) / 60) * HOUR_HEIGHT_PX }}
            >
              {hourLabel(minute)}
            </span>
          ))}
        </div>

        <div className="relative flex flex-1 overflow-hidden rounded-xl bg-surface-sunken/60 ring-1 ring-inset ring-line dark:bg-surface-darksunken/40 dark:ring-line-dark">
          {marks.slice(1, -1).map((minute) => (
            <span
              key={minute}
              aria-hidden="true"
              className="absolute inset-x-0 border-t border-dashed border-line dark:border-line-dark"
              style={{ top: ((minute - layout.startMinutes) / 60) * HOUR_HEIGHT_PX }}
            />
          ))}

          {layout.days.map((day) => (
            <div
              key={day}
              className="relative flex-1 border-l border-line first:border-l-0 dark:border-line-dark"
            >
              {layout.blocks
                .filter((block) => block.day === day)
                .map((block) => {
                  const top = ((block.startMinutes - layout.startMinutes) / 60) * HOUR_HEIGHT_PX;
                  const height = Math.max(
                    MINIMUM_BLOCK_PX,
                    ((block.endMinutes - block.startMinutes) / 60) * HOUR_HEIGHT_PX,
                  );
                  return (
                    <div
                      key={`${block.classNumber}-${block.startMinutes}`}
                      title={
                        `${block.courseId}${block.component ? ` ${block.component}` : ''} ` +
                        `(${block.classNumber})\n` +
                        `${day} ${formatClockTime(block.startMinutes)} – ` +
                        `${formatClockTime(block.endMinutes)}` +
                        (block.conflicted ? '\nOverlaps another section' : '')
                      }
                      className={`v-block absolute overflow-hidden rounded-[5px] border-l-2 py-px pl-1 pr-0.5 text-[8.5px] font-semibold leading-[11px] transition-[filter] duration-150 hover:brightness-95 dark:hover:brightness-125 ${
                        block.conflicted
                          ? 'border-tone-poor bg-tone-poor/[0.14] text-tone-poor dark:border-tonedark-poor dark:bg-tonedark-poor/20 dark:text-tonedark-poor'
                          : 'border-ink/70 bg-ink/[0.07] text-ink dark:border-inkdark/70 dark:bg-inkdark/[0.09] dark:text-inkdark'
                      }`}
                      style={{
                        top: top + 1,
                        height: height - 2,
                        left: `calc(${(block.lane / block.lanes) * 100}% + 2px)`,
                        width: `calc(${(1 / block.lanes) * 100}% - 4px)`,
                        // Blocks drop in down the week, so it fills in the way
                        // it reads rather than all at once.
                        ['--i' as string]: blockOrder.get(block) ?? 0,
                      }}
                    >
                      {block.courseId}
                      {block.component && (
                        <span className="block font-medium opacity-70">
                          {componentTag(block.component)}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
