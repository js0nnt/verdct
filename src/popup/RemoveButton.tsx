/**
 * The × on a row. It stays faint until the row is hovered or the button is
 * focused, so a list of rows does not read as a list of things to delete.
 * Needs a `group` class on the row it sits in.
 */
export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink-faint opacity-0 transition-[opacity,background-color,color,transform] duration-200 hover:bg-black/[0.06] hover:text-ink focus-visible:opacity-100 active:scale-90 group-hover:opacity-100 dark:text-inkdark-faint dark:hover:bg-white/10 dark:hover:text-inkdark"
    >
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
        <path
          d="M2.5 2.5l7 7M9.5 2.5l-7 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
