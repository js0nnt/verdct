/**
 * Neutral greys with a single accent, so Verdct reads as one system rather than
 * three competing pastels. Tone is carried by a small dot instead of a filled
 * pill: a 5px patch of colour is a signal, a whole badge of it is noise.
 */
const LIGHT_TOKENS = `
  --v-surface: #ffffff;
  --v-surface-sunken: #f5f5f5;
  --v-border: #e4e4e4;
  --v-border-strong: #d4d4d4;
  --v-text: #1f1f1f;
  --v-text-muted: #737373;
  --v-text-faint: #a3a3a3;
  --v-track: #e8e8e8;
  --v-good: #1f9d63;
  --v-fair: #c47f10;
  --v-poor: #d24b45;
  --v-shadow: rgba(23, 23, 23, 0.14);
  --v-shadow-strong: rgba(23, 23, 23, 0.2);
`;

const DARK_TOKENS = `
  --v-surface: #262626;
  --v-surface-sunken: #1c1c1c;
  --v-border: #3a3a3a;
  --v-border-strong: #4a4a4a;
  --v-text: #ededed;
  --v-text-muted: #9e9e9e;
  --v-text-faint: #6f6f6f;
  --v-track: #3a3a3a;
  --v-good: #3cc389;
  --v-fair: #e5a33c;
  --v-poor: #ef6a63;
  --v-shadow: rgba(0, 0, 0, 0.45);
  --v-shadow-strong: rgba(0, 0, 0, 0.6);
`;

/** The one saturated element in the palette. */
export const ACCENT_GRADIENT = 'linear-gradient(135deg, #f4304a, #ff2e7e)';

/**
 * For UI embedded in ASU's own page. ASU's Class Search is always light, so a
 * badge sitting inside a result row stays light whatever the OS theme is —
 * a dark chip on a white table would read as broken, not as dark mode.
 */
export const EMBEDDED_TOKENS = `:host { ${LIGHT_TOKENS} }`;

/**
 * For Verdct's own floating surfaces — the popover and the comparison panel.
 * These sit above the page rather than inside it, so they follow the OS theme.
 */
export const FLOATING_TOKENS = `
  :host { ${LIGHT_TOKENS} }
  /* 'auto' defers to the OS; an explicit choice from settings overrides it. */
  @media (prefers-color-scheme: dark) {
    :host([data-theme="auto"]) { ${DARK_TOKENS} }
  }
  :host([data-theme="dark"]) { ${DARK_TOKENS} }
`;
