# 実装手順 — Issue #14

## 設計

本 Issue はドキュメント同期であり、ドメイン・ユースケース・アダプター・UI の**振る舞いを一切変えない**。コード差分は計画時点でステップ 8 の JSDoc・コメント ＋ ステップ 30 の適合スイート 1 ファイル（既存実装が既に満たす主張を 1 つ足すだけ）で、レビューの修正ラウンドで増えた分もすべてコメント・JSDoc・`describe` / `it` 名の文字列に閉じる。**件数と内訳の正典は `plan.md` の AC-63 と「コード差分の内訳」表で、この文書には写さない**。したがって通常の「レイヤーの内側から外側へ」ではなく、**同期の向きの決定**と**ドキュメントの依存方向**で設計する。

台帳は 2 系統（`research.md` の SYNC-01〜27 と `research-2.md` の SYNC-201〜244）だが、**1 つの計画として統合済み**。同じファイルを触る項目は系統をまたいで 1 ステップに束ねてある（plan.md のスコープ節の対応表）。

### 同期の向きの決定（レイヤーに相当する判断）

`spec/adr/046-port-contract-divergence.md` の判定規則（正本のある側へ倒す）を項目ごとに当てる。判定結果は adr.md ADR-001。

| 正本の所在 | 該当項目 | 本 Issue での扱い |
| --- | --- | --- |
| 実装 ＋ 契約 JSDoc ＋ 適合スイート | SYNC-04,05,06,07,11,15,16,22,25 | spec を追随させる |
| 実装 ＋ 自動テスト（application 層） | SYNC-01,12,14,20 | spec を追随させる |
| 実装 ＋ 昇格済み ADR | SYNC-02（ADR 029）, SYNC-10（ADR 029）, SYNC-17 | spec を追随させる |
| spec の記載漏れ（実装と矛盾しない） | SYNC-03,09 | spec に足す |
| spec 内部の自己矛盾（一方が実装と一致） | SYNC-26 | 実装と一致する側へそろえる |
| 実装そのもの（リポジトリの現況） | SYNC-18,19 | `CLAUDE.md` / `docs/` / `README.md` を書き直す |
| 乖離なし・判断が未記録 | SYNC-13 | 判断を spec に 1 行残す |
| **spec が正・実装が落とした側** | SYNC-24 | **本 Issue では直さない**。実装 Issue へ |
| **どちらも未決** | SYNC-08,23 | **本 Issue では直さない**。別 Issue へ |
| **裏づけが取れない（未実装ドメイン）** | SYNC-27 | **本 Issue では直さない**。別 Issue へ |

Issue #2 由来（SYNC-201〜244）も同じ規則を当てる。**この系統は「昇格済み ADR が正、下流 spec が未追随」が多数派**である（PR #17 が `spec/adr/034`〜`051` の 30 本を昇格させた一方、`spec/domains/` `spec/usecases/` `spec/database/` `spec/inventory/` は 2026-08-09 のまま）。

| 正本の所在 | 該当項目 | 本 Issue での扱い |
| --- | --- | --- |
| 昇格済み `spec/adr/`（034/035/038/039/041/043/044/045/047/048/049/050） | SYNC-203(1)(2),205,206,212,216,217,218,224,228,229,233,234,235,236,239,240,243 | spec の下流を追随させる |
| 実装 ＋ 契約 JSDoc ＋ 適合スイート | SYNC-202,207,209,210,222,226,230 | spec を追随させる |
| 実装 ＋ 自動テスト / テストケース | SYNC-219,223,238 | spec を追随させる |
| spec の記載漏れ（実装と矛盾しない） | SYNC-201,204,211,215,220,244 | spec に足す |
| spec 内部の自己矛盾（一方が実装・usecase と一致） | SYNC-241,242 | 正本のある側へそろえる |
| **置き場所そのものが誤り** | SYNC-227 | 契約と予算に分けて置き直す（adr.md ADR-014） |
| **spec が正・実装が縮退／未実装** | SYNC-203(3),214,231(列),237 | **本 Issue では直さない**。spec を狭めず Phase 5 へ |
| **spec が正・実装にセキュリティ要件が無い** | SYNC-221 | **spec 内部の矛盾解消のみ**。実装は Phase 5 へ（adr.md ADR-013） |
| 解消済み / 重複 | SYNC-232 / SYNC-225 | 何もしない（SYNC-225 は SYNC-15 = ステップ 2 で決着） |

**SYNC-14 だけは 1 行に収まらない。** ポート述語（`allRollbackReleased` の判定対象）は実装 ＋ 適合スイートが正本なので spec を追随させるが、ユースケースの復帰ゲート（personal barrier の abort ack を確認してから User を `active` へ戻す順序）は**実装がまだ存在しない**（`beginRollback` / `allRollbackReleased` / `abortPersonalAccountDeletion` を呼ぶ application コードはゼロ）ため spec が正本のまま残る。同じ項目でも「振る舞いの正本がどこにあるか」は粒度ごとに違う（`spec/adr/046`）。詳細は adr.md ADR-004。

### ドキュメントの依存方向

`spec/` の中の依存は次の向きで、**上流を直してから下流を追随させる**。

```
spec/adr/            （既存 001〜051 は読むだけ。本 Issue の判断 6 件を 052〜057 として新設 — ステップ 20。**A より前に実行する**）
  ↓ 根拠
spec/domains/, spec/usecases/, spec/pages/, spec/presentation/, spec/scenario/,
spec/testcases/, spec/database/, spec/platform/
  ↓ 生成 / 追随
spec/inventory/{domain,adapter,frontend,test,usecase}.md, spec/manual-tests/account.md
```

`spec/database/` と `spec/platform/` は `spec/domains/` `spec/usecases/` と**同じ段**（互いに正本を持ち合う）。統合で新たに触るのは `spec/database/index.md`（ステップ 26）と `spec/platform/index.md`（ステップ 29）で、どちらも inventory の生成元ではないので下流追随は発生しない。`spec/inventory/usecase.md` は統合により**対象に入る**（ステップ 31）。

`spec/inventory/*.md` はヘッダーに「生成元: `spec/domains/`（最終同期: 日付）」を持つ生成物なので、**本文を全部直し終えてから最後にまとめて追随させる**（ステップ 9〜12, 31）。本文ステップと inventory ステップを交互にすると同じ行を 2 度触ることになる。`spec/manual-tests/` も同じ理由で下流に置く（ステップ 18）。

`CLAUDE.md` / `docs/` / `README.md` は `spec/` に依存しない別系統なので、順序の制約はない（ステップ 13〜15、19）。

### 記述様式の遵守

新しい様式は持ち込まない。既存の書式に合わせる。

- `spec/domains/*.md` の振る舞い表 = `| メソッド | 引数 | 戻り値 | 処理 |`。引数はコードブロックではなく TS 風のインライン記法（`params: { … }, now: Date`）
- ポートの失敗契約 = 説明段落のあとに `**エラーケース**: A、B、C` の 1 行（note.md の `:371,385,404,420,434,531,607` が既存例）
- 不変条件 = `**不変条件**` 見出しのあとの箇条書き 1 行 1 項目
- `spec/pages/index.md` の状態 = `**状態**: A / B / C` の 1 行（括弧で遷移先を添える既存様式を踏襲）
- `spec/testcases/*/*.md` = `| 前提条件 | 操作 | 期待結果 | 実装ステータス |` の 4 列（4 列目は全行が空。埋めない）
- `spec/usecases/*.md` のエラーケース表 = `| 条件 | 種類 |` の 2 列。**畳み込む場合は条件列にエラーコードを置き、種類列に畳み込み結果を書く**（既存例: `| 並行する要求が先にトークンを消費した（ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")） | エラーにせず alreadyVerified: true で返す（手順 6） |`）
- `spec/manual-tests/*.md` = TC 見出し ＋ `**種別**` / `**目的**` ＋ `| # | 操作 | 期待結果 |` の 3 列表。末尾に `## カバレッジ`（`### ユースケースエラーケース対応表` と `### 観点チェックリスト`）
- `spec/inventory/*.md` = `| ID | 要素 | 定義場所 | 実装されるべき振る舞いの要点 |` の 4 列。**1 行 = 1 要素**。**適合ケースには新規 ID を採番しない**（adr.md ADR-002）が、**新規ポートメソッド・新規ユースケース・新設テストケースには採番する**（adr.md ADR-011 / ADR-016）。採番は各群の**末尾**に足し、既存 ID を繰り下げない

## 編集アンカーの指定

**行番号を第一のアンカーにしない。** ステップ 1〜7 が本文を編集した時点で、以降のステップの行番号は全部ずれる。計画時点でも次のずれが実測で見つかっている。

- `spec/pages/index.md` の L-02 状態行は `:103`（research/adr は `:105` と書いていた）
- `spec/presentation/index.md` の「対象」段落は `:138` `:140`、「その他のヘッダー」表は `:177-180`
- `spec/inventory/domain.md` の `DOM-note-006` / `DOM-note-007` は `:240` `:241`（`:242` は無関係な `DOM-note-008 StyleMode`）

したがって各ステップの編集箇所は次の優先順で指定する。

1. **ID**（`DOM-note-006` / `ADP-common-017` / `TC-identity-261` / `P-40` など）
2. **見出し**（`### その他のヘッダー` / `## verifyEmail` など）
3. **引用文言**（置換前の文の一部をそのまま引用する）

以下のステップで括弧内に添えた行番号は、**計画時点のスナップショットであって編集の根拠ではない**。

## 実装ステップ

同じファイルへの複数項目の編集は 1 ステップに束ねてある（分割すると編集が競合する）。Issue #2 由来の項目のうち既存ステップと同一ファイルのものは、**既存ステップ番号を維持したまま変更内容を足してある**（ステップ 1, 2, 3, 4, 6, 7, 8, 9〜12, 18, 20）。新設は 22〜32（**21 は欠番**）。

### 実行順

**番号順ではない。** 次のフェーズ順に実行する。

| フェーズ | ステップ | 制約 |
| --- | --- | --- |
| **F0. `spec/adr/` の採番確定とファイル作成** | **20** | **A より前に固定する。** 番号入りリンク（`[ADR 053](../adr/053-….md)`）を本文へ焼き込むステップが 9 つある（A: 2, 3, 4, 7, 24, 28, 29 / C: 10 / D: 18）ので、採番の再確認（`ls spec/adr/`）が後ろに来ると、ずれが判明した時点で本文リンクが書き終わっている。**訂正の指示はどのステップにも無い** |
| A. `spec/` 本文 | 1, 2, 3, 4, 5, 6, 7, 22, 23, 24, 25, 26, 27, 28, 29, 32 | ファイル単位で排他。**内部順の制約が 5 組ある**（下記。`4 → 32` は計画レビュー R3 arch:P-003 で追加） |
| B. コード（JSDoc / コメント / 適合スイート） | 8, 30 | A と独立。ステップ 30 は 8 の後が読みやすいが必須ではない |
| C. `spec/inventory/` の追随 | 9, 10, 11, 12, 31 | **A を全部終えてから**（本文からの生成物）。ステップ 11 は**ステップ 32 の後**（新設テストケースの TC 行を採番するため） |
| D. `spec/manual-tests/` の追随 | 18 | **A（特にステップ 5）を終えてから** |
| E. `spec/` 外のドキュメント | 13, 14, 15, 19 | 順序制約なし。13 と 19 は同じ事実を書く |
| G. フォローアップ起票 | 16 | 最後の直前 |
| H. 最終確認 | **17** | **全ステップの最後** |

**フェーズ A の内部順**（「相互に順序制約なし」ではない。同じことを同じ語で書くのが本 Issue の成果物なので、これは実害のある制約）。

| 順序 | 理由（本文の指示） |
| --- | --- |
| **3 → 4 → 26** | ステップ 4-9 が「ステップ 3-7 と同じ内容なので**先に 3 を書いてから同じ語彙で写す**」、ステップ 26-1 が「**ステップ 4-8 と同じ文言にそろえる**」、ステップ 26-2 が「ステップ 3-7 と**同じ語彙**で直す」 |
| **29 → 24** | ステップ 24-3 が性能上の性質を「ステップ 29 で足す段落へ委ねる」。少なくとも 29 の文面が確定していること |
| **27 → 4-5**（および C フェーズの 11） | `InvalidProviderAccount` の**同一文面を 3 か所**へ書く。**27 が文面の基準** |
| **22 → 24** | ステップ 24-4 が `ensureAcceptable` の呼び出しをステップ 22-3 で決めた新署名へ書き換える |
| **4 → 32** | ステップ 32-1 が新設 3 ファイルの内容を「**ステップ 4-7 で書いた各節のエラーケース表と主要な成功経路に 1 対 1 で対応させる**」ことを内容そのものにしている。ステップ 32 自身も冒頭で「ステップ 4 の後に実行する」と宣言している（計画レビュー R3 arch:P-003 — 表だけを見て並べると、テストケースが未確定の usecase 節に対して書かれる） |

これ以外（1, 2, 5, 6, 7, 23, 25, 28）は相互に順序制約なし。

**ステップ 17（最終確認）は F0・A〜G のすべて（1〜16, 18〜20, 22〜32）を終えてから実行する。**

### コミットの分割

本 Issue は 1 PR で通す（70 件の乖離台帳を 1 本の追跡単位として扱うのがユーザーの決めたスコープで、PR を割ると台帳の追跡が分断される）。**代わりにコミットを論理単位で分ける。** レビューはコミット単位で読めるようになる。

| コミット | ステップ | 目安 |
| --- | --- | --- |
| 1. `spec/adr/` の新設 | 20 | 6 ファイル ＋ `index.md` |
| 2. `spec/` 本文の追随 | 1〜7, 22〜29, 32 | 本 Issue の中心。大きいので `spec/domains/` → `spec/usecases/` → その他 の 3 コミットに割ってもよい |
| 3. コード（JSDoc / コメント / 適合スイート） | 8, 30 | 件数と内訳の正典は `plan.md` の AC-63（「コード差分の内訳」表）。**振る舞いを変えないことをこのコミット単体で確認できる** |
| 4. `spec/inventory/` の追随 | 9〜12, 31 | 生成物。本文コミットとの差分照合がしやすい |
| 5. `spec/manual-tests/` の追随 | 18 | |
| 6. `spec/` 外のドキュメント | 13, 14, 15, 19 | `spec/` と共有ファイルが 1 つも無い独立系統 |

起票（16）と最終確認（17）はコミットを持たない。

### 1. `spec/domains/note.md` — Note ドメインの 8 項目

- **対象ファイル:** `spec/domains/note.md`
- **台帳 ID:** SYNC-04, SYNC-05, SYNC-06, SYNC-07, SYNC-16（note 側）, SYNC-22, SYNC-25, SYNC-11（spec 側）, **SYNC-210**（統合分）
- **変更内容:**
  1. `:27`（NoteTitle）— 「200 文字以内」が UTF-16 コード単位である旨を明記し、超過は `BusinessRuleError(InvalidTitle)` になることを書く。現行の「（例外を投げない）」が空文字→`"無題"` の置換だけを指すことが読めるよう文を分ける（SYNC-22 / SYNC-25。根拠は `spec/adr/033`、実装は `packages/core/src/domain/note/valueObject.ts:59-64`）
  2. `:49`（Excerpt 200）/ `:54`（NoteHeading の text 100）— 同じく UTF-16 コード単位であること、切り詰めはサロゲートペアを割らないこと（`valueObject.ts:99-112` の `truncateWithoutSplittingPair`）を明記（SYNC-22）
  3. `:170-176`（不変条件）— 「`content.status !== "ready"` のノートは公開・限定公開にできない」を**双方向**に書き直す（公開・限定公開のノートの本文を `failed` / `awaitingIntegration` へ降格することもできない）。あわせて「`Note.reconstruct` は ready 本文の必須列（`html` / `text` / `excerpt`）の欠落を空文字で補完せず `RehydrationError` で拒否する」を 1 項目追加（SYNC-05 / SYNC-06）
  4. `:181` `:182`（振る舞い表）— `createFromUpload` / `createBlank` の引数に `projectionRevision: number` を追加（SYNC-04）
  5. `:184` `:185`（振る舞い表）— `markConversionFailed` / `markAwaitingIntegration` の「処理」欄に「`visibility.status !== "private"` なら `BusinessRuleError(CannotPublishEmptyNote)`」を追記（`makeUnlisted` / `makePublic` の `ensureReady` と対になるガード。エラーコードは新設せず再利用）（SYNC-05）
  6. `:189`（振る舞い表）— `moveTo` の引数を `note: ActiveNote, owner: NoteOwner, routeVersion: number, now: Date` にする（SYNC-04）
  7. `:406-420`（`NoteRepository` 節）— `listByOwner` の順序が `updatedAt DESC, id DESC` であること、id タイブレークがオフセットページングでの重複・欠落を防ぐことを説明段落に追記（SYNC-07）
  8. `:657` 付近（`NoteRouteStore` の説明段落）— `resolveMany` の 500 件上限超過が `SystemError(DatabaseError)` になること（呼び出し側のプログラミングエラーであり並行状態の衝突ではないので `ConflictError` にしない）を書き、`:609` の節に既存様式の `**エラーケース**:` 行を新設する（SYNC-16）
  9. `:659`（`NoteRouteFanOutReader` の説明段落）— 列挙対象が `active` / `moving` / `purging` で `reserved` のみ除外であること、これが `NoteRouteStore.resolve`（`purging` も隠す）より意図的に広いこと、`tombstone` は unspecified で物理削除も許されることを追記（SYNC-07）
  10. `ShareTokenProtector` の説明段落（`:663` 付近）— `**エラーケース**: SystemError(DataIntegrityError)`（未知の `keyVersion`、ciphertext 破損）を新設（SYNC-11）
  11. **（統合分）** `LocalNoteProjectionWriter` / `PublicNoteProjectionWriter` の両 interface に `redactAuthor(input: AuthorRedaction): Promise<boolean>` を足す（SYNC-210）。あわせて**同じ節の説明段落**にある「著者や workspace の一括行更新は提供しない」との関係を 1 文で書く — redaction は「保存済みの著者表示を `redactionVersion` の退会既定値に置換する」1 行単位の操作で、行が無い / 別人が作った / 既に同世代以降はすべて no-op なので at-least-once の redaction fan-out が収束する（実装 JSDoc `localNoteProjectionWriter.ts:91-97`）。`projectNoteChanges` を実装するスライスが「完全 snapshot 置換」と `redactAuthor` のどちらで受けるかを選べることを引き継ぎとして残す（`spec/adr/046`）
- **注意:** 11. の 2 メソッドは `spec/inventory/{domain,adapter}.md` に**新規行を採番する**（`DOM-note-071` / `DOM-note-072` / `ADP-note-055` / `ADP-note-056`。ステップ 9 / 10、adr.md ADR-011）。ADR-002 が禁じているのは適合ケースの行であって、新規ポートメソッドの行ではない
- **注意:** 同じ `note.md` の `PdfRenderer` / `HtmlProcessor` / `NoteExportComposer` の 3 か所には、実在しないコード名 `SystemError(ExternalServiceError)` が残る（SYNC-27、スコープ外）。**「別 Issue で整合させる」といった注記を spec 本文に書かない** — `spec/index.md` が「`spec/` に進捗・レビュー記録を置かない」と定めている。記録先はステップ 16 のフォローアップ Issue のみ
- **理由:** すべて実装 ＋ 契約 JSDoc ＋ 適合スイートが正本で、spec が古い。Issue #11 の D1 実装者はこの 1 ファイルを契約として読むため、抜けは次のバックエンドで解釈の分岐になる（`spec/adr/046`）
- **参照:** `packages/core/src/domain/note/note.ts`（`:96-103` `:164-174` `:208-215` `:305` `:323` `:390-395` `:722-744`）、`packages/core/src/domain/note/valueObject.ts`、`packages/core/src/domain/note/ports/noteRepository.ts:28-33`、`packages/core/src/application/ports/{noteRouteStore,noteRouteFanOutReader,shareTokenProtector}.ts`、`packages/core/src/adapters/conformance/{noteRepository,noteRouteStore,noteRouteFanOutReader}.ts`

### 2. `spec/domains/identity.md` — Identity ドメインの 7 項目

- **対象ファイル:** `spec/domains/identity.md`
- **台帳 ID:** SYNC-03, SYNC-15（= SYNC-225）, SYNC-16（identity 側）, **SYNC-201, SYNC-202, SYNC-205, SYNC-222, SYNC-244**（統合分）
- **変更内容:**
  1. `## エラーコード` の `IdentityErrorCode` union — `IdentityLimitExceeded` を追加する（SYNC-03）。**あわせて `InvalidAvatarUrl` と `AccountDeletionRetryLimitExceeded` も追加する**（SYNC-244。統合により本 Issue のスコープ内になった）。改訂後の union は実装 `packages/core/src/domain/identity/errorCode.ts:6-22` の **14 コード**と集合として一致すること。根拠は spec 側に既にある（`InvalidAvatarUrl` = `spec/usecases/identity.md#updateProfile` の「同一オリジンの URL」/ `spec/adr/051`、`AccountDeletionRetryLimitExceeded` = `spec/usecases/identity.md:663` と `spec/database/index.md:154` の 8 件 / 120 日）
  2. `:365` 付近（`UserBatchReader` の説明段落）— `resolveMany` の 100 件上限超過が `SystemError(DatabaseError)` になることを追記。`NoteRouteStore.resolveMany`（500 件）と同じ契約である旨も書く（SYNC-16）
  3. エラーケース行 2 か所（`UserRepository` / `UserBatchReader` / `IdentityUniqueDirectory` 共用の行 = `:369` 付近、`IdentityRepository` の行 = `:379` 付近）— `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` を `IdentityRepository` 側から外し、`IdentityUniqueDirectory` を含む群へ移す。あわせて「provider account の一意性は `IdentityUniqueDirectory` が唯一の担保であり、`IdentityRepository` は検査しない（claim は索引であって資格ではない — [ADR 038](../adr/038-provider-account-claim-and-identity-row.md)、[ADR 054](../adr/054-provider-account-uniqueness-owner.md)）」を説明段落に 1 文添える（SYNC-15 / adr.md ADR-005）
  4. **（統合分）** `AuthTokenRepository` interface（`:398-408` 付近、6 メソッドの並び）に `findPendingByUserAndPurpose(userId: UserId, purpose: AuthTokenPurpose): Promise<PendingAuthToken | null>` を足す（SYNC-201）。説明段落に「`auth_tokens` の (`user_id`, `purpose`) 部分一意索引が保証する at-most-one live token を読む唯一の口で、再送間隔を測るために使う」を添える（索引の正本は `spec/database/index.md#auth_tokens`。利用者は `resendVerificationEmail` / `requestPasswordReset` = ステップ 4-6）
  5. **（統合分）** `SignInOAuthClient` interface（`:450-453` 付近、`buildAuthorizationUrl` / `exchangeCode` の並び）に `deriveCodeChallenge(codeVerifier: string): string` を足す（SYNC-202）。説明段落に「PKCE challenge は S256 のプロトコル規定の表現であって、アダプターが選べる保存用ハッシュではない。プロトコルを知っているポートに置き、application 層をハッシュ表現から解放する」を添える（`spec/usecases/identity.md:222` の「`codeChallenge` を算出する」の主体がこれ）
  6. **（統合分）** `IdentityUniqueDirectory` interface（`:357-362` 付近、`resolve` / `reserve` / `activate` / `release` の並び）に `beginRelease({ kind, normalizedKey, expectedUserId, operationId })` を足し、`releasing` 状態を導入する（SYNC-205）。**4 メソッドの非対称を説明段落に明記する** — `resolve` は merely reserved と `releasing` を `null` として隠す / `beginRelease` は `reserved` の行に対して no-op / `release` は `reserved` と `releasing` を落とし activate 済みには触らない / **`reserve` は `releasing` の行を奪わず `ConflictError`（`EMAIL_ALREADY_USED` / `HANDLE_ALREADY_USED` / `PROVIDER_ACCOUNT_ALREADY_LINKED`）を返す。奪えるのは「`reserved` かつ期限切れ」の行だけ**（実装 `adapters/memory/repositories/identityUniqueDirectory.ts:48-67`。`.thread/2/progress.md` の該当箇条も「`resolve` は `releasing` を解決せず、**`reserve` は `releasing` を塞ぐ**という非対称」と 2 つの述語を挙げている）。`reserve` の結末を書かないと、次のバックエンド実装者が「解放途中の鍵を再予約で奪える」実装を書きうる。2 相の取り壊しは「claim は索引であって資格ではない」（[ADR 038](../adr/038-provider-account-claim-and-identity-row.md)）と at-least-once 配送の帰結であることを 1 文で書く。**同ファイル `:508` のドメインイベント表（`identity.identity.removed`）が既に「global consumer が releasing→release する」と書いており、状態の存在だけが先に漏れている**ので、そこと語を合わせること
  7. **（統合分）** `SignInOAuthClient` の `**エラーケース**:` 行（`:456` 付近）— `SystemError(ExternalServiceError)` を `SystemError(ExternalApiError)` に直す（SYNC-222）。`ValidationError("OAUTH_CODE_INVALID")` は残す。**これは SYNC-27（全域語彙整合、スコープ外）の例外**である: `SignInOAuthClient` は Issue #2 で 2 実装（Google / dev IdP）が入り、外部 API 通信 → `ExternalApiError` の写像が実コード（`domain/identity/ports/signInOAuthClient.ts:22-24`）で確定しているため、「どちらへ写すか」の裏づけがある。**同ファイルに残る `:426`（`PasswordHasher`。暗号処理の失敗）と `:443`（`SecureTokenGenerator`）は触らない** — 実測でこのファイルの `ExternalServiceError` は 3 件あり、残る 2 件は SYNC-27 としてステップ 16-4 の Issue へ送る。したがって**検査はファイル全体の 0 件ではなく `SignInOAuthClient` の行だけを見る**形になっている（plan.md「テスト方針」。計画レビュー R3 coverage:P-001）
- **注意:** 共用のエラーケース行は `UserRepository` / `UserBatchReader` / `IdentityUniqueDirectory` の**3 ポート共用**である。`PROVIDER_ACCOUNT_ALREADY_LINKED` がどのポートのものかが読めるよう、ポート別に分けるか、行内で担保元を明示すること
- **注意:** 4. / 5. / 6. の 3 メソッドは `spec/inventory/{domain,adapter}.md` に**新規行を採番する**（`DOM-identity-060〜062` / `ADP-identity-039〜041`。ステップ 9 / 10、adr.md ADR-011）
- **注意:** 1. で union を 3 コード足すと、実装 `errorCode.ts:1-5` の冒頭コメント（`IdentityLimitExceeded` と `InvalidAvatarUrl` を「spec の記載漏れ」と呼ぶ）が**全文事実に反する**。ステップ 8-4 でコメントごと削除する（AC-58 が AC-27 の後半を上書き）
- **理由:** ADR 038 / 048 はいずれも directory 側の担保を前提にしており、実装（`adapters/memory/repositories/identityUniqueDirectory.ts:9-13,22-28` が唯一の担保、`identityRepository.ts` に検査ゼロ）と一致する。spec だけが逆転している

### 3. `spec/domains/index.md` — finalize / rollback の完了判定 ＋ ポート定義・継続要求表（統合で 11 項目）

- **対象ファイル:** `spec/domains/index.md`
- **台帳 ID:** SYNC-14, **SYNC-206, SYNC-207, SYNC-208, SYNC-209, SYNC-216, SYNC-217, SYNC-228, SYNC-229, SYNC-231(a), SYNC-236**（統合分）
- **変更内容:** `ScopeKey と永続化境界` 節の `AccountDeletionManifestStore` 記述（`:124` 付近）にある「全prepare/release/cleanup/redaction item ackとpersonal/global receipt集合がfinalize/**rollback**の正本である」を、次の 3 点に書き分ける。
  1. **finalize の正本** = 固定済み全 item の完全 ack ＋ **宣言された全 receipt**（`allRequiredAcknowledged`）
  2. **rollback の正本** = 固定済み membership item の **release ack のみ**（`allRollbackReleased`）。`personalAbort` receipt はこの述語の判定対象ではない。非対称の理由（rollback は「prepare を出した先へ解放を配り切ったか」、finalize は「全参加者が終えたか」という別の問い）を 1 文添える
  3. **membership item の完全 ack は cleanup phase の ack を含む** — 「`allRequiredAcknowledged` は membership item の prepare ack だけでは満たされない。cleanup レーンが同じ item を ack して初めて item が完全 ack になる」を 1 文足す（ステップ 10 の `ADP-common-017/019/021` はこの契約本文の要点を追随させるだけにする）
  - 2. と 3. の根拠として [ADR 053](../adr/053-account-deletion-rollback-completion.md)（ステップ 20 で新設）をリンクする
  4. **（統合分）** `ScopeCleanupAdmissionStore` interface（`:74-83`）に `describePersonalCleanup(operationId): Promise<PersonalCleanupProgress | null>` を足す（SYNC-206）。説明段落に用途を 1 文 —「再駆動された継続を安く決着させるための読み取り。barrier がまだ running か、どの component が ack 済みかを答え、already completed なら global receipt を再 ack するだけで済む」。**`null` になる条件**（receipt が無い / 別 operation が scope を持つ）も書く。根拠は [ADR 039](../adr/039-cleanup-participants-declaration.md) の「再駆動を冪等にするため、掃除の進捗を読む読み取りを 1 本持つ」
  5. **（統合分）** `AccountDeletionManifestStore` interface（`:85-100`）に 2 点（SYNC-208 / SYNC-209）。
     - `describe(operationId): Promise<AccountDeletionManifestHeader | null>` を足す（read-only の header 射影。manifest が消えていれば `null`）
     - `pruneTerminal` の戻り値を `Readonly<{ operationIds: readonly string[]; nextCursor: string | null }>` に直す（`removed: number` から）。理由は同じ節に 1 文 —「`spec/database/index.md:148` が header と operation を同じ UserId-shard transaction で消すと定めており、件数だけでは `DistributedOperationStore.deleteTerminal` に渡す ID が取れない」
  6. **（統合分）** `assertOwner` の記述（interface 近傍と `:124` の「cleanup consumerはremote D1を読まず、**別ID・欠落・未commit**を拒否する」）に、**completed した barrier の所有権主張も拒否する**ことを足す（SYNC-207）。**周囲と逆向きに見えるので理由を必ず添える** — `markCompleted` / `acknowledgePersonalComponent` は完了済みを冪等に受ける（[ADR 039](../adr/039-cleanup-participants-declaration.md)）が、`assertOwner` は「まだ掃除して良いか」を問う述語なので完了後は偽になる。完了後の ack を通すと `pruneCompleted` の回収後に遅延配送が barrier を `running` に戻しうる。同じ内容をステップ 8-6（ポート JSDoc）とステップ 30（適合スイート 1 ケース）で三者そろえる（adr.md ADR-012）
  7. **（統合分）** 必須集合を**宣言集合**へ（SYNC-228 / SYNC-229）。
     - `acknowledgePersonalComponent` の引数型に直書きされた 8 値（`:80`）と `:124` の「personal barrier resultにはoperation専用の**job/note/tag/storage/backup/usage/localProjection/outbox** component ackを保存し」を、「**配備が宣言した全 component**（composition root が participant registry から実装へ渡す集合。enum 全体ではない）」に直す。ダミー ack を置かないことも書く
     - `acknowledgeReceipt` の 6 値（`:93`）と finalize の必須 receipt 集合も同様に宣言集合へ。**`personalAbort` は rollback 側の receipt なので finalize の必須集合に入らない**ことを明示する（実装は `application/cleanup/participants.ts:68` が型で除外している）
     - 根拠は [ADR 039](../adr/039-cleanup-participants-declaration.md)（昇格済み）。**3. の「membership item の完全 ack は cleanup ack を含む」と同じ段落に集まるので、文の順序を決めてから書くこと**（述語の判定対象 → 必須集合の導出元 → 完全 ack の定義）
  8. **（統合分）** 継続要求表（`:240-283`）の 3 点（SYNC-216 / SYNC-217 / SYNC-236）。
     - identity 系 3 kind（`accountDeletionManifestBuildContinued` / `accountDeletionDispatchContinued` / `accountDeletionManifestCompactContinued`）の payload に `cursor: string | null` と `continuationKey: string` を足す。`identity.accountDeletionManifestCompactContinued` の**行そのものは既にある**（progress.md の「新設した」は作業実感）ので、行を増やさず payload だけ直す
     - `:285` 以降の「規約は 4 つ」の段落に `continuationKey` の導出式（`` `${eventType}:${operationId}:${phase}:${cursor ?? "-"}` ``）と、**`identity.userAuthResidueCleanupContinued` だけが持たない理由**（カーソル無し — 仕事そのもの＝行の削除が次ターンの母集合から対象を外すので常に前へ進む）を書く。根拠は [ADR 041](../adr/041-deterministic-continuation-event-id.md) / [ADR 042](../adr/042-outbox-save-id-collision.md)
     - `identity.personalCleanupHandoverContinued` の行を 1 行足す（payload と唯一の購読者 = scope 平面の task runner）。根拠は [ADR 043](../adr/043-cross-plane-handover-driver.md)（「引き渡しに専用の継続行を与える」）
  9. **（統合分）** `:121` の `DistributedOperationStore` の 1 行の言及は**そのまま残す**（interface を新設しない — adr.md ADR-015）。ただし `state` の語彙が `running` / `completed` / `rejected` の 3 値であり、`preparing` / `committing` は account deletion manifest header 側の state であることが読めるよう、**1 行の言及に括弧書きを添える**（同じ書き分けをステップ 4-9 と 26 で行う）。**この括弧書きは AC-38 の肯定側の条件**なので、否定側（interface を新設しない）だけを満たして終わらせない
  10. **（統合分・計画レビュー R2 arch:P-008）** 同じ箇条書きに `AppliedOperationStore` の **1 行言及**を足す（`DistributedOperationStore` と同じ粒度。**interface は新設しない** — adr.md ADR-015 の追補）。内容: 「1 つの operation が同じ scope へ配る**コマンドの重複排除**は `AppliedOperationStore` が `(operationId, commandKey)` で担い、barrier receipt を扱う `ScopeCleanupAdmissionStore` とは**鍵の意味でポートを分ける**（[ADR 045](../adr/045-idempotency-by-commutativity.md)）。記録はガードするコマンドと同じ Unit of Work に入る」（実装 `application/ports/appliedOperationStore.ts`）
     - **`### 新設する横断的ポート` に `IdempotencyStore` と同じ形の interface を書かない。** interface を書けば `spec/inventory/{domain,adapter}.md` に行が要り、`spec/adr/052` の命名規約により適合スイート `adapters/conformance/appliedOperationStore.ts` の `it` 名へ ADP ID を付ける差分が発生する（AC-63 のコード差分の枠外）。**この理由はレビューの修正ラウンドでコード差分の枠が広がった後も変わらない** — U8 が閉じたのは「本 PR の採番が作った ID の衝突」であって、そもそも spec に定義も inventory 行も持たないポートへの新規採番ではない。同じ状態のポートが他に 4 本ある（`DistributedOperationStore` / `IdentityRemovalReceiptStore` / `OutboxRepository` / `ScopeTaskScheduler`）ので、1 本だけ直すと新しい非対称を作る。5 本まとめてステップ 16 の 6. の Issue へ送る
     - **`### 新設する横断的ポート` 冒頭の「以下の 4 件 … ポートの総数を数えるときは各ドメインの一覧とこの 4 件の和を取る」は触らない**（`AppliedOperationStore` は interface を持たないのでこの 4 件に入らない）
- **注意:** `personalAbort` receipt が **rollback 完了ゲートから消えるわけではない**。消えるのは「ポート述語 `allRollbackReleased` の判定対象」であって、「User を `active` へ戻す前に personal barrier の解除を確認する」というユースケースの責務は残る（ステップ 4-4）。ここ（ポート契約の正本）には述語の判定対象だけを書く
- **注意:** 4. / 5. の 3 メソッドは `spec/inventory/{domain,adapter}.md` に**新規行を採番する**（`DOM-common-041` / `DOM-common-042` / `ADP-common-040` / `ADP-common-041`。ステップ 9 / 10、adr.md ADR-011）。`pruneTerminal` は既存行（`DOM-common-026` / `ADP-common-025`）の要点更新のみ
- **注意:** この節は**本 Issue で最も編集が集中する**（3. の 3 点 ＋ 統合分 6 項目が interface 定義ブロックと `:124` の説明段落に同居する）。interface ブロック → 説明段落 → 継続要求表 の順に 1 回ずつ通し、行を往復しないこと
- **理由:** adr.md ADR-004。適合スイート `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts:495-506` が「release ack 2 件だけで `allRollbackReleased === true`」を、`:509-571` が「prepare ack ＋ 全 receipt では `allRequiredAcknowledged === false`、cleanup ack 後に `true`」を期待値として固定している

### 4. `spec/usecases/identity.md` — DTO・手順・エラー表（統合で 16 項目）

- **対象ファイル:** `spec/usecases/identity.md`
- **台帳 ID:** SYNC-12, SYNC-13, SYNC-14, SYNC-20（エラー表側）, **SYNC-218, SYNC-219, SYNC-220, SYNC-221（spec 側のみ）, SYNC-223（エラー表側）, SYNC-224(a), SYNC-226, SYNC-229(:669), SYNC-231(a), SYNC-238, SYNC-239, SYNC-243**（統合分）
- **変更内容:**
  1. `signUpWithPassword` のエラーケース表（`:80` 付近）— 現行の `| email reservationの競合 | ConflictError("EMAIL_ALREADY_USED") |` を、**同ファイルの `verifyEmail` エラーケース表にある畳み込み行と同じ様式**（条件列にコード、種類列に畳み込み結果）へ書き換える。すなわち `| 一意性 directory が email 予約の競合を返した（ConflictError("EMAIL_ALREADY_USED")） | エラーにせず既登録メールと同一の応答へ畳む（列挙耐性 — [ADR 028](../adr/028-account-enumeration-resistance.md)。手順 4 / 9） |` 相当にする（SYNC-20）
     - 既存の前例は `| 並行する要求が先にトークンを消費した（ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")） | エラーにせず alreadyVerified: true で返す（手順 6） |`。**コード名を消さない**（消すとどのエラーが畳まれるのかがエラー表から読めなくなる）。合否は AC-12 の「ユースケースの結果としては現れない」で判定する
  2. `verifyEmail` の出力 DTO 表（`:101` 付近）— `sessionToken` の型を `string | null` にし、「`alreadyVerified` 経路ではセッションを発行しないため `null`」と備考を添える（SYNC-12。手順 3 とエラーケース表は既に整合しているので触らない）
  3. `verifyEmail` 手順 7（`:114` 付近）と `signInWithPassword` 手順 8（`:184` 付近）の **2 か所とも** — 既にある「有効期間は `Session.ttlMs`」の記述に、「View は `expiresAt` を返さず、転送境界が同じドメイン定数から Cookie 期限を再導出する（値の正典はドメイン側 — [presentation/index.md](../presentation/index.md)、[ADR 055](../adr/055-session-expiry-derivation.md)）」を 1 文足す。**片方だけでは AC-11 を満たさない**（SYNC-13 / adr.md ADR-007）
  4. `deleteAccount` の rollback 手順（`:669` 付近）— 現行の「`allRollbackReleased`が全workspace release ackとpersonal abort ackを確認した後だけUserを`active`へ戻して」を、**述語の判定対象とユースケースのゲートに分けて**書き換える。
     - `allRollbackReleased`（= 固定済み membership item の release ack がすべて揃ったこと）の**判定対象に personal abort ack は含まない**
     - **ユースケースは、`allRollbackReleased` と personal barrier の abort ack（`personalAbort` receipt）の両方を確認してから** User を `active` へ戻し、manifest を `compactingRejected` へ進める
     - 根拠として [ADR 053](../adr/053-account-deletion-rollback-completion.md) をリンクする
     - **personal abort ack の確認そのものを手順から落とさない**。同じ段落が `abortPersonalAccountDeletion` を「`personalAbort` receipt として再送可能にする」と非同期 ack の語彙で書いており、確認を落とすと「User は active に戻ったが personal scope の barrier receipt は残っていて自分のノートに書けない」状態を spec が禁止しなくなる（SYNC-14 / adr.md ADR-004）
  5. **（統合分・OAuth 3 節）** — 台帳 SYNC-243 / 219 / 223 / 226 / 218。
     - `startOAuthFlow` の**出力 DTO 表**（`:212-216`。現在 `authorizationUrl` の 1 行）に `| state | string |` を足し、備考に「`authorizationUrl` が既に運んでいるが、転送境界がプロバイダーの URL を再パースせずに**フローを開始したブラウザーへ束縛**できるよう別に露出する（[ADR 034](../adr/034-oauth-callback-browser-binding.md)）」（SYNC-243）
     - `startOAuthFlow` の**エラーケース表**（`:226-231`。現在 2 行）に「`linkIdentity` intent で主体が active でない（削除開始済みを含む）→ `UnauthorizedError("UNAUTHENTICATED")`」を足し、**手順 2**（「指定時はUserId shardで`ActiveUser`を確認し」）に結末を書く。「削除を開始した利用者はもはや認証済み主体ではないので state 行そのものを作らない」を理由に添える。`spec/testcases/identity/startOAuthFlow.md` の TC-identity-266 が既にこの挙動を要求している（SYNC-219）
     - 同表の「未知のプロバイダー」行のコード名を `BusinessRuleError(InvalidProvider)` → **`BusinessRuleError(InvalidProviderAccount)`** に直す（SYNC-223。`InvalidProvider` は実装の enum にも改訂後の `spec/domains/identity.md` の union にも存在しない）。**testcases 側はステップ 27**
     - `completeOAuthSignIn` のエラーケース表（`:266-276`）と `linkOAuthIdentity` の「同じ分類に加え」の段落（`:300-302`）に `ConflictError("PROVIDER_ACCOUNT_RELEASE_PENDING")` を足す（SYNC-226）。`PROVIDER_ACCOUNT_ALREADY_LINKED`（他人が持っている）と**別のコードである理由**を 1 句 —「directory の claim は残っているが UserId shard に対応する identity が居ない収束待ち」（[ADR 038](../adr/038-provider-account-claim-and-identity-row.md)）
     - **`linkOAuthIdentity` の出力 DTO（`:287-291`）は `identityId` の 1 行のまま据え置く。** `redirectTo` は **7. で新設する `completeOAuthCallback` の出力**（intent 付き判別共用体の `linkIdentity` arm）にだけ書く（SYNC-218。計画レビュー R2 arch:P-002）
       - **実物を読んで反映先が誤っていたことを確認した。** `LinkOAuthIdentityView`（`application/identity/view.ts:166-168`）は `{ identityId: string }` の 1 フィールドだけで、`linkOAuthIdentity.ts` の 3 つの `return` もすべて `identityId` しか返さない。`redirectTo` を載せているのは `OAuthCallbackView`（`view.ts:90-93`）の `linkIdentity` arm で、`completeOAuthCallback.ts:44-50` が `flow.redirectTo`（state に park した値）から詰めている。同ファイルの JSDoc も「`redirectTo` is on the link arm because the usecase's DTO is `identityId` alone: the return path belongs to the flow the dispatcher consumed, not to the linking itself」と明言している
       - 反映先を直さないと、**実装に存在しない出力フィールドを spec に書く**ことになる（`spec/adr/046` が禁じる向き＝設計側に正本の無い契約を足す）。しかも同じステップ 4-7 で `completeOAuthCallback` 節を新設するので、1 つの Issue の中で正しい置き場所と誤った置き場所の両方に書くことになる
       - 波及: ステップ 31 の `UC-identity-007`（`linkOAuthIdentity`）に `redirectTo` を含めず、新規行 `UC-identity-024`（`completeOAuthCallback`）の要点に含める
  6. **（統合分・パスワード系）** — 台帳 SYNC-220 / 221。
     - `requestPasswordReset` の処理フロー（`:404-411`）の手順 3 の前に**発行間隔の判定**を書く —「`findPendingByUserAndPurpose(userId, "passwordReset")` で live token を引き、発行から 60 秒未満なら新規発行せず成功として返す」（実装 `requestPasswordReset.ts:12,88` の `REQUEST_INTERVAL_MS`。`resendVerificationEmail` の手順 2 と同じ値・同じ書式にそろえる）。**`passwordResetUnavailable` 分岐が間隔判定を通らない穴は spec に書かない**（実装課題。Phase 5 で Issue #18 へコメント）（SYNC-220）
     - `addPasswordIdentity` の処理フロー（現在 3 手順）に**再認証（Google 再認可）の手順**を足し、エラーケース表に再認証未了の行を足す（SYNC-221）。正本は `spec/scenario/account.md:127`（AC-06）で、`spec/pages/index.md:441` の P-22 の状態「再認証要求」と `spec/manual-tests/account.md:118` も同じことを要求している。**実装は再認可を行っておらず、本 Issue では直さない**（spec 内部の矛盾解消のみ — adr.md ADR-013、Phase 5 で新規 Issue）。**spec 本文に「未実装」「別 Issue」と書かない**（`spec/index.md` が進捗を置かないと定めている）
     - あわせて同エラーケース表に、実装が正の側である `NotFoundError("USER_NOT_FOUND")` と `ValidationError("ACCOUNT_UNAVAILABLE")` の 2 行を足す（`addPasswordIdentity.ts:48-56`）（SYNC-221 付随）
  7. **（統合分・新設 3 節）** — 台帳 SYNC-238 / 239。既存節と同じ様式（目的 / 入力 DTO / 出力 DTO / 処理フロー / エラーケース表）で書く。
     - `getProfile` と `checkHandleAvailability` を `updateProfile`（`:485` 付近）の直後に新設する。どちらも write を持たない `updateProfile` の対で、P-21 の初期表示とハンドル重複の即時チェックを供給する（`spec/pages/index.md#P-21` の機能が既に要求している）
     - `completeOAuthCallback` を `completeOAuthSignIn`（`:233`）と `linkOAuthIdentity`（`:277`）のあいだに新設する。flow state の `intent` だけで 2 usecase へ振り分けるディスパッチャーで、返り値は intent 付きの判別共用体（[ADR 035](../adr/035-oauth-callback-single-route.md) の「分岐根拠はサーバーが決めた intent だけに限る」）。**`completeOAuthSignIn` / `linkOAuthIdentity` の個々の入力 DTO は現行のまま**（実装も変えていない）
       - **出力 DTO の書き方**: `signIn` arm は `completeOAuthSignIn` の出力そのまま、`linkIdentity` arm は `linkOAuthIdentity` の出力（`identityId`）＋ **`redirectTo: string | null`**（`startOAuthFlow` が state に park した値。`flow.redirectTo` から詰める）。`redirectTo` が link arm にあるのは「戻り先はディスパッチャーが消費した flow のものであって、紐づけ自体のものではない」ため（実装 `application/identity/view.ts:80-93`）
       - 入力 DTO は `provider`（経路のパスパラメーター。表示・ログ専用）/ `state` / `code`。ルートの `:provider` が state に保存されたものと一致しなければ state を無効として扱う（実装 `completeOAuthCallback.ts:30-33`）
     - **3 節を足したら、対応するテストケースファイルも足す**（ステップ 32）。「1 ユースケース = 1 テストケースファイル = 1 UC 行」は全 9 ドメインで成立している不変で、ここだけ崩すと本 Issue が潰そうとしている類型を自分で作る（adr.md ADR-016）
  8. **（統合分・uniqueness）** `:27` 付近の「Identity uniqueness の物理 shard 境界」節の `reservationOperationId = sha256(parentOperationId + ":" + kind + ":" + normalizedKey)` を、**合成**（`` `${parentOperationId}:${kind}:${normalizedKey}` ``）へ直す（SYNC-224）。理由を 1 文 —「`kind` は `:` を含まない閉じた列挙で自由形の鍵が末尾に来るので、合成で決定性と識別性が得られる。不可逆性は要らない（[ADR 048](../adr/048-uniqueness-reservation-operation-id.md)）」＋「結果に生の鍵が埋まるので**ログや他の sink へ出さない**（出すなら `{ parentOperationId, kind }`）」。**同じ式が `spec/database/index.md:57` にもある**ので、ステップ 26 と同じ文言にそろえる
     - **（計画レビュー R2 coverage:P-004）** 同じ節の外にある **`:524`（`removeIdentity` の手順 3）の `operationId = sha256("removeIdentity:" + identityId)`** も、合成 `` `removeIdentity:${identityId}` `` へ直す（SYNC-224(c)）。実装 `application/identity/removeIdentity.ts:20-30` の JSDoc は「Composed rather than hashed (**the spec writes** `sha256("removeIdentity:" + identityId)`)」と **spec を名指しで否定**している。`removeIdentity` は Issue #2 で実装済みなので「未実装で裏づけが取れない」除外に当たらない。理由は上と同じ 1 句（固定 prefix ＋ `:` を含まない ID なので合成で決定性と識別性が得られる。不可逆性は要らない — [ADR 048](../adr/048-uniqueness-reservation-operation-id.md)）
       - `.thread/2/progress.md` の該当箇条は 2 つの ID を 1 箇条で挙げていた（sub-operation ID と `removeIdentity` の operationId）が、台帳は前者だけを SYNC-224 として採番していた。**AC-46 の `grep -rn "sha256(parentOperationId" spec/` は前者しか見ないので、`:524` の残置は最終確認をすり抜ける** — AC-67 の `grep -rn 'sha256("removeIdentity' spec/` を別に持つ
  9. **（統合分・deleteAccount 周辺）** — 台帳 SYNC-229(:669) / SYNC-231(a)。
     - `:663` の `distributed_operations(… state: "preparing")` と `:675` の「operation を `committing` へ進め」を、**`distributed_operations.state` は `running` / `completed` / `rejected` の 3 値**、**`preparing` / `committing` は account deletion manifest header の state**、と書き分ける（SYNC-231(a)。adr.md ADR-015）。`spec/database/index.md:154` の header state 列挙と語をそろえる
     - `:669` 付近（4. で触る rollback 手順と**同じ段落**）で、finalize の必須 receipt 集合が**宣言集合**であること（enum 全体でも 5 receipt 固定でもない）を書く（SYNC-229）。ステップ 3-7 と同じ内容なので、**先に 3 を書いてから同じ語彙で写すこと**
- **注意:** この節は 16 項目が 1 ファイルに集中する。**節ごとに 1 回ずつ通す**（`:27` uniqueness → OAuth 3 節 → verifyEmail / signIn → password 系 → profile 新設 → deleteAccount）。行を往復しない
- **注意:** 7. の 3 節は `spec/inventory/usecase.md` に**新規行を採番する**（`UC-identity-022`〜`024`。ステップ 31、adr.md ADR-011）
- **理由:** DTO 表と手順が互いに矛盾している箇所（出力 DTO 表 vs 手順 3）と、実装・適合スイートと食い違う箇所を、実装側の解釈で統一する。ただし 4. は「ポート述語の判定対象」だけが実装側に正本を持ち、「User を active へ戻す順序」は実装が未配線（`beginRollback` / `allRollbackReleased` / `abortPersonalAccountDeletion` を呼ぶ application コードはゼロ）なので spec が正本のまま残る

### 5. `spec/scenario/account.md` — AC-01 / AC-02 の 2 項目

- **対象ファイル:** `spec/scenario/account.md`
- **台帳 ID:** SYNC-01, SYNC-02
- **変更内容:**
  1. `:24`（AC-01 異常系）— 「確認前に再度サインアップを試みた場合は、確認メールを再送する」を削除し、`:22` の既存アカウント通知メールへ統一する（同一分岐に 2 つの結末が書かれている自己矛盾の解消）。確認メールの再送は `resendVerificationEmail`（P-02 / P-03 の再送導線）が担うことを明示する（SYNC-01）
  2. `:16`（AC-01 基本フロー #5）— 「サインイン状態でノート一覧に着地する」に**同一ブラウザー条件**を付す（確認を要求したブラウザーで開いた場合。ADR 029 の束縛）（SYNC-02）
  3. `:36`（AC-02 基本フロー #2）— 同上（SYNC-02）
  4. `:40-44`（AC-02 異常系）— 2 行追加（SYNC-02）
     - 別の端末・ブラウザーで確認リンクを開いた場合は、メール確認は成立するがサインイン状態にはならず、サインインへの導線を出す
     - 一時的な障害で確認を完了できなかった場合は、その旨と再試行の導線を出す
- **注意:** ここで足す 2 つの異常系に対する `spec/manual-tests/account.md` の追随は**ステップ 18 で決着させる**（同一ファイルの編集を 1 ステップに束ねる方針のため、ここでは触らない）
- **理由:** `spec/adr/029-verification-session-binding.md:22,48-49` が既に決定と縮退の受容を書いており、シナリオだけが未追随。実装の状態直和は `apps/web/app/components/auth/VerifyEmailPanel/index.tsx:31-38` の 7 つ

### 6. `spec/pages/index.md` — P-03 の状態直和と P-40 の状態行 ＋ P-25 の認証例外

- **対象ファイル:** `spec/pages/index.md`
- **台帳 ID:** SYNC-02, SYNC-26, **SYNC-235**（統合分）
- **変更内容:**
  1. **P-03（メール確認）** の `**状態**` 行（`:176` 付近）を、実装の 7 状態の直和に書き換える（SYNC-02）。
     `**状態**: 処理中 / 成功（アプリへ遷移）/ 確認済み・サインインが必要（サインインへ）/ 使用済み（サインインへ）/ 期限切れ（再送）/ 無効（再送）/ 一時障害（再試行）`
     「確認済み・サインインが必要」が出る条件（確認を要求したブラウザーでない）を「機能」節に 1 行添える
  2. **P-40（トップ）** の `**状態**: 通常 / サインイン済み（アプリへの導線を表示）`（`:571` 付近）を `**状態**: 通常 のみ（サインイン済みはノート一覧へリダイレクトするため P-40 に到達しない）` 相当へ書き換える（SYNC-26）。
     - 同ファイルの URL 表が既に `| /` | トップ（未サインイン）/ ノート一覧へのリダイレクト（サインイン済み） |` と書いており、**spec 内部で矛盾している**。実装（`apps/web/app/routes/index.tsx` の `beforeLoad` がサインイン済みを `/notes` へ redirect）は URL 表と一致する
     - あわせて「機能」節の「サインアップ / サインインへの導線」が未サインイン限定であることが読めるようにする
  3. **（統合分）** **P-25（`/settings/danger`）** の `**状態**` 行と目的節に、**この 1 画面だけが認証ガードの明示的な例外**であることを書く（SYNC-235）。「受理と同時にセッションが消えるため、認証ガードを掛けると進捗を読む画面自体へ到達できない。読み取り権限は削除 status ticket が持ち、`getAccountDeletionStatus` は ticket が名指す 1 件しか返さない。セッションが無い状態では他の導線を描かない」（[ADR 047](../adr/047-deletion-status-ticket.md)）。`deleteAccountFn` 自体は `requireSession()` を通すことも 1 句で区別する
     - **P-25 の「機能」行の『削除されるもの / されないもの』の説明は触らない**。実装は宣言済み participant（`storage` / `usage`）に合わせて文言を狭めているが、これは**縮退**であって spec が正（SYNC-237 = スコープ外。plan.md の Phase 5 一覧 7）。狭める方向の編集をしないこと
- **注意:** **L-02 は触らない**。L-02 の「サインイン済みで訪れた場合はアプリへ戻る導線を表示」と `**状態**: 通常 / サインイン済み`（`:98` `:103` 付近）は、`/terms` `/privacy` で到達する**実装が落とした要件**であり、spec が正の側。SYNC-24 としてスコープ外（plan.md / adr.md ADR-006）
- **理由:** (1) 実装は `verifiedSignInRequired` と `failed` を返すのに、spec の直和が 5 状態のままだと P-03 を実装し直す人が 2 状態を落とす。(2) は spec 内部の自己矛盾（SYNC-01 / SYNC-12 と同型）で、実装変更を伴わずに閉じられる（adr.md ADR-009）

### 7. `spec/presentation/index.md` と `spec/testcases/identity/signUpWithPassword.md`

- **対象ファイル:** `spec/presentation/index.md`, `spec/testcases/identity/signUpWithPassword.md`
- **台帳 ID:** SYNC-10, SYNC-17, SYNC-20, **SYNC-234, SYNC-226（波及）**（統合分）
- **変更内容:**
  1. `## CSRF` → `### 規約` 表の 2 行目（`:124` 付近）— 「**`FormData` を受けるサーバー関数を作る場合は** `Origin` ヘッダーの検証を必須とする」を無条件化する。「**すべての server function 呼び出しに同一オリジン検証を強制する**（要求ミドルウェア `createCsrfMiddleware`）」とし、理由欄に「フレームワークが全 server function に対して `multipart/form-data` / `application/x-www-form-urlencoded`（どちらも CORS safelisted）の経路を常に開けているため、条件は常に成立する」を書く（SYNC-10）
  2. `### その他のヘッダー` の表（`:177-180` 付近）— `| Cache-Control | private, no-store | Cookie 認証で利用者固有になる応答に freshness 指示が無いと、前段のキャッシュが他人の応答を配りうる |` の行を追加する（SYNC-17）。
     - あわせて `## 公開ページのセキュリティヘッダー` → `### 対象` 段落に**理由を 1 文追加する**。現行の段落は既定を敷く理由を「**本文由来**の危険を抑える指令だから」とだけ説明しており、`Cache-Control: private, no-store` は本文由来ではなく **Cookie 認証由来**なのでこの理由文では覆えない。「Cookie 認証で利用者固有になる応答をキャッシュに配らせない指令も、同じくサービス全体の既定として敷く」相当の 1 文を足す（語尾の整合だけでは足りない）
     - 公開ノートだけ緩める方針は公開閲覧スライスで確定する旨を 1 文添える
  3. Cookie 属性表の「寿命」行（`:44` 付近、`Session.expiresAt` に一致させる）— 理由欄に「View は `expiresAt` を返さないため、転送境界が同じドメイン定数（`Session.ttlMs`）から同値を再導出する（[ADR 055](../adr/055-session-expiry-derivation.md)）」を 1 句足す。ステップ 4-3 を usecases 側だけに書くと「一致させる対象が DTO に無い」という疑問が presentation 側で解けない（SYNC-13 / adr.md ADR-007）
  4. `spec/testcases/identity/signUpWithPassword.md` の TC-identity-261 行（`:19` 付近）— 期待結果を「**両方の応答 shape が同一（`emailVerificationRequired: true` / セッションなし）で、返る decoy id は別値。利用者はちょうど 1 人**。一意性違反は `IdentityUniqueDirectory` のポート契約として送出されるが、ユースケースが畳む」に書き換える。操作欄の「両方が登録する」も実態（同時に 2 要求を出す）に合わせる。4 列目（`実装ステータス`）は空のまま（SYNC-20）
  5. **（統合分）** `AppConfig` の鍵の表（`:83-86`。SharePass / ExportTicket / `SecretCipher` / `ShareTokenProtector` の 4 行）と `:23`（「秘密と鍵は本文書の `AppConfig` に置く」）に、**削除 status ticket の署名鍵だけは `AppConfig` に載せない**という例外を書く（SYNC-234）。「チケットの発行と検証は presentation が担うが、**鍵は composition root が供給する**。SSR メタデータを運ぶ設定の器に秘密を混ぜず、presentation が環境変数を直読みもしない。未設定ならプロセス毎のランダム鍵へ落とす配備もありうる」（[ADR 047](../adr/047-deletion-status-ticket.md) の決定 1。実装は `application/di/serverNode.ts:22,72-77,175` の `DELETION_TICKET_KEY`）。**表に 5 行目を足すのではなく、一般則に対する但し書きとして書く**（表に足すと「`AppConfig` に載る鍵」の一覧という表の意味が壊れる）
  6. **（統合分）** エラー → HTTP ステータスの対応表に `ConflictError("PROVIDER_ACCOUNT_RELEASE_PENDING")` を足す（SYNC-226 の波及。ステップ 4-5 と同じコード）。既存の `PROVIDER_ACCOUNT_ALREADY_LINKED` 行と同じステータス（409）に置く
- **理由:** (1) は `spec/adr/029` の前提（`:13-15`）が既に無条件版で書かれており、presentation だけが条件付き。(2) は実装 `apps/web/app/server.node.ts:72` が既定として持っている（理由は `:63-68` のコメント）。(4) は `spec/adr/028:20` が「一意性はポート、列挙耐性はユースケース」と決めている

### 8. コード側の契約 JSDoc とコメント（統合で 8 ファイル → レビュー R1 の修正込みで 26 ファイル）

- **対象ファイル（計画分 8）:** `packages/core/src/application/ports/shareTokenProtector.ts`, `packages/core/src/domain/identity/ports/identityRepository.ts`, `packages/core/src/application/ports/accountDeletionManifestStore.ts`, `packages/core/src/domain/identity/errorCode.ts`, `apps/web/app/start.ts`, **`packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`**, **`packages/core/src/domain/storage/errorCode.ts`**, **`packages/core/src/application/di/containerStore.ts`**
- **対象ファイル（レビュー R1 の修正で追加。`review/triage.md` の U7 / U8 / U9。変更内容 9〜11 に対応）:** `packages/core/src/application/identity/{uniqueness,removeIdentity,view,completeOAuthCallback}.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `apps/web/app/presentation/{session,oauthStateCookie}.ts`, `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`（U7 の 8 本）／`packages/core/src/adapters/conformance/{accountDeletionManifestStore,identityUniqueDirectory,noteProjection,objectStorage,authTokenRepository,signInOAuthClient}.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`（U8 の 7 本。8 本目の `conformance/scopeCleanupAdmissionStore.ts` はステップ 30 と重複）／（削除）`apps/web/.dev.vars.example`, `apps/web/.env.aws.example`, `apps/web/.env.gcp.example`, （`packages/` `apps/` 外）`.dockerignore` の 2 行（U9）
- **台帳 ID:** SYNC-11, SYNC-15（= SYNC-225）, SYNC-14, SYNC-03, SYNC-10, **SYNC-207, SYNC-211, SYNC-244**（統合分）, **台帳外 1 件**（ステップ 14 で発見。adr.md ADR-024）, **レビュー R1 の M-02 / M-11 / M-12 / M-23 / M-31 / M-42 / M-46**（台帳外。`review/triage.md`）
- **変更内容:**
  1. `shareTokenProtector.ts:11-12` — `Error contract: SystemError(ExternalServiceError)` を `SystemError(DataIntegrityError)` に直す。`ExternalServiceError` は `packages/core/src/application/errors.ts:180-185` の `SystemErrorCode` に存在せず、実装（`adapters/memory/shareTokenProtector.ts:32-36,68-72,79-84`）は `DataIntegrityError` を投げる（SYNC-11）
  2. `identityRepository.ts:6-8` — error contract から `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` を落とし、「provider account の一意性は `IdentityUniqueDirectory` が担保する」旨に置き換える（SYNC-15 / adr.md ADR-005）
  3. `accountDeletionManifestStore.ts:95-98` — 現行の「the full set of item acks plus the personal/global receipt set is the source of truth for finalize / rollback (`allRequiredAcknowledged` / `allRollbackReleased`)」は **spec と同じ側の記述で、実装・適合スイートと食い違っている**。ステップ 3 で `spec/domains/index.md` に書くのと同じ内容へ是正する（finalize = item の完全 ack ＋ 宣言 receipt / rollback = membership item の release ack のみ / membership item の完全 ack は cleanup ack を含む）（SYNC-14 / adr.md ADR-004）
  4. `domain/identity/errorCode.ts:1-5` — 冒頭コメントを**全文削除する**（SYNC-03 ＋ SYNC-244）。ステップ 2-1 で `IdentityLimitExceeded` / `InvalidAvatarUrl` / `AccountDeletionRetryLimitExceeded` の 3 つとも spec の union に足すので、「spec の記載漏れとして扱った」という記述は 1 文も真でなくなる。**AC-27 の「`InvalidAvatarUrl` に関する記述は残す」は統合により失効**し、AC-58 が上書きする（plan.md の AC 表）
  5. `start.ts:10` — 「which is what AC-15 requires an `Origin` check for」の `AC-15` を `spec/presentation/index.md` の CSRF 規約への参照に差し替える。AC-15 は `.thread/1/plan.md` の受け入れ基準 ID で、計画凍結時に消えると dangling 参照になる（SYNC-10）
  6. **（統合分）** `application/ports/scopeCleanupAdmissionStore.ts:36-38` — `assertOwner` の JSDoc「a different id, a missing receipt, or an uncommitted one is rejected」に **`completed` を加える**（SYNC-207）。ステップ 3-6 の spec 本文・ステップ 30 の適合ケースと同じ主張にそろえる。実装（`adapters/memory/repositories/scopeCleanupAdmissionStore.ts:47-57` の `requireOwner` が `row.status !== "running"` を弾く）は既にこの振る舞いを持つ
  7. **（統合分）** `domain/storage/errorCode.ts:1-2` — 冒頭コメント（「`InvalidChecksum` is missing from the enum in spec/domains/storage.md … treated as a spec omission」）を**全文削除する**（SYNC-211）。ステップ 22 で spec の union に足すため
  8. **（台帳外・ステップ 14 で発見）** `application/di/containerStore.ts:29-48` — JSDoc とエラーメッセージが**実在しない** `apps/web/app/server.cloudflare.ts` を名指ししている。実在する唯一のランタイムエントリ `apps/web/app/server.node.ts`（`installContainerStore` の呼び出し元はここだけ）を指すように直し、「両ランタイムで共有」という前提の 1 句も現状（[ADR 025](../adr/025-single-reference-runtime.md) の単一参照ランタイム）に合わせる。**文言のみ**で、投げる条件も型も変えない（adr.md ADR-024）
  9. **（レビュー R1 / U7）** 実装 JSDoc から**正典を名指しで否定する記述**を落とす（M-02 / M-31 / M-23。adr.md ADR-030）— `identity/{uniqueness,removeIdentity}.ts` の「the spec writes `sha256(...)`」を [ADR 048](../adr/048-uniqueness-reservation-operation-id.md) 参照へ、`identity/view.ts` の「the spec's output table types it as non-null」を削除、`identity/completeOAuthCallback.ts` の `provider` を「display / logging only」から state 照合の入力へ、`domain/identity/ports/identityUniqueDirectory.ts` の `reserve` の conflict 条件を実装の判定材料（`operationId`）へ。あわせて presentation 側の dangling ADR 参照 4 か所（`session.ts` / `oauthStateCookie.ts` ×2 / `DeleteAccountPanel/ticketStorage.ts`）を `spec/adr/` の実在番号へ（M-42。`start.ts` の `AC-15` と同型）
  10. **（レビュー R1 / U8）** 適合スイート 6 本と単体テスト 1 本の `describe` / `it` 名・ヘッダーコメントを、ステップ 10 / 31 で採番した ADP / TC ID にそろえる（M-11 / M-12。adr.md ADR-029）。**文字列だけを変更し、アサーションとセットアップには触らない**
  11. **（レビュー R1 / U9）** 他ランタイム用の設定テンプレート 3 本（`apps/web/.dev.vars.example` / `.env.aws.example` / `.env.gcp.example`）を**削除**し、`.dockerignore` から `**/.wrangler` / `infra/aws/cdk.out` の 2 行を落とす（M-46）。[ADR 025](../adr/025-single-reference-runtime.md) の「1 つを選んで他は消す」に対して現物が残っていた分で、これらを読むコードは 0 件
- **注意:** **振る舞いは 1 行も変えない**。他ポートの JSDoc に残る `ExternalServiceError`（`mailSender.ts` / `pdfRenderer.ts` / `htmlProcessor.ts` / `noteExportComposer.ts` / `secureTokenGenerator.ts` / `passwordHasher.ts`）は触らない（plan.md の SYNC-27）
- **理由:** `spec/adr/026` の決定 1「JSDoc だけを読んで実装したものがスイートを通る」が、実在しないエラーコード名・実態と異なる担保箇所・spec と同じ側に残った rollback 判定の記述によって成立していない。特に 3. を放置すると、Issue #11 の D1 実装者が JSDoc どおり receipt を見る `allRollbackReleased` を書いて適合スイートで落ちる

### 9. `spec/inventory/domain.md` — 本文修正への追随

- **対象ファイル:** `spec/inventory/domain.md`
- **台帳 ID:** SYNC-03, SYNC-07, SYNC-15, SYNC-16, SYNC-22 の波及 ＋ **SYNC-201, 202, 203, 204, 205, 206, 208, 209, 210, 211, 240, 244 の波及**（統合分）
- **変更内容:** ステップ 1〜4 で本文を直した要素の「実装されるべき振る舞いの要点」欄を追随させる。**編集対象は ID で特定する**（括弧内の行番号は計画時点のスナップショット）。
  - `DOM-identity-019`（`IdentityPolicy`、`:65`）— 上限超過が `IdentityLimitExceeded` になること
  - `DOM-identity-026`（`UserBatchReader.resolveMany`、`:72`）— 100 件超過は `SystemError(DatabaseError)`
  - `DOM-identity-027`〜`030`（`IdentityUniqueDirectory.*`、`:73-76`）— provider account の一意性を担保する唯一の場所であること
  - `DOM-identity-031`〜`035`（`IdentityRepository.*`、`:77-81`）— provider account の一意性検査を持たないこと
  - `DOM-note-003`（`NoteTitle`、`:237`）— 現行の要点は「**200 文字以内へ正規化し** auto・manual origin を保持する」で、SYNC-25 の本文修正（200 文字超は `BusinessRuleError(InvalidTitle)` で拒否し、切り詰めない）と食い違う。「200 文字を超えたら `InvalidTitle` で拒否し、空なら `"無題"` に置換して auto・manual origin を保持する（文字数は UTF-16 コード単位）」相当へ**書き換える**
  - `DOM-note-006`（`Excerpt`、`:240`）/ `DOM-note-007`（`NoteHeading`、`:241`）— 文字数が UTF-16 コード単位であること。**`:242` は無関係な `DOM-note-008 StyleMode` なので触らない**
  - `DOM-note-031`（`NoteRepository.listByOwner`、`:265`）— 順序 `updatedAt DESC, id DESC`
  - `DOM-note-052`（`NoteRouteStore.resolveMany`、`:286`）— 500 件超過は `SystemError(DatabaseError)`
  - `DOM-note-062` / `DOM-note-063`（fan-out、`:296` `:297`）— 列挙 state
  - `DOM-note-064` / `DOM-note-065`（`ShareTokenProtector.*`、`:298` `:299`）— 失敗は `SystemError(DataIntegrityError)`
  - **（統合分）既存行の要点更新**
    - `DOM-identity-019`（`IdentityPolicy`）— SYNC-244 で union に足した 2 コードのうち `AccountDeletionRetryLimitExceeded` の位置づけ（`AccountDeletionRetryPolicy` 側の判定）を要点が誤って含んでいないか確認する。含んでいなければ触らない
    - `DOM-storage-032`〜`035`（`ObjectStorage.*`）— `put` / `get` がバイト列専用であること、`createDownloadUrl` の行は**残す**こと（未実装であってスコープ外）
    - `DOM-storage-006`（`Checksum`）— 違反は `BusinessRuleError(InvalidChecksum)`
    - `DOM-storage-012`（`UploadValidationPolicy`）— 引数は `{ purpose, body }`、戻り値は判定済みの `{ mimeType, size }`。MIME は先頭バイトの署名で決める
    - `DOM-usage-006`（`StorageQuota` エンティティ）— `replaceTotals` によるスキャン結果の上書きを要点に含める（**新規行は作らない**。エンティティは 1 行で全振る舞いを畳む単位）
  - **（統合分）新規行の採番**（各群の**末尾**に追加。既存 ID を繰り下げない — adr.md ADR-011）
    - `DOM-common-041` `ScopeCleanupAdmissionStore.describePersonalCleanup` / `DOM-common-042` `AccountDeletionManifestStore.describe`
    - `DOM-identity-060` `AuthTokenRepository.findPendingByUserAndPurpose` / `DOM-identity-061` `SignInOAuthClient.deriveCodeChallenge` / `DOM-identity-062` `IdentityUniqueDirectory.beginRelease`
    - `DOM-note-071` `LocalNoteProjectionWriter.redactAuthor` / `DOM-note-072` `PublicNoteProjectionWriter.redactAuthor`
    - `DOM-storage-038` `ObjectStorage.publicUrl`
  - ヘッダーの「最終同期」日付を更新
- **注意:** **適合ケースには新規 DOM 行を採番しない**（adr.md ADR-002）が、**新規ポートメソッドには採番する**（adr.md ADR-011）。2 つの規則を取り違えないこと
- **注意:** 採番前に `grep -o "DOM-[a-z]*-[0-9]*" spec/inventory/domain.md | sort -u | tail` で各群の最大値を再確認する（計画時点では common 040 / identity 059 / note 070 / storage 037）
- **理由:** inventory は本文からの生成物なので、本文だけ直すと台帳が古い契約を指し続ける

### 10. `spec/inventory/adapter.md` — 適合ケースの反映（採番しない）＋ 新規ポートメソッドの採番

- **対象ファイル:** `spec/inventory/adapter.md`
- **台帳 ID:** SYNC-09, SYNC-07, SYNC-16, SYNC-11 の波及 ＋ **SYNC-201, 202, 203, 205, 206, 207, 208, 209, 210 の波及**（統合分）
- **変更内容:** 既存行の「要点」欄を厚くする。**適合ケースには新規 ADP ID を採番しない**（adr.md ADR-002）が、**統合分の新規ポートメソッド 8 本には採番する**（adr.md ADR-011。下記「新規行の採番」）。**編集対象は ID で特定する**（括弧内の行番号は計画時点のスナップショット）。
  - `ADP-note-015`（`NoteRepository.listByOwner`、`:192`）— `updatedAt DESC, id DESC` の全順序でページングすること
  - `ADP-note-021`（`LocalNoteQueryService.search`、`:198`）— `highlightedExcerpt` が投影のマークアップをエスケープすること。**この 1 本は本文修正を伴わない**（契約本文は `spec/domains/note.md` の「`excerpt` と `highlightedExcerpt` の描画契約は正反対である」節に既述）。要点欄の追随だけで ADR-002 の決定 1 を満たす
  - `ADP-note-036`（`NoteRouteStore.resolveMany`、`:213`）— 500 件超過は `SystemError(DatabaseError)`
  - `ADP-note-046` / `ADP-note-047`（fan-out、`:223` `:224`）— `active` / `moving` / `purging` を列挙し `reserved` のみ除外すること
  - `ADP-note-048` / `ADP-note-049`（`ShareTokenProtector.*`、`:225` `:226`）— 失敗は `SystemError(DataIntegrityError)`
  - `ADP-common-012`（`AccountDeletionManifestStore.begin`、`:18`）— 再投入が記録済みのものを保つこと。**これも本文修正を伴わない**（現行の要点「冪等に開始する」に replayed begin の主張を足す）
  - `ADP-common-017` / `ADP-common-019` / `ADP-common-021`（`:23` `:25` `:27`）— membership item は cleanup レーンが走って初めて完全 ack になり、`allRequiredAcknowledged` は prepare ack ＋ 宣言 receipt だけでは true にならないこと（横断的な振る舞いなので、契約本文はステップ 3 で `spec/domains/index.md` 側に書き、ここは要点の追随にとどめる）
  - **（統合分）既存行の要点更新**
    - `ADP-common-008`（`assertOwner`）— 別 ID・欠落・未 commit に加えて **completed した barrier も拒否する**（ステップ 30 の適合ケースと対応させる）
    - `ADP-common-025`（`pruneTerminal`）— 戻り値が回収した `operationIds` であること（件数ではない）
    - `ADP-storage-018`〜`021`（`ObjectStorage.*`）— バイト列専用化。`createDownloadUrl` の行は残す
  - **（統合分）新規行の採番**（各群の**末尾**に追加。ステップ 9 の DOM 行と 1 対 1 — adr.md ADR-011）
    - `ADP-common-040` `describePersonalCleanup` / `ADP-common-041` `describe`
    - `ADP-identity-039` `findPendingByUserAndPurpose` / `ADP-identity-040` `deriveCodeChallenge` / `ADP-identity-041` `beginRelease`
    - `ADP-note-055` / `ADP-note-056` `redactAuthor` × 2 / `ADP-storage-024` `publicUrl`
  - **ヘッダーに生成規則を 1 行足す** — 「**1 行 = 1 ポートメソッド**。適合スイートのケースは行にせず、`describe` 名に ADP ID を含める命名規約で追う。**新規ポートメソッドには通常どおり採番し、各群の末尾に足す（ID は行位置ではない）**（[ADR 052](../adr/052-adapter-inventory-granularity.md)）」。この不変はどの spec ファイルにも明文化されておらず、次の spec-sync で必ず再燃する
  - ヘッダーの「最終同期」日付を更新
- **理由:** ラウンド4（`faab0f2`、2026-08-10）で追加した適合ケースが、最終同期 2026-08-09 の台帳に未反映のまま

### 11. `spec/inventory/test.md` — TC-identity-261 の追随

- **対象ファイル:** `spec/inventory/test.md`
- **台帳 ID:** SYNC-20 の波及 ＋ **SYNC-223, SYNC-227 の波及**（統合分）
- **変更内容:** `TC-identity-261` の行（`:400` 付近）の期待結果を、ステップ 7-4 の testcases 本文と同じ文面に更新する。操作欄の「両方が登録する」も同様に合わせる。
  - **（統合分）** `TC-identity-268` の行 — 期待結果のコード名を `BusinessRuleError(InvalidProviderAccount)` に直す（ステップ 27 と同じ文面）
  - **（統合分）** `TC-storage-043` の行（`:1721` 付近）— 期待結果から**文の数を落とし**、ステップ 28 と同じ観測可能な性質（列挙 1 回 / 削除できたファイル 1 件につき `storage.fileDeleted` 1 件 / どちらも件数に比例した追加の往復を要求しない）に書き換える。**要素欄の「発行するクエリ数を確認する」も同時に直す**（ステップ 28 で操作欄を書き換えた文面の写し。計画レビュー R2 arch:S-004 — 期待結果から文数を外したのにケース名が「クエリ数を確認する」のままだと中途半端で、読み手が platform 側の設計目標を探しに行くことになる）
  - **（計画レビュー R2 arch:P-001 / coverage:S-001）新規 TC 行の採番** — **identity 群の末尾**（現在の最大 `TC-identity-304` の次、`TC-identity-305` から）に足す。**ファイル名の辞書順の位置に挿入しない**（adr.md ADR-016）
    - ステップ 32 で新設した 3 ファイル（`getProfile.md` / `checkHandleAvailability.md` / `completeOAuthCallback.md`）の各行
    - ステップ 32 で `requestPasswordReset.md` に足した発行間隔の境界 2 行
    - **採番前に `grep -oE "TC-identity-[0-9]+" spec/inventory/test.md | sort -u | tail -1` で最大値を再確認する**（計画時点では **304**。`grep -c "^| TC-identity-" spec/inventory/test.md` も **304** で、identity 群は 001〜304 が連番で埋まっているので `305` 起点は穴を空けない）
  - **ヘッダーに TC 採番規則の 1 行を足す**（計画レビュー R3 arch:S-001）— 「**1 行 = 1 テストケース**。`spec/testcases/*/*.md` の表に TC ID は書かれておらず、ID は本ファイルの行が持つ。**新規テストケースには各ドメイン群の末尾に採番し、ファイル名の辞書順の位置に挿入しない（ID は行位置ではない）**（[ADR 052](../adr/052-adapter-inventory-granularity.md)）」。**ステップ 10 が `spec/inventory/adapter.md` のヘッダーに同趣旨の 1 行を足すのと対にする** — 本 Issue は「辞書順の位置に挿入しない」という不変を TC に対して**初めて破る**側なのに、実測すると `spec/inventory/test.md` のヘッダーは `生成元: spec/testcases/（最終同期: 2026-08-09）` の 1 行だけで並び方の記述が無く、ADR-016 の決定は `spec/adr/052` の本文からしか辿れない。次に testcase を足す人が辞書順へ挿入して既存 ID を繰り下げうる
  - ヘッダーの「最終同期」日付を更新
- **注意:** `TC-identity-174`（`:313` 付近）は**触らない**（SYNC-21 は既に整合）。`TC-identity-255`（`:394` 付近）も既に正しい
- **注意:** **既存 TC ID を 1 つも繰り下げない。** `spec/testcases/*/*.md` の表に TC ID は書かれておらず、TC ID は本ファイルの**行位置**だけで決まる（実測: identity 群は `addPasswordIdentity`=001 → `authenticateSession`=008 → `changePassword`=017 → `completeOAuthSignIn`=024 → … とファイル名の辞書順）。新設 3 ファイルを辞書順に挿入すると `TC-identity-024` 以降 280 行超が別の要素を指すことになり、AC-55 と衝突する
- **注意:** このステップは**ステップ 32 の後**に実行する（採番対象の行が確定していないと末尾採番できない）
- **理由:** 台帳と本文が別々の期待結果を持つと、実装者がどちらを見たかで結果が変わる

### 12. `spec/inventory/frontend.md` — P-03 / P-40 の状態とヘッダー

- **対象ファイル:** `spec/inventory/frontend.md`
- **台帳 ID:** SYNC-02, SYNC-17, SYNC-26 の波及 ＋ **SYNC-235, SYNC-238 の波及**（統合分）
- **変更内容:** **編集対象は ID で特定する**（括弧内の行番号は計画時点のスナップショット）。
  - `PAGE-p03-001`（`:17`）— 「token 処理中、成功、期限切れ、使用済み、無効を表示し」に「確認済み・サインインが必要」と「一時障害（再試行）」を足す
  - `PAGE-p03-002`（`:18`）— 「成功・既確認・期限切れ・無効に応じて状態を切り替える」に同 2 状態を足す
  - `PAGE-p40-001`（`:143`）— 「sign-in 済みには app への導線を出す」を、ステップ 6-2 の P-40 状態行と同じ解釈（サインイン済みはノート一覧へリダイレクトするので P-40 には到達しない）へ書き換える（SYNC-26）
  - `PAGE-p40-004`（`:146`、「アプリへ戻る」）— 同上。**行を削除せず**、リダイレクトが導線の役割を担うことが読める要点に書き換える
  - `PAGE-p47-001`（`:168`）— セキュリティヘッダーの列挙に `Cache-Control: private, no-store` を足す
  - **（統合分）** `PAGE-p21-001` / `PAGE-p21-002`（`:99` `:100` 付近）— 初期表示の供給元が `getProfile`、ハンドル重複候補の供給元が `checkHandleAvailability` であることを要点に含める（SYNC-238）
  - **（統合分）** `PAGE-p25-001` / `PAGE-p25-003`（`:119` `:121` 付近）— この画面が認証ガードの例外で、読み取り権限は status ticket が持つことを要点に含める（SYNC-235。ステップ 6-3 と同じ解釈）。**`PAGE-p25` の participant 文言は狭めない**（SYNC-237 はスコープ外）
  - **（統合分）** `PAGE-p04-003` / `PAGE-p04-004` は**触らない**。TC-26 の手順ずれ（SYNC-241）はこの PAGE 行が正本の側で、既に正しい
  - ヘッダーの「最終同期」日付を更新
- **注意:** L-02 に対応する行は台帳に存在しない。**新規行を作らない**（SYNC-24 はスコープ外）
- **注意:** `PAGE-p12-006` / `PAGE-p13-004` / `PAGE-p21-003` / `PAGE-p31-004`（`:68` `:74` `:101` `:128` 付近）の「file を FormData で送る場合は Origin を必須検証し」「Origin 検証済み FormData で」という条件付きの言い回しは、SYNC-10 の無条件化後も**内容として真**（Origin は実際に検証される）。**触らない**。次のレビューで同じ論点が再燃しないよう、この判断をここに残す

### 13. `CLAUDE.md` の全面改訂

- **対象ファイル:** `CLAUDE.md`（`AGENTS.md` はこのファイルへのシンボリックリンクなので実体だけ直す）
- **台帳 ID:** SYNC-18
- **変更内容:** research.md の乖離表（節ごと）を潰す。
  - **Workspace layout** — `infra/aws` / `infra/cloudflare/pulumi` / `infra/gcp` の 3 項目を削除。`apps/web` の説明から wrangler / drizzle / Dockerfile を落とし、実在する `vite.config.node.ts` に直す。`pnpm-workspace.yaml` の packages は `apps/*` と `packages/*` の 2 つであることを書く
  - **Development Commands** — `dev:node` / `build:node` / `start:node` を足す
  - **Architecture / Layers** — `packages/core/src/` の実構成を反映する。domain の 8 ドメイン（`common` `conversion` `identity` `job` `note` `storage` `usage` `workspace`）、application の `cleanup/` `execution/` `workers/` `scope.ts`、adapters の `memory/` `node/` `oauth/` `conformance/`、層外の `lib/error.ts` と `config.ts`
  - **Frontend** — todo 参照実装の記述（`components/todo/` / `routes/todo/` / `TodoBoard`）を現行（`routes/notes/index.tsx`、`components/note/*`、`components/settings/IdentityList/board.tsx`）に差し替える。`ui/Skeleton` と `router.tsx` の pending 設定はそのまま
    - **対比の両側を名指しする。** この節の中核は「**in-item mutation は leaf が所有、list-membership change は親（クライアント島）が所有**」という対比なので、片側（list-membership = `components/settings/IdentityList/board.tsx`）だけでなく、**leaf 所有側の実例 `apps/web/app/components/settings/ProfileForm/editor.tsx`（avatar の item-local `useOptimistic`）も挙げる**
  - **Key concepts** — UoW を二面（`GlobalUnitOfWorkProvider.run(fn)` / `ScopeUnitOfWorkProvider.run(scope, fn)`、ADR-023、ネスト禁止）に直す。outbox に「継続要求も運ぶ（ADR-040/041）」「`maxAttempts` 超過は quarantine」を足す。retry に「ユースケース個別のリトライは可（`createBlankNote.ts:103-105`）」の但し書きを足す。Input validation の `serverAction` の `inputValidator` を実態（`createServerFn(...).middleware([errorResponseMiddleware]).validator(validateInput(schema))` を呼び出し箇所にインライン宣言、`presentation/serverAction.ts` の export は `loadServerDeps` / `serverData` の 2 つ）に直す
  - **Reference runtimes** — 4 ランタイムの節を「参照ランタイムは Node ＋ in-memory の 1 つ（ADR-025）」に置き換える。実在するエントリ（`apps/web/app/server.node.ts` / `apps/web/app/worker/node/runner.ts` / `apps/web/scripts/listen.node.ts` / `packages/core/src/application/di/{memoryRuntime,serverNode}.ts` / `docs/runtime_node.md`）だけを列挙する。Cloudflare（D1 / DO / R2 / Queues）が最終ターゲットであることは残す
  - **新設** — `spec/` が設計の正典であること（`spec/index.md` と `spec/adr/index.md` を入口として挙げる）、`packages/core/src/adapters/conformance/` がポート契約の実行形であること（ADR-026）、`apps/web/app/presentation/` の主要ファイル（`serverFragment.tsx` / `session.ts` / `errorResponseMiddleware.ts` / `validator.ts` / `serverAction.ts`）と `apps/web/app/start.ts` の CSRF ミドルウェア、`docs/test.md` の存在
- **理由:** コーディングエージェントが最初に読むファイルが、存在しないディレクトリ・存在しないエントリ・存在しない API を指している

### 14. `docs/backend_implementation_example.md` の書き直し

- **対象ファイル:** `docs/backend_implementation_example.md`
- **台帳 ID:** SYNC-19（backend）
- **変更内容:** adr.md ADR-003 の決定に従う。
  - File Layout（L7-64）を現行構成へ再執筆（`packages/core/src/{domain,application,adapters,lib}/`、`apps/web/app/presentation/`、`application/errors.ts`）
  - `## Adapter Layer`（L351-394）を D1 + Drizzle + PendingBatch + `_occ_guard` から `adapters/memory/`（undo ログによるトランザクション — ADR-024）＋ `adapters/conformance/`（共有適合スイート — ADR-026）＋ `adapters/node/`（in-process キュー / relay トリガ）へ再執筆
  - Unit of Work 節を二面（ADR-023）へ
  - `IdempotencyStore` 節（L410）を `application/ports/idempotencyStore.ts` ＋ memory 実装へ
  - Todo 例（`TodoRepository` / `todoEventDecoders` / `TodoEvent` ほか 5 箇所）を Note / Identity へ置換。domain 層の書き方（brand VO / `create` ファクトリ / `EventDraft` 収集）の説明自体は現行と同型なので構造を保つ
- **注意:** `spec/usecases/usage.md:120` が本ファイルの「ユースケース個別のリトライを認める」記述を規範として引用している。**この記述を消さない**

### 15. `docs/frontend_implementation_example.md` の識別子差し替え

- **対象ファイル:** `docs/frontend_implementation_example.md`
- **台帳 ID:** SYNC-19（frontend）
- **変更内容:** 構造は保ち、Todo 由来の識別子とパス（67 箇所）を実在するものへ差し替える。
  - `loadTodoListRouteData` / `renderTodoList` / `TodoList` → `routes/notes/index.tsx` と `components/note/NoteList/`
  - `TodoBoard` → `components/settings/IdentityList/board.tsx`（リスト所有権をクライアント島へ移す例 = **list-membership change** 側）
  - `TodoItem` → `NoteList` の行 / `IdentityList` の項目。あわせて **in-item mutation** 側の実例として `components/settings/ProfileForm/editor.tsx`（avatar の item-local `useOptimistic` ＋ `useTransition` ＋ item-local エラー state）を名指しする。対比の片側が例なしにならないようにする
  - `createTodoFn` / `changeTodoStatusFn` / `deleteTodoFn` → 実在の `components/*/action.ts` と `routes/*/-action.tsx`
  - `TodoTitle.create` / `TodoView` → `NoteTitle.create` / `NoteListView`
  - `apps/web/app/routes/todo/{route,about,index}.tsx` / `components/todo/TodoShell/` → 実在パス
  - L200 の「Composite Component は未採用。Todo UI は…」を Note / Settings ベースの現況説明に書き換える
  - 現行にあって未記載の 2 点を足す: `renderServerFragment`（`presentation/serverFragment.tsx`、RSC ストリーム中エラーの秘匿 — ADR-031）と `apps/web/app/start.ts` の CSRF ミドルウェア
- **注意:** `serverData` / `loadServerDeps` の表（L266-272）と `.validator` の記述は既に実装と一致しているので触らない。`apps/web/app/presentation/pagination.ts:5` が本ファイルを参照しているので、該当のページング記述を消さない

### 16. スコープ外のフォローアップ起票

- **対象:** GitHub Issue（`gh issue create` / `gh issue comment`）
- **台帳 ID:** SYNC-08, SYNC-23, SYNC-24, SYNC-27 ＋ **SYNC-221, SYNC-231, SYNC-237（新規）/ SYNC-203(3), SYNC-214, SYNC-220 付随, SYNC-227 付随（既存 Issue へコメント）**（統合分）
- **変更内容:** **起票する項目の一覧と件数の正典は `plan.md` の「Phase 5 で起票するもの」節**で、この文書には写さない（下記 1〜7 はその節の 1〜7 に対応する骨子で、レビューの修正ラウンドで足りた 8 以降の骨子は plan 側だけが持つ）。各 Issue / コメントには現状・根拠（`research.md` / `research-2.md` の該当節）・選択肢とトレードオフを書く。起票後、Issue 番号とコメント URL を本 Issue の完了コメントに列挙する（AC-23 / AC-60）。
  - 「新規 Issue か既存 Issue へのコメントか」は**受け皿の有無で決める**（どちらでもよい形にすると済んだかを判定できない）。受け皿となるスライス Issue が既に存在するものだけがコメント、残りは新規 Issue。
  1. **`Note.reconstruct` の visibility × content 交差検査をどう扱うか**（SYNC-08）— 現状は未検査（`note.ts:771-804`）。書き込み経路は両方向を守る。「拒否する実装を足す」か「再検査しない契約を spec に明記する」かの選択
  2. **フォーカスリングが accent 背景で判別できない**（SYNC-23）— `--shadow-focus: 0 0 0 2px var(--color-accent)` の再設計（内側リング / オフセット）。影響は実装 CSS 2 ＋ 実装 TS 1（`formStyles.ts` の `focus:outline-none` と `focus:` → `focus-visible:`）＋ 設計ドキュメント 2 ＋ モック HTML 43 の 47 ファイル
  3. **L-02 のサインイン済み状態が実装されていない**（SYNC-24）— `spec/pages/index.md` の L-02 が要件を持ち、`PublicShell` が `signedIn` prop を持たない。`/terms` `/privacy` にセッション読み取りを足す必要がある。将来 L-02 配下に増える P-41〜P-45 も同じ要件を継ぐ。**P-40（トップ）は本 Issue の SYNC-26 で閉じたので含めない**（この Issue の対象は L-02 の 2 か所と `PublicShell` / `LegalPage`）
  4. **`ExternalServiceError` の全域語彙整合**（SYNC-27）— `SystemErrorCode` に存在しない名前が `spec/` 20 箇所超 ＋ コード JSDoc 6 箇所（ShareTokenProtector を除く）に残る。外部 API 通信＝`ExternalApiError` / 鍵・データ整合＝`DataIntegrityError` のどちらへ写すかを、各ドメイン（conversion / integration / storage / job）のアダプター実装時に決めて置換する
     - **（計画レビュー R2 coverage:P-001）本文に 1 行足す**: 「同型の『実在しない enum 値名』が integration 側にも 3 か所ある — `spec/usecases/integration.md:37` / `spec/testcases/integration/startIntegrationOAuth.md:7` / `spec/inventory/test.md` の TC-integration-170 行の `BusinessRuleError(InvalidProvider)`。`spec/domains/integration.md:330` の `IntegrationErrorCode` union に `InvalidProvider` は**存在しない**。identity 側の同じ呼称ずれは Issue #14 が `InvalidProviderAccount` へ直したが、integration は**未実装ドメイン**で『どちらへ写すか』の実装的裏づけが無いため同じ扱いにする」
  5. **（統合分・新規）** **`addPasswordIdentity` に Google 再認可（再認証）が無い**（SYNC-221 / adr.md ADR-013）— `spec/scenario/account.md:127`（AC-06）/ P-22 の「再認証要求」状態 / manual TC-07 が求めるセキュリティ要件を実装が満たしていない。本 Issue はステップ 4-6 で **spec の内部矛盾（usecase 手順に再認可が無い）だけを解消**しており、実装は未着手であることを明記する。`startOAuthFlow` の intent と再認証状態の保持（`spec/adr/034` / `035` の束縛）に触れる実装スライスとして起票する
  6. **（統合分・新規）** **`distributed_operations` の `attempts` / `next_attempt_at` / `expires_at` と recovery Cron が未実装**（SYNC-231 / adr.md ADR-015）— `spec/database/index.md:130-148` は 3 列と partial index を定めるが実装のポート型に無い。あわせて「**`spec/domains/index.md` に `DistributedOperationStore` の interface を新設する**」を同じ Issue に含める（本 Issue では新設しない。メソッドの形を決めることが設計判断になるため）
     - **（計画レビュー R2 arch:P-008）対象を 5 ポートに広げる**。実装に存在して `spec/inventory/` に 1 行も無いポートは 5 つある — `DistributedOperationStore`（`spec/domains/index.md:121` に 1 行言及のみ）/ `AppliedOperationStore`（本 Issue のステップ 3-10 で 1 行言及を足す）/ `IdentityRemovalReceiptStore` / `OutboxRepository` / `ScopeTaskScheduler`（後 3 者は `spec/` 全域に 0 件）。`adapters/conformance/` の 31 スイートのうち `it` 名に **ADP ID を持たないのはこの 5 本だけ**で、inventory 行の欠落と 1 対 1 に対応している。Issue 本文に「5 ポートの interface 新設 ＋ inventory 行の採番 ＋ 適合スイートの `it` 名への ADP ID 付与（`describe` には付けない）」をまとめて書く（`spec/adr/052` の命名規約と ADR-011 の Consequences「実装すべきメソッドの全数を台帳から数えられる」がこの 5 本については成立していない）
  7. **（統合分・新規）** **P-25 の「削除されるもの / されないもの」と完了文言が participant の実態まで狭められている**（SYNC-237）— 受け皿が複数スライス（#3 / #4 / #5 / #7）に跨るため 1 本にまとめ、各スライスが自分の participant を宣言した時点で `spec/pages/index.md#P-25` と `spec/design/pages/P25-settings-danger.html` の文言へ実装が追いつく形にする。**spec は狭めていない**ことを本文に書く
  - **（統合分）既存 Issue へのコメント 4 件**（新規 Issue を作らない。受け皿がすでにあり、そのスライスが実装で追いつくため）
    - **#6** — `ObjectStorage.createDownloadUrl` が実装に無い（SYNC-203(3)）。`issueDownloadUrl` / `exportNote` を持つスライスが実装する。spec の行は残してある
    - **#3** — `getUsageSnapshot` の workspace ページングが `never[]` に縮退（SYNC-214）。入出力 DTO と手順 2・3 は spec に残してある
    - **#18** — `requestPasswordReset` の `passwordResetUnavailable` 分岐が 60 秒の発行間隔判定を通らない（SYNC-220 付随）。本 Issue はトークン発行側の 60 秒を spec に書いただけ
    - **#11** — TC-storage-043 から `spec/platform/index.md` の `### Scope DO` へ移した「3 文」の設計目標を、D1 実装で再検証する（SYNC-227 付随 / adr.md ADR-014）
  - あわせて 1. の Issue 本文に、**ADR-004 の再検証項目**を 1 行加える: 「rollback / prepare 経路が application 層へ配線された時点で、`allRollbackReleased`（release ack のみ）と personal barrier の abort ack ゲートの分担を再検証する」。現状この経路を呼ぶ application コードは存在しないため、spec が先行して確定している
- **理由:** adr.md ADR-006。乖離を「記録して先送り」にせず、追跡可能な形に残す（`spec/adr/046` の影響節）

### 17. 最終確認

**全ステップ（1〜16、18〜20、22〜32）を終えてから実行する。**「実行順」節のフェーズ F0・A〜G がすべて済んでいることが前提。

- **対象:** リポジトリ全体
- **変更内容:**
  1. 品質ゲート: `pnpm typecheck` / `pnpm lint:fix` / `pnpm format` / `pnpm test:unit` / `pnpm build`
  2. 台帳の追随漏れを grep で検査（plan.md「テスト方針」の全項目）。**合否の形は 3 種類ある**（計画レビュー R3 coverage:S-001）— **「ヒット 0 件」**／**「1 件以上」**（spec を狭めていないことの確認 — AC-62）／**「件数一致」**（AC-55 の 8 / 8 / 3、AC-64 の 24 / 24、**AC-65(b) の `grep -c "declaredMimeType" spec/usecases/storage.md` = 1**）。**向きを取り違えないこと** — とくに AC-65(b) は 0 ではなく **1** が合格（`startBulkUpload` の `files` 列は据え置く — 計画レビュー R3 arch:P-001）。このほかに**出力を人が読む確認が 4 つ**ある（下記 4. / 6. / 9. と、AC-27 の「コメント部分にヒットが無い」）
  3. `git diff --name-status $(git merge-base origin/main HEAD) -- packages/ apps/`（コミット済みと未コミットの両方を含む）で、コード差分が `plan.md`「コード差分の内訳」表の集合と 1 対 1 で一致することを確認する。あわせて**振る舞いを変える差分が 0** であることを機械的に示す — `git diff -U0 $(git merge-base origin/main HEAD) -- packages/ apps/ ':!*.example' | grep -E "^[-+]" | grep -vE "^(\+\+\+|---)" | grep -vE "^[-+][[:space:]]*(//|/\*|\*|\*/)" | grep -vE '^[-+][[:space:]]*(it|describe)\("'` が AC-63 の挙げる残り行だけを返す。**件数と内訳の正典は AC-63 だけで、この文書には写さない。** 表に無いファイルが出る、または AC-63 の内訳以外が返ったらスコープ逸脱
  4. `spec/inventory/{domain,adapter,test,frontend,usecase}.md` の **5 ファイル**の「最終同期」日付が更新されていることを確認する（統合により `usecase.md` が対象に入った — AC-56）
  5. `AGENTS.md` がシンボリックリンクのまま壊れていないことを確認する（`ls -l AGENTS.md`）
  6. `spec/adr/index.md` の一覧・前提依存マップに 052〜057 の **6 件**が載っており、`ls spec/adr/05[2-7]-*.md` が 6 ファイルを返すことを確認する
  7. ステップ 16 で起票した Issue 番号とコメント URL が本 Issue の完了コメントに列挙されていることを確認する。**件数と内訳の正典は AC-23 / AC-60 と `plan.md` の Phase 5 スコープ節だけで、この文書には写さない**
  8. 新規 inventory 行の採番を確認する（`DOM` / `ADP` / `UC` は AC-55、`TC` は identity 群の末尾に `TC-identity-305` 以降で AC-64。**件数と内訳の正典はその 2 つの AC だけで、この文書には写さない**）。**`spec/inventory/test.md` のヘッダーに TC 採番規則の 1 行が入っている**ことも確認する（計画レビュー R3 arch:S-001。ステップ 11）。**既存 ID の指す要素が変わっていない**ことを `git diff spec/inventory/` で目視する（既存行の ID 列に差分が出ていたら繰り下げが起きている）
  9. **（計画レビュー R2 arch:P-007）ADR リンクの参照先が実在することを確認する** — `grep -rn "adr/05[2-7]-" spec/` が返す各リンクのファイル名が `ls spec/adr/05[2-7]-*.md` の 6 ファイルに含まれること。6. の「ファイルが 6 つある」「index に 6 行ある」だけでは、番号がずれたときの本文リンク切れを検出できない（AC-68）
  10. **（計画レビュー R2 arch:P-001）「1 ユースケース = 1 テストケースファイル = 1 UC 行」を確認する** — `ls spec/testcases/identity/*.md | wc -l` と `grep -c "^| UC-identity-" spec/inventory/usecase.md` がともに **24**（AC-64）
- **理由:** ドキュメント同期は自動テストで守られないため、機械的に検査できる不変を明示的に確認する

### 18. `spec/manual-tests/account.md` — AC-02 の新規異常系への追随 ＋ TC-26 / TC-13 の是正

- **対象ファイル:** `spec/manual-tests/account.md`
- **台帳 ID:** SYNC-02 の波及 ＋ **SYNC-241, SYNC-242**（統合分）
- **変更内容:**
  1. **TC-42 を末尾（TC-41 の直後、`## カバレッジ` の前）に追加する。** 既存 TC の番号は動かさない。
     - 見出し: `## TC-42: 別のブラウザーで確認リンクを開く`
     - `**種別**`: 異常系 / `**目的**`: AC-02 の異常系で、確認は完了するがサインイン状態にはならないこと（[ADR 029](../adr/029-verification-session-binding.md) の束縛と受容した縮退）。**追随の判断根拠として [ADR 057](../adr/057-manual-test-followthrough.md) もリンクする**（計画レビュー R2 arch:S-001。ステップ 20 で新設）
     - 手順（`| # | 操作 | 期待結果 |` の 3 列）: TC-01 で登録 → **確認を要求したのとは別のブラウザー**で確認リンクを開く → 「確認済み・サインインが必要」の状態が出てサインインへの導線が表示される（ノート一覧へは遷移しない）→ その導線からサインインできる
  2. `### 観点チェックリスト` の `操作の中断・逸脱` 行の対応 TC に `TC-42` を足す
  3. `### ユースケースエラーケース対応表` は**新規行を足さない**。この表は **usecase のエラーケースを軸にした表**であり、scenario の異常系行と 1 対 1 ではない。今回足す 2 行のうち「別ブラウザーでの確認」は `verifyEmail` が成功する経路（エラーケースではない）、「一時障害」はインフラ障害なので、既存の `| getUsageSnapshot | 取得の失敗 | 対象外 | インフラ障害 |` と同じ扱いになる
     - **一時障害を対象外とした理由を 1 行残す**: 表の `verifyEmail` 群の末尾に `| verifyEmail | 一時障害（再試行導線） | 対象外 | 転送・基盤の障害は UI から再現できない。自動テストで担保する |` を足す
  4. **（統合分）** **TC-26**（`:339-347` 付近、「使用済み / 期限切れの再設定リンクを開く」）— 手順を「開いて**新しいパスワードを送信する**」に、期待結果を「**送信が拒否され**、リンクが無効である旨と再申請への導線が出る」に直す（SYNC-241）。GET で状態を変えないのは設計として正しく（プリフェッチや先読みでトークンを消費しない）、正本は `spec/inventory/frontend.md` の `PAGE-p04-003` / `PAGE-p04-004` 側。**PAGE 行は触らない**（既に正しい）
  5. **（統合分）** **TC-13 手順 2**（`:185-193` 付近）— 期待結果「無効にしたセッションが 1 件であることが表示される」を「**解除を受理した旨が表示される**」に直す（SYNC-242）。`spec/usecases/identity.md#signOutOtherSessions` が「応答は削除件数ではなく `revocationAccepted: true`」と定めており、件数表示は AC-16 の O(1) 要求とも「端末一覧を持たない」方針とも矛盾する。**手順書 1 か所だけが spec 内で孤立している**
- **理由:** `spec/manual-tests/` は scenario の下流成果物で、`spec/inventory/` と同じく「本文を直したら追随させる」対象。ADR-029 が受容した縮退（「確認済み・サインインが必要」）は手作業で再現しやすい部類でありながら、現状どの TC もカバーしていない
- **注意:** `spec/inventory/test.md` は `spec/testcases/` からの生成物であり、manual-tests の TC 番号は載らない。**TC-42 を inventory へ足さない**

### 19. `README.md` の改訂

- **対象ファイル:** `README.md`
- **台帳 ID:** SYNC-18（同根）
- **変更内容:** `CLAUDE.md` の改訂（ステップ 13）と**同じ現況**を語るよう直す。差分は 10 行程度。
  - `infra/`（存在しない）、「four reference runtime wirings」「Node.js + libSQL」「`:cf` / `:aws` / `:gcp` suffix」を、**Node ＋ in-memory の単一参照ランタイム**（[ADR 025](spec/adr/025-single-reference-runtime.md)）に差し替える
  - `/todo` ルート・Drizzle ORM・two-tier vitest の記述を実在するもの（`routes/notes/`、`adapters/memory/`、ルートの単一 vitest）に差し替える
  - ワークスペースは `apps/*` と `packages/*` の 2 つであることを書く
  - `docs/*_implementation_example.md` への参照は**維持する**（4 つの参照元の 1 つ）
- **理由:** ステップ 13 で `CLAUDE.md` を直すと、**リポジトリのトップ README だけが旧構成を語る**状態が生まれる。入口の記述だけ矛盾を残さない
- **注意:** `README.md` は `spec/` の生成物ではないので順序の制約はないが、ステップ 13 と**同じ事実**を書くこと（食い違うと同じ問題が再発する）

### 20. `spec/adr/` への昇格（052〜057）

**このステップを A フェーズより前に実行する**（実行順の表のフェーズ F0）。9 つのステップ（A: 2, 3, 4, 7, 24, 28, 29 / C: 10 / D: 18）が `[ADR 053](../adr/053-….md)` の形で**具体的な番号入りリンクを本文へ焼き込む**ので、採番の再確認が後ろに来ると、ずれが判明した時点で本文リンクが書き終わっている。訂正の指示はどのステップにも無い（計画レビュー R2 arch:P-007）。

- **対象ファイル:** `spec/adr/052-*.md` 〜 `spec/adr/057-*.md`（新規）、`spec/adr/index.md`
- **変更内容:**
  1. **採番の確認を最初に行う。** `spec/adr/` の番号は**永久割り当て**で、廃止した ADR（015 / 016 / 018 / 019 / 020 — コミット `bea92db` で削除）の番号は**再利用されていない**。したがって空き番号を埋めず、現在の最大採番（051）の次から連番を取る。**`ls spec/adr/` で最大採番を再確認してから 6 本のファイルを作り、そのあとで A フェーズへ進む**。先に消費されていたらブロックごと後ろへずらす（6 本は連番に保つ）
     - 番号確定だけを先に済ませて本文執筆を後回しにしたい場合は、このステップを **20a（採番確定と空ファイル作成）** / **20b（本文と `index.md`）** に割ってよい。守るべき順序は「採番の確定 → 本文リンクを書く」であって「ADR 本文の完成 → 本文リンク」ではない
  2. `.thread/14/adr.md` の 16 件を記録基準（寿命テスト / 波及テスト）にかけ、**両方 Yes の 8 件を昇格**する。**作るファイルは 6 本**（052〜057）で、**ADR-011 と ADR-016 は独立番号を取らず 052 の本文に 1 段落ずつ統合する**ため判断の数（8）とファイルの数（6）が一致しない（計画レビュー R3 coverage:S-004。旧文「両方 Yes の 6 件を昇格する（うち ADR-011 と ADR-016 は…）」は、6 を判断の数と読むと ADR-011 / 016 が「うち」に入らず、ファイルの数と読むと「うち」が成立しなかった）。昇格する 8 件は **ADR-002 / 004 / 005 / 007 / 010 / 011 / 014 / 016**。ADR-001（倒す向きの判定規則）は `spec/adr/046` が既に定めているので昇格しない。ADR-003（`docs/*` の書き直し）/ ADR-006（スコープ外の切り出し）/ ADR-012（適合ケース 1 本の扱い）/ ADR-013（SYNC-221 の分割）/ ADR-015（interface を新設しない判断）は本 Issue 限りの進め方・スコープ判断なので昇格しない。**ADR-010 は計画レビュー R2（arch:S-001）で昇格対象に加わった**（下記 057）
     - `spec/adr/052-adapter-inventory-granularity.md` ← adr.md **ADR-002**（`spec/inventory/adapter.md` は 1 行 = 1 ポートメソッド。適合ケースに ADP ID を新規採番せず、`describe` 名の命名規約で追う）
     - `spec/adr/053-account-deletion-rollback-completion.md` ← adr.md **ADR-004**（`allRollbackReleased` は membership release ack のみを見る。personal barrier の abort ack はユースケースの復帰ゲートとして別に確認する）
     - `spec/adr/054-provider-account-uniqueness-owner.md` ← adr.md **ADR-005**（provider account の一意性担保は `IdentityUniqueDirectory` に一本化し、`IdentityRepository` の契約からは落とす）
     - `spec/adr/055-session-expiry-derivation.md` ← adr.md **ADR-007**（`expiresAt` を View に載せず、転送境界が `Session.ttlMs` から再導出する）
     - **（統合分）** `spec/adr/056-performance-budget-placement.md` ← adr.md **ADR-014**（バックエンド依存の性能上の約束は契約（`spec/testcases/`）に置かず、観測可能な性質だけを契約に残して数値は `spec/platform/index.md` の実行予算へ置く）。前提は [ADR 024](./024-in-memory-adapter-as-first-class-backend.md)（memory アダプターは一級のバックエンド）と [ADR 026](./026-port-contract-and-conformance.md)（契約の実行形は共有スイート）。**`spec/adr/022` は「コマンドパレットの遷移」であって OCC の ADR ではない**（`research-2.md` の SYNC-227 の引用は誤り。OCC トークンを `findById` から得る制約は `.thread/2/adr.md` 側の記録で、`spec/adr/` に対応 ADR は無い）。影響節に「D1 実装スライスが `### Scope DO` の設計目標を再検証する」を書く
     - **（統合分）** `spec/adr/052-adapter-inventory-granularity.md` の本文に、adr.md **ADR-011** の切り分けを 1 段落として書く —「採番しないのは**適合ケース**（既存メソッドに相乗りする主張）であって、**新規ポートメソッドには通常どおり採番する**。採番は各群の末尾に足し、出現順に挿入して既存 ID を繰り下げない。**ID は行位置ではなく行の識別子**である」。**ADR-011 を独立した番号にしない**（2 つの ADR を突き合わせないと採番規約が読めなくなる）
     - **（計画レビュー R2）** 同じ `spec/adr/052-adapter-inventory-granularity.md` の本文に、adr.md **ADR-016** の切り分けも 1 段落として書く（ADR-011 の段落の直後）—「**同じ規則を `spec/inventory/test.md` の TC ID にも当てる。** TC ID はテストケースファイル名の辞書順に振られてきたが、**ID は行位置ではなく行の識別子**なので、新設したテストケースファイルの TC 行は辞書順の位置に挿入せず**群の末尾に採番する**。既存 ID の指す要素を動かさないことが優先する。**既存のテストケースファイルに行を足す場合も同じで、既存ブロックの中へ挿入せず末尾に採番する**」。**最後の 1 句を落とさないこと**（計画レビュー R3 coverage:S-003 = adr.md ADR-016 の**決定 4**）— 本 Issue はまさにこれを `requestPasswordReset.md` の境界 2 行に適用しており、書かなければこの判断だけが計画凍結時に消える `.thread/14/adr.md` に残る（ADR-008 が自ら指摘した自己矛盾と同じ構図）
     - **（計画レビュー R2 arch:S-001）** `spec/adr/057-manual-test-followthrough.md` ← adr.md **ADR-010**（`spec/manual-tests/` は scenario の下流成果物として追随させ、**追随の要否は表の軸**（`### ユースケースエラーケース対応表` = usecase のエラーケース / `### 観点チェックリスト` = テスト観点）で決める。成功経路は前者に載らず、手作業で再現できない障害は `対象外` と理由を書く）。前提は [ADR 029](./029-verification-session-binding.md)（受容した縮退が追随の対象になる例）。ADR-002 の昇格（052）と対になる規則で、`spec/manual-tests/` の追随規則はどの spec ファイルにも明文化されていない
     - **（計画レビュー R2 arch:S-005）** `spec/adr/056` の**コンテキスト節に「どのバックエンドが 3 文に届かないか」を書く**（1 行ずつ OCC トークンを読む memory アダプターの実装制約）。`spec/platform/index.md` 側の段落には書かない（実行基盤の予算という節の軸が濁る）
  3. **既存 ADR の様式に合わせる。** 見出しは `# {3 桁番号}. {判断の概要}`（例: `# 046. ポート契約と実装が食い違ったら、正本のある側へ倒す`）。節は `## ステータス`（承認済み）/ `## コンテキスト` / `## 前提` / `## 決定` / `## 検討した代替案` / `## 影響`。他 ADR への参照は `[ADR 026](./026-port-contract-and-conformance.md)` の形
  4. `spec/adr/index.md` の **「一覧」表に 6 行**、**「前提依存マップ」に 6 行**を追加する
  5. 本文からのリンクは各ステップで張る（ステップ 2 → 054、ステップ 3 → 053、ステップ 4 → 053 / 055、ステップ 7 → 055、ステップ 10 → 052、**ステップ 24-3 / 28 / 29 → 056**、**ステップ 18 の TC-42 → 057**）。**リンクは各ステップの変更内容にも明記してある**（052〜055 と同じ粒度。計画レビュー R2 arch:S-002）。**このステップは A フェーズより前**に実行する（1. の理由）
- **理由:** `spec/index.md` は「`spec/` は現在有効な要件と設計の正典」、`spec/adr/index.md` は「現在有効な非自明な設計判断の索引」と定義しており、直近コミット `16b51fc`「docs: 設計判断を spec/adr へ昇格しレビュー記録を片付ける」がリポジトリの慣行を示している。plan.md 自身が「`.thread/1/` は計画凍結時に消える」ことを前提に dangling 参照を潰しているのに、本 Issue の判断根拠だけを消える `.thread/14/adr.md` に置いたままにするのは自己矛盾になる

### 21.（欠番）

計画レビューで追加したステップを 18〜20 に置いた時点で空けた番号。**再利用しない**（`.thread/14/plan-review/` の指摘が 21 番を参照している可能性があるため）。

### 22. `spec/domains/storage.md` — ObjectStorage・エラーコード・アップロード検証

- **対象ファイル:** `spec/domains/storage.md`
- **台帳 ID:** SYNC-203(1)(2), SYNC-211, SYNC-240
- **変更内容:**
  1. `ObjectStorage` interface（`:285-305` 付近）を実装に合わせる（SYNC-203）。
     - `put(key, body: Uint8Array, meta)` — ストリーム受け（`ReadableStream<Uint8Array>`）を落とす
     - `get(key): Promise<ObjectBody | null>` の `ObjectBody` を `{ bytes: Uint8Array; meta }` にする
     - `publicUrl(key): string` を足す。説明段落に「公開 URL の組み立てをポートに持たせ、配備ごとの形をアダプターに閉じる。**期限つき URL と公開 URL は別のメソッドとして型で分ける**」（[ADR 049](../adr/049-object-storage-public-url.md)）を書く
     - **`createDownloadUrl` の行は削除しない**（SYNC-203(3) = スコープ外。実装がまだ持たないだけで、`issueDownloadUrl` / `exportNote` を持つスライスが実装する）
     - **ストリーム経路を落としたことを引き継ぎとして説明段落に明記する**（`spec/adr/046` の「契約を弱めた側は責務の移転を残す」）— 大きな本体を扱う経路が要るスライスは、この決定を再検討することになる
     - **要求元を名指しする**（計画レビュー R2 arch:P-003）。ストリームを入力に持つユースケースは実在する — `spec/usecases/storage.md#storeUpload` の入力 DTO `body: ReadableStream<Uint8Array>`（**および同ユースケース手順 2 の `ensureAcceptable` 呼び出し**。バイト列が手に入るのは手順 5 の `ObjectStorage.put` 以降なので、実体判定を手順 2 で行う形へ組み替えるのはこのスライスの仕事 — 計画レビュー R3 arch:P-002）と `spec/usecases/integration.md#requestBackup` 付近の `stream: ReadableStream<Uint8Array>`。**どちらも未実装**なので spec 側の記述は残し（`spec/adr/046`「実装が未実装の側で spec を狭めない」）、「この 2 経路を実装するスライスが、`spec/adr/050` の前提『ポートがバイト列だけを受ける形であること（ストリームを通す用途が現れた時点で、その要求とともに広げる）』に従って `put` の入口を広げ、読み切る前に上限で切る形をそこで設計する」と書く。名指ししないと、ステップ 24 の後に「ストリームを受け取ったユースケースがバイト列しか受けないポートへ渡す」記述が理由なしに残る
  2. `StorageErrorCode` union（`:350-354` 付近）に `InvalidChecksum` を足す（SYNC-211）。改訂後は実装 `packages/core/src/domain/storage/errorCode.ts:3-12` の 8 コードと集合として一致すること。根拠は同ファイル `:44-47` の `Checksum` 値オブジェクト（「`value` は 64 文字の 16 進数」）が違反時のコードを必要とすること
  3. `UploadValidationPolicy` の振る舞い表（`:180-183` 付近）を実装に合わせる（SYNC-240）。引数を `params: { purpose: FilePurpose; body: Uint8Array }`、戻り値を `AcceptedUpload = { mimeType: MimeType; size: ByteSize }` にし、「処理」欄に「**MIME は申告値ではなく先頭バイトの署名（PNG / JPEG / WebP）で決め、サイズは実バイト長で測る**。どの許可形式にも一致しなければ `BusinessRuleError(UnsupportedMimeType)`、上限超過は `BusinessRuleError(FileTooLarge)`」（[ADR 050](../adr/050-upload-acceptance-from-bytes.md)）を書く
     - 許可 MIME の表（`:185-191` 付近）に注記を 1 行 —「**署名を持たない形式（`text/markdown` など）を許可する purpose を足すスライスが、入口の形をさらに広げる**」（`spec/adr/050` が「そのスライスが判断を行う」と定めている）
- **注意:** 1. の `publicUrl` は `spec/inventory/{domain,adapter}.md` に**新規行を採番する**（`DOM-storage-038` / `ADP-storage-024`）。`replaceTotals` / `ensureAcceptable` と違い、これは**ポートのメソッド**なので行が要る（adr.md ADR-011）
- **理由:** `spec/adr/049` / `spec/adr/050` は PR #17 で昇格済みで、下流の domain だけが未追随。Issue #6（取り込み・変換）の実装者はこの 1 ファイルを契約として読む

### 23. `spec/domains/usage.md` — `StorageQuota.replaceTotals`

- **対象ファイル:** `spec/domains/usage.md`
- **台帳 ID:** SYNC-204
- **変更内容:** `StorageQuota` の**振る舞い**表（`:72-84` 付近。現在 `initialize` / `add` / `subtract` / `incrementNotes` / `decrementNotes` / `changeLimit` / `headroom` / `warningLevel` / `ensureCanStore` の 9 メソッドで**すべて差分**）に `replaceTotals` の行を足す。
  - `| replaceTotals | quota: StorageQuota, totals: { consumedBytes: ByteSize; noteCount: number }, now: Date | StorageQuota | スキャン結果は差分ではなく正本なので、消費量とノート数を置き換える |` 相当
  - `spec/usecases/usage.md:180`（`recalculateStorageUsage` 手順 3）が既に「`StorageQuota` の値を**置き換えて**保存する」と書いており、**その置換を行うメソッドだけが表に無い**状態を埋める
- **注意:** `spec/inventory/domain.md` に**新規行を作らない**。`DOM-usage-006` が `StorageQuota` エンティティ 1 行で全振る舞いを畳む単位なので、要点欄の更新だけ（ステップ 9、adr.md ADR-011 の決定 4）
- **理由:** usecase 側の記述に domain の表が追随する形（`spec/adr/046` の「正本が設計側」）

### 24. `spec/usecases/storage.md` — 入出力 DTO と `batchSize` の説明

- **対象ファイル:** `spec/usecases/storage.md`
- **台帳 ID:** SYNC-212, SYNC-215（`deleteFilesByOwner` 側）, SYNC-227（`batchSize` 段落）, SYNC-240（付随）, **SYNC-203(1)(2) と SYNC-240 の usecases 側への波及**（計画レビュー R2 arch:P-003 で追加）
- **変更内容:**
  1. `storeAvatar` の入力 DTO 行（`:167` 付近）から `declaredMimeType` と `size` を落とす（SYNC-212 / SYNC-240）。残るのは `userId`, `subjectType`, `subjectId`, `fileName`, `body`。理由を 1 句 —「**入力から宣言値を落とす**。サイズは実バイト長、型は先頭バイトの署名から決め、申告値を保管する経路を型から消す」（[ADR 050](../adr/050-upload-acceptance-from-bytes.md) の決定 1）
  2. `deleteFilesByOwner` の「出力 DTO: `deletedCount: number`」を `ScopeCleanupTurn & { deletedCount: number }` にする（SYNC-215）。`status`（`alreadyApplied` / `continued` / `stalled` ほか）を返す理由を 1 句 —「同ファイルの手順が『100 件未満になってから cleanup receipt へ ack を付ける』『対象が残っているのに 1 件も削除できなかった場合は継続を積まず backoff する』という**呼び出し側が知らなければ制御できない分岐**を定めており、件数だけでは表現できない」
  3. `batchSize` の説明段落（`:492`）から**クエリ文数の内訳を落とす**（SYNC-227 / adr.md ADR-014）。「`batchSize` の既定 100 は 1 回に発行するイベント数を抑えるための上限である」を残し、性能上の性質は `spec/platform/index.md` の `### Scope DO`（ステップ 29 で足す段落）へ委ねる。
     - **リンクを直す**: 現行の `[platform/index.md](../platform/index.md) の「クエリ予算」` は**存在しない見出しを指すリンク切れ**。実在する `## 実行予算と分割単位` → `### Scope DO` を指すよう書き換える
     - **[ADR 056](../adr/056-performance-budget-placement.md) をこの段落からリンクする**（計画レビュー R2 arch:S-002 / coverage:S-005。052〜055 は各ステップの本文に `[ADR 05x](...)` が明記されているのに 056 だけ扱いが薄く、ステップ 20-5 の一覧に 1 行あるだけだった）
  4. **（計画レビュー R2 arch:P-003 ＋ R3 arch:P-001 / P-002）`ensureAcceptable` の呼び出し 3 か所から宣言値の引数を落とす。** ステップ 22-3 が振る舞い表の署名を `{ purpose, body }` / 戻り値 `AcceptedUpload` に変えるので、呼び出し側を直さないと `spec/domains/storage.md` と `spec/usecases/storage.md` が別のことを言う。
     - **対象は `:90`（`storeUpload` 手順 2）/ `:145`（`storeMedia` 手順 2）/ `:176`（`storeAvatar` 手順 2）の 3 か所**。実際に書き換えが要るのは `:90` だけで、`{ purpose: "source", mimeType, size }` と**引数を明示的に書いている唯一の箇所**である。`:145` / `:176` は既に `{ purpose: "media", ... }` / `{ purpose: "avatar", ... }` の省略記法なので、宣言値を挙げていないことを確認するだけでよい
     - **`:90` は「省略記法にそろえる」に留める。** `{ purpose: "source", ... }` と書き、`mimeType` / `size` を消す。**`{ purpose: "source", body }` と書かない** — 6. のとおり `storeUpload` の入力 `body` は `ReadableStream<Uint8Array>` のまま残すので、`body` を引数として名指しすると「ストリームを宣言している入力 DTO から、バイト列しか受けないポートへ渡す」記述が同じファイルの中に生まれる（R2 の `arch:P-003` が問題にした矛盾が `ObjectStorage.put` から `ensureAcceptable` へ移動するだけになる）。実物の手順 5 は「`ObjectStorage.put` で保管し、実サイズとチェックサムを得る。あわせて**流したストリームの先頭 8192 バイトを退避**し」と書いており、バイト列が手に入るのは手順 5 以降である。**読み切り／先頭バイト退避を手順 2 の前へ動かす手順の組み替えは、本 Issue では行わない**（未実装のユースケースに対する設計判断であり、`spec/adr/050` 自身が「読み切る前に上限で切る形はストリーム経路を広げるスライスが設計する」と将来へ送っている）。**引き継ぎはステップ 22 の説明段落が持ち、そこから `storeUpload` の入力 DTO と手順 2 の両方を名指しする**（ステップ 22-1 の最後の箇条に手順 2 を加える）
     - **`:38`（`startBulkUpload` 手順 3）は据え置く**（計画レビュー R3 arch:P-001）。現行は「各ファイルについて `UploadValidationPolicy.ensureAcceptable` を試し、通らないものを `rejected` に積む」という**引数を書かない一般記述**で、このユースケースは**バイト列を持たない**（入力 DTO に `body` は無い）。`{ purpose, body }` へ書き換えると**存在しない入力を渡す記述**になる。`spec/adr/050` の**前提**は「受理判定の時点で実体を握っていること」であり、実体を握らない `startBulkUpload` は決定 1 の適用対象ではない
  5. **（計画レビュー R2 arch:P-003 ＋ R3 arch:P-001）宣言値を 3 か所で落とす。** `spec/adr/050` の決定 1（「**入力から宣言値を落とす**。ユースケースは判定結果しか記録できない形にし、申告値を保管する経路を型から消す」）は昇格済みなので、`storeAvatar` だけを直すと「昇格済み ADR に下流が未追随」という本 Issue がまさに対象にしている類型が 2 か所残る。対象は `:74` `:75`（`storeUpload` の入力 DTO の `declaredMimeType` 行と `size` 行）/ `:136`（`storeMedia` の入力 DTO の列挙。`declaredMimeType` **と** `size` の両方）/ `:167`（`storeAvatar`。1. と同じ。`declaredMimeType` **と** `size` の両方）。**`size` を落とし忘れやすい** — `:136` / `:167` は 1 行に `userId`, …, `declaredMimeType`, `size`, `body` と列挙する形なので、`declaredMimeType` だけ消して `size` が残る取りこぼしが起きる（計画レビュー R3 arch:S-002。AC-65(b2) が書き分けを検査する）
     - **`:22`（`startBulkUpload` の `files` 列）は据え置く**（計画レビュー R3 arch:P-001）。`{ fileName; declaredMimeType; size }[]` を `{ fileName }[]` にすると、**同じファイルの手順 1・手順 5・出力 DTO の説明段落が根拠を失う** — 手順 1 は「合計サイズが 500 MB を超えれば `ValidationError("UPLOAD_TOO_LARGE")`」を `files[].size` から測り、手順 5 は「**宣言 MIME・拡張子から** LLM 構造化を要するファイルの件数を暫定的に数えて `llmRequiredCount` とする」と書き、出力 DTO の説明段落は「**このユースケースはファイルの内容（head）を読まない**。… `llmRequiredCount` は宣言 MIME・拡張子から導いた暫定値」と明言している
       - 代わりに `files` 列（または直後の説明）に **1 句を添える** —「`files[]` の `declaredMimeType` / `size` は**受理判定の入力ではなく、事前の合計サイズ検査と暫定判定のためのヒント**である。確定判定は実体を握る `storeUpload` が行う（[ADR 050](../adr/050-upload-acceptance-from-bytes.md) の前提『受理判定の時点で実体を握っていること』がこのユースケースでは成立しないため）」
     - あわせて `:90` 付近の**手順 5 の「宣言サイズと実サイズが食い違う場合は実サイズを採用する」を落とす**（`storeUpload` の入力から宣言サイズが消えるので、食い違いという状態が表現できなくなる — `spec/adr/050` のコンテキストそのもの）
     - **`spec/usecases/conversion.md:198` と `spec/domains/conversion.md:170` の `declaredMimeType` は触らない。** これは `FormatDetector.detect` が受け取る**ヒント**であって受理判定の入力ではない（別ポート）。**`:22` を残すのはこれと同じ切り分けである**
  6. **（計画レビュー R2 arch:P-003）ストリーム入力は残す。** `:76` の `body: ReadableStream<Uint8Array>`（`storeUpload`）を `Uint8Array` に狭めない。`storeUpload` は未実装で、`spec/adr/050` の前提自身が「ストリームを通す用途が現れた時点で、その要求とともに広げる」と将来の拡張を織り込んでいる。**引き継ぎはステップ 22 の説明段落が持つ**（そこから `storeUpload` の入力 DTO と手順 2 を名指しする）ので、ここには何も書かない
- **注意:** **4. と 5. の適用範囲は `startBulkUpload` を含まない**（計画レビュー R3 arch:P-001）。`:38` と `:22` に手を入れると `spec/usecases/storage.md` に新しい内部矛盾が 3 つ生まれる（手順 1 の合計サイズ検査 / 手順 5 の暫定判定 / 出力 DTO の説明段落）。**4. と 6. も互いに矛盾させない** — 6. がストリームを残す以上、4. の `:90` は `body` を引数として名指ししない（計画レビュー R3 arch:P-002）。どちらも根拠は同じで、`spec/adr/050` の前提が成立しない側・未実装の側で spec を狭めないこと（`spec/adr/046`）
- **理由:** (1) は昇格済み `spec/adr/050`、(2) は手順が要求する情報を DTO が返す形（`spec/adr/046`）、(3) は契約と予算の置き場所の分離（adr.md ADR-014）、(4)(5)(6) は domain 側だけを直すと同ファイル群に新しい内部矛盾が生まれるため（計画レビュー R2 arch:P-003）。適用範囲を実体を握る 3 経路に限るのは、広げると別種の内部矛盾を新設するため（計画レビュー R3 arch:P-001 / P-002）

### 25. `spec/usecases/usage.md` — 実行者 `userId` と `deleteQuota` の戻り値

- **対象ファイル:** `spec/usecases/usage.md`
- **台帳 ID:** SYNC-213, SYNC-215（`deleteQuota` 側）
- **変更内容:**
  1. `recalculateStorageUsage` の入力 DTO（`:171` 付近。現在 `subjectType` / `subjectId` の 2 つ）に `userId` を足す（SYNC-213）。**主体ではなく実行者**であることを明記する —「`assertActorWritable` が『誰の依頼か』を要るため。user 主体の場合は実行者と一致していなければならず、一致しなければ `InsufficientRole`。workspace 主体の membership 検査は `WorkspaceAuthorization` が入るまで未実施」。根拠は `spec/domains/index.md:124`（「全ドメインの通常 write 入口が両方を呼ぶ」）
  2. `deleteQuota` の「出力 DTO: なし」を `ScopeCleanupTurn`（`status` と `personalCleanupCompleted`）にする（SYNC-215）。理由はステップ 24-2 と同じ（継続と ack の制御に呼び出し側が使う）
- **注意:** **`getUsageSnapshot` の workspace ページングは触らない**（SYNC-214 = スコープ外）。入力の `workspaceCursor` / `workspaceLimit`、出力の `workspaces: WorkspaceUsageItem[]` / `nextWorkspaceCursor`、手順 2・3（`membership_directory` の keyset と 6 並行 RPC、部分失敗の `unavailable`）を**1 行も削らない**。実装が `never[]` に縮退しているのは #3 が実装で追いつく側（Phase 5 で #3 へコメント）
- **理由:** `spec/adr/046`「正本が設計側」（1）／手順が要求する情報を DTO が返す形（2）

### 26. `spec/database/index.md` — 4 か所の追随

- **対象ファイル:** `spec/database/index.md`
- **台帳 ID:** SYNC-224(b), SYNC-228(c), SYNC-230, SYNC-233, SYNC-231(b)
- **変更内容:**
  1. `### identity_unique_reservations` 節（`:57` 付近）— `reservationOperationId = sha256(...)` を**合成**（`` `${parentOperationId}:${kind}:${normalizedKey}` ``）に直す（SYNC-224）。**ステップ 4-8 と同じ文言にそろえる**（同じ式が 2 か所にある）
  2. `### applied_operations`（`:1027-1037` 付近）— 2 点（SYNC-228 / SYNC-233）。
     - `kind='accountDeletionBarrier'` の説明の「operation専用の**全8 component ack**が揃った場合だけcompleted commandを受け」を**宣言集合**に直す（ステップ 3-7 と同じ語彙）
       - **同じ行に 8 component の直書きが 2 か所ある**（計画レビュー R2 arch:S-003）。`:1037` は上記に加えて `result` の構造リテラル `componentAcks: { job, note, tag, storage, backup, usage, localProjection, outbox }` も直書きしている。**後者は「宣言された component をキーとするマップ」と読める形にする**（例示であって enum 全体の固定列挙ではない旨を 1 句添えるか、キーを `…` に畳む）。片方だけ宣言集合に倒すと、1 行の中で片方は宣言集合・片方は 8 固定という状態が残る
     - 1 表が実装では 2 ポートに分かれていること（`ScopeCleanupAdmissionStore` = barrier receipt 側 / `AppliedOperationStore.markApplied` = 重複排除側。**キーの意味でポートを分ける** — [ADR 045](../adr/045-idempotency-by-commutativity.md)）を書き、`result` 列を「**値を返すコマンドを足すスライスが使う**」列として位置づけ直す（現在は NOT NULL で「同じ command の再試行へ返す JSON」）。`:33` `:35` の表一覧の記述もこれに合わせる
  3. `### account_deletion_manifests`（`:154` 付近）— 8 件 / 120 日の再要求しきい値の**計数の所在**を `distributed_operations` 側へ直す（SYNC-230）。「`(user_id, state, expires_at)` index で未失効 rejected を同 transaction 内に数え」を、「`DistributedOperationStore.countTerminalSince` が保持中の terminal 行を数え、しきい値と窓の判定は `AccountDeletionRetryPolicy`（ドメイン）が行う。**数えて → 判定して → はじめて作る**（作ってからロールバックしない）」に置き換える（[ADR 044](../adr/044-business-thresholds-in-domain.md)）
  4. `### distributed_operations`（`:130-148`）— `state` 列に 3 値（`running` / `completed` / `rejected`）の CHECK を書く（SYNC-231(b) / adr.md ADR-015）。**`attempts` / `next_attempt_at` / `expires_at` の 3 行と「`next_attempt_at` の partial index を recovery Cron が使う」は削除しない**（未実装であってスコープ外）。既存の一意索引（`state NOT IN ('completed','rejected')`）と語が一致することを確認する
- **注意:** 2. で `AppliedOperationStore` の名前を出す前に、**ステップ 3-10 が `spec/domains/index.md` に 1 行言及を足していること**を確認する（計画レビュー R2 arch:P-008）。実測すると `AppliedOperationStore` は現在 `spec/` 全域に 0 件で、この 1 行が無いと **DB 設計文書だけがどこにも定義の無いポート名を参照する**状態になる。フェーズ A の内部順 `3 → 4 → 26` はこの依存も含む
- **理由:** 昇格済み ADR（044 / 045 / 048）と実装の双方に対して、`spec/database/index.md` だけが 2026-08-09 のまま

### 27. `spec/testcases/identity/startOAuthFlow.md` — 存在しないエラーコード名

- **対象ファイル:** `spec/testcases/identity/startOAuthFlow.md`
- **台帳 ID:** SYNC-223
- **変更内容:** TC-identity-268 の行（`:9` 付近）の期待結果 `BusinessRuleError(InvalidProvider)` を `BusinessRuleError(InvalidProviderAccount)` に直す。4 列目（実装ステータス）は空のまま。
  - `InvalidProvider` は実装の enum（`domain/identity/valueObject.ts:268-272` が投げるのは `IdentityErrorCode.InvalidProviderAccount`）にも `spec/domains/identity.md` の union にも存在しない**純粋な呼称ずれ**
  - **反映先は 3 か所**: 本ファイル ＋ `spec/usecases/identity.md` のエラー表（ステップ 4-5）＋ `spec/inventory/test.md` の TC 行（ステップ 11）。`.thread/2/progress.md` は usecases 側を見落としている
- **理由:** 契約の記述と実装の名前が一致していなければ `spec/adr/026` の決定 1 が成立しない

### 28. `spec/testcases/storage/deleteFilesByOwner.md` — 「3 文」を観測可能な性質へ

- **対象ファイル:** `spec/testcases/storage/deleteFilesByOwner.md`
- **台帳 ID:** SYNC-227（契約側）
- **変更内容:** TC-storage-043 の行（`:11` 付近）の期待結果から**文の数を落とす**（adr.md ADR-014）。
  - 書き換え後は「**列挙は 1 回だけ / 削除できたファイル 1 件につき `storage.fileDeleted` が 1 件 / どちらも `batchSize` の件数に比例した追加の往復を要求しない**」という、全バックエンドで観測可能な性質にする（実テスト `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts` が既にこの形で緑）
  - **操作欄も直す**（計画レビュー R2 arch:S-004）。現行は「発行するクエリ数を確認する」で、期待結果から文数を外すのにケース名がクエリ数を語ったままだと中途半端になる。「**件数に比例した往復を要求しないことを確認する**」相当へそろえる。`spec/inventory/test.md` の要素欄はこの写しなので、ステップ 11 で同じ文面にする
  - 期待結果に [ADR 056](../adr/056-performance-budget-placement.md) をリンクする（計画レビュー R2 arch:S-002）
  - `batchSize` の既定 100 の位置づけ（クエリ数ではなくイベント数の上限）は `spec/usecases/storage.md` 側（ステップ 24-3）に残す
  - 4 列目（実装ステータス）は空のまま
- **注意:** `spec/inventory/test.md` の TC-storage-043 行を**同じ文面に**追随させる（ステップ 11）
- **理由:** 「3 文」はバックエンド依存の性能上の約束で、バックエンド非依存の契約であるテストケース表に置いた場所が誤り（adr.md ADR-014）

### 29. `spec/platform/index.md` — 文の数を実行予算へ移す

- **対象ファイル:** `spec/platform/index.md`
- **台帳 ID:** SYNC-227（予算側）
- **変更内容:** `## 実行予算と分割単位` → `### Scope DO` の**表の直後**に段落を 1 つ足す（adr.md ADR-014）。
  - 内容: 「scope-local の一括削除は、1 turn の SQL 文数がバッチ件数に比例しない形で実装する（SQL バックエンドなら列挙 1 ＋ 多行 DELETE 1 ＋ 多行 outbox INSERT 1 の 3 文）。ただしこれは**上限ではなく実装が満たすべき設計目標**であり、全バックエンドに課す契約は『件数に比例した往復を要求しない』という観測可能な性質のほう（`spec/testcases/storage/deleteFilesByOwner.md`）に置く。理由は [ADR 056](../adr/056-performance-budget-placement.md)」
  - **どのバックエンドが届かないかはここに書かない**（計画レビュー R2 arch:S-005）。`spec/platform/index.md` は冒頭で「実行基盤は Cloudflare Workers + scope Durable Objects + global D1 + R2 + Queues」と宣言する Cloudflare 前提の正典で、`### Scope DO` は DO の実上限を語る節。「1 行ずつ OCC トークンを読むバックエンド（memory）ではこの数に届かない」を書くと、実行基盤の上限表と特定アダプターの実装事情が同じ節に同居して節の軸が濁る。**その説明は `spec/adr/056` の本文（コンテキスト節）へ寄せる**（ステップ 20）
  - **[ADR 056] へのリンクをこの段落に置く**（計画レビュー R2 arch:S-002）
  - **既存の 3 列表（`| 経路 | 1 回の上限 | 根拠 |`）に行を足さない**。表の軸は行数の上限で、文数は軸が違う（表の意味が二重になる）
  - **`## クエリ予算` という節を新設しない**。`### Global D1` が既に「1 Worker invocation が発行してよい D1 query は 500」を持っており、二重正本になる
- **理由:** `spec/usecases/storage.md:492` が「正典は platform の『クエリ予算』」と書きながら、その見出しが存在しない（リンク切れ）。移送先を実在の節に定め、ステップ 24-3 でリンクを直す

### 30. 適合スイートに 1 ケース追加（`ADP-common-008`）

- **対象ファイル:** `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts`
- **台帳 ID:** SYNC-207（実行形）
- **変更内容:** `it("ADP-common-008: assertOwner rejects a different id and a missing receipt", …)` のケースに、**completed した barrier への `assertOwner` が `ConflictError` になる**主張を足す（adr.md ADR-012）。
  - 既存ヘルパーだけで書ける: `DECLARED_COMPONENTS` を全部 ack → `markCompleted(operationId, retainUntil)` → `await expectConflict(store.assertOwner("op-1"))`
  - `retainUntil` の作り方は同ファイルの `ADP-common-009/010` のケース（`backend.clock.now().getTime() + 120 * DAY_MS`）に合わせる
  - describe 名 / it 名の `ADP-common-008` は**変えない**（`spec/inventory/adapter.md` の行と対応する命名規約 — `spec/adr/026`、adr.md ADR-002）
  - **これ以外のテストを追加しない。** 本 Issue で許される唯一のテスト差分
- **注意:** memory アダプター（`adapters/memory/repositories/scopeCleanupAdmissionStore.ts:47-57` の `requireOwner` が `row.status !== "running"` を弾く）は**既にこの振る舞いを持つ**ので、実装変更は発生しない。`pnpm test:unit` が緑のままであることを確認する。**赤になったら前提が崩れているので、実装を変えずにステップを止めて判断し直す**
- **理由:** spec とポート JSDoc だけを直してスイートを放置すると、「completed を通す実装」も同時に緑になり、`spec/adr/026` の決定 1（JSDoc だけを読んで実装したものがスイートを通る）が成立しない（`spec/adr/046`）

### 31. `spec/inventory/usecase.md` — 本文修正への追随と 3 行の新設

- **対象ファイル:** `spec/inventory/usecase.md`
- **台帳 ID:** SYNC-212, 213, 215, 218, 219, 226, 238, 239, 243 の波及
- **変更内容:** **編集対象は ID で特定する**（括弧内の行番号は計画時点のスナップショット）。
  - **既存行の要点更新**
    - `UC-identity-005`（`startOAuthFlow`、`:15`）— 出力に `state` を含むこと、非 active な主体の `linkIdentity` を `UNAUTHENTICATED` で拒否すること
    - `UC-identity-006` / `UC-identity-007`（`:16` `:17`）— `PROVIDER_ACCOUNT_RELEASE_PENDING` の区別。**`UC-identity-007` の出力は `identityId` のまま据え置く**（`redirectTo` は `UC-identity-024` = `completeOAuthCallback` の要点に含める。計画レビュー R2 arch:P-002）
    - **（計画レビュー R2 coverage:P-005）** `UC-identity-011`（`requestPasswordReset`）— 現行の要点「既存 reset token を置換して current epoch の単回トークンを発行する」に**発行間隔（60 秒。`findPendingByUserAndPurpose` で測る）**を足す。同じ表の `UC-identity-003`（`resendVerificationEmail`）が「**発行間隔を守って**」と書いているのと非対称なままにしない（ステップ 4-6 が本文に 60 秒を書くため）
    - **（計画レビュー R2 coverage:P-005）** `UC-identity-013`（`addPasswordIdentity`）— 現行の要点「有効利用者の現在の認証手段集合を再検査し、password identity がなく総数上限内の場合だけ … 追加する」に**再認証（Google 再認可）を求めること**を足す（ステップ 4-6 が処理フローに再認証手順を新設し、エラー行を 2 行足すため）
    - `UC-storage-004`（`storeAvatar`、`:98`）— 申告値（`declaredMimeType` / `size`）を受け取らず、バイト列から判定すること
    - `UC-storage-013`（`deleteFilesByOwner`、`:107`）— 出力が turn の `status` を含むこと
    - `UC-usage-005`（`recalculateStorageUsage`、`:126`）— 実行者 `userId` を受け取ること
    - `UC-usage-007`（`deleteQuota`、`:128`）— 出力が turn（`status` / `personalCleanupCompleted`）であること
  - **新規行の採番**（末尾に追加。adr.md ADR-011）
    - `UC-identity-022` `getProfile` / `UC-identity-023` `checkHandleAvailability` / `UC-identity-024` `completeOAuthCallback`
    - 定義場所はステップ 4-7 で新設した節のアンカー（`spec/usecases/identity.md#getProfile` ほか）
    - `UC-identity-024` の要点に「flow state の `intent` だけで振り分け、返り値は intent 付きの判別共用体で、**`linkIdentity` arm が `redirectTo` を運ぶ**」を含める（計画レビュー R2 arch:P-002）
  - ヘッダーの「最終同期」日付を更新
- **注意:** **`UC-usage-001`（`getUsageSnapshot`）の要点から workspace ページングを落とさない**（SYNC-214 = スコープ外）
- **注意:** `UC-identity-001` / `002` / `020` の要点欄は SYNC-01〜27 の改訂に対しては真のままなので触らない（plan.md のスコープ節の旧判断はここに限り有効）
- **理由:** 統合により `spec/inventory/usecase.md` が本 Issue の対象に入った（AC-56 が AC-19a の「4 ファイル」を上書きする）

### 32. `spec/testcases/identity/` — 新設 3 ファイルと発行間隔の境界 2 行

計画レビュー R2（arch:P-001 / coverage:S-001）で追加した。**フェーズ A**（`spec/` 本文）に属し、ステップ 4 の後に実行する（新設 3 節の内容に 1 対 1 で対応させるため）。**ステップ 11 はこのステップの後**。

- **対象ファイル:** `spec/testcases/identity/getProfile.md`（新規）, `spec/testcases/identity/checkHandleAvailability.md`（新規）, `spec/testcases/identity/completeOAuthCallback.md`（新規）, `spec/testcases/identity/requestPasswordReset.md`（既存）
- **台帳 ID:** SYNC-238, SYNC-239 の波及, SYNC-201（テストケース表側）
- **変更内容:**
  1. **新設 3 ファイル。** 既存様式に厳密に合わせる — 1 行目が `# テストケース: {usecase 名}`、表は `| 前提条件 | 操作 | 期待結果 | 実装ステータス |` の 4 列で、**4 列目は全行空のまま**（既存 21 ファイルすべてがこの形）。内容はステップ 4-7 で書いた各節の**エラーケース表と主要な成功経路に 1 対 1** で対応させる。最小で足りる（網羅は実装スライスの仕事）。粒度の参考は同ディレクトリの `listIdentities.md`（6 行）/ `signOut.md`（4 行）
     - `getProfile.md` — 自分のプロフィールが返ること / 応答に秘匿値（ハッシュ・トークン）が含まれないこと
     - `checkHandleAvailability.md` — 未使用のハンドルが利用可能と返ること / 自分が既に使っているハンドルの扱い / 他人が使っているハンドルが利用不可と返ること / 形式が不正なハンドルの拒否
     - `completeOAuthCallback.md` — `intent: "signIn"` の state で `signIn` arm が返ること / `intent: "linkIdentity"` の state で `linkIdentity` arm が返り `redirectTo` を運ぶこと / 経路の `:provider` が state に保存されたものと一致しない場合に state 無効として扱うこと（実装 `application/identity/completeOAuthCallback.ts:30-33`）
  2. **`requestPasswordReset.md` に発行間隔の境界 2 行を足す**（SYNC-201 のテストケース表側。coverage:S-001）。現行は「同じメールアドレスへの要求が短時間に連続する｜レート制限がかかり…」の 1 行だけで、60 秒という値も境界も無い。同ディレクトリの `resendVerificationEmail.md` が持つ 2 行と**同じ粒度・同じ書式**にそろえる。
     - `| 直近 59 秒以内に要求済み | 再設定を要求する | 新しいトークンは発行されず、成功として返る | |`
     - `| 直近 61 秒前に要求済み | 再設定を要求する | 新しい再設定メールが送られる（間隔制限の境界値） | |`
     - **既存の「短時間に連続する」行は残す**（誤りではない）。境界 2 行を足して粒度をそろえるだけ
- **注意:** **TC ID をこのファイルに書かない。** `spec/testcases/*/*.md` の表に TC ID は 1 つも書かれておらず、ID は `spec/inventory/test.md` の行が持つ（ステップ 11 で **identity 群の末尾**に採番する）
- **注意:** ステップ 31 の `UC-identity-022`〜`024` と**ファイルが 1 対 1 で対応**していること。9 ドメインすべてで「1 ユースケース = 1 テストケースファイル = 1 UC 行」が成立しており（conversion 4 / identity 21 / integration 15 / job 12 / note 36 / storage 13 / tag 14 / usage 7 / workspace 21 — 3 つの数がすべて一致）、identity だけ 24 / 21 / 24 にしない
- **理由:** adr.md ADR-016。本 Issue が潰そうとしている類型（生成物が本文に追随していない）を自分で作らない
