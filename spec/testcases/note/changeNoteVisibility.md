# テストケース: changeNoteVisibility

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 本文のある非公開ノート | 限定公開に変更する | 共有リンクが発行され、`shareUrl` が返る | |
| ハンドル設定済みで本文のあるノート | 公開に変更する | `visibility: "public"` になり、`note.published` が発行される | |
| ハンドル未設定の個人ノート | 公開に変更する | `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられる | |
| スラッグ未設定のワークスペースのノート | 公開に変更する | `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられる | |
| 変換処理中のノート | 公開に変更する | `BusinessRuleError(CannotPublishEmptyNote)` が投げられる | |
| 「要 LLM 連携」のノート | 限定公開に変更する | `BusinessRuleError(CannotPublishEmptyNote)` が投げられる | |
| 限定公開のノート | 非公開に戻す | 共有リンクが無効になり、休眠として保持される | |
| 非公開に戻した後 | 再度限定公開にする | 同じ共有リンクが復活する | |
| パスワード保護された限定公開ノート | 公開に変更する | パスワードが解除される | |
| 公開ノート | 限定公開に変更する | 共有リンクが有効になり、公開タイムラインから消える | |
| viewer である | 変更する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| ワークスペースが非公開 | そのノートを公開に変更する | ノートは公開になる（ワークスペースの公開状態と独立） | |
| 他者が先に更新した | 古い `expectedVersion` で変更する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
