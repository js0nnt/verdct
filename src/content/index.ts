import {
  FAVORITES_STORAGE_KEY,
  LOOKUP_PROFESSOR_MESSAGE,
  SETTINGS_STORAGE_KEY,
} from '../shared/constants';
import { parseFavorites, readFavorites } from '../shared/favorites';
import { coerceSettings, readSettings } from '../shared/settings';
import type {
  LookupProfessorMessage,
  LookupProfessorResponse,
  ProfessorRating,
} from '../shared/types';
import {
  configureBadges,
  configureFavorites,
  isVerdctNode,
  upsertBadge,
  type BadgeState,
} from './badgeRenderer';
import { evaluateBestSections, recordSection } from './bestSection';
import { scanClassSections, type ScannedClassSection } from './domScanner';
import { recordScatterPoint, refreshScatter } from './scatterWidget';

const RESCAN_DELAY_MS = 100;

/**
 * One entry per professor name seen this page load. Rating results are shared
 * across every section that lists the same instructor, so a course with eight
 * sections taught by two professors costs two lookups, not eight.
 */
const lookupsByProfessor = new Map<string, Promise<BadgeState>>();
let scheduledScan: number | undefined;

function requestRating(professorName: string): Promise<ProfessorRating> {
  const message: LookupProfessorMessage = {
    type: LOOKUP_PROFESSOR_MESSAGE,
    professorName,
  };

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: LookupProfessorResponse | undefined) => {
      // A torn-down service worker surfaces here rather than as a rejection.
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? 'Extension messaging failed.'));
        return;
      }
      if (!response) {
        reject(new Error('No response from the Verdct background worker.'));
        return;
      }
      if (!response.ok) {
        reject(new Error(response.error));
        return;
      }
      resolve(response.rating);
    });
  });
}

function lookupBadgeState(professorName: string): Promise<BadgeState> {
  const pending = lookupsByProfessor.get(professorName);
  if (pending) return pending;

  const lookup = requestRating(professorName)
    .then((rating): BadgeState => ({ status: 'ready', rating }))
    .catch((error: unknown): BadgeState => {
      console.warn('[Verdct] Rating lookup failed', professorName, error);
      return { status: 'error', message: 'Rating lookup failed. Reload to retry.' };
    });

  lookupsByProfessor.set(professorName, lookup);
  return lookup;
}

function renderSection(section: ScannedClassSection): void {
  const pending = lookupsByProfessor.get(section.professorName);

  // Only paint the loading state for names not already resolved, so re-scans of
  // an existing row never flash a badge back to "···".
  if (!pending) {
    upsertBadge(section, { status: 'loading' });
  }

  void lookupBadgeState(section.professorName).then((state) => {
    // The row can be replaced while the lookup is in flight; skip detached nodes.
    if (!section.instructorElement.isConnected) return;
    upsertBadge(section, state);
    recordSection(section, state);
    evaluateBestSections();
    if (state.status === 'ready') recordScatterPoint(section.courseId, state.rating);
    refreshScatter();
  });
}

function scanAndRender(): void {
  scheduledScan = undefined;
  const started = performance.now();

  for (const section of scanClassSections()) {
    renderSection(section);
  }

  // Newly scanned rows change which section wins, even when every rating for
  // them was already resolved and cached.
  evaluateBestSections();

  const elapsed = performance.now() - started;
  if (elapsed > 50) {
    console.debug(`[Verdct] Scan batch took ${elapsed.toFixed(1)}ms`);
  }
}

function scheduleScan(): void {
  if (scheduledScan !== undefined) {
    window.clearTimeout(scheduledScan);
  }
  scheduledScan = window.setTimeout(scanAndRender, RESCAN_DELAY_MS);
}

/** Ignores the mutations Verdct itself causes, which would otherwise loop forever. */
function hasPageMutation(mutations: MutationRecord[]): boolean {
  return mutations.some((mutation) => {
    if (isVerdctNode(mutation.target)) return false;
    const changed = [...mutation.addedNodes, ...mutation.removedNodes];
    return changed.length === 0 || changed.some((node) => !isVerdctNode(node));
  });
}

const observer = new MutationObserver((mutations) => {
  if (hasPageMutation(mutations)) scheduleScan();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});

void readSettings().then(configureBadges);
void readFavorites().then((favorites) => {
  configureFavorites(new Set(favorites.map((favorite) => favorite.normalizedName)));
});

// Threshold changes in the popup repaint open Class Search tabs immediately.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes[SETTINGS_STORAGE_KEY]) {
    configureBadges(coerceSettings(changes[SETTINGS_STORAGE_KEY].newValue));
  }

  // Favoriting in the popup, or in another tab, is reflected here too.
  if (changes[FAVORITES_STORAGE_KEY]) {
    const favorites = parseFavorites(changes[FAVORITES_STORAGE_KEY].newValue);
    configureFavorites(new Set(favorites.map((favorite) => favorite.normalizedName)));
  }
});

scheduleScan();
