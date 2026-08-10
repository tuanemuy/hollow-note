export type MailTemplate =
  | Readonly<{ kind: "emailVerification"; verifyUrl: string; expiresAt: Date }>
  | Readonly<{ kind: "passwordReset"; resetUrl: string; expiresAt: Date }>
  /** Guidance for an address whose account has no password identity. */
  | Readonly<{ kind: "passwordResetUnavailable"; signInUrl: string }>
  /** Sign-up attempt against an already-registered address. */
  | Readonly<{ kind: "existingAccountNotice"; signInUrl: string }>
  | Readonly<{
      kind: "workspaceInvitation";
      workspaceName: string;
      role: string;
      inviterName: string;
      acceptUrl: string;
      expiresAt: Date;
    }>;

export type MailMessage = Readonly<{
  to: string;
  template: MailTemplate;
  locale: "ja";
}>;

/**
 * Outbound mail. A send failure never fails the calling operation —
 * callers log and continue.
 *
 * Error contract: `SystemError(ExternalServiceError)`.
 */
export interface MailSender {
  send(message: MailMessage): Promise<void>;
}
