import type { TimeZoneResolver } from "../../application/ports/timeZoneResolver";
import type { DateRange, YearMonth } from "../../domain/common/time";
import { dayKeyOf, utcInstantOfLocalMidnight, wallClockOf } from "./timeZone";

/**
 * `Intl.DateTimeFormat`-backed `TimeZoneResolver`. Invalid time zones
 * fall back to `"UTC"` — there are no error cases.
 */
export function createIntlTimeZoneResolver(): TimeZoneResolver {
  return {
    monthRange(month: YearMonth, timeZone: string): DateRange {
      const nextMonth =
        month.month === 12
          ? { year: month.year + 1, month: 1 }
          : { year: month.year, month: month.month + 1 };
      return {
        from: utcInstantOfLocalMidnight(month.year, month.month, 1, timeZone),
        toExclusive: utcInstantOfLocalMidnight(
          nextMonth.year,
          nextMonth.month,
          1,
          timeZone,
        ),
      };
    },

    monthOf(instant: Date, timeZone: string): YearMonth {
      const wall = wallClockOf(instant, timeZone);
      return { year: wall.year, month: wall.month };
    },

    dayKey(instant: Date, timeZone: string): string {
      return dayKeyOf(instant, timeZone);
    },
  };
}
