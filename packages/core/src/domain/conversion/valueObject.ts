/**
 * Minimal Conversion vocabulary for the walking-skeleton slice: `Note`
 * derives `NoteFailureReason` from `ConversionFailureReason` and
 * `createFromUpload` accepts `InitialContentState`. The full Conversion
 * domain arrives with the import slice.
 *
 * `ConversionFailureReason` is the single vocabulary shared by Note's
 * failed content state and Job's failure records. `integrationRequired`
 * only appears as a Job failure reason — Note bodies represent that state
 * as `awaitingIntegration` instead.
 */
export type ConversionFailureReason =
  | "unsupportedFormat"
  | "corruptedFile"
  | "integrationRequired"
  | "machineExtractionUnavailable"
  | "providerAuthFailed"
  | "modelError"
  | "quotaExceeded"
  | "timeout"
  | "sizeExceeded"
  | "passwordProtected"
  | "unknown";

/**
 * Initial body state handed to `Note.createFromUpload`. Structurally the
 * non-`ready` subset of `NoteContent`, so a `ready` note can never be
 * produced by an upload, and a `failed` state can never lose its reason.
 */
export type InitialContentState =
  | Readonly<{ status: "processing" }>
  | Readonly<{ status: "awaitingIntegration" }>
  | Readonly<{
      status: "failed";
      reason: Extract<
        ConversionFailureReason,
        | "machineExtractionUnavailable"
        | "unsupportedFormat"
        | "passwordProtected"
      >;
    }>;
