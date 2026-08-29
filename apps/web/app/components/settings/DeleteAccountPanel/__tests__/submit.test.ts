import { describe, expect, it } from "vitest";
import { AppServerError } from "@/presentation/errorResponse";
import { submitFailure } from "../submit";

const RAW_MESSAGE = "The confirmation address does not match the account";

describe("submitFailure", () => {
  it("puts a confirmation mismatch on the email field", () => {
    const failure = submitFailure(
      new AppServerError({
        kind: "validation",
        code: "CONFIRMATION_MISMATCH",
        message: RAW_MESSAGE,
      }),
    );

    expect(failure.target).toBe("field");
    expect(failure.message).toBe(
      "メールアドレスが一致しません。アカウントのメールアドレスをそのまま入力してください。",
    );
  });

  it("routes remaining workspace memberships to the blocked state with its own wording", () => {
    const failure = submitFailure(
      new AppServerError({
        kind: "conflict",
        code: "WORKSPACE_MEMBERSHIPS_REMAIN",
        message: "Leave or hand over every workspace before deleting",
      }),
    );

    expect(failure.target).toBe("blocked");
    expect(failure.message).toBe(
      "参加中のワークスペースがあるため、アカウントを削除できません。ワークスペースから脱退するか、owner を他のメンバーに譲るか、ワークスペースを削除してからもう一度お試しください。",
    );
  });

  it("keeps a failure unrelated to the input off the field slot", () => {
    for (const error of [
      new AppServerError({
        kind: "unauthorized",
        code: "UNAUTHENTICATED",
        message: "Not authenticated",
      }),
      new AppServerError({
        kind: "conflict",
        code: "ACCOUNT_DELETION_OPERATION_MISMATCH",
        message: "Another deletion operation owns this account",
      }),
      new Error(RAW_MESSAGE),
    ]) {
      const failure = submitFailure(error);
      expect(failure.target).toBe("panel");
      expect(failure.message).not.toContain(RAW_MESSAGE);
    }
  });
});
