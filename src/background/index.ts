import {
  BACKGROUND_HEALTH_CHECK,
  GET_COURSE_DATA_MESSAGE,
  LOOKUP_PROFESSOR_MESSAGE,
  REPORT_COURSE_DATA_MESSAGE,
} from '../shared/constants';
import { readSettings } from '../shared/settings';
import type {
  GetCourseDataMessage,
  LookupProfessorMessage,
  LookupProfessorResponse,
  ProfessorRating,
  ReportCourseDataMessage,
} from '../shared/types';
import { readCachedRating, writeCachedRating } from './cache';
import { normalizeProfessorName } from './nameMatcher';
import { lookupProfessorRating } from './rmpClient';
import { clearTabData, readTabData, updateActionBadge, writeTabData } from './tabData';

/**
 * A results page repeats the same professor across many sections, and each row
 * asks independently. Sharing the in-flight promise keeps that to one network
 * request even before the first response lands in the cache.
 */
const inFlightLookups = new Map<string, Promise<ProfessorRating>>();

function hasType(message: unknown, type: string): message is { type: string } {
  return (
    typeof message === 'object' && message !== null && 'type' in message && message.type === type
  );
}

function isReportMessage(message: unknown): message is ReportCourseDataMessage {
  return (
    hasType(message, REPORT_COURSE_DATA_MESSAGE) &&
    typeof (message as ReportCourseDataMessage).courses === 'object'
  );
}

function isGetCourseDataMessage(message: unknown): message is GetCourseDataMessage {
  return (
    hasType(message, GET_COURSE_DATA_MESSAGE) &&
    typeof (message as GetCourseDataMessage).tabId === 'number'
  );
}

function isLookupMessage(message: unknown): message is LookupProfessorMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === LOOKUP_PROFESSOR_MESSAGE &&
    'professorName' in message &&
    typeof message.professorName === 'string'
  );
}

async function resolveProfessorRating(professorName: string): Promise<ProfessorRating> {
  const normalizedName = normalizeProfessorName(professorName);
  if (!normalizedName) {
    throw new Error('Professor name was empty after normalization.');
  }

  const settings = await readSettings();
  const cached = await readCachedRating(normalizedName, { settings });
  if (cached) return cached;

  const pending = inFlightLookups.get(normalizedName);
  if (pending) return pending;

  const lookup = lookupProfessorRating(professorName)
    .then(async (rating) => {
      // The cache is keyed by the normalized ASU name so a later lookup of the
      // same section hits regardless of how RMP spelled the display name.
      const stored: ProfessorRating = { ...rating, normalizedName };
      await writeCachedRating(stored, { settings });
      return stored;
    })
    .finally(() => {
      inFlightLookups.delete(normalizedName);
    });

  inFlightLookups.set(normalizedName, lookup);
  return lookup;
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Diagnostic responder used by the Chrome smoke test to prove the MV3 service
  // worker registered and started.
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === BACKGROUND_HEALTH_CHECK
  ) {
    sendResponse({ ok: true });
    return false;
  }

  // The content script reports what it found; the badge is the only signal
  // Chrome allows without a user gesture, so it carries the "something to see
  // here" cue that an auto-opened popup would otherwise provide.
  if (isReportMessage(message)) {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') return false;

    void writeTabData(tabId, message.courses)
      .then(() => readTabData(tabId))
      .then((data) => updateActionBadge(tabId, data))
      .catch((error: unknown) => console.warn('[Verdct] Could not record tab data', error));
    return false;
  }

  if (isGetCourseDataMessage(message)) {
    void readTabData(message.tabId).then((data) => sendResponse({ ok: true, data }));
    return true;
  }

  if (!isLookupMessage(message)) return false;

  void resolveProfessorRating(message.professorName)
    .then((rating) => {
      const response: LookupProfessorResponse = { ok: true, rating };
      sendResponse(response);
    })
    .catch((error: unknown) => {
      console.warn('[Verdct] Professor lookup failed', error);
      const response: LookupProfessorResponse = {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown RMP lookup failure.',
      };
      sendResponse(response);
    });

  return true;
});

// Stale per-tab results would otherwise outlive the page that produced them.
chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabData(tabId);
});

// `status` is readable without the broad "tabs" permission, unlike changeInfo.url,
// so a navigation is detected without asking for access to every tab's address.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  void clearTabData(tabId).then(() => updateActionBadge(tabId, null));
});
