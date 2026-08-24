# 実装手順 — Issue #21

## 設計

### ドメインモデルへの影響

#### 1. `IdentityUniqueDirectory` — 取り壊しの条件を「所有者」から「観測した claim そのもの」へ

現在の `beginRelease` の no-op 条件は「行が無い / 別利用者 / `reserved`」の 3 つで、**同じ利用者が張り直した別の claim**を区別できない。これを区別するための観測手段と条件を足す。

```ts
/**
 * A durable claim as observed at a point in time. `claimToken` identifies
 * that one claim, not the key: a claim taken after this one was torn down
 * carries a different token even for the same normalized key — and even
 * when the same operation id takes it again (reservation operation ids are
 * deterministic, so the same one can claim a key twice).
 *
 * Opaque to callers — compare it, never parse, log, or persist it.
 */
export type ActiveUniqueClaim = Readonly<{
  userId: UserId;
  claimToken: string;
}>;

export interface IdentityUniqueDirectory {
  resolve(kind: IdentityUniqueKind, normalizedKey: string): Promise<UserId | null>;
  /** `resolve` plus the token that identifies the claim itself. Same
   * visibility rule: `reserved` and `releasing` rows resolve to `null`. */
  resolveClaim(kind: IdentityUniqueKind, normalizedKey: string): Promise<ActiveUniqueClaim | null>;
  reserve(input: ...): Promise<void>;
  activate(operationId: string, expectedUserVersion: number): Promise<void>;
  beginRelease(
    input: Readonly<{
      kind: IdentityUniqueKind;
      normalizedKey: string;
      expectedUserId: UserId;
      expectedClaimToken: string;
      operationId: string;
    }>,
  ): Promise<void>;
  release(operationId: string): Promise<void>;
}
```

契約に足す文（JSDoc と `spec/domains/identity.md` の散文の両方へ）:

- `resolveClaim` は `active` の行だけを返す。`active` の行は**必ず**トークンを持つ（`ActiveUniqueClaim.claimToken` は非 null。どの書き込みで採番するかはバックエンドの機構で、契約は問わない — memory は `reserve` で採番する）。したがって `resolve(k,n)` は常に `resolveClaim(k,n)?.userId ?? null` と一致する — 2 つの読みは同じ 1 つの事実の射影である。
- 返る `claimToken` はその claim が生きているあいだ不変で（冪等な `activate` の再実行でも変わらない）、同じ鍵に**後から**張られた claim とは必ず異なる。**同じ `operationId` が張り直した場合でも一致しない** — 予約の operation ID は決定的なので（`updateProfile` の `profileOperationId(userId):handle:X`）、同じ ID の claim が同じ鍵に 2 回生まれうる。トークンを `operationId` から導くバックエンドはこの条件で落ちる（＝ ADR-002 が `operationId` を条件に採らなかった理由を、契約が明示的に排除する）。
- `beginRelease` が取り壊せるのは「`active` かつ所有者が `expectedUserId` かつトークンが `expectedClaimToken` と一致する行」**だけ**。行なし / `reserved` / `releasing` / 別利用者 / トークン不一致はすべて no-op。**`releasing` を明示的に no-op 側へ入れる**のが現行実装からの変更点で、これは「別 operation が `releasing` 行を再キー付けして奪える」という契約に書かれていなかった振る舞いを閉じる（ADR 026 決定 1: スイートだけが規定している振る舞いを残さない）。
- `releasing` 行の `claimToken` は**未規定**（`resolveClaim` から観測できないので、保存するバックエンドとしないバックエンドのどちらも契約を満たす）。同じ operation の `beginRelease` 再実行は行が既に `releasing` なので no-op になり、続く `release(operationId)` が同じ最終状態へ収束させる。
- `releasing` 行を落とせるのは、その行を再キー付けした operation の `release(operationId)` だけ。したがって解放の呼び出し元は、応答喪失後に同じ ID を再導出できる決定的な operation ID を使わなければならない。
- `expectedClaimToken` は必須。無条件の取り壊しを型として表現できないようにする（呼び出し側が観測を省略できない）。

`spec/domains/identity.md` の「非対称が 4 つある」は**4 つのまま**。4 項は `resolve` / `reserve` / `beginRelease` / `release` のメソッドに 1 対 1 で対応しており、今回足すのは `beginRelease` の項の中身（トークン条件と `releasing` の明示）。`resolveClaim` の非対称は `resolve` と同一なので独立項にはしない。

`resolve` は残す（9 か所の呼び出し元は claim の同一性に関心が無い）。実装は `resolveClaim` の射影として書き、2 つの読みが食い違わないようにする（適合スイートで拘束する）。

#### 2. `IdentityPolicy` — 「同じ外部アカウントを 2 度名乗らない」を集合の規則として置く

経路 2 は「利用者の identity 集合に同じ `(provider, providerAccountId)` の行が 2 件生える」ことなので、判定材料は**既に読み込まれている identity 集合**であり、`findPassword` と同じ位置に置ける。

```ts
findOAuth: (
  identities: readonly Identity[],
  provider: OAuthProvider,
  providerAccountId: string,
): OAuthIdentity | null => ...
```

これは ADR 054（provider account の一意性の担保は予約ディレクトリだけ）と衝突しない。ディレクトリが持つのは**全利用者にまたがる**一意性、この述語が見るのは**1 利用者の集合の中**の重複で、`IdentityRepository` に検査を足すわけでもない（adr.md ADR-005）。この境界は spec 側にも書く（ステップ 11）。

### ユースケース / アプリケーションロジック

#### 3. `uniqueness.ts` — 観測と解放を 2 段に分ける

```ts
export type ObservedUniqueClaim = UniqueKey & ActiveUniqueClaim;

/** 期待する持ち主が今その鍵の恒久 claim を持っているかを観測する。
 *  別利用者・`reserved`・`releasing`・行なしはすべて null。 */
export async function observeActiveUniqueKey(deps, params: UniqueKey & { expectedUserId: UserId }): Promise<ObservedUniqueClaim | null>

/** 観測した claim だけを取り壊す。observed が null なら beginRelease は
 *  呼ばず、`release(operationId)` だけを走らせる（中断した取り壊しの掃除）。 */
export async function releaseObservedUniqueKey(deps, params: { observed: ObservedUniqueClaim | null; operationId: string }): Promise<void>

/** 観測と解放が連続してよい呼び出し元のための合成。既存シグネチャのまま。 */
export async function releaseActiveUniqueKey(deps, params): Promise<void>
```

`updateProfile`（旧 handle の取り壊し）と `deleteAccount/globalCleanup`（削除アカウントの全鍵）は `releaseActiveUniqueKey` のままにする。この 2 つは観測と `beginRelease` が連続するので、**契約変更に追随はするが窓は縮むだけで閉じない** — 観測より前に張り替えられた claim はそのままトークンごと観測されて取り壊される。Issue 本文が「窓を縮めるだけ」として退けた形と同じであり、CAS の保護を受けるとは言えない。観測を判定より前に取る必要があるのは `identityRemovalRelease` だけで、そこだけが 2 段を使う（plan.md スコープ「含まれないもの」に残存窓を記載）。

#### 4. `identityRemovalRelease` — 「観測 → 判定 → 条件付き解放」

順序が正しさの本体なので、観測を Global UoW の**前**に置く。

```
1. event.payload.providerAccountKey が null なら終了
2. observed = observeActiveUniqueKey({ kind: "providerAccount",
     normalizedKey: event.payload.providerAccountKey,
     expectedUserId: event.payload.userId })        ← 判定より前
3. Global UoW: receipt → identity 行の不在 → 再連携の不在 で decision
4. decision が keep なら理由をログして終了
5. releaseObservedUniqueKey({ observed, operationId })
```

- 手順 2 を手順 3 より後ろに置くと、判定後に割り込んだ再連携の claim を観測してしまい CAS が素通りする。**この順序はコメントで理由を残す。**
- 観測を判定 UoW の**中**（`ctx.identityUniqueDirectory`）で取る形は採らない。理由は adr.md ADR-001 を参照（鍵 shard と UserId shard を 1 トランザクションに入れない）。
- **解放する鍵は観測したもの**（event payload 由来）。受領は判定の材料にとどめる。受領と event は `removeIdentity` の同一トランザクションで書かれるので `providerAccountKey` / `userId` / `operationId` は必ず一致し、両者が食い違う分岐は到達不能。したがって新しい keep 理由（`receiptMismatch`）は導入しない。`ReleaseDecision` の keep 理由は現行の 3 つ（`noReceipt` / `identityStillPresent` / `providerAccountRelinked`）のままとし、release 側は鍵と利用者を運ばなくてよくなる（観測が既に固定している）。
- 手順 5 は observed が null でも `release(operationId)` を走らせる（`beginRelease` の直後に落ちた先行配送が残した `releasing` 行の掃除）。event の再配送は同じ `operationId` を再導出するので、この経路は自力で収束する。

#### 5. `linkOAuthIdentity` / `completeOAuthSignIn.attachToExistingUser` — 再連携で治癒させる

最終 UoW の中で、上限判定より**前**に既存行を探す。

```ts
const identities = await ctx.identityRepository.listByUserId(userId);
const existing = IdentityPolicy.findOAuth(identities, provider, providerAccountId);
if (existing !== null) {
  // 予約サガが commit 済み・activate 失敗で終わった残骸。identity 行は
  // 既にあるので、2 件目を生やさずに今回の予約を activate して claim を
  // 復旧させる。
  return { identityId: existing.id, committedVersion: fresh.entity.version };
}
IdentityPolicy.ensureAddable(identities);
...insert
```

- `completeOAuthSignIn.attachToExistingUser` では identity の insert だけを飛ばし、セッションの insert は従来どおり行う（サインインは成立させる）。
- どちらも UoW 抜けたあとの `activateUniqueKeys` はそのまま通る（今回の予約行が `active` になり、後ろ盾の無かった identity 行が claim を取り戻す）。
- `linkOAuthIdentity.existingLinkId` の手書きの述語も `IdentityPolicy.findOAuth` に寄せる（同一ファイル内の同じ述語の二重定義を残さない）。合成鍵 `providerAccountKey(...)` で書かれている `completeOAuthSignIn.signInLinkedUser` / `identityRemovalRelease.stillClaimed` は触らない（plan.md スコープ外）。

### アダプター / 永続化 / 外部連携

`adapters/memory` のみ（現行の唯一のバックエンド）。

- `DirectoryRow` に `claimToken: string`（**非 null**）を足し、**`reserve` が行を書くときに採番する**。行が生成時から必ずトークンを持つので「トークンを持たない `active` 行」という状態が型として表現できなくなり、`resolveClaim` に到達不能な実行時分岐（null ならプログラミングエラー）を残さずに済む。行の型を state ごとの判別可能ユニオンにする案は、`{...row, state: "releasing"}` 形のスプレッド更新を全面的に書き換えることになるので採らない — 採番位置を `reserve` に上げるだけで同じ不変条件が構造的に取れる。
- `MemoryBackend` にバックエンド寿命で単調増加するトークン採番（`nextClaimToken()`）を持たせる。ディレクトリのファクトリは 1 backend につき複数回呼ばれる（`globalUnitOfWork` / request / worker）ので、採番はクロージャではなく backend に置く。`idGenerator` は使わない（テストの決定的 ID 列がずれる）。
- 契約が要求する 2 性質は `reserve` 採番でも保たれる。同一 operation の冪等 `reserve` は既存行を早期 return（`reserved` なら `{...existing, expiresAt}` のスプレッド）するのでトークンが動かず、失効した `reserved` 行の奪取と `release` 後の再予約はどちらも新しい行オブジェクトを書くので新しいトークンになる。**後者には「同じ `operationId` での張り直し」も含まれる** — `release` が行そのものを削除するので、次の `reserve` は `existing === undefined` の枝を通って新規採番する。つまりトークンが `operationId` に依存しないという契約の強い形（設計 1）を memory は追加の実装なしで満たす。`activate` は `{...row, state: "active"}` でトークンを引き継ぐだけで、**トークンに関する分岐を持たない**（既に `active` の行を素通りする現行の冪等性もそのまま）。
- `resolveClaim` の条件は **`state === "active"` だけ**。トークンの有無を可視条件にしてはいけない（`resolve` が持ち主を隠すことになり `ADP-identity-006` 系の既存の主張と食い違う）。
- `releasing` 行はスプレッド更新でトークンを持ち越すが、`resolveClaim` から観測できないので契約上は未規定のまま（ADR-007）。
- `resolve` は `resolveClaim` の射影として実装する。
- `beginRelease` の no-op 条件を「`row === undefined || row.state !== "active" || row.userId !== expectedUserId || row.claimToken !== expectedClaimToken`」に置き換える。`state !== "active"` にすることで `reserved` に加えて `releasing` も no-op になる（契約の明示に合わせる）。

### UI / プレゼンテーション

影響なし（ワーカーとサインイン系ユースケースの内部だけで閉じる）。

---

## 実装ステップ

### 1. ポート契約を拡張する

- **対象ファイル:** `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`
- **変更内容:** `ActiveUniqueClaim` 型を追加。`resolveClaim` をインターフェースに追加。`beginRelease` の入力に `expectedClaimToken: string`（必須）を追加。JSDoc に設計 1 の契約文をすべて書く — (a) claimToken は 1 つの claim の同一性であって鍵の同一性ではない（claim が生きているあいだ不変で、取り壊して張り直した claim とは一致しない — **張り直しが同じ `operationId` で行われた場合でも**。予約の operation ID は決定的なので、同じ ID の claim が同じ鍵に 2 回生まれうる）、(b) 不透明・比較専用・ログに出さない、(c) `active` 行は必ずトークンを持ち（`ActiveUniqueClaim.claimToken` は非 null）`resolve` は `resolveClaim` の射影である、(d) `beginRelease` が取り壊せるのは「`active` かつ所有者一致かつトークン一致」の行だけで、行なし / `reserved` / **`releasing`** / 別利用者 / トークン不一致は no-op、(e) `releasing` 行のトークンは未規定で、その行を落とせるのは再キー付けした operation の `release` だけ（だから解放の呼び出し元は決定的な operation ID を使う）。
- **理由:** 契約の正本はポート定義。ここが変わらないと適合スイートもアダプターも根拠を持てない。`releasing` の扱いを明示するのは、スイートだけが規定している振る舞いを残さないため（ADR 026 決定 1）。

### 2. `IdentityPolicy.findOAuth` を足す

- **対象ファイル:** `packages/core/src/domain/identity/services/identityPolicy.ts`
- **変更内容:** `findPassword` に倣って `findOAuth(identities, provider, providerAccountId): OAuthIdentity | null` を追加。
- **理由:** 「1 利用者の identity 集合に同じ外部アカウントを 2 度置かない」は集合に対する業務規則で、ユースケースに手書きの `some(...)` を増やす場所ではない。

### 3. memory アダプターを契約に合わせる

- **対象ファイル:** `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`
- **変更内容:** `DirectoryRow.claimToken: string`（非 null）の追加、`MemoryBackend.nextClaimToken()` の追加、**`reserve` の新規行書き込みでのトークン採番**（同一 operation の冪等 `reserve` はスプレッドで据え置き、失効行の奪取は新しい行なので新トークン。`activate` はトークンに触らない）、`resolveClaim` の実装（条件は `state === "active"` のみ）、`resolve` をその射影に、`beginRelease` の no-op 条件を `state !== "active"` + 所有者一致 + トークン一致に置き換え。
- **理由:** 参照バックエンドは fake ではなく本番配線で動く実装なので、契約と同時に更新する。採番を `activate` ではなく `reserve` に置くのは、「`active` 行は必ずトークンを持つ」を実行時チェックではなく型（非 null）で表すため（CLAUDE.md「不正な状態を型で表現できなくする」）。

### 4. 適合スイートで新しい契約を拘束する

- **対象ファイル:** `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`
- **変更内容:**
  - 既存の `beginRelease` ヘルパーを「`resolveClaim` で観測してから渡す」形に変え、既存 **6 ケース**（解放できる / `releasing` は他人に奪えない / 冪等 / 別利用者は no-op / `reserved` は no-op / 行なしは no-op）を維持する。
  - **所有者不一致ケースには固定文字列ではなく正しい観測値を渡す** — `userId(1)` の claim を `resolveClaim` で観測し、そのトークンをそのまま `expectedUserId: userId(2)` で渡す。「トークンは一致するのに所有者が違うので no-op」という元の主張が残り、`expectedUserId` の検査を落とした実装をスイートが落とせる。`reserved` / 行なしのケースは観測が取れないので固定文字列でよいが、その no-op がトークン条件に吸収されて独立には識別できなくなることをケース内のコメントに 1 行残す。
  - `ADP-identity-042: resolveClaim は active な claim の持ち主とトークンを返す`（`reserve` 直後は null、`activate` 後は非 null、`beginRelease` 後は null）。
  - `ADP-identity-042: トークンは claim が生きているあいだ変わらない`（複数回の `resolveClaim` と冪等 `activate` を挟む）。
  - `ADP-identity-042/ADP-identity-041: 同じ operation が張り直した claim でもトークンは前と異なる`。列は `reserveEmail("op-1")` → `activate("op-1", 0)` → `resolveClaim` で T1 を観測 → `beginRelease`（T1 を渡す）→ `release("release-1")` → **同じ `"op-1"` で** `reserveEmail` → `activate("op-1", 0)` → `resolveClaim` で T2 を観測 → `T2 !== T1`。**別の `operationId`（`"op-2"`）で張り直す弱い形にしてはいけない** — それだと `claimToken = f(kind, key, operationId)` のようにトークンを `operationId` から導くバックエンドでも一致しないトークンが返ってケースが通り、ADR-002 が却下した穴（`updateProfile` の決定的な予約 operation ID では同じ ID の claim が同じ鍵に 2 回生まれる）がそのまま再現する。ヘルパー `reserveEmail(operationId, ...)` の使い方に素直に従うと弱い形を書いてしまうので、ケース内に 1 行コメントで「同じ ID で張り直すのが要点」と残す。memory は `release` が行を削除するので同じ ID の `reserve` も新規採番の枝を通り、実装側の追加変更なしで通る。
  - `ADP-identity-042/ADP-identity-006: resolve は resolveClaim の射影`（行なし / `reserved` / `active` / `releasing` の 4 状態それぞれで `resolve(k,n)` と `resolveClaim(k,n)?.userId ?? null` が一致する）。
  - `ADP-identity-041: 古いトークンの beginRelease は現行の claim を壊さない`（張り直したあとに旧トークンで `beginRelease` → `release` しても `resolve` が持ち主を返し続ける）。
  - `ADP-identity-041: releasing 行は別 operation の beginRelease に奪われない`（`beginRelease("release-1")` で `releasing` にしたあと、観測済みの旧トークンで `beginRelease("release-2")` → `release("release-2")` しても行は残り、`reserve` は依然ブロックされる。`release("release-1")` で初めて落ちる）。
- **理由:** ADR 026 — 契約の実行形は共有スイート。新バックエンドはこのスイートで同じ性質を要求される。射影と `releasing` の 2 ケースは、JSDoc だけを読んで実装したものが分岐しうる点を落とすために要る。

### 5. `uniqueness.ts` に観測と条件付き解放を置く

- **対象ファイル:** `packages/core/src/application/identity/uniqueness.ts`
- **変更内容:** `ObservedUniqueClaim` 型、`observeActiveUniqueKey`、`releaseObservedUniqueKey` を追加し、`releaseActiveUniqueKey` を両者の合成に書き換える。`holdsActiveUniqueKey` は `resolve` のままでよい。`releaseActiveUniqueKey` の JSDoc に「観測と `beginRelease` が連続するので、判定を挟む呼び出し元の窓は閉じない。順序が問題になるなら 2 段の方を使う」を書く。**`releaseObservedUniqueKey` は observed が null でも `release(operationId)` を必ず呼ぶ**（`if (observed === null) return;` と書かない）。ADR-007 で `releasing` 行を落とせるのが同一 operation の `release` だけになったため、これが孤児 `releasing` 行の唯一の回収経路になる — 早期 return するとその鍵が恒久的に使用不能になる。JSDoc にこの理由を残し、**AC-8 / TC-identity-345 が実行形として拘束する**（ステップ 9）。
- **理由:** `updateProfile` / `deleteAccount` を無改修のまま新しい契約に追随させ、順序が問題になる呼び出し元だけが 2 段を選べるようにする。

### 6. `identityRemovalRelease` を「観測 → 判定 → 条件付き解放」に組み替える

- **対象ファイル:** `packages/core/src/application/identity/identityRemovalRelease.ts`
- **変更内容:** 観測を Global UoW の前に移し、解放を `releaseObservedUniqueKey` にする。`ReleaseDecision` の release 分岐は鍵 / 利用者を運ばなくなる（観測が固定済み）。keep 理由は現行の 3 つのまま。JSDoc の「closing it needs a compare-and-set on the directory row — #21」を、閉じた事実と**観測を判定より前に取る理由**の説明に差し替える。ログは従来どおり `operationId` と keep 理由だけを出す（鍵の値は出さない — ADR 048）。**「解放を見送った」をログに残せるのは観測が null だった分岐だけ**で、`beginRelease` が `Promise<void>` を返す契約のままである以上、トークン不一致で no-op になったことは呼び出し側から観測できない — 「CAS が外れたらログする」とは書かない。
- **検証:** AC-4（TC-identity-342：観測が判定 UoW より前）、AC-8（TC-identity-345：observed が null でも `release` を呼ぶ）、AC-6（既存の逐次再配送ガードが従来どおり）。
- **理由:** 経路 1 の本体。順序を含めてここで確定させる。

### 7. `linkOAuthIdentity` の重複を治癒に倒す

- **対象ファイル:** `packages/core/src/application/identity/linkOAuthIdentity.ts`
- **変更内容:** 最終 UoW で `IdentityPolicy.findOAuth` を `ensureAddable` の前に呼び、既存行があれば insert を飛ばしてその ID と `fresh.entity.version` を返す。`existingLinkId` の手書き述語も `findOAuth` に寄せる。
- **理由:** 経路 2。identity 行が既にあるのに 2 件目を生やす唯一の入口を塞ぎつつ、後ろ盾を失った行に claim を返す。

### 8. `completeOAuthSignIn` の既存利用者分岐を同じ形にする

- **対象ファイル:** `packages/core/src/application/identity/completeOAuthSignIn.ts`
- **変更内容:** `attachToExistingUser` の UoW で `findOAuth` を `ensureAddable` の前に呼び、既存行があれば identity の insert とイベント収集だけを飛ばす（セッションの insert は行う）。
- **理由:** 同じ穴がもう 1 本のユースケースにも空いている（Issue コメント）。

### 9. 経路 1 の注入テストと孤児 `releasing` 行の回収テストを足し、直接呼び出しの型崩れを直す

- **対象ファイル:** `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`
- **変更内容:**
  - `checkHandleAvailability.test.ts:67`（「answers free for a claim being torn down…」）の `identityUniqueDirectory.beginRelease({...})` は**オブジェクトリテラルの直接呼び出し**なので、`expectedClaimToken` の必須化でコンパイルできなくなる。**先に `resolveClaim("handle", "ichiro")` して観測したトークンを渡す**形に直す（観測は非 null のはずなので、null なら `throw` して意図を明示する）。ダミー文字列を渡すと `beginRelease` が no-op になり、行が `active` のまま残って `available: true` / `ownedBySelf: false` の主張が黙って落ちるので、この直し方以外を採らない。ユースケーステストから `beginRelease` を直接呼んでいるのは**このファイルだけ**で、`deleteAccount.globalCleanup.test.ts:167` / `updateProfile.test.ts` / `completeOAuthSignIn.test.ts` の差し替えはいずれも実ディレクトリのスプレッド（引数を取らない差し替え関数）なので `expectedClaimToken` の追加でも `resolveClaim` の追加でも壊れない。
  - `TC-identity-342`。`h.workerContainer` をスプレッドし、**`globalUnitOfWorkProvider`** を「実プロバイダーの `run` に委譲し、解決した直後に 1 度だけ割り込みを走らせる」ラッパーに差し替えた worker container を作り、その container で `dispatchDomainEvent` する（`run: async (cb) => { const r = await real.run(cb); if (!fired) { fired = true; await interfere(); } return r; }`）。割り込みは `run` が解決したあとに走るので UoW のネストにはならない。`identity.identity.removed` の subscriber は `identityRemovalRelease` 1 本だけなので、one-shot ガードで狙った UoW を確実に捕まえられる。割り込みの中身は (a) 素の container での `drainRemovalEvents`（＝先行配送が解放を完了）、(b) `beginOAuthFlow` + `linkOAuthIdentity` による本人の再連携。事後に `resolve("providerAccount", "google:google-account-1")` が本人を返し、再連携された identity 行が残り、directory 行が `active` であることを検証する。
  - `TC-identity-345`。`h.workerContainer` をスプレッドし、`identityUniqueDirectory.release` **だけ**が最初の 1 回で throw する（以降は実アダプターに委譲する）ラッパーに差し替えた container で 1 度目の配送を走らせ、`beginRelease` 済み・`release` 前の中断を作る。`directoryRow(h, "google:google-account-1")?.state` が `releasing` であることを確認したうえで、**素の `h.workerContainer`** で同じ removal event を再配送し、行が消える（`directoryRow(...)` が `undefined`）ことと、別の利用者がその鍵を `reserve` できることを検証する。`releaseObservedUniqueKey` が観測 null で早期 return する実装ではここで落ちる（再配送時の観測は `releasing` 行なので null になる）。
- **理由:** 受け入れ基準 AC-4 / AC-8。ADR-007 が `releasing` 行の回収を同一 operation の `release` 再実行に一本化したので、その唯一の回収経路をテストで拘束しないと、早期 return 実装が全 green のまま通り鍵が恒久的に使用不能になる。割り込みを `identityUniqueDirectory.beginRelease` に置くと、割り込みは観測より必ず後に発火するため「判定 → 観測 → CAS」という誤った順序の実装でも旧トークンを観測して no-op になり、テストが通ってしまう。判定 UoW のコミット直後に置けば、誤順序の実装は割り込み後の**新しい** claim（同一利用者）を観測してトークンが一致し、claim を壊してテストが落ちる — 正しい順序だけが通る。fake は増やさず、実プロバイダーを包む薄いラッパーで窓を作る（`docs/test.md` の fake ポリシー）。`checkHandleAvailability.test.ts` を同じステップで扱うのは、`expectedClaimToken` の必須化が生む唯一のコンパイル不能箇所であり（ステップ 1 の型変更の帰結）、直し方を誤ると AC-6 の回帰主張が黙って落ちるため。

### 10. 経路 2 の注入テストを足す

- **対象ファイル:** `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`
- **変更内容:** どちらも `h.container` をスプレッドして `identityUniqueDirectory.activate` だけが必ず throw するラッパーに差し替え、サガを commit 後に停止させる。`h.clock.advance(UNIQUE_RESERVATION_TTL_MS + 1)` のあと素の container で再連携 / 再サインインする。主張は経路ごとに分ける。
  - `TC-identity-343`（`linkOAuthIdentity`）: identity 行が 1 件・`resolve("providerAccount", key)` が本人（＝ claim が `active` に復旧）・返る `identityId` が既存行の ID。
  - `TC-identity-344`（`completeOAuthSignIn`）: identity 行が 1 件・`resolve("providerAccount", key)` が本人（＝ claim が `active` に復旧）・セッションが発行される。provider が返す email を既存利用者の account email と一致させ、`attachToExistingUser` に落ちる前提を明示する。`CompleteOAuthSignInView` は `identityId` を持たないので 343 の ID 主張はここには置かない。
- **理由:** 受け入れ基準 AC-5。

### 11. spec の契約側を更新する

- **対象ファイル:** `spec/domains/identity.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/testcases/identity/{removeIdentity,linkOAuthIdentity,completeOAuthSignIn}.md`, `spec/usecases/identity.md`
- **変更内容:**
  - `spec/domains/identity.md#ポート`: インターフェースのコードブロックに `resolveClaim` と `expectedClaimToken` を反映。2 相の散文に「取り壊しは観測した claim に対する条件付き」を書き足す。**「非対称が 4 つある」は 4 つのまま**とし、`beginRelease` の項の中身にトークン条件と `releasing` の no-op、および「`releasing` 行を落とせるのは再キー付けした operation の `release` だけ」を追記する。`resolve` の項に「`resolveClaim` の射影」を 1 文添える。
  - `spec/domains/identity.md#ドメインサービス`: `IdentityPolicy` のメソッド表に `findOAuth` の行を追加し、末尾散文の「Identity追加を伴う `completeOAuthSignIn` / `linkOAuthIdentity` / `addPasswordIdentity` は UserId shard の最終 UoW 内で current 集合を読み直して `ensureAddable` してから insert する」を、「OAuth の 2 経路は `ensureAddable` の**前**に `findOAuth` を引き、同一 `(provider, providerAccountId)` の既存行があれば追加せず今回の予約を activate して claim を復旧させる」と整合する形に直す（順序が load-bearing であることを明示）。
  - `spec/domains/identity.md` の「provider account の一意性は `IdentityUniqueDirectory` が唯一の担保」「`(provider, providerAccountId)` の一意性はここでは検査しない」の 2 か所に、境界を 1 文添える — ディレクトリが担保するのは全利用者にまたがる一意性、`findOAuth` が見るのは 1 利用者の identity 集合内の重複であり、`IdentityRepository` に検査は足さない（ADR 054 / ADR 060 へリンク）。
  - `spec/inventory/adapter.md`: `ADP-identity-042`（`IdentityUniqueDirectory.resolveClaim`）を identity 群の末尾に追加。`ADP-identity-041` の説明にトークン条件と `releasing` の no-op を追記。**`ADP-identity-006`（`IdentityUniqueDirectory.resolve`）の説明に「`resolveClaim` の射影（`resolveClaim(k,n)?.userId ?? null` と常に一致する）」を 1 句追記する** — 射影関係は本文（`spec/domains/identity.md#ポート`）に足す新しい契約文なので、`beginRelease` 側に追記するのと同じ理由（台帳は本文の生成物、ADR 058 / 059）で `resolve` 側にも要る。
  - `spec/inventory/domain.md`: `DOM-identity-066`（`resolveClaim`）を末尾に追加、`DOM-identity-062` に追記。**`DOM-identity-027`（`IdentityUniqueDirectory.resolve`）にも `ADP-identity-006` と同じ「`resolveClaim` の射影」の 1 句を追記する**（両台帳の `resolve` 行は現在同文なので、同文のまま揃える）。`DOM-identity-019`（`IdentityPolicy`）の説明に `findOAuth` を追記する（ADR 052 のとおりドメインサービスは 1 行 = 1 サービスなので新規行は起こさない）。
  - `spec/inventory/test.md`: `TC-identity-342` / `343` / `344` / `345` を末尾に追加。
  - `spec/inventory/usecase.md`: `UC-identity-007`（`linkOAuthIdentity`）の「有効利用者の現在の認証手段集合へ上限内で OAuth identity を追加する」と `UC-identity-006`（`completeOAuthSignIn`）の「認証手段とセッションを原子的に保存する」に、「同一 `(provider, providerAccountId)` の既存行があれば追加せず、今回の予約を activate して claim を復旧させる」を 1 句加える。`UC-identity-015`（`removeIdentity`）の「冪等解放する」は「判定前に観測した claim に対する条件付き解放」でも成り立つが、条件付きであることを 1 句添えてよい（本文＝`spec/usecases/identity.md` の手順 4 と整合させる）。台帳は本文の生成物なので、本文だけを直して台帳を残すと台帳が偽になる（ADR 058 / ADR 059）。
  - `spec/testcases/identity/*.md`: 対応する行を各テーブルに追加（`removeIdentity.md` は `TC-identity-342` と `TC-identity-345` の 2 行）。
  - `spec/usecases/identity.md`: `removeIdentity` 手順 4 に「解放は判定前に観測した claim に対する条件付きで行う」、`linkOAuthIdentity` 手順 4 と `completeOAuthSignIn` 手順 8 に「同一 `(provider, providerAccountId)` の既存行があれば追加せず予約を activate して claim を復旧させる」を書き足す。あわせて **`completeOAuthSignIn` 手順 6（`linkToExisting`）** を治癒と整合させる — 現在は「providerAccount reservation を確保し、既存 UserId shard で `Identity.createOAuth` を保存後に activate する」と**無条件の保存**として書かれており、手順 8 だけを直すと手順 6 が単独で読んだときに偽になる。「既存行があれば保存せず今回の予約を activate するだけ（手順 8）」への 1 句を添えるか、保存を条件付きと書き換える。
  - 台帳への波及の**漏れ止め**: この節で本文に足す新しい契約文は (i) `beginRelease` のトークン条件と `releasing` の no-op、(ii) `resolve` = `resolveClaim` の射影、(iii) `IdentityPolicy.findOAuth`、(iv) OAuth 2 経路の治癒 — の 4 つで、対応する台帳行はそれぞれ `ADP-identity-041` / `DOM-identity-062`、`ADP-identity-006` / `DOM-identity-027`、`DOM-identity-019`、`UC-identity-006` / `UC-identity-007` である。新規行は `ADP-identity-042` / `DOM-identity-066` / `TC-identity-342..345`。
- **理由:** ポート契約・ドメインサービス・処理フローはいずれも spec の持ち分。台帳は 1 行 = 1 ポートメソッドで末尾採番（ADR 052）。

### 12. ADR を起票して既存 ADR の整合を取る

- **対象ファイル:** `spec/adr/060-conditional-unique-claim-teardown.md`（新規）, `spec/adr/index.md`, `spec/adr/038-provider-account-claim-and-identity-row.md`, `spec/adr/054-provider-account-uniqueness-owner.md`
- **変更内容:**
  - 060 に「恒久 claim の取り壊しは、観測した claim に対する条件付きにする」を記録する。「検討した代替案」には、判定 UoW 内観測案（採らない理由 = 鍵 shard と UserId shard を 1 トランザクションに入れない）と、受領への operation ID 凍結案（**依然として却下**）を残す。Consequences には、`releasing` 行の回収が同じ operation の `release` 再実行だけになること、`reserved` / 行なしの no-op がトークン条件に吸収されて独立には識別できなくなることを書く。
  - **前提列**には 023（ディレクトリの書き込みが UoW の外にある＝窓が開く根本原因）/ 026（契約の正本と実行形）/ 048（鍵の値をディレクトリの外へ出さない＝条件を不透明値にした直接の理由）/ 038（claim と identity 行を対で読む）を挙げる。`index.md` の一覧に 1 行、前提依存マップに `| 060 恒久 claim の条件付き取り壊し | ディレクトリの書き込みが UoW の外にあること（023）、契約の正本がポート定義で検証が共有スイート（026）、鍵の値をシンクへ出さないこと（048）、claim と identity 行を対で読むこと（038）、配送が at-least-once で複数ワーカーでは判定と解放の窓が広がること | 取り壊しは観測した claim に対する条件付き、条件は不透明値 |` の形で 1 行を足す。
  - **ADR 038 の却下案「受領に予約行の operation ID を凍結し、解放時に照合する」は却下のまま残す**。060 が置き換えるのはこの却下案ではなく、**却下理由の一部**だけ — 「ポート・アダプター・適合スイートの変更に波及し、効果は変わらない」のうち「効果は変わらない」が古びた（複数ワーカー配備では application 側の判定だけでは同じ効果が得られない）。理由文のその部分を差し替え、060 への参照を添える。凍結案そのものを却下する理由（平面をまたぐ読みを 1 トランザクションに持ち込む / バックエンド固有の不透明値を 30 日保持の受領に永続化する）は 060 の「検討した代替案」にも書き、有効な却下判断が canon から消えないようにする。
  - ADR 038 の**決定**の「解放側」の項に「この述語は必要条件であって十分条件ではない（判定と `beginRelease` のあいだの窓は ADR 060 の条件付き取り壊しが閉じる）」を 1 行足す。影響欄「解放が恒久的に落ちた場合は固まる」はそのまま有効。
  - ADR 054 に、060 が引いた境界（全利用者にまたがる一意性はディレクトリ、1 利用者の集合内の重複は `IdentityPolicy.findOAuth`、担保元は動かない）への参照を 1 行足す。
- **理由:** 「コードで驚く箇所には ADR がある」状態を保つ。有効な却下判断を消さずに、古びた前提だけを更新する。

### 13. 品質ゲート

- **対象ファイル:** —
- **変更内容:** `pnpm typecheck && pnpm lint:fix && pnpm format` と `pnpm test`。特に memory の適合ラン（`adapters/memory/__tests__`）と identity のユースケース群。
- **理由:** CLAUDE.md の後処理規約。契約変更は型で全バックエンドに波及するので typecheck が最初の検証になる。
