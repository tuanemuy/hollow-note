### backend-note

#### Blockers

**[B-001]** `filterCss` の `position` 判定が値の否認リストなので、`var()` 一段の間接で `position: fixed` が素通りする

- 場所: `packages/core/src/adapters/html/css.ts:26-27, 222-236`（`VIEWPORT_ANCHORED_POSITION` / `viewportAnchoringProperty`）
- 理由: ADR 013 が `position: fixed` / `sticky` を落とす唯一の理由は「Shadow DOM はセレクタを隔離するがレイアウトを隔離しない」ことであり、公開ページ（正規ドメイン・検索エンジン到達可）の全面をノート本文の `<style>` 1 個で覆えることが脅威である。実装は**値の文字列が `fixed|sticky` に一致するか**しか見ないため、カスタムプロパティ経由の指定を見逃す。実機で確認した:

  ```
  入力: <style>:host{--x:fixed}.o{position:var(--x);top:0;left:0;width:100%;height:100%}</style><div class="o">overlay</div>
  出力: 同一（removed は [] — 除去も報告もされない）
  ```

  ブラウザは `var(--x)` を `fixed` に解決するので、ADR 013 の中核防御が 1 行で無効化される。CSP は `position` を止めないため多層防御も効かない。`<style>` は `updateNoteBody`（HTML モード）から利用者が直接書けるので到達経路も塞がっていない。
- 提案: ADR 013 の「許可リスト方式」の原則どおり、`position` の値を**許可リスト**で判定する（`static` / `relative` / `absolute` / `inherit` / `initial` / `revert` / `unset` とベンダー接頭辞付きの同義語だけを残し、それ以外の値 — `var()` を含む — は宣言ごと落として `removed` に載せる）。同じ形の間接（`env()`、将来の `attr()`）にも自動的に効く。ADR 013 の「除去するもの」の行にも値の判定が許可リストであることを書き足す。テストは既存のテーブル駆動へ `position:var(--x)` / `position:VAR(--x)` / `position:var(--x,fixed)` を足す。

**[B-002]** 本文の転送境界上限が spec の「2 MB 以内（サニタイズ前）」と矛盾し、根拠のコメントがサニタイズ前後を取り違えている

- 場所: `apps/web/app/components/note/schema.ts:38-41`（`NOTE_HTML_TRANSPORT_MAX = 800_000`）、`updateNoteBodySchema` / `createNoteWithBodySchema` が使用。正典は `spec/usecases/note.md#updateNoteBody` の入力 DTO 表（`rawHtml` … `2 MB 以内（サニタイズ前）`）
- 理由: コメントは「800 KB は UTF-8 バイト数の上限。1 UTF-16 単位は最大 3 バイトなので、バイト上限と同じ数の**文字数**を許せばドメインの判定より必ず緩い」と説明するが、比べている 2 つが違うものである。ドメインの 800,000 バイトは**サニタイズ後**の `NoteHtml` に掛かり、転送境界の 800,000 文字は**サニタイズ前**の生 HTML に掛かる。生 HTML はサニタイズで縮む側（`<script>` / `<iframe>` / 未許可属性が落ちる）なので、「転送のほうが必ず緩い」は成り立たない。実害は ED-03 の中核要件そのもので、1 MB の保存済み Web ページ（インラインスクリプト込み・サニタイズ後は数十 KB）を HTML モードに貼ると、`NOTE_CONTENT_TOO_LARGE` でも「800 KB 超なので分割を」でもなく `INVALID_INPUT`（形の不正）で拒否される。spec の 2 MB はまさにこの差を吸収するための値である。
- 提案: 転送上限を spec の 2 MB（`2_000_000`）に合わせる。DoS 上限としてはそれで足り、`ContentTooLarge` はサニタイズ後にドメインが出す。コメントは「転送はサニタイズ**前**の生 HTML に掛かるので、サニタイズで縮む分だけドメインより緩く取る」に書き換える。2 MB を採らない判断をするなら、`spec/usecases/note.md` の入力 DTO 表を先に直して両側を一致させる（現状はどちらの側も正典と読めない）。

#### Warnings

**[W-001]** `note.purged` の購読者が spec 手順 5 の 5 件中 3 件しか登録されておらず、欠落がコードにも spec にも宣言されていない

- 場所: `packages/core/src/application/workers/subscribers.ts:172-221` / `spec/usecases/note.md#purgeNote` 手順 5
- 理由: spec は `deleteAssignmentsForNote` / `deleteFilesForNote` / `deleteBackupRecordsForNote` / `projectNoteChanges` / `applyStorageDelta` の 5 件を挙げるが、登録は前 3 件だけである。後ろ 2 件は本リポジトリに実装が無く（`grep projectNoteChanges` は該当なし、`applyStorageDelta` は `moveNote.ts` のローカル関数のみ）、欠落を宣言している場所は `.thread/7/adr.md:494` だけ — CLAUDE.md が「Issue が閉じればリンクが死ぬ」として引用を禁じている場所である。同じリポジトリの `application/cleanup/participants.ts` は不在を `absent(reason, handoff)` として**型で網羅**させる先例を持っており、fan-out 側にはその仕掛けが無い。結果として、購読者を足し忘れたまま読み取りモデルを読む経路が生えても、`dispatchDomainEvent` は warn ログだけで ack するのでテストは緑のまま通る（これは plan の「リスクと注意点」が名指しした失敗形そのもの）。
- 提案: `subscribers.ts` の `note.purged` 群にも `participants.ts` と同じ形の不在宣言を置く（`note.purged` の期待購読者集合を型で列挙し、`absent(...)` を明示する）。それが重いなら、最低限 spec 側の手順 5 に「本デプロイでは `projectNoteChanges` / `applyStorageDelta` が未実装で、追加スライスで購読者になる」を書き、`.thread/` 以外に根拠を残す。

**[W-002]** `NoteAccessPolicy.ensureCanDelete` / `ensureCanEdit` は production から一度も呼ばれない死んだ API で、実際の判定と挙動も違う

- 場所: `packages/core/src/domain/note/services/noteAccessPolicy.ts:41-47, 70-88, 166-172` / 実際の判定は `packages/core/src/application/note/editing.ts:93-101, 168-176`
- 理由: 本 PR は `ensureCanDelete` をドメインサービスと `spec/domains/note.md` の表に足し、テストを 4 本足した。しかし trash / purge / restore / emptyTrash のどの経路もこれを呼ばず、`editing.ts` が `noteAccessPolicy.evaluate(...)` の結果から `access[capability]` を直接読んでいる。しかも両者は**投げるものが違う** — ドメイン側は `BusinessRuleError(AccessDenied)`、usecase 側は存在を漏らさないために `NotFoundError("NOTE_NOT_FOUND")` に潰す。したがって追加された 4 本のテストは「自分自身」しか守っておらず、実運用の削除権限判定には 1 行も届いていない（`ensureCanEdit` が同様に未使用なのは既存の問題）。「不正状態を型で排除する」観点でも、同じ決定に 2 つの入口があって片方が使われないのは、次に触る人が誤ったほうを呼ぶ余地を残す。
- 提案: どちらかに寄せる。(a) `editing.ts` の `resolveNoteFor` / `claimNote` が `evaluate` を直接読む形を正とするなら、`ensureCanEdit` / `ensureCanDelete` をポリシーから外し、`spec/domains/note.md` の表からも落とす。(b) ドメインメソッドを正とするなら、`editing.ts` が `ensureCanDelete` を呼んで `AccessDenied` を捕まえて `NOTE_NOT_FOUND` へ写す形にし、「潰す」判断が 1 か所に立つようにする。どちらでもよいが、production に届かない API とそのテストを残さないこと。

**[W-003]** `purgeNote.drive` が local transaction のあらゆる例外で `abortPurge` するため、commit 後に応答を失うと route を `active` へ戻してしまう

- 場所: `packages/core/src/application/note/purgeNote.ts:265-271`（`catch (cause) { await abortQuietly(...) }`）
- 理由: spec 手順 3 は「**競合して Note が残る場合は** local 変更をせず `abortPurge` で route を active へ戻す」、手順 4 は「ここから先は abort せず forward recovery する」と、abort を許す条件を再検査の拒否に限定している。同ファイルの JSDoc も「every refusal the re-check inside that transaction can raise ... hands the route back」と書く。実装は例外の種別を見ずに abort するので、`ctx.noteRepository.delete` が commit した後に応答を失った場合（Cloudflare DO / D1 では現実に起こる形）、`note.purged` は outbox に載って fan-out が走り、Note 行は消え、それでも route は `active` に戻り、`finishPurge` は走らないので tombstone も付かない。以後この route は「解決するが実体の無い」行として永久に残り、`resolve` を通す全経路が `NOTE_NOT_FOUND` を返す。
- 提案: abort を spec が名指しした拒否だけに絞る（`isConflictError` / `isNotFoundError` / `NOTE_NOT_TRASHED` の `ValidationError`）。それ以外は route を `purging` のまま残して forward recovery に委ねる — 到達不能は事実の表現であり、`scopeCleanup` / `retention` は同じコマンドの再送で再開できる。`userRequest` だけは再送口が無い（採番した operation ID を `resolve` が隠す）ので、その制約は JSDoc の「Not covered by this slice」の段に既に書かれている recovery driver の持ち分として残す。テストは `deleteLocally` の commit 後に `SystemError` を投げるラッパーを 1 回だけ噛ませて、route が `purging` のままであることを見る（`docs/test.md`「Injecting into a concurrency window」の形）。

**[W-004]** `listNoteRevisions` が版一覧のたびに 20 版すべてを `HtmlProcessor.process` に通す

- 場所: `packages/core/src/application/note/listNoteRevisions.ts:62`、JSDoc は `listNoteRevisions.ts:20-23`
- 理由: `process` はパース → 許可リスト適用 → 再シリアライズ → テキスト抽出 → 見出し収集の全工程で、excerpt はその副産物である。1 版は最大 800,000 バイトなので、版一覧 1 リクエストで最悪 16 MB 相当の HTML を再パース＋再サニタイズすることになる。JSDoc の「at most twenty passes over already-sanitized markup」は、この工程が「既にサニタイズ済みなので軽い」かのように読めるが、`process` は入力がサニタイズ済みかどうかで仕事量を変えない。編集画面が版ピッカーを開くたびに走る同期処理としては、この見積もりのまま置くのは危うい。
- 提案: 少なくとも JSDoc を実態に合わせる（「最大 20 × 800 KB のフルサニタイズ」と書く）。実装として直すなら 2 案 — (a) excerpt 用にテキスト抽出だけを行う軽い口を `HtmlProcessor` に足す（`process` の全工程を通さない）、(b) `NoteRevision` に excerpt を持たせて書き込み時に確定する（`spec/domains/note.md` の `NoteRevision` を先に直す必要がある）。どちらも本スライスの外へ回してよいが、選択を JSDoc に残すこと。

**[W-005]** テストの `tc` ラベルに前ラウンドのレビュー指摘 ID `B-001` が 9 箇所残っている

- 場所: `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts:260, 267, 274, 281, 289, 296, 303, 311, 319`（`tc: "TC-note-705 / B-001"` など）
- 理由: `B-001` は `spec/` にも `.thread/7/adr.md` / `plan.md` / `steps.md` にも定義が無く、`.thread/7/review/review-001-*.md` にしか存在しない。CLAUDE.md は `.thread/{number}/` について「Never cite it from code, `spec/`, or `docs/`: ... the link dies when the issue closes」と明記している。`tc` フィールドは「このケースがどの正典行を担保するか」を指すためのもので、そこにレビューの経緯が混ざると、Issue が閉じた後に読んだ人がどの規則の話か辿れない。
- 提案: `B-001` を落とし、`tc` は担保する TC 行だけにする（`"TC-note-705"` / `"TC-note-706"` / `"TC-note-708"` / `"TC-note-709"`）。なぜその綴りを試すのかは既に直上のコメント（「browser resolves comments and identifier escapes before it reads a property name」）が説明しており、経緯の ID は情報を足していない。

**[W-006]** `emptyTrash` の `scheduled` 経路は、ジョブを 1 件も登録できなくても `purgedCount: N` を返す

- 場所: `packages/core/src/application/note/emptyTrash.ts:231-245, 265`（`flush` が `jobId === null` でも `enrolled += chunk.length`）
- 理由: `NoteBulkPurgeJobs` の JSDoc は「`null` answers "this deployment has nothing to register a job with", which is what keeps `jobIds` an accurate list of what was registered rather than a promise nothing kept」と書くが、その正直さは `jobIds` にしか及んでいない。本デプロイ（`noNoteBulkPurgeJobs`）では 51 件以上のゴミ箱を空にすると `{ mode: "scheduled", purgedCount: 1200, jobIds: [] }` が返り、spec/view.ts が定めた読み方に従えば画面は「1200 件の削除を開始しました」と出す — 1 件も予約されていないのに。Job 集約の不在自体は `.thread/7/adr.md` の ADR-002 が既知の制限として宣言済みなので、指摘は「不在」ではなく「不在のときの答え方」に限る。
- 提案: `enrolled` を「実際にジョブが返ったチャンク」だけで数える（`jobId !== null` のときだけ加算）。そうすれば `purgedCount: 0, jobIds: []` になり、view の JSDoc が言う「`mode` で読み替える」規約と矛盾しない。あるいは `EmptyTrashView` に「登録できなかった」第 3 の `mode` を足す。どちらにせよ、返した数と起きたことが食い違う状態は残さない。

**[W-007]** OCC トークンの不透明性が `ensureExpectedVersion` で剥がれ、同じ判定に 2 つの流儀がある

- 場所: `packages/core/src/application/note/editing.ts:217-224`（`(actual as number) !== expected`）／対する `packages/core/src/application/note/purgeNote.ts:310`（`note.version !== input.expectedVersion`）
- 理由: `ExpectedVersion<T>`（`domain/common/transactionalRepository.ts:1-15`）はブランド付きで、JSDoc が「`save` / `delete` consume the token, so a usecase cannot accidentally re-derive the expected version from the in-memory aggregate」と、**トークンを数値として扱わせない**ことを目的に宣言している。`ensureExpectedVersion` は `as number` でそれを剥がし、転送から来た素の数と比べるので、「トークンの数値＝エンティティの `version`」という、型が隠そうとしていた等式に依存する。加えて `purgeNote.admitUserRequest` は同じ検査を `note.version` で書いており、1 スライスに 2 つの書き方が並んでいる（キャスト自体も不要 — `ExpectedVersion<T>` は `number` に代入可能なので `!==` はキャストなしで通る）。
- 提案: `ensureExpectedVersion` の引数を `Note`（または `note.version`）に変えて `note.version !== expected` で判定し、ブランドを剥がす箇所を無くす。呼び出し側はいずれも直前に `note` を持っているので変更は局所で済み、`purgeNote` の入口検査と同じ流儀に揃う。

#### テスト保証

- ED-02（構造を保ったテキストノード編集）: `applyTextNodeEdits.test.ts` が経路解決・`expected` 不一致・全件 skip の無書き込み・`class` / `style` の保存・派生情報の再構築・`<style>` 内の `pathNotFound` を、`htmlProcessor.test.ts` が `<style>` / `<script>` に経路を割り当てないことを、それぞれ端まで押さえている
- ED-03（サニタイズと除去報告）: `htmlProcessor.test.ts` の 58 行テーブルが ADR 013 の要素・属性・URL スキーム・CSS の各行を TC 番号付きで通す。`process(process(x)) === process(x)` は明示のテストが無いが、手元で `svg><style>` / `noscript` / `math+mglyph` の古典的 mXSS 入力を通して安定と無害化を確認した。**ただし `position` の値判定は B-001 のとおり穴がある**
- ED-03 の 800 KB 拒否: `TC-note-721` / `TC-note-722` が境界の両側（超過で `ContentTooLarge`、ちょうどで成功）を押さえる。**転送境界側の上限は B-002 のとおり正典と食い違う**
- ED-04 / ED-08（版の記録と復元）: `updateNoteBody.test.ts` の `TC-note-725`（新しい 20 版を残す）、`restoreNoteRevision.test.ts` の 13 本（本文・タイトル・スタイルの同時復元、他ノートの版の不在扱い、サニタイズ通過、参照の巻き戻しと再登録）が実効的な検証になっている
- ED-07（タイトル）: `renameNote.test.ts` が空・空白のみ・200 字・201 字・`auto → manual` の遷移まで押さえる
- ED-08 の楽観ロック: 編集 5 経路すべてに `OPTIMISTIC_LOCK_FAILURE` のケースがあり、`updateNoteBody` の `TC-note-732`（入口読み取りと書き込みの間に除名）が commit 側の再認可も踏んでいる
- ED-09 / ED-10（trash / restore / purge）: `trashNote.test.ts` の 23 本が公開・共有経路の遮断、ジョブ強制終端の除外規則、`processing` 本文の回復と `Note.trash` の順序（2 遷移が 1 transaction）を押さえる。`purgeNote.test.ts` は route CAS・中断窓（local delete 後の再開、tombstone 応答喪失）・operation ID の決定的採番・二重 purge の単勝者を end state で検証しており、`toBeDefined()` 頼みのケースは無い
- ED-10 の保持期限回収: `purgeExpiredTrash.test.ts` が「進捗ゼロだけ backoff」「満ページで即再予定」「期限が来ていない ≠ 残っていない」の 3 分岐と、`trashNote` が最古の期限で alarm を張ることを押さえる。ポート側は conformance の `ADP-note-013`（`purgeAfter ASC, id ASC`）と `ADP-note-057`（`findNextPurgeDeadline` は現在時刻を見ない）が memory / cloudflare 両方に掛かっている
- ED-11（表示スタイル）: `changeNoteStyleMode.test.ts` が「同じ値でも書いてイベントを出す」判断まで含めて検証している
- `note.purged` の fan-out: `purgeNote.test.ts` は「正しい形の `note.purged` がちょうど 1 回収集される」までで、購読者側の冪等性は各購読者のテストが持つ。**spec が挙げる 5 購読者のうち 2 件が未登録**（W-001）
- `NoteRouteStore.beginPurge` の「CAS より先に冪等」: conformance に `ADP-note-043` が 2 本入り、番兵世代が他人の route を奪えないことも同じスイートで押さえている
- **担保されていない挙動**: B-001（`var()` 経由の `position: fixed`）、B-002（2 MB の転送上限）、W-003（commit 後の応答喪失で route が `active` に戻る）、W-006（登録できなかった一括削除の件数）はいずれもテストが無く、あっても現在の実装を追認するだけになる

#### カバレッジ

確認（担当分・差分／実ファイルの両方を読んだもの）:

- `packages/core/src/domain/note/services/noteAccessPolicy.ts` / `packages/core/src/domain/note/__tests__/noteAccessPolicy.test.ts`
- `packages/core/src/domain/note/noteRevision.ts`
- `packages/core/src/domain/note/ports/htmlProcessor.ts`
- `packages/core/src/domain/note/ports/noteRepository.ts`
- `packages/core/src/adapters/html/allowList.ts`
- `packages/core/src/adapters/html/css.ts`
- `packages/core/src/adapters/html/htmlProcessor.ts`
- `packages/core/src/adapters/html/__tests__/htmlProcessor.test.ts`
- `packages/core/src/adapters/conformance/noteRepository.ts`
- `packages/core/src/adapters/conformance/noteRouteStore.ts`
- `packages/core/src/adapters/memory/repositories/noteRepository.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/noteRepository.ts`
- `packages/core/src/application/note/editing.ts` / `jobs.ts` / `applyTextNodeEdits.ts` / `updateNoteBody.ts` / `renameNote.ts` / `changeNoteStyleMode.ts` / `trashNote.ts` / `restoreNote.ts` / `restoreNoteRevision.ts` / `listNoteRevisions.ts` / `listTrashedNotes.ts` / `purgeNote.ts` / `purgeExpiredTrash.ts` / `emptyTrash.ts` / `deleteNotesForOwner.ts` / `view.ts` / `getNote.ts`（差分）/ `moveNote.ts`（差分）
- `packages/core/src/application/note/__tests__/editingHarness.ts`（全文）、同 `__tests__/*.test.ts` 15 本（テスト名を全件、`purgeNote.test.ts` の本体を抜き取りで）
- `packages/core/src/application/ports/noteRouteStore.ts` / `noteMovePort.ts`
- `packages/core/src/application/di/types.ts` / `memoryRuntime.ts`
- `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/cleanup/notePurgeFanOut.ts` / `participants.ts`
- `packages/core/src/application/workers/subscribers.ts` / `scopeTaskRunner.ts`
- `packages/core/src/application/identity/deleteAccount/authorRedaction.ts` / `cleanupDispatch.ts`（note に関わる行のみ）
- `apps/web/app/components/note/schema.ts`（note ユースケースの転送契約として）
- `apps/web/app/routes/notes/-action.tsx`（note ユースケース呼び出し口と内部専用引数の露出有無のみ）
- `spec/adr/013-html-sanitization-policy.md` / `spec/domains/note.md`（差分）/ `spec/usecases/note.md`（該当節を全文）/ `spec/testcases/note/emptyTrash.md` / `spec/inventory/usecase.md`（差分）
- 動作確認: `npx vitest run --project node packages/core/src/{application/note,adapters/html,domain/note}` → 21 files / 458 tests green

スキップ（担当外・他レビュアーの持ち分）:

- `apps/web/app/components/layout/ScopeToken/index.tsx` / `listing.ts`
- `apps/web/app/components/note/NoteDetail/detail.tsx` / `index.tsx` / `menu.tsx`
- `apps/web/app/components/note/NoteEditor/editor.tsx` / `frame.tsx` / `highlight.ts` / `index.tsx` / `preferences.ts` / `skeleton.tsx` / `surfaces.tsx` / `textNodes.ts`
- `apps/web/app/components/note/NoteList/board.tsx` / `index.tsx`
- `apps/web/app/components/note/TrashList/action.ts` / `board.tsx` / `index.tsx`
- `apps/web/app/presentation/errorDisplay.ts` / `__tests__/errorDisplay.test.ts` / `__tests__/errorResponse.test.ts`
- `apps/web/app/routeTree.gen.ts`
- `apps/web/app/routes/__tests__/storage.delivery.test.ts` / `notes/$noteId_.edit.tsx` / `notes/new.tsx` / `notes/trash.tsx` / `storage.$.tsx` / `workspaces/$workspaceId/-action.tsx` / `workspaces/$workspaceId/notes/$noteId_.edit.tsx` / `workspaces/$workspaceId/notes/index.tsx` / `workspaces/$workspaceId/notes/new.tsx` / `workspaces/$workspaceId/notes/trash.tsx`
- `packages/core/package.json` / `pnpm-lock.yaml`
- `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- `packages/core/src/adapters/cloudflare/__tests__/conformance/scopeBusiness.test.ts` / `conformanceBackend.ts` / `deleteFilesByOwner.test.ts` / `ports/scopeBusiness.ts` / `runtimeComposition.test.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/backupRecordRepository.ts` / `storedFileRepository.ts` / `tagAssignmentRepository.ts` / `do/schema.ts`
- `packages/core/src/adapters/conformance/backend.ts` / `backupRecordRepository.ts` / `storedFileRepository.ts` / `tagAssignmentRepository.ts`
- `packages/core/src/adapters/memory/__tests__/conformance.test.ts` / `__tests__/conformanceBackend.ts` / `repositories/backupRecordRepository.ts` / `repositories/storedFileRepository.ts` / `repositories/tagAssignmentRepository.ts` / `scopeUnitOfWork.ts` / `store.ts`
- `packages/core/src/application/di/cloudflareRuntime.ts`（note の追加ポートは `memoryRuntime.ts` と同形と判断。cloudflare の合成は backend-storage / adapter 側の持ち分）
- `packages/core/src/application/identity/__tests__/deleteAccount.cleanup.test.ts` / `deleteAccount.terminalPrune.test.ts`
- `packages/core/src/application/integration/**` / `storage/**` / `tag/**` / `usage/**`（購読者 3 件の呼び出し口だけ `subscribers.ts` 側で確認）
- `packages/core/src/application/workers/__tests__/subscribers.test.ts`
- `packages/core/src/domain/integration/**` / `domain/tag/**` / `domain/storage/**`
- `spec/domains/integration.md` / `storage.md` / `tag.md`、`spec/inventory/adapter.md` / `test.md`、`spec/manual-tests/editing.md`、`spec/pages/index.md`、`spec/platform/index.md`、`spec/presentation/index.md`、`spec/testcases/{integration,storage,tag}/*`、`spec/usecases/{integration,storage,tag}.md`
