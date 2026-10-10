import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_SETTINGS, readSettings } from '../shared/settings';
import type { VerdctSettings } from '../shared/types';
import { Dock, OverviewIcon, ScheduleIcon, SettingsIcon, type DockItem } from './Dock';
import { Home } from './Home';
import { RollingText } from './RollingText';
import { Schedule } from './Schedule';
import { Settings } from './Settings';
import { useTheme } from './useTheme';

type Tab = 'home' | 'schedule' | 'settings';

const TABS: Array<DockItem<Tab>> = [
  { id: 'home', label: 'Overview', icon: <OverviewIcon /> },
  { id: 'schedule', label: 'Schedule', icon: <ScheduleIcon /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
];

/** Something each panel says about itself, shown in the header while it is open. */
export type ReportStatus = (status: string) => void;

const tabId = (tab: Tab): string => `verdct-tab-${tab}`;
const panelId = (tab: Tab): string => `verdct-panel-${tab}`;

function versionLabel(): string {
  // Absent outside the extension, in the design harness.
  const version = globalThis.chrome?.runtime?.getManifest?.().version;
  return version ? `Version ${version}` : 'Preferences';
}

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [settings, setSettings] = useState<VerdctSettings>(DEFAULT_SETTINGS);
  const [scrolled, setScrolled] = useState<Record<Tab, boolean>>({
    home: false,
    schedule: false,
    settings: false,
  });
  const [status, setStatus] = useState<Record<Tab, string>>({
    home: 'Reading this tab…',
    schedule: 'Reading your schedule…',
    settings: versionLabel(),
  });

  const index = TABS.findIndex((entry) => entry.id === tab);
  const previousIndex = useRef(index);
  // The header rolls the same way the pages slide: moving right, the old status
  // lifts out of the way; moving back left, it drops.
  const rollDirection = index >= previousIndex.current ? 'up' : 'down';
  useEffect(() => {
    previousIndex.current = index;
  }, [index]);

  useEffect(() => {
    void readSettings().then(setSettings);
  }, []);

  useTheme(settings.theme);

  const reporters = useRef<Record<Tab, ReportStatus> | null>(null);
  const report = (panel: Tab): ReportStatus => (text) =>
    setStatus((current) => (current[panel] === text ? current : { ...current, [panel]: text }));
  reporters.current ??= {
    home: report('home'),
    schedule: report('schedule'),
    settings: report('settings'),
  };

  const onScroll = useCallback((panel: Tab, top: number) => {
    setScrolled((current) => (current[panel] === top > 2 ? current : { ...current, [panel]: top > 2 }));
  }, []);

  return (
    <main className="v-app relative flex h-full flex-col overflow-clip bg-surface text-ink dark:bg-surface-dark dark:text-inkdark">
      <header className="relative z-10 flex h-[52px] shrink-0 items-center gap-2.5 px-5">
        <span className="verdct-mark h-[18px] w-[18px] rounded-[5px]" aria-hidden="true" />
        <p className="text-[13px] font-semibold tracking-tight">Verdct</p>
        <RollingText
          text={status[tab]}
          direction={rollDirection}
          className="ml-auto min-w-0 justify-items-end text-[11px] font-medium tabular-nums text-ink-faint dark:text-inkdark-faint"
        />

        {/* A hairline only once the page has scrolled under the header. At the
            top there is nothing to separate it from. */}
        <span
          aria-hidden="true"
          className={`absolute inset-x-5 bottom-0 h-px bg-line transition-opacity duration-300 dark:bg-line-dark ${
            scrolled[tab] ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </header>

      {/* Clipped rather than hidden: an overflow-hidden box can still be
          scrolled by the browser, and focusing a control on another page
          would drag the whole track sideways to show it. */}
      <div className="relative min-h-0 flex-1 overflow-clip">
        <div
          className="v-track absolute inset-y-0 left-0 flex"
          style={{ width: `${TABS.length * 100}%`, transform: `translateX(${(-index * 100) / TABS.length}%)` }}
        >
          {TABS.map((entry) => {
            const active = entry.id === tab;
            return (
              <section
                key={entry.id}
                id={panelId(entry.id)}
                role="tabpanel"
                aria-labelledby={tabId(entry.id)}
                data-active={active}
                // Off-screen pages are out of the tab order and hidden from
                // assistive tech, but stay mounted so they keep their place.
                inert={!active}
                onScroll={(event) => onScroll(entry.id, event.currentTarget.scrollTop)}
                className="v-panel v-scroll h-full px-5 pb-24 pt-1"
                style={{ width: `${100 / TABS.length}%` }}
              >
                {entry.id === 'home' && <Home onStatus={reporters.current!.home} />}
                {entry.id === 'schedule' && <Schedule onStatus={reporters.current!.schedule} />}
                {entry.id === 'settings' && (
                  <Settings settings={settings} onSettingsChange={setSettings} />
                )}
              </section>
            );
          })}
        </div>
      </div>

      <Dock items={TABS} value={tab} onChange={setTab} idFor={tabId} panelId={panelId} />
    </main>
  );
}
