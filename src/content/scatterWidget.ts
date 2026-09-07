import { VERDCT_SCATTER_ATTRIBUTE } from '../shared/constants';
import type { ProfessorRating } from '../shared/types';
import { ratingTone } from './badgeRenderer';
import { ACCENT_GRADIENT, FLOATING_TOKENS } from './theme';

/**
 * The spec calls for this to open from a course header, but ASU's results are a
 * flat list of sections with no per-course header element to attach to. A
 * floating launcher is discoverable regardless of markup, and it still handles
 * a result set spanning several courses via the course pills.
 */
const MIN_POINTS_TO_OFFER = 3;

interface ScatterPoint {
  name: string;
  rating: number;
  difficulty: number;
  numRatings: number;
}

const pointsByCourse = new Map<string, Map<string, ScatterPoint>>();
let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let activeCourse: string | null = null;
let open = false;

const STYLES = `
  :host { all: initial; }
  ${FLOATING_TOKENS}

  .launcher, .panel {
    position: fixed;
    right: 18px;
    z-index: 2147483646;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    box-sizing: border-box;
  }

  .launcher {
    bottom: 18px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    border: 1px solid var(--v-border);
    border-radius: 999px;
    background: var(--v-surface);
    color: var(--v-text);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 6px 20px var(--v-shadow);
    transition: border-color 130ms ease, box-shadow 130ms ease;
  }
  .launcher:hover { border-color: var(--v-border-strong); box-shadow: 0 10px 26px var(--v-shadow-strong); }
  .launcher:focus-visible { outline: 2px solid var(--v-text); outline-offset: 2px; }
  /* The single saturated element, matching the extension mark. */
  .launcher .dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: ${ACCENT_GRADIENT};
  }

  .panel {
    bottom: 18px;
    width: 388px;
    padding: 14px 15px 12px;
    border: 1px solid var(--v-border);
    border-radius: 12px;
    background: var(--v-surface);
    color: var(--v-text);
    box-shadow: 0 18px 48px var(--v-shadow-strong);
    animation: verdct-scatter-in 150ms ease-out;
  }
  .panel[hidden], .launcher[hidden] { display: none; }

  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .title { font-size: 13px; font-weight: 650; letter-spacing: -0.01em; }
  .close {
    all: unset;
    padding: 2px 6px;
    border-radius: 5px;
    color: var(--v-text-faint);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }
  .close:hover { background: var(--v-surface-sunken); color: var(--v-text); }
  .close:focus-visible { outline: 2px solid var(--v-text); }

  .courses { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
  .course {
    all: unset;
    padding: 2px 8px;
    border: 1px solid var(--v-border);
    border-radius: 999px;
    color: var(--v-text-muted);
    font-size: 10.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .course[aria-pressed="true"] {
    background: var(--v-surface-sunken);
    border-color: var(--v-border-strong);
    color: var(--v-text);
  }

  .hint { margin-top: 9px; font-size: 10.5px; color: var(--v-text-faint); }
  svg { display: block; margin-top: 4px; overflow: visible; }
  .axis-line { stroke: var(--v-border-strong); stroke-width: 1; }
  .grid { stroke: var(--v-border); stroke-width: 1; }
  .axis-text { fill: var(--v-text-faint); font-size: 9px; }
  .axis-title { fill: var(--v-text-muted); font-size: 10px; font-weight: 600; }
  .zone { font-size: 8.5px; font-weight: 600; letter-spacing: 0.04em; }
  .zone.good { fill: var(--v-good); opacity: 0.75; }
  .zone.bad  { fill: var(--v-poor); opacity: 0.7; }
  .point { stroke: var(--v-surface); stroke-width: 1.5; cursor: default; }
  .point.good { fill: var(--v-good); }
  .point.fair { fill: var(--v-fair); }
  .point.poor { fill: var(--v-poor); }
  .point.unknown { fill: var(--v-text-faint); }
  .label { fill: var(--v-text); font-size: 9px; font-weight: 600; pointer-events: none; }

  @keyframes verdct-scatter-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel { animation: none; }
    .launcher { transition: none; }
  }
`;

/** Records a rated professor for the scatter. Unrated entries carry no position. */
export function recordScatterPoint(courseId: string, rating: ProfessorRating): void {
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

function coursesWorthPlotting(): string[] {
  return [...pointsByCourse.entries()]
    .filter(([, points]) => points.size >= MIN_POINTS_TO_OFFER)
    .map(([courseId]) => courseId)
    .sort();
}

const svgNS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

const PLOT = { width: 356, height: 232, left: 30, right: 8, top: 14, bottom: 26 };
const SCALE_MIN = 1;
const SCALE_MAX = 5;

function xFor(difficulty: number): number {
  const inner = PLOT.width - PLOT.left - PLOT.right;
  return PLOT.left + ((difficulty - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * inner;
}

function yFor(rating: number): number {
  const inner = PLOT.height - PLOT.top - PLOT.bottom;
  return PLOT.top + inner - ((rating - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * inner;
}

/** Bigger dot means more reviews behind the point. */
function radiusFor(numRatings: number): number {
  return Math.min(9, 3.5 + Math.sqrt(numRatings) * 0.45);
}

function buildChart(points: ScatterPoint[]): SVGElement {
  const svg = svgEl('svg', {
    width: PLOT.width,
    height: PLOT.height,
    viewBox: `0 0 ${PLOT.width} ${PLOT.height}`,
    role: 'img',
    'aria-label': 'Professor rating plotted against course difficulty',
  });

  for (let tick = SCALE_MIN; tick <= SCALE_MAX; tick += 1) {
    svg.append(
      svgEl('line', { class: 'grid', x1: xFor(tick), y1: PLOT.top, x2: xFor(tick), y2: PLOT.height - PLOT.bottom }),
      svgEl('line', { class: 'grid', x1: PLOT.left, y1: yFor(tick), x2: PLOT.width - PLOT.right, y2: yFor(tick) }),
      svgEl('text', { class: 'axis-text', x: xFor(tick), y: PLOT.height - PLOT.bottom + 12, 'text-anchor': 'middle' }, String(tick)),
      svgEl('text', { class: 'axis-text', x: PLOT.left - 6, y: yFor(tick) + 3, 'text-anchor': 'end' }, String(tick)),
    );
  }

  // Label boxes already claimed, so overlapping points do not print a blob of
  // text over each other. Zone captions are reserved first.
  const claimed: Array<[number, number, number, number]> = [];
  const LABEL_HEIGHT = 10;
  const charWidth = 5;

  function overlaps(box: [number, number, number, number]): boolean {
    return claimed.some(
      (other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1],
    );
  }

  svg.append(
    svgEl('line', { class: 'axis-line', x1: PLOT.left, y1: PLOT.top, x2: PLOT.left, y2: PLOT.height - PLOT.bottom }),
    svgEl('line', { class: 'axis-line', x1: PLOT.left, y1: PLOT.height - PLOT.bottom, x2: PLOT.width - PLOT.right, y2: PLOT.height - PLOT.bottom }),
    svgEl('text', { class: 'axis-title', x: (PLOT.left + PLOT.width - PLOT.right) / 2, y: PLOT.height - 2, 'text-anchor': 'middle' }, 'Difficulty →'),
    svgEl('text', { class: 'axis-title', x: 9, y: (PLOT.top + PLOT.height - PLOT.bottom) / 2, 'text-anchor': 'middle', transform: `rotate(-90 9 ${(PLOT.top + PLOT.height - PLOT.bottom) / 2})` }, 'Rating →'),
    // Naming the corners saves the reader from decoding the axes.
    svgEl('text', { class: 'zone good', x: PLOT.left + 4, y: PLOT.top + 9 }, 'EASY + LOVED'),
    svgEl('text', { class: 'zone bad', x: PLOT.width - PLOT.right - 4, y: PLOT.height - PLOT.bottom - 4, 'text-anchor': 'end' }, 'HARD + DISLIKED'),
  );

  claimed.push(
    [PLOT.left + 4, PLOT.top + 1, PLOT.left + 4 + 'EASY + LOVED'.length * 4.6, PLOT.top + 11],
    [
      PLOT.width - PLOT.right - 4 - 'HARD + DISLIKED'.length * 4.6,
      PLOT.height - PLOT.bottom - 12,
      PLOT.width - PLOT.right - 4,
      PLOT.height - PLOT.bottom - 2,
    ],
  );

  // Largest first, so a heavily-rated professor never hides a lightly-rated one.
  for (const point of [...points].sort((a, b) => b.numRatings - a.numRatings)) {
    const tone = ratingTone({
      overallRating: point.rating,
      numRatings: point.numRatings,
    } as ProfessorRating);
    const cx = xFor(point.difficulty);
    const cy = yFor(point.rating);

    const circle = svgEl('circle', { class: `point ${tone}`, cx, cy, r: radiusFor(point.numRatings) });
    circle.append(
      svgEl('title', {}, `${point.name} — ${point.rating.toFixed(1)}/5, difficulty ${point.difficulty.toFixed(1)}/5, ${point.numRatings} ratings`),
    );

    svg.append(circle);

    const lastName = point.name.split(' ').at(-1) ?? point.name;
    const halfWidth = (lastName.length * charWidth) / 2;
    const radius = radiusFor(point.numRatings);

    // Prefer above the dot, fall back to below, and drop the label rather than
    // print it over a neighbour. The hover tooltip still names every point.
    for (const baseline of [cy - radius - 4, cy + radius + LABEL_HEIGHT]) {
      const box: [number, number, number, number] = [
        cx - halfWidth,
        baseline - LABEL_HEIGHT,
        cx + halfWidth,
        baseline,
      ];
      if (overlaps(box)) continue;

      claimed.push(box);
      svg.append(
        svgEl('text', { class: 'label', x: cx, y: baseline, 'text-anchor': 'middle' }, lastName),
      );
      break;
    }
  }

  return svg;
}

function render(): void {
  if (!shadow) return;
  const courses = coursesWorthPlotting();
  const launcher = shadow.querySelector<HTMLButtonElement>('.launcher')!;
  const panel = shadow.querySelector<HTMLElement>('.panel')!;

  if (courses.length === 0) {
    launcher.hidden = true;
    panel.hidden = true;
    return;
  }

  if (!activeCourse || !courses.includes(activeCourse)) activeCourse = courses[0];
  const points = [...(pointsByCourse.get(activeCourse)?.values() ?? [])];

  launcher.hidden = open;
  launcher.replaceChildren(
    Object.assign(document.createElement('span'), { className: 'dot' }),
    document.createTextNode(`Compare ${points.length} professors`),
  );

  panel.hidden = !open;
  if (!open) return;

  const head = document.createElement('div');
  head.className = 'head';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = `${activeCourse} — quality vs difficulty`;
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close comparison');
  close.textContent = '×';
  close.addEventListener('click', () => {
    open = false;
    render();
  });
  head.append(title, close);

  const children: (Node | SVGElement)[] = [head];

  if (courses.length > 1) {
    const pills = document.createElement('div');
    pills.className = 'courses';
    for (const courseId of courses) {
      const pill = document.createElement('button');
      pill.className = 'course';
      pill.type = 'button';
      pill.textContent = courseId;
      pill.setAttribute('aria-pressed', String(courseId === activeCourse));
      pill.addEventListener('click', () => {
        activeCourse = courseId;
        render();
      });
      pills.append(pill);
    }
    children.push(pills);
  }

  children.push(buildChart(points));

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Dot size reflects how many ratings back each professor.';
  children.push(hint);

  panel.replaceChildren(...children);
}

function ensureHost(): void {
  if (host?.isConnected) return;

  host = document.createElement('div');
  host.setAttribute(VERDCT_SCATTER_ATTRIBUTE, '');
  shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;

  const launcher = document.createElement('button');
  launcher.className = 'launcher';
  launcher.type = 'button';
  launcher.hidden = true;
  launcher.addEventListener('click', () => {
    open = true;
    render();
  });

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Quality versus difficulty comparison');
  panel.hidden = true;

  shadow.append(style, launcher, panel);
  document.body.append(host);
}

/** Rebuilds the launcher and, if it is open, the panel. */
export function refreshScatter(): void {
  if (pointsByCourse.size === 0) return;
  ensureHost();
  render();
}

export function resetScatterForTests(): void {
  pointsByCourse.clear();
  host?.remove();
  host = null;
  shadow = null;
  activeCourse = null;
  open = false;
}
