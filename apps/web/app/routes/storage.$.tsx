import { createFileRoute } from "@tanstack/react-router";

/**
 * 公開配信してよい purpose。`ObjectStorage.publicUrl` の契約
 * （`packages/core/src/application/ports/objectStorage.ts`）と
 * `spec/domains/storage.md` の同じ記述が正典で、ここはその適用点。
 *
 * `media` が入るのは、本文に挿した画像・動画が**公開ノートの匿名の
 * 閲覧者にも見える**必要があるため。鍵は推測できないファイル ID を
 * 含み、一覧する経路も無いので、URL を知っていることが読める条件に
 * なる（avatar と同じ扱い）。
 */
const PUBLICLY_SERVED_PURPOSES: readonly string[] = ["avatar", "media"];

/**
 * 保管オブジェクトの配信口。
 *
 * memory の `ObjectStorage.publicUrl` が返す `/storage/{objectKey}` を
 * 実際に読める唯一の経路で、R2 等の公開ドメインへ移った配備ではこの
 * ルート自体が不要になる（`publicUrl` の形はアダプターに閉じている）。
 *
 * splat（`$`）なのは objectKey が `users/{id}/avatar/{fileId}.png` と
 * いう**複数セグメント**だから。単一パラメーターでは受けられない。
 */
export const Route = createFileRoute("/storage/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const [{ getContainer }, { ObjectKey }] = await Promise.all([
          import("@repo/core/application/di/containerStore"),
          import("@repo/core/domain/storage/valueObject"),
        ]);
        const raw = params._splat ?? "";
        // 不正な鍵は「無い」と同じ扱い。形式違反を 400 で区別すると、
        // 鍵の形そのものが探索の手掛かりになる。
        let key: ReturnType<typeof ObjectKey.create>;
        try {
          key = ObjectKey.create(raw);
        } catch {
          return notFound();
        }
        // `publicUrl` is only for objects that really are public. The
        // rest of the key space (note sources, imported references,
        // generated artifacts) shares this store, so the route has to
        // hold that line itself rather than trust that nothing else was
        // ever written.
        const purpose = ObjectKey.purposeOf(key);
        if (purpose === null || !PUBLICLY_SERVED_PURPOSES.includes(purpose)) {
          return notFound();
        }
        const container = await getContainer();
        const object = await container.objectStorage.get(key);
        if (object === null) {
          return notFound();
        }
        return new Response(object.bytes as BodyInit, {
          headers: {
            "Content-Type": object.meta.mimeType,
            "Content-Length": String(object.meta.size),
            "Content-Disposition": `inline; filename="${downloadName(key)}"`,
            // 鍵にファイル ID が入るので中身は不変。差し替えは必ず別の
            // 鍵になるため、長期キャッシュで古い画像が出ることはない。
            // `private` なのは削除の約束（P-25）のためで、共有キャッシュ
            // に載ると退会後もオリジンに無い画像が読めてしまう。
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            // 画像・動画として配信するものだけを置く鍵空間だが、万一
            // HTML を積まれてもオリジン上で実行させない。SVG は
            // `storeMedia` がサニタイズ済みでも、直接開かれたときに
            // script を走らせないのはこのヘッダーの担当。
            "Content-Security-Policy": "sandbox; default-src 'none'",
          },
        });
      },
    },
  },
});

// `ObjectKey` はヘッダーに置けない文字（引用符・制御文字）を禁じて
// いないので、末尾セグメントをそのまま名前にはできない。
const downloadName = (key: string): string => {
  const last = key.slice(key.lastIndexOf("/") + 1);
  const safe = last.replace(/[^A-Za-z0-9._-]/g, "");
  return safe.length === 0 ? "object" : safe;
};

const notFound = (): Response =>
  new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
