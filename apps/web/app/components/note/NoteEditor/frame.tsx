import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";

/** 編集を終えて戻る先。文脈（個人 / ワークスペース）は呼び出し側が決める。 */
export type BackTarget =
  | Readonly<{ kind: "notes" }>
  | Readonly<{ kind: "workspaceNotes"; workspaceId: string }>
  | Readonly<{ kind: "note"; noteId: string }>
  | Readonly<{ kind: "workspaceNote"; noteId: string; workspaceId: string }>;

/**
 * P-12 の枠（モック P12-editor.html の `.bar` / `.page` / `.actionbar`）。
 *
 * クライアント島とサーバー側の終端状態が同じ枠を使うために、素の要素だけで
 * 組んである。`"use client"` を付けないのは、`Link` がどちらの環境でも
 * 描けるためで、島の側からも同じ部品を読める。
 */

export const barClass =
  "sticky top-0 z-60 flex min-h-[var(--bar-height)] flex-wrap items-center gap-2 bg-[var(--bar-bg)] px-4 py-2 backdrop-blur-xl backdrop-saturate-150 sm:px-6";

export const pageClass =
  "mx-auto max-w-[var(--content-max)] px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:pt-10";

const backLinkClass =
  "inline-flex h-8 min-w-0 items-center gap-1 rounded-md px-2 text-sm text-ink-tertiary transition-colors hover:bg-surface hover:text-ink";

export function BackLink({
  target,
  label,
  onNavigate,
}: {
  target: BackTarget;
  label: string;
  onNavigate?: (event: { preventDefault: () => void }) => void;
}) {
  const icon = (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
  const text = <span className="hidden truncate sm:inline">{label}</span>;

  switch (target.kind) {
    case "notes":
      return (
        <Link to="/notes" className={backLinkClass} onClick={onNavigate}>
          {icon}
          {text}
        </Link>
      );
    case "workspaceNotes":
      return (
        <Link
          to="/workspaces/$workspaceId/notes"
          params={{ workspaceId: target.workspaceId }}
          className={backLinkClass}
          onClick={onNavigate}
        >
          {icon}
          {text}
        </Link>
      );
    case "note":
      return (
        <Link
          to="/notes/$noteId"
          params={{ noteId: target.noteId }}
          className={backLinkClass}
          onClick={onNavigate}
        >
          {icon}
          {text}
        </Link>
      );
    case "workspaceNote":
      return (
        <Link
          to="/workspaces/$workspaceId/notes/$noteId"
          params={{
            workspaceId: target.workspaceId,
            noteId: target.noteId,
          }}
          className={backLinkClass}
          onClick={onNavigate}
        >
          {icon}
          {text}
        </Link>
      );
  }
}

export function EditorShell({
  backTo,
  children,
}: {
  backTo: BackTarget;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className={barClass}>
        <BackLink target={backTo} label="ノートへ戻る" />
      </header>
      <main className={pageClass}>{children}</main>
    </div>
  );
}

export function StateNotice({
  tone,
  title,
  body,
}: {
  tone: "warning" | "error";
  title: string;
  body: string;
}) {
  return (
    <Alert tone={tone} title={title} role="status">
      {body}
    </Alert>
  );
}
