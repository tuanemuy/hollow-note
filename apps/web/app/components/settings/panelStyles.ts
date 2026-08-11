// 設定画面（P-20 タブ配下）で共有するクラス recipe。値はすべて
// `styles/tokens.css` のトークン経由で、モック P21/P22/P24/P25 の
// `.panel` / `.btn` に対応する。

export const panelClass = "mb-6 rounded-lg border border-hairline p-5";

export const panelTitleClass = "mb-2 text-md font-semibold tracking-tight";

export const panelNoteClass = "mb-5 text-sm text-ink-secondary";

const buttonBase =
  "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-pill text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55";

export const primaryButtonClass = `${buttonBase} h-10 bg-accent px-4 text-bg hover:bg-accent-hover active:bg-accent-pressed disabled:hover:bg-accent`;

export const subtleButtonClass = `${buttonBase} h-8 bg-surface px-3 text-ink hover:bg-surface-hover`;

export const ghostButtonClass = `${buttonBase} h-8 border border-hairline px-3 text-ink-secondary hover:bg-surface hover:text-ink disabled:hover:bg-transparent`;

export const dangerButtonClass = `${buttonBase} h-8 border border-error/30 px-3 text-error hover:bg-error-surface disabled:hover:bg-transparent`;

// 常設の live region。空のときに消すと、後から入るテキストが読み上げ
// られないため、余白だけを条件付きにする。
export const errorTextClass = "text-xs text-error not-empty:mt-2";
