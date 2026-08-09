import { BusinessRuleError } from "@repo/core/domain/error";

declare const jobIdBrand: unique symbol;

/**
 * Minimal Job vocabulary for the walking-skeleton slice: the
 * `NoteMovePort` contract references `JobId` (`excludingJobId`). The full
 * Job domain arrives with the job slice.
 */
export type JobId = string & { readonly [jobIdBrand]: true };

export const JobId = {
  create: (id: string): JobId => {
    const trimmed = id.trim();
    if (trimmed.length === 0) {
      throw new BusinessRuleError("JOB_INVALID_ID", "Invalid job id");
    }
    return trimmed as JobId;
  },
};
