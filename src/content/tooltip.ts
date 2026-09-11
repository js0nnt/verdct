import { VERDCT_TOOLTIP_ATTRIBUTE } from '../shared/constants';
import { FLOATING_TOKENS } from './theme';

/**
 * One shared tooltip for Verdct's small on-page controls — the award chips and
 * the schedule buttons. A real element rather than a title attribute: the chips
 * advertised an explanation with a help cursor, but the native tooltip never
 * appeared reliably from inside a shadow root, so the promise went unmet.
 */
const TOOLTIP_STYLES = `
  :host { all: initial; }
  ${FLOATING_TOKENS}

  .tip {
    position: fixed;
    z-index: 2147483647;
    box-sizing: border-box;
    max-width: 240px;
    padding: 8px 10px;
    border: 1px solid var(--v-border);
    border-radius: 8px;
    background: var(--v-surface);
    color: var(--v-text);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 11.5px;
    line-height: 1.4;
    box-shadow: 0 8px 22px var(--v-shadow-strong);
    pointer-events: none;
  }
  .tip[hidden] { display: none; }
  .tip b { display: block; margin-bottom: 3px; font-size: 11px; }
`;

const TOOLTIP_GAP_PX = 8;

let tooltipPanel: HTMLElement | null = null;

function tooltip(): HTMLElement {
  if (tooltipPanel?.isConnected) return tooltipPanel;

  const host = document.createElement('div');
  host.setAttribute(VERDCT_TOOLTIP_ATTRIBUTE, '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = TOOLTIP_STYLES;
  const panel = document.createElement('div');
  panel.className = 'tip';
  panel.setAttribute('role', 'tooltip');
  panel.hidden = true;
  shadow.append(style, panel);
  document.body.append(host);

  tooltipPanel = panel;
  return panel;
}

/** Applies the user's light/dark choice to the tooltip, which floats above the page. */
export function configureTooltipTheme(theme: string): void {
  document.querySelector(`[${VERDCT_TOOLTIP_ATTRIBUTE}]`)?.setAttribute('data-theme', theme);
}

export function showTooltip(anchor: HTMLElement, title: string, body: string): void {
  const panel = tooltip();
  panel.replaceChildren();
  const heading = document.createElement('b');
  heading.textContent = title;
  panel.append(heading, document.createTextNode(body));
  panel.hidden = false;

  const rect = anchor.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const below = rect.bottom + TOOLTIP_GAP_PX + panelRect.height <= window.innerHeight;

  panel.style.top = `${
    below
      ? rect.bottom + TOOLTIP_GAP_PX
      : Math.max(TOOLTIP_GAP_PX, rect.top - panelRect.height - TOOLTIP_GAP_PX)
  }px`;
  panel.style.left = `${Math.max(
    TOOLTIP_GAP_PX,
    Math.min(rect.left, window.innerWidth - panelRect.width - TOOLTIP_GAP_PX),
  )}px`;
}

export function hideTooltip(): void {
  if (tooltipPanel) tooltipPanel.hidden = true;
}

export function resetTooltipForTests(): void {
  tooltipPanel = null;
}
