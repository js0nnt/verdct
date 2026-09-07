/**
 * Pure layout maths for the quality-vs-difficulty chart. Kept free of DOM so the
 * popup can render it as React SVG and the logic stays directly testable.
 */

export interface ScatterPoint {
  name: string;
  rating: number;
  difficulty: number;
  numRatings: number;
}

export interface PlacedPoint extends ScatterPoint {
  cx: number;
  cy: number;
  radius: number;
  /** Absent when the label would have collided with something already placed. */
  label?: { text: string; x: number; y: number };
}

export const PLOT = { width: 356, height: 232, left: 30, right: 8, top: 14, bottom: 26 };
export const SCALE_MIN = 1;
export const SCALE_MAX = 5;
export const TICKS = [1, 2, 3, 4, 5];

const LABEL_HEIGHT = 10;
const CHAR_WIDTH = 5;
const ZONE_CHAR_WIDTH = 4.6;
export const EASY_LOVED_LABEL = 'EASY + LOVED';
export const HARD_DISLIKED_LABEL = 'HARD + DISLIKED';

export function xFor(difficulty: number): number {
  const inner = PLOT.width - PLOT.left - PLOT.right;
  return PLOT.left + ((difficulty - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * inner;
}

export function yFor(rating: number): number {
  const inner = PLOT.height - PLOT.top - PLOT.bottom;
  return PLOT.top + inner - ((rating - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * inner;
}

/** Bigger dot means more reviews behind the point. */
export function radiusFor(numRatings: number): number {
  return Math.min(9, 3.5 + Math.sqrt(numRatings) * 0.45);
}

type Box = [number, number, number, number];

function overlaps(box: Box, claimed: Box[]): boolean {
  return claimed.some(
    (other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1],
  );
}

/**
 * A point in a corner can sit close enough to the edge that its label would
 * render outside the viewBox — above the top for a 5.0, past the right edge for
 * a 5.0 difficulty — where it is clipped or overlaps neighbouring UI.
 */
function withinPlot(box: Box): boolean {
  return box[0] >= 0 && box[1] >= 0 && box[2] <= PLOT.width && box[3] <= PLOT.height;
}

/**
 * Positions every point and places what labels fit. Labels prefer above the dot
 * and fall back to below; one that would land on a neighbour is dropped rather
 * than printed over it, since two professors within 0.1 of each other on both
 * axes would otherwise render an unreadable blob.
 */
export function layoutPoints(points: ScatterPoint[]): PlacedPoint[] {
  // The corner captions are reserved before any label competes for space.
  const claimed: Box[] = [
    [
      PLOT.left + 4,
      PLOT.top + 1,
      PLOT.left + 4 + EASY_LOVED_LABEL.length * ZONE_CHAR_WIDTH,
      PLOT.top + 11,
    ],
    [
      PLOT.width - PLOT.right - 4 - HARD_DISLIKED_LABEL.length * ZONE_CHAR_WIDTH,
      PLOT.height - PLOT.bottom - 12,
      PLOT.width - PLOT.right - 4,
      PLOT.height - PLOT.bottom - 2,
    ],
  ];

  // Largest first, so a heavily-rated professor never hides a lightly-rated one.
  return [...points]
    .sort((left, right) => right.numRatings - left.numRatings)
    .map((point) => {
      const cx = xFor(point.difficulty);
      const cy = yFor(point.rating);
      const radius = radiusFor(point.numRatings);
      const text = point.name.split(' ').at(-1) ?? point.name;
      const halfWidth = (text.length * CHAR_WIDTH) / 2;

      for (const baseline of [cy - radius - 4, cy + radius + LABEL_HEIGHT]) {
        const box: Box = [cx - halfWidth, baseline - LABEL_HEIGHT, cx + halfWidth, baseline];
        if (!withinPlot(box) || overlaps(box, claimed)) continue;

        claimed.push(box);
        return { ...point, cx, cy, radius, label: { text, x: cx, y: baseline } };
      }

      return { ...point, cx, cy, radius };
    });
}
