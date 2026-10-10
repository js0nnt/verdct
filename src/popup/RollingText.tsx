import { useEffect, useRef, useState } from 'react';

interface Layer {
  text: string;
  key: number;
  phase: 'in' | 'out';
}

/**
 * Text that rolls over to its next value instead of being replaced: the old
 * line lifts away as the new one comes up beneath it. `direction` says which
 * way the roll goes, so it can agree with whatever caused the change.
 */
export function RollingText({
  text,
  direction = 'up',
  className = '',
}: {
  text: string;
  direction?: 'up' | 'down';
  className?: string;
}) {
  const [layers, setLayers] = useState<Layer[]>([{ text, key: 0, phase: 'in' }]);
  const nextKey = useRef(1);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setLayers((current) => {
      const showing = current[current.length - 1];
      if (showing?.text === text) return current;
      const key = nextKey.current;
      nextKey.current += 1;
      // Only the line on its way out stays alongside the new one; anything
      // older has already left.
      return [
        ...(showing ? [{ ...showing, phase: 'out' as const }] : []),
        { text, key, phase: 'in' as const },
      ];
    });
  }, [text]);

  const settled = (key: number): void =>
    setLayers((current) => current.filter((layer) => layer.phase === 'in' || layer.key !== key));

  return (
    <span className={`relative inline-grid overflow-hidden ${className}`}>
      {layers.map((layer) => (
        <span
          key={layer.key}
          aria-hidden={layer.phase === 'out'}
          onAnimationEnd={() => layer.phase === 'out' && settled(layer.key)}
          // Both lines share one grid cell, so the box is as wide as the longer
          // of the two while they cross and never clips either.
          className={`whitespace-nowrap [grid-area:1/1] ${
            // The very first value is simply there; only later ones roll in.
            layer.key === 0 && layer.phase === 'in' ? '' : `v-roll-${layer.phase}-${direction}`
          }`}
        >
          {layer.text}
        </span>
      ))}
    </span>
  );
}
