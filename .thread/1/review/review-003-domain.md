# Review 003 — Domain

対象: PR #12（`origin/main...HEAD`、400 変更ファイル / ラウンド 3）
観点: エンティティ・値オブジェクト・ドメインルール・不変条件・ポート契約
基準: CLAUDE.md / `spec/domains/{index,identity,note,conversion,workspace}.md` / `.thread/1/plan.md` / `.thread/1/adr.md`
前提: `.thread/1/review/triage.md` に判定済みの Key（B-001 / W-001..W-028 / R2-*）は再審議しない。

## ラウンド 2 指摘の修正確認

ドメイン層でラウンド 2 以降に変更されたファイルは 5 件（`git diff 9cc3c4d..HEAD -- packages/core/src/domain packages/core/src/application/{ports,scope.ts,execution}`）。すべて指摘対応で、余計な変更は入っていない。

- **R2-DM-W-001（サロゲートペア分断）— 修正確認済み**。`packages/core/src/domain/note/valueObject.ts:100-109` に `truncateWithoutSplittingPair` が新設され、`Excerpt.fromText`（`:161-166`）と `NoteHeading.create`（`:200`）の両方が `slice` から差し替わっている。境界条件を個別に検査した:
  - `value.length <= max` は無変更返却。`max` ちょうどで終わる場合に 1 単位削らない（`valueObject.test.ts:97` が 200 単位ぴったりで絵文字を保持することを assert）。
  - 分断判定は `last ∈ [0xD800,0xDBFF] ∧ next ∈ [0xDC00,0xDFFF]` の対チェックで、単独 high surrogate（後続が低サロゲートでない）を誤って削らない。入力側に既にある単独サロゲートは持ち込まれるが、それは切り詰めが作った欠陥ではない。
  - `max = 0` は `charCodeAt(-1)` が `NaN` になり比較が全て偽 → `slice(0,0)` で空文字列。例外にならない。
  - ADR-032 の決定（数え方はコード単位のまま、切り詰めだけ補正）と実装が一致。`Excerpt.create` の上限検査が `value.length` である以上、この選択は上限検査と切り詰めの単位を揃える唯一の整合解である。
  - テストは `valueObject.test.ts:89-103`（Excerpt の分断側 199 / 非分断側 200）と `:115-123`（NoteHeading 99）の 3 件で、`TextDecoder(TextEncoder(x)) === x` による整形式判定を使っており、単独サロゲートが残ればラウンドトリップが崩れて必ず落ちる。判定として妥当。
- **R2-DM-W-002（note 遷移 4 点の未カバー）— 修正確認済み**。`note.test.ts` に 8 件追加（要求した 4 点をすべて含み、さらに周辺を厚くしている）:
  - `applyConversionResult`: auto タイトル差し替え + `note.renamed` 併発（`:161`）、manual タイトル保持（`:189`）、`result.title === null`（`:201`）、見出し 201→200（`:211`）。
  - `updateBody`: `ProcessedHtml` からの `ready` 組み立てと `note.contentUpdated`（`:228`）、見出し上限（`:250`）。
  - `Note.reconstruct`: public + パスワード付き休眠リンクが `RehydrationError`（`:518`。`toThrowError()` から `toThrowError(RehydrationError)` へ強化）、およびパスワードなし休眠リンクなら受理される対照ケース（`:550`）。上限・拒否の片側だけを見る形になっていない。
  - domain 単体テストは 8 ファイル 134 件 → 144 件、全通過を実行確認。
- **R2-DM-W-003（`utf8ByteLength` の反復符号化）— 修正確認済み**。`valueObject.ts:80-90` で `TextEncoder` がモジュール定数化され、`exceedsUtf8Bytes(value, max)` が `value.length * 3 > max` の短絡を持つ。**上界の健全性を検証した**: UTF-16 コード単位あたりの UTF-8 バイト数は、BMP 文字 ≤ 3、サロゲートペア 2 単位 4 バイト（= 2/単位）、単独サロゲート → `TextEncoder` が U+FFFD へ置換して 3 バイト。したがって `byteLength <= length * 3` は例外なく成り立ち、`length * 3 <= max` のとき符号化せず「超過なし」と断ずるのは偽陰性を生まない。偽陽性側（`length*3 > max` だが実バイトは以内）は第 2 項の実測で正しく落とす。判定の意味論は旧実装と完全同値で、`valueObject.test.ts:55-72` の 800,000 / 800,001 バイト境界とマルチバイト計数のテストがそのまま効いている。

## 受け入れ基準の再確認（自観点分）

ラウンド 2 で一致を確認した AC-1〜AC-5 は、上記 5 ファイル以外に変更がないため結論を維持する。今回は数と契約の突き合わせを再実行した。

- **AC-1**: 横断ポート 12 種（`ScopeKey` / `ScopeRouter` / `ScopeUnitOfWorkProvider` / `GlobalUnitOfWorkProvider` / `ScopeCleanupAdmissionStore` / `AccountDeletionManifestStore` / `GlobalMaintenanceRunStore` / `MailSender` / `TimeZoneResolver` / `OAuthStateStore` / `IdempotencyStore` / `NoteRouteFanOutReader`）のメソッド名・引数・戻り値を spec/domains/index.md の `ts` ブロックと 1 行ずつ照合し、差分なし。`take` の原子性、`recordFailure` の read-then-write 禁止、`markProcessed` の同一 plane 原子性はいずれも JSDoc に契約として明記されている。
- **AC-2**: Identity 値オブジェクト 14 種（UserId / IdentityId / SessionId / AuthTokenId / Email / Handle / DisplayName / Bio / PasswordHash / PlainPassword / TokenHash / OAuthProvider / AuthTokenPurpose / LoginAttemptKey）。`Handle` の `^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$` は spec の「3〜30 文字・先頭末尾は英数字」と一致（最短 3 / 最長 30）。予約語判定を形式判定より先に置く順序も、`n` / `sitemap.xml` のように両方に違反する語で有用な方の判定を返すという意図どおり。`LoginThrottlePolicy.evaluate` の境界（`failureCount < 2` → allow、2 で 1 秒、上限 60 秒、10 回で `lastFailedAt + 15 分`、ロック判定を待機判定より先に置く）は spec の規則と一致し、`loginThrottlePolicy.test.ts` の 10 件が解除直後の再ロックまで固定している。
- **AC-3**: Identity ポート 10 種 + `OAuthStateStore` = 11 種。`AuthTokenRepository.save` の条件付き更新と `AUTH_TOKEN_ALREADY_CONSUMED`、`IdentityUniqueDirectory` の reserve→activate→release の冪等性、`SessionRepository` が `save` を持たない理由が JSDoc に残っている。`UserBatchReader` / `NoteRouteStore` の上限超過は今回 `SystemError(DatabaseError)` に統一され（ADR-036）、双方の `Error contract:` 行から相互参照できる。
- **AC-4**: Note 値オブジェクト 12 種、`Note`（lifecycle × content × visibility）/ `NoteRevision` / `NoteAccessPolicy` / `NoteOwnershipPolicy`。「public はパスワードを持てない」は `makePublic` の `stripPassword` と `reconstructVisibility:760-762` の拒否の両方で守られ、今回その拒否に対照テストが付いた。`InitialContentState` の `failed` 理由が `machineExtractionUnavailable | unsupportedFormat | passwordProtected` の 3 値に絞られている点は spec/domains/conversion.md:62-66 の定義と完全一致（`ConversionPlanner.initialContentFor` が返しうる値の集合）。
- **AC-5**: Note ポート 15 種（domain 11 + application 4）すべて定義済み。世代ベクトルの比較規則、public writer の `routeVersion` 先行比較とリセット、`excerpt`（平文）と `highlightedExcerpt`（`<mark>` のみの HTML 断片）の正反対の描画契約が型の隣に置かれている。
- **純粋性 / 依存方向**: `packages/core/src/domain/` 全体に `new Date()` / `Date.now` / `Math.random` / `process.env` の使用なし（`new Date(...)` は `now` 由来の派生と `ensureCanEdit` の定数エポックのみ）。`@repo/core/application` / `@repo/core/adapters` への import もゼロ。
- **スコープ**: `workspace` / `conversion` / `job` / `storage` は語彙の最小片のみで、各ファイルの JSDoc に「本体は後続スライス」が明記。`WorkspaceAuthorization` は interface のみ、実装は `application/note/accessControl.ts` の placeholder（到達したら `DataIntegrityError`）で、`viewerFor` が `workspaceRole: null` 固定のため到達経路がないことを確認。ドメイン側にスコープ逸脱なし。

### Domain

#### Blockers

なし

#### Warnings

- **[W-001]** `Excerpt.fromText` の `max` が非正の値を取ると、切り詰めが「末尾を削る」に反転して Excerpt の 200 単位不変条件を破った値を無検査で返す
  - 場所: `packages/core/src/domain/note/valueObject.ts:100-109`（`truncateWithoutSplittingPair`）、`:161-166`（`Excerpt.fromText` が `create` を通さず `as Excerpt` でキャスト）
  - 理由: `max < 0` のとき `value.length <= max` は偽、`charCodeAt(max - 1)` は `NaN` で分断判定も偽になり、`value.slice(0, max)` が実行される。`String.prototype.slice` は負の終端を「末尾からのオフセット」と解釈するため、1000 単位の入力に `max = -5` を渡すと 995 単位の文字列が返り、そのまま `Excerpt` としてキャストされる（`Excerpt.create` の 200 単位検査を通らない）。`fromText` は spec/domains/note.md が `Excerpt.fromText(text, 200)` と第 2 引数つきで規定する公開 API で、後続スライス（取り込み・検索のハイライト）で「残り予算」から `max` を導出する呼び出しが入れば、負値は計算の自然な帰結として発生しうる。CLAUDE.md の「不正な状態は型・生成経路の段階で表現不能にする」および ADR-032 が確認した「値オブジェクトは常に妥当な値を返す」責務に対して、切り詰め経路にだけ検査の穴が残っている。現時点の呼び出し元は `Note.createBlank`（`""` 固定）とテストのみなので実害は顕在化していない — 顕在化していないうちに塞ぐ種類の穴として挙げる。
  - 提案: `truncateWithoutSplittingPair` の先頭で `const limit = Math.max(0, max)` に正規化して以降で使う（1 行）。あわせて `Excerpt.fromText` の戻り値を `Excerpt.create(...)` 経由にすると、将来 `create` の検査を強化したとき切り詰め経路が自動で追随する（現状は `as Excerpt` のキャストで検査が二度と効かない）。テストは `fromText(text, -5)` と `fromText(text, 0)` が空文字列を返すことを 1 件で足りる。

#### カバレッジ

一覧: `/private/tmp/claude-501/-Users-hikaru-github-com-tuanemuy-hollow/745a12ca-2c12-4fee-b017-75c8d1afae23/scratchpad/changed-files-r3.txt`（400 行）。確認 69 + スキップ 331 = 400。

確認（69 件）:

- `packages/core/src/domain/identity/**`（25 件）— `valueObject.ts` / `errorCode.ts` / `events.ts` / `user.ts` / `identity.ts` / `session.ts` / `authToken.ts`、`ports/` 10 件、`services/` 3 件、`__tests__/` 5 件
- `packages/core/src/domain/note/**`（21 件）— `valueObject.ts` / `errorCode.ts` / `events.ts` / `note.ts` / `noteRevision.ts`、`ports/` 11 件、`services/` 2 件、`__tests__/` 3 件
- `packages/core/src/domain/workspace/**`（3 件）— `valueObject.ts` / `errorCode.ts` / `services/workspaceAuthorization.ts`
- `packages/core/src/domain/common/**`（2 件）— `pagination.ts`（`ShardPage` / `PrunePage` の追加分）/ `time.ts`
- `packages/core/src/domain/{conversion,job,storage}/valueObject.ts`（3 件）
- `packages/core/src/application/ports/**`（12 件）— `accountDeletionManifestStore` / `globalMaintenanceRunStore` / `idempotencyStore` / `mailSender` / `noteMovePort` / `noteRouteFanOutReader` / `noteRouteStore` / `oauthStateStore` / `scopeCleanupAdmissionStore` / `scopeRouter` / `shareTokenProtector` / `timeZoneResolver`
- `packages/core/src/application/scope.ts`（1 件）、`packages/core/src/application/execution/unitOfWork.ts`（1 件）
- `packages/core/src/application/note/accessControl.ts`（1 件）— `NoteAccessPolicy` への `WorkspaceAuthorization` 注入と `viewerFor` の到達性のみスポット確認（本体は usecase 観点）

スキップ（331 件、ディレクトリ単位）:

- `apps/web/**`（111 件）— presentation / frontend 観点
- `packages/core/src/adapters/memory/**`（37 件）、`packages/core/src/adapters/conformance/**`（26 件）、`packages/core/src/adapters/{d1,libsql,aws,gcp,cloudflare}/**`（38 件・全 D）— アダプター / 適合テスト観点
- `infra/**`（29 件・全 D）— インフラ削除（AC-14）
- `.thread/1/**`（19 件）、`docs/**`（7 件）、`.github/workflows/ci.yml`（1 件）— ドキュメント / CI。設計意図の参照のみ
- `packages/core/src/domain/todo/**`（9 件・D）、`packages/core/src/application/todo/**`（9 件・D）— todo 参照実装の削除のみ（AC-14）。契約なし
- `packages/core/src/application/identity/**`（13 件）、`application/note/**` の `accessControl.ts` 以外（8 件）、`application/di/**`（7 件）、`application/workers/**`（4 件）、`application/errors.ts`・`application/__tests__/helpers.ts`・`config.ts`（3 件）— ユースケース / DI / ワーカー観点
- ルート・パッケージ設定（10 件）— `biome.json`, `CLAUDE.md`, `README.md`, `package.json`, `packages/core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `vitest.config.integration.ts`, `vitest.config.integration.node.ts`。ツーリング観点
