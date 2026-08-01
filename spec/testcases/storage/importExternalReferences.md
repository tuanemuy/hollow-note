# テストケース: importExternalReferences

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 外部画像を 3 件参照する `queued` のジョブ | 実行する | `Job.start` で `running` になり、参照の件数（3）が `total` に入り、3 件が保管され、本文の参照先が差し替わって `succeeded` になる | |
| 参照を集め終えた | `Job.start` の呼び出しを確認する | `Job.start(job, total, now, leaseUntil)` の 4 引数で呼ばれ、`total` は本文から集めた参照の件数、`leaseExpiresAt` は `leaseUntil` になる（他の run 系と同じ骨格） | |
| 取り込みに成功した | 保管記録を確認する | `purpose: "reference"`、対象の `noteId`、`uploadedBy: userId` が入っている | |
| 既に `succeeded` のジョブ | 再度実行する | 何もせず終わる（run 系の共通規則） | |
| 既に `failed` のジョブ | 再度実行する | 何もせず終わる（終端状態） | |
| ジョブの行が存在しない（`deleteJobsForRequester` と配送が競合した） | 配送で受け取る | 何もせず成功として返る（判定 1・2 は先頭で行うため、`Job.start` の後ろ倒しの影響を受けない） | |
| リースが有効な `running` のジョブ | 再配送で受け取る | 何もせず終わる（他のワーカーが実行中） | |
| リースが失効した `running` のジョブ | 再配送で受け取る | 引き継いで再開し、`attempts` が加算され、`progress` が集め直した参照件数で作り直される | |
| リース失効の引き継ぎで `attempts` が上限を超える | 再配送で受け取る | 再開せず `failed("timeout")` になり、手動 `retry` の余地が残る | |
| 対象ノートが削除済み | 実行する | `Job.fail("targetMissing")` になる | |
| 参照が 0 件の本文 | 実行する | 何も取り込まず、`total: 0` で `succeeded` に終端する | |
| 取り込みに時間がかかる | 実行する | `Job.reportProgress` で進捗が更新され、リースが延長される | |
| 404 を返すリソース参照がある | 実行する | その参照は元の URL のまま残り、`failed` に `kind: "resource"` として記録される | |
| タイムアウトするリソース参照がある | 実行する | 元の URL のまま残り、記録される | |
| 内部アドレスを指す参照がある | 実行する | 取得されず、記録される | |
| ループバックアドレスを指す参照がある | 実行する | 取得されず、記録される | |
| 既にサービス内のストレージを指すリソース参照 | 実行する | 差し替えられず `skipped` に数えられる | |
| リソース参照が 201 件ある | 実行する | 200 件まで取り込まれ、以降は打ち切られる | |
| 合計 101 MB になる参照がある | 実行する | 上限に達した時点で打ち切られ、成功として返る | |
| 相対パスの参照がある | 実行する | 同時にアップロードされたファイル群から解決を試み、見つからなければ残る | |
| 本文が `ready` でない | 実行する | 参照は 0 件として扱われ、何も取り込まず `succeeded` に終端する | |
| 本文の保存が競合する | 実行する | 1 度読み直して再適用する | |
| 再適用しても競合する | 実行する | `ConflictError` が投げられる | |
| 同じジョブを 2 回実行する | 2 回実行する | 2 回目は終端状態として何もせず終わり、結果が変わらない（仮に再実行されても差し替え済みの参照は `skipped` になる） | |
| 外部スタイルシートの痕跡（`<style data-stylesheet-href="https://…/theme.css">`）を 1 件持つ本文 | 実行する | `extractExternalReferences` が `{ url, attribute: "data-stylesheet-href", elementName: "style" }` として他の外部参照と同じ形で返し、`total` に 1 件として数えられる | |
| 痕跡の CSS の取得に成功する | 実行する | `inlineStylesheets` が取得した CSS を痕跡の中身として書き戻し、**属性が `data-imported-stylesheet` に付け替わる**。`inlinedStylesheetCount` が 1 増える。`ObjectStorage.put` も `StoredFile.register` も呼ばれず、`purpose: "reference"` の保管ファイルは作られない | |
| 痕跡の CSS の取得に成功する | 本文の要素の並びを確認する | `<style>` は元の `<link>` があった位置に残る（カスケード順が `<link>` の並びに依存するため） | |
| 取り込みに成功した本文を再度保存する | `updateNoteBody` を呼ぶ | `data-imported-stylesheet` は `extractExternalReferences` の抽出対象ではないため外部参照として現れず、同じ参照取り込みジョブが登録され続けない | |
| 痕跡の CSS が 404 を返す | 実行する | `failed` に `{ url, kind: "stylesheet", reason }` として記録され、`inlineStylesheets` が痕跡の**属性を `data-stylesheet-unavailable` に付け替えて空のまま残す**。要素ごと取り除きはしない（装飾を失った事実の唯一の記録になるため）。元の URL を `<link>` として戻すこともしない | |
| 痕跡の CSS がタイムアウトする / 内部アドレスを指す | 実行する | 同じく `kind: "stylesheet"` として記録され、痕跡が `data-stylesheet-unavailable` になる（その装飾は失われる） | |
| 痕跡の CSS の取得に失敗した本文を再度保存する | `updateNoteBody` を呼ぶ | `data-stylesheet-unavailable` は抽出対象ではないため外部参照として現れず、同じ参照取り込みジョブが登録され続けない | |
| 取得した CSS が `position: fixed` / `position: sticky` を含む | 実行する | 手順 7 の `HtmlProcessor.process` がその宣言だけを落とし、残りの宣言はインライン化されたまま本文に入る。落ちた宣言は `removed`（`kind: "css"`）に現れ、**プロパティ名ごとに件数へ畳んで `ReferenceImportSummary.removedCss` に書かれる**（ジョブの `detail` には書かない。`detail` は運用者向けであり、成功したジョブは `failure` を持たない） | |
| 取得した CSS が `@import url(...)` を含む | 実行する | その規則だけが除去され、`@import` 先は取得も保管もされない。残りの規則は本文に入り、成功として扱われる | |
| 1 件の違反を含む CSS を取り込む | 本文の装飾を確認する | 違反した宣言・規則だけが落ち、そのスタイルシート全体も本文全体の装飾も捨てられない | |
| 取得した CSS が `url(./bg.png)` のような相対 URL を含む | 実行する | 取得元のスタイルシートの URL（`finalUrl` を含む取得元）を基準に絶対 URL へ解決してから書き戻される（インライン化で相対 URL の基準が本文の文書へ移るため） | |
| 取得した CSS が背景画像・フォントを `url()` で参照する | 実行する | 絶対 URL に解決されるだけで取得も保管も差し替えもされず、外部 URL のまま残る（`ExternalReference` が属性ベースで宣言値の中を指せないため）。件数・合計サイズの予算にも数えない | |
| 外部スタイルシートを持つ本文（変換時点で `styleMode: "preserve"`） | 取り込みに成功する | `styleMode` は `preserve` のまま変わらない（`Note.updateBody` は `content` だけを更新し、手順 7 の `hasDecoration` は使わない） | |
| 外部スタイルシートを持つ本文で、スタイルシートの取得にすべて失敗する | 実行する | 装飾が何も残らなくても `styleMode` は `preserve` のままで、既定スタイルは自動で当て直されない（利用者が `changeStyleMode` で `default` にできる） | |
| 利用者が `changeStyleMode` で `default` にしたノート | 取り込みに成功する | `default` のまま押し戻されない | |
| 既にサービス内のストレージを指す URL の痕跡 | 実行する | `skipped` にはせず取得へ進む（飛ばしても本文に空の `<style>` が残るだけで装飾にならないため） | |
| 外部画像 2 件と外部スタイルシート 1 件を持つ本文 | 実行する | `total` が 3 になり、画像は保管して `rewriteReferences` で差し替え、スタイルシートは `inlineStylesheets` でインライン化される。`importedCount: 2`, `inlinedStylesheetCount: 1` になる | |
| 予算（`maxCount` / `maxTotalBytes`）を使い切ったあとに痕跡が残っている | 実行する | その痕跡は取得に至らないまま `data-stylesheet-unavailable` になり、成功として返る（取得に失敗した場合と同じ扱い。抽出対象から外れるので決着しない参照が残らない） | |
| 取り込みを実行した | 取得記録を確認する | 扱った参照 1 件につき `ReferenceAttempt` が 1 件書かれる。成功したリソースは `imported`（`fileId` つき）、成功したスタイルシートは `inlined`、失敗は `failed`（`reason` つき）、予算超過で試行しなかったものは `notAttempted` | |
| 取り込みを実行した | 保存の単位を確認する | 本文の保存・取得記録の書き込み・`Job.succeed` が同一の `UnitOfWorkProvider.run` で確定する | |
| 前回の実行で `failed` を記録した URL が、今回の実行の対象に含まれない | 実行する | その行は消えない（`saveAttempts` は今回扱った `(noteId, url)` だけを上書きする。前回の理由が失われてはならない） | |
| 取り込みを実行した | `Job.succeed` の引数を確認する | `notices` は空配列で渡される（取り込みの結果は `notices` に載せない。[ADR 014](../../adr/014-import-result-provenance.md)） | |
| `skipped` の判定を確認する | 実行する | 手順 3 で `StorageUrlPolicy.isInternal` が真の参照は対象から外れる。`extractExternalReferences` はサービス内の URL も返すため、この絞り込みは呼び出し側が行う | |
