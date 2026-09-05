# レビュー 006 — backend-storage

### backend-storage

#### Blockers

##### [B-001] `packages/core/src/domain/storage/services/uploadValidationPolicy.ts:258-303` / `:438-444`（`HTML_BREAKOUT_ELEMENTS` / `breaksOutOfForeignContent`） — breakout tag の拒否では foster parenting は塞がっていない。受理される 128 KB の SVG が 1 リクエストで 204 ms / 186 MB を消費する

`MEDIA_SVG_MAX_BYTES` の JSDoc（:43-48）、`spec/domains/storage.md:201`、`spec/usecases/storage.md:149` はいずれも同じ主張を置いている。

> この機構の入口は 2 つしかなく、どちらも名前で塞げる。… **HTML integration point**（`desc` / `title` / `foreignObject`）は HTML の解析を再開させるが、そこから table 系の挿入モードへ入るにも `table` の開始タグが要り、それ自体が breakout tag である。

**この前提が誤っている。** HTML 仕様の "in template" 挿入モードは、`table` の開始タグを介さずに table 系の挿入モードへ入る:

- `caption` / `colgroup` / `tbody` / `tfoot` / `thead` → "in table" へ切り替えて再処理
- `tr` → "in table body"
- `td` / `th` → "in row"

そして `template`・`tr`・`tbody`・`td`・`th`・`caption`・`colgroup`・`tfoot`・`thead` は **1 つも `HTML_BREAKOUT_ELEMENTS` に入っていない**（列挙自体は parse5 の `EXITS_FOREIGN_CONTENT`（`node_modules/.pnpm/parse5@8.0.1/.../common/foreign-content.js:123`）と 44 件・`font` の条件まで完全に一致していることを確認した。誤っているのは**集合の中身ではなく、集合が十分だという推論**）。

実測（`parse5` と `createHtmlProcessor()` を直接呼んで確認）:

```
<svg><desc><template><tr><font a="0">…<font a="58"> <tr>X</tr>×12,970 </font>…</template></desc></svg>
```

| 経路 | `ensureAcceptable` | 入力 | parse tree（直列化） | `process()` | heap |
| --- | --- | --- | --- | --- | --- |
| `<svg><table><b …>`（JSDoc が塞いだ既知経路） | **拒否** | 121 KB | 17.7 MB (146×) | — | — |
| `<svg><desc><template><tr><font …>` | **受理** | 130,924 B | 21.9 MB (180×) | 204 ms | **186 MB** |
| `<svg><title><template><tbody><font …>` | **受理** | 121 KB | 14.2 MB | — | — |
| `<svg><foreignObject><template><tr><font …>` | **受理** | 121 KB | 14.2 MB | — | — |

`desc` / `title` / `foreignObject` の 3 つの integration point すべてで再現する。入力は完全に整形式・深さ 64 以内・128 KB 以内で、`UploadValidationPolicy.ensureAcceptable({ purpose: "media", body })` が `image/svg+xml` として受理する。倍率は JSDoc が塞いだつもりの経路（86×）より**大きい**。

影響:

- **DoS**: 認証済み利用者が編集可能なノート 1 つを持てば、1 リクエストあたり 200 ms の CPU と 186 MB の heap を任意回数消費できる。最終実行環境（Cloudflare Workers / scope DO、`spec/platform/index.md`）の isolate メモリ上限 128 MB を単発で超える。
- **`storeMedia` の設計根拠が崩れる**: `storeMedia.ts:276-282` は「サニタイズを容量の門より前に置いてよいのは、intake が SVG を 128 KB と**その形**で縛るためサニタイズの費用が有界だから」と書いている（`spec/usecases/storage.md` 手順 4 も同文）。有界ではないので、**容量を使い切った利用者でもこのコストを課せる**。
- 出力は 800,000 バイトの `NoteHtml` 不変条件に触れて `NOTE_CONTENT_TOO_LARGE`（Storage の語彙ではない失敗）になるか、サニタイズで全部落ちて 24 バイトになるかのどちらかで、いずれにせよ「Storage の語彙で `FileTooLarge` にする」という約束も守られていない。

修正の方向（**名前の追加だけで済ませないこと**）: `template` 系を集合に足すのは今回の経路を塞ぐだけで、同じ推論の穴（「この名前を拒めば HTML の挿入モードには入れない」）を残す。列挙は HTML の挿入モード全体を相手にしており、名前の網羅で証明する形になっていない。少なくとも次のどちらかを併せて置くべき:

1. `HtmlProcessor` 側に**費用そのものの上限**（parse 後のノード数 / 直列化長のガード）を持たせ、超えたら `kind` を持つエラーで落とす。適用点が 1 つなので `updateNoteBody` 経路も同時に守れる。
2. 受理判定を「breakout tag を拒む」から「**SVG の許可要素以外を拒む**」へ寄せる（`ALLOWED_SVG_ELEMENTS` の部分集合しか通さない）。JSDoc :53-56 が「拒んで失う描画は無い」と言っている論拠がそのまま使え、名前の網羅に依存しなくなる。

あわせて、テストを**規則ではなく不変条件**で書き直すこと（下記「テスト保証」参照）。`spec/domains/storage.md:199-203`、`spec/usecases/storage.md:149`、`uploadValidationPolicy.ts:43-56` の記述も同時に直す必要がある — 現状の 3 か所は事実と異なる保証を canon として置いている。

（参考・担当外の観察: 同じ構成は `HtmlProcessor.process` を素通しする本文編集経路（`updateNoteBody`、`NoteHtml` は 800,000 バイトまで）にも届き、そちらは 600 KB 入力で **7.7 秒 / 1.1 GB** を実測した。B-001 の修正を 1 に寄せると両方が同時に閉じる。）

#### Warnings

##### [W-001] `spec/inventory/test.md:2608-2610` — TC-storage-269 / 270 / 271 が存在しない行を由来として指している

3 行とも `spec/testcases/storage/storeMedia.md#テストケース-storemedia` を由来に挙げているが、`spec/testcases/storage/storeMedia.md`（32 行）に対応する行が無い。同ラウンドで足された TC-storage-251〜268 は全て同ファイルに行があるので、今回だけの取りこぼしである。台帳 → テストケースの往復が切れており、「TC 行が正典」という運用（plan.md AC-1）が該当 3 件について成立しない。`storeMedia.md` に 3 行足すこと。

##### [W-002] `packages/core/src/application/storage/collectOrphanMedia.ts:600-615` — 判定した snapshot を削除 transaction が検証し直さない

3 段への分割で、参照判定は read transaction の snapshot に対して行われ（`sweepOnce` :526-598）、削除は `orphans` ごとに別 transaction（:605-608）になった。scope DO は書き込みを直列化するので、分割前の単一 transaction では「本文に現れないことを確認してから消す」（`spec/testcases/storage/collectOrphanMedia.md` 冒頭）が原子的だったが、現在は read と delete の間に commit した `updateNoteBody` / `restoreNoteRevision` が参照を戻しても止まらない。窓はミリ秒〜秒で、保持中の版を参照元に数える改修（TC-storage-257）が主要ケースを潰しているため実害は小さいが、分割によって**弱くなった**性質であることは記録に値する。安価な塞ぎ方は、scan 時にノートの `version`（または `updatedAt`）を `JudgedCandidate` に載せ、削除 transaction で一致を確認すること。

##### [W-003] `spec/usecases/storage.md:140` — `storeMedia` の入力 DTO の記述が「先頭バイトの署名」のまま

同ラウンドで `spec/domains/storage.md:187` の `ensureAcceptable` 行は「MIME は申告値ではなく**バイト列そのもの**から決め」に改められ、`image/svg+xml`（署名なし・本文全体の走査）・`video/mp4`（ブランド判定）・`video/webm`（DocType 走査）が署名判定でないことが明記された。`storeMedia` の節だけがこれに追随しておらず、`media` が許可する 7 形式のうち 3 形式について事実と異なる。`:81`（`storeUpload`）/ `:177`（`storeAvatar`）は `avatar` の 3 形式が実際に署名判定なので誤りではないが、`:140` は直すこと。

#### テスト保証

- **B-001 を通してしまった理由はテストの形にある。** `packages/core/src/application/storage/__tests__/storeMedia.test.ts:807`（TC-storage-269）と `:826`（TC-storage-270）、`packages/core/src/domain/storage/__tests__/storage.test.ts:369`（TC-storage-269）は、いずれも**規則そのもの**（「この要素名は拒む / この要素名は通る」）を固定している。TC-270 のコメントは「breakout tag が無ければ parser は foreign content から出ないので何も再構成されない」と書いているが、これは `foreignOnlySvg` が作る 1 つの形についてしか真でない。**受理された任意の body に対して `process` の出力と費用が有界である**という、128 KB という数値の根拠そのものを押さえるケースが 1 本も無い。最低でも (a) `<desc><template><tr>` 構成の回帰ケース、(b) 「受理された body に対し `process(...).html.length <= 800000`」を複数の形（table / template / integration point の組み合わせ）で回すテーブル駆動ケースを足すこと。
- 受理判定まわりのそれ以外の担保は厚い。TC-storage-256 / 261 / 262 / 263 / 264 / 265 / 266 / 268 が XML 整形式性・root 外の内容・`&nbsp;` の書き換え・深さの境界（64 / 65）を、いずれも `storeMedia` の end-to-end（オブジェクト・行が残らないことまで）で押さえている。
- 容量判定の移動（focus 2）は TC-storage-271 の 2 本（`storeMedia.test.ts:978` / `:1005`）が「縮む SVG は消費量がサニタイズ後の長さと一致」「膨らむ SVG は残容量で拒まれる」を押さえており、`storeMedia.ts:259` の `storedSize` が上限・quota・`ObjectStorage.put` の宣言サイズの 3 か所で同じ値であること、行に載る `stored.size` が `put` の測り直しであること（port JSDoc `objectStorage.ts:28-33`）まで一貫している。オブジェクトストアへ先にバイトが渡らないことも `:851`（TC-storage-183「before any byte is written」）が `h.backend.objects.size` で押さえている。**この観点は合格。**
- 孤児掃引（focus 3）は 26 ケースあり、keyset の前進（TC-storage-254 の 2 本）、payload 不読（255）、ノート予算での打ち切りと継続位置（259）、turn 全体の失敗で翌日へ張り直し・位置を保持（258 の 2 本）、transaction 外で本文を解析していること（259 の 2 本目）まで含む。`run` の入れ子は無い（scan / delete / reschedule がそれぞれ独立した `run`、`armOrphanMediaSweepOnFirstMedia` は呼び出し側の `ctx` を取る）。取りこぼしについては、`judgedThrough` が「判定し終えた最後の行」であって「ページの最後の行」ではないこと、`createdBefore` が turn ごとに前へしか動かないことから、pass 内で行が飛ばされる経路は見つからなかった。
- conformance は `packages/core/src/adapters/conformance/storedFileRepository.ts` に ADP-storage-007 / 010 が入り、`listDeletableByNote` の purpose 絞り込み・`limit` の切れ目、`listByPurposeOlderThan` の oldest-first・境界の包含・keyset の厳密前進・「行が消えても位置は解決する」・`(created_at, id)` を独立に比べない、まで押さえている。memory / cloudflare 両方が同じスイートを通る形になっており、`spec/database/index.md:476` の `stored_files_purpose_created_idx (purpose, created_at, id)` と `schema.ts` の索引定義も一致している。**片側だけのテストは無い。**
- `apps/web/app/routes/__tests__/storage.delivery.test.ts` は `FILE_PURPOSES` の差分を走査して「載せていない purpose は 404」を押さえる形で、purpose が増えたときにこのファイルを編集せずに落ちる。良い。

#### カバレッジ

**確認したファイル**

- `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
- `packages/core/src/domain/storage/services/storageUrlPolicy.ts`
- `packages/core/src/domain/storage/ports/storedFileRepository.ts`
- `packages/core/src/domain/storage/valueObject.ts`（差分外・`ObjectKey` の検証確認のため）
- `packages/core/src/domain/storage/__tests__/storage.test.ts`
- `packages/core/src/application/storage/storeMedia.ts`
- `packages/core/src/application/storage/collectOrphanMedia.ts`
- `packages/core/src/application/storage/deleteFilesForNote.ts`
- `packages/core/src/application/storage/relocateFilesForNote.ts`
- `packages/core/src/application/storage/deleteFiles.ts`（差分外・共有手続きの確認）
- `packages/core/src/application/storage/view.ts`
- `packages/core/src/application/storage/__tests__/storeMedia.test.ts`
- `packages/core/src/application/storage/__tests__/collectOrphanMedia.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFilesForNote.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFiles.test.ts`
- `packages/core/src/application/storage/__tests__/relocateFilesForNote.test.ts`
- `packages/core/src/application/usage/ensureUploadAllowed.ts`
- `packages/core/src/application/usage/__tests__/ensureUploadAllowed.test.ts`
- `packages/core/src/application/ports/objectStorage.ts`
- `packages/core/src/application/di/memoryRuntime.ts` / `cloudflareRuntime.ts`（`usageReaderFor` が UoW を開かないことの確認）
- `packages/core/src/adapters/memory/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/conformance/storedFileRepository.ts`
- `packages/core/src/adapters/cloudflare/do/schema.ts`（`stored_files` 索引部分）
- `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts`
- `packages/core/src/adapters/memory/store.ts`（`storedFiles` テーブル部分）
- `packages/core/src/adapters/html/htmlProcessor.ts`（B-001 の実測に必要な範囲）
- `apps/web/app/routes/storage.$.tsx`
- `apps/web/app/routes/__tests__/storage.delivery.test.ts`
- `apps/web/app/presentation/errorDisplay.ts`（storage / usage の 3 コードの写像確認）
- `spec/domains/storage.md`
- `spec/usecases/storage.md`
- `spec/testcases/storage/storeMedia.md` / `collectOrphanMedia.md` / `deleteFilesForNote.md`
- `spec/database/index.md`
- `spec/platform/index.md`
- `spec/inventory/test.md`（TC-storage 行）
- `spec/adr/013-html-sanitization-policy.md`（integration point の記述確認）

**スキップしたファイル**（担当外 — note / tag / integration / frontend の各レビュアーの持ち分）

- `apps/web/app/components/**`（`layout/ScopeToken/*`、`note/NoteBody`、`note/NoteDetail/*`、`note/NoteEditor/*`、`note/NoteList/*`、`note/TrashList/*`、`note/schema.ts`、`note/__tests__/schema.test.ts`）
- `apps/web/app/presentation/__tests__/errorDisplay.test.ts` / `errorResponse.test.ts`
- `apps/web/app/routeTree.gen.ts`
- `apps/web/app/routes/notes/**`、`apps/web/app/routes/workspaces/**`
- `packages/core/package.json`、`pnpm-lock.yaml`
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/conformance/scopeBusiness.test.ts`、`conformanceBackend.ts`、`ports/scopeBusiness.ts`、`runtimeComposition.test.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/backupRecordRepository.ts` / `noteRepository.ts` / `tagAssignmentRepository.ts`
- `packages/core/src/adapters/conformance/backend.ts` / `backupRecordRepository.ts` / `noteRepository.ts` / `noteRouteStore.ts` / `tagAssignmentRepository.ts`
- `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts`、`allowList.ts`、`css.ts`（`htmlProcessor.ts` は B-001 の検証に必要な範囲だけ読んだ）
- `packages/core/src/adapters/memory/__tests__/conformance.test.ts` / `conformanceBackend.ts` / `scopeGuards.test.ts`、`repositories/backupRecordRepository.ts` / `noteRepository.ts` / `tagAssignmentRepository.ts`、`scopeUnitOfWork.ts`
- `packages/core/src/application/cleanup/**`、`application/execution/unitOfWork.ts`、`application/identity/**`、`application/integration/**`、`application/note/**`、`application/tag/**`、`application/workers/**`、`application/scope.ts`、`application/ports/noteMovePort.ts` / `noteRouteStore.ts`、`application/di/types.ts`
- `packages/core/src/domain/integration/**`、`domain/note/**`、`domain/tag/**`
- `spec/domains/index.md` / `integration.md` / `note.md` / `tag.md`、`spec/inventory/adapter.md` / `usecase.md`、`spec/manual-tests/editing.md`、`spec/pages/index.md`、`spec/presentation/index.md`、`spec/testcases/integration/**` / `note/**` / `tag/**`、`spec/usecases/integration.md` / `note.md` / `tag.md`

**記述の衛生**: 担当分のコード・`spec/` に `.thread/` への参照は無い（grep 済み）。
