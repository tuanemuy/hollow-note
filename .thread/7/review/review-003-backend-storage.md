### backend-storage

対象: `packages/core/src/domain/storage/`、`packages/core/src/application/storage/`、`packages/core/src/application/usage/`、両バックエンドの `storedFileRepository`、`adapters/conformance/storedFileRepository.ts`、`apps/web/app/routes/storage.$.tsx` と配信経路、`spec/domains/storage.md` / `spec/usecases/storage.md` / `spec/testcases/storage/`。

検証は差分の読解に加えて、`npx vitest run --project node`（storage / usage / domain-storage / adapters-html / storage.delivery = 15 files / 312 tests、全 green）を実行し、`HtmlProcessor.process` と `storeMedia` に SVG の攻撃・境界ベクタを通す使い捨てプローブで実挙動を確認した（プローブは削除済み）。

#### Blockers

なし。

前ラウンドの B-001（`</svg>` の後ろに残った内容がそのまま `image/svg+xml` として保管される）は `findSvgRoot` / `asStandaloneSvg` の追加で塞がっている。実測でも `</svg>trailing text` / `</svg><p>…` / 2 つ目の `<svg>` はいずれも `UnsupportedMimeType` になり、属性値中の `</svg>` で誤って切れることもない（`readTagEnd` が引用符を不透明に扱う）。`<style>` / `foreignObject` / `image` / `set` / 外向き `href` は allow-list 側で落ち、配信は `nosniff` + `Content-Security-Policy: sandbox; default-src 'none'` を必ず付ける。サニタイズを迂回して保管・配信される経路は見つからなかった。残った穴は W-001 の 1 件で、影響が「自分のアップロードした画像が描かれない」に留まるため Blocker には置かない。

#### Warnings

**[W-001]** 「ルートの外は空白だけ」の判定に JS の `trim()` を使っているため、XML が空白と認めない文字が `</svg>` の後ろに残ったまま保管される（B-001 の残り）

- 場所: `packages/core/src/application/storage/storeMedia.ts:findSvgRoot`（`text.trim().length > 0`）
- `spec/usecases/storage.md#storeMedia` 手順 4 は「ルートの外に空白以外が残らないこと」を条件に置くが、XML の S は `#x20 #x9 #xD #xA` の 4 文字だけで、JS の `trim()` はこれに加えて U+00A0 / U+1680 / U+2000–U+200A / U+2028 / U+2029 / U+202F / U+205F / U+3000 / U+FEFF を落とす。パーサー出力で `&nbsp;` に逃げるのは U+00A0 だけなので、残りはそのまま素通りする。
- 実測（`storeMedia` を通した結果）:

  | 入力（`</svg>` の後ろ） | 結果 |
  | --- | --- |
  | U+FEFF | **保管された** `<svg …><rect></rect></svg>﻿` |
  | U+2003 EM SPACE | **保管された** |
  | U+2028 LINE SEPARATOR | **保管された** |
  | U+00A0 | 拒否（`&nbsp;` に直列化されるため） |

- XML はルート要素の後ろの Misc に S・コメント・PI しか許さないので、上の 3 例はいずれも致命的エラーになり、`image/svg+xml` として 1 ドットも描かれない。塞いだはずの症状がそのまま残っている。
- 修正: `text.trim()` ではなく XML の S だけを見る（`/^[\t\n\r ]*$/.test(text)`）。TC-storage-256 の `TRAILING_SVG` に BOM ケースを 1 行足せば回帰も押さえられる。

**[W-002]** 孤児掃引の CPU 上限の根拠が「版も参照元に数える」変更に追随しておらず、重いページを持つ scope は回収が永久に進まなくなりうる

- 場所: `packages/core/src/application/storage/collectOrphanMedia.ts:ORPHAN_MEDIA_BATCH_SIZE` の JSDoc / `readNoteReferences` / `sweepOnce` の catch、`spec/usecases/storage.md#collectorphanmedia` の入力 DTO
- `ORPHAN_MEDIA_BATCH_SIZE` の JSDoc は「one body parse per candidate」、spec の入力 DTO は「1 件ごとの本文検査に使う Alarm turn の CPU 時間を有界にする値」と書いている。実装はノート 1 件につき現在の本文＋`NoteRevision.RETENTION` 件の版を解析するので、**1 ページが 100 ノートに散った場合の 1 turn の解析回数は最大 2,100 本文**（`NoteHtml` は 800,000 バイトまで）。`readNoteReferences` の「1 ページは 1 つのノートの画像であることが普通」という前提はノート単位のメモ化の根拠にはなるが、上限の根拠にはならない（走査順は `createdAt` なので、複数ノートを並行して編集している scope ではページは素直に散る）。
- そのうえで `sweepOnce` が投げると `collectOrphanMedia` の catch が `armDailySweep` を呼び、**カーソルを捨てて翌日また先頭から読み直す**。処理し切れないページが先頭付近にある scope では、毎日同じページで落ちて後ろの孤児に永久に到達しない。`spec/platform/index.md`「実行予算と分割単位」の 100 files はイベント生成量が根拠で、この CPU を見ていない。
- 修正の方向: 1 turn で読むノート数（または解析する総バイト数）にも上限を置いて、そこで打ち切ったときも**カーソルを進めて**継続を張る。少なくとも JSDoc と spec の「1 件につき 1 回」は現状に合わせる必要がある。

**[W-003]** `media` を公開 purpose に加えたことで最大 200 MB の動画がこのルートから配られるようになったが、配信は Range 非対応で毎回オブジェクト全体をメモリに載せる

- 場所: `apps/web/app/routes/storage.$.tsx:GET`
- `Accept-Ranges` を返さず、`Range` ヘッダーも見ず、常に 200 で `object.bytes` を丸ごと返す。`MEDIA_VIDEO_MAX_BYTES` は 200 MB で、AC-6 は HTML / WYSIWYG モードで動画を挿入できることを要求している。
- 帰結は 2 つ。(1) iOS / Safari の `<video>` は byte-range 応答を前提にするので再生が始まらない。他のブラウザでもシークができない。(2) 1 リクエストにつき 200 MB がプロセスに載る。参照ランタイムは in-memory なので実体は既にメモリにあるが、レスポンス側でもう 1 本持つ形は変わらない。
- `spec/domains/storage.md` の `publicUrl` 節はこのルートに `nosniff` / CSP を課すところまでは書いているが、Range については何も決めていない。決めるか、`spec/manual-tests/editing.md` の動画手順に「再生は範囲外」と明示するか、どちらかは要る。

**[W-004]** `ALLOWED_SVG_ATTRIBUTES` の `"xmlns"` は到達不能で、利用者に見せる除去一覧に `:xmlns` という壊れた属性名が出る

- 場所: `packages/core/src/adapters/html/allowList.ts:ALLOWED_SVG_ATTRIBUTES`、`packages/core/src/adapters/html/htmlProcessor.ts:attributeName`
- parse5 は foreign content の `xmlns` を `{ prefix: "", name: "xmlns" }` として持つ。`attributeName` は `prefix === undefined` でしか prefix なしと判定しないので、この属性の名前は `":xmlns"` になり、`ALLOWED_SVG_ATTRIBUTES.has("xmlns")` に当たらない。実測:

  ```
  process('<p><svg xmlns="…" xmlns:xlink="…"><use xlink:href="#a"/></svg></p>').removed
  → [{ kind: "attribute", name: ":xmlns", … }, { kind: "attribute", name: "xmlns:xlink", … }]
  ```

- 帰結は 2 つ。(1) 許可リストが「許可している」と書いている属性が実際には必ず落ちる（`asStandaloneSvg` の `XMLNS_DECLARATION.test(root.openTag)` 分岐も常に false 側で、この矛盾に乗って動いている）。(2) AC-3 の「除去された要素・属性の一覧表示」に `:xmlns` という存在しない属性名が出る。インライン `<svg>` を含む本文を保存するたびに出る。
- どちらに倒すかは決めが要る。`asStandaloneSvg` の JSDoc は「`HtmlProcessor` は `xmlns*` をすべて落とす、そしてそれが正しい」と書いているので、意図どおりなら `ALLOWED_SVG_ATTRIBUTES` から `"xmlns"` を消し、報告名が `:xmlns` にならないよう `attributeName` を直す（空 prefix を prefix なしとして扱う、あるいは `xmlns` 系だけ別の理由で報告する）。

**[W-005]** ゴミ箱のノートへのメディアのアップロードが通り、本文には入れられないまま容量だけ消費する

- 場所: `packages/core/src/application/storage/storeMedia.ts:resolveEditableNote`
- `resolveEditableNote` は route の `purging` / tombstone は弾くが `lifecycle` を見ない。`noteAccessPolicy.evaluate` は本人所有の trashed ノートに `canEdit: true` を返す（trash の壁は所有者以外の経路にしかない）ので、`storeMedia` は成功して `StoredFile` を 1 行足す。
- 一方、本文側は `application/note/editing.ts:ensureNotTrashed` が `BusinessRuleError(NoteIsTrashed)` を返す。したがって保管したメディアはそのノートの本文へ入れる手段がなく、`ensureUploadAllowed` を通った分の容量を占めたまま 30 日後の孤児回収（またはノートの完全削除）まで残る。編集フローの前半と後半で lifecycle の扱いが割れている。
- `spec/usecases/storage.md#storeMedia` 手順 1 も `canEdit` としか書いていないので、実装だけでなく仕様側の穴でもある。

**[W-006]** ドキュメントの取り残し 2 件（本 PR が同じ節を書き換えているのに未追随）

- `spec/usecases/storage.md#collectorphanmedia` の入力 DTO — `limit` の根拠が「1 件ごとの本文検査に使う Alarm turn の CPU 時間を有界にする値」のまま。同じ節の手順 2 が版の本文も読むよう改訂されたので、この根拠だけが古い（W-002 と同根）。
- 同節のエラーケース表 — 「turn 全体が失敗したときは記録して翌日の掃引を張り直し、`collectedCount: 0` / `nextCursor: null` で正常終了する」が無い。テストケース表（`spec/testcases/storage/collectOrphanMedia.md`、TC-storage-258）と実装にはある挙動で、しかも戻り値の契約（位置を捨てる）に効くので、ユースケースの正典側に無いのは齟齬になる。表の「個々の失敗 | 記録して継続」は 1 ファイル単位の話で、これを兼ねていない。

**[W-007]** キーセット走査の順序に index が対応していない（低優先）

- 場所: `packages/core/src/adapters/cloudflare/do/schema.ts:stored_files_purpose_created_idx`
- index は `(purpose, created_at)` だが、`listByPurposeOlderThan` の契約順序は `created_at, id` で、継続条件も `(created_at > ? OR (created_at = ? AND id > ?))` と `id` を使う。同時刻の行が多い scope（移行での一括投入、conformance が置いている「同一 instant の 3 件」の実運用版）では tie-break を index が賄えず、SQLite は ORDER BY の右半分を一時 B-tree に落とす。`spec/usecases/storage.md` 手順 1 の「（`stored_files_purpose_created_idx` に対応）」という記述とも食い違う。`(purpose, created_at, id)` にすれば契約と一致する。

#### テスト保証

担保できているもの:

- **`storeMedia`（20 ケース）** — 受理表の 7 形式それぞれをバイト列から判定すること、SVG の境界（128 KB ちょうど＝ TC-storage-253 が今回入った、サニタイズで伸びる入力、`</svg>` の後ろに内容が残る 3 形、属性値中の `</svg>`）、サニタイズ後のバイト長で上限と行と容量が揃うこと、容量・権限・`purging` route・移動窓（実際の `moveNote` を `resolveNote` の中で走らせる）、transaction 失敗時のオブジェクト巻き戻し。**アサートの対象が view ではなく `objectStorage.get` で読み戻した実バイト列**なので、保管された実体そのものを押さえている。
- **`collectOrphanMedia`（20 ケース）** — 30 日境界の包含・除外、参照あり／なし、**版の本文を参照元に数える**（TC-storage-257）、所属ノート不在・本文不読、別ノートの参照では助からないこと、`limit`、初回流入での自己登録（保管・移動の両方）と 2 回目に `dueAt` を押し出さないこと、満ページでの継続と走査し切りでの日次復帰、そして `runDueScopeTasks` 経由で 2 turn 回して**カーソルの先の孤児に到達する**こと（TC-storage-254）。payload 不読（TC-storage-255）と turn 全体の失敗（TC-storage-258）も入っている。干渉は `docs/test.md` どおり UoW / `htmlProcessor` の薄いラッパーで、実装側に分岐は足していない。
- **`deleteFilesForNote`（12 ケース）** — 対象 purpose の切り分け、250 件のページング（同一 `deletionOperationId` の持ち回りと `(kind, operationId)` の 1 行維持）、`running` の障壁・**`completed` の障壁**・不一致 token の 3 分岐、冪等、列挙と削除のあいだで行が消える窓。
- **ポート契約 → conformance → 両実装** — ADP-storage-007 / 010 が `adapters/conformance/storedFileRepository.ts` に入り、memory と cloudflare の両 `conformanceBackend.ts` が同じスイートを回す。カーソルが**厳密に**先へ進むこと（同時刻の同僚が戻ってこない）と、**カーソルを採った行を消しても位置が解決する**ことの 2 つを直接押さえていて、port JSDoc / `spec/domains/storage.md` / `spec/inventory/adapter.md` の記述と一致している。`PERSISTENCE_SUITES` も 43 → 45 に更新済み。
- **配信** — 公開 purpose の集合を `FILE_PURPOSES` の補集合と突き合わせて「載せていない purpose は 404」を走査で押さえるので、purpose を増やしたスライスがこのテストを編集せずに落とせる。`nosniff` と CSP も実アサート。

担保できていないもの:

- **保管した SVG が実際に XML として開けること**を検査するテストが無い。`findSvgRoot` の判定は文字列形状の検査で、その形状が XML の Misc 規則と一致しているかは誰も見ていない。W-001 はここを素通りしている。
- **孤児掃引の 1 turn のコストが有界であること**を押さえるテストが無い。TC-storage-254 の 100 件はすべて同じノートの画像なので、`readNoteReferences` のメモ化が効く一番軽いケースだけを通している（W-002 の最悪ケースは未検査）。
- 配信ルートの `downloadName`（ヘッダーに置けない文字の除去）と、`Content-Length` / `Content-Disposition` の値に対するテストが無い。
- 新設のドメインサービス `domain/storage/services/storageUrlPolicy.ts` に直接の単体テストが無く、note 側の `hasImportableReference` 経由でしか通っていない。`appUrl` / `deliveryBaseUrl` の組み合わせ（アプリ相対の配信パス／公開ドメイン、解決できない URL）は契約表に 2 行あるのに、そこを直接突いたケースが無い。

#### カバレッジ

確認したファイル:

- `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
- `packages/core/src/domain/storage/services/storageUrlPolicy.ts`
- `packages/core/src/domain/storage/ports/storedFileRepository.ts`
- `packages/core/src/domain/storage/valueObject.ts`（差分外・判断のため）
- `packages/core/src/domain/storage/__tests__/storage.test.ts`
- `packages/core/src/application/storage/storeMedia.ts`
- `packages/core/src/application/storage/collectOrphanMedia.ts`
- `packages/core/src/application/storage/deleteFilesForNote.ts`
- `packages/core/src/application/storage/relocateFilesForNote.ts`
- `packages/core/src/application/storage/deleteFiles.ts`（差分外・判断のため）
- `packages/core/src/application/storage/view.ts`
- `packages/core/src/application/storage/__tests__/storeMedia.test.ts`
- `packages/core/src/application/storage/__tests__/collectOrphanMedia.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFilesForNote.test.ts`
- `packages/core/src/application/storage/__tests__/relocateFilesForNote.test.ts`
- `packages/core/src/application/storage/__tests__/deleteFiles.test.ts`
- `packages/core/src/application/usage/ensureUploadAllowed.ts`
- `packages/core/src/application/usage/__tests__/ensureUploadAllowed.test.ts`
- `packages/core/src/application/ports/objectStorage.ts`
- `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`（差分外・判断のため）
- `packages/core/src/application/cleanup/notePurgeFanOut.ts`
- `packages/core/src/application/workers/subscribers.ts`
- `packages/core/src/application/workers/scopeTaskRunner.ts`
- `packages/core/src/application/di/types.ts`
- `packages/core/src/adapters/memory/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/memory/store.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/cloudflare/do/schema.ts`
- `packages/core/src/adapters/cloudflare/__tests__/ports/scopeBusiness.ts`
- `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/runtimeComposition.test.ts`
- `packages/core/src/adapters/conformance/storedFileRepository.ts`
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `packages/core/src/adapters/html/htmlProcessor.ts`
- `packages/core/src/adapters/html/allowList.ts`
- `packages/core/src/adapters/html/css.ts`
- `apps/web/app/routes/storage.$.tsx`
- `apps/web/app/routes/__tests__/storage.delivery.test.ts`
- `spec/domains/storage.md`
- `spec/usecases/storage.md`
- `spec/testcases/storage/storeMedia.md`
- `spec/testcases/storage/collectOrphanMedia.md`
- `spec/testcases/storage/deleteFilesForNote.md`
- `spec/adr/013-html-sanitization-policy.md`
- `spec/platform/index.md`（「実行予算と分割単位」）
- `spec/inventory/adapter.md`（ADP-storage 行）
- `spec/inventory/test.md`（TC-storage 行）

スキップしたファイル（担当外。note / tag / integration / frontend / 共通基盤の担当が見る分）:

- `apps/web/app/components/**`、`apps/web/app/routes/notes/**`、`apps/web/app/routes/workspaces/**`、`apps/web/app/routeTree.gen.ts`、`apps/web/app/presentation/**`
- `packages/core/src/application/note/**`、`packages/core/src/application/tag/**`、`packages/core/src/application/integration/**`、`packages/core/src/application/identity/**`、`packages/core/src/application/cleanup/participants.ts`、`packages/core/src/application/execution/unitOfWork.ts`、`packages/core/src/application/di/{memoryRuntime,cloudflareRuntime}.ts`
- `packages/core/src/domain/note/**`、`packages/core/src/domain/tag/**`、`packages/core/src/domain/integration/**`
- `packages/core/src/adapters/{memory,cloudflare}/repositories/{noteRepository,tagAssignmentRepository,backupRecordRepository}.ts`、`packages/core/src/adapters/conformance/{noteRepository,noteRouteStore,tagAssignmentRepository,backupRecordRepository,backend.ts}`、`packages/core/src/adapters/memory/scopeUnitOfWork.ts`
- `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts`（SVG 節は W-001 / W-004 の根拠として実挙動をプローブで確認したが、ファイル自体の差分レビューは note 担当へ）
- `spec/domains/{note,tag,integration}.md`、`spec/usecases/{note,tag,integration}.md`、`spec/testcases/{note,tag,integration}/**`、`spec/pages/index.md`、`spec/presentation/index.md`、`spec/manual-tests/editing.md`、`spec/inventory/usecase.md`
- `packages/core/package.json`、`pnpm-lock.yaml`
