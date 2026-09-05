# テストケース: getNote

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 自分の個人ノート（本文あり） | 引く | 本文・見出し・公開状態が返り、`permissions` がすべて `true` になる（タグは含まれない。`listTagsForNotes` の責務） | |
| ワークスペースの viewer | そのワークスペースのノートを引く | 本文が返り、`permissions` がすべて `false` になる | |
| ワークスペースの editor | そのワークスペースのノートを引く | `canEdit` と `canDelete` が `true` になる | |
| 他人の非公開ノート | 引く | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 変換処理中のノート | 引く | `content.status: "processing"`、`html: null` が返る | |
| 「要 LLM 連携」のノート | 引く | `content.status: "awaitingIntegration"` が返る | |
| 変換に失敗したノート | 引く | `content.status: "failed"` と `failureReason` が返る | |
| ゴミ箱のノート（所有者） | 引く | 取得できる | |
| ゴミ箱のノート（所有者） | `trashedAt` を確認する | 移動した時刻が入る。`permissions` は真のままなので、詳細（P-11）と編集（P-12）が「削除済み」を判別できる材料はこれだけである | |
| ゴミ箱にないノート | `trashedAt` を確認する | `null` が返る | |
| ゴミ箱のノート（他人） | 引く | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| ワークスペースの viewer | そのワークスペースのゴミ箱のノートを引く | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（`viewTrash` は editor 以上のため、メンバーでも到達できない） | |
| ワークスペースの editor | そのワークスペースのゴミ箱のノートを引く | 取得できる（`viewTrash` を持つ） | |
| 存在しないノート ID | 引く | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 限定公開のノート（所有者） | 引く | 権限確認後に暗号化済みトークンを復号し、同じ `shareUrl` が含まれる | |
| 公開ノート（サインインしていない閲覧者） | 引く | 本文が返り、`shareUrl` は含まれない | |
| 参照を取り込んだノート | 引く | `references.imported` に `purpose: "reference"` の保管ファイルが並ぶ（`StoredFileRepository.listByNote` を絞った結果） | |
| 外部スタイルシートを埋め込んだノート | 引く | `references.inlinedStylesheets` に配布元の URL が並ぶ。供給元は本文の `data-imported-stylesheet` であり、取得記録やジョブではない | |
| 外部スタイルシートの取得に失敗したノート | 引く | `references.unavailableStylesheets` に URL が並び、記録があれば理由が添う | |
| 同上で、取得記録が消えている（または一度も試行していない） | 引く | 同じ URL が `reason: null` で並ぶ（構造は本文が語るため、理由が引けなくても表示は壊れない） | |
| 取り込みを実行したのが別のメンバーであるワークスペースのノート | 別のメンバーが引く | `references` が同じ内容で返る（ノートに帰属する情報であり、ジョブの可視性規則の影響を受けない） | |
| 取り込みを実行したメンバーが退会した | 引く | `references` は変わらず返る（`deleteJobsForRequester` はジョブを消すが、本文と取得記録には触れない） | |
| 本文から参照を削除したあと | 引く | その URL の取得記録が残っていても `references` に現れない（突き合わせの向きが本文からのため） | |
| 取り込みで CSS 宣言が落ちたノート | 引く | `references.removedCss` にプロパティごとの件数が返る | |
| 本文が `processing` / `failed` のノート | 引く | `references` の全フィールドが空になる | |
| 公開ノート | `getPublicNote` で引く | `references` は含まれない（取り込みの状態は本文をこれから直す人のための情報） | |
| 共有リンクのノート | `getSharedNote` で引く | 同じく `references` は含まれない | |
