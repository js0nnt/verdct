import { professorUrl } from '../shared/constants';

/**
 * An instructor's name, linking to their RateMyProfessor page when Verdct has
 * matched them to one. An unmatched name stays plain text rather than linking
 * to a search that might land on the wrong person.
 */
export function ProfessorName({ name, legacyId }: { name: string; legacyId: number | null }) {
  if (legacyId === null) return <span className="truncate">{name}</span>;
  return (
    <a
      href={professorUrl(legacyId)}
      target="_blank"
      rel="noopener noreferrer"
      title={`${name} on RateMyProfessor`}
      className="group/name inline-flex min-w-0 items-center gap-0.5 rounded-sm underline decoration-line-strong decoration-1 underline-offset-[3px] transition-colors duration-150 hover:text-ink hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-faint/60 dark:decoration-line-darkstrong dark:hover:text-inkdark"
    >
      <span className="truncate">{name}</span>
      <svg
        viewBox="0 0 10 10"
        width="8"
        height="8"
        aria-hidden="true"
        className="shrink-0 opacity-0 transition-[opacity,transform] duration-150 group-hover/name:translate-x-px group-hover/name:-translate-y-px group-hover/name:opacity-70"
      >
        <path d="M3 7l4-4M3.5 3H7v3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
