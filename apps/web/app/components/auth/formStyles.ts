// Shared class recipes for the auth forms (P-01 / P-02) so the two
// screens can't drift visually. Mirrors spec/design/pages/P01/P02.
export const inputClass =
  "h-11 w-full rounded-md border border-hairline-strong bg-bg px-3 text-base text-ink placeholder:text-ink-tertiary transition-colors hover:border-ink-tertiary focus:border-transparent focus:shadow-focus focus:outline-none disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-tertiary";

export const inputInvalidClass = "border-error";

export const submitButtonClass =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-accent text-sm font-medium text-bg transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-accent";

export const fieldLabelClass = "mb-2 block text-sm font-medium";

// The error slot is a permanently mounted live region, so the margin is
// conditional instead of the element: hiding it while empty would take it
// out of the accessibility tree, and text inserted into a node that was not
// in that tree is not announced.
export const fieldErrorClass = "not-empty:mt-2 text-xs text-error";

export const footLinkClass = "text-accent hover:underline underline-offset-3";
