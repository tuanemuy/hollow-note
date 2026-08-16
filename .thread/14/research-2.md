# 調査結果 2 — Issue #14（Issue #2 / PR #17 由来の乖離）

対象 HEAD: `55a5bb9`（PR #17 / Issue #2 マージ済み）。`.thread/14/research.md` の SYNC-01〜27 とは別系列で、**SYNC-201 番台**を採番する。

> **as-of `55a5bb9`。** 本文の「現在の spec / 現在の実装」という記述と、すべての行番号参照（`path:123` / `L123` の両形式）は `55a5bb9` 時点のものである。Issue #14 は本台帳の「残」を反映したので、HEAD では引用文も行番号も一致しない。台帳を根拠として読むときは `git show 55a5bb9:<path>` で当たること。行番号を HEAD に合わせて振り直していないのは意図的で、基準 commit を固定するほうが以降の変更に対して安定するため。

## 一次ソースと採番

- Issue #14 のコメント（分類表）は合計 **38 件**と書いているが、Issue #2 のコメント「spec-sync 候補」／`.thread/2/progress.md` L220〜285 の箇条書きを ID 単位でほどくと **42 項目**（SYNC-201〜242）になる（分類表は複数の箇条を 1 行に畳んでいる）。
- そこに本調査で見つけた同種の乖離 1 件（SYNC-243）と、統合作業で採番した 1 件（SYNC-244）を足し、**台帳は 44 項目**（本ファイル「集計」節の表と一致）。
- すべて `spec/` の該当ファイルと実装コードを実際に読んで裏を取った。progress.md の記述は Issue #2 実装時点のスナップショットとして扱い、そのまま転記していない。

判定の凡例: **残** = まだ乖離あり（本 Issue で直す） / **済** = 既に解消済み（何もしない） / **外** = スコープ外（別 Issue・後続スライス） / **重** = SYNC-01〜27 と重複

## 前提: 倒す向きの規則（`spec/adr/046`）

`spec/adr/046-port-contract-divergence.md:22-26` —「一律に JSDoc へ寄せるでも実装へ寄せるでもなく、**その振る舞いの正本がどこにあるか**で倒す向きを決める」「乖離は『見つけたら倒す』対象になり、記録して先送りする選択肢を残さない」。

**本 Issue に固有の重要な事実**: PR #17 は `spec/adr/` へ ADR 29 本（`023`〜`051`）と `index.md` の計 30 ファイルを昇格させている（`git diff --name-only cea6134..55a5bb9 -- spec/adr/`）。つまり **Issue #2 の設計判断の多くは既に `spec/` の正典に入っており、追随していないのは下流（`spec/domains/` `spec/usecases/` `spec/pages/` `spec/database/` `spec/inventory/` `spec/manual-tests/`）だけ**である。これは `.thread/14/research.md` の SYNC-02 / SYNC-10 / SYNC-20 と同じ「ADR が正、下流 spec が未追随」の形で、倒す向きの判断材料が既に `spec/` 内にある。

昇格済み ADR と Issue #2 ADR 番号の対応（本台帳で使う分）:

| `spec/adr/` | 表題 | `.thread/2/adr.md` の該当 |
| --- | --- | --- |
| 034 | 認可往復のブラウザー束縛 | ADR-034 系 |
| 035 | コールバックの単一ルート | ADR-036 / ADR-045 |
| 038 | claim と identity 行 | ADR-038 |
| 039 | 参加者の全数宣言 | ADR-002 / ADR-017 / ADR-018 |
| 041 | 継続イベント ID の決定的導出 | ADR-019 |
| 043 | 平面をまたぐ引き渡し | ADR-106 |
| 044 | しきい値の置き場 | ADR-013 / ADR-044 |
| 045 | 重複排除の要否 | ADR-012 / ADR-045 |
| 047 | 削除の進捗チケット | ADR-006 / ADR-062 |
| 048 | 予約の操作 ID | ADR-035 / ADR-044 |
| 049 | 公開 URL と用途の絞り込み | ADR-011 |
| 050 | アップロードの受理 | ADR-048 / ADR-078 |
| 051 | 自オリジンの述語 | ADR-051（同一オリジン判定） |

---

## 台帳

### A. ポート定義に足りない / 増えたメソッド（11 件）

#### SYNC-201 — `AuthTokenRepository.findPendingByUserAndPurpose` の追加 【残】

- 反映先: `spec/domains/identity.md:398-408`（`AuthTokenRepository` interface）**と `spec/testcases/identity/requestPasswordReset.md`（テストケース表）**。波及 `spec/inventory/domain.md:88-93`（DOM-identity-042〜047 の次に 1 行）、`spec/inventory/adapter.md:66-71`（ADP-identity-021〜026 の次に 1 行）、`spec/inventory/test.md`（identity 群の末尾に 2 行）
  - **テストケース表も反映先に含める。** `.thread/2/progress.md` の該当箇条が「`spec/domains/identity.md` のポート定義**とテストケース表の両方**に追記が要る」と書いており、実物も `spec/testcases/identity/resendVerificationEmail.md` が「直近 59 秒以内 / 直近 61 秒前」の境界 2 行を持つのに対し、`spec/testcases/identity/requestPasswordReset.md` は「同じメールアドレスへの要求が短時間に連続する｜レート制限がかかり…」の 1 行だけで、60 秒という値も境界も無い。ステップ 32 で 2 行足す
- 現在の spec: interface に `insert` / `findByTokenHash` / `save` / `deleteByUserAndPurpose` / `deleteOlderEpochByUser` / `deleteExpired` の 6 メソッドのみ
- 現在の実装: `packages/core/src/domain/identity/ports/authTokenRepository.ts:29-32` — `findPendingByUserAndPurpose(userId, purpose): Promise<PendingAuthToken | null>`。JSDoc（`:21-27`）が「`auth_tokens` の (`user_id`, `purpose`) 部分一意索引が保証する at-most-one live token。再送間隔を測る唯一の読み取り」と根拠を書いている。利用者は `resendVerificationEmail.ts:71` / `requestPasswordReset.ts:88`
- 倒す向き: **実装が正**。当該部分一意索引は既に `spec/database/index.md#auth_tokens` にあり、その索引を読む口が spec のポートに無かっただけ。約束を足す設計判断ではなく記載漏れ
- 判定: 要修正
- 根拠: `spec/adr/046` の「正本が設計側にある場合は契約として書き直す」— 索引の正本が `spec/database/index.md` にあるので、ポート側がそれに追随する

#### SYNC-202 — `SignInOAuthClient.deriveCodeChallenge` の追加 【残】

- 反映先: `spec/domains/identity.md:450-453`（`SignInOAuthClient` interface）。波及 `spec/inventory/domain.md:100,101`（DOM-identity-054/055）、`spec/inventory/adapter.md:78,79`（ADP-identity-033/034）
- 現在の spec: `buildAuthorizationUrl` / `exchangeCode` の 2 メソッド。`codeChallenge` は `buildAuthorizationUrl` の引数として渡ってくるだけで、誰が導出するかを書いていない。`spec/usecases/identity.md:222`（手順 3）が「`codeChallenge` を算出する」とだけ書き、主体が無い
- 現在の実装: `packages/core/src/domain/identity/ports/signInOAuthClient.ts:29` — `deriveCodeChallenge(codeVerifier: string): string`。JSDoc `:12-27` が「PKCE challenge は S256 の**プロトコル規定の表現**であって、アダプターが自由に選べる保存用ハッシュではない。プロトコルを既に知っているポートに置くことで application 層をハッシュ表現から解放する」と理由を持つ。呼び出しは `startOAuthFlow.ts:91`
- 倒す向き: **実装が正**
- 判定: 要修正
- 根拠: `.thread/2/adr.md` ADR-010。`spec/adr/046`「正本が実装側にある場合は責務の所在を契約に明記する」

#### SYNC-203 — `ObjectStorage` の 3 点差分（`publicUrl` 追加 / bytes 専用 / `createDownloadUrl` 未実装）【残・部分外】

- 反映先: `spec/domains/storage.md:285-305`（`ObjectStorage` interface と説明段落）。波及 `spec/inventory/domain.md:209-212`（DOM-storage-032〜035）、`spec/inventory/adapter.md:161-164`（ADP-storage-018〜021）
  - **`spec/usecases/storage.md` 側の波及**。domain の署名だけ狭めると同ファイル群に内部矛盾が残る:
    - **宣言値 4 か所** — `:22`（`startBulkUpload` の `files: { fileName; declaredMimeType; size }[]`）/ `:74` `:75`（`storeUpload` の入力 DTO）/ `:136`（`storeMedia`）/ `:167`（`storeAvatar` = SYNC-212 が既に扱う）。**`spec/adr/050` の決定 1「入力から宣言値を落とす」は無条件**なので、`storeAvatar` だけ直すと 3 か所が「昇格済み ADR に下流が未追随」のまま残る
    - **ストリーム入力 2 か所** — `spec/usecases/storage.md:76`（`storeUpload` の `body: ReadableStream<Uint8Array>`）と `spec/usecases/integration.md:332`（`stream: ReadableStream<Uint8Array>`）。**どちらも未実装**なので spec 側は残し、`spec/adr/050` の前提「ストリームを通す用途が現れた時点で、その要求とともに広げる」の要求元として `spec/domains/storage.md` の引き継ぎ段落から名指しする（ステップ 22）
- 現在の spec:
  - `put(key, body: ReadableStream<Uint8Array> | Uint8Array, meta)` / `get(key): Promise<ObjectBody | null>` で `ObjectBody = { stream: ReadableStream<Uint8Array>; meta }`
  - `createDownloadUrl(key, { fileName, expiresInMs })` を持つ
  - `publicUrl` は spec 全域に 0 件
- 現在の実装: `packages/core/src/application/ports/objectStorage.ts:46-51` — `put(key, body: Uint8Array, meta)` / `get` は `ObjectBody = { bytes: Uint8Array; meta }`（`:14-17`）/ `deleteMany` / `publicUrl(key): string`。`createDownloadUrl` は無い
- 倒す向き: **3 点で違う**
  1. `publicUrl` の追加 → **実装が正**（`spec/adr/049` が既に「公開 URL の組み立てをポートに持たせ、配備ごとの形をアダプターに閉じる。期限つき URL と公開 URL は別のメソッドとして型で分ける」と昇格済み）
  2. `put` / `get` のバイト列専用化 → **実装が正**（`spec/adr/050`「保管ポートの `put` が返すのは、書いたバイト列から測った値」）
  3. `createDownloadUrl` が実装に無い → **spec が正**。これは乖離ではなく未実装（`issueDownloadUrl` / `exportNote` を持つスライスが実装する）。spec から**落としてはならない**
- 判定: 要修正（1・2）／スコープ外（3 — 実装が追いつくのを待つ）
- 根拠: `spec/adr/049` / `spec/adr/050`。ADR-046 の「契約を弱めた側は責務の移転を引き継ぎとして残す」に従い、ストリーム経路を落とすことを説明段落に明記する

#### SYNC-204 — `StorageQuota.replaceTotals` の追加 【残】

- 反映先: `spec/domains/usage.md:72-84`（`StorageQuota` の**振る舞い**表）。波及 `spec/inventory/domain.md:448`（DOM-usage-006）
- 現在の spec: 振る舞い表は `initialize` / `add` / `subtract` / `incrementNotes` / `decrementNotes` / `changeLimit` / `headroom` / `warningLevel` / `ensureCanStore` の 9 メソッド。**すべて差分**で、置換メソッドが無い
- 現在の実装: `packages/core/src/domain/usage/storageQuota.ts:76` — `replaceTotals(quota, { consumedBytes, noteCount }, now)`。呼び出しは `recalculateStorageUsage.ts`（JSDoc「スキャン結果は差分ではなく正本なので `replaceTotals` で上書きする」）
- 倒す向き: **実装が正**。`spec/usecases/usage.md:180`（`recalculateStorageUsage` 手順 3）が既に「`StorageQuota` の値を**置き換えて**保存する」と書いており、その置換を行うメソッドが振る舞い表に無いだけ
- 判定: 要修正
- 根拠: `.thread/2/adr.md` ADR-029。`spec/adr/046`「正本が設計側」— usecase 側の記述に domain 側の表が追随する

#### SYNC-205 — `IdentityUniqueDirectory.beginRelease` と `releasing` 状態 【残】

- 反映先: `spec/domains/identity.md:357-362`（interface）と `:369`（エラーケース行）。波及 `spec/inventory/domain.md:73-76`（DOM-identity-027〜030）、`spec/inventory/adapter.md:51-54`（ADP-identity-006〜009）
- 現在の spec: `resolve` / `reserve` / `activate` / `release` の 4 メソッド。`releasing` 状態も `beginRelease` も interface に無い。ただし `spec/domains/identity.md:508`（ドメインイベント表 `identity.identity.removed`）が既に「global consumer が **releasing→release** する」と書いており、**spec の中で状態の存在だけが先に漏れている**
- 現在の実装: `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts:56-63` — `beginRelease({ kind, normalizedKey, expectedUserId, operationId })`。非対称は JSDoc に明記済み: `resolve` は「merely reserved or already `releasing` は `null`」（`:28-29`）、`beginRelease` は「`reserved` の行は no-op」（`:50-54`）、`release` は「`reserved` と `releasing` を落とす。activate 済みは触らない」（`:64-65`）。**4 つ目の非対称**: `reserve` は `releasing` の行を**奪えない** — `adapters/memory/repositories/identityUniqueDirectory.ts:48-67` の `reservationLapsed` は `existing.state === "reserved"` かつ期限切れのときだけ真で、`releasing` 行に対しては `ConflictError`（`EMAIL_ALREADY_USED` / `HANDLE_ALREADY_USED` / `PROVIDER_ACCOUNT_ALREADY_LINKED`）を投げる。`.thread/2/progress.md` の該当箇条も「`resolve` は `releasing` を解決せず、**`reserve` は `releasing` を塞ぐ**という非対称」と 2 つの述語を挙げている。契約に無いと、次のバックエンド実装者が「解放途中の鍵を再予約で奪える」実装を書きうる
- 倒す向き: **実装が正**。ADR-038（昇格済み `spec/adr/038` = claim は索引）が「claim と identity 行が別の物理境界にあり配送が at-least-once」を前提とし、2 相の取り壊しはその帰結
- 判定: 要修正
- 根拠: `.thread/2/adr.md` ADR-015 / ADR-028、`spec/adr/038`

#### SYNC-206 — `ScopeCleanupAdmissionStore.describePersonalCleanup` の追加 【残】

- 反映先: `spec/domains/index.md:74-83`（`ScopeCleanupAdmissionStore` interface）と `:124` の説明段落。波及 `spec/inventory/domain.md:11-18`（DOM-common-005〜012）、`spec/inventory/adapter.md:10-17`（ADP-common-004〜011）
- 現在の spec: `assertWritable` / `assertActorWritable` / `beginPersonalAccountDeletion` / `abortPersonalAccountDeletion` / `assertOwner` / `acknowledgePersonalComponent` / `markCompleted` / `pruneCompleted` の 8 メソッド。進捗を読む口が無い
- 現在の実装: `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts:73-75` — `describePersonalCleanup(operationId): Promise<PersonalCleanupProgress | null>`。JSDoc `:53-58` が「再駆動された継続を安く決着させるためのもの — barrier がまだ running か、どの component が ack 済みかを答える」
- 倒す向き: **実装が正**。`spec/adr/039` の決定に「再駆動を冪等にするため、**掃除の進捗を読む読み取りを 1 本持つ**」が既に含まれている
- 判定: 要修正
- 根拠: `spec/adr/039`（昇格済み）。ADR が正、interface が未追随

#### SYNC-207 — `assertOwner` が `completed` の barrier も `ConflictError` で弾く 【残・契約の明示が必要】

- 反映先: `spec/domains/index.md:79`（`assertOwner`）と `:124` の説明段落（「cleanup consumerは…別ID・欠落・未commitを拒否する」）。加えて実装側 JSDoc（`application/ports/scopeCleanupAdmissionStore.ts:36-38`）と適合スイート（`adapters/conformance/scopeCleanupAdmissionStore.ts:68-73` の ADP-common-008）
- 現在の spec: `:124`「cleanup consumerはremote D1を読まず、**別ID・欠落・未commit**を拒否する」— **completed への言及なし**
- 現在の実装: `packages/core/src/adapters/memory/repositories/scopeCleanupAdmissionStore.ts:47-57` の `requireOwner` が `row.status !== "running"` でも `foreignOperation()`（`ConflictError("CLEANUP_OPERATION_MISMATCH")`）を投げる → `assertOwner`（`:112-114`）は completed barrier を弾く。適合スイート `ADP-common-008`（`conformance/scopeCleanupAdmissionStore.ts:68-73`）は「別 ID」と「receipt 不在」の 2 ケースだけで、completed を固定していない
- 倒す向き: **実装が正**。ただし周囲の設計意図（`markCompleted` / `acknowledgePersonalComponent` は完了済みを冪等に受ける — `spec/adr/039`「完了済みへの ack 再送と完了の再宣言は成功する no-op」）と逆向きに見えるため、契約として明示しないと次のバックエンドが逆に実装する
- 判定: 要修正（spec 本文 + ポート JSDoc）。**適合スイートへの 1 ケース追加はテストコードの変更**なので、ドキュメント同期の範囲を出るかは plan 側の判断が要る
- 根拠: `spec/adr/046` が名指しする「JSDoc が実装より弱い」ケースそのもの。「JSDoc だけを読んで実装したものがスイートを通る」が今は成立していない（completed で通す実装を書いてもスイートが緑になる）

#### SYNC-208 — `AccountDeletionManifestStore.describe` の追加 【残】

- 反映先: `spec/domains/index.md:85-100`（interface）。波及 `spec/inventory/domain.md:19-32`（DOM-common-013〜026）、`spec/inventory/adapter.md:18-31`（ADP-common-012〜025）
- 現在の spec: `begin` 以下 15 メソッド。header を読む口が無い
- 現在の実装: `packages/core/src/application/ports/accountDeletionManifestStore.ts:116` — `describe(operationId): Promise<AccountDeletionManifestHeader | null>`（「Read-only header projection; `null` when the manifest is gone」）
- 倒す向き: **実装が正**。SYNC-206 と同じ「再駆動の決着に読み取りが要る」形
- 判定: 要修正
- 根拠: `.thread/2/adr.md` ADR-053、`spec/adr/039`

#### SYNC-209 — `AccountDeletionManifestStore.pruneTerminal` の戻り値の型 【残】

- 反映先: `spec/domains/index.md:99`。波及 `spec/inventory/domain.md:32`（DOM-common-026）、`spec/inventory/adapter.md:31`（ADP-common-025）
- 現在の spec: `pruneTerminal(asOf, cursor, limit): Promise<Readonly<{ removed: number; nextCursor: string | null }>>`
- 現在の実装: `packages/core/src/application/ports/accountDeletionManifestStore.ts:164-170` — `Promise<Readonly<{ operationIds: readonly string[]; nextCursor: string | null }>>`
- 倒す向き: **実装が正**。`spec/database/index.md:148` が「account manifest pruner が **header と operation を同じ UserId-shard transaction で削除する**」と定めており、件数だけ返す形では `DistributedOperationStore.deleteTerminal` に渡す ID が取れない。spec の要求を満たすために戻り値を広げた
- 判定: 要修正
- 根拠: `.thread/2/adr.md` ADR-059。`spec/adr/046`「正本が設計側」— `spec/database/index.md` の要求にポートの戻り値が追随した形

#### SYNC-210 — `LocalNoteProjectionWriter` / `PublicNoteProjectionWriter` の `redactAuthor` 【残】

- 反映先: `spec/domains/note.md:541-551`（両 interface）と `:535` の説明段落（「著者やworkspaceの一括行更新は提供しない」）。波及 `spec/inventory/domain.md:278-282`（DOM-note-044〜048）、`spec/inventory/adapter.md:205-209`（ADP-note-028〜032）
- 現在の spec: `LocalNoteProjectionWriter` は `replaceSnapshotIfNewer` / `remove`、`PublicNoteProjectionWriter` は `replaceSnapshotIfNewer` / `removeIfNewer` / `removeForPurge`。`redactAuthor` は spec 全域に 0 件
- 現在の実装: `packages/core/src/domain/note/ports/localNoteProjectionWriter.ts:97` と `publicNoteProjectionWriter.ts` の対応行 — `redactAuthor(input: AuthorRedaction): Promise<boolean>`。JSDoc `:91-95`「保存済みの著者表示を `redactionVersion` の退会既定値に置換する。行が無い / 別人が作った / 既に同世代以降、はすべて no-op なので at-least-once の redaction fan-out が収束する」
- 倒す向き: **実装が正**。ただし引き継ぎが必要 — `projectNoteChanges` を実装するスライス（Note スライス）は、著者 redaction を「完全 snapshot 置換」で受けるか `redactAuthor` で受けるかを選ぶことになる。`:535` の「一括行更新は提供しない」との関係を説明段落で明示する
- 判定: 要修正
- 根拠: `.thread/2/adr.md` ADR-058。`spec/adr/046`「契約を弱めた／広げた側は引き継ぎを残す」

#### SYNC-211 — `StorageErrorCode` に `InvalidChecksum` が無い 【残】

- 反映先: `spec/domains/storage.md:350-354`（エラーコード union）。波及 `spec/inventory/domain.md` の Checksum 値オブジェクト行
- 現在の spec: `"InvalidId" | "InvalidObjectKey" | "InvalidByteSize" | "UnsupportedMimeType" | "FileTooLarge" | "RefusedUrl" | "FetchBudgetExceeded"` の 7 コード
- 現在の実装: `packages/core/src/domain/storage/errorCode.ts:3-12` は 8 コード。超過は `InvalidChecksum: "STORAGE_INVALID_CHECKSUM"`（`:5`）。ファイル冒頭 `:1-2` に「`Checksum` 値オブジェクトが必要とするのに spec の enum に無い — 記載漏れとして扱った」旨のコメント
- 倒す向き: **実装が正**。`spec/domains/storage.md:44-47` の `Checksum` 値オブジェクトが「`value` は 64 文字の 16 進数」というバリデーションを持つ以上、違反時のコードが必要。記載漏れ
- 判定: 要修正
- 根拠: `.thread/14/research.md` の SYNC-03（`IdentityErrorCode` の記載漏れ）と**同型・別ドメイン**。重複ではないが同じ手当てになる

---

### B. DTO・入出力の差（7 件）

#### SYNC-212 — `storeAvatar` の入力 DTO から `size` / `declaredMimeType` を落とした 【残】

- 反映先: `spec/usecases/storage.md:167`（入力 DTO 行）。波及 `spec/inventory/usecase.md:98`（UC-storage-004）
- 現在の spec: `userId`, `subjectType`, `subjectId`, `fileName`, `declaredMimeType`, `size`, `body`
- 現在の実装: `packages/core/src/application/storage/storeAvatar.ts:16-22` — `{ userId, subjectType, subjectId, fileName, body: Uint8Array }`。`declaredMimeType` も `size` も無い
- 倒す向き: **実装が正**。`spec/adr/050`（昇格済み）の決定 1 が「**入力から宣言値を落とす**。サイズは実バイト長、型は先頭バイトの署名から決める。ユースケースは判定結果しか記録できない形にし、申告値を保管する経路を型から消す」と明記
- 判定: 要修正
- 根拠: `spec/adr/050`。ADR が正、usecase DTO が未追随。SYNC-240 と同一のステップで扱う

#### SYNC-213 — `recalculateStorageUsage` の入力に実行者 `userId` を足した 【残】

- 反映先: `spec/usecases/usage.md:171`（入力 DTO）。波及 `spec/inventory/usecase.md:126`（UC-usage-005）
- 現在の spec: 入力 DTO は `subjectType`, `subjectId` の 2 つだけ
- 現在の実装: `packages/core/src/application/usage/recalculateStorageUsage.ts:13-17` — `{ userId, subjectType, subjectId }`。JSDoc `:29-33`「`userId` は主体ではなく**実行者**。`assertActorWritable` が誰の依頼かを要る。user 主体は実行者と一致していなければならず（`:40-46` で `InsufficientRole`）、workspace 主体の membership 検査は `WorkspaceAuthorization` が入るまで未実施」
- 倒す向き: **実装が正**。`spec/domains/index.md:124` が「`assertActorWritable`は加えてworkspaceのmembership removal prepare lockをactor UserIdで検査し…**全ドメインの通常write入口が両方を呼ぶ**」と定めており、実行者を受け取らなければ spec の要求を満たせない
- 判定: 要修正
- 根拠: `.thread/2/adr.md` ADR-052。`spec/adr/046`「正本が設計側」

#### SYNC-214 — `getUsageSnapshot` から workspace ページングの構造ごと落とした 【外】

- 反映先: `spec/usecases/usage.md:27-45`（入出力 DTO と `WorkspaceUsageItem` 型）、`spec/pages/index.md#P-24`。波及 `spec/inventory/usecase.md:122`（UC-usage-001）、`spec/inventory/frontend.md:116,117`（PAGE-p24-001/002）
- 現在の spec: 入力に `workspaceCursor` / `workspaceLimit`、出力に `workspaces: WorkspaceUsageItem[]` / `nextWorkspaceCursor`。手順 2・3 が `membership_directory` の keyset と 6 並行 RPC、部分失敗の `unavailable` を定める
- 現在の実装: `packages/core/src/application/usage/getUsageSnapshot.ts:55` — `workspaces: []`（型は `readonly never[]`）。cursor / limit は入力に無い
- 倒す向き: **spec が正**。`.thread/2/progress.md:203` が「`getUsageSnapshot` の workspace ページングを実装しない（ADR-051）→ #3」、L242 が「#3 が `never[]` を置き換える形で戻す」と明記している。設計判断による乖離ではなく**縮退（未実装）**
- 判定: スコープ外（後続スライス #3 が実装で追いつく。spec を狭めてはならない）
- 根拠: `spec/adr/046` の「正本が設計側にある場合は契約をそのまま残す」。`spec/index.md` の「進捗を置かない」方針からも、spec 側に「本スライスでは未実装」と書き足すことはしない

#### SYNC-215 — `deleteQuota` に戻り値を、`deleteFilesByOwner` に turn の `status` を足した 【残】

- 反映先: `spec/usecases/usage.md#deleteQuota` の「出力DTO: なし」行、`spec/usecases/storage.md#deleteFilesByOwner` の「出力DTO: `deletedCount: number`」行。波及 `spec/inventory/usecase.md:128`（UC-usage-007）、`:107`（UC-storage-013）
- 現在の spec: `deleteQuota` は「なし」、`deleteFilesByOwner` は `deletedCount` のみ
- 現在の実装:
  - `packages/core/src/application/usage/deleteQuota.ts:47` — `Promise<ScopeCleanupTurn>`。`{ status: "alreadyApplied" | "continued" | ..., personalCleanupCompleted: boolean }`（`:63,80,92`）
  - `packages/core/src/application/storage/deleteFilesByOwner.ts:31-32` — `DeleteFilesByOwnerView = ScopeCleanupTurn & { deletedCount: number }`。`status: "stalled"`（`:101`）などを返す
- 倒す向き: **実装が正**。spec の手順自身が「100 件未満になってから cleanup receipt へ ack を付ける」「対象が残っているのに 1 件も削除できなかった場合は継続を積まず backoff する」という**呼び出し側が知らなければ制御できない分岐**を定めており、`void` では表現できない
- 判定: 要修正
- 根拠: `.thread/2/adr.md` ADR-055。`spec/adr/046`「正本が設計側」— 手順が要求する情報をポート／DTO が返す形へ

#### SYNC-216 — 継続 payload の `cursor`（`identity.accountDeletionManifestCompactContinued` は既に spec にある）【残・一部済】

- 反映先: `spec/domains/index.md:240-283`（継続要求表）の該当 3 行
- 現在の spec:
  - `identity.accountDeletionManifestBuildContinued` → `{ operationId, phase: "memberships" | "authorRoutes" }`
  - `identity.accountDeletionDispatchContinued` → `{ operationId, phase: "prepare" | "rollbackRelease" | "cleanup" | "redaction" | "finalize" }`
  - `identity.accountDeletionManifestCompactContinued` → `{ operationId }` — **この kind 自体は既に spec の表にある**（progress.md の「新設した」は Issue #2 の作業実感で、spec 側は元から持っていた）
- 現在の実装: `packages/core/src/application/identity/continuations.ts:44-83` — 3 kind とも payload に `cursor: string | null` と `continuationKey: string` を持つ
- 倒す向き: **実装が正**（`cursor` 部分）。JSDoc `:56-63` が「`cursor` が phase のターンを判別する。決定的 ID はターンごとに鍵が変わる継続にしか与えられない」と、`spec/adr/041` の要求そのものを実装理由にしている
- 判定: 要修正（`cursor` の追記）／解消済み（`compactContinued` の存在）
- 根拠: `spec/adr/041`（継続イベント ID の決定的導出）

#### SYNC-217 — 継続イベント payload の `continuationKey` 【残】

- 反映先: `spec/domains/index.md:240-283`（継続要求表）の identity 系 3 行と、`:285` 以降の「規約は 4 つ」の段落
- 現在の spec: `continuationKey` は spec 全域に 0 件。`:287` の段落が「`operation_id`は生成元operation/event/command IDと対象ID・version・cursorから決定的に導出する。具体式は `spec/database/index.md` の`scheduled_tasks`に定める」と `scheduled_tasks` 側の規約だけを持つ
- 現在の実装: `packages/core/src/application/identity/continuations.ts:91-96` — `continuationKey = (eventType, operationId, phase, cursor) => \`${eventType}:${operationId}:${phase}:${cursor ?? "-"}\``。3 kind の payload が保持。`identity.userAuthResidueCleanupContinued` **だけ**は持たない（`:23-33`。理由も JSDoc `:18-22`「カーソル無し — 仕事そのもの（行の削除）が次ターンの母集合から対象を外すので、常に前へ進む」）
- 倒す向き: **実装が正**。`spec/adr/041` / `spec/adr/042` が既に「決定キーはターンごとに変わらなければならない」「同じ id の再保存は先着行を残す no-op」を昇格済み。global outbox 側の決定的 EventId 導出材料が spec の表に無いのが乖離
- 判定: 要修正
- 根拠: `spec/adr/041` / `spec/adr/042`。ADR が正、継続要求表が未追随

#### SYNC-218 — OAuth コールバック応答を intent 付き判別共用体にし `linkIdentity` arm に `redirectTo` を載せた 【残】

- 反映先: **SYNC-239 が新設する `spec/usecases/identity.md#completeOAuthCallback` の出力 DTO**（intent 付き判別共用体の `linkIdentity` arm）。波及 `spec/inventory/usecase.md` の**新規行 UC-identity-024**
  - **`redirectTo` は `linkOAuthIdentity` の出力ではない。** したがって `linkOAuthIdentity` の出力 DTO（`:287-291`）と `spec/inventory/usecase.md:17`（`UC-identity-007`）は **`identityId` のまま据え置く**
- 現在の spec: `linkOAuthIdentity` の出力 DTO は `identityId: string` の 1 フィールドのみ。`completeOAuthCallback` の節そのものが無い（SYNC-239）
- 現在の実装: `packages/core/src/application/identity/view.ts:90-93` の `OAuthCallbackView` が intent で分岐する判別共用体で、`linkIdentity` arm だけが `redirectTo: string | null` を持つ。`completeOAuthCallback.ts:44-50` が `flow.redirectTo`（state に park した値）から詰める。一方 `LinkOAuthIdentityView`（`view.ts:166-168`）は **`{ identityId: string }` の 1 フィールドのみ**で、`linkOAuthIdentity.ts` の 3 つの `return`（`:107` / `:158` / `:179`）もすべて `identityId` しか返さない。`view.ts:86-88` の JSDoc が「`redirectTo` is on the link arm because the usecase's DTO is `identityId` alone: the return path belongs to the flow the dispatcher consumed, not to the linking itself」と明言している。`completeOAuthSignIn` / `linkOAuthIdentity` **個々の入力 DTO は spec のまま保っている**
- 倒す向き: **実装が正**。`spec/adr/035`（コールバックの単一ルート）が「分岐根拠はサーバーが決めた intent だけに限る」を昇格済みで、単一ルートが 2 usecase の結果を返す以上、応答は判別共用体になる。`redirectTo` は `startOAuthFlow` が state に park した値の戻り
- 判定: 要修正
- 根拠: `spec/adr/035` / `spec/adr/034`。SYNC-239（`completeOAuthCallback` の追加）と同一ステップ

---

### C. 手順・エラー表の差（9 件）

#### SYNC-219 — `startOAuthFlow` のエラー表に「非 active な主体の `linkIdentity` → `UnauthorizedError("UNAUTHENTICATED")`」が無い 【残】

- 反映先: `spec/usecases/identity.md:226-231`（エラーケース表）と `:220`（手順 2）。波及 `spec/inventory/usecase.md:15`（UC-identity-005）、`spec/testcases/identity/startOAuthFlow.md`（TC-identity-266 が既にこの挙動を要求）
- 現在の spec: エラーケース表は「未知のプロバイダー」「`redirectTo` が外部 URL」の**2 行のみ**。手順 2 は「指定時はUserId shardで`ActiveUser`を確認し、current `authEpoch`を読む」とだけ書き、非 active のときの結末が無い
- 現在の実装: `packages/core/src/application/identity/startOAuthFlow.ts:63-69` — `versioned === null || versioned.entity.status !== "active"` で `UnauthorizedError("UNAUTHENTICATED")`。`:65-66` のコメント「削除を開始した利用者はもはや認証済み主体ではないので、state 行そのものを作らない」。TC-identity-266 が固定
- 倒す向き: **実装が正**。テストケース側は既にこの挙動を期待している（`.thread/2/progress.md:53`）ので、エラー表だけが未追随
- 判定: 要修正
- 根拠: `.thread/2/adr.md` ADR-039。`spec/adr/046`「JSDoc（ここでは spec のエラー表）が実装より弱い」ケース

#### SYNC-220 — `requestPasswordReset` の手順に 60 秒の発行間隔規則が無い 【残】

- 反映先: `spec/usecases/identity.md:404-411`（`requestPasswordReset` の処理フロー）。波及 `spec/inventory/usecase.md:21`（UC-identity-011）
- 現在の spec: 手順 3「既存の`password_reset` pending tokenは部分一意制約下で`deleteByUserAndPurpose(userId, purpose, 1)`により消す」— **間隔判定が無い**。エラーケース表の「レート制限 → 何もせず成功として返す」だけが間接的に触れる。`60 秒` の語は `spec/scenario/account.md:44`（`resendVerificationEmail` について）と `spec/usecases/identity.md:143`（同じく resend の手順 2）にはあるが、`requestPasswordReset` には無い
- 現在の実装: `packages/core/src/application/identity/requestPasswordReset.ts:12` — `REQUEST_INTERVAL_MS = 60 * 1000`。`:88` で `findPendingByUserAndPurpose` を引いて判定
- 倒す向き: **実装が正**。60 秒という値の正典は実装側（`resendVerificationEmail.ts:11` と同値）。ただし `.thread/2/progress.md:210` が記録するとおり**`passwordResetUnavailable` 分岐は間隔判定を通らず無制限**で、実 `MailSender` を挿す前に #18 が全経路一律の送信間隔として閉じる
- 判定: 要修正（トークン発行側の 60 秒を spec に書く）。`passwordResetUnavailable` 分岐の穴は**実装課題として #18**
- 根拠: `.thread/2/adr.md` ADR-041。SYNC-201 が反映する `findPendingByUserAndPurpose` の唯一の用途がこれ

#### SYNC-221 — `addPasswordIdentity` に Google 再認可が無い（spec 内部の矛盾）【外・spec が正 = 実装修正】

- 反映先: `spec/usecases/identity.md#addPasswordIdentity` の処理フロー（3 手順）とエラーケース表。関連 `spec/scenario/account.md:127`、`spec/pages/index.md:441`、`spec/manual-tests/account.md:118-119`、`spec/inventory/frontend.md:103`（PAGE-p22-001）
- 現在の spec: **spec 内部で矛盾している**
  - `spec/scenario/account.md:127`「パスワードを追加する際は、現在のセッションの再認証（**Google 再認可**）を求める」
  - `spec/pages/index.md:441`（P-22 状態）「一覧 / 追加中 / 変更中 / **再認証要求** / 解除確認 / …」
  - `spec/manual-tests/account.md:118`「パスワードの追加を選ぶ｜Google の再認可が求められる」
  - 一方 `spec/usecases/identity.md#addPasswordIdentity` の手順は `listByUserId` → `PlainPassword.create` + hash → `Identity.createPassword` の 3 手順で、**再認可がどこにも無い**
- 現在の実装: `packages/core/src/application/identity/addPasswordIdentity.ts:37-70` — 再認可なし。usecase 側の spec に従っている。`.thread/2/progress.md:181` が「PAGE-p22-001 は『再認証要求』を除いてチェック」、マニュアル TC-07 手順 2 を skip したと記録
- 倒す向き: **spec が正**。再認証は資格情報追加時のセキュリティ要件で、正本は設計側（シナリオ AC-06）にある。`spec/adr/046`「正本が設計側にある場合は逃げ道を削って必須契約として書き直す」
- 判定: **スコープ外（実装修正が必要 → 別 Issue へ）**。ただし本 Issue でできることが 1 つある — `spec/usecases/identity.md#addPasswordIdentity` の手順に再認可を**書き足して spec 内部の矛盾を解消する**（実装が spec に追いついていない状態として正しく残す）。この判断は plan 側に委ねる
- 根拠: `spec/adr/046`。**実装のバグを spec に書き写して固定化してはならない**典型例
- 付随（別扱い可）: 同エラーケース表に `NotFoundError("USER_NOT_FOUND")` と `ValidationError("ACCOUNT_UNAVAILABLE")` の行が無い（実装 `:48-56` は両方を投げる）→ こちらは**実装が正**で要修正

#### SYNC-222 — `SignInOAuthClient` の通信失敗が `SystemError(ExternalServiceError)` と書かれている 【残】

- 反映先: `spec/domains/identity.md:456`（`SignInOAuthClient` の `**エラーケース**:` 行）
- 現在の spec: 「`SystemError(ExternalServiceError)`（通信・応答不正）、`ValidationError("OAUTH_CODE_INVALID")`（コードの期限切れ・不正）」
- 現在の実装: `packages/core/src/domain/identity/ports/signInOAuthClient.ts:22-24` の JSDoc が「Error contract: `SystemError(EXTERNAL_API_ERROR)`」。実 enum は `packages/core/src/application/errors.ts` の `SystemErrorCode` = `DatabaseError` / `DataIntegrityError` / `NetworkError` / `ExternalApiError` の 4 つで、**`ExternalServiceError` は存在しない**
- 倒す向き: **実装が正**（呼称ずれ）。`SignInOAuthClient` は #2 で 2 実装（Google / dev IdP）が入り、外部 API 通信 → `ExternalApiError` の写像が実コードで確定している
- 判定: 要修正
- 根拠: `.thread/2/adr.md` ADR-034。**`.thread/14/research.md` の SYNC-27 との関係**: SYNC-27 は「`ExternalServiceError` の全域語彙整合は別 Issue、本 Issue が扱うのは ShareTokenProtector 1 件のみ」としている。`SignInOAuthClient` は #2 で実装が入り写像の裏が取れているので、SYNC-27 が「実装が無く裏づけが取れない」として除外した未実装ドメイン（conversion / integration / storage / job）とは条件が違う。本台帳では**要修正**とする

#### SYNC-223 — TC-identity-268 の `BusinessRuleError(InvalidProvider)` が実在しない名前 【残】

- 反映先: `spec/testcases/identity/startOAuthFlow.md:9`、`spec/usecases/identity.md:230`（`startOAuthFlow` エラー表の「未知のプロバイダー」行）、`spec/inventory/test.md` の TC-identity-268 行
- 現在の spec: 「未知のプロバイダーを指定する｜`BusinessRuleError(InvalidProvider)` が投げられる」。`InvalidProvider` は `spec/domains/identity.md:519-525` のエラーコード union にも**存在しない**
- 現在の実装: `packages/core/src/domain/identity/valueObject.ts:268-272` — `OAuthProvider.create` が `BusinessRuleError(IdentityErrorCode.InvalidProviderAccount)` を投げる。`errorCode.ts:15` — `InvalidProviderAccount: "IDENTITY_INVALID_PROVIDER_ACCOUNT"`
- 倒す向き: **実装が正**（純粋な呼称ずれ。spec 側が存在しない enum 値を書いている）
- 判定: 要修正。**反映先は progress.md が挙げた testcases だけでなく `spec/usecases/identity.md:230` にもある**（progress.md の一覧には無い箇所）
- **本 Issue で直すのは identity 側 3 か所だけ。** `InvalidProvider` は `spec/` 全域で 6 件あり、残る 3 件は integration 側（`spec/usecases/integration.md:37` / `spec/testcases/integration/startIntegrationOAuth.md:7` / `spec/inventory/test.md` の TC-integration-170 行）。`spec/domains/integration.md:330` の `IntegrationErrorCode` union にも `InvalidProvider` は**存在しない**ので同型の乖離だが、**integration は未実装ドメイン**で「どちらへ写すか」の実装的裏づけが取れない。SYNC-27（`ExternalServiceError` の全域語彙整合）と同じ扱いで、ステップ 16-4 のフォローアップ Issue に 1 行として相乗りさせる
- 根拠: `spec/adr/046`。契約の記述と実装の名前が一致していなければ「JSDoc だけを読んで実装したものがスイートを通る」が成立しない

#### SYNC-224 — sub-operation ID を `sha256(...)` ではなく合成で導出した 【残】

- 反映先（**副番号の内訳**）:
  - **(a)** `spec/usecases/identity.md:27`（「Identity uniqueness の物理shard境界」節の `reservationOperationId`）— ステップ 4-8
  - **(b)** `spec/database/index.md:57`（`identity_unique_reservations` 節の同じ式）— ステップ 26-1
  - **(c)** `spec/usecases/identity.md:524`（`removeIdentity` 手順 3 の `operationId = sha256("removeIdentity:" + identityId)`）— ステップ 4-8
- 現在の spec: (a) (b) が `reservationOperationId = sha256(parentOperationId + ":" + kind + ":" + normalizedKey)`、(c) が `operationId = sha256("removeIdentity:" + identityId)`
- **(c) が同じ判断に属する根拠。** `.thread/2/progress.md` の該当箇条は「sub-operation ID を … 構成 `${parent}:${kind}:${key}` で導出した（ADR-035）。**`removeIdentity` の `operationId` も同様に `"removeIdentity:" + identityId`（ADR-044）**」と 2 つの ID を 1 箇条で挙げており、(c) はその後者にあたる。実装 `packages/core/src/application/identity/removeIdentity.ts:20-30` の JSDoc は「Composed rather than hashed (**the spec writes** `sha256("removeIdentity:" + identityId)`)」と **spec を名指しで否定**しており、`removeIdentity` は Issue #2 で実装済みなので「未実装で裏づけが取れない」除外にも当たらない。AC-46 の検査 `grep -rn "sha256(parentOperationId" spec/` は (a)(b) しか見ないので、(c) には別の検査（AC-67）が要る
- 現在の実装: `packages/core/src/application/identity/uniqueness.ts:74-77` — `` `${parentOperationId}:${key.kind}:${key.normalizedKey}` ``。JSDoc `:60-72` が理由を持つ:「合成で決定性と識別性は既に得られる（`kind` は `:` を含まない閉じた列挙で、自由形の鍵が末尾に来る）。application 層にハッシュ実装を持ち込まないため」＋「結果に生の鍵が埋まるのでログや他の sink へ出してはならない — `{ parentOperationId, kind }` を出す」。`removeIdentity.ts:30` も同じ規則で `` `removeIdentity:${identityId}` ``
- 倒す向き: **実装が正**。`spec/adr/048`（昇格済み）が既に「導出は **`親操作 ID:種別:正規化鍵` の合成**で行う…不可逆性は要らない」「この ID をログに出さない」を決定として持つ
- 判定: 要修正
- 根拠: `spec/adr/048`。ADR が正、`spec/usecases/identity.md:27` / `spec/database/index.md:57` / `spec/usecases/identity.md:524` の **3 か所**が未追随

#### SYNC-225 — `PROVIDER_ACCOUNT_ALREADY_LINKED` の担保箇所 【重・SYNC-15 と重複】

- **`.thread/14/research.md` の SYNC-15 と同一項目**。二重計上しない
- SYNC-15 の反映先（`spec/domains/identity.md:379` から当該コードを外し `:369` 側へ移す ＋ `domain/identity/ports/identityRepository.ts:6-8` の JSDoc 是正）で本項目は決着する
- 本調査で追加確認した事実: `spec/domains/identity.md:369` の `IdentityUniqueDirectory` を含む群のエラーケース行は今も `EMAIL_ALREADY_USED` / `HANDLE_ALREADY_USED` のみで、`:379` の `IdentityRepository` 側に `PROVIDER_ACCOUNT_ALREADY_LINKED` が残っている（PR #17 でも変わっていない）。実装側は `domain/identity/ports/identityUniqueDirectory.ts:22-25` の Error contract が 3 コードすべてを列挙しており、こちらが正
- 根拠: `spec/adr/038`（claim は索引であって資格ではない）

#### SYNC-226 — `completeOAuthSignIn` / `linkOAuthIdentity` のエラー表に `PROVIDER_ACCOUNT_RELEASE_PENDING` が無い 【残】

- 反映先: `spec/usecases/identity.md:266-276`（`completeOAuthSignIn` エラーケース表）と `:300-302`（`linkOAuthIdentity` の「同じ分類に加え」の段落）。波及 `spec/inventory/usecase.md:16,17`（UC-identity-006/007）、`spec/presentation/index.md` のエラー→ステータス表
- 現在の spec: 両表とも `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")`（紐づけ先が別の利用者）だけを持つ
- 現在の実装: `packages/core/src/application/identity/completeOAuthSignIn.ts:56` が `"PROVIDER_ACCOUNT_RELEASE_PENDING"` を投げる。`apps/web/app/presentation/errorDisplay.ts:74` が文言を持つ。`__tests__/removeIdentity.test.ts:200,224` が固定
- 倒す向き: **実装が正**。directory の claim は残っているが UserId shard に対応する identity が居ない「収束待ち」を、`PROVIDER_ACCOUNT_ALREADY_LINKED`（他人が持っている）と別のコードで名乗る。spec 手順 3 の要求（返った UserId shard で既存 Identity と User を確認する）自体は満たしているので、**表への追記だけ**
- 判定: 要修正
- 根拠: `.thread/2/adr.md` ADR-108、`spec/adr/038`（claim と identity 行が別の物理境界にあり配送が at-least-once）

#### SYNC-227 — TC-storage-043 の「3 文」という性能上の約束 【残・両方直す】

- 反映先: `spec/testcases/storage/deleteFilesByOwner.md:11`、`spec/inventory/test.md:1721`（TC-storage-043）、`spec/usecases/storage.md#deleteFilesByOwner` の `batchSize` 説明段落、`spec/platform/index.md` の `### Scope DO`（`## 実行予算と分割単位` 配下。`#クエリ予算` という見出しは存在しない）
- 現在の spec: 「列挙 1 文 + 多行 DELETE 1 文 + 多行 outbox INSERT 1 文で、件数によらず 3 文。`batchSize` の既定 100 はクエリ数ではなく 1 回に発行するイベント数を抑えるための上限である」
- 現在の実装: memory アダプターは `deleteStoredFiles` が 1 件ずつ読む（`.thread/2/adr.md` の ADR-022「`StoredFileRepository` は spec の形を保ち、削除は `findById` の OCC トークン経由で行う」の帰結。正典側の同じ論拠は `spec/adr/056-performance-budget-placement.md:11`）。テストは「列挙は 1 回だけ / 削除できたファイル 1 件につき `storage.fileDeleted` が 1 件 / どちらも件数に依存しない」に置き換えて緑
- 倒す向き: **両方直す**。「3 文」は D1 実装なら満たせる**バックエンド依存の性能上の約束**で、テストケース表（バックエンド非依存の契約）に置いた場所が誤り。ADR-046 に照らすと、「1 バッチのコストが件数に比例しない」という**観測可能な性質**がバックエンド共通の必須契約で、「3 文」は `spec/platform/index.md` の実行予算（`### Scope DO`）が持つべき値
- 判定: 要修正（テストケース表を観測可能な性質へ書き換え、文の数は実行予算側へ移す）。D1 実装を書くスライスが実行予算側の行を再検証する
- 根拠: `.thread/2/adr.md` ADR-057 / ADR-022、`spec/adr/056-performance-budget-placement.md:11`（**`spec/adr/022` ではない** — 同番号の正典側 ADR は「コマンドパレット航法」で無関係）

---

### D. 必須集合・データモデルの差（10 件）

#### SYNC-228 — personal cleanup の必須 component 集合を「8 固定」から宣言集合へ 【残】

- 反映先（**副番号の内訳**）:
  - **(a)** `spec/domains/index.md:80`（`acknowledgePersonalComponent` の引数型に 8 値が直書き）— ステップ 3-7
  - **(b)** 同 `:124`（説明段落「personal barrier resultにはoperation専用の**job/note/tag/storage/backup/usage/localProjection/outbox** component ackを保存し」）— ステップ 3-7
  - **(c)** `spec/database/index.md:1035-1037`（`applied_operations` の `kind='accountDeletionBarrier'` 説明「**operation専用の全8 component ack**が揃った場合だけcompleted commandを受け」）— ステップ 26-2。**同じ `:1037` 行に 8 component の直書きが 2 か所ある** — 上記の文に加えて `result` の構造リテラル `componentAcks: { job, note, tag, storage, backup, usage, localProjection, outbox }`。片方だけ倒すと 1 行の中で宣言集合と 8 固定が同居する
- 現在の spec: 3 か所すべてが 8 component 固定
- 現在の実装: `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts:40-45` — 「`markCompleted` は配備が**宣言した**全 component の ack 後にだけ合法。必須集合は enum 全体では**ない**: composition root が participant registry（`application/cleanup/participants.ts`）から実装へ渡す」。memory アダプター `scopeCleanupAdmissionStore.ts:43` が `options.requiredComponents ?? ALL_COMPONENTS`。適合スイート `conformance/scopeCleanupAdmissionStore.ts:82-93`（ADP-common-009/010）が `DECLARED_COMPONENTS` で一般化
- 倒す向き: **実装が正**。`spec/adr/039`（昇格済み）が「必須集合は composition root の**全数宣言**から導出する」「アダプターと適合スイートは固定値を持たない」「ダミー ack は置かない」を決定として持つ
- 判定: 要修正
- 根拠: `spec/adr/039`。ADR が正、`spec/domains/index.md` と `spec/database/index.md` が未追随

#### SYNC-229 — finalize の必須 receipt 集合も宣言集合へ ＋ `personalAbort` の位置づけ 【残・SYNC-14 と同一行に触れる】

- 反映先: `spec/domains/index.md:93`（`acknowledgeReceipt` の 6 値）と `:124`（「全prepare/release/cleanup/redaction item ackとpersonal/global receipt集合がfinalize/rollbackの正本」）、`spec/usecases/identity.md:669`、`spec/database/index.md:156`（「headerはpersonal cleanup、auth residue、external connection、global Job history、uniqueness releaseのreceiptも持つ」= 5 receipt 固定）
- 現在の spec: 5 receipt 固定。`personalAbort` と必須集合の関係が書かれていない
- 現在の実装: `packages/core/src/application/ports/accountDeletionManifestStore.ts:105-108` — 「finalize receipt set は**この契約が固定しない**: 配備がどの参加者が存在するかを宣言し、その集合を実装に渡すので、`allRequiredAcknowledged` は enum 全体ではなく宣言集合に対して答える」。`application/cleanup/participants.ts:68` が `Record<Exclude<AccountDeletionReceipt, "personalAbort">, …>` として `personalAbort` を型で除外
- 倒す向き: **実装が正**。`personalAbort` は rollback 側の receipt なので finalize の必須集合に入れられない — これは設計上正しく、spec 側が両者を区別していない
- 判定: 要修正
- 根拠: `spec/adr/039`。**`.thread/14/research.md` の SYNC-14 と同一の `spec/domains/index.md:124` / `spec/usecases/identity.md:669` に触れる**（SYNC-14 は `allRollbackReleased` が receipt を見ない点、本項目は必須集合の導出元）。重複ではないが**同一ステップにまとめるべき**

#### SYNC-230 — 8 件 / 120 日の再要求しきい値の計数を `distributed_operations` へ 【残】

- 反映先: `spec/database/index.md:154`（`account_deletion_manifests` の「`(user_id, state, expires_at)` indexで未失効rejectedを同transaction内に数え、8件以上なら9件目を拒否する」）、`spec/usecases/identity.md:663`
- 現在の spec: 計数の索引が `account_deletion_manifests` 側にある
- 現在の実装: `packages/core/src/application/identity/deleteAccount/admission.ts:101` が `distributedOperationStore.countTerminalSince(...)` を引く。ポート JSDoc（`application/ports/distributedOperationStore.ts:40-44`）が「`countTerminalSince` は純粋な観測: 保持中の terminal 行を数えるだけで、しきい値も窓も知らない。それを読む業務規則は `domain/identity/services/accountDeletionRetryPolicy.ts` にあるので、数えて → 判定して → はじめて作る（作ってからロールバックしない）」
- 倒す向き: **実装が正**。`spec/adr/044`（しきい値の置き場）が「観測・判定・作成を同一トランザクションに置けること」を前提に「業務規則はドメイン、ポートは観測だけ」を決定として昇格済み
- 判定: 要修正
- 根拠: `spec/adr/044`。`.thread/2/adr.md` ADR-013

#### SYNC-231 — `DistributedOperationStore` が `expires_at` / `attempts` / `next_attempt_at` を持たない 【外・部分残】

- 反映先（**副番号の内訳**）:
  - **(a)** `spec/usecases/identity.md:663` / `:675`（`distributed_operations` の state として `preparing` / `committing` を使っている箇所の書き分け）— ステップ 4-9。**同じ副番号がステップ 3-9（`spec/domains/index.md:121` の言及に添える括弧書き）にも現れる**。両者は同じ「state 語彙の書き分け」という 1 つの決定の 2 つの反映先で、指すものが違う（**前者 = ステップ 4-9 は本文の語彙、後者 = ステップ 3-9 は interface を新設しないこと**）
  - **(b)** `spec/database/index.md:130-148`（`distributed_operations.state` 欄に 3 値の CHECK。`attempts` / `next_attempt_at` / `expires_at` の 3 列は**落とさない**）— ステップ 26-4
  - **(列)** `attempts` / `next_attempt_at` / `expires_at` と recovery Cron の未実装そのもの — **スコープ外**（Phase 5）
- 現在の spec: 表は `attempts` / `next_attempt_at` / `expires_at` の 3 列を持つ。`spec/domains/index.md` には **interface 定義そのものが無い**（言及は L121 の 1 行だけ）
- 現在の実装: `packages/core/src/application/ports/distributedOperationStore.ts:15-25` の `DistributedOperation` は `{ id, kind, partitionKey, requestKey, state, payload, createdAt, updatedAt, terminalAt }`。`attempts` / `next_attempt_at` / `expires_at` は無い。`state` は `"running" | "completed" | "rejected"` の 3 値（spec/usecases は `preparing` / `committing` を使う）
- 倒す向き: **spec が正**（recovery Cron 側）。`.thread/2/progress.md:204` が「本 Issue の `DistributedOperationStore` は `next_attempt_at` を持たず recovery を回すステップも無い…recovery Cron を足すスライスが `next_attempt_at` を追加する必要がある」と記録。これは設計判断ではなく**縮退（未実装）**
- 判定: **スコープ外**（recovery Cron スライスが実装で追いつく。spec の表から列を落としてはならない）
- 別途の残: `spec/domains/index.md` に `DistributedOperationStore` の interface が 1 つも無いこと自体が、`ScopeCleanupAdmissionStore` / `AccountDeletionManifestStore` を書いている同じ節の欠落。interface を足すか否かは plan の判断（足す場合は `state` の 3 値と、`preparing`/`committing` が manifest header 側の state であることの書き分けが要る）→ **adr.md ADR-015 で「新設しない」と決着**
- **この欠落は `DistributedOperationStore` 固有ではなく系統的である。** 実装に存在して `spec/inventory/` に 1 行も無いポートは 5 つある — `DistributedOperationStore`（`spec/domains/index.md:121` の 1 行言及のみ）/ `AppliedOperationStore` / `IdentityRemovalReceiptStore` / `OutboxRepository` / `ScopeTaskScheduler`（後 3 者は `spec/` 全域に 0 件）。`adapters/conformance/` の 25 本のうち `describe` / `it` 名に **ADP ID を持たないのはこの 5 本だけ**で、inventory 行の欠落と 1 対 1 に対応する。5 ポートまとめて Phase 5（recovery Cron の Issue）へ送る
- 根拠: `spec/adr/046`「正本が設計側にある場合は契約をそのまま残す」

#### SYNC-232 — `DistributedOperationStore` の `payload` に uniqueness key を固定した 【済】

- 反映先: なし
- 現在の spec: `spec/usecases/identity.md:678` が既に「応答喪失は**operation payloadに固定したkey**から再開する」と書いている。`spec/database/index.md:146`「payload は状態機械の入力を固定し、再開時に利用者入力を読み直さない」も整合
- 現在の実装: `packages/core/src/application/identity/deleteAccount/admission.ts:115` — `payload: uniquenessKeysOf(user, identities)`。JSDoc `:67-69`「uniqueness key は PII がまだ生きているここで payload へ凍結し、global cleanup とその全リプレイは payload だけを読む」
- 倒す向き: —
- 判定: **解消済み**（spec 側に既に記述がある。progress.md は Issue #2 の作業実感として挙げたが、spec との乖離ではない）
- 根拠: —

#### SYNC-233 — `applied_operations` の 1 表が 2 ポートに分かれ `result` 列を持たない 【残】

- 反映先: `spec/database/index.md:33`（scope DO: infrastructure の表一覧）、`:35`、`:1027-1037`（`applied_operations` の列定義と `kind='accountDeletionBarrier'` 説明）
- 現在の spec: 1 表・`result` 列 NOT NULL（「同じ command の再試行へ返す JSON」）で、`kind='accountDeletionBarrier'` の `result` に `{ state, userId, componentAcks: {…8 値…} }` を持つと定める
- 現在の実装: 2 ポートに分割 — `application/ports/scopeCleanupAdmissionStore.ts`（barrier receipt 側）と `application/ports/appliedOperationStore.ts:20-24`（`markApplied({ operationId, commandKey }): Promise<boolean>` の 1 メソッドのみ）。`result` を返す口はどちらにも無い
- 倒す向き: **実装が正**。`spec/adr/045`（重複排除の要否）が「**キーの意味でポートを分ける**」を決定として昇格済み。`result` は「値を返すコマンド」を足すスライスが戻す
- 判定: 要修正（表の記述を 2 ポート分割に合わせ、`result` を「値を返すコマンドを足すスライスが使う」列として位置づけ直す）
- 根拠: `spec/adr/045`。`.thread/2/adr.md` ADR-012。**SYNC-228 と同じ `spec/database/index.md:1035-1037` の段落**に触れるので同一ステップ

#### SYNC-234 — 削除 status ticket の署名鍵は `AppConfig` ではなく composition root が供給する 【残】

- 反映先: `spec/presentation/index.md:83-86`（`AppConfig` の鍵の表 — SharePass / ExportTicket / `SecretCipher` / `ShareTokenProtector` の 4 行）と `:229`（202 応答と status ticket の段落）
- 現在の spec: 鍵の表に**削除 status ticket の署名鍵が無い**。かつ `:23` が「秘密と鍵は本文書の `AppConfig` に置く」と一律に定めている
- 現在の実装: `packages/core/src/application/di/serverNode.ts:22,72-77,175` — `DELETION_TICKET_KEY` を env スキーマで検証し（32 バイト base64url）composition root が供給する。未設定ならプロセス毎のランダム鍵。`AppConfig` 型には載せない
- 倒す向き: **実装が正**。`spec/adr/047`（昇格済み）の決定 1 が「チケットの発行と検証は presentation が担い、**鍵は composition root が供給する**。SSR メタデータを運ぶ設定の器に秘密を混ぜず、presentation が環境変数を直読みもしない。未設定ならプロセス毎のランダム鍵へ落とす配備もありうる」
- 判定: 要修正（表に 1 行足すのではなく、`AppConfig` に載せない鍵の扱いとして `:23` の一般則に例外を書く）
- 根拠: `spec/adr/047`。ADR が正、`spec/presentation/index.md` が未追随

#### SYNC-235 — `/settings/danger`（P-25）が未サインインでも到達できる 【残】

- 反映先: `spec/pages/index.md#P-25`（**状態**行と目的節）、`spec/inventory/frontend.md:119,121`（PAGE-p25-001 / PAGE-p25-003）
- 現在の spec: P-25 の記述に認証要件の言及が無い。PAGE-p25-003 だけが「session なしで status ticket を明示送信し」と部分的に触れる
- 現在の実装: `.thread/2/progress.md:208` のとおり `/settings/danger` は未サインインでも 200 を返す。読み取り権限は status ticket が持ち、`getAccountDeletionStatus` は ticket が名指す 1 件しか返さない。`deleteAccountFn` 自体は `requireSession()` を通す
- 倒す向き: **実装が正**。`spec/adr/047` の決定に「**進捗を読む画面は認証を要求できない。** 受理と同時にセッションが消える以上、認証ガードを掛けるとその画面自体へ到達できない。…この 1 画面だけをガードの明示的な例外にし、セッションが無い状態では他の導線を描かない」が昇格済み
- 判定: 要修正
- 根拠: `spec/adr/047`

#### SYNC-236 — 継続 kind `identity.personalCleanupHandoverContinued` が継続要求表に無い 【残】

- 反映先: `spec/domains/index.md:240-283`（継続要求表）
- 現在の spec: identity 系は `authStatePruneContinued` / `userAuthResidueCleanupContinued` / `accountDeletionManifestBuildContinued` / `accountDeletionDispatchContinued` / `accountDeletionManifestCompactContinued` / `accountDeletionManifestPruneContinued` / `personalBarrierPruneContinued` の 7 行。`personalCleanupHandoverContinued` は spec 全域に 0 件
- 現在の実装: `packages/core/src/application/workers/scopeTaskRunner.ts:29` — `"identity.personalCleanupHandoverContinued"`。scope 平面の継続で、barrier を閉じたターンの scope→global 引き渡しを駆動する
- 倒す向き: **実装が正**。`spec/adr/043`（平面をまたぐ引き渡し）が「引き渡しに**専用の継続行**を与える。barrier を閉じたターンの直後にその行を arm し、その上で global 側の受領を書き、受領が入って初めてその行を完了させる」を昇格済み
- 判定: 要修正（表に 1 行 — payload と唯一の購読者を含む）
- 根拠: `spec/adr/043`。`.thread/2/adr.md` ADR-106

#### SYNC-237 — P-25 の「削除されるもの / されないもの」と完了文言を participant の実態に合わせて狭めた 【外】

- 反映先: `spec/pages/index.md#P-25` の**機能**行、`spec/design/pages/P25-settings-danger.html`
- 現在の spec: participant 完備の完成形（「アカウントと関連データを削除する」「削除されるもの / されないもの…の説明」）
- 現在の実装: 宣言された participant（`storage` / `usage` の 2 つ）に合わせて文言を狭めている
- 倒す向き: **spec が正**。`.thread/2/progress.md:271` が「participant を足すスライスが左の列へ戻す」と明記。設計判断ではなく**縮退（未実装 participant の反映）**
- 判定: スコープ外（後続スライスが participant を足した時点で実装が spec に追いつく。spec を狭めてはならない）
- 根拠: `spec/adr/046`「正本が設計側にある場合は契約をそのまま残す」。**実装の縮退を spec に書き写して固定化しない**

---

### E. spec に無い application 入口（2 件）

#### SYNC-238 — `getProfile` / `checkHandleAvailability` の 2 読み取り 【残】

- 反映先: `spec/usecases/identity.md`（新規 2 節。`updateProfile`（`:485` 付近）の直後が自然）。波及 `spec/inventory/usecase.md`（UC-identity-022 / 023 を新設 — 現在の最大は `:31` の UC-identity-021）、`spec/inventory/frontend.md:99,100`（PAGE-p21-001 / p21-002 の要点欄）、**`spec/testcases/identity/{getProfile,checkHandleAvailability}.md`（新設）と `spec/inventory/test.md`（identity 群の末尾に TC 行。現在の最大は `TC-identity-304`）**
  - **テストケースファイルも新設する**（adr.md ADR-016）。TC ID はファイル名の辞書順で振られているので、辞書順の位置に挿入すると `TC-identity-024`（`completeOAuthSignIn` の 1 件目）以降 280 行超が繰り下がる。**群の末尾に採番する**
- 現在の spec: `getProfile` / `checkHandleAvailability` は spec 全域に **0 件**
- 現在の実装: `packages/core/src/application/identity/getProfile.ts` / `checkHandleAvailability.ts`。どちらも write を持たない `updateProfile` の対で、P-21 の初期表示とハンドル重複の即時チェックに必要
- 倒す向き: **実装が正**。`spec/pages/index.md#P-21` の**機能**が「display name、avatar、bio、handle」の表示と「重複候補」の提示を要求しており（`spec/inventory/frontend.md:99` も同様）、それを供給する読み取りが usecase に無かった
- 判定: 要修正
- 根拠: `.thread/2/adr.md` ADR-047。`spec/adr/046`「正本が設計側」— pages の要求に usecases が追随する

#### SYNC-239 — `completeOAuthCallback`（コールバックのディスパッチャー）【残】

- 反映先: `spec/usecases/identity.md`（`completeOAuthSignIn`（`:233`）と `linkOAuthIdentity`（`:277`）の間に新規 1 節。**出力 DTO の `linkIdentity` arm が `redirectTo` を運ぶ** — SYNC-218 の反映先はここ）。波及 `spec/inventory/usecase.md`（UC-identity-024 を新設）、`spec/inventory/frontend.md:106`（PAGE-p22-004）、**`spec/testcases/identity/completeOAuthCallback.md`（新設）と `spec/inventory/test.md`（identity 群の末尾に TC 行）**
  - **テストケースファイルも新設する。** 「1 ユースケース = 1 テストケースファイル = 1 UC 行」は全 9 ドメインで厳密に成立しており（identity は 21 / 21 / 21）、UC 行だけ足すと identity が 24 / 21 / 24 になる。SYNC-238（`getProfile` / `checkHandleAvailability`）も同じ（adr.md ADR-016）
- 現在の spec: `completeOAuthCallback` は spec 全域に **0 件**。`completeOAuthSignIn` / `linkOAuthIdentity` が独立した 2 usecase として書かれている
- 現在の実装: `packages/core/src/application/identity/completeOAuthCallback.ts` — flow state の `intent` で 2 usecase へディスパッチする。**`completeOAuthSignIn` / `linkOAuthIdentity` の入力 DTO は spec のまま保っている**
- 倒す向き: **実装が正**。`spec/adr/035`（コールバックの単一ルート）が「フロー状態の取り出しが原子的な単回消費であること」を前提に「分岐根拠はサーバーが決めた intent だけに限る」を昇格済み。単一ルートである以上、intent を読んで振り分ける入口が要る
- 判定: 要修正
- 根拠: `spec/adr/035` / `spec/adr/034`。SYNC-218（応答の判別共用体）と同一ステップ

---

### F. 計画レビュー R1 で増えた差（1 件）

#### SYNC-240 — `UploadValidationPolicy.ensureAcceptable` の引数と戻り値 【残】

- 反映先: `spec/domains/storage.md:180-183`（`UploadValidationPolicy` の振る舞い表）と `:185-191`（許可 MIME の表）。波及 `spec/inventory/domain.md` の `UploadValidationPolicy` 行、`spec/usecases/storage.md:167`（SYNC-212 と同じ入力 DTO 行）
  - **`ensureAcceptable` の呼び出し 4 か所** — `spec/usecases/storage.md:38`（`startBulkUpload` 手順 3）/ `:90`（`storeUpload` 手順 2。**`{ purpose: "source", mimeType, size }` と引数を明示的に書いている唯一の箇所**）/ `:145`（`storeMedia` 手順 2）/ `:176`（`storeAvatar` 手順 2）。振る舞い表の署名だけ直して呼び出しを残すと、改訂後は**存在しない引数を渡す記述**になる。あわせて `:90` 付近の手順 5「宣言サイズと実サイズが食い違う場合は実サイズを採用する」も落とす（宣言サイズが入力から消えるため）
  - **`spec/usecases/conversion.md:198` / `spec/domains/conversion.md:170` の `declaredMimeType` は触らない。** これは `FormatDetector.detect` が受け取るヒントであって受理判定の入力ではない（別ポート）
- 現在の spec: `| ensureAcceptable | params: { purpose: FilePurpose; mimeType: MimeType; size: ByteSize } | void | 用途ごとの許可 MIME に反すれば BusinessRuleError(UnsupportedMimeType)、size.exceeds(limitFor(purpose, mimeType)) なら BusinessRuleError(FileTooLarge) |`
- 現在の実装: `packages/core/src/domain/storage/services/uploadValidationPolicy.ts:101-124` — 引数は `{ purpose, body }`、戻り値は `AcceptedUpload = { mimeType, size }`（`:73`）。JSDoc `:80-88` が「MIME は申告値ではなくバイト列の署名（PNG / JPEG / WebP）で決め、サイズは実バイト長で測る」
- 倒す向き: **実装が正**。`spec/adr/050`（昇格済み）の決定 1「入力から宣言値を落とす。サイズは実バイト長、型は先頭バイトの署名から決め、どの許可形式にも一致しなければ不変条件違反として拒否する。判定は許可表を持つアップロード検証のドメインサービスに置く」
- 判定: 要修正。**署名を持たない形式（`text/markdown` 等）を許可する purpose を足す #6 が入口の形をさらに広げる**ことを表の注記に残す（`spec/adr/050` が「そのスライスが判断を行う」と定めている）
- 根拠: `spec/adr/050`。SYNC-212 と同一ステップ

---

### G. マニュアルテスト手順の差（2 件）

#### SYNC-241 — TC-26「使用済み / 期限切れの再設定リンクを**開く**」【残】

- 反映先: `spec/manual-tests/account.md:339-347`（TC-26 の手順 1・2）
- 現在の spec: 「1｜発行から 1 時間以上経過した再設定リンクを開く｜リンクの有効期限が切れている旨が表示され、再申請の導線が出る」「2｜使用済みの再設定リンクを開く｜リンクが無効である旨が表示される」
- 現在の実装: GET は状態を変えない設計で、無効判定は**送信の失敗**として返る。正本は `spec/inventory/frontend.md` の PAGE-p04-003 / p04-004
- 倒す向き: **実装が正**。GET で状態を変えないのは設計として正しく（リンクのプリフェッチや先読みでトークンを消費しない）、`spec/inventory/frontend.md` の PAGE 行が既にそう書いている。手順書だけが未追随
- 判定: 要修正（手順を「開いて新しいパスワードを送信する」、期待結果を「送信が拒否され、リンクが無効である旨と再申請への導線が出る」へ）
- 根拠: `spec/adr/046`「正本が設計側（`spec/inventory/frontend.md` の PAGE 行）」

#### SYNC-242 — TC-13「無効にしたセッションが 1 件であることが表示される」【残】

- 反映先: `spec/manual-tests/account.md:185-193`（TC-13 手順 2）
- 現在の spec: 「片方の `/settings/auth` で他のすべての端末からのサインアウトを実行する｜**無効にしたセッションが 1 件であることが表示される**」
- 現在の実装: `spec/usecases/identity.md#signOutOtherSessions` が「応答は削除件数ではなく `revocationAccepted: true` を返す」と定め、実装もそれに従う。`spec/inventory/usecase.md:20`（UC-identity-010）も「現在端末を維持した accepted 状態」
- 倒す向き: **実装が正**。件数表示は AC-16 の O(1) 要求とも `spec/scenario/account.md` の「端末一覧を持たない」方針とも矛盾する — **手順書 1 か所だけが spec 内で孤立している**
- 判定: 要修正（期待結果を「解除を受理した旨が表示される」へ）
- 根拠: `spec/adr/046`。spec 内部の矛盾で、正本は usecase 側

---

### H. 本調査で追加発見（1 件）

#### SYNC-243 — `startOAuthFlow` の出力 DTO に `state` が増えている 【残】

- 反映先: `spec/usecases/identity.md:212-216`（`startOAuthFlow` 出力 DTO 表）。波及 `spec/inventory/usecase.md:15`（UC-identity-005）
- 現在の spec: 出力 DTO は `| authorizationUrl | string |` の **1 行のみ**
- 現在の実装: `packages/core/src/application/identity/view.ts:57-65` — `StartOAuthFlowView = { state: string; authorizationUrl: string }`。JSDoc `:58-62`「`authorizationUrl` が既に運んでいるが、転送境界がプロバイダーの URL を再パースせずにフローを開始したブラウザーへ束縛できるよう別に露出する」。`startOAuthFlow.ts:86-93` が両方を返す
- 倒す向き: **実装が正**。`spec/adr/034`（認可往復のブラウザー束縛。昇格済み）が「認可の完了は開始したブラウザーに束縛する」を決定として持ち、その束縛材料が転送境界へ渡らなければ実現できない
- 判定: 要修正
- 根拠: `spec/adr/034`。`.thread/2/progress.md` の一覧には無く、本調査で `startOAuthFlow.ts` を読んで見つけた

---

### I. 統合作業で追加（1 件）

#### SYNC-244 — `IdentityErrorCode` union に `InvalidAvatarUrl` / `AccountDeletionRetryLimitExceeded` が無い 【残】

- 反映先: `spec/domains/identity.md#エラーコード`（`IdentityErrorCode` union）。波及 `spec/inventory/domain.md`（`DOM-identity-019` ほか）、実装 `packages/core/src/domain/identity/errorCode.ts:1-5` の冒頭コメント
- 現在の spec: 11 コード（`InvalidId` / `InvalidEmail` / `InvalidHandle` / `HandleReserved` / `InvalidDisplayName` / `InvalidBio` / `WeakPassword` / `InvalidProviderAccount` / `TokenExpired` / `LastIdentityCannotBeRemoved` / `PasswordIdentityAlreadyExists`）
- 現在の実装: `errorCode.ts:6-22` は 14 コード。超過は `IdentityLimitExceeded`（= `.thread/14/research.md` の SYNC-03）/ `InvalidAvatarUrl`（`:12`）/ `AccountDeletionRetryLimitExceeded`（`:20-21`）。冒頭コメントが前 2 者を「spec の記載漏れとして扱った」と書いている
- 倒す向き: **実装が正**（記載漏れ）。`InvalidAvatarUrl` は `spec/usecases/identity.md#updateProfile` が「同一オリジンの URL」を要求し（`spec/adr/051`）、`AccountDeletionRetryLimitExceeded` は `spec/usecases/identity.md:663` / `spec/database/index.md:154` が 8 件 / 120 日のしきい値を要求している。どちらも**違反時のコードだけが union に無い**
- 判定: 要修正。**SYNC-03 と同じ 1 つの union なので、必ず同一ステップ（ステップ 2）で足す**
- 根拠: SYNC-211（`StorageErrorCode.InvalidChecksum`）/ SYNC-03 と同型。`spec/adr/046`「正本が設計側」— spec の他箇所が既に使っているコードを union が持っていない
- 採番の経緯: `.thread/2/progress.md` の箇条書きには単独項目として現れず、`.thread/14/research.md` の SYNC-03 が「他 2 件は #2 由来」と脇に置いていたため、どちらの台帳にも行が無かった。統合作業で採番した

---

## 集計

| 分類 | 件数 | ID |
| --- | --- | --- |
| まだ乖離あり（本 Issue で直す） | **38** | 201,202,203,204,205,206,207,208,209,210,211,212,213,215,216,217,218,219,220,222,223,224,226,227,228,229,230,233,234,235,236,238,239,240,241,242,243,244 |
| 既に解消済み（何もしない） | **1** | 232 |
| スコープ外（後続スライスの未実装 / 実装修正） | **4** | 214,221,231,237 |
| SYNC-01〜27 と重複 | **1** | 225（= SYNC-15） |
| **合計** | **44** | |

分類別の内訳:

| 分類 | 件数 | 主な反映先 |
| --- | --- | --- |
| A. ポート定義に足りない / 増えたメソッド | 11 | `spec/domains/identity.md` / `index.md` / `storage.md` / `usage.md` / `note.md` |
| B. DTO・入出力の差 | 7 | `spec/usecases/{storage,usage,identity}.md` / `spec/domains/index.md` |
| C. 手順・エラー表の差 | 9 | `spec/usecases/identity.md` / `spec/domains/identity.md` / `spec/testcases/` |
| D. 必須集合・データモデルの差 | 10 | `spec/domains/index.md` / `spec/database/index.md` / `spec/presentation/index.md` / `spec/pages/index.md` |
| E. spec に無い application 入口 | 2 | `spec/usecases/identity.md` / `spec/inventory/usecase.md` |
| F. 計画レビュー R1 で増えた差 | 1 | `spec/domains/storage.md` |
| G. マニュアルテスト手順の差 | 2 | `spec/manual-tests/account.md` |
| H. 本調査で追加発見 | 1 | `spec/usecases/identity.md` |
| I. 統合作業で追加 | 1 | `spec/domains/identity.md` |
| **合計** | **44** | |

### 「spec が正」= 実装修正が必要 = 別 Issue 送り

| ID | 内容 | 送り先 |
| --- | --- | --- |
| SYNC-221 | `addPasswordIdentity` に Google 再認可が無い（AC-06 / P-22 / manual TC-07 が要求するセキュリティ要件） | **新規 Issue**（spec 側は usecase 手順に再認可を書き足して内部矛盾を解消する余地あり） |
| SYNC-203(3) | `ObjectStorage.createDownloadUrl` が実装に無い | #6（`issueDownloadUrl` / `exportNote` を持つスライス） |
| SYNC-214 | `getUsageSnapshot` の workspace ページング未実装 | #3 |
| SYNC-231 | `DistributedOperationStore` の `attempts` / `next_attempt_at` / `expires_at` 未実装 | recovery Cron を足すスライス |
| SYNC-237 | P-25 の participant 完備の文言 | participant を足す後続スライス（#3 / #4 / #5 / #7。起票単位は `plan.md` Phase 5 の 7. が正） |
| SYNC-220（付随） | `requestPasswordReset` の `passwordResetUnavailable` 分岐が送信間隔を通らない | #18 |
| SYNC-227（付随） | 「3 文」の性能上の約束の再検証 | D1 実装を書くスライス |

---

## 反映先ファイル別の逆引き

件数は同じ行に挙げた SYNC ID の総数（`＋` の後ろも数える）。

| ファイル | 件数 | SYNC ID |
| --- | --- | --- |
| `spec/usecases/identity.md` | **12** | 219, 220, 221, 223, 224, 226, 232(済), 238, 239, 243 ＋ 229(:669), 218 |
| `spec/domains/index.md` | **10** | 206, 207, 208, 209, 216, 217, 228, 229, 231(部分), 236 |
| `spec/domains/identity.md` | **5** | 201, 202, 205, 222, 225(重・SYNC-15) |
| `spec/database/index.md` | **5** | 224(:57), 228(:1035), 230(:154), 231(:130-148, 外), 233(:33,35,1027) |
| `spec/domains/storage.md` | **3** | 203, 211, 240 |
| `spec/usecases/usage.md` | **3** | 213, 214(外), 215 |
| `spec/usecases/storage.md` | **3** | 212, 215, 240(付随) |
| `spec/manual-tests/account.md` | **2** | 241, 242 |
| `spec/pages/index.md` | **3** | 235(P-25), 237(P-25・外) ＋ 221(P-22 は spec が正) |
| `spec/domains/usage.md` | **1** | 204 |
| `spec/domains/note.md` | **1** | 210 |
| `spec/presentation/index.md` | **2** | 234 ＋ 226(エラー→ステータス表) |
| `spec/testcases/identity/startOAuthFlow.md` | **1** | 223 |
| `spec/testcases/storage/deleteFilesByOwner.md` | **1** | 227 |
| `spec/platform/index.md` | **1** | 227（`### Scope DO` へ移す先） |
| `spec/design/pages/P25-settings-danger.html` | **1** | 237（外） |
| `spec/inventory/domain.md` | **10** | 201, 202, 203, 204, 205, 206, 208, 209, 210, 211 |
| `spec/inventory/adapter.md` | **9** | 201, 202, 203, 205, 206, 207, 208, 209, 210 |
| `spec/inventory/usecase.md` | **10** | 212, 213, 214(外), 215, 218, 219, 226, 238(新設), 239(新設), 243 |
| `spec/inventory/frontend.md` | **4** | 235, 237(外), 238, 241 |
| `spec/inventory/test.md` | **2** | 223, 227 |
| 実装側 JSDoc（`packages/core/src/...`） | **2** | 207（`scopeCleanupAdmissionStore.ts`）, 225(重・`identityRepository.ts`) |
| 適合スイート（`adapters/conformance/...`） | **1** | 207（ADP-common-008 に completed のケース追加） |

### 実装ステップのグルーピング候補（ファイル単位）

1. **`spec/domains/index.md` 一括**（9 件）— 206, 207, 208, 209, 216, 217, 228, 229, 236。`ScopeCleanupAdmissionStore` / `AccountDeletionManifestStore` の 2 interface と `:124` の説明段落、継続要求表の 3 か所に集中する。**`.thread/14/research.md` の SYNC-14 が同じ `:124` に触れる**ので同一ステップに寄せる
2. **`spec/usecases/identity.md` 一括**（12 件）— OAuth 3 節（219, 223, 226, 243, 218, 239）／ パスワード系（220, 221）／ プロフィール読み取り新設（238）／ uniqueness 節（224）
3. **`spec/domains/identity.md` 一括**（5 件）— ポート節に集中。**SYNC-03（`IdentityErrorCode` の enum）と SYNC-15（`IdentityRepository` のエラー行）が同じファイルの隣接行**なので、`.thread/14/research.md` 側のステップと衝突しないよう順序を決める必要がある
4. **`spec/database/index.md` 一括**（4 件）— 224(:57), 228(:1035), 230(:154), 233(:33,35,1027)
5. **アップロード 3 点セット**（212, 240 ＋ `spec/usecases/storage.md`）— `spec/adr/050` 由来で 1 つの判断
6. **`spec/inventory/*.md` の追随**（全ステップの後段）— ヘッダーの「最終同期」日付も更新。**新規 DOM / ADP / UC 行の採番が必要**（下記の注意点を参照）
7. **`spec/manual-tests/account.md`**（241, 242）— 独立、他と衝突しない

---

## 台帳の外で決着した論点

本台帳の作成にあたって判断が要った 6 点は、いずれも `.thread/14/adr.md` の **ADR-011〜ADR-016** と `spec/adr/052`〜`057`、および plan.md の受け入れ基準で決着している。台帳側では結論だけを指す。

1. 新規ポートメソッドの DOM / ADP ID 採番（`research.md` SYNC-09 の「適合ケースには採番しない」との関係）→ **新規メソッドには通常どおり各群の末尾に採番する**（ADR-011）
2. SYNC-207 の適合スイートへの 1 ケース追加 → **本 Issue に含める**（ADR-012）
3. SYNC-221 の扱い → **spec 内部の矛盾解消だけを本 Issue で行い、実装は別 Issue**（ADR-013）
4. SYNC-227 の「3 文」の置き場 → **`spec/platform/index.md` の `### Scope DO`**（ADR-014 / `spec/adr/056`）
5. SYNC-231 の `DistributedOperationStore` interface → **本 Issue では新設しない**（ADR-015。同じ欠落を持つ 5 ポートごと Phase 5 へ送る。詳細は SYNC-231 の項）
6. Issue #14 のコメントの件数表（38 件）と実数の差 → **本台帳の実数は 44 件**（「集計」節）
