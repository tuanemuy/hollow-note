import { z } from "zod";
import { SCOPE_TASK_LEASE_MS } from "../ports/scopeTaskScheduler";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
} from "../workers/eventRelayWorker";
import { DEFAULT_OUTBOX_RETENTION_MS } from "../workers/outboxPrune";

/** Worker-tuning env variables shared by both runtimes. */
export type TuningEnv = Readonly<{
  OUTBOX_BATCH_SIZE?: string | undefined;
  OUTBOX_LEASE_MS?: string | undefined;
  OUTBOX_MAX_ATTEMPTS?: string | undefined;
  OUTBOX_RETENTION_MS?: string | undefined;
  SCOPE_TASK_LEASE_MS?: string | undefined;
}>;

/**
 * Both tuning schemas name their lease field `leaseMs`, so zod's issue
 * path alone cannot tell an operator which environment variable a boot
 * refusal came from. The message carries the variable name instead.
 */
const leaseMsField = (variable: string, fallback: number) => {
  const error = `${variable} must be a positive integer (ms)`;
  return z.coerce.number(error).int(error).positive(error).default(fallback);
};

const relayTuningSchema = z.object({
  batchSize: z.coerce.number().int().positive().default(DEFAULT_BATCH_SIZE),
  leaseMs: leaseMsField("OUTBOX_LEASE_MS", DEFAULT_LEASE_MS),
  maxAttempts: z.coerce.number().int().min(1).default(DEFAULT_MAX_ATTEMPTS),
});

const pruneTuningSchema = z.object({
  retentionMs: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_OUTBOX_RETENTION_MS),
});

const scopeTaskTuningSchema = z.object({
  leaseMs: leaseMsField("SCOPE_TASK_LEASE_MS", SCOPE_TASK_LEASE_MS),
});

export type RelayTuning = z.infer<typeof relayTuningSchema>;
export type PruneTuning = z.infer<typeof pruneTuningSchema>;
export type ScopeTaskTuning = z.infer<typeof scopeTaskTuningSchema>;

export function readRelayTuning(env: TuningEnv): RelayTuning {
  return relayTuningSchema.parse({
    batchSize: env.OUTBOX_BATCH_SIZE,
    leaseMs: env.OUTBOX_LEASE_MS,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
  });
}

export function readPruneTuning(env: TuningEnv): PruneTuning {
  return pruneTuningSchema.parse({
    retentionMs: env.OUTBOX_RETENTION_MS,
  });
}

export function readScopeTaskTuning(env: TuningEnv): ScopeTaskTuning {
  return scopeTaskTuningSchema.parse({
    leaseMs: env.SCOPE_TASK_LEASE_MS,
  });
}
