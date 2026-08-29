import { describe, expect, it } from "vitest";
import { remainingListing } from "../remaining";

const ACTIVE = {
  status: "active",
  workspaceId: "01JQ0000000000000000000001",
  name: "デザインチーム",
  isOwner: true,
} as const;

describe("remainingListing", () => {
  it("keeps a rejection with no rows apart from one that could not be read", () => {
    expect(remainingListing({ workspaces: [], hasMore: false })).toEqual({
      kind: "settling",
    });
    expect(remainingListing(null)).toEqual({ kind: "unavailable" });
  });

  it("carries the rows and the continuation flag through", () => {
    const listing = remainingListing({
      workspaces: [ACTIVE, { status: "unavailable", workspaceId: "w2" }],
      hasMore: true,
    });

    expect(listing).toEqual({
      kind: "listed",
      workspaces: [ACTIVE, { status: "unavailable", workspaceId: "w2" }],
      hasMore: true,
    });
  });

  it("does not report a continuation the page did not claim", () => {
    const listing = remainingListing({
      workspaces: [ACTIVE],
      hasMore: false,
    });

    expect(listing.kind === "listed" && listing.hasMore).toBe(false);
  });
});
