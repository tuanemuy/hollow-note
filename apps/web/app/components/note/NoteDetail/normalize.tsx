"use client";

import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * OR-12 / P-11「移動後に旧文脈のアプリ内 URL を開いた場合は、新しい所属先
 * の文脈の URL へ正規化（リダイレクト）する」。
 *
 * サーバー側で redirect を投げないのは、断片の中の throw が Flight を素の
 * Error で渡ってしまい（`InvitationPreview` と同じ制約）、リダイレクトでは
 * なくエラー表示になるためである。所属先の判定は `getNote` を通した後の
 * サーバーコンポーネントが済ませていて、ここは実行するだけ — 閲覧できない
 * ノートの所属先が URL に出ることはない。
 */
export function NoteUrlNormalizer({
  noteId,
  workspaceId,
}: {
  noteId: string;
  workspaceId: string | null;
}) {
  const router = useRouter();
  useEffect(() => {
    const navigation =
      workspaceId === null
        ? router.navigate({
            to: "/notes/$noteId",
            params: { noteId },
            replace: true,
          })
        : router.navigate({
            to: "/workspaces/$workspaceId/notes/$noteId",
            params: { noteId, workspaceId },
            replace: true,
          });
    navigation.catch(() => {
      console.error("Note URL normalization failed");
    });
  }, [router, noteId, workspaceId]);
  return null;
}
