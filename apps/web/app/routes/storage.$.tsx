import { createFileRoute } from "@tanstack/react-router";

/**
 * 保管オブジェクトの配信口（ADR-011 / ADR-016）。
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
        // `publicUrl` is only for objects that really are public, and
        // today that is avatars alone. The rest of the key space (note
        // sources, media, generated artifacts) shares this store, so the
        // route has to hold that line itself rather than trust that
        // nothing else was ever written.
        if (ObjectKey.purposeOf(key) !== "avatar") {
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
            // 鍵にファイル ID が入るので中身は不変。差し替えは必ず別の
            // 鍵になるため、長期キャッシュで古い画像が出ることはない。
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            // 画像として配信するものだけを置く鍵空間だが、万一 HTML を
            // 積まれてもオリジン上で実行させない。
            "Content-Security-Policy": "sandbox; default-src 'none'",
          },
        });
      },
    },
  },
});

const notFound = (): Response =>
  new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
