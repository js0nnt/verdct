import {
  EASY_LOVED_LABEL,
  HARD_DISLIKED_LABEL,
  PLOT,
  TICKS,
  layoutPoints,
  xFor,
  yFor,
  type ScatterPoint,
} from '../shared/scatterGeometry';
import { toneFor } from './ToneBadge';

const TONE_FILL = {
  good: 'fill-tone-good dark:fill-tonedark-good',
  fair: 'fill-tone-fair dark:fill-tonedark-fair',
  poor: 'fill-tone-poor dark:fill-tonedark-poor',
} as const;

export function ScatterChart({ points }: { points: ScatterPoint[] }) {
  const placed = layoutPoints(points);
  const plotRight = PLOT.width - PLOT.right;
  const plotBottom = PLOT.height - PLOT.bottom;

  return (
    <svg
      viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
      className="mt-2 w-full overflow-visible"
      role="img"
      aria-label="Professor rating plotted against course difficulty"
    >
      {TICKS.map((tick) => (
        <g key={tick} className="stroke-line dark:stroke-line-dark">
          <line x1={xFor(tick)} y1={PLOT.top} x2={xFor(tick)} y2={plotBottom} />
          <line x1={PLOT.left} y1={yFor(tick)} x2={plotRight} y2={yFor(tick)} />
        </g>
      ))}

      {TICKS.map((tick) => (
        <g key={`label-${tick}`} className="fill-ink-faint dark:fill-inkdark-faint text-[9px]">
          <text x={xFor(tick)} y={plotBottom + 12} textAnchor="middle">
            {tick}
          </text>
          <text x={PLOT.left - 6} y={yFor(tick) + 3} textAnchor="end">
            {tick}
          </text>
        </g>
      ))}

      <g className="stroke-line-strong dark:stroke-line-darkstrong">
        <line x1={PLOT.left} y1={PLOT.top} x2={PLOT.left} y2={plotBottom} />
        <line x1={PLOT.left} y1={plotBottom} x2={plotRight} y2={plotBottom} />
      </g>

      <g className="fill-ink-muted dark:fill-inkdark-muted text-[10px] font-semibold">
        <text x={(PLOT.left + plotRight) / 2} y={PLOT.height - 2} textAnchor="middle">
          Difficulty →
        </text>
        <text
          x={9}
          y={(PLOT.top + plotBottom) / 2}
          textAnchor="middle"
          transform={`rotate(-90 9 ${(PLOT.top + plotBottom) / 2})`}
        >
          Rating →
        </text>
      </g>

      {/* Naming the corners saves the reader from decoding the axes. */}
      <text
        x={PLOT.left + 4}
        y={PLOT.top + 9}
        className="fill-tone-good dark:fill-tonedark-good text-[8.5px] font-semibold opacity-80"
      >
        {EASY_LOVED_LABEL}
      </text>
      <text
        x={plotRight - 4}
        y={plotBottom - 4}
        textAnchor="end"
        className="fill-tone-poor dark:fill-tonedark-poor text-[8.5px] font-semibold opacity-80"
      >
        {HARD_DISLIKED_LABEL}
      </text>

      {placed.map((point) => {
        const tone = toneFor(point.rating) ?? 'fair';
        return (
          <g key={`${point.name}-${point.cx}-${point.cy}`}>
            <circle
              cx={point.cx}
              cy={point.cy}
              r={point.radius}
              className={`${TONE_FILL[tone]} stroke-surface dark:stroke-surface-dark`}
              strokeWidth={1.5}
            >
              <title>
                {`${point.name} — ${point.rating.toFixed(1)}/5, difficulty ${point.difficulty.toFixed(1)}/5, ${point.numRatings} ratings`}
              </title>
            </circle>
            {point.label && (
              <text
                x={point.label.x}
                y={point.label.y}
                textAnchor="middle"
                className="fill-ink dark:fill-inkdark pointer-events-none text-[9px] font-semibold"
              >
                {point.label.text}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
