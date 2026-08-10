/**
 * URL parsers strip C0 controls and DEL before interpreting a URL, so
 * `"/\n/evil.example"` would pass a naive prefix check and only then
 * resolve as `//evil.example`.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Open-redirect guard: only same-origin absolute paths survive
 * (`//evil.example`, scheme-ful values and control-character smuggling
 * all fall back to `/notes`).
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
    !value.includes("\\") &&
    !hasControlCharacter(value)
  ) {
    return value;
  }
  return "/notes";
}
