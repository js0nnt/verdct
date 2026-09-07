import { REPORT_COURSE_DATA_MESSAGE } from '../shared/constants';
import type { ProfessorRating, ReportCourseDataMessage, ScatterPoint } from '../shared/types';

/**
 * Collects rated professors per course and hands them to the background worker,
 * which stores them per tab for the popup to chart. The chart itself lives in
 * the popup: a panel in the corner of ASU's page was easy to miss, and the
 * toolbar badge is the only attention signal Chrome allows without a gesture.
 */
const pointsByCourse = new Map<string, Map<string, ScatterPoint>>();
const REPORT_DEBOUNCE_MS = 250;
let scheduled: number | undefined;
let lastSignature = '';

export function recordCoursePoint(courseId: string, rating: ProfessorRating): void {
  if (rating.overallRating === null || rating.difficulty === null || rating.numRatings === 0) {
    return;
  }

  const course = pointsByCourse.get(courseId) ?? new Map<string, ScatterPoint>();
  course.set(rating.normalizedName, {
    name: rating.displayName,
    rating: rating.overallRating,
    difficulty: rating.difficulty,
    numRatings: rating.numRatings,
  });
  pointsByCourse.set(courseId, course);
}

export function collectCourses(): Record<string, ScatterPoint[]> {
  return Object.fromEntries(
    [...pointsByCourse.entries()].map(([courseId, points]) => [courseId, [...points.values()]]),
  );
}

function send(): void {
  scheduled = undefined;
  const courses = collectCourses();

  // Ratings resolve one at a time, so without this the badge would be rewritten
  // on every lookup even once nothing has actually changed.
  const signature = JSON.stringify(courses);
  if (signature === lastSignature) return;
  lastSignature = signature;

  const message: ReportCourseDataMessage = { type: REPORT_COURSE_DATA_MESSAGE, courses };
  try {
    chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
  } catch (error) {
    console.warn('[Verdct] Could not report course data', error);
  }
}

export function scheduleCourseReport(): void {
  if (scheduled !== undefined) window.clearTimeout(scheduled);
  scheduled = window.setTimeout(send, REPORT_DEBOUNCE_MS);
}

export function resetCourseReporterForTests(): void {
  pointsByCourse.clear();
  lastSignature = '';
  if (scheduled !== undefined) window.clearTimeout(scheduled);
  scheduled = undefined;
}
