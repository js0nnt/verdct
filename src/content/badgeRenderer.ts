import { DEFAULT_SETTINGS } from '../shared/settings';
import type { ProfessorRating, VerdctSettings } from '../shared/types';
import type { ScannedClassSection } from './domScanner';

/**
 * Marks every element Verdct injects. The content script uses it to ignore its
 * own DOM mutations, so rendering a badge cannot retrigger a page scan.
 */
export const VERDCT_BADGE_ATTRIBUTE = 'data-verdct-badge';
export const VERDCT_POPOVER_ATTRIBUTE = 'data-verdct-popover-layer';

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
  button: HTMLButtonElement;
  state: BadgeState;
}

const badgeHandles = new WeakMap<HTMLElement, BadgeHandle>();
const renderedBadges = new Set<HTMLElement>();
let settings: VerdctSettings = DEFAULT_SETTINGS;

/**
 * Applied inside each badge's shadow root, fully isolated from ASU's page CSS.
 * Tints are deliberately soft: a full results page carries ~17 badges, and
 * saturated fills at that density make every row shout at the same volume.
 */
const BADGE_STYLES = `
  :host { all: initial; }

  button {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: 6px;
    padding: 1px 7px;
    min-height: 18px;
    min-width: 30px;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 6px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 16px;
    white-space: nowrap;
    vertical-align: middle;
    cursor: help;
    animation: verdct-badge-in 160ms ease-out;
    transition: transform 120ms ease, box-shadow 120ms ease;
  }

  button:hover { transform: translateY(-1px); box-shadow: 0 2px 6px rgba(15, 23, 42, 0.14); }
  button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }

  button.good    { background: #bbf7d0; border-color: #4ade80; color: #14532d; }
  button.fair    { background: #fde68a; border-color: #f59e0b; color: #713f12; }
  button.poor    { background: #fecaca; border-color: #f87171; color: #7f1d1d; }

  /* "No rating" is the absence of an answer, so it recedes instead of competing. */
  button.unknown {
    background: transparent;
    border-color: #d4d4d8;
    border-style: dashed;
    color: #a1a1aa;
    font-weight: 500;
  }

  button.loading {
    background: #f4f4f5;
    border-color: #e4e4e7;
    color: #c4c4cc;
    animation: verdct-badge-pulse 1.4s ease-in-out infinite;
  }

  /* Few ratings: same reading, drawn provisionally. */
  button[data-sample="low"] { border-style: dashed; }

  .marker {
    font-size: 9px;
    font-weight: 700;
    opacity: 0.65;
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
    button { animation: none; transition: none; }
    button:hover { transform: none; }
  }
`;

const POPOVER_STYLES = `
  :host { all: initial; }

  .popover, .caret { pointer-events: none; }

  .popover {
    position: fixed;
    z-index: 2147483647;
    box-sizing: border-box;
    width: 248px;
    padding: 12px 13px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 10px;
    background: #0f172a;
    color: #f8fafc;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 12px;
    line-height: 1.45;
    box-shadow: 0 12px 32px rgba(2, 6, 23, 0.38), 0 2px 8px rgba(2, 6, 23, 0.3);
    animation: verdct-pop-in 130ms ease-out;
  }

  .caret {
    position: fixed;
    z-index: 2147483647;
    width: 9px;
    height: 9px;
    background: #0f172a;
    transform: rotate(45deg);
    animation: verdct-fade-in 130ms ease-out;
  }
  .caret.up   { border-left: 1px solid rgba(148, 163, 184, 0.18); border-top: 1px solid rgba(148, 163, 184, 0.18); }
  .caret.down { border-right: 1px solid rgba(148, 163, 184, 0.18); border-bottom: 1px solid rgba(148, 163, 184, 0.18); }

  .popover[hidden], .caret[hidden] { display: none; }

  .name { font-size: 13px; font-weight: 650; letter-spacing: -0.01em; }
  .source {
    margin-top: 3px;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: #64748b;
  }

  .hero { display: flex; align-items: baseline; gap: 5px; margin: 11px 0 1px; }
  .hero .score { font-size: 27px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
  .hero .score.good { color: #4ade80; }
  .hero .score.fair { color: #fbbf24; }
  .hero .score.poor { color: #f87171; }
  .hero .score.unknown { color: #94a3b8; }
  .hero .out-of { font-size: 11px; color: #64748b; }
  .hero .count { margin-left: auto; font-size: 11px; color: #94a3b8; font-variant-numeric: tabular-nums; }

  .metric { margin-top: 9px; }
  .metric-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
    font-size: 11px;
    color: #cbd5e1;
  }
  .metric-head b { color: #f1f5f9; font-weight: 600; font-variant-numeric: tabular-nums; }

  .track { height: 4px; border-radius: 999px; background: rgba(148, 163, 184, 0.22); overflow: hidden; }
  .fill { height: 100%; border-radius: 999px; }
  .fill.quality    { background: linear-gradient(90deg, #34d399, #10b981); }
  .fill.difficulty { background: linear-gradient(90deg, #fbbf24, #f97316); }
  .fill.retake     { background: linear-gradient(90deg, #38bdf8, #0ea5e9); }

  .note {
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid rgba(148, 163, 184, 0.16);
    font-size: 11px;
    color: #94a3b8;
  }
  .note.plain { margin-top: 6px; padding-top: 0; border-top: 0; }

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

  return fragment;
}

const POPOVER_GAP_PX = 10;
const CARET_HALF_PX = 4;

function showPopover(handle: BadgeHandle): void {
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
  if (!popoverParts) return;
  popoverParts.panel.hidden = true;
  popoverParts.caret.hidden = true;
}

interface BadgeLabel {
  text: string;
  marker: string;
  tone: BadgeTone | 'loading';
  lowSample: boolean;
  aria: string;
}

function badgeLabel(state: BadgeState): BadgeLabel {
  if (state.status === 'loading') {
    return { text: '···', marker: '', tone: 'loading', lowSample: false, aria: 'loading rating' };
  }
  if (state.status === 'error') {
    return { text: '—', marker: '', tone: 'unknown', lowSample: false, aria: 'rating unavailable' };
  }

  const { rating } = state;
  if (rating.matchConfidence === 'none' || rating.overallRating === null || rating.numRatings === 0) {
    return { text: '—', marker: '', tone: 'unknown', lowSample: false, aria: 'no rating found' };
  }

  const lowSample = rating.numRatings < LOW_SAMPLE_RATING_COUNT;
  return {
    text: rating.overallRating.toFixed(1),
    marker: rating.matchConfidence === 'low' ? '?' : '',
    tone: ratingTone(rating),
    lowSample,
    aria:
      `rated ${rating.overallRating.toFixed(1)} out of 5 from ${rating.numRatings} ratings` +
      (lowSample ? ', provisional' : ''),
  };
}

function paintBadge(handle: BadgeHandle): void {
  const { text, marker, tone, lowSample, aria } = badgeLabel(handle.state);
  handle.button.className = tone;
  handle.button.setAttribute('aria-label', `${handle.professorName}: ${aria}`);
  handle.button.textContent = text;

  if (lowSample) {
    handle.button.dataset.sample = 'low';
  } else {
    delete handle.button.dataset.sample;
  }

  if (marker) {
    const markerElement = element('span', 'marker', marker);
    handle.button.append(markerElement);
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
  const button = document.createElement('button');
  button.type = 'button';

  shadow.append(style, button);
  insertHost(section, host);

  const handle: BadgeHandle = {
    professorName: section.professorName,
    button,
    state: { status: 'loading' },
  };

  button.addEventListener('mouseenter', () => showPopover(handle));
  button.addEventListener('focus', () => showPopover(handle));
  button.addEventListener('mouseleave', hidePopover);
  button.addEventListener('blur', hidePopover);

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
  return Boolean(element?.closest(`[${VERDCT_BADGE_ATTRIBUTE}], [${VERDCT_POPOVER_ATTRIBUTE}]`));
}

export function resetBadgeRendererForTests(): void {
  popoverParts = null;
  renderedBadges.clear();
  settings = DEFAULT_SETTINGS;
}
