/**
 * Open-redirect guard: only same-origin absolute paths survive
 * (`//evil.example` and scheme-ful values fall back to `/notes`).
 *
 * Kept in its own module — free of `createServerFn` and every other
 * framework import — so it stays a plain pure function that unit tests can
 * import without pulling the server-function runtime in.
 */
export function safeRedirectPath(value: string | undefined | null): string {
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
  ) {
    return value;
  }
  return "/notes";
}
