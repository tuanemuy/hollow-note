import type { Logger } from "../../application/ports/logger";
import type {
  MailMessage,
  MailSender,
} from "../../application/ports/mailSender";
import { clone } from "./support";

const actionUrlOf = (message: MailMessage): string | null => {
  switch (message.template.kind) {
    case "emailVerification":
      return message.template.verifyUrl;
    case "passwordReset":
      return message.template.resetUrl;
    case "passwordResetUnavailable":
    case "existingAccountNotice":
      return message.template.signInUrl;
    case "workspaceInvitation":
      return message.template.acceptUrl;
  }
};

export type MemoryMailSender = MailSender &
  Readonly<{
    /** Delivery record, newest last. Read by tests and dev debugging. */
    sent(): readonly MailMessage[];
  }>;

export type MemoryMailSenderOptions = Readonly<{
  /**
   * Defaults to `MEMORY_MAIL_LOG_ACTION_URL === "true"`. Tests pass it
   * explicitly so they never depend on the ambient environment.
   */
  logActionUrl?: boolean;
}>;

/**
 * The action URL carries the raw one-shot token, so logging it hands
 * anyone with log access the ability to consume the verification link
 * and take over the account. It stays opt-in even though this runtime is
 * dev-oriented: `pnpm start` boots the very same wiring.
 */
const logActionUrlByDefault = (): boolean =>
  process.env.MEMORY_MAIL_LOG_ACTION_URL === "true";

/**
 * In-process `MailSender`: keeps every message in memory and — when
 * `MEMORY_MAIL_LOG_ACTION_URL=true` — logs the action URL, so the dev
 * flow (e.g. the email-verification link) can be completed from the
 * server log without a real mail provider.
 */
export function createMemoryMailSender(
  logger?: Logger,
  options?: MemoryMailSenderOptions,
): MemoryMailSender {
  const deliveries: MailMessage[] = [];
  const logActionUrl = options?.logActionUrl ?? logActionUrlByDefault();
  return {
    async send(message: MailMessage): Promise<void> {
      deliveries.push(clone(message));
      logger?.info("mail.sent", {
        to: message.to,
        template: message.template.kind,
        ...(logActionUrl ? { actionUrl: actionUrlOf(message) } : {}),
      });
    },
    sent(): readonly MailMessage[] {
      return [...deliveries];
    },
  };
}
