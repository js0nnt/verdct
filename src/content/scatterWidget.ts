import { VERDCT_SCATTER_ATTRIBUTE } from '../shared/constants';
import type { ProfessorRating } from '../shared/types';
import { ratingTone } from './badgeRenderer';

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
    gap: 7px;
    padding: 9px 14px;
    border: 0;
    border-radius: 999px;
    background: #0f172a;
    color: #f8fafc;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 6px 20px rgba(2, 6, 23, 0.32);
    transition: transform 130ms ease, box-shadow 130ms ease;
  }
  .launcher:hover { transform: translateY(-1px); box-shadow: 0 10px 26px rgba(2, 6, 23, 0.4); }
  .launcher:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
  .launcher .dot { width: 7px; height: 7px; border-radius: 999px; background: #4ade80; }

  .panel {
    bottom: 18px;
    width: 388px;
    padding: 14px 15px 12px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    background: #0f172a;
    color: #f8fafc;
    box-shadow: 0 18px 48px rgba(2, 6, 23, 0.45);
    animation: verdct-scatter-in 150ms ease-out;
  }
  .panel[hidden], .launcher[hidden] { display: none; }

  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .title { font-size: 13px; font-weight: 650; letter-spacing: -0.01em; }
  .close {
    all: unset;
    padding: 2px 6px;
    border-radius: 5px;
    color: #94a3b8;
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }
  .close:hover { background: rgba(148, 163, 184, 0.16); color: #f1f5f9; }
  .close:focus-visible { outline: 2px solid #38bdf8; }

  .courses { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
  .course {
    all: unset;
    padding: 2px 8px;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 999px;
    color: #cbd5e1;
    font-size: 10.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .course[aria-pressed="true"] { background: #1e293b; border-color: #38bdf8; color: #f8fafc; }

  .hint { margin-top: 9px; font-size: 10.5px; color: #64748b; }
  svg { display: block; margin-top: 4px; overflow: visible; }
  .axis-line { stroke: rgba(148, 163, 184, 0.35); stroke-width: 1; }
  .grid { stroke: rgba(148, 163, 184, 0.12); stroke-width: 1; }
  .axis-text { fill: #64748b; font-size: 9px; }
  .axis-title { fill: #94a3b8; font-size: 10px; font-weight: 600; }
  .zone { font-size: 8.5px; font-weight: 600; letter-spacing: 0.04em; }
  .zone.good { fill: rgba(74, 222, 128, 0.5); }
  .zone.bad  { fill: rgba(248, 113, 113, 0.45); }
  .point { stroke: #0f172a; stroke-width: 1.5; cursor: default; }
  .point.good { fill: #4ade80; }
  .point.fair { fill: #fbbf24; }
  .point.poor { fill: #f87171; }
  .point.unknown { fill: #94a3b8; }
  .label { fill: #e2e8f0; font-size: 9px; font-weight: 600; pointer-events: none; }

  @keyframes verdct-scatter-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel { animation: none; }
    .launcher { transition: none; }
    .launcher:hover { transform: none; }
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
