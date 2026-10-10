import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Where a sliding highlight sits inside its container, as distances from each edge. */
export interface Edges {
  left: number;
  right: number;
}

/**
 * The two edges of a highlight travel on different clocks: the edge in the
 * direction of travel leaves first and the other follows a beat later, so the
 * highlight stretches toward its target and then gathers itself up there. One
 * rigid block gliding sideways reads as a tween; the stretch reads as
 * something with a little mass.
 */
export function edgeTransition(direction: 'left' | 'right' | null, lagMs = 70): string {
  const timing = 'var(--v-spring-bouncy-ms) var(--v-spring-bouncy)';
  const leftDelay = direction === 'right' ? lagMs : 0;
  const rightDelay = direction === 'left' ? lagMs : 0;
  return `left ${timing} ${leftDelay}ms, right ${timing} ${rightDelay}ms, opacity 200ms ease-out`;
}

/**
 * Measures the element marked `data-active="true"` inside a container and
 * reports its edges, re-measuring when the container resizes so a highlight
 * never drifts off its label.
 */
export function useActiveEdges(
  containerRef: RefObject<HTMLElement | null>,
  activeKey: string,
): { edges: Edges | null; direction: 'left' | 'right' | null } {
  const [edges, setEdges] = useState<Edges | null>(null);
  const [direction, setDirection] = useState<'left' | 'right' | null>(null);
  const previousLeft = useRef<number | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const active = container?.querySelector<HTMLElement>('[data-active="true"]');
    if (!container || !active) return;
    const left = active.offsetLeft;
    const right = container.clientWidth - left - active.offsetWidth;
    setEdges((current) =>
      current && current.left === left && current.right === right ? current : { left, right },
    );
    return left;
  }, [containerRef]);

  useLayoutEffect(() => {
    const left = measure();
    if (left === undefined) return;
    if (previousLeft.current !== null && previousLeft.current !== left) {
      setDirection(left > previousLeft.current ? 'right' : 'left');
    }
    previousLeft.current = left;
  }, [activeKey, measure]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, measure]);

  return { edges, direction };
}

/**
 * Lets a row play its exit before it is actually removed. The row is marked as
 * leaving straight away, and the removal itself runs once the collapse has had
 * time to finish.
 */
export function useLeaving(durationMs = 300): {
  leaving: Set<string>;
  leave: (key: string, remove: () => Promise<void> | void) => void;
} {
  const [leaving, setLeaving] = useState<Set<string>>(new Set());

  const leave = useCallback(
    (key: string, remove: () => Promise<void> | void) => {
      setLeaving((current) => new Set(current).add(key));
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.setTimeout(
        () => {
          void Promise.resolve(remove()).finally(() =>
            setLeaving((current) => {
              const next = new Set(current);
              next.delete(key);
              return next;
            }),
          );
        },
        reduced ? 0 : durationMs,
      );
    },
    [durationMs],
  );

  return { leaving, leave };
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The async clipboard refuses when the document has lost focus, which a
    // popup can do mid-click. The old command path does not care.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

/**
 * Copies text and remembers which control did it for long enough to show a
 * confirmation there, then forgets so the control returns to its label.
 */
export function useCopy(holdMs = 1600): {
  copied: string | null;
  copy: (key: string, text: string) => void;
} {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(
    (key: string, text: string) => {
      void writeClipboard(text).then((ok) => {
        if (!ok) return;
        setCopied(key);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(null), holdMs);
      });
    },
    [holdMs],
  );

  return { copied, copy };
}
