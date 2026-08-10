import { expect } from "vitest";
import {
  isConflictError,
  isNotFoundError,
  isValidationError,
} from "../../application/errors";

export async function expectConflict(
  promise: Promise<unknown>,
  code?: string,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error, "expected a ConflictError rejection").not.toBeNull();
  expect(isConflictError(error)).toBe(true);
  if (code !== undefined && isConflictError(error)) {
    expect(error.code).toBe(code);
  }
}

export async function expectNotFound(
  promise: Promise<unknown>,
  code?: string,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error, "expected a NotFoundError rejection").not.toBeNull();
  expect(isNotFoundError(error)).toBe(true);
  if (code !== undefined && isNotFoundError(error)) {
    expect(error.code).toBe(code);
  }
}

export async function expectValidation(
  promise: Promise<unknown>,
  code?: string,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error, "expected a ValidationError rejection").not.toBeNull();
  expect(isValidationError(error)).toBe(true);
  if (code !== undefined && isValidationError(error)) {
    expect(error.code).toBe(code);
  }
}
