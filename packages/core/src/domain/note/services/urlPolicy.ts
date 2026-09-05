/**
 * Executable form of the URL scheme table of spec/adr/013 「許可する URL
 * スキーム」.
 *
 * The rule lives in the domain rather than beside the sanitizer because
 * more than one surface applies it: the `HtmlProcessor` adapter decides
 * what survives a save, and the editor decides what it is safe to mount
 * in the browser before a save happens. Two implementations of one table
 * can only drift, and either direction of drift is a defect — a surface
 * that keeps what the save drops mounts a scheme the policy refuses, and
 * one that drops what the save keeps hides the body the reader stored.
 *
 * Everything here is a pure function over strings: no fetching, no
 * resolution against a base URL, no DOM.
 */

const set = (...names: readonly string[]): ReadonlySet<string> =>
  new Set(names);

/** Schemes allowed in a navigation target (`href`, `cite`, `xlink:href`). */
export const NAVIGATION_SCHEMES: ReadonlySet<string> = set(
  "https",
  "http",
  "mailto",
  "tel",
);

/** Schemes allowed in a resource reference (`src`, `srcset`, `poster`). */
export const RESOURCE_SCHEMES: ReadonlySet<string> = set("https", "http");

/**
 * `data:` MIME types allowed in a resource reference. Deliberately raster
 * only: `text/html` and `image/svg+xml` can carry script.
 */
export const DATA_URL_MIME_TYPES: ReadonlySet<string> = set(
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
);

/**
 * Which row of the table applies. A navigation target refuses `data:`
 * even though a resource reference may carry it.
 */
export type UrlKind = "navigation" | "resource";

/**
 * Browsers ignore ASCII control characters and whitespace when they read
 * a URL's scheme, so `java&#10;script:alert(1)` navigates while a naive
 * prefix check sees a relative path. Strip them before deciding.
 */
export const stripControls = (url: string): string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the threat being removed.
  url.replace(/[\u0000-\u0020\u007f]/g, "");

/**
 * Scheme of a URL in lower case, or `null` when it has none (fragment,
 * root-relative or relative path).
 */
export const schemeOf = (url: string): string | null => {
  const stripped = stripControls(url);
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(stripped);
  return match === null ? null : (match[1] as string).toLowerCase();
};

/** Whether a `data:` URL carries one of the allowed raster MIME types. */
export const isAllowedDataUrl = (url: string): boolean => {
  const stripped = stripControls(url);
  const match = /^data:([^;,]+)[;,]/i.exec(stripped);
  return (
    match !== null &&
    DATA_URL_MIME_TYPES.has((match[1] as string).toLowerCase())
  );
};

/**
 * Whether `url` may be kept in an attribute of the given kind. A URL with
 * no scheme is always allowed — fragments and relative paths resolve
 * inside the document that carries them.
 */
export const isAllowedUrl = (url: string, kind: UrlKind): boolean => {
  const scheme = schemeOf(url);
  if (scheme === null) {
    return true;
  }
  if (kind === "navigation") {
    return NAVIGATION_SCHEMES.has(scheme);
  }
  return RESOURCE_SCHEMES.has(scheme) || isAllowedDataUrl(url);
};

/** One `url descriptor` pair of a `srcset` attribute. */
export type SrcsetCandidate = Readonly<{ url: string; descriptor: string }>;

/**
 * Splits a `srcset` by the HTML candidate rule rather than on commas: a
 * `data:` URL carries commas of its own, and splitting on them would turn
 * one allowed image into several malformed candidates.
 */
export const parseSrcset = (value: string): readonly SrcsetCandidate[] => {
  const candidates: SrcsetCandidate[] = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i] as string)) {
      i += 1;
    }
    if (i >= value.length) {
      break;
    }
    const start = i;
    while (i < value.length && !/\s/.test(value[i] as string)) {
      i += 1;
    }
    const raw = value.slice(start, i);
    if (raw.endsWith(",")) {
      candidates.push({ url: raw.replace(/,+$/, ""), descriptor: "" });
      continue;
    }
    while (i < value.length && /\s/.test(value[i] as string)) {
      i += 1;
    }
    const descriptorStart = i;
    while (i < value.length && value[i] !== ",") {
      i += 1;
    }
    candidates.push({
      url: raw,
      descriptor: value.slice(descriptorStart, i).trim(),
    });
    i += 1;
  }
  return candidates;
};

/** Serializes candidates back into a `srcset` attribute value. */
export const formatSrcset = (candidates: readonly SrcsetCandidate[]): string =>
  candidates
    .map(({ url, descriptor }) =>
      descriptor.length === 0 ? url : `${url} ${descriptor}`,
    )
    .join(", ");

/**
 * Narrows a `srcset` to the candidates the resource row allows, reporting
 * each rejection with the scheme that caused it (`null` for a candidate
 * whose scheme the table cannot name). Returns `null` when nothing
 * survives, which is the signal to drop the attribute rather than keep an
 * empty one.
 *
 * Every surface that has to shrink a `srcset` goes through this, so no
 * surface can drop a candidate the save keeps.
 */
export const filterAllowedSrcset = (
  value: string,
  onRejected: (rejected: {
    url: string;
    scheme: string | null;
  }) => void = () => {},
): string | null => {
  const kept = parseSrcset(value).filter((candidate) => {
    if (isAllowedUrl(candidate.url, "resource")) {
      return true;
    }
    onRejected({ url: candidate.url, scheme: schemeOf(candidate.url) });
    return false;
  });
  return kept.length === 0 ? null : formatSrcset(kept);
};
