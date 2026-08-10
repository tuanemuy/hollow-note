import type { ReactNode } from "react";
import { PublicShell } from "@/components/layout/PublicShell";

/**
 * P-47 利用規約 / プライバシーポリシーの共通枠（L-02 公開レイアウト、
 * モック P47-terms.html）。本文は GitHub 構造 × Apple Calm の既定
 * ドキュメントスタイル。
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <PublicShell>
      <main className="mx-auto max-w-[var(--content-max)] px-4 pt-10 pb-16 sm:px-6">
        <h1 className="text-3xl font-light tracking-tightest leading-tight">
          {title}
        </h1>
        <p className="mt-2 mb-10 text-sm text-ink-tertiary">{updated}</p>
        <article className="legal-doc text-base leading-relaxed [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tighter [&_h2]:leading-snug [&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:mb-5 [&_ul]:mb-5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-2">
          {children}
        </article>
      </main>
    </PublicShell>
  );
}
