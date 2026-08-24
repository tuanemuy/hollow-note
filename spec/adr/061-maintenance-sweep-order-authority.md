# 061. 保守スイープの表順は run のスナップショットを唯一の正本とし、ack は進めた先の position を返す

## ステータス

承認済み

## コンテキスト

保守スイープ（`GlobalMaintenanceRunStore`）の表順は 2 か所にあった。run 生成時に固定される run 行の表集合（lane は index で位置を持つ）と、`pruneExpiredAuthState` 側が持つ表順の定数である。両者が独立しているため、表構成を変えるデプロイをまたいで run を resume すると順序がずれ、呼び出し側が次の表を名指せなくなる。

根本原因は定数の存在そのものではなく、**ポートの応答形状**にある。`advanceOrAck` は lane を進める操作でありながら、進めた先を `{ generation, shardId }` としてしか返さない。呼び出し側は「同じ lane の次の表は何か」を自力で名指す必要があり、そのために 2 本目の正本が生まれた。同じ欠落は別の迂回も生んでいた — lane の最終表を ack すると store が別 shard を自動 claim して返すが、その表 / cursor / command key が応答から読めないため、呼び出し側はいったん解放して claim し直していた（往復 2 回と、その間に他ワーカーへ取られる窓）。

## 前提

契約の正本がポート定義にあり、検証が共有適合スイートであること（[ADR 026](./026-port-contract-and-conformance.md)）。契約と実装の乖離は正本のある側へ倒すこと（[ADR 046](./046-port-contract-divergence.md)）。

## 決定

**進める操作が、進めた先の position を返す。** `advanceOrAck` の応答を `{ next: MaintenanceLane | null; runCompleted: boolean }` にし、呼び出し側の表順の定数を廃する。ポート契約は次の 4 点とする。

1. 表の走査順は **run 生成時に固定した順序付きの表集合**が唯一の正本。run 行はその集合を持ち、lane の position はその集合へのインデックスであって、resume 中に配備の設定が変わってもこの集合は動かない。呼び出し側は表順を持たない
2. `advanceOrAck` は進めた先の lane を position（`table` / `cursor` / `asOf` / `commandKey`）ごと返す。`asOf` は **run 生成時に run 行へ固定された run 自身の境界**で、run のどの lane も同じ値を運ぶ。claim / ack 時の壁時計も `checkpointLane` の `asOf` 入力もこれを上書きしない。別の境界を運ぶ lane は所属する run と違う keyset を掃くことになり、「resume した run は最古の `asOf` を保つ」が lane 側から破れるためである。同一 lane の次表へ進んだ場合の `cursor` は `null`（新しい表は先頭から）。別 shard を自動 claim した場合は、その lane が立っている**永続化済みの位置**をそのまま返す — 一度も claim されていない lane なら run の先頭表の head、既に処理して解放された lane なら checkpoint 済みの表と cursor である。`next` が `null` になるのは 3 つの場合で、**解放（`completed: false`）のとき**（lane を pending に戻すだけで、他に pending な lane があっても新しい lane を claim しない）、**run が完了したとき**、そして**引き渡せる pending lane が無いまま他の lane が claimed で残っているとき**（`{ next: null, runCompleted: false }`）である。`next === null` はそれ自体では run の完了を意味せず、完了は `runCompleted` が別に答える
3. `commandKey` は **position を作った側が mint する**。(a) store が**新しい position を作った**とき — run 生成時に各 lane が立つ先頭 position と、同一 lane を次表へ進めた position — に返すキーは、その position から呼び出し側が導けるキー（`${runId}:${generation}:${shardId}:${table}:${cursor ?? ""}`）と一致する。(b) store が**既存の position を返す**とき — 上記の自動 claim と、`claimLanes` が返すすべての lane — は、その lane に永続化されているキーをそのまま返し、**再 mint しない**。その値が呼び出し側の `checkpointLane` 由来である場合、規則を知っているのは呼び出し側だからである
4. `next` が非 null のとき、その lane は claimed である。**lane を駆動する呼び出し側**（cron 経路）は、それを処理するか解放する責務を負う。単発の継続 turn は、返った lane を claimed のまま次の継続へ引き渡す

契約 2 の「解放は position を返さない」と契約 3 の (a) / (b) の分割は、ポート JSDoc と適合スイートに**対で**置く。

## 検討した代替案

### run の表集合を読み取りで呼び出し側へ配る

表順の「データ」は 1 本になるが、**歩き方の実装が store と呼び出し側の 2 か所に残る**。index を進めるのは store で、次表を名指すのは呼び出し側、という分担が続くかぎり両者がずれる余地は消えない。正本を 1 つにするとは「進める権威が 1 つ」であることで、順序の配列を配ることではない。加えてこの案は別 shard 自動 claim の迂回を残す。

### ack 後に位置を引き直す読み取りをポートに足す

ack のたびに往復が 1 回増え、ack と読み取りの間に lane の状態が動きうる。進める操作が結果を返せば足りるところに、新しいポート面を増やす。

### 二重正本のまま残す

表構成を変えるデプロイをまたいだ resume で run が停滞し、その kind のスイープ全体が止まる。

## 影響

- 表順の正本が run のスナップショット 1 本になり、デプロイ境界が lane の進行に影響しなくなる。別 shard 自動 claim の「解放 → 再 claim」の迂回も消え、往復 2 回と lane を横取りされる窓が無くなる
- 応答形状の変更は全バックエンドに課される要件になる。ポート JSDoc と適合スイートを同時に更新して、[ADR 046](./046-port-contract-divergence.md) が禁じた「JSDoc とスイートで解釈が割れる」状態を作らないことが前提
- 契約 1 は応答形状より重い**スキーマ要件**を課す。run 行が「生成時に固定した順序付き表集合」を持つことと、lane が持つのは表名ではなく**その集合への position（インデックス）**で現在表は run の表集合から導出されることは、[database/index.md](../database/index.md) が対で定める。前者だけでは実装者が「進めた先の表」を配備の設定から引き、消したはずの二重正本がバックエンド側で再生する。後者を欠けば同じ記述の中に「lane が表名を持つ」と「lane は集合へのインデックスを持つ」が併存し、スキーマ側で二重表現になる
- 契約 3 は (a) / (b) に分かれる。checkpoint 済みのキーは規則から外れた文字列でもそのまま保持されるため（既存の適合ケースがまさにそれを渡している）、自動 claim が返すキーに導出キーとの一致を無条件で要求すると契約 2 と両立しない。分けずに書けば実装者は自動 claim 時にキーを再 mint し、checkpoint 時に Queue へ載せた継続要求のキーと食い違って重複排除が畳めなくなる
- 契約 4 は義務だけを書くので、契約 2 に「解放時は `next` が null」を明記しないと片側に穴が残る。リポジトリ内の解放呼び出しはいずれも戻り値を捨てており、「解放は次の lane を claim しない」は明記しない限り実装依存の前提のままになる。実装者が「解放は capacity を空けるので次の pending を返してよい」と読めば、返った lane は claimed になり全呼び出し元がそれを捨てるため、**リース失効まで誰も駆動しない lane** が生まれる
- **引き継ぎ: 返った lane に対する方針は、同じポートの 2 つの呼び出し元で正反対になる。** `pruneExpiredAuthState.runCron` は返った lane をそのまま処理し続ける（表が複数あり lane あたりの仕事が小さく、chain したほうが往復が減る）。`deleteAccount/terminalPrune.runCron` は単一表 kind で 1 invocation の予算を claim した 6 lane に閉じているため、自動 claim された lane を即座に解放して返す。どちらも妥当だが、この根拠を残さないと将来「片方に揃える」リファクタで静かに壊れる
- `next` が claimed な lane を指すという責務は応答形状からは読み取れないので、契約 4 で明示して補う。`claimLanes` の戻り値も同じ性質であり、新種の責務ではない
