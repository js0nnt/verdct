import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MIN_POINTS_TO_COMPARE } from '../shared/constants';
import type { ScatterPoint } from '../shared/types';
import { comparableCourses, parseTabData, readTabData, updateActionBadge, writeTabData } from './tabData';

function point(overrides: Partial<ScatterPoint> = {}): ScatterPoint {
  return { name: 'First Last', rating: 4, difficulty: 3, numRatings: 20, ...overrides };
}

function points(count: number): ScatterPoint[] {
  return Array.from({ length: count }, (_, index) => point({ name: `Prof ${index}` }));
}

const session: Record<string, unknown> = {};
const badge = { text: '', title: '' };

beforeEach(() => {
  for (const key of Object.keys(session)) delete session[key];
  badge.text = '';
  badge.title = '';

  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: async (key: string) => (key in session ? { [key]: session[key] } : {}),
        set: async (items: Record<string, unknown>) => Object.assign(session, items),
        remove: async (key: string) => void delete session[key],
      },
    },
    action: {
      setBadgeText: async ({ text }: { text: string }) => void (badge.text = text),
      setBadgeBackgroundColor: async () => undefined,
      setTitle: async ({ title }: { title: string }) => void (badge.title = title),
    },
  });
});

describe('parseTabData', () => {
  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['a record with no courses', { updatedAt: 1 }],
  ])('returns null for %s', (_label, value) => {
    expect(parseTabData(value)).toBeNull();
  });

  it('drops malformed points and empty courses', () => {
    const parsed = parseTabData({
      courses: {
        'MAT 243': [point(), { name: 'Broken' }, 'not an object'],
        'CSE 110': ['all bad'],
      },
      updatedAt: 5,
    });

    expect(Object.keys(parsed!.courses)).toEqual(['MAT 243']);
    expect(parsed!.courses['MAT 243']).toHaveLength(1);
  });
});

describe('tab storage', () => {
  it('round-trips a tab’s courses', async () => {
    await writeTabData(7, { 'MAT 243': points(3) }, () => 1_000);

    const data = await readTabData(7);
    expect(data?.updatedAt).toBe(1_000);
    expect(data?.courses['MAT 243']).toHaveLength(3);
  });

  it('keeps tabs separate', async () => {
    await writeTabData(1, { 'MAT 243': points(3) });
    await writeTabData(2, { 'CSE 110': points(4) });

    expect(Object.keys((await readTabData(1))!.courses)).toEqual(['MAT 243']);
    expect(Object.keys((await readTabData(2))!.courses)).toEqual(['CSE 110']);
  });

  it('returns null for a tab that reported nothing', async () => {
    expect(await readTabData(99)).toBeNull();
  });
});

describe('comparableCourses', () => {
  it('includes only courses with enough rated professors', () => {
    const data = {
      courses: { 'MAT 243': points(MIN_POINTS_TO_COMPARE), 'CSE 110': points(1) },
      updatedAt: 0,
    };

    expect(comparableCourses(data)).toEqual(['MAT 243']);
  });

  it('is empty for a tab with no data', () => {
    expect(comparableCourses(null)).toEqual([]);
  });
});

describe('updateActionBadge', () => {
  it('counts the professors worth comparing', async () => {
    await updateActionBadge(1, { courses: { 'MAT 243': points(5) }, updatedAt: 0 });

    expect(badge.text).toBe('5');
    expect(badge.title).toContain('5 rated professors');
  });

  it('stays blank when nothing is comparable', async () => {
    await updateActionBadge(1, { courses: { 'MAT 243': points(1) }, updatedAt: 0 });

    expect(badge.text).toBe('');
    expect(badge.title).toBe('Verdct');
  });

  it('clears when a tab has no data at all', async () => {
    await updateActionBadge(1, null);

    expect(badge.text).toBe('');
  });
});
