# 実装計画 — Issue #21: [identity] identityRemovalRelease の解放判定と beginRelease のあいだの TOCTOU を閉じる

**Issue:** #21
**作成日:** 2026-08-24
**規模:** 通常
**実装方針:** steps.md

---

## 目的

「identity 行は残っているのに directory の一意性予約だけが消えた（または identity 行が二重に生えた）」状態への到達経路を、`IdentityUniqueDirectory` のポート契約を確定させることで塞ぐ。複数ワーカー / リモート DB 配備（#11 / #19）を実装する前に、契約側を先に決め切る。

## 受け入れ基準

| # | 基準（検証可能な形で） | 由来 | 対応ステップ |
|---|---|---|---|
| AC-1 | `IdentityUniqueDirectory.beginRelease` が「解放しようとしている claim が、呼び出し側が観測したものと同一であること」を条件に取り、条件が外れた場合は no-op になる。条件は省略できない（型として必須） | Issue 本文「ポート契約の拡張」 | 1, 3 |
| AC-2 | 呼び出し側が claim を観測する手段がポートにあり、観測値は不透明（比較専用）である。契約はポート定義の JSDoc と `spec/domains/identity.md#ポート` の両方に書かれている | Issue 本文 / ADR 026 / ADR 052 | 1, 11 |
| AC-3 | 適合スイートに次の 6 点を拘束するケースがあり、memory バックエンドが通る。(a) claim の観測、(b) 取り壊して張り直された claim は前の観測値と一致しない — **張り直しが同じ `operationId` で行われた場合でも**一致しない、(c) 観測値が古い `beginRelease` は現行 claim を壊さない、(d) 4 状態（行なし / `reserved` / `active` / `releasing`）のいずれでも `resolve(k,n)` と `resolveClaim(k,n)?.userId ?? null` が一致する、(e) `releasing` 行は別 operation の `beginRelease` に奪われず、自 operation の `release` だけが落とせる、(f) 観測値は claim が生きているあいだ不変（冪等な `activate` の再実行を挟んでも変わらない） | ADR 026 / ADR 052 | 3, 4 |
| AC-4 | `removeIdentity` の解放判定 UoW が**コミットした直後**に「先行配送の解放 + 本人の再連携」を差し込む注入テストで、`resolve("providerAccount", key)` が新しい所有者を返し続け、再連携で作られた identity 行も残る。観測を判定 UoW より後に取る実装ではこのテストが落ちる | Issue 本文の受け入れ基準案（経路 1） | 5, 6, 9 |
| AC-5 | 予約サガを commit 後・`activate` 前で止め、`reserved` を TTL 失効させてから再連携する注入テストで、`linkOAuthIdentity` / `completeOAuthSignIn`（既存利用者への追加）のどちらでも identity 行が 1 件のままで、claim が `active` に復旧する | Issue コメントの受け入れ基準案（経路 2） | 2, 7, 8, 10 |
| AC-6 | 既存の逐次再配送ガード（`removeIdentity.test.ts` の「keeps the re-linked claim when the removal event is redelivered」など）が従来どおり動き、`updateProfile`（旧 handle）/ `deleteAccount`（全鍵）の解放が従来どおり claim を落とす。`checkHandleAvailability` の「取り壊し中は free に見える」も従来どおり（`beginRelease` の直接呼び出しを観測値付きに直したうえで） | 回帰 | 3, 4, 5, 6, 9, 13 |
| AC-7 | 契約変更が `spec/domains/identity.md`（`#ポート` と `#ドメインサービス` の両方）・`spec/inventory/{adapter,domain,test,usecase}.md`・`spec/testcases/identity/*.md`・`spec/usecases/identity.md` に反映され、ADR 060 が起票されて `spec/adr/index.md`（一覧と前提依存マップ）・ADR 038・ADR 054 の記述が整合する | CLAUDE.md「spec は現在有効な設計の正典」/ ADR 052 / ADR 058 | 11, 12 |
| AC-8 | `beginRelease` 済み・`release` 前で中断した解放が残した `releasing` 行が、同じ removal event の再配送で回収され、その鍵を別の利用者が再び `reserve` できる。`releaseObservedUniqueKey` が観測 null で早期 return する実装ではこのテストが落ちる | ADR-004 / ADR-007（孤児 `releasing` 行の唯一の回収経路） | 5, 6, 9, 11 |

AC-1 / AC-2 の注記: Issue 本文は条件を逐語で「対象行の `operationId` / `userVersion` が読んだときと同じであること」と書いているが、本計画は不透明な `claimToken` に読み替えている。`operationId` は生の鍵（メールアドレス / handle / provider account ID）を合成に含むため ADR 048 の「鍵の値をディレクトリの外のシンクへ出さない」に反し、かつ `updateProfile` の親 operation ID は決定的なので claim ごとに異なるとは限らない（＝塞ぎたい「別の claim なのに一致する」状況が残る）。読み替えの根拠は adr.md ADR-002。

AC-3(b) の注記: 「張り直した claim は前の観測値と一致しない」を**別の `operationId` で張り直す**形だけで拘束すると、`claimToken = f(kind, key, operationId)` のようにトークンを `operationId` から導くバックエンドがそのままスイートを通ってしまう。ところが ADR-002 が `operationId` を条件に採らなかった直接の理由は「`updateProfile` の予約 operation ID は `profileOperationId(userId):handle:X` で決定的なので、handle X を付け → 外し → 付け直すと**同じ operationId の claim が 2 回生まれる**」という到達可能な列である。弱い形のケースでは、契約の実行形（ADR 026 決定 2）が ADR-002 の判断を担保できない。したがって適合ケースは**同じ `operationId` で張り直す**強い形で書く（memory は行を書くたびに採番するので実装側の追加コストはない — `release` が行を削除するので、同じ `operationId` の `reserve` も新しい行を書く）。

AC-4 の注記: Issue 本文が逐語で挙げる列（`removeIdentity` の配送を止めたまま `linkOAuthIdentity` を走らせる）は現行コードでは到達できない。claim が `active` のあいだは `linkOAuthIdentity.existingLinkId` が identity 行の不在を見て `PROVIDER_ACCOUNT_RELEASE_PENDING` を投げるため、再連携は `reserve` まで届かない。到達しうる唯一の織り込みは「先行配送が解放を完了 → 本人が再連携 → 判定を済ませていた後続配送が `beginRelease` に到達」で、AC-4 はその形を要求している（Issue の意図を弱めてはいない）。

## スコープ

### 含まれないもの

- **Cloudflare（D1 / DO）アダプターの実装** — 契約と適合スイートを先に確定させるのが本 Issue。新バックエンドは同じスイートで拘束される（#11）。
- **application レベルの OCC リトライ導入** — CLAUDE.md が「意図的に置かない」としている。CAS が外れた場合は no-op（＝解放しない）で収束させる。
- **`reserved` 行の TTL 値・失効掃除の見直し** — 経路 2 は「TTL 失効後の再連携が identity 行を二重に生やす」ことを塞ぐのが目的で、TTL 設計そのものは変えない。
- **`releasing` 行への期限の導入** — 取り壊しの途中で落ちた operation が残す `releasing` 行は、同じ operation の `release` 再実行だけが落とせる（AC-3(e)）。ワーカー経路（`identityRemovalRelease` / `globalCleanup`）は event 再配送が同じ operation ID を再導出するので、**その行が隔離されない限り**自力で収束する（AC-8）が、同期経路の `updateProfile` は再実行の主体が居ないため旧 handle が固まりうる。この残骸の回収手段は本 Issue では足さない。
- **`resolve` を返り値ごと置き換える全面リファクタリング** — `resolve` の呼び出し元 9 か所は本 Issue の振る舞いに関与しない（adr.md ADR-003）。
- **`updateProfile` / `deleteAccount` の解放が持つ窓** — 両者は観測と `beginRelease` が連続するので、契約変更には追随するが窓は縮むだけで閉じない（Issue 本文が「読み直しは窓を縮めるだけ」と退けた形と同じ）。同一利用者の並行 `updateProfile`（X→Y と X→Z が同時に旧 handle X を解放しにいく）は本 Issue では閉じない。
- **OAuth identity 同定述語の 3 経路統一** — `linkOAuthIdentity.existingLinkId` は `(provider, providerAccountId)` の 2 列比較、`completeOAuthSignIn.signInLinkedUser` と `identityRemovalRelease.stillClaimed` は合成鍵 `providerAccountKey(...)` 比較で書かれている。本 Issue は前者を `IdentityPolicy.findOAuth` に寄せるが、合成鍵側の 2 経路は述語の形が非対称のまま残る（ADR 038 の 3 経路が同じ**意味**の述語を使う状態は保たれる）。統一は本 Issue の 2 経路を閉じるのに必須ではないので行わない。
- **`email` / `handle` の同型の残骸** — 「commit 済み・`activate` 失敗 → `reserved` が TTL 失効 → 別の要求が同じ鍵を `reserve` できる」という構造は `signUpWithPassword`（email）や `updateProfile`（handle）にもある。`findOAuth` に相当する治癒はそちらには入れない（Issue コメントが要求しているのは provider account だけ）。
- **別利用者にまたがる残骸の修復** — 経路 2 で「利用者 A の activate 喪失後、利用者 B が同じ外部アカウントを取り直す」形は、A の identity 行だけが後ろ盾を失う。単一利用者内の重複（Issue コメントの受け入れ基準）とは別問題で、ADR 038 の「解放が落ちたら固まる」方針の範囲。本 Issue では閉じず、リスクとして記録する。
- **`completeOAuthSignIn` の `createNew` 分岐（同一メールの利用者が 2 人生える列）** — 新規サインアップの `createUser` は email と providerAccount の 2 鍵を同じ親 operation で予約し、`activateUniqueKeys` は 1 本目（email）の activate が失敗して `confirm` 後の再試行も失敗するとそこで throw して 2 本目に到達しない。つまり activate 喪失の最頻形は**両鍵とも `reserved` のまま残る**形で、TTL 失効後の再サインインでは `resolve("email")` も null を返すため `existingUser` が引けず、**メールが一致していても** `AccountLinkingPolicy.decide(null, true)` が `createNew` を返す。`reserve` は失効した `reserved` 行を奪えるので新規予約も通り、結果は**同じメールアドレスを持つ利用者が 2 人**（`spec/domains/identity.md` の「`email` はサービス全体で一意」を破る状態）。Issue 本文の「メールが違えば、別アカウントが新規に作られる」とは別物で、経路 2 が生む残骸の中で最も重い。閉じるには provider account 鍵からの逆引き（別 shard の読み）と email 側の治癒が要り、Issue コメントの受け入れ基準（1 利用者の identity 行が 1 件）を越えるので本 Issue では閉じない — 別 Issue 候補として下の「リスクと注意点」に記録する（判断の根拠は adr.md ADR-009）。
  - 一方、**email だけ activate 済み・providerAccount 鍵が失効**した部分失敗は本計画の治癒が効く（`resolve("email")` が引けるので `linkToExisting` → `attachToExistingUser` → `findOAuth`）。AC-5 が対象にするのはこちらの列。

## リスクと注意点

- **観測の順序が正しさの本体**。claim の観測は解放判定 UoW の**前**に取らなければならない。`beginRelease` の直前で読むと、再連携後の新しい claim を観測して CAS が素通りする（Issue 本文の「読み直しは窓を縮めるだけ」はこの意味でも当たっている）。この順序は AC-4 の注入テストが落とす形で拘束する（レビュー目視には委ねない）。
- **CAS が外れたときの正しい振る舞いは「何もしない」**。エラーにすると再配送が止まらず、隔離までカウントが進む。解放しないまま収束させる。ただし `beginRelease` は `Promise<void>` を返す契約のままなので、**呼び出し側からは「トークン不一致で no-op になった」と「取り壊した」が区別できない** — ログに残せるのは実質「観測が null だった（claim が既に無い / 別利用者）」分岐だけで、CAS が外れた回数はカウントできない。返り値を増やすのは契約変更（適合ケースも要る）なので本 Issue では足さず、複数ワーカー化（#11 / #19）の際の観測性課題として残す。ログには鍵の値を出さない（ADR 048）。
- **`release(operationId)` は CAS の結果によらず、観測が null でも常に呼ぶ**。呼ばないと `beginRelease` と `release` のあいだで落ちた配送が残した `releasing` 行を再配送が掃除できなくなり、その鍵が恒久的に使用不能になる。ADR-007 でこれが唯一の回収経路になったので、AC-8 / TC-identity-345 が実行形として拘束する。
- **無条件の `release(operationId)` と決定的な操作 ID の組み合わせ**は、複数ワーカー配備では理屈上の窓を残す。`updateProfile` の解放 ID は `${profileOperationId(userId)}:release:handle:${handle}` で利用者と鍵から決定的に決まるので、遅れて届いた古い解放の `release` が、同じ利用者が同じ handle を取り直した直後の `reserved` 行を落としうる（`release` は `reserved` 行も落とす）。`beginRelease` の CAS はこの経路を守らない。本 Issue のスコープ外だが、複数ワーカー化（#11 / #19）の際に再検討する。
- **観測値をログ・イベント・受領に出さない**。契約上は不透明だが、バックエンド次第では鍵に由来する値になりうる（ADR 048 の運用と揃える）。
- **`activate` の冪等再実行で観測値が変わらないこと**が CAS の前提。適合スイートで拘束する。
- 経路 2 の修正は「重複を弾く」ではなく「既存行を再利用して claim を復旧させる」。弾く実装にすると、activate 喪失で生まれた identity 行が永久に後ろ盾を持てなくなる。
- `IdentityPolicy.ensureAddable`（上限 8 件）は**重複判定より後**に置く。順序を逆にすると、8 件の利用者が自分の既存 identity を治癒できなくなる。
- 解放判定のたびに directory 読みが 1 回増える（`keep` に倒れる再配送でも発生）。件数に上限のある単一行読みなので許容する。
- **経路 2 の残骸のうち「両鍵とも `reserved` のまま失効」した列は本 Issue で閉じず、同一メールの利用者が 2 人生えうる状態が残る**（スコープ「含まれないもの」参照）。`email` の一意性不変条件を破る残存リスクなので、別 Issue として起票する。
- 適合スイートの既存 `beginRelease` ケース 6 件はすべて条件付き呼び出しに書き換わる。書き換えの過程で「別利用者は no-op」「`reserved` は no-op」の拘束を薄めないこと（所有者不一致ケースには**正しい観測値**を渡す）。
- **`expectedClaimToken` の必須化はコンパイルエラーとして波及する**。`beginRelease` を直接呼んでいる箇所を洗い出した結果は次のとおりで、対応はすべてステップに載っている。
  - `packages/core/src/application/identity/uniqueness.ts:181` — 唯一の本番呼び出し元。ステップ 5 で 2 段に組み替える。
  - `packages/core/src/adapters/conformance/identityUniqueDirectory.ts:167` — スイートの `beginRelease` ヘルパー。ステップ 4 で「`resolveClaim` で観測してから渡す」形に変える。
  - `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts:119` — 実装側。ステップ 3。
  - `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts:67` — **ユースケーステストからの唯一の直接呼び出し**。オブジェクトリテラルで引数を組んでいるので必須化で型エラーになる。正しい直し方は「先に `resolveClaim("handle", "ichiro")` して観測値を渡す」で、ダミー文字列を渡すと `beginRelease` が no-op になり `available: true` の主張が黙って落ちる。ステップ 9 で扱う。
  - `packages/core/src/application/identity/__tests__/deleteAccount.globalCleanup.test.ts:167` — `beginRelease: () => Promise.reject(...)` のスプレッド差し替え。引数を取らない関数は引数が増えても代入可能なので**壊れない**（`updateProfile.test.ts` / `completeOAuthSignIn.test.ts` の差し替えも同様に実ディレクトリのスプレッドなので `resolveClaim` の追加で壊れない）。

## テスト方針

- **適合スイート**（`adapters/conformance/identityUniqueDirectory.ts`、memory が実行）
  - 新 ID `ADP-identity-042`: claim の観測は `active` の行だけを返す / 観測値は claim が生きているあいだ安定（冪等 `activate` を含む）/ 取り壊して**同じ `operationId` で**張り直した claim の観測値は前と異なる / 4 状態すべてで `resolve` と `resolveClaim` が一致する。
  - `ADP-identity-041` の拡張: 古い観測値を渡した `beginRelease` は現行 claim を壊さない / `releasing` 行は別 operation の `beginRelease` に奪われない。既存 6 ケース（解放できる / `releasing` は他人に奪えない / 冪等 / 別利用者は no-op / `reserved` は no-op / 行なしは no-op）は条件を満たす観測値を渡す形に書き換えて維持。
- **ユースケーステスト**（`application/identity/__tests__/`、`createTestHarness` + 実アダプターの薄いラッパー。fake は足さない）
  - TC-identity-342（`removeIdentity.test.ts`）: `workerContainer` の `globalUnitOfWorkProvider` を「実プロバイダーに委譲し、`run` が解決した直後に 1 度だけ割り込む」ラッパーに差し替え、割り込みで「先行配送の解放」＋「本人の再連携」を実行する。割り込み後も `resolve` が本人を返し、再連携された identity 行が残ることを検証。修正前は落ちる。観測を判定 UoW より後に取る実装でも落ちる。
  - TC-identity-343（`linkOAuthIdentity.test.ts`）: `activate` が必ず失敗するラッパーで再連携サガを commit 後に停止 → `clock.advance(UNIQUE_RESERVATION_TTL_MS + 1)` → 実コンテナで再連携。identity 行が 1 件、`resolve` が本人（＝ claim が `active` に復旧）、返る `identityId` が既存行の ID。
  - TC-identity-344（`completeOAuthSignIn.test.ts`）: 同じ形を「既存利用者への追加」分岐で。前提として **provider が返す email が既存利用者の account email と一致する**ように仕込み、`attachToExistingUser` に落とす。identity 行が 1 件、`resolve` が本人（＝ claim が `active` に復旧）、セッションが発行される。`CompleteOAuthSignInView` は `identityId` を持たないので、343 の「返る `identityId` が既存行の ID」はこちらには適用しない。
  - TC-identity-345（`removeIdentity.test.ts`）: `identityUniqueDirectory.release` が最初の 1 回だけ throw するラッパーで配送 1 を `beginRelease` 済み・`release` 前で中断 → 素の container で同じ event を再配送 → `directoryRow(h, key)` が消え、別の利用者がその鍵を `reserve` できる。`releaseObservedUniqueKey` が観測 null で早期 return する実装では落ちる（AC-8）。
- **回帰**: `pnpm test`（identity のユースケース群と memory の適合ラン）、`pnpm typecheck && pnpm lint:fix && pnpm format`。
