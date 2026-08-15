import { describe, expect, it } from "vitest";
import { createTestHarness } from "../../__tests__/helpers";
import { getAccountDeletionStatus } from "../getAccountDeletionStatus";
import { signUpVerified } from "./authFlowHelpers";
import { runUntilSettled } from "./deletionDriver";
import { acceptDeletion } from "./deletionHarness";

const EMAIL = "user@example.com";
const OTHER_EMAIL = "other@example.com";

const status = (h: ReturnType<typeof createTestHarness>, operationId: string) =>
  getAccountDeletionStatus({ container: h.container, input: { operationId } });

describe("getAccountDeletionStatus", () => {
  it("TC-identity-048: the ticket's own operation is readable after the session is gone, and nothing else is", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    const other = await signUpVerified(h, OTHER_EMAIL);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });
    const otherOperationId = await acceptDeletion(h, {
      userId: other.userId,
      email: OTHER_EMAIL,
    });

    // The session died with the accept response; the read must still
    // work, and it must carry nothing but this one operation's state.
    const running = await status(h, operationId);
    expect(running).toEqual({ operationId, status: "running" });

    // The other operation exists and answers only under its own id: an
    // id is the whole authority, and one id never widens into another.
    expect(otherOperationId).not.toBe(operationId);
    expect(await status(h, otherOperationId)).toEqual({
      operationId: otherOperationId,
      status: "running",
    });
    await expect(status(h, "op-that-does-not-exist")).rejects.toMatchObject({
      code: "DELETION_OPERATION_NOT_FOUND",
    });

    expect(await runUntilSettled(h, operationId)).toBe("completed");
    expect(await status(h, operationId)).toEqual({
      operationId,
      status: "completed",
    });
  });

  it("refuses to answer for an operation of another kind", async () => {
    const h = createTestHarness();
    const operation = await h.container.globalUnitOfWorkProvider.run((ctx) =>
      ctx.distributedOperationStore.beginOrResume({
        kind: "noteMove",
        partitionKey: "user-1",
        requestKey: "33333333-3333-4333-8333-333333333333",
        payload: {},
      }),
    );

    await expect(status(h, operation.operation.id)).rejects.toMatchObject({
      code: "DELETION_OPERATION_NOT_FOUND",
    });
  });
});
