/**
 * Calendar arithmetic in the viewer's time zone.
 *
 * `listMonthsWithNotes` and `countByDay` group by a *local* calendar
 * unit, and SQLite has no IANA time-zone database — `datetime(?, 'unixepoch')`
 * only knows UTC and the host's offset, and inside workerd there is no
 * host offset to speak of. So the rows come back as instants and the
 * bucketing happens here, over `Intl`, which workerd carries in full.
 */

const FALLBACK_TIME_ZONE = "UTC";

type WallClock = Readonly<{ year: number; month: number; day: number }>;

/**
 * Building a formatter resolves locale and time-zone data and costs far
 * more than formatting with one, while a caller buckets a whole result set
 * through a single time zone. The cache is capped and dropped wholesale
 * because the key is a caller-supplied string and the isolate outlives the
 * request.
 */
const MAX_CACHED_FORMATTERS = 32;
const formatters = new Map<string, Intl.DateTimeFormat>();

const buildFormatter = (timeZone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

const buildOrFallback = (timeZone: string): Intl.DateTimeFormat => {
  try {
    return buildFormatter(timeZone);
  } catch {
    return buildFormatter(FALLBACK_TIME_ZONE);
  }
};

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
  const built = buildOrFallback(timeZone);
  if (formatters.size >= MAX_CACHED_FORMATTERS) {
    formatters.clear();
  }
  formatters.set(timeZone, built);
  return built;
};

export const wallClockOf = (instant: Date, timeZone: string): WallClock => {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: read("year"), month: read("month"), day: read("day") };
};

export const dayKeyOf = (instant: Date, timeZone: string): string => {
  const wall = wallClockOf(instant, timeZone);
  const month = String(wall.month).padStart(2, "0");
  const day = String(wall.day).padStart(2, "0");
  return `${wall.year}-${month}-${day}`;
};
