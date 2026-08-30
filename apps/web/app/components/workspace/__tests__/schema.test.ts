import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { EMAIL_MAX_LENGTH } from "@/components/auth/schema";
import {
  changeMemberRoleSchema,
  changeWorkspaceSlugSchema,
  createWorkspaceSchema,
  deleteWorkspaceSchema,
  invitationRefSchema,
  invitationTokenSchema,
  inviteMemberSchema,
  membershipRefSchema,
  updateWorkspaceProfileSchema,
  WORKSPACE_DESCRIPTION_MAX_LENGTH,
  WORKSPACE_ID_MAX_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
  WORKSPACE_SLUG_MAX_LENGTH,
  workspaceAvatarUploadSchema,
  workspaceRefSchema,
  workspaceSlugAvailabilitySchema,
} from "../schema";

const accepts = (schema: z.ZodType, value: unknown): boolean =>
  schema.safeParse(value).success;

const chars = (length: number): string => "a".repeat(length);

const emailOfLength = (length: number): string =>
  `${chars(length - "@example.com".length)}@example.com`;

const fileOfBytes = (size: number): File =>
  new File([new Uint8Array(size)], "avatar.png", { type: "image/png" });

const AVATAR_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
const ID = "ws_01H";

describe("workspace transport schemas", () => {
  describe("createWorkspaceSchema", () => {
    it("leaves the business ceilings one character of headroom", () => {
      const base = { description: "", slug: "" };
      expect(
        accepts(createWorkspaceSchema, {
          ...base,
          name: chars(WORKSPACE_NAME_MAX_LENGTH + 1),
        }),
      ).toBe(true);
      expect(
        accepts(createWorkspaceSchema, {
          ...base,
          name: chars(WORKSPACE_NAME_MAX_LENGTH + 2),
        }),
      ).toBe(false);
      expect(
        accepts(createWorkspaceSchema, {
          ...base,
          name: "n",
          description: chars(WORKSPACE_DESCRIPTION_MAX_LENGTH + 1),
        }),
      ).toBe(true);
      expect(
        accepts(createWorkspaceSchema, {
          ...base,
          name: "n",
          description: chars(WORKSPACE_DESCRIPTION_MAX_LENGTH + 2),
        }),
      ).toBe(false);
      expect(
        accepts(createWorkspaceSchema, {
          ...base,
          name: "n",
          slug: chars(WORKSPACE_SLUG_MAX_LENGTH + 1),
        }),
      ).toBe(true);
      expect(
        accepts(createWorkspaceSchema, {
          ...base,
          name: "n",
          slug: chars(WORKSPACE_SLUG_MAX_LENGTH + 2),
        }),
      ).toBe(false);
    });

    it("takes an empty slug as「設定しない」but never an empty name", () => {
      expect(
        accepts(createWorkspaceSchema, {
          name: "n",
          description: "",
          slug: "",
        }),
      ).toBe(true);
      expect(
        accepts(createWorkspaceSchema, { name: "", description: "", slug: "" }),
      ).toBe(false);
    });
  });

  describe("updateWorkspaceProfileSchema", () => {
    it("treats every field but the target as optional", () => {
      expect(accepts(updateWorkspaceProfileSchema, { workspaceId: ID })).toBe(
        true,
      );
      expect(
        accepts(updateWorkspaceProfileSchema, {
          workspaceId: ID,
          avatarUrl: null,
        }),
      ).toBe(true);
      expect(accepts(updateWorkspaceProfileSchema, {})).toBe(false);
    });

    it("bounds the avatar URL", () => {
      expect(
        accepts(updateWorkspaceProfileSchema, {
          workspaceId: ID,
          avatarUrl: chars(2048),
        }),
      ).toBe(true);
      expect(
        accepts(updateWorkspaceProfileSchema, {
          workspaceId: ID,
          avatarUrl: chars(2049),
        }),
      ).toBe(false);
    });
  });

  describe("changeWorkspaceSlugSchema", () => {
    it("accepts the empty slug because that is how a slug is released", () => {
      expect(
        accepts(changeWorkspaceSlugSchema, { workspaceId: ID, slug: "" }),
      ).toBe(true);
      expect(
        accepts(changeWorkspaceSlugSchema, {
          workspaceId: ID,
          slug: chars(WORKSPACE_SLUG_MAX_LENGTH + 2),
        }),
      ).toBe(false);
    });
  });

  describe("workspaceSlugAvailabilitySchema", () => {
    it("requires a slug to ask about and an explicit null for「作成中」", () => {
      expect(
        accepts(workspaceSlugAvailabilitySchema, {
          slug: "team",
          workspaceId: null,
        }),
      ).toBe(true);
      expect(
        accepts(workspaceSlugAvailabilitySchema, {
          slug: "team",
          workspaceId: ID,
        }),
      ).toBe(true);
      expect(accepts(workspaceSlugAvailabilitySchema, { slug: "team" })).toBe(
        false,
      );
      expect(
        accepts(workspaceSlugAvailabilitySchema, {
          slug: "",
          workspaceId: null,
        }),
      ).toBe(false);
    });
  });

  describe("workspaceRefSchema / membershipRefSchema / invitationRefSchema", () => {
    it("bounds every id and rejects an empty one", () => {
      expect(
        accepts(workspaceRefSchema, {
          workspaceId: chars(WORKSPACE_ID_MAX_LENGTH),
        }),
      ).toBe(true);
      expect(
        accepts(workspaceRefSchema, {
          workspaceId: chars(WORKSPACE_ID_MAX_LENGTH + 1),
        }),
      ).toBe(false);
      expect(accepts(workspaceRefSchema, { workspaceId: "" })).toBe(false);
      expect(
        accepts(membershipRefSchema, { workspaceId: ID, membershipId: "m_1" }),
      ).toBe(true);
      expect(accepts(membershipRefSchema, { workspaceId: ID })).toBe(false);
      expect(
        accepts(invitationRefSchema, { workspaceId: ID, invitationId: "i_1" }),
      ).toBe(true);
      expect(accepts(invitationRefSchema, { workspaceId: ID })).toBe(false);
    });
  });

  describe("deleteWorkspaceSchema", () => {
    it("lets a wrong confirmation through so the usecase decides", () => {
      expect(
        accepts(deleteWorkspaceSchema, {
          workspaceId: ID,
          confirmationName: "",
        }),
      ).toBe(true);
      expect(
        accepts(deleteWorkspaceSchema, {
          workspaceId: ID,
          confirmationName: chars(WORKSPACE_NAME_MAX_LENGTH + 1),
        }),
      ).toBe(true);
      expect(
        accepts(deleteWorkspaceSchema, {
          workspaceId: ID,
          confirmationName: chars(WORKSPACE_NAME_MAX_LENGTH + 2),
        }),
      ).toBe(false);
    });
  });

  describe("workspaceAvatarUploadSchema", () => {
    it("passes 8 MB to the upload policy and stops one byte later", () => {
      expect(
        accepts(workspaceAvatarUploadSchema, {
          workspaceId: ID,
          file: fileOfBytes(AVATAR_UPLOAD_MAX_BYTES),
        }),
      ).toBe(true);
      expect(
        accepts(workspaceAvatarUploadSchema, {
          workspaceId: ID,
          file: fileOfBytes(AVATAR_UPLOAD_MAX_BYTES + 1),
        }),
      ).toBe(false);
    });

    it("rejects an empty file and anything that is not a File", () => {
      expect(
        accepts(workspaceAvatarUploadSchema, {
          workspaceId: ID,
          file: fileOfBytes(0),
        }),
      ).toBe(false);
      expect(
        accepts(workspaceAvatarUploadSchema, {
          workspaceId: ID,
          file: "avatar.png",
        }),
      ).toBe(false);
    });
  });

  describe("inviteMemberSchema", () => {
    it("closes the address format at the transport boundary", () => {
      const invite = (email: string) => ({
        workspaceId: ID,
        email,
        role: "editor",
      });
      expect(accepts(inviteMemberSchema, invite("user@example.com"))).toBe(
        true,
      );
      expect(accepts(inviteMemberSchema, invite("user@localhost"))).toBe(true);
      expect(accepts(inviteMemberSchema, invite("user.example.com"))).toBe(
        false,
      );
      expect(accepts(inviteMemberSchema, invite("us er@example.com"))).toBe(
        false,
      );
      expect(accepts(inviteMemberSchema, invite("user@ex@ample.com"))).toBe(
        false,
      );
      expect(accepts(inviteMemberSchema, invite(""))).toBe(false);
    });

    it("trims before measuring", () => {
      const parsed = inviteMemberSchema.safeParse({
        workspaceId: ID,
        email: "  user@example.com  ",
        role: "editor",
      });
      expect(parsed.success && parsed.data.email).toBe("user@example.com");
      expect(
        accepts(inviteMemberSchema, {
          workspaceId: ID,
          email: emailOfLength(EMAIL_MAX_LENGTH),
          role: "editor",
        }),
      ).toBe(true);
      expect(
        accepts(inviteMemberSchema, {
          workspaceId: ID,
          email: emailOfLength(EMAIL_MAX_LENGTH + 1),
          role: "editor",
        }),
      ).toBe(false);
    });
  });

  describe("changeMemberRoleSchema", () => {
    it("lets an unknown role through to the domain", () => {
      const change = (role: unknown) => ({
        workspaceId: ID,
        membershipId: "m_1",
        role,
      });
      expect(accepts(changeMemberRoleSchema, change("owner"))).toBe(true);
      expect(accepts(changeMemberRoleSchema, change("wizard"))).toBe(true);
      expect(accepts(changeMemberRoleSchema, change(""))).toBe(false);
      expect(accepts(changeMemberRoleSchema, change(chars(17)))).toBe(false);
      expect(accepts(changeMemberRoleSchema, change(1))).toBe(false);
    });
  });

  describe("invitationTokenSchema", () => {
    it("bounds the token like the other auth tokens", () => {
      expect(accepts(invitationTokenSchema, { token: chars(512) })).toBe(true);
      expect(accepts(invitationTokenSchema, { token: chars(513) })).toBe(false);
      expect(accepts(invitationTokenSchema, { token: "" })).toBe(false);
    });
  });
});
