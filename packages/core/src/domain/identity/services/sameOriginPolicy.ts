/**
 * Whether a value is an app-relative path that can only ever resolve on the
 * origin it is resolved against.
 *
 * A leading slash alone does not prove it. URL parsers treat a backslash as
 * a path separator under a special scheme and strip C0 controls before
 * resolving, so both `"/\evil.test/x"` and `"/\n/evil.test/x"` survive a
 * naive prefix check and only then resolve cross-origin — as does the
 * protocol-relative `"//evil.test/x"`.
 *
 * Every same-origin decision in the identity domain (stored avatar
 * locations, replayed post-flow redirects) goes through this one predicate
 * so the three shapes above can never be rejected in one place and accepted
 * in another.
 */
export const SameOriginPolicy = {
  isSameOriginPath: (value: string): boolean => {
    if (
      !value.startsWith("/") ||
      value.startsWith("//") ||
      value.includes("\\")
    ) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 0x1f || code === 0x7f) {
        return false;
      }
    }
    return true;
  },
};
