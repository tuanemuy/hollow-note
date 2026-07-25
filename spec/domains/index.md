# ドメイン一覧

境界の切り方と依存方向は [ADR 008](../adr/008-domain-boundaries.md) に従う。

## ドメイン

| ドメイン | 責務（一文） | ファイル |
| --- | --- | --- |
| Identity | 利用者を識別し、認証手段とセッションの正当性を保つ | [identity.md](./identity.md) |
| Workspace | 共同作業の場と、そこでの権限を管理する | [workspace.md](./workspace.md) |
| Note | ノートの本文・所属・公開範囲とその変遷を保つ | [note.md](./note.md) |
| Tag | ノートを分類する語彙を管理し、ノートへの付与を保つ | [tag.md](./tag.md) |
| Storage | バイト列を預かり、保管先と参照可能性を保証する | [storage.md](./storage.md) |
| Conversion | ファイルの形式を判定し、HTML 断片へ変換する | [conversion.md](./conversion.md) |
| Integration | 外部サービスとの連携状態と資格情報を保つ | [integration.md](./integration.md) |
| Job | 非同期処理の状態・進捗・再試行・キャンセルを管理する | [job.md](./job.md) |
| Usage | 保存容量と LLM 実行回数の消費と上限を管理する | [usage.md](./usage.md) |

## 依存方向

矢印は「参照する側 → 参照される側」。参照はすべて ID による。

| ドメイン | 依存先 | 参照している主な型 |
| --- | --- | --- |
| Identity | （なし） | — |
| Workspace | Identity | `UserId`, `Email`, `TokenHash` |
| Storage | Identity, Workspace | `UserId`, `WorkspaceId` |
| Conversion | Storage | `StoredFileId`, `FileName`, `MimeType`, `ByteSize` |
| Note | Identity, Workspace, Storage, Conversion | `UserId`, `WorkspaceId`, `WorkspaceRole`, `TokenHash`, `PasswordHash`, `StoredFileId`, `ConversionFailureReason` |
| Tag | Identity, Workspace, Note | `UserId`, `WorkspaceId`, `NoteId`, `NoteOwner` |
| Integration | Identity, Storage, Note | `UserId`, `StoredFileId`, `Checksum`, `FileName`, `MimeType`, `ByteSize`, `NoteId` |
| Job | Identity, Workspace, Storage, Note | `UserId`, `WorkspaceId`, `StoredFileId`, `NoteId` |
| Usage | Identity, Workspace, Storage, Note | `UserId`, `WorkspaceId`, `StorageOwner`, `NoteOwner` |

依存の深さ順に並べると `Identity → Workspace → Storage → Conversion → Note → {Tag, Integration, Job, Usage}` となり、循環はない。Note は Tag を知らない。Conversion は Integration を知らず、LLM の呼び出しは Conversion が定義した `StructuringModel` / `TranscriptionModel` ポートを Integration 側のアダプターが満たす形で解決する。

## 共通の型と規約

`packages/core/src/domain/common/` の既存プリミティブに従う。

- **ID 値オブジェクト**: `unique symbol` による公称型。`create(id: string)` のみが生成経路。空文字列は `BusinessRuleError` を投げる。`generate()` は持たず、生成は `IdGenerator` ポート
- **エンティティの状態**: 排他的な状態は判別可能なユニオンで表す。boolean フラグの併置はしない
- **状態遷移**: `WithEventDrafts<TEntity, TEvent>` を返す。`EventId` は Unit of Work が採番する
- **リポジトリ**: `TransactionalRepository<TEntity, TId>` を継承し、`TId` は分岐 ID にバインドする。読み取り専用のクエリは各ポートに個別に定義する
- **時刻**: ドメインは `now: Date` を引数で受け取る。`new Date()` は呼ばない
- **エラー**: 不変条件違反は `BusinessRuleError<${Domain}ErrorCode>`

## 横断的な関心事

| 関心事 | 置き場所 |
| --- | --- |
| 時刻 | `application/ports/clock.ts`（既存） |
| ID 採番 | `application/ports/idGenerator.ts`（既存） |
| ログ | `application/ports/logger.ts`（既存） |
| トランザクション | `application/execution/unitOfWork.ts`（既存） |
| アウトボックス | `application/ports/outboxRepository.ts`（既存） |
| HTML のサニタイズ | Note ドメインのドメインサービス（[ADR 006](../adr/006-html-content-model.md)） |
| パスワードのハッシュ化 | Identity ドメインのポート |
| 資格情報の暗号化 | Integration ドメインのポート |
| 全文検索 | Note ドメインのクエリポート（検索インデックスの更新はイベント駆動） |
| メール送信 | `application/ports/mailSender.ts`（新規。Identity と Workspace の両方が使う） |
| 画像の公開 URL | エンティティは `StoredFileId` ではなく公開 URL の文字列を保持する。Identity / Workspace が Storage に依存しないための取り決め |

### 新設する横断的ポート

#### MailSender（`application/ports/mailSender.ts`）

```ts
interface MailSender {
  send(message: MailMessage): Promise<void>;
}

type MailMessage = Readonly<{
  to: string;
  template: MailTemplate;
  locale: "ja";
}>;

type MailTemplate =
  | { kind: "emailVerification"; verifyUrl: string; expiresAt: Date }
  | { kind: "passwordReset"; resetUrl: string; expiresAt: Date }
  | { kind: "passwordResetUnavailable"; signInUrl: string }      // パスワード認証手段を持たない相手への案内
  | { kind: "existingAccountNotice"; signInUrl: string }         // 登録済みアドレスへのサインアップ試行
  | { kind: "workspaceInvitation"; workspaceName: string; role: string; inviterName: string; acceptUrl: string; expiresAt: Date };
```

**エラーケース**: `SystemError(ExternalServiceError)`（送信基盤の失敗）。送信の失敗は呼び出し元の操作を失敗させない（記録して継続する）。

#### TimeZoneResolver（`application/ports/timeZoneResolver.ts`）

月やカレンダーの境界を利用者のタイムゾーンで判定するために使う（OR-05 / OR-02）。

```ts
interface TimeZoneResolver {
  monthRange(month: YearMonth, timeZone: string): DateRange;
  monthOf(instant: Date, timeZone: string): YearMonth;
  dayKey(instant: Date, timeZone: string): string;              // "YYYY-MM-DD"
}
```

タイムゾーンは要求ごとにクライアントから受け取り、不正な値は `"UTC"` に落とす。

**エラーケース**: なし（不正な入力は既定値に落とす）

## ユースケースの分布

| ドメイン | ユースケース数 |
| --- | --- |
| Identity | 20 |
| Workspace | 20 |
| Note | 32 |
| Tag | 10 |
| Storage | 11 |
| Conversion | 4 |
| Integration | 12 |
| Job | 7 |
| Usage | 7 |
| 合計 | 123 |

詳細は `spec/usecases/${domain}.md` に定義する。
