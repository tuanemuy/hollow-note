import { z } from "zod";

// Transport-boundary schemas — shape / DoS checks only. Business
// invariants (letter+digit rule, reserved handles, …) live in the
// domain value objects; this module stays importable from client code.
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 50;

export const signUpSchema = z.object({
  email: z.string().trim().min(1).max(EMAIL_MAX_LENGTH),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  termsAccepted: z.boolean(),
});

export const signInSchema = z.object({
  email: z.string().trim().min(1).max(EMAIL_MAX_LENGTH),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const verifyEmailSchema = z.object({
  // Generous ceiling: the opaque token is `base64url(userId).secret`.
  token: z.string().min(1).max(512),
});
