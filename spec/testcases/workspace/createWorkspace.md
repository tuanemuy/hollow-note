# テストケース: createWorkspace

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| ワークスペースを 0 件所有 | 名前とスラッグを指定して作成する | 非公開のワークスペースが作られ、作成者が owner の `Membership` を持つ | |
| — | スラッグを省略して作成する | 作成が成功し、`slug: null` になる | |
| 既に使われているスラッグ | 作成する | `ConflictError("SLUG_ALREADY_USED")` が投げられる | |
| — | 予約語（`new`）をスラッグに指定する | `BusinessRuleError(SlugReserved)` が投げられる | |
| — | 2 文字のスラッグを指定する | `BusinessRuleError(InvalidSlug)` が投げられる | |
| — | 名前を空文字列にして作成する | `BusinessRuleError(InvalidName)` が投げられる | |
| — | 81 文字の名前で作成する | `BusinessRuleError(InvalidName)` が投げられる | |
| ワークスペースを 19 件所有 | 作成する | 成功する（上限の境界値） | |
| ワークスペースを 20 件所有 | 作成する | `BusinessRuleError(WorkspaceQuotaExceeded)` が投げられる | |
| 作成直後 | 公開状態を確認する | `publication: "private"` になっている | |
| 同じスラッグで 2 つの要求が同時に走る | 両方が作成する | 片方は成功、もう片方は `ConflictError("SLUG_ALREADY_USED")` になる | |
