/**
 * Half-open instant range: `from` inclusive, `toExclusive` exclusive.
 * Calendar-derived ranges (months, days) are resolved into this shape by
 * the application-level `TimeZoneResolver` port; query ports consume it
 * without knowing which time zone produced the boundaries.
 */
export type DateRange = Readonly<{
  from: Date;
  toExclusive: Date;
}>;

/** Calendar month in some viewer time zone. `month` is 1-12. */
export type YearMonth = Readonly<{
  year: number;
  month: number;
}>;
