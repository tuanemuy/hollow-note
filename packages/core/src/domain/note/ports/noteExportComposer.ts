import type { NoteHtml, NoteTitle, StyleMode } from "../valueObject";

/**
 * Builds a single self-contained HTML file (EX-01). References for which
 * `resolveAsset` returns `null` are left as their original URLs.
 *
 * Port definition only in the walking-skeleton slice.
 *
 * Error contract: `SystemError(ExternalServiceError)`.
 */
export interface NoteExportComposer {
  composeSelfContainedHtml(
    params: Readonly<{
      html: NoteHtml;
      title: NoteTitle;
      styleMode: StyleMode;
      resolveAsset: (
        url: string,
      ) => Promise<Readonly<{ bytes: Uint8Array; mimeType: string }> | null>;
    }>,
  ): Promise<string>;
}
