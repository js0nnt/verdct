import {
  BACKGROUND_HEALTH_CHECK,
  LOOKUP_PROFESSOR_MESSAGE,
} from '../shared/constants';
import { readSettings } from '../shared/settings';
import type {
  LookupProfessorMessage,
  LookupProfessorResponse,
  ProfessorRating,
} from '../shared/types';
import { readCachedRating, writeCachedRating } from './cache';
import { normalizeProfessorName } from './nameMatcher';
import { lookupProfessorRating } from './rmpClient';

/**
 * A results page repeats the same professor across many sections, and each row
 * asks independently. Sharing the in-flight promise keeps that to one network
 * request even before the first response lands in the cache.
 */
const inFlightLookups = new Map<string, Promise<ProfessorRating>>();

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

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
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
