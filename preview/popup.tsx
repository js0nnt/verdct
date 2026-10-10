/**
 * Mounts the real popup as an ordinary page, against an in-memory chrome.*
 * that fires storage change events like the real one. Removing a section or a
 * favorite here behaves as it would in the extension, so motion can be judged
 * on real interactions rather than on a static render.
 *
 *   ?empty=1   nothing scanned, nothing saved
 *   ?dark=1    start in the dark theme
 */
import React from 'react';
import ReactDOM from 'react-dom/client';

import '../src/popup/styles.css';
import type { ScheduledSection } from '../src/shared/schedule';
import type { ProfessorRating, ScatterPoint } from '../src/shared/types';

const params = new URLSearchParams(location.search);
const empty = params.get('empty') === '1';

type Listener = (changes: Record<string, unknown>, areaName: string) => void;
const listeners = new Set<Listener>();

function area(name: string, store: Record<string, unknown>) {
  return {
    get: async (keys: string | string[] | null) => {
      const list = keys === null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => key in store).map((key) => [key, store[key]]));
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(store, items);
      listeners.forEach((listener) => listener(items, name));
    },
    remove: async (key: string) => {
      delete store[key];
      listeners.forEach((listener) => listener({ [key]: undefined }, name));
    },
  };
}

function rating(displayName: string, overallRating: number, numRatings: number): ProfessorRating {
  return {
    normalizedName: displayName.toLowerCase(),
    displayName,
    overallRating,
    difficulty: 3,
    wouldTakeAgainPct: 80,
    numRatings,
    fetchedAt: Date.now(),
    matchConfidence: 'high',
    trend: null,
    legacyId: 1,
  };
}

const RATINGS = [
  rating('Adrian Moss', 4.7, 34),
  rating('Priya Raman', 4.4, 41),
  rating('Elena Vasquez', 4.3, 227),
  rating('Marcus Feld', 3.4, 58),
  rating('Tomas Lindqvist', 2.5, 73),
];

const SCATTER: Record<string, ScatterPoint[]> = {
  'MAT 343': [
    { name: 'Adrian Moss', rating: 4.7, difficulty: 3.7, numRatings: 34 },
    { name: 'Priya Raman', rating: 4.4, difficulty: 2.2, numRatings: 41 },
    { name: 'Elena Vasquez', rating: 4.3, difficulty: 3.0, numRatings: 227 },
    { name: 'Marcus Feld', rating: 3.4, difficulty: 3.2, numRatings: 58 },
    { name: 'Nadia Okafor', rating: 3.1, difficulty: 3.4, numRatings: 96 },
    { name: 'Tomas Lindqvist', rating: 2.5, difficulty: 4.1, numRatings: 73 },
    { name: 'Iris Delgado', rating: 2.2, difficulty: 4.3, numRatings: 29 },
  ],
  'CSE 310': [
    { name: 'Hana Ito', rating: 4.1, difficulty: 3.9, numRatings: 61 },
    { name: 'Owen Brandt', rating: 3.6, difficulty: 2.8, numRatings: 18 },
    { name: 'Luis Ortega', rating: 2.9, difficulty: 4.4, numRatings: 102 },
  ],
};

function section(
  classNumber: string,
  courseId: string,
  courseTitle: string,
  instructor: string,
  days: ScheduledSection['meetings'][number]['days'],
  start: number,
  end: number,
  units = 3,
): ScheduledSection {
  return {
    classNumber,
    term: '2267',
    courseId,
    courseTitle,
    instructors: [instructor],
    meetings: [{ days, startMinutes: start, endMinutes: end }],
    location: 'Tempe · WXLR A107',
    dates: { start: '8/20', end: '12/5', sessionCode: 'C' },
    units,
    unitsMax: null,
    seatsOpen: 12,
    seatsTotal: 150,
    component: null,
    pairedWith: null,
    addedAt: Date.now(),
  };
}

const SCHEDULE: ScheduledSection[] = [
  section('10412', 'MAT 343', 'Applied Linear Algebra', 'Adrian Moss', ['Tue', 'Thu'], 540, 615),
  section('70231', 'CSE 310', 'Data Structures and Algorithms', 'Hana Ito', ['Mon', 'Wed'], 630, 705),
  section('81120', 'PHY 121', 'University Physics I: Mechanics', 'Marcus Feld', ['Mon', 'Wed', 'Fri'], 780, 830),
  section('64502', 'ENG 102', 'First-Year Composition', 'Priya Raman', ['Tue', 'Thu'], 600, 675),
];

const local: Record<string, unknown> = {
  'verdct:settings': {
    theme: params.get('dark') === '1' ? 'dark' : 'light',
    cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    noMatchTtlMs: 24 * 60 * 60 * 1000,
    goodRatingThreshold: 4,
    fairRatingThreshold: 2.5,
  },
  'verdct:favorites': empty
    ? []
    : [
        { normalizedName: 'adrian moss', displayName: 'Adrian Moss', addedAt: Date.now() },
        { normalizedName: 'priya raman', displayName: 'Priya Raman', addedAt: Date.now() },
        { normalizedName: 'tomas lindqvist', displayName: 'Tomas Lindqvist', addedAt: Date.now() },
      ],
  'verdct:ratings': Object.fromEntries(
    RATINGS.map((entry) => [entry.normalizedName, { rating: entry, lastAccessedAt: Date.now() }]),
  ),
  'verdct:schedule': empty ? [] : SCHEDULE,
};

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: area('local', local),
    session: area('session', {}),
    onChanged: {
      addListener: (listener: Listener) => listeners.add(listener),
      removeListener: (listener: Listener) => listeners.delete(listener),
    },
  },
  tabs: { query: async () => [{ id: 1 }] },
  runtime: {
    lastError: undefined,
    sendMessage: (_message: unknown, callback?: (response: unknown) => void) => {
      // A beat of latency, so the loading state is seen rather than skipped.
      setTimeout(
        () => callback?.({ ok: true, data: { courses: empty ? {} : SCATTER, updatedAt: Date.now() } }),
        250,
      );
    },
  },
};

const { App } = await import('../src/popup/App');
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
