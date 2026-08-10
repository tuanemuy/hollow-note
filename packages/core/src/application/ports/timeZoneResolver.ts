import type { DateRange, YearMonth } from "@repo/core/domain/common/time";

/**
 * Calendar-boundary resolution in the viewer's time zone (OR-02 / OR-05).
 * The time zone arrives per request from the client; invalid values fall
 * back to `"UTC"` — there are no error cases.
 */
export interface TimeZoneResolver {
  monthRange(month: YearMonth, timeZone: string): DateRange;
  monthOf(instant: Date, timeZone: string): YearMonth;
  /** Local calendar day as `"YYYY-MM-DD"`. */
  dayKey(instant: Date, timeZone: string): string;
}
