import type { ReactNode } from 'react';

/** The small uppercase heading every group in the popup opens with. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-faint dark:text-inkdark-faint">
      {children}
    </h2>
  );
}
