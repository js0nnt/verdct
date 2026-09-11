import { formatClockTime, type ScheduledSection } from '../shared/schedule';
import { hourMarks, layoutWeek } from '../shared/scheduleLayout';

const HOUR_HEIGHT_PX = 34;
/** Enough for a 50-minute class to still show its course id. */
const MINIMUM_BLOCK_PX = 15;
const GUTTER_WIDTH_PX = 28;

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
  const spanMinutes = layout.endMinutes - layout.startMinutes;
  const bodyHeight = (spanMinutes / 60) * HOUR_HEIGHT_PX;

  return (
    <div className="mt-2 select-none">
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

        <div className="relative flex flex-1 rounded-md border border-line dark:border-line-dark">
          {marks.slice(1, -1).map((minute) => (
            <span
              key={minute}
              aria-hidden="true"
              className="absolute inset-x-0 border-t border-line dark:border-line-dark"
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
                .map((block, position) => {
                  const top = ((block.startMinutes - layout.startMinutes) / 60) * HOUR_HEIGHT_PX;
                  const height = Math.max(
                    MINIMUM_BLOCK_PX,
                    ((block.endMinutes - block.startMinutes) / 60) * HOUR_HEIGHT_PX,
                  );
                  return (
                    <div
                      key={`${block.classNumber}-${block.startMinutes}`}
                      title={
                        `${block.courseId} (${block.classNumber})\n` +
                        `${day} ${formatClockTime(block.startMinutes)} – ` +
                        `${formatClockTime(block.endMinutes)}` +
                        (block.conflicted ? '\nOverlaps another section' : '')
                      }
                      className={`v-block absolute overflow-hidden rounded-[3px] border px-1 text-[8.5px] font-semibold leading-[11px] transition-shadow duration-150 hover:shadow-sm ${
                        block.conflicted
                          ? 'border-tone-poor bg-tone-poor/15 text-tone-poor dark:border-tonedark-poor dark:bg-tonedark-poor/20 dark:text-tonedark-poor'
                          : 'border-tone-good bg-tone-good/12 text-tone-good dark:border-tonedark-good dark:bg-tonedark-good/20 dark:text-tonedark-good'
                      }`}
                      style={{
                        top,
                        height,
                        left: `${(block.lane / block.lanes) * 100}%`,
                        width: `${(1 / block.lanes) * 100}%`,
                        // Blocks drop in down the column, so the week fills in
                        // the way it reads rather than all at once.
                        animationDelay: `${Math.min(position, 6) * 45}ms`,
                      }}
                    >
                      {block.courseId}
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
