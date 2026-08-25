# 063. 公開読みモデルのカーソルは認証しない — 運ぶのは位置だけで、可視性は毎回の述語が決める

## ステータス

承認済み

## コンテキスト

公開読みモデルの page 送りは、shard 分割を前提に「query fingerprint・shard generation・shard ごとの keyset 位置」を 1 つの不透明値へ畳んで運ぶ（[ADR 021](./021-scope-sharded-data-plane.md)）。この値を**署名し、改竄を検出する**という書き方が契約側に残っていた。

署名は 2 つのものを約束する — 値が発行元のものであること（真正性）と、その値を持っていること自体が何かの資格になること（capability）。公開検索・sitemap・公開著者一覧・Note route の二次キー走査はいずれも `visibility = 'public' AND lifecycle = 'active'` に相当する可視性の述語を**毎回の読みに掛ける**ので、cursor が決めるのはページの開始位置だけであり、内容は決めない。位置を任意に動かしても非公開行には届かない。

一方で署名を実装として持つには、鍵の供給・ローテーション・世代跨ぎの検証を決める必要がある。鍵の世代は cursor が運ぶ shard generation と独立に動くので、両者の整合を設計する仕事が増える。

## 前提

可視性の述語が cursor によらず毎回掛かること（[ADR 009](./009-read-models.md) の読み取りモデル分離）。契約の正本がポート定義で、検証が共有適合スイートであること（[ADR 026](./026-port-contract-and-conformance.md)）。契約と実装が食い違ったときに正本のある側へ倒すこと（[ADR 046](./046-port-contract-divergence.md)）。

## 決定

**公開読みモデルの cursor は不透明値であって、認証はしない。**

- cursor が運ぶのは query fingerprint と shard generation と shard ごとの keyset 位置だけとする。読めない値・条件が変わった値・引退した generation はいずれも `ValidationError("INVALID_PAGINATION")` になる。**改竄の検出はこの述語に含めない** — fingerprint は criteria から決定的に導けるので、作り直した値は正当な cursor と区別できない
- **cursor を capability として扱ってはならない。** cursor はページの開始位置だけを決め、内容は決めない。可視性の述語は到着した cursor が何であれ毎回掛ける。この規約は呼び出し側にも課される — 「cursor を持っている」を根拠に述語を省く読み経路を作らない
- 対象は公開読みモデルのカーソル（`PublicNoteQueryService` の 3 メソッドと `NoteRouteFanOutReader` の 2 メソッド）である。`UserBatchReader` などが使う**署名済み routing generation** は別物で、この決定は掛からない

## 検討した代替案

### cursor に HMAC を載せて改竄を検出する

契約語のほうを正としてこちらへ倒す案。採らない理由は 2 つある。cursor 側に守るべきものが無い（可視性の述語が毎回掛かるので、位置を飛ばしても非公開行には届かない）。そして鍵の供給とローテーションを決める必要があり、それは物理 shard 化で shard generation を cursor に載せ直す時点の判断と一体である。守るものが無い署名のために鍵管理を先に持つのは順序が逆になる。

### 「署名」という語を残したまま実装だけ不透明値にする

契約と実装が食い違ったままになる。[ADR 026](./026-port-contract-and-conformance.md) の「ポート定義だけを読んで到達できること」が成り立たず、次のバックエンド実装者は鍵を探すことになる。

## 影響

- 公開検索・sitemap・公開著者一覧・Note route fan-out の cursor は、どのバックエンドでも鍵を必要としない。バックエンドを増やすときに鍵の配布が要らない
- `ValidationError("INVALID_PAGINATION")` の意味が「読めない / 条件不一致 / 引退した generation」の 3 つに確定する。「改竄された」はこの述語から外れる
- 将来 cursor を認証するなら、それは契約を**強める**変更になる。ポート定義・共有適合スイート・全バックエンドを同時に動かすこと（[ADR 046](./046-port-contract-divergence.md)）
- **範囲外として残るもの**: workspace directory 側のカーソル（`UserWorkspaceDirectory.listActiveByUser` / `PublicWorkspaceDirectoryReader.listPublished`）は、ポートが未実装で観測が無いため本 ADR の対象に含めない。それらの記述は今も「署名 cursor」のままで、実装する時点で同じ問いを引き直すことになる
