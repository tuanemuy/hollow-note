const FALLBACK_TIME_ZONE = "UTC";

type WallClock = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}>;

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return formatterFor(FALLBACK_TIME_ZONE);
  }
};

export const wallClockOf = (instant: Date, timeZone: string): WallClock => {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  // `hour12: false` may still yield "24" at midnight in some ICU builds.
  const hour = read("hour") % 24;
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour,
    minute: read("minute"),
    second: read("second"),
  };
};

/** UTC instant of the given wall-clock date's local midnight. */
export const utcInstantOfLocalMidnight = (
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date => {
  let ts = Date.UTC(year, month - 1, day);
  for (let i = 0; i < 3; i += 1) {
    const wall = wallClockOf(new Date(ts), timeZone);
    const asUtc = Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
    const diff = Date.UTC(year, month - 1, day) - asUtc;
    if (diff === 0) {
      break;
    }
    ts += diff;
  }
  return new Date(ts);
};

export const dayKeyOf = (instant: Date, timeZone: string): string => {
  const wall = wallClockOf(instant, timeZone);
  const mm = String(wall.month).padStart(2, "0");
  const dd = String(wall.day).padStart(2, "0");
  return `${wall.year}-${mm}-${dd}`;
};
