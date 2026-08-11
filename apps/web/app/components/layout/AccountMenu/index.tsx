"use client";

import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, useTransition } from "react";
import { SETTINGS_TABS } from "@/components/layout/SettingsTabs";
import { displayError } from "@/presentation/errorDisplay";
import { signOutFn } from "./action";

/** 設定の入口はタブ列の先頭（P-21 プロフィール設定）。 */
const SETTINGS_ENTRY_HREF = SETTINGS_TABS[0].href;

/**
 * L-01 アカウントメニュー（最小形）。項目は設定とサインアウトのみ —
 * プロフィール・処理履歴は対応画面が未実装のため並べない
 * （placeholder 禁止）。
 */
export function AccountMenu({
  displayName,
  avatarUrl = null,
}: {
  displayName: string;
  avatarUrl?: string | null;
}) {
  const signOut = useServerFn(signOutFn);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initials = displayName.trim().slice(0, 2) || "?";

  const onSignOut = () => {
    startTransition(async () => {
      try {
        await signOut({});
        setOpen(false);
        // Full navigation, not a router push: it tears down the router
        // instance and its cached loader data (RSC payloads included), so
        // nothing from the signed-out session can be served to the next
        // user under `staleTime: Infinity`.
        window.location.assign("/");
      } catch (e) {
        setError(displayError(e));
      }
    });
  };

  return (
    <div ref={rootRef} className="relative">
      {/* Disclosure, not an ARIA menu: a menu role promises full
          arrow-key/focus management, which a one-item popover doesn't
          implement — `aria-expanded` alone keeps the contract honest. */}
      <button
        type="button"
        aria-label="アカウントメニュー"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-8 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface hover:text-ink"
      >
        {avatarUrl === null ? (
          <span
            aria-hidden="true"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-linear-135 from-[#c9d3df] to-[#8e99a8] text-[10px] font-medium text-bg"
          >
            {initials}
          </span>
        ) : (
          <img
            src={avatarUrl}
            alt=""
            width={28}
            height={28}
            className="size-7 shrink-0 rounded-full object-cover"
          />
        )}
      </button>
      {open ? (
        <div className="absolute top-full right-0 z-50 mt-2 min-w-44 rounded-lg border border-hairline bg-bg py-2 shadow-sm">
          <div className="truncate px-4 py-1.5 text-xs text-ink-tertiary">
            {displayName}
          </div>
          {/* 通常のリンク（`Link` ではない）: 遷移先の `/settings/profile`
              を作るのはプロフィール設定のスライスで、型付き `to` はその
              ルートが生成された後にしか書けない。 */}
          <a
            href={SETTINGS_ENTRY_HREF}
            className="block px-4 py-2 text-sm text-ink transition-colors hover:bg-surface"
          >
            設定
          </a>
          <button
            type="button"
            disabled={isPending}
            onClick={onSignOut}
            className="block w-full px-4 py-2 text-left text-sm text-ink transition-colors hover:bg-surface disabled:opacity-55"
          >
            {isPending ? "サインアウト中..." : "サインアウト"}
          </button>
          {/* Kept mounted for as long as the panel is open so the region
              exists before the failure arrives. It must stay in the
              accessibility tree too, so only the padding is conditional —
              hiding it while empty would keep the insertion silent. */}
          <p
            className="px-4 text-xs text-error not-empty:py-1.5"
            aria-live="polite"
          >
            {error}
          </p>
        </div>
      ) : null}
    </div>
  );
}
