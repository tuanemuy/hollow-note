# Review 002 — Domain

対象: PR #12（`origin/main...HEAD`、387 変更ファイル / ラウンド 2）
観点: エンティティ・値オブジェクト・ドメインルール・不変条件・ポート契約
基準: CLAUDE.md / `spec/domains/{index,identity,note,conversion,workspace}.md` / `.thread/1/plan.md`
前提: `.thread/1/review/triage.md` に判定済みの Key（B-001 / W-001..W-028）は再審議しない。

## ラウンド 1 指摘の修正確認

- **W-003（定数時間比較）— 修正確認済み**。`packages/core/src/domain/note/services/noteAccessPolicy.ts:55-64` に `constantTimeHashEquals` が追加され、共有トークン照合（`:127`）とパス照合（`:161`）の両方が `===` から差し替わっている。実装を検査した結果:
  - 長さ不一致で早期 `false` を返すが、両辺ともハッシュで長さは固定なので漏れるのは長さのみ（JSDoc に明記済み）。
  - 内容比較は `diff |= a.charCodeAt(i) ^ b.charCodeAt(i)` の全走査で、内容依存の早期脱出がない。ループ長は `a.length`（= `b.length`）で入力依存の分岐なし。
  - `node:crypto` を持ち込まずドメインの純粋性（フレームワーク非依存・I/O なし）を保っている。CLAUDE.md の「domain は framework-free」と整合。
  - 判定の意味論は `===` と完全に同値（同長・同内容でのみ真）なので既存テストの期待値は不変。実際 domain 単体テストは 8 ファイル 134 件でラウンド 1 と同数のまま全通過を実行確認。
- **W-001（wont-fix）**: `progress.md:59` に `createBlank` / `createFromUpload` の `projectionRevision`、`moveTo` の `routeVersion` の spec-sync メモが存在することを確認。台帳どおり再指摘しない。
- **W-002（記録のみ）**: `progress.md:16` の ADP-note-050..054 見送り項に `NoteMoveSnapshot` のフィールド定義引き継ぎが追記済み。確認。

ドメイン層でラウンド 1 以降に変更されたファイルは `noteAccessPolicy.ts` のみ（`git show 9cc3c4d --stat` で確認）。他のドメインファイルはラウンド 1 時点から無変更のため、以下は独立に再検証した結果である。

## 受け入れ基準の再確認（自観点分）

- **AC-1**: `ScopeKey`（`application/scope.ts`）/ `ScopeRouter` / `ScopeUnitOfWorkProvider`（scope 引数つき `run`・ネスト禁止を JSDoc で明文化）/ `GlobalUnitOfWorkProvider` / `ScopeCleanupAdmissionStore` / `AccountDeletionManifestStore` / `GlobalMaintenanceRunStore` / `MailSender` / `TimeZoneResolver` / `OAuthStateStore`（`take` の原子性を契約として明記）/ `IdempotencyStore(consumer, eventId)` — 12 ポートすべてメソッド・型・エラー契約が spec/domains/index.md と一致。`AccountDeletionManifestItem` の判別共用体、`MaintenanceLane` の lane/lease 語彙まで spec どおり。
- **AC-2**: Identity 値オブジェクト 14 種、`User`（4 状態の判別共用体・`DeletedUser` は PII なし tombstone）/ `Identity` / `Session`（TTL 30 日をドメイン所有・`create` に引数を取らない）/ `AuthToken`、`IdentityPolicy`（上限 8）/ `AccountLinkingPolicy`（判定表 6 行と完全一致）/ `LoginThrottlePolicy`（`failureCount < 2` で allow → 3 回目に 1 秒、上限 60 秒、10 回で `lastFailedAt + 15 分` ロック、解除後は残待機が負なので allow）— 一致。ロック判定を待機判定より先に置く順序も spec の「ロック中は待機を返さない」と整合。
- **AC-3**: Identity ポート 11 種（`recordFailure` の read-then-write 禁止、`save(Consumed)` の条件付き更新 + `AUTH_TOKEN_ALREADY_CONSUMED`、reserve→activate→release の冪等性、`SessionRepository` が `save` を持たない理由）— エラー契約込みで一致。
- **AC-4**: Note 値オブジェクト 12 種、`Note`（lifecycle × content × visibility、`unlisted` の shareLink 必須を型で表現、`makePublic` のパスワード剥奪 + 休眠化、`makeUnlisted` の休眠復活 → newLink → `ShareLinkRequired`、`reissueShareLink` のパスワード維持、`trash` の `purgeAfter = +30 日`、`TrashedNote` への変更を型で遮断）/ `NoteRevision` / `NoteAccessPolicy`（所有 → ゴミ箱遮断 → public → unlisted+token → denied）/ `NoteOwnershipPolicy` — 一致。「public はパスワードを持てない」不変条件が `makePublic` の `stripPassword` と `reconstruct` の拒否の両方で守られていることを確認。
- **AC-5**: Note ポート 15 種すべて定義済み。世代ベクトル比較規則（`stale` / `incomparable`、public writer が `routeVersion` を先に比較してリセットする規則）、`highlightedExcerpt` の平文 / HTML 断片の描画契約が spec の文面どおり型の隣に置かれている。
- **純粋性**: `packages/core/src/domain/` 全体に `new Date()` / `Date.now()` / `Math.random` / `crypto.*` / `process.env` / 動的 import の使用なし（`ensureCanEdit` の `new Date(0)` は定数エポックで決定的、理由もコメント済み）。`application` / `adapters` への逆向き import もなし（grep で確認）。
- **スコープ**: `workspace` / `conversion` / `job` / `storage` は語彙の最小片のみで、いずれも「本スライスで必要な理由」と「本体は別スライス」を JSDoc に明記。スコープ逸脱なし。

### Domain

#### Blockers

なし

#### Warnings

- **[W-001]** 抜粋・見出しの切り詰めが UTF-16 コード単位のため、サロゲートペアを割って不正な単独サロゲートを生む
  - 場所: `packages/core/src/domain/note/valueObject.ts:132-133`（`Excerpt.fromText` の `text.slice(0, …)`）、同 `:168`（`NoteHeading.create` の `params.text.slice(0, 100)`）
  - 理由: spec/domains/note.md は Excerpt を「200 **文字**」、NoteHeading の text を「100 文字以内（超過分は切り捨てる）」と定める。`String.prototype.slice` は UTF-16 コード単位で切るため、境界に絵文字などの非 BMP 文字が来ると単独サロゲート（lone surrogate）で終わる文字列になる。この値は `NoteProjectionEntry.excerpt` として読み取りモデルへ流れ、`note_search` の生テキスト列・FTS・`highlightedExcerpt` の材料になる。単独サロゲートは正当な UTF-8 に符号化できず、`TextEncoder` は U+FFFD に置換し、`JSON.stringify` は非対のエスケープを出すため、ドライバによっては保存・シリアライズ時に破損または例外になる。値オブジェクトの責務は「常に妥当な値を返すこと」なので、境界の壊れた文字列を作れる時点でドメイン側の穴である。
  - 提案: コードポイント単位で切る（`Array.from(text).slice(0, max).join("")`）か、末尾が high surrogate なら 1 単位戻す補正を入れる。同じ補正を `Excerpt.fromText` と `NoteHeading.create` の両方に置き、`valueObject.test.ts` に非 BMP 文字の境界ケースを 1 件足す。

- **[W-002]** 本文状態を動かす 3 つの遷移と `Note.reconstruct` の不変条件ガードが単体テスト未カバー
  - 場所: `packages/core/src/domain/note/note.ts:247-283`（`applyConversionResult`）、`:319-334`（`updateBody`）、`:90-92`（`capHeadings`）、`:739-772`（`reconstructVisibility` の「public + パスワード付き休眠リンク」拒否）— 対応するテストが `packages/core/src/domain/note/__tests__/note.test.ts` に存在しない
  - 理由: plan.md のテスト方針は「VO・エンティティ遷移・ドメインサービス」を domain 単体テストで押さえると定めている。未カバーの 4 点はいずれも spec が明文で定める分岐であり、静かに壊れても型では検出できない。とくに `applyConversionResult` の「`result.title` が渡され、かつ `NoteTitle.isAuto(note.title)` が真のときだけ差し替える」は spec/domains/note.md の振る舞い表にある条件付き規則で、`manual` タイトルが変換結果に上書きされる退行は利用者から見て破壊的である。`capHeadings` の 200 件上限は ADR 017 の行サイズ保証の一部で、上限が消えても `NoteHtml` の 800,000 バイト検査は通ってしまう。`reconstruct` の public 拒否は「public はパスワード保護を持たない」という 4 つの不変条件のうち唯一 reconstruct 側で守られているガードなので、これが外れると DB 由来の不正状態が素通りする。
  - 提案: `note.test.ts` に 4 件足す — (1) `applyConversionResult` が `manual` タイトルを保持し `auto` タイトルだけ差し替え、差し替え時のみ `note.renamed` を併発する、(2) `updateBody` が `ProcessedHtml` から `ready` を組み立て `note.contentUpdated` を出す、(3) 201 件の見出しが 200 件に切り詰められる、(4) `Note.reconstruct` が public + パスワード付き休眠リンクを `RehydrationError` にする。

- **[W-003]** バイト長検査が毎回入力全体を符号化するため、読み取り経路の再構築が入力サイズに比例した一時割り当てを繰り返す（軽微）
  - 場所: `packages/core/src/domain/note/valueObject.ts:79-80`（`utf8ByteLength` = `new TextEncoder().encode(value).length`）、呼び出し元は `NoteHtml.create` / `PlainTextContent.create`
  - 理由: `Note.reconstruct` は `NoteHtml.create` と `PlainTextContent.create` を必ず通る（`note.ts:708-709`）ので、一覧取得の `listByOwner` で 20 件読むだけで最大 800KB × 2 × 20 の Uint8Array を捨てるためだけに確保する。ドメインの正しさには影響しないが、検査は上限超過の有無しか要らないので全量符号化は過剰である。
  - 提案: `TextEncoder` をモジュールレベルに 1 個持ち、`value.length * 3 <= CONTENT_MAX_BYTES` なら符号化せず即 OK と判定する短絡を入れる（BMP 文字は最大 3 バイト、サロゲートペアは 2 コード単位で 4 バイトなのでこの上界は健全）。

#### カバレッジ

一覧: `/private/tmp/claude-501/-Users-hikaru-github-com-tuanemuy-hollow/745a12ca-2c12-4fee-b017-75c8d1afae23/scratchpad/changed-files-r2.txt`（387 行）。確認 69 + スキップ 318 = 387。

確認（69 件）:

- `packages/core/src/domain/identity/**`（25 件）— `valueObject.ts` / `errorCode.ts` / `events.ts` / `user.ts` / `identity.ts` / `session.ts` / `authToken.ts`、`ports/` 10 件、`services/` 3 件、`__tests__/` 5 件
- `packages/core/src/domain/note/**`（21 件）— `valueObject.ts` / `errorCode.ts` / `events.ts` / `note.ts` / `noteRevision.ts`、`ports/` 11 件、`services/` 2 件、`__tests__/` 3 件
- `packages/core/src/domain/workspace/**`（3 件）— `valueObject.ts` / `errorCode.ts` / `services/workspaceAuthorization.ts`
- `packages/core/src/domain/common/pagination.ts`, `packages/core/src/domain/common/time.ts`（2 件）
- `packages/core/src/domain/conversion/valueObject.ts`, `packages/core/src/domain/job/valueObject.ts`, `packages/core/src/domain/storage/valueObject.ts`（3 件）
- `packages/core/src/application/scope.ts`, `packages/core/src/application/execution/unitOfWork.ts`（2 件）
- `packages/core/src/application/ports/**`（12 件）— `accountDeletionManifestStore` / `globalMaintenanceRunStore` / `idempotencyStore` / `mailSender` / `noteMovePort` / `noteRouteFanOutReader` / `noteRouteStore` / `oauthStateStore` / `scopeCleanupAdmissionStore` / `scopeRouter` / `shareTokenProtector` / `timeZoneResolver`
- `packages/core/src/application/note/accessControl.ts`（1 件）— `NoteAccessPolicy` へ注入される `WorkspaceAuthorization` の扱いのみスポット確認（本体は usecase 観点）

スキップ（318 件、ディレクトリ単位）:

- `packages/core/src/domain/todo/**`（9 件・D）— todo 参照実装の削除のみ（AC-14）。契約なし
- `packages/core/src/adapters/conformance/**`（26 件）、`packages/core/src/adapters/memory/**`（36 件）、`packages/core/src/adapters/{d1,libsql,aws,gcp,cloudflare}/**`（38 件・大半 D）— アダプター / 適合テスト観点
- `packages/core/src/application/` の残り（44 件）— `identity/**`（13）、`note/**` の `accessControl.ts` 以外（8）、`todo/**`（9・D）、`di/**`（7）、`workers/**`（4）、`__tests__/**`（1）、`errors.ts`（1）、`config.ts`（1）。ユースケース / DI 観点
- `apps/web/**`（106 件）— presentation / frontend 観点
- `.thread/1/**`（13 件）、`docs/**`（7 件）、`.github/workflows/ci.yml`（1 件）— ドキュメント / CI。設計意図の参照のみ
- `infra/**`（29 件・D）— インフラ削除（AC-14）
- ルート・パッケージ設定（9 件）— `biome.json`, `CLAUDE.md`, `package.json`, `packages/core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `vitest.config.integration.ts`, `vitest.config.integration.node.ts`。ツーリング観点
