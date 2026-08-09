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

/**
 * In-process `MailSender`: keeps every message in memory and logs the
 * action URL, so the dev flow (e.g. the email-verification link) can be
 * completed from the server log without a real mail provider.
 */
export function createMemoryMailSender(logger?: Logger): MemoryMailSender {
  const deliveries: MailMessage[] = [];
  return {
    async send(message: MailMessage): Promise<void> {
      deliveries.push(clone(message));
      logger?.info("mail.sent", {
        to: message.to,
        template: message.template.kind,
        actionUrl: actionUrlOf(message),
      });
    },
    sent(): readonly MailMessage[] {
      return [...deliveries];
    },
  };
}
