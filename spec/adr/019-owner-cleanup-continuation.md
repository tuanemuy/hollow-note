# 019. 後始末の継続は購読者 1 件の専用イベントで運ぶ

## ステータス

承認済み

## コンテキスト

[クロスフェーズ検証 004](../review/cross-phase/004.md) の H-04。`deleteNotesForOwner`（[usecases/note.md](../usecases/note.md)）は 1 バッチごとに、**受け取ったのと同じ** `identity.user.deleted` / `workspace.deleted` を outbox へ再投入して継続する。`deleteFilesByOwner`（[usecases/storage.md](../usecases/storage.md)）も消し切れなかった場合に同じイベントを再登録する。

`identity.user.deleted` は購読者を 8 つ、`workspace.deleted` は 4 つ持つ。両者に残作業がある間は、購読者すべてに配られるイベントのコピーが増え続ける。購読者はすべて冪等で、残作業が 0 になった系列から再投入をやめるため**正確性と停止性は保たれる**が、outbox とキューを水増しする。

[ADR 018](./018-query-budget.md) で 1 回の実行あたりの処理件数に上限を課したため、継続を要する経路はむしろ増える。継続の媒体をここで決める必要がある。

## 決定

**継続は、購読者を 1 つだけ持つ専用のイベントで運ぶ。** 受け取ったイベントの再投入はやめる。

- 新設するのは 2 つ。どちらも**アプリケーション内部の継続要求**であって、ドメインで何かが起きたことを表すドメインイベントではない
  - `note.ownerPurgeContinued { ownerType, ownerId }` — 購読者は `deleteNotesForOwner` のみ
  - `storage.ownerDeleteContinued { ownerType, ownerId }` — 購読者は `deleteFilesByOwner` のみ
- 初回の起動は従来どおり `identity.user.deleted` / `workspace.deleted` の購読で行う。1 バッチを処理して残りがあれば、そのバッチの最後の書き込みと**同じ Unit of Work で**継続要求を outbox に積む。2 回目以降は継続要求だけが回る
- **カーソルは持たない**。対象は処理するそばから消えるため、「残っているものを先頭から `batchSize` 件読む」だけで必ず前に進む。カーソルを持たせると、重複配送で 2 系列が並走したときに片方が飛ばした範囲を誰も拾わない形が作れてしまう
- **進捗がなければ継続しない。** 1 バッチで 1 件も消せなかった場合（対象が残っているのに全件が失敗した場合）は継続要求を積まず、メッセージを失敗させる。キューの再試行と、それを使い切ったあとの DLQ に載せる。これがないと、恒久的に失敗する 1 件が列の先頭に居座って継続が無限に回る
- 同じ形を、[ADR 018](./018-query-budget.md) が上限を課した他の継続にも使う
  - `projection.reprojectRequested { noteId }` — 購読者は `projectNoteChanges` のみ（[ADR 016](./016-projection-single-writer.md)）
  - `projection.tagFanOutContinued { tagId, afterNoteId }` — 購読者は `projectNoteChanges` のみ。タグのリネーム / 統合が影響するノートの列挙を分割する。**こちらだけはカーソルを持つ**（対象のノートは消えないため、位置を覚えないと同じページを読み続ける）
  - `job.terminationContinued { scopeType, scopeId, cause }` — 購読者は強制終端の後始末のみ

継続要求は種別で見分けられる名前を持ち、**ドメインイベントの一覧とは別に列挙する**（[domains/index.md](../domains/index.md)）。イベントの語彙に混ぜると「何が起きたか」と「まだ仕事が残っている」が同じ表に並ぶ。

## 検討した代替案

### Queues の遅延配送（`delaySeconds`）で継続する

コンシューマーから同じキューへ `delaySeconds` 付きで自分宛のメッセージを送る案。Queues は送信時・再試行時とも最大 24 時間の遅延をサポートするため、実現手段としては成立する。

不採用の理由は**耐久性の境界**である。D1 のトランザクションをコミットしたあとにキューへ送る形になるため、送信が失敗すると継続が失われ、対象が中途半端に残ったまま誰も気づかない。outbox に積めば、送信は既存のリレーが少なくとも 1 回を保証する。継続は「消し残しを残さない」ための仕組みなので、継続そのものの配送が保証されないのでは意味が薄い。

### 後始末をジョブにする

`JobKind` に後始末用の種別を足し、既存の再試行・進捗の仕組みに載せる案。しかしジョブは実行者本人にのみ見える第一級の閲覧対象であり（[usecases/job.md](../usecases/job.md)）、退会した本人には見えない。処理履歴に出す意味がなく、`deleteJobsForRequester` が退会時にジョブを全削除するのとも噛み合わない。[usecases/note.md](../usecases/note.md) に既に記録済みの判断を維持する。

### カーソルを持つ定期ワーカーで掃除する

継続イベントを持たず、cron で「所有者が消えたのに残っているノート／ファイル」を探して消す案。イベントの水増しは完全に消える。しかし「消えた所有者」を引くには全走査か、削除予定の所有者を記録する表が要る。表を足すなら継続要求を outbox に積むのと機構の数は変わらず、削除の完了が次の cron まで遅れるぶんだけ悪い。不採用。

### 購読者 1 件の専用イベントではなく、既存イベントに「継続かどうか」の印を付ける

`identity.user.deleted { continuation: true }` のような形。新しい種別を増やさずに済むが、**購読者の数は減らない** — 8 つの購読者すべてに配られ、7 つが印を見て何もせずに返る。水増しは残る。不採用。

## 影響

- `identity.user.deleted` / `workspace.deleted` は初回に 1 回だけ配られる。購読者 8 / 4 という数は初回のみになり、継続の系列は購読者 1 件のイベントで進む
- `deleteNotesForOwner` と `deleteFilesByOwner` の継続の形が揃う。両者の違い（片方は常用の継続経路、もう片方は保険）が消え、[usecases/note.md](../usecases/note.md) にあった「継続の仕方は `deleteFilesByOwner` とは異なる」という注記は不要になる
- H-04 が「既知の課題」として記録していた outbox とキューの水増しが解消する
- 恒久的に失敗する 1 件があると、継続が止まって DLQ に載る。無限ループでも黙殺でもなく、運用者が気づける形になる
- 継続要求は `events` キュー（投影のものは `events-projection` キュー）へ流れる。ドメインイベントと同じ配送経路を使い、専用の仕組みを持たない
