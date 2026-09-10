import {
  VERDCT_BADGE_ATTRIBUTE,
  VERDCT_INJECTED_SELECTOR,
  VERDCT_POPOVER_ATTRIBUTE,
  professorUrl,
} from '../shared/constants';
import { toggleFavorite } from '../shared/favorites';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { EMBEDDED_TOKENS, FLOATING_TOKENS } from './theme';
import type { ProfessorRating, ThemePreference, VerdctSettings } from '../shared/types';
import type { ScannedClassSection } from './domScanner';

export { VERDCT_BADGE_ATTRIBUTE, VERDCT_POPOVER_ATTRIBUTE };

/**
 * Below this many ratings the average is noise as much as signal, so the badge
 * is drawn provisionally rather than as a confident number.
 */
const LOW_SAMPLE_RATING_COUNT = 5;

export type BadgeState =
  | { status: 'loading' }
  | { status: 'ready'; rating: ProfessorRating }
  | { status: 'error'; message: string };

type BadgeTone = 'good' | 'fair' | 'poor' | 'unknown';

interface BadgeHandle {
  professorName: string;
  /** An anchor rather than a button, so the browser's own "open in new tab",
   *  middle-click and copy-link behaviours all work on it. */
  button: HTMLAnchorElement;
  state: BadgeState;
}

const badgeHandles = new WeakMap<HTMLElement, BadgeHandle>();
const renderedBadges = new Set<HTMLElement>();
let settings: VerdctSettings = DEFAULT_SETTINGS;
let favoriteNames = new Set<string>();
let themePreference: ThemePreference = 'auto';

/** Applies the user's explicit light/dark choice to Verdct's floating surfaces. */
export function configureTheme(theme: ThemePreference): void {
  themePreference = theme;
  const host = document.querySelector(`[${VERDCT_POPOVER_ATTRIBUTE}]`);
  host?.setAttribute('data-theme', theme);
}

/** Keeps the popover's star in step with storage. */
export function configureFavorites(names: Set<string>): void {
  favoriteNames = names;
}

/**
 * Applied inside each badge's shadow root, fully isolated from ASU's page CSS.
 * Tints are deliberately soft: a full results page carries ~17 badges, and
 * saturated fills at that density make every row shout at the same volume.
 */
const BADGE_STYLES = `
  :host { all: initial; }
  ${EMBEDDED_TOKENS}

  a {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: 6px;
    padding: 1px 7px;
    min-height: 18px;
    border: 1px solid var(--v-border-strong);
    border-radius: 6px;
    background: var(--v-surface);
    color: var(--v-text);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 11.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 16px;
    white-space: nowrap;
    vertical-align: middle;
    cursor: help;
    animation: verdct-badge-in 160ms ease-out;
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  a:hover { border-color: var(--v-text-muted); box-shadow: 0 1px 4px var(--v-shadow); }
  a:focus-visible { outline: 2px solid var(--v-text); outline-offset: 2px; }
  /* Only a badge that actually links anywhere claims to be clickable. */
  a[href] { cursor: pointer; }
  a[href]:hover { border-color: var(--v-text); }

  /* The only colour on the badge, small enough to read as a signal. */
  .dot {
    width: 5px;
    height: 5px;
    flex: none;
    border-radius: 999px;
  }
  .dot.good { background: var(--v-good); }
  .dot.fair { background: var(--v-fair); }
  .dot.poor { background: var(--v-poor); }

  a.unknown {
    background: transparent;
    border-style: dashed;
    border-color: var(--v-border-strong);
    color: var(--v-text-faint);
    font-weight: 500;
  }

  a.loading {
    background: var(--v-surface-sunken);
    color: var(--v-text-faint);
    animation: verdct-badge-pulse 1.4s ease-in-out infinite;
  }

  /* Few ratings: same reading, drawn provisionally. */
  a[data-sample="low"] { border-style: dashed; }

  .trend { font-size: 9px; font-weight: 700; line-height: 12px; color: var(--v-text-muted); }
  .trend.rising  { color: var(--v-good); }
  .trend.falling { color: var(--v-poor); }

  .marker {
    font-size: 9px;
    font-weight: 700;
    color: var(--v-text-faint);
    align-self: flex-start;
    line-height: 12px;
  }

  @keyframes verdct-badge-in {
    from { opacity: 0; transform: translateY(2px); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes verdct-badge-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }

  @media (prefers-reduced-motion: reduce) {
    a { animation: none; transition: none; }
  }
`;

const POPOVER_STYLES = `
  :host { all: initial; }
  ${FLOATING_TOKENS}

  .caret { pointer-events: none; }

  .popover {
    position: fixed;
    z-index: 2147483647;
    box-sizing: border-box;
    width: 248px;
    padding: 12px 13px;
    border: 1px solid var(--v-border);
    border-radius: 10px;
    background: var(--v-surface);
    color: var(--v-text);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 12px;
    line-height: 1.45;
    box-shadow: 0 12px 32px var(--v-shadow-strong), 0 2px 8px var(--v-shadow);
    animation: verdct-pop-in 130ms ease-out;
  }

  .caret {
    position: fixed;
    z-index: 2147483647;
    width: 9px;
    height: 9px;
    background: var(--v-surface);
    transform: rotate(45deg);
    animation: verdct-fade-in 130ms ease-out;
  }
  .caret.up   { border-left: 1px solid var(--v-border); border-top: 1px solid var(--v-border); }
  .caret.down { border-right: 1px solid var(--v-border); border-bottom: 1px solid var(--v-border); }

  .popover[hidden], .caret[hidden] { display: none; }

  .name { font-size: 13px; font-weight: 650; letter-spacing: -0.01em; }
  .source {
    margin-top: 3px;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--v-text-faint);
  }

  .hero { display: flex; align-items: baseline; gap: 5px; margin: 11px 0 1px; }
  .hero .score { font-size: 27px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
  .hero .score.good { color: var(--v-good); }
  .hero .score.fair { color: var(--v-fair); }
  .hero .score.poor { color: var(--v-poor); }
  .hero .score.unknown { color: var(--v-text-faint); }
  .hero .out-of { font-size: 11px; color: var(--v-text-faint); }
  .hero .count {
    margin-left: auto;
    font-size: 11px;
    color: var(--v-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .metric { margin-top: 9px; }
  .metric-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
    font-size: 11px;
    color: var(--v-text-muted);
  }
  .metric-head b { color: var(--v-text); font-weight: 600; font-variant-numeric: tabular-nums; }

  .track { height: 4px; border-radius: 999px; background: var(--v-track); overflow: hidden; }
  .fill { height: 100%; border-radius: 999px; }
  .fill.quality    { background: var(--v-good); }
  .fill.difficulty { background: var(--v-fair); }
  .fill.retake     { background: var(--v-text-muted); }

  .note {
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid var(--v-border);
    font-size: 11px;
    color: var(--v-text-muted);
  }
  .note.plain { margin-top: 6px; padding-top: 0; border-top: 0; }
  .trend-note { margin-top: 8px; font-size: 11px; font-weight: 600; }
  .trend-note.rising  { color: var(--v-good); }
  .trend-note.falling { color: var(--v-poor); }
  .trend-note.steady  { color: var(--v-text-muted); }

  .favorite {
    all: unset;
    display: flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    width: 100%;
    margin-top: 10px;
    padding: 6px 8px;
    border: 1px solid var(--v-border);
    border-radius: 7px;
    color: var(--v-text-muted);
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .favorite:hover { background: var(--v-surface-sunken); color: var(--v-text); }
  .favorite:focus-visible { outline: 2px solid var(--v-text); outline-offset: 1px; }
  .favorite[aria-pressed="true"] { border-color: var(--v-fair); color: var(--v-fair); }

  @keyframes verdct-pop-in {
    from { opacity: 0; transform: translateY(-3px); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes verdct-fade-in { from { opacity: 0; } to { opacity: 1; } }

  @media (prefers-reduced-motion: reduce) {
    .popover, .caret { animation: none; }
  }
`;

export function ratingTone(rating: ProfessorRating, current: VerdctSettings = settings): BadgeTone {
  if (rating.overallRating === null || rating.numRatings === 0) return 'unknown';
  if (rating.overallRating >= current.goodRatingThreshold) return 'good';
  if (rating.overallRating >= current.fairRatingThreshold) return 'fair';
  return 'poor';
}

function formatScore(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`;
}

interface PopoverParts {
  panel: HTMLElement;
  caret: HTMLElement;
}

let popoverParts: PopoverParts | null = null;

function popover(): PopoverParts {
  if (popoverParts?.panel.isConnected) return popoverParts;

  const host = document.createElement('div');
  host.setAttribute(VERDCT_POPOVER_ATTRIBUTE, '');
  host.setAttribute('data-theme', themePreference);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = POPOVER_STYLES;

  const panel = document.createElement('div');
  panel.className = 'popover';
  panel.setAttribute('role', 'tooltip');
  panel.hidden = true;

  const caret = document.createElement('div');
  caret.className = 'caret up';
  caret.hidden = true;

  panel.addEventListener('mouseenter', cancelScheduledHide);
  panel.addEventListener('mouseleave', scheduleHide);

  shadow.append(style, caret, panel);
  document.body.append(host);

  popoverParts = { panel, caret };
  return popoverParts;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A labelled value with a proportional bar, so tradeoffs read at a glance. */
function metricRow(label: string, valueText: string, ratio: number, kind: string): HTMLElement {
  const metric = element('div', 'metric');
  const head = element('div', 'metric-head');
  head.append(element('span', '', label), element('b', '', valueText));

  const track = element('div', 'track');
  const fill = element('div', `fill ${kind}`);
  fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  track.append(fill);

  metric.append(head, track);
  return metric;
}

function compactCard(title: string, note: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(element('div', 'name', title), element('div', 'note plain', note));
  return fragment;
}

/**
 * Built with DOM nodes rather than innerHTML: professor names come off ASU's
 * page and RMP's response, so neither is trusted as markup.
 */
function popoverContent(state: BadgeState, professorName: string): DocumentFragment {
  if (state.status === 'loading') {
    return compactCard(professorName, 'Looking up RateMyProfessor…');
  }
  if (state.status === 'error') {
    return compactCard(professorName, state.message);
  }

  const { rating } = state;
  if (rating.matchConfidence === 'none') {
    return compactCard(professorName, 'No confident RateMyProfessor match found.');
  }
  if (rating.numRatings === 0) {
    return compactCard(rating.displayName, 'Listed on RateMyProfessor with no ratings yet.');
  }

  const fragment = document.createDocumentFragment();
  fragment.append(element('div', 'name', rating.displayName), element('div', 'source', 'RateMyProfessor'));

  const hero = element('div', 'hero');
  hero.append(
    element('span', `score ${ratingTone(rating)}`, formatScore(rating.overallRating)),
    element('span', 'out-of', '/ 5'),
    element('span', 'count', `${rating.numRatings} rating${rating.numRatings === 1 ? '' : 's'}`),
  );
  fragment.append(hero);

  if (rating.difficulty !== null) {
    fragment.append(
      metricRow('Difficulty', `${formatScore(rating.difficulty)} / 5`, rating.difficulty / 5, 'difficulty'),
    );
  }
  if (rating.wouldTakeAgainPct !== null) {
    fragment.append(
      metricRow(
        'Would take again',
        formatPercent(rating.wouldTakeAgainPct),
        rating.wouldTakeAgainPct / 100,
        'retake',
      ),
    );
  }

  if (rating.trend) {
    fragment.append(element('div', `trend-note ${rating.trend}`, TREND_WORDS[rating.trend]));
  }

  const notes: string[] = [];
  if (rating.numRatings < LOW_SAMPLE_RATING_COUNT) {
    notes.push(`Only ${rating.numRatings} rating${rating.numRatings === 1 ? '' : 's'} — treat as provisional.`);
  }
  if (rating.matchConfidence === 'low') {
    notes.push('Name matched approximately — double-check before relying on it.');
  }
  if (notes.length) {
    fragment.append(element('div', 'note', notes.join(' ')));
  }

  fragment.append(favoriteButton(rating));
  return fragment;
}

function favoriteButton(rating: ProfessorRating): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'favorite';

  const paint = (isFavorite: boolean): void => {
    button.setAttribute('aria-pressed', String(isFavorite));
    button.replaceChildren(
      element('span', '', isFavorite ? '★' : '☆'),
      element('span', '', isFavorite ? 'Saved to favorites' : 'Save to favorites'),
    );
  };

  paint(favoriteNames.has(rating.normalizedName));

  button.addEventListener('click', () => {
    void toggleFavorite({
      normalizedName: rating.normalizedName,
      displayName: rating.displayName,
    }).then((isFavorite) => {
      // Repaint immediately; the storage listener will also broadcast this to
      // any other open Class Search tab.
      if (isFavorite) favoriteNames.add(rating.normalizedName);
      else favoriteNames.delete(rating.normalizedName);
      paint(isFavorite);
    });
  });

  return button;
}

const POPOVER_GAP_PX = 10;
/** Long enough to move the pointer from badge to panel without it vanishing. */
const POPOVER_CLOSE_DELAY_MS = 140;
let closeTimer: number | undefined;

function cancelScheduledHide(): void {
  if (closeTimer !== undefined) {
    window.clearTimeout(closeTimer);
    closeTimer = undefined;
  }
}
const CARET_HALF_PX = 4;

function showPopover(handle: BadgeHandle): void {
  cancelScheduledHide();
  const { panel, caret } = popover();
  panel.replaceChildren(popoverContent(handle.state, handle.professorName));
  panel.hidden = false;
  caret.hidden = false;

  const anchor = handle.button.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();

  // Flip above / clamp horizontally when the default placement would leave the viewport.
  const opensBelow = anchor.bottom + POPOVER_GAP_PX + panelRect.height <= window.innerHeight;
  const top = opensBelow
    ? anchor.bottom + POPOVER_GAP_PX
    : Math.max(POPOVER_GAP_PX, anchor.top - panelRect.height - POPOVER_GAP_PX);
  const left = Math.max(
    POPOVER_GAP_PX,
    Math.min(anchor.left, window.innerWidth - panelRect.width - POPOVER_GAP_PX),
  );

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;

  // The caret stays pinned to the badge even when the panel is clamped away from it.
  caret.className = opensBelow ? 'caret up' : 'caret down';
  caret.style.top = `${opensBelow ? top - CARET_HALF_PX : top + panelRect.height - CARET_HALF_PX}px`;
  caret.style.left = `${anchor.left + anchor.width / 2 - CARET_HALF_PX}px`;
}

function hidePopover(): void {
  cancelScheduledHide();
  if (!popoverParts) return;
  popoverParts.panel.hidden = true;
  popoverParts.caret.hidden = true;
}

/** Leaving the badge no longer closes instantly, so the panel can be clicked. */
function scheduleHide(): void {
  cancelScheduledHide();
  closeTimer = window.setTimeout(hidePopover, POPOVER_CLOSE_DELAY_MS);
}

interface BadgeLabel {
  text: string;
  marker: string;
  tone: BadgeTone | 'loading';
  lowSample: boolean;
  trend: ProfessorRating['trend'];
  aria: string;
}

const TREND_GLYPH: Record<'rising' | 'falling', string> = { rising: '▲', falling: '▼' };
const TREND_WORDS = {
  rising: 'Recent reviews are better than their older ones.',
  falling: 'Recent reviews are worse than their older ones.',
  steady: 'Recent reviews are in line with their older ones.',
} as const;

function badgeLabel(state: BadgeState): BadgeLabel {
  if (state.status === 'loading') {
    return {
      text: '···', marker: '', tone: 'loading', lowSample: false, trend: null,
      aria: 'loading rating',
    };
  }
  if (state.status === 'error') {
    return {
      text: '—', marker: '', tone: 'unknown', lowSample: false, trend: null,
      aria: 'rating unavailable',
    };
  }

  const { rating } = state;
  if (rating.matchConfidence === 'none' || rating.overallRating === null || rating.numRatings === 0) {
    return {
      text: '—', marker: '', tone: 'unknown', lowSample: false, trend: null,
      aria: 'no rating found',
    };
  }

  const lowSample = rating.numRatings < LOW_SAMPLE_RATING_COUNT;
  return {
    text: rating.overallRating.toFixed(1),
    marker: rating.matchConfidence === 'low' ? '?' : '',
    tone: ratingTone(rating),
    lowSample,
    trend: rating.trend,
    aria:
      `rated ${rating.overallRating.toFixed(1)} out of 5 from ${rating.numRatings} ratings` +
      (lowSample ? ', provisional' : '') +
      (rating.trend === 'rising' || rating.trend === 'falling' ? `, ${rating.trend}` : ''),
  };
}

function paintBadge(handle: BadgeHandle): void {
  const { text, marker, tone, lowSample, trend, aria } = badgeLabel(handle.state);
  handle.button.className = tone;

  const legacyId = handle.state.status === 'ready' ? handle.state.rating.legacyId : null;
  if (legacyId !== null) {
    handle.button.href = professorUrl(legacyId);
    handle.button.setAttribute(
      'aria-label',
      `${handle.professorName}: ${aria}. Opens RateMyProfessor in a new tab.`,
    );
  } else {
    handle.button.removeAttribute('href');
    handle.button.setAttribute('aria-label', `${handle.professorName}: ${aria}`);
  }

  handle.button.replaceChildren();

  if (tone === 'good' || tone === 'fair' || tone === 'poor') {
    handle.button.append(element('span', `dot ${tone}`));
  }
  handle.button.append(document.createTextNode(text));

  if (lowSample) {
    handle.button.dataset.sample = 'low';
  } else {
    delete handle.button.dataset.sample;
  }

  // Only a direction earns a glyph; "steady" is the common case and would just
  // add noise to every badge on the page.
  if (trend === 'rising' || trend === 'falling') {
    handle.button.append(element('span', `trend ${trend}`, TREND_GLYPH[trend]));
  }

  if (marker) {
    handle.button.append(element('span', 'marker', marker));
  }
}

/** Badge colors follow user-configurable thresholds, so repaint anything on screen. */
export function configureBadges(next: VerdctSettings): void {
  settings = next;
  for (const host of renderedBadges) {
    const handle = badgeHandles.get(host);
    if (handle) paintBadge(handle);
  }
}

function findExistingHost(cell: HTMLElement, professorName: string): HTMLElement | null {
  for (const candidate of cell.querySelectorAll<HTMLElement>(`[${VERDCT_BADGE_ATTRIBUTE}]`)) {
    if (candidate.getAttribute(VERDCT_BADGE_ATTRIBUTE) === professorName) return candidate;
  }
  return null;
}

/** Places the badge directly after the matching instructor link when there is one. */
function insertHost(section: ScannedClassSection, host: HTMLElement): void {
  for (const link of section.instructorElement.querySelectorAll<HTMLAnchorElement>('a')) {
    if (link.textContent?.replace(/\s+/g, ' ').trim() === section.professorName) {
      link.after(host);
      return;
    }
  }
  section.instructorElement.append(host);
}

function createHost(section: ScannedClassSection): BadgeHandle {
  const host = document.createElement('span');
  host.setAttribute(VERDCT_BADGE_ATTRIBUTE, section.professorName);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BADGE_STYLES;
  const button = document.createElement('a');
  // Focusable even without an href, so keyboard users still reach the popover
  // for a professor Verdct could not match.
  button.tabIndex = 0;
  button.rel = 'noopener noreferrer';
  button.target = '_blank';

  shadow.append(style, button);
  insertHost(section, host);

  const handle: BadgeHandle = {
    professorName: section.professorName,
    button,
    state: { status: 'loading' },
  };

  button.addEventListener('mouseenter', () => showPopover(handle));
  button.addEventListener('focus', () => showPopover(handle));
  button.addEventListener('mouseleave', scheduleHide);
  button.addEventListener('blur', scheduleHide);

  badgeHandles.set(host, handle);
  renderedBadges.add(host);
  return handle;
}

/** Creates the badge for a scanned section, or updates it in place when it already exists. */
export function upsertBadge(section: ScannedClassSection, state: BadgeState): void {
  const existingHost = findExistingHost(section.instructorElement, section.professorName);
  const existingHandle = existingHost ? badgeHandles.get(existingHost) : undefined;

  // Re-scans hand back the same resolved state object, so an unchanged badge
  // costs a reference check instead of a repaint.
  if (existingHandle?.state === state) return;

  // A host without a handle is an orphan left by ASU re-rendering the row from
  // cached markup; drop it so the row does not end up with two badges.
  if (existingHost && !existingHandle) {
    renderedBadges.delete(existingHost);
    existingHost.remove();
  }

  const handle = existingHandle ?? createHost(section);

  handle.state = state;
  paintBadge(handle);
}

/** True when a node belongs to Verdct's own injected DOM. */
export function isVerdctNode(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(element?.closest(VERDCT_INJECTED_SELECTOR));
}

export function resetBadgeRendererForTests(): void {
  popoverParts = null;
  renderedBadges.clear();
  settings = DEFAULT_SETTINGS;
}
