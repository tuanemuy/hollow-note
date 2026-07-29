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
| Storage | Identity, Workspace, Note | `UserId`, `WorkspaceId`, `NoteId` |
| Conversion | Storage | `StoredFileId`, `FileName`, `MimeType`, `ByteSize` |
| Note | Identity, Workspace, Storage, Conversion | `UserId`, `WorkspaceId`, `WorkspaceRole`, `TokenHash`, `PasswordHash`, `StoredFileId`, `ConversionFailureReason` |
| Tag | Identity, Workspace, Note | `UserId`, `WorkspaceId`, `NoteId`, `NoteOwner` |
| Integration | Identity, Storage, Note | `UserId`, `StoredFileId`, `Checksum`, `FileName`, `MimeType`, `ByteSize`, `NoteId` |
| Job | Identity, Workspace, Storage, Note | `UserId`, `WorkspaceId`, `StoredFileId`, `NoteId` |
| Usage | Identity, Workspace, Storage, Note | `UserId`, `WorkspaceId`, `StorageOwner`, `NoteOwner` |

依存の深さ順に並べると `Identity → Workspace → Storage → Conversion → Note → {Tag, Integration, Job, Usage}` となる。この並びで唯一の逆向きが Storage → Note で、`Note.sourceFileId`（`StoredFileId`）と `StoredFile.noteId`（`NoteId`）は ID による相互参照を持つ。どちらも相手の ID 値オブジェクトを参照するだけで相手の集約を読まず、外部キーも張らない（[database/index.md](../database/index.md) のドメイン跨ぎの参照）。所属ファイルの回収は `note.purged` を購読する `deleteFilesForNote` が行い、参照先が消えた `sourceFileId` は「対象が存在しない」として扱う。後始末がイベント駆動で完結し、片方が欠けても他方の不変条件が壊れないため、集約の独立性は保たれる。Note は Tag を知らない。Conversion は Integration を知らず、LLM の呼び出しは Conversion が定義した `StructuringModel` / `TranscriptionModel` ポートを Integration 側のアダプターが満たす形で解決する。

Note は Job も知らない。Job → Note の依存が既にあるため、Note から Job を参照すると循環する。`JobId` を含む PDF エクスポートのチケット（`ExportTicket`）は Note の不変条件に関与しないので、ドメインではなくアプリケーション層の型として定義してこの向きを保つ（[usecases/note.md](../usecases/note.md) の「共通: ExportTicket」、[ADR 010](../adr/010-anonymous-export-and-ticket.md)）。実行中ジョブの有無の判定も同様に Job 側のクエリ（`JobRepository.listActiveByTarget`）をユースケースが呼ぶ形で行い、Note は関知しない。

## 共通の型と規約

`packages/core/src/domain/common/` の既存プリミティブに従う。

- **ID 値オブジェクト**: `unique symbol` による公称型。`create(id: string)` のみが生成経路。空文字列は `BusinessRuleError` を投げる。`generate()` は持たず、生成は `IdGenerator` ポート
- **エンティティの状態**: 排他的な状態は判別可能なユニオンで表す。boolean フラグの併置はしない
- **状態遷移**: `WithEventDrafts<TEntity, TEvent>` を返す。`EventId` は Unit of Work が採番する
- **リポジトリ**: `TransactionalRepository<TEntity, TId>` を継承し、`TId` は分岐 ID にバインドする。読み取り専用のクエリは各ポートに個別に定義する
- **`Versioned<T>` の使い分け**: 更新前提の取得は `findById` 経由で `Versioned<T>` を受け取り、`save` が版トークンを消費する。読み取り専用の経路は素の型を返す
- **ドメインサービス**: ドメインが定義したポートへの依存を宣言できる（`CredentialResolver` / `ConversionExecutor` など）。依存はポート越しに限り、フェイクの注入で決定的にテストできること。ポートを使わないサービスは依存を宣言しない
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
| イベントの重複排除 | `application/ports/idempotencyStore.ts`（新規。再適用が非可換な購読者が使う） |
| HTML のサニタイズ | Note ドメインのドメインサービス（[ADR 006](../adr/006-html-content-model.md)） |
| パスワードのハッシュ化 | Identity ドメインのポート |
| 資格情報の暗号化 | Integration ドメインのポート |
| 全文検索 | Note ドメインのクエリポート（検索インデックスの更新はイベント駆動） |
| メール送信 | `application/ports/mailSender.ts`（新規。Identity と Workspace の両方が使う） |
| 認可フロー状態（OAuth の `state` / `codeVerifier`） | `application/ports/oauthStateStore.ts`（新規。Identity と Integration の両方が使う） |
| 画像の公開 URL | エンティティは `StoredFileId` ではなく公開 URL の文字列を保持する。Identity / Workspace が Storage に依存しないための取り決め |

### 新設する横断的ポート

以下の 4 件（`MailSender` / `TimeZoneResolver` / `OAuthStateStore` / `IdempotencyStore`）はアプリケーション層に置き、どのドメインのポート一覧にも現れない。ポートの総数を数えるときは各ドメインの一覧とこの 4 件の和を取る。複数のドメインが使うもの（`MailSender` は Identity と Workspace、`OAuthStateStore` は Identity と Integration）も 1 件として数え、使う側のドメインごとに二重計上しない。

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

#### OAuthStateStore（`application/ports/oauthStateStore.ts`）

認可フローの `state` と `codeVerifier` を、コールバックが返るまで短期間保持する。サインイン（Identity の `startOAuthFlow` / `completeOAuthSignIn` / `linkOAuthIdentity`）と外部連携（Integration の `startIntegrationOAuth` / `completeIntegrationOAuth`）が同じ表を共有するため、どちらのドメインにも置かずアプリケーション層に置く。

```ts
interface OAuthStateStore {
  put(state: string, value: OAuthFlowState, ttlMs: number): Promise<void>;
  take(state: string): Promise<OAuthFlowState | null>;   // 取得と同時に削除する
  deleteExpired(now: Date): Promise<number>;             // コールバックが返らなかった分の回収
}

type OAuthFlowState = Readonly<{
  provider: string;           // OAuthProvider（サインイン）または ProviderKind（連携）
  codeVerifier: string;
  redirectTo: string | null;
  intent: "signIn" | "linkIdentity" | "integration";
  userId: UserId | null;      // intent が "linkIdentity" / "integration" のとき必須
}>;
```

`provider` を原始型のままにしているのは、Identity と Integration が別々の列挙を持つため。値の解釈は取り出した側が自分の値オブジェクトで再構築する。期限切れの回収は 1 か所に寄せ、Identity の [`pruneExpiredAuthState`](../usecases/identity.md) が両方の `intent` をまとめて掃除する（Integration 側に同種の定期掃除は置かない）。

**エラーケース**: `SystemError(DatabaseError)`

#### IdempotencyStore（`application/ports/idempotencyStore.ts`）

イベントの配送は at-least-once のため、重複配送を自力で吸収できないコンシューマーはイベント ID で重複を排除する。

```ts
interface IdempotencyStore {
  markProcessed(consumer: string, eventId: EventId): Promise<boolean>;   // 既に処理済みなら false
}
```

使うかどうかは購読側の処理の性質で決める。

- **必須**: 集計・加減算など、同じイベントの再適用が非可換な処理を行う購読者（`applyStorageDelta`）。処理の冒頭で `markProcessed` を呼び、`false` なら何もせず成功として完了する。記録と本処理は同一の Unit of Work で行い、片方だけが確定した状態を作らない
- **使わない**: 上書き・削除など本質的に冪等な処理を行う購読者（現在の状態を読み直して上書きする `projectNoteChanges`、鍵を指定して消す `deleteStoredObjects`、対象が消えていれば 0 件で終わる `deleteFilesForNote` など）。使わない購読者は、何が冪等性の根拠かを各ユースケースに明記する

この分類はイベント購読者にだけ適用する。`rebuildNoteProjection` のような運用操作はイベントを受け取らず、重複配送の対象でもないため、いずれの側にも属さない。

`deleteStoredObjects` のように外部リソースへの書き込みを含む購読者では、記録を持たないほうが安全側に倒れる（処理済みを先に記録すると、失敗したイベントが再配送で弾かれて実体が回収されない）。判断の根拠は [usecases/storage.md](../usecases/storage.md) の当該ユースケースを参照。

**エラーケース**: `SystemError(DatabaseError)`

## ユースケースの分布

| ドメイン | ユースケース数 |
| --- | --- |
| Identity | 21 |
| Workspace | 21 |
| Note | 36 |
| Tag | 12 |
| Storage | 13 |
| Conversion | 4 |
| Integration | 15 |
| Job | 10 |
| Usage | 7 |
| 合計 | 139 |

詳細は `spec/usecases/${domain}.md` に定義する。
