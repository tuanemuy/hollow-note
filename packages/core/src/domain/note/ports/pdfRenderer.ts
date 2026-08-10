import type { NoteHtml, NoteTitle, StyleMode } from "../valueObject";

/**
 * Renders a note body to PDF (EX-01). The default stylesheet is applied
 * only when `styleMode === "default"`. No external resources are fetched
 * — only embedded references are drawn.
 *
 * Port definition only in the walking-skeleton slice.
 *
 * Error contract: `SystemError(TimeoutError)`,
 * `SystemError(ExternalServiceError)`.
 */
export interface PdfRenderer {
  render(
    params: Readonly<{
      html: NoteHtml;
      title: NoteTitle;
      styleMode: StyleMode;
      timeoutMs: number;
    }>,
  ): Promise<Uint8Array>;
}
