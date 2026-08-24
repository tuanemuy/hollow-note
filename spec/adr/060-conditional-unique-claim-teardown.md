# 060. 恒久 claim の取り壊しは、観測した claim に対する条件付きにする

## ステータス

承認済み

## コンテキスト

一意性予約ディレクトリへの書き込みは UoW の外にある（[ADR 023](./023-two-plane-unit-of-work.md)）。identity 行の削除を判定する側は UserId shard のトランザクションで判定を済ませ、鍵 shard の `beginRelease` はそのトランザクションの外で走る。判定と取り壊しのあいだには必ず窓が開く。

その窓に本人の再連携が入ると、取り壊しは「判断の対象になった claim」ではなく「そのあとに張られた別の claim」を壊す。結果は「identity 行はあるが claim が無い」状態で、別の利用者がその外部アカウントを奪える。[ADR 038](./038-provider-account-claim-and-identity-row.md) が置いた「その鍵を今名乗る identity が居ないこと」という述語は、判定時点では正しいが、`beginRelease` の時点まで正しさを運べない — 必要条件ではあっても十分条件ではない。判定を `beginRelease` の直前に移しても窓が縮むだけで閉じない。

同型の穴が逆向きにもある。予約サガが commit したあと `activate` を失い、`reserved` 行が TTL で失効すると、identity 行だけが後ろ盾を失う。この状態で本人が再連携すると、現行の実装は 2 件目の identity 行を生やし、1 件目は永久に claim を持てない。

配送は複数ワーカーへ広がる予定であり（#11 / #19）、そのとき窓は単一プロセスの実行順という偶然に守られなくなる。

## 前提

ディレクトリの書き込みが UoW の外にあること（[ADR 023](./023-two-plane-unit-of-work.md)）。ポート契約の正本がポート定義で、その実行形が共有の適合スイートであること（[ADR 026](./026-port-contract-and-conformance.md)）。鍵の値をディレクトリの外のシンクへ出さないこと（[ADR 048](./048-uniqueness-reservation-operation-id.md)）。claim と identity 行を対で読むこと（[ADR 038](./038-provider-account-claim-and-identity-row.md)）。配送が at-least-once で、複数ワーカー配備では判定と解放の窓が広がること。

## 決定

- **`beginRelease` を compare-and-set にする。** 入力に `expectedClaimToken` を必須で加え、取り壊せるのは「`active` かつ所有者が `expectedUserId` かつトークンが一致する行」だけにする。行なし / `reserved` / `releasing` / 別利用者 / トークン不一致はすべて no-op。必須にするのは、無条件の取り壊しを型として表現できなくするためである
- **観測手段 `resolveClaim` をポートに足す。** `active` の行だけを返し、その claim を同定する `claimToken` を添える。トークンは claim が生きているあいだ不変で、張り直した claim とは必ず異なる — **同じ operation ID で張り直した場合でも**異なる。予約の operation ID は決定的なので（`updateProfile` の `profileOperationId(userId):handle:X`）、同じ ID の claim が同じ鍵に 2 回生まれうるからである。`resolve` は `resolveClaim` の射影として残す
- **値は不透明にする。** 比較にだけ使い、解析・ログ・永続化はしない。生の鍵を含む operation ID を条件に採らないのは [ADR 048](./048-uniqueness-reservation-operation-id.md) の運用と揃えるためである
- **観測は判定より前に取る。** `identityRemovalRelease` は「観測 → 判定 → 条件付き解放」の順で走る。観測を判定の後ろに置くと、割り込んだ再連携の claim を観測してしまい条件が素通りする。順序が正しさの本体なので、注入テスト（TC-identity-342）が実行形として拘束する
- **CAS が外れたときは何もしない。** 例外にすると再配送が止まらず、隔離までカウントが進む。解放しないまま収束させる
- **`release(operationId)` は CAS の結果によらず、観測が `null` でも必ず呼ぶ。** 呼ばないと `beginRelease` と `release` のあいだで落ちた配送が残した `releasing` 行を再配送が掃除できず、その鍵が恒久的に使用不能になる
- **1 利用者の集合内の重複は `IdentityPolicy.findOAuth` が見る。** OAuth の 2 経路（`linkOAuthIdentity` / `completeOAuthSignIn` の既存利用者への追加）は `ensureAddable` の**前**にこれを引き、既存行があれば追加せず今回の予約を activate して claim を復旧させる。ディレクトリが担保する「全利用者にまたがる一意性」（[ADR 054](./054-provider-account-uniqueness-owner.md)）とは別の問いなので、担保元は動かない。弾く実装にすると、activate 喪失で生まれた identity 行が永久に後ろ盾を持てなくなる

## 検討した代替案

### 判定 UoW の中で claim を観測する

窓は同じだけ縮む。しかし鍵 shard の読みを UserId shard のトランザクションに持ち込むことになり、[ADR 023](./023-two-plane-unit-of-work.md) が引いた 2 平面の境界を越える。観測は UoW の外に置いても順序さえ守れば同じ保護が得られる。

### 受領に予約行の operation ID を凍結し、解放時に照合する

[ADR 038](./038-provider-account-claim-and-identity-row.md) が却下した案で、**却下のままとする**。平面をまたぐ読みを 1 トランザクションに持ち込み、かつバックエンド固有の不透明値を 30 日保持の受領へ永続化することになる。ただし当時の却下理由のうち「効果は変わらない」は古びた — 複数ワーカー配備では application 側の判定だけでは同じ効果が得られない。効果の差ではなく、平面の境界と受領の内容が却下の理由である。

### `beginRelease` の直前で判定し直す

窓は縮むが閉じない。読み直しと `beginRelease` のあいだにも同じ割り込みが入りうる。

### application レベルの OCC リトライを足す

CLAUDE.md が「意図的に置かない」としている。CAS が外れた場合の正しい振る舞いは再試行ではなく no-op である。

## 影響

- `identityRemovalRelease` の判定と取り壊しのあいだに入った再連携が、claim を奪われなくなる
- `releasing` 行を落とせるのは、その行を再キー付けした operation の `release(operationId)` だけになった。ワーカー経路は event 再配送が同じ operation ID を再導出するので自力で収束するが、同期経路の `updateProfile` は再実行の主体が居ないため、`beginRelease` 済み・`release` 前で落ちると旧 handle が固まりうる
- `beginRelease` の no-op のうち「行なし」と「`reserved`」は、観測が取れない以上トークン条件にも吸収される。適合スイートからは独立に識別できなくなる
- `beginRelease` は `Promise<void>` を返す契約のままなので、呼び出し側からは「トークン不一致で no-op になった」と「取り壊した」が区別できない。ログに残せるのは「観測が `null` だった」分岐だけで、CAS が外れた回数は数えられない。観測性の課題として複数ワーカー化（#11 / #19）に持ち越す
- 解放判定のたびにディレクトリの読みが 1 回増える（`keep` に倒れる再配送でも発生）。件数に上限のある単一行読みなので許容する
- `updateProfile` / `deleteAccount` の解放は観測と `beginRelease` が連続するため、契約変更には追随するが窓は縮むだけで閉じない
