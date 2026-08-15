import { describe, expect, it } from "vitest";
import { canRestoreTicket, parseStoredTicket } from "../ticketStorage";

describe("parseStoredTicket", () => {
  it("keeps the ticket and the subject it was stored with", () => {
    expect(
      parseStoredTicket(JSON.stringify({ ticket: "t1", userId: "u1" })),
    ).toStrictEqual({ ticket: "t1", userId: "u1" });
  });

  it("falls back to a null subject when the record has no usable userId", () => {
    for (const raw of [
      JSON.stringify({ ticket: "t1" }),
      JSON.stringify({ ticket: "t1", userId: null }),
      JSON.stringify({ ticket: "t1", userId: 42 }),
    ]) {
      expect([raw, parseStoredTicket(raw)]).toStrictEqual([
        raw,
        { ticket: "t1", userId: null },
      ]);
    }
  });

  it("rejects anything that is not a record carrying a string ticket", () => {
    const samples = [
      null,
      "",
      "{",
      "not json",
      JSON.stringify(null),
      JSON.stringify("t1"),
      JSON.stringify(42),
      JSON.stringify({}),
      JSON.stringify({ ticket: 42 }),
      JSON.stringify({ ticket: null, userId: "u1" }),
    ];
    for (const raw of samples) {
      expect([raw, parseStoredTicket(raw)]).toStrictEqual([raw, null]);
    }
  });

  it("reads an array as a record without a ticket", () => {
    expect(parseStoredTicket(JSON.stringify(["t1"]))).toBeNull();
  });
});

describe("canRestoreTicket", () => {
  it("restores the progress of the subject it was stored for", () => {
    expect(canRestoreTicket({ ticket: "t1", userId: "u1" }, "u1")).toBe(true);
  });

  it("does not show one user the deletion of another", () => {
    expect(canRestoreTicket({ ticket: "t1", userId: "u1" }, "u2")).toBe(false);
    expect(canRestoreTicket({ ticket: "t1", userId: null }, "u2")).toBe(false);
  });

  it("restores when there is no session, since only the deleted user gets there", () => {
    expect(canRestoreTicket({ ticket: "t1", userId: "u1" }, null)).toBe(true);
    expect(canRestoreTicket({ ticket: "t1", userId: null }, null)).toBe(true);
  });
});
