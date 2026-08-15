# 053. rollback の完了判定は、ポート述語とユースケースの復帰ゲートに分ける

## ステータス

承認済み

## コンテキスト

アカウント削除の取り消し（rollback）では、2 つの別々の問いが同じ「rollback の完了」という言葉で呼ばれてきた。

- **ポート述語**（`AccountDeletionManifestStore.allRollbackReleased`）— 固定済みの membership item に解放を配り切ったか
- **ユースケースの復帰ゲート** — User を `active` へ戻してよいか

実装と適合スイートは述語を前者だけで判定し、personal barrier の abort receipt を見ない。一方、ポート契約 JSDoc と設計文書は「全 item ack ＋ personal / global receipt 集合が finalize / rollback の正本」と書き、ユースケース側の手順は「personal abort ack を確認してから `active` へ戻す」と書いている。

さらに、rollback 経路そのものは application 層にまだ配線されていない。つまり述語の側は実装 ＋ 適合スイートが正本を持ち、復帰ゲートの側は設計文書だけが正本を持つ。片方の話をもう片方へ写すと、スイートが固定した期待値を壊すか、実装のゲート漏れを設計へ書き写すかのどちらかになる。同じ論点でも、振る舞いの正本がどこにあるかは粒度ごとに違う（[ADR 046](./046-port-contract-divergence.md)）。

## 前提

必須の受領集合が配備の全数宣言から導出されること（[ADR 039](./039-cleanup-participants-declaration.md)）。乖離を倒す向きを、振る舞いの正本がどこにあるかで決めること（[ADR 046](./046-port-contract-divergence.md)）。

## 決定

- **ポート述語 `allRollbackReleased` の判定対象は、固定済み membership item の release ack のみとする。** personal abort receipt は含めない。非対称の理由は問いが違うことにある — rollback は「prepare を出した先へ解放を配り切ったか」、finalize は「全参加者が終えたか」を問う。ポート定義の JSDoc も述語の定義に合わせ、契約文書・実装・適合スイートの三者が同じことを言う状態に保つ（[ADR 026](./026-port-contract-and-conformance.md) の決定 1）
- **ユースケースの復帰ゲートは述語より強い。** `allRollbackReleased` **と** personal barrier の abort ack の**両方**を確認してから User を `active` へ戻す。述語 1 つを復帰の条件にしない
- **membership item の完全 ack は cleanup phase の ack を含む。** prepare ack ＋ 宣言 receipt だけでは必須受領が揃ったことにならない。これはどの 1 メソッドにも属さない横断的な契約なので、ポート定義の説明本文に書く（[ADR 052](./052-adapter-inventory-granularity.md)）

## 検討した代替案

### 述語に合わせて、復帰ゲートからも personal abort ack を落とす

記述が 1 つの述語に集まる。しかし「User は `active` に戻ったが personal scope の barrier receipt が残っていて自分のノートに書けない」という状態を設計が禁止しなくなる。rollback 経路は未配線なので、実装が別の形でそのゲートを持っている確認も取れない。実装の穴を設計へ書き写す向きになる。

### 述語のほうに personal abort ack を足す

設計文書 2 か所と JSDoc をそのまま残せる。しかし適合スイートが固定した期待値を壊し、「配り切ったか」を問う述語に自 scope の記録を混ぜることで finalize 側との役割分担が読めなくなる。

## 影響

- `personalAbort` receipt の位置づけ（述語の対象ではないが、復帰の前提ではある）が設計から読める
- 述語だけを見て「rollback が完了した」と判断する呼び出し側は誤る。述語の名前が示すのは解放を配り切ったかだけであり、復帰の条件はユースケースが持つ
- rollback / prepare 経路を application へ配線するスライスは、この 2 層の分担を実物で再検証することになる
