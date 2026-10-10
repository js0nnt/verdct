import { useRef } from 'react';

import { edgeTransition, useActiveEdges } from './motion';

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  label: string;
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Stretch across the row, splitting it evenly between the options. */
  fill?: boolean;
}

/**
 * Every either-or choice in the popup — theme, term, course, cache length — is
 * this one control, so they all move the same way. A single raised thumb slides
 * between the options rather than each option lighting up in place.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  fill = false,
}: SegmentedProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { edges, direction } = useActiveEdges(containerRef, value);

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={label}
      className={`relative max-w-full gap-0.5 overflow-x-auto rounded-full bg-surface-sunken p-[3px] [scrollbar-width:none] dark:bg-surface-darksunken ${
        fill ? 'flex' : 'inline-flex'
      }`}
    >
      {edges && (
        <span
          aria-hidden="true"
          className="absolute inset-y-[3px] rounded-full bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.06)] dark:bg-[#3a3a3a] dark:shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
          style={{ left: edges.left, right: edges.right, transition: edgeTransition(direction) }}
        />
      )}
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active}
            onClick={() => onChange(option.id)}
            className={`relative z-[1] whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold transition-colors duration-200 ${
              fill ? 'flex-1' : ''
            } ${
              active
                ? 'text-ink dark:text-inkdark'
                : 'text-ink-faint hover:text-ink-muted dark:text-inkdark-faint dark:hover:text-inkdark-muted'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
