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

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return formatterFor(FALLBACK_TIME_ZONE);
  }
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
