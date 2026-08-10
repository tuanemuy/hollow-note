import type {
  DomainEventBase,
  EventDraft,
} from "@repo/core/domain/common/event";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { BillingPeriod, QuotaSubject } from "./valueObject";

/**
 * Consumption itself emits nothing — this domain is a subscriber of the
 * Storage / Note events. Only reaching a limit is announced.
 *
 * Both are published by `applyStorageDelta` / `consumeLlmCall`, which
 * belong to the import slice; until then these types exist so the
 * contract is fixed in one place rather than invented twice.
 */
export type StorageExceededEvent = DomainEventBase<
  "usage.storageExceeded",
  Readonly<{
    subject: QuotaSubject;
    consumedBytes: number;
    limitBytes: number;
  }>
>;

export type LlmExceededEvent = DomainEventBase<
  "usage.llmExceeded",
  Readonly<{
    userId: UserId;
    period: BillingPeriod;
    consumedCalls: number;
    limitCalls: number;
  }>
>;

export type UsageEvent = StorageExceededEvent | LlmExceededEvent;

const subjectAggregateId = (subject: QuotaSubject): string =>
  subject.type === "user"
    ? `user:${subject.userId}`
    : `workspace:${subject.workspaceId}`;

export const UsageEvents = {
  storageExceeded: (
    params: Readonly<{
      subject: QuotaSubject;
      consumedBytes: number;
      limitBytes: number;
    }>,
    occurredAt: Date,
  ): EventDraft<StorageExceededEvent> => ({
    type: "usage.storageExceeded",
    payload: params,
    occurredAt,
    aggregateId: subjectAggregateId(params.subject),
  }),

  llmExceeded: (
    params: Readonly<{
      userId: UserId;
      period: BillingPeriod;
      consumedCalls: number;
      limitCalls: number;
    }>,
    occurredAt: Date,
  ): EventDraft<LlmExceededEvent> => ({
    type: "usage.llmExceeded",
    payload: params,
    occurredAt,
    aggregateId: params.userId,
  }),
};
