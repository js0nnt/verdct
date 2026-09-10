import '../src/popup/styles.css';
import { installChromeShim } from './shim';
import type { ScatterPoint } from '../src/shared/scatterGeometry';
import type { ProfessorRating } from '../src/shared/types';

/**
 * Invented professors and section numbers. The UI in these shots is the real
 * shipping code, but the people are fictional: putting a named, real instructor
 * next to a 2.2 and "recent reviews are worse" in a public store listing would
 * not be fair to them. The rating spread is kept realistic so the design is
 * shown under conditions it will actually meet.
 */
interface Row {
  number: string;
  professor: string;
  days: string;
  start: string;
  end: string;
  rating: Partial<ProfessorRating> | null;
}

function rating(over: Partial<ProfessorRating>): ProfessorRating {
  return {
    normalizedName: (over.displayName ?? '').toLowerCase(),
    displayName: 'Unknown',
    overallRating: null,
    difficulty: null,
    wouldTakeAgainPct: null,
    numRatings: 0,
    fetchedAt: Date.now(),
    matchConfidence: 'high',
    trend: null,
    legacyId: 1,
    ...over,
  } as ProfessorRating;
}

const ROWS: Row[] = [
  { number: '10412', professor: 'Adrian Moss', days: 'T Th', start: '9:00 AM', end: '10:15 AM',
    rating: { displayName: 'Adrian Moss', overallRating: 4.7, difficulty: 4.5, wouldTakeAgainPct: 92, numRatings: 34 } },
  { number: '10418', professor: 'Priya Raman', days: 'M W', start: '1:30 PM', end: '2:45 PM',
    rating: { displayName: 'Priya Raman', overallRating: 4.4, difficulty: 2.2, wouldTakeAgainPct: 88, numRatings: 41, trend: 'rising' } },
  { number: '10425', professor: 'Elena Vasquez', days: 'T Th', start: '1:30 PM', end: '2:45 PM',
    rating: { displayName: 'Elena Vasquez', overallRating: 4.3, difficulty: 3.0, wouldTakeAgainPct: 81, numRatings: 227, trend: 'falling' } },
  { number: '10431', professor: 'Marcus Feld', days: 'T Th', start: '10:30 AM', end: '11:45 AM',
    rating: { displayName: 'Marcus Feld', overallRating: 3.4, difficulty: 3.2, wouldTakeAgainPct: 64, numRatings: 58, trend: 'rising' } },
  { number: '10437', professor: 'Nadia Okafor', days: 'T Th', start: '3:00 PM', end: '4:15 PM',
    rating: { displayName: 'Nadia Okafor', overallRating: 3.1, difficulty: 3.4, wouldTakeAgainPct: 55, numRatings: 96, trend: 'rising' } },
  { number: '10442', professor: 'Tomas Lindqvist', days: 'T Th', start: '9:00 AM', end: '10:15 AM',
    rating: { displayName: 'Tomas Lindqvist', overallRating: 2.5, difficulty: 4.1, wouldTakeAgainPct: 31, numRatings: 73 } },
  { number: '10450', professor: 'Iris Delgado', days: 'M W', start: '12:00 PM', end: '1:15 PM',
    rating: { displayName: 'Iris Delgado', overallRating: 2.2, difficulty: 4.3, wouldTakeAgainPct: 22, numRatings: 29 } },
  { number: '10463', professor: 'Samuel Kirby', days: 'T Th', start: '10:30 AM', end: '11:45 AM',
    rating: null },
];

const SCATTER: Record<string, ScatterPoint[]> = {
  'MAT 343': ROWS.filter((r) => r.rating?.overallRating != null).map((r) => ({
    name: r.rating!.displayName!,
    rating: r.rating!.overallRating!,
    difficulty: r.rating!.difficulty!,
    numRatings: r.rating!.numRatings!,
  })),
};

const shot = new URLSearchParams(location.search).get('shot') ?? '1';
const dark = new URLSearchParams(location.search).get('dark') === '1';


installChromeShim({
  courses: SCATTER,
  favorites: [
    { normalizedName: 'adrian moss', displayName: 'Adrian Moss', addedAt: Date.now() },
    { normalizedName: 'priya raman', displayName: 'Priya Raman', addedAt: Date.now() },
  ],
  ratings: {
    'adrian moss': { rating: rating({ displayName: 'Adrian Moss', overallRating: 4.7, numRatings: 34 }), lastAccessedAt: Date.now() },
    'priya raman': { rating: rating({ displayName: 'Priya Raman', overallRating: 4.4, numRatings: 41 }), lastAccessedAt: Date.now() },
  },
  theme: dark ? 'dark' : 'light',
});

const stage = document.querySelector<HTMLElement>('#stage')!;

function el(tag: string, cls = '', text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function header(title: string, highlight: string, sub: string): HTMLElement {
  const wrap = el('div');
  const mark = el('div', 'mark');
  mark.append(el('div', 'glyph'), el('span', '', 'Verdct'));
  const h1 = el('h1');
  h1.innerHTML = `${title} <em>${highlight}</em>`;
  wrap.append(mark, h1, el('p', 'sub', sub));
  return wrap;
}

function browserWindow(inner: HTMLElement, width: number): HTMLElement {
  const win = el('div', 'window');
  win.style.width = `${width}px`;
  const chrome = el('div', 'chrome');
  for (const color of ['#ff5f57', '#febc2e', '#28c840']) {
    const d = el('div', 'dot');
    d.style.background = color;
    chrome.append(d);
  }
  chrome.append(el('div', 'url', 'catalog.apps.asu.edu/catalog/classes'));
  win.append(chrome, inner);
  return win;
}

/** Builds the results table and lets the real renderer badge it. */
async function buildTable(rows: Row[]): Promise<HTMLElement> {
  const { upsertBadge } = await import('../src/content/badgeRenderer');
  const { recordSection } = await import('../src/content/bestSection');
  const { configureFavorites } = await import('../src/content/badgeRenderer');
  configureFavorites(new Set(['adrian moss', 'priya raman']));

  const table = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['Course', 'Title', 'Number', 'Instructor(s)', 'Days', 'Start', 'End']) {
    headRow.append(el('th', '', label));
  }
  thead.append(headRow);
  const tbody = el('tbody');

  for (const row of rows) {
    const tr = el('tr');
    tr.className = 'class-accordion';
    tr.append(el('td', '', 'MAT 343'), el('td', '', 'Applied Linear Algebra'), el('td', 'muted', row.number));

    const instructor = el('td', 'instructor');
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = row.professor;
    instructor.append(link);
    tr.append(instructor);

    tr.append(el('td', 'muted', row.days), el('td', 'muted', row.start), el('td', 'muted', row.end));
    tbody.append(tr);

    const section = {
      courseId: 'MAT 343',
      professorName: row.professor,
      rowElement: tr,
      instructorElement: instructor,
    };
    const state = row.rating
      ? ({ status: 'ready', rating: rating(row.rating) } as const)
      : ({ status: 'ready', rating: rating({ displayName: row.professor, matchConfidence: 'none', legacyId: null }) } as const);
    upsertBadge(section, state);
    recordSection(section, state);
  }

  table.append(thead, tbody);
  return table;
}

async function mountPopup(width = 320): Promise<HTMLElement> {
  const [{ createRoot }, { App }] = await Promise.all([
    import('react-dom/client'),
    import('../src/popup/App'),
  ]);
  const frame = el('div', 'popup-frame');
  frame.style.width = `${width}px`;
  stage.append(frame);
  createRoot(frame).render((await import('react')).createElement(App));
  await new Promise((r) => setTimeout(r, 400));
  return frame;
}

async function highlightBest(): Promise<void> {
  const { evaluateBestSections } = await import('../src/content/bestSection');
  evaluateBestSections();
}

/** Opens the real popover on a named badge, as a hover would. */
function openPopover(professor: string): void {
  const host = [...document.querySelectorAll('[data-verdct-badge]')].find(
    (node) => node.getAttribute('data-verdct-badge') === professor,
  );
  host?.shadowRoot?.querySelector('a')?.dispatchEvent(new MouseEvent('mouseenter'));
}

async function mountPopupInto(frame: HTMLElement, tab?: 'Settings'): Promise<void> {
  const [{ createRoot }, { App }, React] = await Promise.all([
    import('react-dom/client'),
    import('../src/popup/App'),
    import('react'),
  ]);
  createRoot(frame).render(React.createElement(App));
  await new Promise((r) => setTimeout(r, 500));
  if (tab) {
    const button = [...frame.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === tab,
    );
    button?.click();
    await new Promise((r) => setTimeout(r, 250));
  }
}

function callouts(items: Array<[string, string]>): HTMLElement {
  const wrap = el('div', 'callouts');
  for (const [title, body] of items) {
    const c = el('div', 'callout');
    c.append(el('div', 'tick', '✓'));
    const text = el('div');
    text.append(el('b', '', title), el('span', '', body));
    c.append(text);
    wrap.append(text.parentElement === c ? c : c);
  }
  return wrap;
}

async function render(): Promise<void> {
  const root = el('div', dark ? 'stage dark' : 'stage');
  stage.append(root);
  // Named so nobody reads these as real instructors' scores.
  const footnote = el(
    'div',
    'footnote',
    'Interface shown is the real extension. Professors, section numbers and ratings are illustrative.',
  );

  if (shot === '1') {
    root.append(header('Every professor rated,', 'before you register.', 'Verdct puts RateMyProfessor scores, difficulty and rating trends directly into ASU Class Search. No second tab.'));
    const content = el('div', 'content');
    content.append(browserWindow(await buildTable(ROWS), 1010));
    root.append(content);
    await highlightBest();
  }

  if (shot === '2') {
    root.append(header('The whole picture,', 'on hover.', 'Difficulty, would-take-again, how many ratings back the score, and whether recent reviews are better or worse than older ones.'));
    const content = el('div', 'content');
    content.style.alignItems = 'flex-start';
    content.append(browserWindow(await buildTable(ROWS.slice(0, 4)), 900));
    root.append(content);
    const notes = callouts([
      ['Two kinds of best', 'Highest rated, and best once difficulty is counted.'],
      ['One click to the source', 'The badge links straight to the full RateMyProfessor page.'],
    ]);
    notes.style.marginTop = '0';
    root.append(notes);
    await highlightBest();
    // Let the badge settle before the popover is positioned against it.
    await new Promise((r) => setTimeout(r, 150));
    openPopover('Priya Raman');
  }

  if (shot === '3') {
    root.append(header('Compare every section', 'at a glance.', 'Quality against difficulty for every professor teaching the course, so the trade-off is obvious before you pick a time slot.'));
    const content = el('div', 'content');
    content.style.justifyContent = 'flex-start';
    content.style.gap = '52px';
    const frame = el('div', 'popup-frame');
    frame.style.width = '340px';
    content.append(frame, browserWindow(await buildTable(ROWS.slice(0, 6)), 760));
    root.append(content);
    await highlightBest();
    await mountPopupInto(frame);
  }

  if (shot === '4') {
    root.append(header('Yours to tune,', 'and nobody else’s.', 'Light, dark or automatic. Set your own colour thresholds and how long ratings are kept.'));
    const content = el('div', 'content');
    content.style.justifyContent = 'flex-start';
    content.style.gap = '48px';
    const frame = el('div', 'popup-frame');
    frame.style.width = '340px';
    content.append(frame);
    root.append(content);
    await mountPopupInto(frame, 'Settings');

    const notes = callouts([
      ['No account, ever', 'Verdct has no server. There is nowhere to send your data.'],
      ['Stored on your machine', 'Ratings are cached locally so a revisited page is instant.'],
      ['Open source', 'Every claim above is checkable against the code.'],
    ]);
    notes.style.flexDirection = 'column';
    notes.style.gap = '20px';
    notes.style.marginTop = '0';
    content.append(notes);
  }

  root.append(footnote);
}

void render().then(() => {
  document.body.dataset.ready = 'true';
});
