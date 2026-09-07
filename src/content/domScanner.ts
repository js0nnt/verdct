export interface ScannedClassSection {
  courseId: string;
  professorName: string;
  rowElement: HTMLElement;
  instructorElement: HTMLElement;
}

/**
 * Verified against ASU Class Search's rendered result markup. Keep these page-
 * specific selectors isolated here so an ASU redesign only requires one update.
 */
export const ASU_CLASS_SEARCH_SELECTORS = {
  resultRow: '#class-results .class-accordion',
  courseLabel: '.class-results-cell.course .bold-hyperlink',
  instructorCell: '.class-results-cell.instructor',
  instructorProfileLink: 'a[href*="search.asu.edu/profile/"]',
} as const;

const COURSE_ID_PATTERN = /\b([A-Z]{2,4})\s+(\d{3}[A-Z]?)\b/i;
const PLACEHOLDER_INSTRUCTORS = new Set([
  'staff',
  'tba',
  'to be announced',
  'instructor not assigned',
]);

function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function extractCourseId(row: Element): string | null {
  const courseLabels = row.querySelectorAll<HTMLElement>(
    ASU_CLASS_SEARCH_SELECTORS.courseLabel,
  );

  for (const label of courseLabels) {
    const match = cleanText(label.textContent).match(COURSE_ID_PATTERN);
    if (match) {
      return `${match[1].toUpperCase()} ${match[2].toUpperCase()}`;
    }
  }

  return null;
}

function isProfessorName(value: string): boolean {
  return value.length > 0 && !PLACEHOLDER_INSTRUCTORS.has(value.toLowerCase());
}

function extractProfessorNames(instructorCell: HTMLElement): string[] {
  const linkedNames = Array.from(
    instructorCell.querySelectorAll<HTMLElement>(
      ASU_CLASS_SEARCH_SELECTORS.instructorProfileLink,
    ),
    (link) => cleanText(link.textContent),
  ).filter(isProfessorName);

  if (linkedNames.length > 0) {
    return [...new Set(linkedNames)];
  }

  const unlinkedName = cleanText(instructorCell.textContent);
  return isProfessorName(unlinkedName) ? [unlinkedName] : [];
}

export function scanClassSections(root: ParentNode = document): ScannedClassSection[] {
  const sections: ScannedClassSection[] = [];
  const rows = root.querySelectorAll<HTMLElement>(ASU_CLASS_SEARCH_SELECTORS.resultRow);

  for (const rowElement of rows) {
    const courseId = extractCourseId(rowElement);
    const instructorElement = rowElement.querySelector<HTMLElement>(
      ASU_CLASS_SEARCH_SELECTORS.instructorCell,
    );

    if (!courseId || !instructorElement) {
      continue;
    }

    for (const professorName of extractProfessorNames(instructorElement)) {
      sections.push({
        courseId,
        professorName,
        rowElement,
        instructorElement,
      });
    }
  }

  return sections;
}
