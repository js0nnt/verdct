import { upsertBadge, type BadgeState } from '../src/content/badgeRenderer';
import { evaluateBestSections, recordSection } from '../src/content/bestSection';
import { recordScatterPoint, refreshScatter } from '../src/content/scatterWidget';
import type { ScannedClassSection } from '../src/content/domScanner';
import type { ProfessorRating } from '../src/shared/types';

function rating(overrides: Partial<ProfessorRating>): ProfessorRating {
  const merged: ProfessorRating = {
    normalizedName: '',
    displayName: 'Placeholder',
    overallRating: 4,
    difficulty: 3,
    wouldTakeAgainPct: 70,
    numRatings: 40,
    fetchedAt: Date.now(),
    matchConfidence: 'high',
    trend: null,
    ...overrides,
  };
  // Distinct cache keys per professor, so best-section counting sees real choices.
  return { ...merged, normalizedName: merged.normalizedName || merged.displayName.toLowerCase() };
}

/** Mirrors the real page's spread: mostly rated, a few unknown, a couple of edge cases. */
const scenarios: Array<{ name: string; meta: string; state: BadgeState }> = [
  {
    name: 'Jay Barraza',
    meta: 'high rating, large sample, improving',
    state: { status: 'ready', rating: rating({ displayName: 'Jay Barraza', overallRating: 4.6, difficulty: 2.4, wouldTakeAgainPct: 91, numRatings: 128, trend: 'rising' }) },
  },
  {
    name: 'Phong Chau',
    meta: 'high rating, harder course',
    state: { status: 'ready', rating: rating({ displayName: 'Phong Chau', overallRating: 4.4, difficulty: 4.1, wouldTakeAgainPct: 78, numRatings: 63 }) },
  },
  {
    name: 'Chandrani Banerjee',
    meta: 'mid rating, steady (no arrow)',
    state: { status: 'ready', rating: rating({ displayName: 'Chandrani Banerjee', overallRating: 3.6, difficulty: 3.4, wouldTakeAgainPct: 58, numRatings: 44, trend: 'steady' }) },
  },
  {
    name: 'Frank Arthur',
    meta: 'mid rating, declining',
    state: { status: 'ready', rating: rating({ displayName: 'Frank Arthur', overallRating: 3.5, difficulty: 3.5, wouldTakeAgainPct: 57, numRatings: 150, trend: 'falling' }) },
  },
  {
    name: 'Sukitha Adappa',
    meta: 'low-mid rating',
    state: { status: 'ready', rating: rating({ displayName: 'Sukitha Adappa', overallRating: 2.9, difficulty: 3.9, wouldTakeAgainPct: 41, numRatings: 22 }) },
  },
  {
    name: 'Adam Leighton',
    meta: 'poor rating',
    state: { status: 'ready', rating: rating({ displayName: 'Adam Leighton', overallRating: 2.1, difficulty: 4.4, wouldTakeAgainPct: 19, numRatings: 37 }) },
  },
  {
    name: 'Margarita Bustos Gonzalez',
    meta: 'poor rating, low-confidence name match',
    state: { status: 'ready', rating: rating({ displayName: 'Margarita Bustos', overallRating: 1.3, difficulty: 4.6, wouldTakeAgainPct: 8, numRatings: 11, matchConfidence: 'low' }) },
  },
  {
    name: 'Priya Raman',
    meta: 'good rating but only 3 ratings (provisional)',
    state: { status: 'ready', rating: rating({ displayName: 'Priya Raman', overallRating: 4.7, difficulty: 2.0, wouldTakeAgainPct: 100, numRatings: 3 }) },
  },
  {
    name: 'Saloni Sinha',
    meta: 'no confident match',
    state: { status: 'ready', rating: rating({ displayName: 'Saloni Sinha', overallRating: null, difficulty: null, wouldTakeAgainPct: null, numRatings: 0, matchConfidence: 'none' }) },
  },
  {
    name: 'Yasmeen Baki',
    meta: 'listed on RMP with zero ratings',
    state: { status: 'ready', rating: rating({ displayName: 'Yasmeen Baki', overallRating: null, difficulty: null, wouldTakeAgainPct: null, numRatings: 0 }) },
  },
  {
    name: 'Daniel Korytowski',
    meta: 'still loading',
    state: { status: 'loading' },
  },
  {
    name: 'Ileana Ionascu',
    meta: 'lookup failed',
    state: { status: 'error', message: 'Rating lookup failed. Reload to retry.' },
  },
];

const results = document.querySelector<HTMLElement>('#class-results')!;

for (const scenario of scenarios) {
  const row = document.createElement('div');
  row.className = 'class-accordion';

  const instructor = document.createElement('div');
  instructor.className = 'class-results-cell instructor';
  const link = document.createElement('a');
  link.href = 'https://search.asu.edu/profile/1';
  link.textContent = scenario.name;
  instructor.append(link);

  const meta = document.createElement('div');
  meta.className = 'class-results-cell meta';
  meta.textContent = scenario.meta;

  row.append(instructor, meta);
  results.append(row);

  const section: ScannedClassSection = {
    courseId: 'MAT 243',
    professorName: scenario.name,
    rowElement: row,
    instructorElement: instructor,
  };
  upsertBadge(section, scenario.state);
  recordSection(section, scenario.state);
  if (scenario.state.status === 'ready') {
    recordScatterPoint(section.courseId, scenario.state.rating);
  }
}

evaluateBestSections();
refreshScatter();
