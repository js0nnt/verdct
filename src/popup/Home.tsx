import { useEffect, useState } from 'react';

import { GET_COURSE_DATA_MESSAGE, MIN_POINTS_TO_COMPARE } from '../shared/constants';
import type { ScatterPoint, TabCourseData } from '../shared/types';
import type { ReportStatus } from './App';
import { Favorites } from './Favorites';
import { ScatterChart } from './ScatterChart';
import { Segmented } from './Segmented';
import { SectionLabel } from './SectionLabel';

interface CourseData {
  courses: Record<string, ScatterPoint[]>;
}

/** Asks the background worker what the active tab has found so far. */
async function loadActiveTabData(): Promise<CourseData | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== 'number') return null;

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: GET_COURSE_DATA_MESSAGE, tabId: tab.id },
      (response: { ok: boolean; data: TabCourseData | null } | undefined) => {
        void chrome.runtime.lastError;
        resolve(response?.data ?? null);
      },
    );
  });
}

/**
 * The chart as it would look, drawn faintly, standing in until there is
 * something to plot. It says what this space is for better than a sentence
 * alone would.
 */
function GhostChart() {
  const dots = [
    [22, 30, 5],
    [40, 22, 7],
    [58, 44, 4],
    [70, 34, 6],
    [84, 58, 5],
  ];
  return (
    <svg viewBox="0 0 100 70" className="h-[84px] w-[120px]" aria-hidden="true">
      <path
        d="M8 6v56h88"
        className="fill-none stroke-line-strong dark:stroke-line-darkstrong"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {dots.map(([cx, cy, r], position) => (
        <circle
          key={position}
          cx={cx}
          cy={cy}
          r={r}
          style={{ ['--i' as string]: position }}
          className="v-dot fill-line-strong dark:fill-line-darkstrong"
        />
      ))}
    </svg>
  );
}

export function Home({ onStatus }: { onStatus: ReportStatus }) {
  const [data, setData] = useState<CourseData | null | 'loading'>('loading');
  const [activeCourse, setActiveCourse] = useState<string | null>(null);

  useEffect(() => {
    const refresh = (): void => {
      void loadActiveTabData().then((result) => setData(result));
    };
    refresh();

    // Ratings resolve one at a time, so a popup opened mid-scan would otherwise
    // show a stale empty chart until it was closed and reopened.
    const onChanged = (_changes: unknown, areaName: string): void => {
      if (areaName === 'session') refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const courses = Object.entries(data && data !== 'loading' ? data.courses : {})
    .filter(([, points]) => points.length >= MIN_POINTS_TO_COMPARE)
    .sort(([left], [right]) => left.localeCompare(right));

  const selected = courses.find(([courseId]) => courseId === activeCourse) ?? courses[0];

  const status =
    data === 'loading'
      ? null
      : selected
        ? `${selected[0]} · ${selected[1].length} rated`
        : 'No search on this tab';
  useEffect(() => {
    if (status) onStatus(status);
  }, [status, onStatus]);

  return (
    <>
      <section>
        <div className="v-rise flex items-baseline justify-between" style={{ ['--i' as string]: 0 }}>
          <SectionLabel>Quality vs difficulty</SectionLabel>
          {selected && (
            <span className="text-[10.5px] text-ink-faint dark:text-inkdark-faint">
              Dot size = number of reviews
            </span>
          )}
        </div>

        {data === 'loading' && (
          <div className="mt-3 h-[196px] animate-pulse rounded-2xl bg-surface-sunken dark:bg-surface-darksunken" />
        )}

        {data !== 'loading' && !selected && (
          <div
            className="v-rise mt-3 flex flex-col items-center rounded-2xl bg-surface-sunken px-6 pb-6 pt-5 text-center dark:bg-surface-darksunken"
            style={{ ['--i' as string]: 1 }}
          >
            <GhostChart />
            <p className="mt-2 text-[12px] font-semibold">Nothing to compare yet</p>
            <p className="mt-1 max-w-[230px] text-[11px] leading-4 text-ink-muted dark:text-inkdark-muted">
              Search ASU Class Search for a course with at least {MIN_POINTS_TO_COMPARE} rated
              professors, then open Verdct on that tab.
            </p>
          </div>
        )}

        {selected && (
          <>
            {courses.length > 1 && (
              <div className="v-rise mt-3" style={{ ['--i' as string]: 1 }}>
                <Segmented
                  label="Course"
                  options={courses.map(([courseId]) => ({ id: courseId, label: courseId }))}
                  value={selected[0]}
                  onChange={setActiveCourse}
                />
              </div>
            )}

            <div className="v-rise -mx-1 mt-2" style={{ ['--i' as string]: 2 }}>
              {/* Keyed by course, so switching course replots rather than
                  teleporting dots between unrelated people. */}
              <ScatterChart key={selected[0]} points={selected[1]} />
            </div>
          </>
        )}
      </section>

      <Favorites />
    </>
  );
}
