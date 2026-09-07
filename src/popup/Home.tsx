import { useEffect, useState } from 'react';

import { GET_COURSE_DATA_MESSAGE, MIN_POINTS_TO_COMPARE } from '../shared/constants';
import type { ScatterPoint, TabCourseData } from '../shared/types';
import { Favorites } from './Favorites';
import { ScatterChart } from './ScatterChart';

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

export function Home() {
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

  return (
    <>
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint dark:text-inkdark-faint">
          Quality vs difficulty
        </h2>

        {data === 'loading' && (
          <p className="mt-2 text-[11px] leading-4 text-ink-faint dark:text-inkdark-faint">
            Reading this tab…
          </p>
        )}

        {data !== 'loading' && courses.length === 0 && (
          <p className="mt-2 text-[11px] leading-4 text-ink-faint dark:text-inkdark-faint">
            Run a search on ASU Class Search with at least {MIN_POINTS_TO_COMPARE} rated professors
            and their comparison appears here.
          </p>
        )}

        {selected && (
          <>
            {courses.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {courses.map(([courseId]) => (
                  <button
                    key={courseId}
                    type="button"
                    aria-pressed={courseId === selected[0]}
                    onClick={() => setActiveCourse(courseId)}
                    className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${
                      courseId === selected[0]
                        ? 'border-line-strong bg-surface-sunken text-ink dark:border-line-darkstrong dark:bg-surface-darksunken dark:text-inkdark'
                        : 'border-line text-ink-muted dark:border-line-dark dark:text-inkdark-muted'
                    }`}
                  >
                    {courseId}
                  </button>
                ))}
              </div>
            )}

            <p className="mt-2 text-[12px] font-semibold">{selected[0]}</p>
            <ScatterChart points={selected[1]} />
            <p className="mt-1 text-[10.5px] text-ink-faint dark:text-inkdark-faint">
              Dot size reflects how many ratings back each professor.
            </p>
          </>
        )}
      </section>

      <Favorites />
    </>
  );
}
