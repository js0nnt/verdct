import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { DEFAULT_SETTINGS, readSettings } from '../shared/settings';
import type { VerdctSettings } from '../shared/types';
import { Home } from './Home';
import { Schedule } from './Schedule';
import { Settings } from './Settings';
import { useTheme } from './useTheme';

type Tab = 'home' | 'schedule' | 'settings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'home', label: 'Overview' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'settings', label: 'Settings' },
];

/** Where the active-tab underline sits, measured from the button it belongs to. */
interface Indicator {
  left: number;
  width: number;
}

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [settings, setSettings] = useState<VerdctSettings>(DEFAULT_SETTINGS);
  const [indicator, setIndicator] = useState<Indicator | null>(null);
  const [scrolled, setScrolled] = useState(false);

  const navRef = useRef<HTMLDivElement>(null);
  const previousIndex = useRef(0);

  useEffect(() => {
    void readSettings().then(setSettings);
  }, []);

  useTheme(settings.theme);

  useEffect(() => {
    // Without this the sticky header and the content under it share an edge and
    // read as one surface, so a card sliding beneath looks like a glitch.
    const onScroll = (): void => setScrolled(window.scrollY > 2);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const index = TABS.findIndex((entry) => entry.id === tab);
  // Read during render so the panel and the underline move the same way; the
  // ref catches up afterwards, ready for the next switch.
  const enteringFrom = index >= previousIndex.current ? 'right' : 'left';

  useLayoutEffect(() => {
    previousIndex.current = index;

    // Measured rather than declared: the tab labels are words of different
    // lengths, and a hardcoded width would drift the moment one is renamed.
    const active = navRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (active) {
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    }

    // A new panel starts at its own beginning. Instant, because a smooth scroll
    // to the top competing with the panel sliding in reads as two animations
    // disagreeing about what just happened.
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [index]);

  return (
    <main className="v-app flex w-80 flex-col bg-surface text-ink dark:bg-surface-dark dark:text-inkdark">
      {/* Held at the top, so a long schedule scrolls under the tabs rather than
          carrying them off screen with it. */}
      <div
        className={`sticky top-0 z-10 bg-surface transition-shadow duration-200 dark:bg-surface-dark ${
          scrolled ? 'shadow-[0_8px_16px_-12px_rgba(15,15,15,0.55)]' : ''
        }`}
      >
        <header className="flex items-center gap-2.5 px-5 pt-5">
          <span className="verdct-mark h-5 w-5 rounded-md" aria-hidden="true" />
          <p className="text-[13px] font-semibold tracking-tight">Verdct</p>
        </header>

        <div
          ref={navRef}
          role="tablist"
          aria-label="Sections"
          className="relative mt-4 flex gap-1 border-b border-line px-3 dark:border-line-dark"
        >
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`verdct-tab-${entry.id}`}
              aria-controls="verdct-panel"
              data-active={tab === entry.id}
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={`px-2.5 py-2 text-xs font-semibold transition-colors duration-200 ${
                tab === entry.id
                  ? 'text-ink dark:text-inkdark'
                  : 'text-ink-faint hover:text-ink-muted dark:text-inkdark-faint dark:hover:text-inkdark-muted'
              }`}
            >
              {entry.label}
            </button>
          ))}

          {/* One underline that travels, rather than three that blink on and off. */}
          {indicator && (
            <span
              aria-hidden="true"
              className="absolute -bottom-px h-0.5 rounded-full bg-ink transition-[left,width] duration-300 ease-out dark:bg-inkdark"
              style={{ left: indicator.left, width: indicator.width }}
            />
          )}
        </div>
      </div>

      {/* Keyed by tab so the entrance animation replays on every switch. */}
      <div
        key={tab}
        id="verdct-panel"
        role="tabpanel"
        aria-labelledby={`verdct-tab-${tab}`}
        className={`px-5 pb-5 pt-4 ${
          enteringFrom === 'right' ? 'v-panel-right' : 'v-panel-left'
        }`}
      >
        {tab === 'home' && <Home />}
        {tab === 'schedule' && <Schedule />}
        {tab === 'settings' && <Settings settings={settings} onSettingsChange={setSettings} />}
      </div>
    </main>
  );
}
