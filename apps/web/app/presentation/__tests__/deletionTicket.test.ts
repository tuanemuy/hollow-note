import type { DeletionTicketKeyRing } from "@repo/core/application/di/types";
import { isValidationError } from "@repo/core/application/errors";
import { describe, expect, it } from "vitest";
import {
  DELETION_TICKET_TTL_MS,
  issueDeletionTicket,
  readDeletionTicket,
} from "../deletionTicket";

const NOW = new Date("2026-08-12T00:00:00.000Z");
const OPERATION_ID = "operation-1";

const keyRing = (version: number, seed: number): DeletionTicketKeyRing => ({
  currentVersion: version,
  keys: new Map([[version, new Uint8Array(32).fill(seed)]]),
});

const RING = keyRing(1, 7);

const toBase64Url = (value: string): string =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const decodeClaims = (ticket: string): unknown => {
  const claims = (ticket.split(".")[1] ?? "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return JSON.parse(atob(claims.padEnd(Math.ceil(claims.length / 4) * 4, "=")));
};

const expectCode = async (
  run: () => Promise<unknown>,
  code: string,
): Promise<void> => {
  await expect(run()).rejects.toSatisfy(
    (error: unknown) => isValidationError(error) && error.code === code,
  );
};

describe("deletion status ticket", () => {
  it("carries the operation it was issued for, and nothing else", async () => {
    const ticket = await issueDeletionTicket(RING, {
      operationId: OPERATION_ID,
      now: NOW,
    });

    const claims = await readDeletionTicket(RING, ticket, NOW);

    expect(claims.operationId).toBe(OPERATION_ID);
    expect(claims.expiresAt.getTime()).toBe(
      NOW.getTime() + DELETION_TICKET_TTL_MS,
    );
    // The whole grant is the operation id and the deadline: there is no
    // user id, no session, and no request key to widen the read with.
    expect(decodeClaims(ticket)).toEqual({
      o: OPERATION_ID,
      e: NOW.getTime() + DELETION_TICKET_TTL_MS,
    });
  });

  it("refuses a ticket whose claims were rewritten to another operation", async () => {
    const ticket = await issueDeletionTicket(RING, {
      operationId: OPERATION_ID,
      now: NOW,
    });
    const [version, , signature] = ticket.split(".");
    const forged = toBase64Url(
      JSON.stringify({ o: "operation-2", e: 2 ** 45 }),
    );

    await expectCode(
      () => readDeletionTicket(RING, `${version}.${forged}.${signature}`, NOW),
      "DELETION_TICKET_INVALID",
    );
  });

  it("refuses a ticket signed with another deployment's key", async () => {
    const ticket = await issueDeletionTicket(keyRing(1, 9), {
      operationId: OPERATION_ID,
      now: NOW,
    });

    await expectCode(
      () => readDeletionTicket(RING, ticket, NOW),
      "DELETION_TICKET_INVALID",
    );
  });

  it("refuses a version the ring cannot resolve, and keeps verifying an older one it can", async () => {
    const rotated: DeletionTicketKeyRing = {
      currentVersion: 2,
      keys: new Map([
        [1, new Uint8Array(32).fill(7)],
        [2, new Uint8Array(32).fill(8)],
      ]),
    };
    const oldTicket = await issueDeletionTicket(RING, {
      operationId: OPERATION_ID,
      now: NOW,
    });

    expect(
      (await readDeletionTicket(rotated, oldTicket, NOW)).operationId,
    ).toBe(OPERATION_ID);
    await expectCode(
      () => readDeletionTicket(RING, oldTicket.replace(/^1\./, "3."), NOW),
      "DELETION_TICKET_INVALID",
    );
  });

  it("refuses anything that is not a ticket", async () => {
    for (const malformed of ["", "1", "1.2", "1.2.3.4", "1.!!.??"]) {
      await expectCode(
        () => readDeletionTicket(RING, malformed, NOW),
        "DELETION_TICKET_INVALID",
      );
    }
  });

  it("expires 30 minutes after it was issued, inclusive of the deadline", async () => {
    const ticket = await issueDeletionTicket(RING, {
      operationId: OPERATION_ID,
      now: NOW,
    });
    const deadline = NOW.getTime() + DELETION_TICKET_TTL_MS;

    expect(
      (await readDeletionTicket(RING, ticket, new Date(deadline - 1)))
        .operationId,
    ).toBe(OPERATION_ID);
    await expectCode(
      () => readDeletionTicket(RING, ticket, new Date(deadline)),
      "DELETION_TICKET_EXPIRED",
    );
  });
});
