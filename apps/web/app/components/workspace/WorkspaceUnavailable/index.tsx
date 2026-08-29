import { Alert } from "@/components/ui/Alert";

/**
 * 断片の中で解決する「このワークスペースは開けない」（WS-02）。
 *
 * 断片の中で `throw` すると Flight ストリームを素の Error が渡り、
 * `kind` タグを失ってからルートの境界に届くので、終端表示をここで描く
 * （`NoteDetail` の not-found と同じ理由）。
 */
export function WorkspaceUnavailable() {
  return (
    <Alert tone="error" title="このワークスペースは開けません" role="status">
      削除されたか、メンバーから外れた可能性があります。
      <a
        href="/notes"
        className="ml-1 text-accent underline underline-offset-3"
      >
        個人のノートへ
      </a>
    </Alert>
  );
}
