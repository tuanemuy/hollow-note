# テストケース: mergeTags

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| タグ A（3 件）とタグ B（2 件）が同じスコープにある | A を B に統合する | operation IDとpendingが返り、Alarm完了後にBの使用件数が5、Aが削除済みになる | |
| 同じノートに A と B の両方が付いている | 統合する | 重複せず 1 件の付与になる | |
| 同じタグ同士を指定する | 統合する | `BusinessRuleError(CannotMergeIntoItself)` が投げられる | |
| 異なるスコープのタグを指定する | 統合する | `BusinessRuleError(ScopeMismatch)` が投げられる | |
| 存在しないタグ ID を指定する | 統合する | `NotFoundError("TAG_NOT_FOUND")` が投げられる | |
| ワークスペースの viewer | 統合する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 10,000件のsource付与 | 統合する | `reassignBatch`を最大200件ずつ処理し、各pageでrevision bumpと完全snapshot再投影taskを原子的に保存する | |
| 統合後 | 読み取りモデルを確認する | pageごとの個別再投影により、tag列とFTSが完全snapshotで更新される | |
| 統合後 | 統合元のタグ名で確認する | 統合元の名前が 3 列と FTS 索引のすべてから消え、統合先の名前だけが残る（同じノートに両方が付いていた場合も重複しない） | |
| 使用件数 0 のタグを統合する | 統合する | workerの最初のturnで完了し、完了照会で`affectedNotes: 0`になる | |
| source/targetの両方が同じNoteに付いている | page処理する | source行だけ削除し、targetを重複させず、そのNoteのrevisionを1回進める | |
| page間にsource/targetを変更しようとする | 実行する | 両tagのoperation lockで拒否される | |
