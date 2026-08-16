import { Identity } from "@repo/core/domain/identity/identity";
import { IdentityPolicy } from "@repo/core/domain/identity/services/identityPolicy";
import { PlainPassword, UserId } from "@repo/core/domain/identity/valueObject";
import { NotFoundError, ValidationError } from "../errors";
import type { ServiceArgs } from "../types";
import type { AddPasswordIdentityView } from "./view";

export type AddPasswordIdentityInput = Readonly<{
  userId: string;
  newPassword: string;
}>;

/**
 * Adds a password to an account that signs in through OAuth only
 * (UC-identity-013, spec/usecases/identity.md#addpasswordidentity).
 *
 * `ensureAddable` / `ensurePasswordAddable` run twice on purpose: once
 * up front so a hopeless request never pays for a password hash, and
 * again against the set re-read inside the unit of work, which is the
 * only check that holds under two concurrent adds. The same transaction
 * re-reads the user, because adding an identity is credential issuance
 * and must stay serialized against deletion start
 * (spec/usecases/identity.md 認証資格発行と削除開始の直列化).
 */
export async function addPasswordIdentity({
  container,
  input,
}: ServiceArgs<AddPasswordIdentityInput>): Promise<AddPasswordIdentityView> {
  const {
    clock,
    idGenerator,
    identityReader,
    passwordHasher,
    globalUnitOfWorkProvider,
  } = container;

  const userId = UserId.create(input.userId);
  const existing = await identityReader.listByUserId(userId);
  IdentityPolicy.ensureAddable(existing);
  IdentityPolicy.ensurePasswordAddable(existing);

  const password = PlainPassword.create(input.newPassword);
  const passwordHash = await passwordHasher.hash(password);
  const now = clock.now();

  return globalUnitOfWorkProvider.run(async (ctx) => {
    const fresh = await ctx.userRepository.findById(userId);
    if (fresh === null) {
      throw new NotFoundError("USER_NOT_FOUND", "User not found");
    }
    if (fresh.entity.status !== "active") {
      throw new ValidationError(
        "ACCOUNT_UNAVAILABLE",
        "Account is unavailable",
      );
    }

    const current = await ctx.identityRepository.listByUserId(userId);
    IdentityPolicy.ensureAddable(current);
    IdentityPolicy.ensurePasswordAddable(current);

    const created = Identity.createPassword(
      { id: idGenerator.next(), userId, passwordHash },
      now,
    );
    await ctx.identityRepository.insert(created.entity);
    ctx.collectEvents(created.eventDrafts);

    return { identityId: created.entity.id };
  });
}
