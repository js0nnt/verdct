import { useEffect, useState } from 'react';

import { DEFAULT_SETTINGS, readSettings } from '../shared/settings';
import type { VerdctSettings } from '../shared/types';
import { Home } from './Home';
import { Settings } from './Settings';
import { useTheme } from './useTheme';

type Tab = 'home' | 'settings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'home', label: 'Overview' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [settings, setSettings] = useState<VerdctSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void readSettings().then(setSettings);
  }, []);

  useTheme(settings.theme);

  return (
    <main className="flex w-80 flex-col bg-surface text-ink dark:bg-surface-dark dark:text-inkdark">
      <header className="flex items-center gap-2.5 px-5 pt-5">
        <span className="verdct-mark h-5 w-5 rounded-md" aria-hidden="true" />
        <p className="text-[13px] font-semibold tracking-tight">Verdct</p>
      </header>

      <nav
        className="mt-4 flex gap-1 border-b border-line px-3 dark:border-line-dark"
        aria-label="Sections"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? 'page' : undefined}
            className={`-mb-px border-b-2 px-2.5 py-2 text-xs font-semibold transition-colors ${
              tab === entry.id
                ? 'border-ink text-ink dark:border-inkdark dark:text-inkdark'
                : 'border-transparent text-ink-faint hover:text-ink-muted dark:text-inkdark-faint dark:hover:text-inkdark-muted'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="px-5 pb-5 pt-4">
        {tab === 'home' ? (
          <Home />
        ) : (
          <Settings settings={settings} onSettingsChange={setSettings} />
        )}
      </div>
    </main>
  );
}
