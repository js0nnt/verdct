import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { edgeTransition } from './motion';

export interface DockItem<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
}

/** Horizontal padding inside each button, either side of its content. */
const PAD_X = 11;
const ICON = 16;
/** Between the icon and the label, once the label is showing. */
const LABEL_GAP = 6;
const ITEM_GAP = 2;
/** Inset of the whole row inside the dock's rounded frame. */
const INSET = 4;

/**
 * The tab bar, floating at the foot of the popup. Only the active tab spells
 * out its name; the others are icons. So switching does two things at once —
 * one label folds away as the other unfolds — and the dark pill rides across
 * with them, stretching toward its target as it goes.
 *
 * The pill cannot simply measure the active button the way the segmented
 * control does: every button is mid-resize while the labels fold, so a
 * measurement taken at the start would be wrong by the time the move ended.
 * Instead each label's natural width is measured once, and every button's
 * width, and so the pill's destination, is worked out from those.
 */
export function Dock<T extends string>({
  items,
  value,
  onChange,
  idFor,
  panelId,
}: {
  items: Array<DockItem<T>>;
  value: T;
  onChange: (value: T) => void;
  idFor: (id: T) => string;
  panelId: (id: T) => string;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const [labelWidths, setLabelWidths] = useState<number[] | null>(null);
  const activeIndex = items.findIndex((item) => item.id === value);
  const previousIndex = useRef(activeIndex);
  const direction =
    activeIndex === previousIndex.current ? null : activeIndex > previousIndex.current ? 'right' : 'left';

  useLayoutEffect(() => {
    previousIndex.current = activeIndex;
  }, [activeIndex]);

  useLayoutEffect(() => {
    const measure = (): void => {
      const spans = measureRef.current?.querySelectorAll<HTMLElement>('[data-measure]');
      if (spans) setLabelWidths([...spans].map((span) => Math.ceil(span.offsetWidth)));
    };
    measure();
    // A web font arriving after first paint would change every label width.
    void document.fonts?.ready.then(measure);
  }, [items]);

  const widthOf = (index: number): number =>
    PAD_X * 2 + ICON + (index === activeIndex && labelWidths ? LABEL_GAP + labelWidths[index] : 0);

  const total = items.reduce((sum, _item, index) => sum + widthOf(index), 0) + ITEM_GAP * (items.length - 1);
  const left = items.slice(0, activeIndex).reduce((sum, _item, index) => sum + widthOf(index) + ITEM_GAP, 0);
  const right = total - left - widthOf(activeIndex);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (activeIndex + step + items.length) % items.length;
    onChange(items[next].id);
    buttonsRef.current[next]?.focus();
  }

  return (
    <nav className="pointer-events-none absolute inset-x-0 bottom-3.5 z-20 flex justify-center">
      {/* Off-screen copies of the labels, there only to be measured. */}
      <div ref={measureRef} aria-hidden="true" className="invisible absolute flex">
        {items.map((item) => (
          <span key={item.id} data-measure className="whitespace-nowrap text-[12px] font-semibold">
            {item.label}
          </span>
        ))}
      </div>

      <div
        role="tablist"
        aria-label="Sections"
        onKeyDown={onKeyDown}
        className="pointer-events-auto relative rounded-full border border-black/[0.06] bg-white/80 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.3),0_2px_6px_-2px_rgba(0,0,0,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/[0.08] dark:bg-[#2b2b2b]/80 dark:shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)]"
        style={{ padding: INSET }}
      >
        <div className="relative flex" style={{ gap: ITEM_GAP }}>
          {labelWidths && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 rounded-full bg-ink dark:bg-inkdark"
              style={{ left, right, transition: edgeTransition(direction, 60) }}
            />
          )}

          {items.map((item, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={item.id}
                ref={(node) => {
                  buttonsRef.current[index] = node;
                }}
                type="button"
                role="tab"
                id={idFor(item.id)}
                aria-controls={panelId(item.id)}
                aria-selected={active}
                aria-label={item.label}
                tabIndex={active ? 0 : -1}
                onClick={() => onChange(item.id)}
                title={active ? undefined : item.label}
                className={`relative z-[1] flex h-9 items-center overflow-hidden rounded-full transition-[width,color] duration-[var(--v-spring-soft-ms)] ease-[var(--v-spring-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-faint/60 ${
                  active
                    ? 'text-white dark:text-[#1a1a1a]'
                    : 'text-ink-faint hover:text-ink dark:text-inkdark-faint dark:hover:text-inkdark'
                }`}
                style={{ width: widthOf(index), paddingInline: PAD_X }}
              >
                <span
                  className={`flex shrink-0 transition-transform duration-300 ease-[var(--v-spring-bouncy)] ${
                    active ? 'scale-100' : 'scale-95'
                  }`}
                  style={{ width: ICON, height: ICON }}
                >
                  {item.icon}
                </span>
                <span
                  aria-hidden="true"
                  className={`whitespace-nowrap text-[12px] font-semibold transition-[opacity,transform,filter] duration-300 ${
                    active
                      ? 'translate-x-0 opacity-100 blur-0 delay-75'
                      : '-translate-x-1 opacity-0 blur-[2px]'
                  }`}
                  style={{ marginLeft: LABEL_GAP }}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Quality against difficulty: a few dots above a baseline. */
export function OverviewIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 2.5v11h11" {...STROKE} />
      <circle cx="6.2" cy="9.4" r="1.25" fill="currentColor" />
      <circle cx="9.4" cy="5.6" r="1.25" fill="currentColor" />
      <circle cx="12.2" cy="8.4" r="1.25" fill="currentColor" />
    </svg>
  );
}

export function ScheduleIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="2.25" y="3" width="11.5" height="10.75" rx="2.25" {...STROKE} />
      <path d="M2.25 6.5h11.5M5.5 1.75v2.5M10.5 1.75v2.5" {...STROKE} />
      <rect x="5" y="8.6" width="2.4" height="2.4" rx="0.6" fill="currentColor" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {/* Each track stops short of its knob rather than running under it, so
          the knob reads as hollow on any background the icon sits on. */}
      <path d="M2.5 4.75h6M12 4.75h1.5M2.5 11.25h1.5M7.5 11.25h6" {...STROKE} />
      <circle cx="10.25" cy="4.75" r="1.75" {...STROKE} />
      <circle cx="5.75" cy="11.25" r="1.75" {...STROKE} />
    </svg>
  );
}
