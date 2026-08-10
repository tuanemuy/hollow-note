import { describe, expect, it } from "vitest";
import type { Logger } from "../../../application/ports/logger";
import { createMemoryMailSender } from "../mailSender";
import { createIntlTimeZoneResolver } from "../timeZoneResolver";

describe("createMemoryMailSender (ADP-common-032)", () => {
  const message = {
    to: "u1@example.com",
    template: {
      kind: "emailVerification",
      verifyUrl: "https://app.test/verify-email?token=t",
      expiresAt: new Date("2026-01-02T00:00:00Z"),
    },
    locale: "ja",
  } as const;

  const recordingLogger = (sink: unknown[]): Logger => ({
    info: (_message, meta) => sink.push(meta),
    warn: () => undefined,
    error: () => undefined,
  });

  it("records deliveries and logs the action URL when opted in", async () => {
    const logged: unknown[] = [];
    const sender = createMemoryMailSender(recordingLogger(logged), {
      logActionUrl: true,
    });

    await sender.send(message);

    expect(sender.sent()).toHaveLength(1);
    expect(sender.sent()[0]?.to).toBe("u1@example.com");
    expect(logged[0]).toMatchObject({
      template: "emailVerification",
      actionUrl: "https://app.test/verify-email?token=t",
    });
  });

  it("omits the action URL by default — the raw token must not reach logs", async () => {
    const logged: unknown[] = [];
    const sender = createMemoryMailSender(recordingLogger(logged), {
      logActionUrl: false,
    });

    await sender.send(message);

    expect(logged[0]).toMatchObject({
      to: "u1@example.com",
      template: "emailVerification",
    });
    expect(logged[0]).not.toHaveProperty("actionUrl");
    expect(sender.sent()[0]?.template).toMatchObject({
      verifyUrl: "https://app.test/verify-email?token=t",
    });
  });
});

describe("createIntlTimeZoneResolver (ADP-common-033..035)", () => {
  const resolver = createIntlTimeZoneResolver();

  it("dayKey resolves the local calendar day", () => {
    const instant = new Date("2026-03-01T20:00:00Z");
    expect(resolver.dayKey(instant, "UTC")).toBe("2026-03-01");
    expect(resolver.dayKey(instant, "Asia/Tokyo")).toBe("2026-03-02");
  });

  it("monthOf resolves the local calendar month across the date line", () => {
    const instant = new Date("2026-02-28T20:00:00Z");
    expect(resolver.monthOf(instant, "UTC")).toEqual({ year: 2026, month: 2 });
    expect(resolver.monthOf(instant, "Asia/Tokyo")).toEqual({
      year: 2026,
      month: 3,
    });
  });

  it("monthRange is the half-open span between local midnights", () => {
    const range = resolver.monthRange({ year: 2026, month: 3 }, "Asia/Tokyo");
    expect(range.from.toISOString()).toBe("2026-02-28T15:00:00.000Z");
    expect(range.toExclusive.toISOString()).toBe("2026-03-31T15:00:00.000Z");
  });

  it("monthRange handles the December→January rollover", () => {
    const range = resolver.monthRange({ year: 2026, month: 12 }, "UTC");
    expect(range.from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(range.toExclusive.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("an invalid time zone falls back to UTC", () => {
    const instant = new Date("2026-03-01T20:00:00Z");
    expect(resolver.dayKey(instant, "Not/AZone")).toBe("2026-03-01");
    expect(resolver.monthOf(instant, "Not/AZone")).toEqual({
      year: 2026,
      month: 3,
    });
  });
});
