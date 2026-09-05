### backend-note

#### Blockers

- **[B-001]** CSS 宣言フィルターが CSS コメント・識別子エスケープで迂回できる（ADR 013 の 2 規則が両方とも素通りする）
  - 場所: `packages/core/src/adapters/html/css.ts:129-160`（`isRemovedDeclaration` / `declarationProperty` / `pushStatement` / `AT_RULE_NAME`）
  - 実測（本 PR の `createHtmlProcessor()` に対して確認済み。いずれも出力にそのまま残る）:
    - `<p style="position:/**/fixed">x</p>` → `<p style="position:/**/fixed;">x</p>`
    - `<p style="position/**/:fixed">x</p>` → 残る
    - `<style>.a{position:/**/fixed}</style>` → 残る
    - `<p style="position:\66 ixed">x</p>` → 残る
    - `<style>@\69 mport url(evil.css);</style>` → 残る（`AT_RULE_NAME` の `[-\w]+` が `\` にマッチせず `import` と判定されない）
  - 理由: ブラウザは CSS コメントを空白として、`\66 ` / `\69 ` を識別子文字として解決するので、上記はすべて実効的に `position: fixed` と `@import` である。[ADR 013](../../spec/adr/013-html-sanitization-policy.md) がこの 2 規則を置いた理由そのもの（コンテキスト 3「`<style>` 1 個で公開ページ全面を覆うオーバーレイを描ける」／コンテキスト 4「`ExternalFetchPolicy` を通らない外部取得経路」）が塞がっていない。公開ページは正規ドメイン上にあり、ADR が併用を求める CSP は `frame-ancestors` / `form-action` / `object-src` なので、どちらの脅威も CSP では止まらない。しかも `HtmlProcessor` は ADR 013 が定めた**唯一の適用点**なので、`updateNoteBody` / `applyTextNodeEdits` / `storeMedia` / 変換経路の全部が同じ穴を共有する
  - テストが検出しない: `htmlProcessor.test.ts` の TC-note-705〜709 は素の綴りしか通していない（`position:fixed` / `position:sticky` / `position:-webkit-sticky` / `!important`）ので、この迂回はテーブルの外にある
  - 提案: 判定の前に正規化を挟む — 文字列の外側の `/*…*/` を除去し、プロパティ名・値・at-rule 名を読むときに CSS 識別子エスケープ（`\XX ` と `\c`）を解決する。`filterCss` は既に文字列・コメント・括弧を認識する走査を持っているので、`isRemovedDeclaration` / `AT_RULE_NAME` に渡す前に同じ走査で正規化した文字列を作れば足りる。合わせて `sanitizeCases` に上記 5 形を足す（テーブル駆動なので行の追加だけで済む）

#### Warnings

- **[W-001]** `purgeNote` の forward recovery が、ポート契約にもコンフォーマンススイートにも無い `beginPurge` の挙動に全面的に依存している
  - 場所: `packages/core/src/application/note/purgeNote.ts:120-134`（`RESUME_CLAIM = -1`）, `resumeInternal`（同 380 付近）/ `packages/core/src/application/ports/noteRouteStore.ts:20-40, 88-95` / `packages/core/src/adapters/conformance/noteRouteStore.ts:223-264`
  - 理由: `resumeInternal` は「同じ `operationId` の `purging` 行は、世代 CAS より**先に**返る」ことを前提に、ありえない世代 `-1` を渡して route を読み戻す。両バックエンドは実際そう実装されている（memory `noteRouteStore.ts:236-240` / D1 `noteRouteStore.ts:461-468`）が、**ポートの JSDoc はこの順序を一言も書いておらず、conformance の ADP-note-043/044/045 も一致する世代しか渡していない**。CLAUDE.md の「Adding a contractual behaviour means touching both the port JSDoc and the suite」（[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)）に反する。`checkVersion` を先に置いた 3 つ目のバックエンドはコンフォーマンス緑のまま、停止した purge をすべて復旧不能（route は `purging` のまま＝ノートは永久に到達不能）にする。TC-note-352 / 353 / 355 はユースケース層で通っているので、この乖離はアダプターを差し替えるまで見えない
  - 提案: `beginPurge` の JSDoc に「同一 `operationId` の `purging` 行は `expectedRouteVersion` を見ずに冪等に返す」を明記し、`describeNoteRouteStoreContract` に「別の世代を渡した同一 operation の再 claim が成功し、他人の operation は state か世代で拒まれる」ケースを足す。`RESUME_CLAIM` が番兵であることも契約側に書く（`-1` を渡す呼び出しは今後も増えうる）

- **[W-002]** `emptyTrash` の同期削除がすべての例外を握り潰し、全滅を「0 件削除しました」という成功として返す
  - 場所: `packages/core/src/application/note/emptyTrash.ts:161-183`（`purgeEachNote` の `catch (cause) { logger.warn(...) }`）
  - 理由: `spec/usecases/note.md#emptyTrash` のエラー表が飛ばしてよいと定めるのは「版が競合・既に削除済み」の 2 つだけで、本文も `ConflictError` と `NOTE_NOT_TRASHED` を名指ししている。実装は `SystemError(DatabaseError)` も `BusinessRuleError` も同じ扱いにするので、scope が丸ごと落ちている状況で `{ mode: "purged", purgedCount: 0, jobIds: [] }` が返り、画面は「0 件を完全に削除しました」と表示して利用者に何も知らせない。CLAUDE.md の「Avoid broad `try / catch` in ordinary application logic」にも当たる（ここは worker の per-row tolerance ではなく要求経路）
  - 提案: `isConflictError` / `NOTE_NOT_TRASHED` の `ValidationError` / `NotFoundError` だけを飛ばし、それ以外は再送出する。少なくとも「対象が 1 件以上あり、かつ全件が飛ばせない理由で失敗した」ときは投げる。`TC-note-111`（1 件失敗しても続く）は現状 `purgeNote` を落として検証しているので、飛ばせる理由と飛ばせない理由を分けたケースを足す

- **[W-003]** `NoteRepository` の契約変更が canon（`spec/domains/note.md` / `spec/inventory/adapter.md`）に反映されていない
  - 場所: `packages/core/src/domain/note/ports/noteRepository.ts:22-37` / `spec/domains/note.md:407-420` / `spec/inventory/adapter.md:219`
  - 理由: 本 PR は `findNextPurgeDeadline()` を足し、`listPurgeable` に順序（`purgeAfter ASC, id ASC`）を契約として明記した。ところが `spec/domains/note.md` の `interface NoteRepository` は旧いままで、`listByOwner` の順序だけが箇条書きで canon になっている非対称が残る。`spec/inventory/adapter.md` にも新メソッドの ADP 行が無く、conformance のテスト名は `listPurgeable` の ADP-note-013 を流用している（`adapters/conformance/noteRepository.ts:93,116`）。CLAUDE.md は `spec/` を「what is written there is meant to be true of the code」と定める
  - 提案: `spec/domains/note.md` の interface に 1 行、順序の箇条書きに `listPurgeable` の 1 行、`spec/inventory/adapter.md` に ADP-note-0xx を 1 行足し、conformance のテスト名をその ID に付け替える

- **[W-004]** `purgeExpiredTrash` の入力と settle 規則が spec と食い違ったまま
  - 場所: `packages/core/src/application/note/purgeExpiredTrash.ts:33-38, 128-172` / `spec/usecases/note.md#purgeExpiredTrash`
  - 理由: spec の入力 DTO は `limit: number`（既定 100）だけで、実装が必須にしている `scope: ScopeKey` が無い。settle の規則も spec は「残りがあれば直後に再予定し、なければ次の `purgeAfter` へ合わせる」の 2 分岐だが、実装は 3 分岐（進捗ゼロなら `backoffOrSchedule`、ゴミ箱が空なら `complete`）で、これは本スライスが決めた挙動（.thread/7 の ADR-027）なので spec へ書き戻す対象に当たる。ADR-039 が「本スライスが決めたことは spec へ書き戻す」と定めている
  - 提案: 入力 DTO に `scope` を足し、処理フローに「進捗ゼロは backoff」「ゴミ箱が空のときだけ complete」を書く。`trashNote` の処理フローにも「同一 transaction で scope の最小 `purgeAfter` に Alarm を張る」を 1 行入れる（現状この事実は `purgeExpiredTrash` の概要文にしか無い）

- **[W-005]** `HtmlProcessor` の経路契約が `<script>` を落としている
  - 場所: `packages/core/src/domain/note/ports/htmlProcessor.ts:15-25`（`TextNodeEdit` の JSDoc）vs `packages/core/src/adapters/html/htmlProcessor.ts:678-682`（`isPathOpaque`）と `apps/web/app/components/note/NoteEditor/textNodes.ts:18-20`
  - 理由: 契約は「Text nodes inside `<style>` are never assigned a path」としか書かないが、アダプターもクライアントの走査も `<script>` を同じく不透明に扱い、TC-note-011 がそれを検証している。契約どおりに書いた別バックエンドは `<script>` の中身に経路を割り当て、クライアントが送らない編集を受け入れてしまう（`process` を通す保険はあるが、契約と実装が食い違っている事実は残る）。クライアント側の JSDoc が「経路の規約は `HtmlProcessor` のポート契約が正典」と宣言しているぶん、齟齬が効く
  - 提案: JSDoc を `<style>` / `<script>` の両方に広げる（`spec/domains/note.md` の `HtmlProcessor` 節も同様）

- **[W-006]** `emptyTrash` のジョブ経路の列挙が無限ループ形で、上限を持たない
  - 場所: `packages/core/src/application/note/emptyTrash.ts:225-238`（`for (let page = 1; ; page += 1)`）
  - 理由: 直前に `countByOwner` で総数を知っているのに、列挙は「満ページでなくなるまで」だけを終了条件にしている。1 要求の中で `ceil(total/100)` 回の逐次読みを上限なく行うので、巨大なゴミ箱では応答時間が青天井になり、`listByOwner` のページングにバグがあれば要求が返らない。`EMPTY_TRASH_SYNCHRONOUS_LIMIT` の JSDoc が「応答時間を束縛する」と書いている思想とも噛み合わない
  - 提案: 既知の `total` からページ数を導いて回すか、`page` に上限を置いて超過を `SystemError` として報告する

- **[W-007]** 版の保持数 `20` が 4 モジュールに複製されている
  - 場所: `application/note/updateNoteBody.ts:41`, `applyTextNodeEdits.ts:30`, `restoreNoteRevision.ts:32`, `listNoteRevisions.ts:13`（いずれも `const REVISION_RETENTION = 20`）
  - 理由: これは `NoteRevision` の不変条件（`spec/domains/note.md`「最新 20 版」）であり、書き手の prune 上限と読み手の cap が一致していることが仕様である。4 か所に散らすと、片方だけ変えたときに「一覧は 20 件だが実際は 25 件残る」といった静かな乖離が生まれる
  - 提案: `domain/note/noteRevision.ts` に `NoteRevision.RETENTION` として置き、4 か所から import する

- **[W-008]** `allowList.ts` は「ADR 013 の表の転記であって、それ以外ではない」と宣言しているが 2 か所で表と違う
  - 場所: `packages/core/src/adapters/html/allowList.ts:1-9`（宣言）, `:214-215`（`blockquote` / `q` に `datetime` が無い）, `:130`（`math` が `DROP_WITH_CONTENT` にある）
  - 理由: ADR 013 の属性表は `blockquote` / `q` / `del` / `ins` の 4 要素に `cite, datetime` をまとめて与えており、`math` は ADR のどの行にも現れない。どちらの逸脱も妥当な判断だが、「転記であって、それ以外ではない」という宣言と両立しない。許可リストは列挙が正典である以上、コードと ADR がずれた瞬間に正典がどちらか分からなくなる
  - 提案: ADR 013 側を実装に合わせて直す（`blockquote`/`q` から `datetime` を外し、`math` を明示的に許可しない行へ足す）か、コード側を表どおりに戻す。どちらでもよいが、片方に寄せる

- **[W-009]** `listTrashedNotes` が `items` を実行時フィルターで絞りつつ、`count` はリポジトリの数をそのまま返す
  - 場所: `packages/core/src/application/note/listTrashedNotes.ts:74-80`
  - 理由: `listByOwner(owner, "trashed", …)` に対して `items.filter(Note.isTrashed)` を掛けているのは型を絞るためだが、これは「ポートが `trashed` を求められても `Note` しか返さない」という、モデルが不正状態を許しているシグナルである（CLAUDE.md「Make illegal states unrepresentable」）。もしフィルターが 1 件でも落とせば `items.length` と `count` が黙って食い違う
  - 提案: `NoteRepository.listByOwner` を lifecycle でオーバーロードして `"trashed"` のとき `PaginationResult<TrashedNote>` を返す形にする（ポート JSDoc + memory/cloudflare + conformance の 3 点セット）。それが重ければ、少なくともフィルターで落ちた件が 0 であることを型ではなく明示的な不変条件として書く

#### テスト保証

- `サニタイズが許可リスト外の要素・属性・URL・CSS を落として報告する（adapters/html/htmlProcessor.ts:process）` — 守っているテスト: `adapters/html/__tests__/htmlProcessor.test.ts:TC-note-682〜720`（テーブル駆動 38 ケース）
- `CSS コメント・エスケープで綴った position:fixed / @import は落ちない（adapters/html/css.ts:isRemovedDeclaration, pushStatement）` — 守られていない → [B-001]
- `サニタイズ出力が再パースに対して安定で mXSS を作らない（htmlProcessor.ts:sanitizeNode, adopt）` — 守っているテスト: `htmlProcessor.test.ts:「neutralizes a </style> inside fetched CSS…」`（実測でも `noembed` / `noframes` / `xmp` / `plaintext` / svg foster parenting の 5 形が安定・無害であることを確認した）
- `<style> / <script> の中身に経路を割り当てない（htmlProcessor.ts:isPathOpaque）` — 守っているテスト: `htmlProcessor.test.ts:TC-note-011 / TC-note-012`。ただし契約側の記述が `<style>` だけ → [W-005]
- `編集の許可判定を入口と transaction 内で 2 回取り、除名が保存直前に起きた書き込みを止める（application/note/editing.ts:claimNote）` — 守っているテスト: `application/note/__tests__/updateNoteBody.test.ts:TC-note-732`（UoW を包んで `run` 直前に除名を差す窓。入口判定だけの実装は落ちる）
- `拒否順が 権限 → ゴミ箱 → 版 に固定されている（editing.ts:claimNoteForEdit, ensureExpectedVersion）` — 守っているテスト: `updateNoteBody.test.ts:TC-note-726/727/731`, `trashNote.test.ts:TC-note-677/678/681`（既にゴミ箱なら版競合より先に成功で返る）
- `変換・再生成ジョブが本文をロックする（application/note/jobs.ts:bodyLockingJob）` — 守っているテスト: `updateNoteBody.test.ts:TC-note-728/729/730`, `applyTextNodeEdits.test.ts:TC-note-009/010`
- `参照取り込みジョブが重複登録されず、内部 URL だけの本文では登録しない（jobs.ts:requestReferenceImportIfNeeded, hasImportableReference）` — 守っているテスト: `updateNoteBody.test.ts:TC-note-733〜740`, `restoreNoteRevision.test.ts:TC-note-481/483/484`
- `編集結果は必ず process を通ってから保存される（applyTextNodeEdits.ts）` — 守っているテスト: `applyTextNodeEdits.test.ts:TC-note-001/013`, `TC-note-014`（excerpt / headings の再導出）
- `全件 skip の編集は版を消費せず成功する（applyTextNodeEdits.ts）` — 守っているテスト: `applyTextNodeEdits.test.ts:TC-note-005`
- `版の保持は最新 20（updateNoteBody.ts / listNoteRevisions.ts）` — 守っているテスト: `updateNoteBody.test.ts:TC-note-725`, `listNoteRevisions.test.ts:TC-note-221`。定数の複製は → [W-007]
- `restoreNoteRevision が本文・タイトル・スタイルを合成し、値が同じタイトルは rename しない（restoreNoteRevision.ts）` — 守っているテスト: `restoreNoteRevision.test.ts:TC-note-470`（3 イベントの同時発行）, `TC-note-478/479`
- `trashNote がジョブ終端・本文回復・trash を 1 transaction で行い、順序を守る（trashNote.ts）` — 守っているテスト: `trashNote.test.ts:TC-note-672`（順序と、commit を落として「どちらも残らない」窓）
- `trashNote が scope の最小 purgeAfter で Alarm を張る（trashNote.ts:armRetentionSweep）` — 守っているテスト: `purgeExpiredTrash.test.ts:UC-note-021「trashing arms the scope's alarm at the earliest deadline, not the newest one」`
- `restoreNote がゴミ箱にないノートを NOTE_NOT_TRASHED で拒む（restoreNote.ts）` — 守っているテスト: `restoreNote.test.ts:TC-note-466`
- `purgeNote が route claim → local delete → public remove → tombstone の順序を守り、中断から再開できる（purgeNote.ts:drive, resumeInternal）` — 守っているテスト: `purgeNote.test.ts:TC-note-349/352/353/354/355`（ポートを 1 回だけ落とす窓。順序を入れ替えると TC-note-353 が落ちる）
- `beginPurge が同一 operation の purging 行を世代 CAS より先に返す（ports/noteRouteStore.ts:beginPurge）` — ユースケース層でのみ守られている（`purgeNote.test.ts:TC-note-353/355`）。ポート契約と conformance では守られていない → [W-001]
- `内部 operation ID が cleanup では派生、利用者要求では採番される（purgeNote.ts:ownerPurgeOperationId, retentionPurgeOperationId）` — 守っているテスト: `purgeNote.test.ts:TC-note-360`（派生の一致と、削除・ノート両方への束縛）, `TC-note-370`（2 要求は 1 勝者）
- `purgeNote が note.purged を 1 回だけ収集し、後始末は購読者に委ねる（purgeNote.ts:deleteLocally）` — 守っているテスト: `purgeNote.test.ts:TC-note-348/353`, `workers/__tests__/subscribers.test.ts`
- `note.purged の 3 購読者が独立して冪等（cleanup/notePurgeFanOut.ts, workers/subscribers.ts）` — 守っているテスト: `storage/__tests__/deleteFilesForNote.test.ts`, `tag/__tests__/deleteAssignmentsForNote.test.ts`, `integration/__tests__/deleteBackupRecordsForNote.test.ts`（再配送が no-op）
- `継続 task の payload が境界でデコードされる（notePurgeFanOut.ts:readNotePurgeTurn）` — 守っているテスト: 直接のケースは見当たらないが、`scopeTaskRunner` 経由の経路は `deleteNotesForOwner.test.ts:TC-note-076`（worker plane が自分で積んだ行を claim して完走する）で通っている。壊れた payload の分岐は未検証（軽微。指摘は立てない）
- `emptyTrash が 50/51 の境界で mode を切り替え、500 件ごとに分割する（emptyTrash.ts）` — 守っているテスト: `emptyTrash.test.ts:TC-note-101/102/103/106/107`
- `emptyTrash が版競合・削除済みを飛ばして続ける（emptyTrash.ts:purgeEachNote）` — 守っているテスト: `emptyTrash.test.ts:TC-note-111/113/114`。飛ばしてはいけない失敗まで飛ばす点は → [W-002]
- `emptyTrash / listTrashedNotes の権限が deleteNote / viewTrash（emptyTrash.ts, listTrashedNotes.ts:resolveOwner）` — 守っているテスト: `emptyTrash.test.ts:TC-note-108/109`, `listTrashedNotes.test.ts:PAGE-p14-001（viewer 拒否・非メンバー拒否）`
- `purgeExpiredTrash が purgeAfter <= now だけを取り、満ページで再武装・進捗ゼロで backoff・空で complete する（purgeExpiredTrash.ts:settle）` — 守っているテスト: `purgeExpiredTrash.test.ts:TC-note-340〜346` と `「backs the row off instead of re-arming when nothing could be purged」`
- `deleteNotesForOwner が scope のノートを全ライフサイクル分回収し、継続 → runner → 継続 の鎖を閉じる（deleteNotesForOwner.ts）` — 守っているテスト: `deleteNotesForOwner.test.ts:TC-note-067〜082` と `TC-note-074「the runner's own turns chain until the last note is gone」`
- `findNextPurgeDeadline / listPurgeable の順序が両バックエンドで一致する（domain/note/ports/noteRepository.ts）` — 守っているテスト: `adapters/conformance/noteRepository.ts:ADP-note-013`（memory / cloudflare 双方が同じスイートを通る）。canon への反映は → [W-003]
- `NoteAccessPolicy.ensureCanDelete が編集判定と別の権能として振る舞う（domain/note/services/noteAccessPolicy.ts）` — 守っているテスト: `domain/note/__tests__/noteAccessPolicy.test.ts:「follows the workspace role table rather than the edit verdict」`, `「still passes on a trashed note, which is what purge needs」`
- `getNote / listNotes / listTrashedNotes が version を運ぶ（application/note/view.ts, getNote.ts）` — 守っているテスト: `listNotes.test.ts:「carries the current version of each row」`, `listTrashedNotes.test.ts:PAGE-p14-002/003`。`getNote` の `version` 自体を直接主張するケースは無いが、編集系テストが全部この値を `expectedVersion` に使うので実効的に守られている

#### カバレッジ

- 確認: `packages/core/src/adapters/html/allowList.ts`, `packages/core/src/adapters/html/css.ts`, `packages/core/src/adapters/html/htmlProcessor.ts`, `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts`, `packages/core/src/domain/note/ports/htmlProcessor.ts`, `packages/core/src/domain/note/ports/noteRepository.ts`, `packages/core/src/domain/note/services/noteAccessPolicy.ts`, `packages/core/src/domain/note/__tests__/noteAccessPolicy.test.ts`, `packages/core/src/application/note/editing.ts`, `packages/core/src/application/note/jobs.ts`, `packages/core/src/application/note/updateNoteBody.ts`, `packages/core/src/application/note/applyTextNodeEdits.ts`, `packages/core/src/application/note/renameNote.ts`, `packages/core/src/application/note/changeNoteStyleMode.ts`, `packages/core/src/application/note/listNoteRevisions.ts`, `packages/core/src/application/note/restoreNoteRevision.ts`, `packages/core/src/application/note/trashNote.ts`, `packages/core/src/application/note/restoreNote.ts`, `packages/core/src/application/note/purgeNote.ts`, `packages/core/src/application/note/emptyTrash.ts`, `packages/core/src/application/note/purgeExpiredTrash.ts`, `packages/core/src/application/note/deleteNotesForOwner.ts`, `packages/core/src/application/note/listTrashedNotes.ts`, `packages/core/src/application/note/getNote.ts`, `packages/core/src/application/note/moveNote.ts`, `packages/core/src/application/note/view.ts`, `packages/core/src/application/note/__tests__/*`（13 ファイル + `editingHarness.ts`）, `packages/core/src/application/cleanup/notePurgeFanOut.ts`, `packages/core/src/application/cleanup/participants.ts`, `packages/core/src/application/di/types.ts`, `packages/core/src/application/di/memoryRuntime.ts`, `packages/core/src/application/di/cloudflareRuntime.ts`, `packages/core/src/application/execution/unitOfWork.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/workers/subscribers.ts`, `packages/core/src/application/ports/noteMovePort.ts`, `packages/core/src/application/identity/deleteAccount/authorRedaction.ts`, `packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`, `packages/core/src/adapters/memory/repositories/noteRepository.ts`, `packages/core/src/adapters/cloudflare/do/repositories/noteRepository.ts`, `packages/core/src/adapters/conformance/noteRepository.ts`, `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/memory/scopeUnitOfWork.ts`, `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`, `packages/core/src/adapters/cloudflare/__tests__/runtimeComposition.test.ts`, `spec/usecases/note.md`, `spec/domains/note.md`, `spec/inventory/usecase.md`
- スキップ: `apps/web/app/components/**`, `apps/web/app/routes/**`, `apps/web/app/presentation/**`, `apps/web/app/routeTree.gen.ts` — frontend 担当。ただし経路規約の突き合わせのため `apps/web/app/components/note/NoteEditor/textNodes.ts` と `apps/web/app/components/note/schema.ts` だけは参照した（アダプター側の `resolveTextNode` と一致していること、`rawHtml` の転送上限が境界で効いていることを確認）
- スキップ: `packages/core/src/application/storage/**`, `packages/core/src/domain/storage/**`, `packages/core/src/adapters/*/repositories/storedFileRepository.ts`, `packages/core/src/adapters/conformance/storedFileRepository.ts`, `packages/core/src/application/usage/ensureUploadAllowed.ts` — storage 担当。`collectOrphanMedia` が `HtmlReferenceReader` を受け取る配線だけ `di/types.ts` 側で確認した
- スキップ: `packages/core/src/domain/tag/**`, `packages/core/src/domain/integration/**`, `packages/core/src/application/tag/**`, `packages/core/src/application/integration/**`, `packages/core/src/adapters/*/repositories/{tagAssignment,backupRecord}Repository.ts`, `packages/core/src/adapters/conformance/{tagAssignment,backupRecord}Repository.ts`, `packages/core/src/adapters/cloudflare/do/schema.ts` — tag / integration 担当。`note.purged` の購読者として `subscribers.ts` / `scopeTaskRunner.ts` に正しく登録され、冪等テストが購読者ごとに存在することだけ確認した
- スキップ: `spec/manual-tests/editing.md`, `spec/presentation/index.md`, `spec/usecases/storage.md`, `spec/domains/storage.md` — それぞれ検証担当 / frontend / storage 担当
- スキップ: `packages/core/package.json`, `pnpm-lock.yaml` — parse5 の追加のみ（[ADR 007（.thread）](../adr.md) の判断どおり）

#### 補足: 確認したが指摘に立てなかったもの

- **mXSS 探索は白**。`noembed` / `noframes` / `xmp` / `plaintext` / `<svg><style>` の foster parenting / MathML の `mglyph` 経路を実際に流し、`process` の出力が再パースに対して安定（`process(process(x)) === process(x)`）かつ無害であることを確認した。`adopt` が unwrap した子を明示的に再親付けしている（`htmlProcessor.ts:96-105`）のがここで効いている
- **URL スキーム判定は白**。`stripControls` が制御文字と空白を落としてから scheme を読むので `jav&#x09;ascript:` / `java&#10;script:` は塞がっている。`srcset` を候補単位で分割して `data:` のカンマを壊さない実装も正しい
- **`retention` admission に trashed 判定が無い**のは意図的（spec の該当節が「列挙が既に立てた 2 つの主張だけ」と明記し、復元は版が動くので競合で弾かれる）。`purgeExpiredTrash.test.ts:TC-note-341/342` が窓を押さえている
- **`getNote` の `version` が匿名閲覧者にも渡る**。単調増加のカウンターで「そのノートを読める者」に閉じてはいるが、`.thread/7/adr.md` の ADR-031 が根拠にした「`getNote` は認証済み経路からしか呼ばれない」は正しくない（`getNote.test.ts:TC-note-178` が匿名経路を通している）。実害が無いので指摘には立てないが、ADR の前提の記述は事実と違う
- **`ensureExpectedVersion` の `(actual as number)` キャスト**（`editing.ts:212`）。`ExpectedVersion<Note>` はブランド付き number なので実行時は正しいが、`as` は型の逃げ道である。`ExpectedVersion` 側に比較関数を持たせるほうが素直（軽微なので指摘には立てない）
