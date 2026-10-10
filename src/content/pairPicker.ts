import { VERDCT_PICKER_ATTRIBUTE } from '../shared/constants';
import { formatClockTime } from '../shared/schedule';
import type { CatalogSection, ComponentChoice } from './asuCatalog';
import { FLOATING_TOKENS } from './theme';

/**
 * The panel that opens when a lecture needs a recitation or lab. It lists
 * every section ASU allows alongside that lecture, one group per component,
 * and plans nothing until one of each has been chosen: the schedule should
 * never hold a lecture that ASU would refuse to enroll you in on its own.
 */
const PICKER_STYLES = `
  :host { all: initial; }
  ${FLOATING_TOKENS}

  .panel {
    position: fixed;
    z-index: 2147483646;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 344px;
    max-height: min(460px, calc(100vh - 24px));
    border: 1px solid var(--v-border);
    border-radius: 14px;
    background: var(--v-surface);
    color: var(--v-text);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 18px 48px -12px var(--v-shadow-strong), 0 2px 6px var(--v-shadow);
    animation: enter 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
    transform-origin: var(--origin, top left);
  }
  .panel.closing { animation: leave 140ms ease-in forwards; }

  header { padding: 14px 16px 10px; }
  h2 { margin: 0; font-size: 13px; font-weight: 700; letter-spacing: -0.01em; }
  header p { margin: 3px 0 0; color: var(--v-text-muted); font-size: 11.5px; }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 8px 8px;
  }

  /* A thin floating thumb, like the popup's, rather than the browser's own bar. */
  .body::-webkit-scrollbar { width: 10px; }
  .body::-webkit-scrollbar-track { background: transparent; }
  .body::-webkit-scrollbar-thumb {
    border: 3px solid transparent;
    border-radius: 999px;
    background-color: var(--v-border-strong);
    background-clip: content-box;
  }

  .group + .group { margin-top: 8px; }
  .label {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    justify-content: space-between;
    padding: 8px 8px 6px;
    background: var(--v-surface);
    color: var(--v-text-faint);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .label .done { color: var(--v-good); letter-spacing: 0.04em; }

  .option {
    all: unset;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 16px 1fr auto;
    gap: 2px 10px;
    align-items: start;
    width: 100%;
    padding: 8px;
    border-radius: 9px;
    cursor: pointer;
    transition: background-color 140ms ease-out;
  }
  .option:hover { background: var(--v-surface-sunken); }
  .option:focus-visible { outline: 2px solid var(--v-text); outline-offset: -2px; }
  .option[aria-checked="true"] { background: var(--v-surface-sunken); }

  .radio {
    grid-row: span 2;
    width: 14px;
    height: 14px;
    margin-top: 1px;
    border: 1.5px solid var(--v-border-strong);
    border-radius: 999px;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    transition: border-color 140ms ease-out;
  }
  .radio::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--v-text);
    transform: scale(0);
    transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .option[aria-checked="true"] .radio { border-color: var(--v-text); }
  .option[aria-checked="true"] .radio::after { transform: scale(1); }

  .when { font-weight: 600; font-variant-numeric: tabular-nums; }
  .where { grid-column: 2; color: var(--v-text-muted); font-size: 11px; }
  .seats {
    grid-row: span 2;
    color: var(--v-text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }
  .seats.full { color: var(--v-poor); font-weight: 600; }
  .clash {
    grid-column: 2 / 4;
    color: var(--v-fair);
    font-size: 10.5px;
    font-weight: 600;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px 12px;
    border-top: 1px solid var(--v-border);
  }
  .progress { flex: 1; color: var(--v-text-muted); font-size: 11px; }
  footer button {
    all: unset;
    box-sizing: border-box;
    height: 30px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 140ms ease-out, transform 140ms ease-out;
  }
  footer button:active { transform: scale(0.96); }
  footer button:focus-visible { outline: 2px solid var(--v-text); outline-offset: 2px; }
  .cancel { color: var(--v-text-muted); }
  .cancel:hover { color: var(--v-text); }
  .confirm { background: var(--v-text); color: var(--v-surface); }
  .confirm:disabled { opacity: 0.35; cursor: default; transform: none; }

  .error { margin: 0; padding: 0 16px 10px; color: var(--v-poor); font-size: 11px; }

  @keyframes enter {
    from { opacity: 0; transform: translateY(-4px) scale(0.97); }
    to { opacity: 1; transform: none; }
  }
  @keyframes leave {
    to { opacity: 0; transform: translateY(-2px) scale(0.98); }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel, .panel.closing { animation-duration: 1ms; }
    .radio::after, .option, footer button { transition: none; }
  }
`;

const EDGE_GAP_PX = 12;
const ANCHOR_GAP_PX = 8;

export interface PairPickerOptions {
  anchor: HTMLElement;
  lecture: CatalogSection;
  choices: ComponentChoice[];
  /** What a candidate would overlap in the current schedule, already phrased. */
  clashesFor: (section: CatalogSection) => string[];
  /** Pre-selected class numbers by component, when re-pairing a planned lecture. */
  selected?: Map<string, string>;
  onConfirm: (chosen: CatalogSection[]) => Promise<void>;
}

interface OpenPicker {
  host: HTMLElement;
  panel: HTMLElement;
  anchor: HTMLElement;
  cleanup: () => void;
}

let open: OpenPicker | null = null;
let theme = 'auto';

/** Applies the user's light/dark choice; the panel floats above the page, like the tooltip. */
export function configurePickerTheme(next: string): void {
  theme = next;
  open?.host.setAttribute('data-theme', next);
}

export function isPairPickerOpen(): boolean {
  return open !== null;
}

function describeWhen(section: CatalogSection): string {
  if (section.meetings.length === 0) return 'No meeting time';
  return section.meetings
    .map(
      (meeting) =>
        `${meeting.days.join(' ')} ${formatClockTime(meeting.startMinutes)}–` +
        `${formatClockTime(meeting.endMinutes)}`,
    )
    .join(', ');
}

function describeWhere(section: CatalogSection): string {
  return [section.location, section.instructors.join(', ')].filter(Boolean).join(' · ') || ' ';
}

/** "Recitation", "Laboratory" → "recitation", "lab", for running text. */
export function componentNoun(component: string): string {
  const lower = component.toLowerCase();
  return lower === 'laboratory' ? 'lab' : lower;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function position(panel: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const height = panel.offsetHeight;
  const width = panel.offsetWidth;
  const below = rect.bottom + ANCHOR_GAP_PX + height <= window.innerHeight - EDGE_GAP_PX;

  // Clamped both ways, so the whole panel stays on screen even when the button
  // it belongs to has been scrolled partly out of view.
  const top = Math.min(
    Math.max(
      EDGE_GAP_PX,
      below ? rect.bottom + ANCHOR_GAP_PX : rect.top - ANCHOR_GAP_PX - height,
    ),
    window.innerHeight - height - EDGE_GAP_PX,
  );
  const left = Math.max(
    EDGE_GAP_PX,
    Math.min(rect.left, window.innerWidth - width - EDGE_GAP_PX),
  );

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
  // Grows out of the button it belongs to, from whichever side it opened on.
  panel.style.setProperty('--origin', `${rect.left - left}px ${below ? 'top' : 'bottom'}`);
}

export function closePairPicker(): void {
  const current = open;
  if (!current) return;
  open = null;
  current.cleanup();

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduced) {
    current.host.remove();
  } else {
    current.panel.classList.add('closing');
    current.panel.addEventListener('animationend', () => current.host.remove(), { once: true });
    // In case the animation never runs, as in a background tab.
    window.setTimeout(() => current.host.remove(), 300);
  }
  if (current.anchor.isConnected) current.anchor.focus({ preventScroll: true });
}

export function openPairPicker(options: PairPickerOptions): void {
  closePairPicker();

  const { anchor, lecture, choices, clashesFor, onConfirm } = options;
  const chosen = new Map<string, CatalogSection>();
  for (const choice of choices) {
    const preselected = options.selected?.get(choice.component);
    const match = choice.options.find((option) => option.classNumber === preselected);
    if (match) chosen.set(choice.component, match);
  }

  const host = element('div');
  host.setAttribute(VERDCT_PICKER_ATTRIBUTE, lecture.classNumber);
  host.setAttribute('data-theme', theme);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = element('style');
  style.textContent = PICKER_STYLES;

  const panel = element('div', 'panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');

  const nouns = choices.map((choice) => componentNoun(choice.component));
  const header = element('header');
  const title = element('h2', '', `Pair ${lecture.courseId} (${lecture.classNumber})`);
  title.id = 'verdct-picker-title';
  panel.setAttribute('aria-labelledby', title.id);
  header.append(
    title,
    element(
      'p',
      '',
      `ASU enrolls you in this ${componentNoun(lecture.component)} together with a ` +
        `${nouns.join(' and a ')}. Pick ${choices.length > 1 ? 'one of each' : 'one'} to plan them together.`,
    ),
  );

  const body = element('div', 'body');
  const groupLabels = new Map<string, HTMLElement>();
  const optionButtons: HTMLButtonElement[] = [];

  for (const choice of choices) {
    const group = element('div', 'group');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', choice.component);

    const label = element('div', 'label');
    label.append(element('span', '', `${choice.component} · ${choice.options.length}`));
    groupLabels.set(choice.component, label);
    group.append(label);

    for (const option of choice.options) {
      const button = element('button', 'option');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.dataset.component = choice.component;
      button.dataset.classNumber = option.classNumber;

      const seats = element('span', 'seats');
      if (option.seatsOpen === 0) {
        seats.classList.add('full');
        seats.textContent = 'Full';
      } else if (option.seatsOpen !== null) {
        seats.textContent = `${option.seatsOpen} open`;
      }

      button.append(
        element('span', 'radio'),
        element('span', 'when', describeWhen(option)),
        seats,
        element('span', 'where', describeWhere(option)),
      );

      const clashes = clashesFor(option);
      if (clashes.length > 0) {
        button.append(element('span', 'clash', `Overlaps ${clashes.join(', ')}`));
      }

      button.setAttribute(
        'aria-label',
        `${choice.component} ${option.classNumber}, ${describeWhen(option)}, ` +
          `${describeWhere(option)}${seats.textContent ? `, ${seats.textContent}` : ''}` +
          `${clashes.length > 0 ? `, overlaps ${clashes.join(', ')}` : ''}`,
      );

      button.addEventListener('click', () => {
        chosen.set(choice.component, option);
        refresh();
      });
      optionButtons.push(button);
      group.append(button);
    }
    body.append(group);
  }

  const error = element('p', 'error');
  error.hidden = true;

  const footer = element('footer');
  const progress = element('span', 'progress');
  progress.setAttribute('aria-live', 'polite');
  const cancel = element('button', 'cancel', 'Cancel');
  cancel.type = 'button';
  const confirm = element('button', 'confirm');
  confirm.type = 'button';
  footer.append(progress, cancel, confirm);

  panel.append(header, body, error, footer);
  shadow.append(style, panel);
  document.body.append(host);

  function refresh(): void {
    for (const button of optionButtons) {
      const picked = chosen.get(button.dataset.component ?? '');
      const checked = picked?.classNumber === button.dataset.classNumber;
      button.setAttribute('aria-checked', String(checked));
      // One stop per group for the keyboard, on the picked option or the first.
      button.tabIndex = -1;
    }
    for (const choice of choices) {
      const buttons = optionButtons.filter((button) => button.dataset.component === choice.component);
      const target =
        buttons.find((button) => button.getAttribute('aria-checked') === 'true') ?? buttons[0];
      if (target) target.tabIndex = 0;

      const label = groupLabels.get(choice.component);
      label?.querySelector('.done')?.remove();
      const picked = chosen.get(choice.component);
      if (picked && label) label.append(element('span', 'done', `✓ ${picked.classNumber}`));
    }

    const complete = chosen.size === choices.length;
    confirm.disabled = !complete;
    const total = 1 + choices.length;
    confirm.textContent = `Plan ${total} sections`;
    progress.textContent = complete
      ? 'Ready to plan'
      : `${chosen.size} of ${choices.length} chosen`;
  }

  refresh();
  position(panel, anchor);

  // Arrow keys move within a group, as radio buttons do.
  body.addEventListener('keydown', (event) => {
    const current = event.target as HTMLElement;
    if (!current.classList?.contains('option')) return;
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? -1
        : 0;
    if (step === 0) return;
    event.preventDefault();
    const siblings = optionButtons.filter(
      (button) => button.dataset.component === current.dataset.component,
    );
    const next = siblings[(siblings.indexOf(current as HTMLButtonElement) + step + siblings.length) % siblings.length];
    next?.click();
    next?.focus();
  });

  cancel.addEventListener('click', closePairPicker);
  confirm.addEventListener('click', () => {
    if (chosen.size !== choices.length) return;
    confirm.disabled = true;
    error.hidden = true;
    const picked = choices.map((choice) => chosen.get(choice.component)!);
    void onConfirm(picked).then(closePairPicker, (failure: unknown) => {
      error.textContent =
        failure instanceof Error && failure.message
          ? failure.message
          : 'Could not save to your schedule.';
      error.hidden = false;
      confirm.disabled = false;
    });
  });

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closePairPicker();
    }
  };
  const onPointer = (event: PointerEvent): void => {
    const path = event.composedPath();
    if (path.includes(host) || path.includes(anchor)) return;
    closePairPicker();
  };
  const onViewport = (): void => {
    if (!anchor.isConnected) {
      closePairPicker();
      return;
    }
    position(panel, anchor);
  };

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('scroll', onViewport, { capture: true, passive: true });
  window.addEventListener('resize', onViewport);

  open = {
    host,
    panel,
    anchor,
    cleanup: () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('scroll', onViewport, true);
      window.removeEventListener('resize', onViewport);
    },
  };

  const first = optionButtons.find((button) => button.tabIndex === 0);
  first?.focus({ preventScroll: true });
}
