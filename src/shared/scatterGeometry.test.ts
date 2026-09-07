import { describe, expect, it } from 'vitest';

import {
  PLOT,
  SCALE_MAX,
  SCALE_MIN,
  layoutPoints,
  radiusFor,
  xFor,
  yFor,
  type ScatterPoint,
} from './scatterGeometry';

function point(overrides: Partial<ScatterPoint> = {}): ScatterPoint {
  return { name: 'First Last', rating: 3, difficulty: 3, numRatings: 40, ...overrides };
}

describe('scales', () => {
  it('anchors the axes at the ends of the plot area', () => {
    expect(xFor(SCALE_MIN)).toBe(PLOT.left);
    expect(xFor(SCALE_MAX)).toBe(PLOT.width - PLOT.right);
    // Rating grows upward, so the minimum sits at the bottom.
    expect(yFor(SCALE_MIN)).toBe(PLOT.height - PLOT.bottom);
    expect(yFor(SCALE_MAX)).toBe(PLOT.top);
  });

  it('grows the dot with review count but caps it', () => {
    expect(radiusFor(400)).toBe(9);
    expect(radiusFor(4)).toBeLessThan(radiusFor(100));
    expect(radiusFor(0)).toBeGreaterThan(0);
  });
});

describe('layoutPoints', () => {
  it('places every point regardless of whether its label fits', () => {
    const crowded = Array.from({ length: 6 }, (_, index) =>
      point({ name: `Professor Number${index}`, rating: 3, difficulty: 3 }),
    );

    expect(layoutPoints(crowded)).toHaveLength(6);
  });

  it('labels well-separated points', () => {
    const spread = [
      point({ name: 'A Alpha', rating: 1.5, difficulty: 1.5 }),
      point({ name: 'B Beta', rating: 3, difficulty: 3 }),
      point({ name: 'C Gamma', rating: 4.8, difficulty: 4.8 }),
    ];

    expect(layoutPoints(spread).every((placed) => placed.label)).toBe(true);
  });

  it('drops a label rather than printing it over a neighbour', () => {
    // Two professors at effectively the same coordinates.
    const overlapping = [
      point({ name: 'One Overlapping', rating: 3, difficulty: 3, numRatings: 100 }),
      point({ name: 'Two Overlapping', rating: 3.02, difficulty: 3.02, numRatings: 90 }),
      point({ name: 'Three Overlapping', rating: 3.04, difficulty: 3.04, numRatings: 80 }),
    ];

    const labelled = layoutPoints(overlapping).filter((placed) => placed.label).length;

    expect(labelled).toBeLessThan(3);
    expect(labelled).toBeGreaterThan(0);
  });

  it.each([
    ['top-left', 5, 1],
    ['top-right', 5, 5],
    ['bottom-right', 1, 5],
    ['bottom-left', 1, 1],
  ])('never places a %s label outside the plot', (_corner, rating, difficulty) => {
    const [placed] = layoutPoints([point({ name: 'X Corner', rating, difficulty })]);

    if (placed.label) {
      // A label crossing the viewBox edge would be clipped or overlap other UI.
      expect(placed.label.y).toBeGreaterThanOrEqual(10);
      expect(placed.label.y).toBeLessThanOrEqual(PLOT.height);
    }
  });

  it('draws the largest dots first so small ones stay visible', () => {
    const mixed = [
      point({ name: 'Small One', numRatings: 5 }),
      point({ name: 'Large One', numRatings: 300 }),
    ];

    expect(layoutPoints(mixed)[0].name).toBe('Large One');
  });

  it('uses the last name for the label', () => {
    const [placed] = layoutPoints([point({ name: 'Hedvig Mohacsy', rating: 4, difficulty: 2 })]);

    expect(placed.label?.text).toBe('Mohacsy');
  });
});
