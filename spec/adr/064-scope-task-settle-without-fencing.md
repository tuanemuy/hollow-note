# 064. scope task の settle は fencing token を持たず、単一 writer と `leaseMs` の帯で守る

## ステータス

承認済み

## コンテキスト

`ScopeTaskScheduler.claimDue` はリースを取るが、`complete` / `backoff` / `schedule` は行キー `(kind, operationId)` だけで撃たれ、claim を同定するトークンを要求しない。したがってリースを超過した旧 writer の settle が、その間に別 writer が再 claim して武装し直した行を消しうる。実害は継続の鎖の停止に留まらない — personal cleanup の継続が止まれば `accountDeletionBarrier` が開いたまま User が `deleting` で残る。

「claim token を契約へ足す」が素直な対処に見えるが、この形は継続要求の運搬路（[ADR 040](./040-continuation-transport.md)）と噛み合わない。`complete` を呼ぶのは runner ではなくユースケース本体で、それらは claim した task を手元に持たず、継続要求の payload から鍵を復元して settle する。しかもその payload は「応答喪失後に同じ鍵で再駆動される」ことを前提にしているので、再駆動された turn が持つ token は必ず陳腐化する。

## 前提

scope の実体が 1 scope = 1 Durable Object であり、単一スレッドで Alarm の多重起動が無いこと（[ADR 021](./021-scope-sharded-data-plane.md)）。Global Cron が scope object を全列挙しないこと（同）。継続要求が payload から鍵を復元して再駆動されること（[ADR 040](./040-continuation-transport.md)）。契約の正本がポート定義で、検証が共有適合スイートであること（[ADR 026](./026-port-contract-and-conformance.md)）。

## 決定

**settle に fencing token を足さない。** 守るのは「1 scope に対する同時 writer は 1 本」という配備の性質と、リース期間の帯である。

- **単一 writer が何に支えられているかは driver で異なる。** object の Alarm が driver の配備では scope ごとに writer が分かれるので、worker プロセスの多重度は引き金にならない。中央 runner が driver の配備では、runner が scope を選ぶ材料が全 scope 共有の due index なので、**runner の起動が重ならないことが単一 writer 前提そのもの**になる。どちらが driver かは scope task ハンドラのレジストリが決める。規則の正典は [platform/index.md](../platform/index.md)「Scope Alarm」
- **`leaseMs` の帯は配備が選ぶ。** 下限は 1 turn の最悪所要時間、上限は oldest-task-age SLO。したがって帯から値を選ぶ経路が**どちらの driver にも**無ければならない — 中央 runner は `SCOPE_TASK_LEASE_MS` 環境変数、scope object は同名の binding 変数。object は DI コンテナから設定を受け取れず、構成が届く経路がそこしかない。不正値は黙って既定へ戻さず turn を落とす（帯の外で turn が走っていることを誰も知らないまま進むため）
- **再訪の引き金は「1 scope に複数 writer」であって「複数 worker プロセス」ではない。** 中央 runner を scope の Alarm と併走させる配備、あるいは runner を同時 2 起動する配備を実際に組む前に、settle の fencing を設計し直すこと
- ポート JSDoc・共有適合スイート・`spec/domains/` は変更しない。ポート JSDoc は既に「リースは助言的」「`leaseMs` は配備が選ぶ値」と書いており、本 ADR はそれを決着として確定させる

## 検討した代替案

### claim token を契約へ足す

`claimDue` が返す `ScopeTask` に token を持たせ、`complete` / `backoff` / `schedule` が token 一致を条件にする。競合を型と述語で潰せるので最も強い。採らないのは二律背反があるためである — 再駆動された turn の token は必ず陳腐化するので、token 不一致を「無視して settle」にするなら fencing にならず、「拒否」にするなら [ADR 040](./040-continuation-transport.md) の回復経路を塞ぐ。fencing を入れるなら token だけでなく「継続要求の再駆動が token をどう取り直すか」まで設計する必要があり、それは継続の運搬路の再設計である。

波及範囲も広い。token を通すには継続要求の payload とユースケース入力の双方に token が要り、`spec/domains/` の継続要求の定義・共有適合スイート・全バックエンド・全 runner が同時に動く。

### maintenance run と同じく lease を fencing にする

global maintenance run の lane は複数 writer を前提に設計され、checkpoint と ack を lease に対する条件付き更新として適用する（[platform/index.md](../platform/index.md)「Global Cron」）。同じ形を scope task にも敷ける。採らないのは、あちらの writer 多重度が配備の選択ではなく Cron の再入と lease recovery から**構造的に生じる**のに対し、scope task の writer 多重度は配備が選べるものだからである。選べるものを選ばないほうが安い。

## 影響

- 安全性が型ではなく配備の選択（driver をどちらか一方に倒すこと、`leaseMs` を帯から選ぶこと、runner を同時 1 起動に保つこと）に依存する。配備スライスはこれを要件として引き受ける
- 中央 runner と object の Alarm を併走させる判断が出た時点で、本 ADR の再訪が必須の作業として残る
- ポート契約・共有適合スイート・application 層は動かないので、バックエンドを増やしてもこの決定に追随作業は生じない
