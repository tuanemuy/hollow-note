import type { ReactNode } from "react";
import { BrandMark } from "@/components/ui/BrandMark";

/**
 * P-46 見つかりません / エラー。存在の有無・権限の有無を区別しない共通
 * 表示（spec/pages/index.md#P-46）。root の fallback からも使うため
 * ルーターに依存しない（導線は素の `<a>`、再試行は再読み込み）。
 */
type ErrorStateProps = {
  title: string;
  body: string;
  actions: ReactNode;
};

export function ErrorState({ title, body, actions }: ErrorStateProps) {
  return (
    <main className="mx-auto max-w-[520px] px-4 py-16 text-center sm:py-20">
      <span className="mb-6 inline-flex text-ink-tertiary">
        <BrandMark width={72} height={44} strokeWidth={0.9} />
      </span>
      <h1 className="mb-3 text-xl font-medium tracking-tight leading-snug">
        {title}
      </h1>
      <p className="mb-6 text-sm text-ink-secondary">{body}</p>
      <div className="flex flex-wrap justify-center gap-2">{actions}</div>
    </main>
  );
}

const buttonBase =
  "inline-flex h-10 items-center justify-center gap-2 rounded-pill px-5 text-sm font-medium transition-colors";

export function ErrorStateLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
}) {
  const style =
    variant === "primary"
      ? "bg-accent text-bg hover:bg-accent-hover active:bg-accent-pressed"
      : "text-ink-secondary hover:bg-surface hover:text-ink";
  return (
    <a href={href} className={`${buttonBase} ${style}`}>
      {children}
    </a>
  );
}

export function NotFoundState() {
  return (
    <ErrorState
      title="このページは見つかりません"
      body="URL が変わったか、削除された可能性があります。"
      actions={
        <>
          <ErrorStateLink href="/notes">ノート一覧へ</ErrorStateLink>
          <ErrorStateLink href="/" variant="ghost">
            トップへ
          </ErrorStateLink>
        </>
      }
    />
  );
}

export function ServerErrorState() {
  return (
    <ErrorState
      title="うまく読み込めませんでした"
      body="一時的な問題かもしれません。少し待ってからもう一度お試しください。"
      actions={
        <>
          <RetryButton />
          <ErrorStateLink href="/notes" variant="ghost">
            ノート一覧へ
          </ErrorStateLink>
        </>
      }
    />
  );
}

function RetryButton() {
  return (
    // Full reload keeps the retry safe (a fresh GET) regardless of what
    // failed — no mutation is replayed.
    <a
      href=""
      className={`${buttonBase} bg-accent text-bg hover:bg-accent-hover active:bg-accent-pressed`}
    >
      再試行
    </a>
  );
}
