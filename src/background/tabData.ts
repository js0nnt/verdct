import {
  MIN_POINTS_TO_COMPARE,
  TAB_DATA_KEY_PREFIX,
} from '../shared/constants';
import type { ScatterPoint, TabCourseData } from '../shared/types';

/**
 * Per-tab results live in session storage rather than a module variable: an MV3
 * service worker is torn down between events, so anything held in memory would
 * be gone by the time the popup asks for it.
 */
function sessionArea(): chrome.storage.StorageArea {
  return chrome.storage.session;
}

function keyFor(tabId: number): string {
  return `${TAB_DATA_KEY_PREFIX}${tabId}`;
}

function isPoint(value: unknown): value is ScatterPoint {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.name === 'string' &&
    typeof point.rating === 'number' &&
    typeof point.difficulty === 'number' &&
    typeof point.numRatings === 'number'
  );
}

export function parseTabData(value: unknown): TabCourseData | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.courses !== 'object' || record.courses === null) return null;

  const courses: Record<string, ScatterPoint[]> = {};
  for (const [courseId, points] of Object.entries(record.courses)) {
    if (!Array.isArray(points)) continue;
    const valid = points.filter(isPoint);
    if (valid.length > 0) courses[courseId] = valid;
  }

  return {
    courses,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
  };
}

export async function writeTabData(
  tabId: number,
  courses: Record<string, ScatterPoint[]>,
  now: () => number = Date.now,
): Promise<void> {
  await sessionArea().set({ [keyFor(tabId)]: { courses, updatedAt: now() } });
}

export async function readTabData(tabId: number): Promise<TabCourseData | null> {
  try {
    const stored = await sessionArea().get(keyFor(tabId));
    return parseTabData(stored[keyFor(tabId)]);
  } catch (error) {
    console.warn('[Verdct] Could not read tab data', error);
    return null;
  }
}

export async function clearTabData(tabId: number): Promise<void> {
  await sessionArea().remove(keyFor(tabId));
}

/** Courses with enough rated professors that comparing them means something. */
export function comparableCourses(data: TabCourseData | null): string[] {
  if (!data) return [];
  return Object.entries(data.courses)
    .filter(([, points]) => points.length >= MIN_POINTS_TO_COMPARE)
    .map(([courseId]) => courseId)
    .sort();
}

/**
 * The toolbar badge is the only way to signal "there is something to see here"
 * without a user gesture — Chrome does not let an extension open its own popup
 * in response to page activity.
 */
export async function updateActionBadge(tabId: number, data: TabCourseData | null): Promise<void> {
  const courses = comparableCourses(data);
  const total = courses.reduce((count, courseId) => count + (data?.courses[courseId]?.length ?? 0), 0);

  await chrome.action.setBadgeText({ tabId, text: total > 0 ? String(total) : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#f4304a' });
  await chrome.action.setTitle({
    tabId,
    title: total > 0 ? `Verdct — ${total} rated professors to compare` : 'Verdct',
  });
}
