import { Alert } from "@/components/ui/Alert";
import { ErrorState, ErrorStateLink } from "@/components/ui/ErrorState";

/**
 * WS-02 の「除名された / 削除されたワークスペースを開いた」の終端表示。
 *
 * 文言と行き先は 1 つで、器だけを呼び出し側が選ぶ。ルート境界（loader が
 * 落ちた・シェルが `workspace: null` を受けた）は画面全体を置き換える
 * `ErrorState`、断片は `Alert` を使う。断片の中で `throw` すると Flight
 * ストリームを素の Error が渡り、`kind` タグを失ってからルートの境界に
 * 届くので、断片側は自分で描く（`NoteDetail` の not-found と同じ理由）。
 */
const TITLE = "このワークスペースは開けません";
const CAUSE = "削除されたか、メンバーから外れた可能性があります。";
const PERSONAL_HREF = "/notes";
const PERSONAL_LABEL = "個人のノートへ";

export function WorkspaceUnavailable() {
  return (
    <Alert tone="error" title={TITLE} role="status">
      {CAUSE}
      <a
        href={PERSONAL_HREF}
        className="ml-1 text-accent underline underline-offset-3"
      >
        {PERSONAL_LABEL}
      </a>
    </Alert>
  );
}

export function WorkspaceUnavailableState() {
  return (
    <ErrorState
      title={TITLE}
      body={`${CAUSE}個人の文脈に戻ります。`}
      actions={
        <ErrorStateLink href={PERSONAL_HREF}>{PERSONAL_LABEL}</ErrorStateLink>
      }
    />
  );
}
