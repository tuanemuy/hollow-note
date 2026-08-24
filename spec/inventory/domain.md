# Inventory — domain

生成元: `spec/domains/`（最終同期: 2026-08-24）

**1 行 = 1 ドメイン要素**（値オブジェクト・エンティティ・ドメインサービス・ポートメソッド）。**新規要素には各群の末尾に採番し、出現順の位置に挿入しない（ID は行位置ではない）**（[ADR 052](../adr/052-adapter-inventory-granularity.md)）。同じポートメソッドの DOM 行と `adapter.md` の ADP 行が食い違う場合、そろえるのは片側の主張が本文に由来するときだけとする（[ADR 059](../adr/059-ledger-row-asymmetry.md)）。

| ID | 要素 | 定義場所 | 実装されるべき振る舞いの要点 |
| --- | --- | --- | --- |
| DOM-common-001 | `ScopeKey` 値オブジェクト | `spec/domains/index.md#ScopeKey-と永続化境界` | user または workspace の所有文脈を判別可能 union で表す |
| DOM-common-002 | `ScopeRouter.forScope` | `spec/domains/index.md#ScopeKey-と永続化境界` | ScopeKey に対応する scope handle を返す |
| DOM-common-003 | `ScopeRouter.resolveNote` | `spec/domains/index.md#ScopeKey-と永続化境界` | NoteId の現在 scope と route version を解決する |
| DOM-common-004 | `ScopeUnitOfWorkProvider.run` | `spec/domains/index.md#ScopeKey-と永続化境界` | 指定 scope の単一 UoW でコールバックを実行する |
| DOM-common-005 | `ScopeCleanupAdmissionStore.assertWritable` | `spec/domains/index.md#ScopeKey-と永続化境界` | current scope の通常書き込み可否を検査する |
| DOM-common-006 | `ScopeCleanupAdmissionStore.assertActorWritable` | `spec/domains/index.md#ScopeKey-と永続化境界` | actor の削除・除名準備ロックを含め書き込み可否を検査する |
| DOM-common-007 | `ScopeCleanupAdmissionStore.beginPersonalAccountDeletion` | `spec/domains/index.md#ScopeKey-と永続化境界` | 個人 scope の削除 barrier を operation 単位で開始する |
| DOM-common-008 | `ScopeCleanupAdmissionStore.abortPersonalAccountDeletion` | `spec/domains/index.md#ScopeKey-と永続化境界` | 同じ owner operation の個人削除 barrier を解除する |
| DOM-common-009 | `ScopeCleanupAdmissionStore.assertOwner` | `spec/domains/index.md#ScopeKey-と永続化境界` | cleanup operation の所有権を検査し、別 ID・欠落・未 commit に加えて完了済みの barrier も拒否する |
| DOM-common-010 | `ScopeCleanupAdmissionStore.acknowledgePersonalComponent` | `spec/domains/index.md#ScopeKey-と永続化境界` | 個人 cleanup component の完了を記録する |
| DOM-common-011 | `ScopeCleanupAdmissionStore.markCompleted` | `spec/domains/index.md#ScopeKey-と永続化境界` | 全 component 完了後に barrier を保持期限付きで完了化する |
| DOM-common-012 | `ScopeCleanupAdmissionStore.pruneCompleted` | `spec/domains/index.md#ScopeKey-と永続化境界` | 期限切れ完了 barrier を有界に回収する |
| DOM-common-013 | `AccountDeletionManifestStore.begin` | `spec/domains/index.md#ScopeKey-と永続化境界` | account deletion manifest を冪等に開始する。再投入された `begin` は既に記録済みのものをすべて保つ |
| DOM-common-014 | `AccountDeletionManifestStore.appendMembershipPage` | `spec/domains/index.md#ScopeKey-と永続化境界` | membership edge を有界ページで manifest に固定する |
| DOM-common-015 | `AccountDeletionManifestStore.appendAuthorRoutePage` | `spec/domains/index.md#ScopeKey-と永続化境界` | author route ページを cursor と原子的に固定する |
| DOM-common-016 | `AccountDeletionManifestStore.markBuilt` | `spec/domains/index.md#ScopeKey-と永続化境界` | 対象固定済みへ遷移する |
| DOM-common-017 | `AccountDeletionManifestStore.beginRollback` | `spec/domains/index.md#ScopeKey-と永続化境界` | prepare rejection 後の rollback を開始する |
| DOM-common-018 | `AccountDeletionManifestStore.claimPending` | `spec/domains/index.md#ScopeKey-と永続化境界` | 指定 phase の未処理 item を最大 limit 件 claim する。membership item は prepare ack だけでは完了せず、cleanup phase でも claim できる |
| DOM-common-019 | `AccountDeletionManifestStore.acknowledge` | `spec/domains/index.md#ScopeKey-と永続化境界` | item phase の完了を冪等に記録する |
| DOM-common-020 | `AccountDeletionManifestStore.acknowledgeReceipt` | `spec/domains/index.md#ScopeKey-と永続化境界` | 配備が宣言した global・personal receipt の完了を記録する。receipt が全部そろっても item の完全 ack を代替しない |
| DOM-common-021 | `AccountDeletionManifestStore.allRollbackReleased` | `spec/domains/index.md#ScopeKey-と永続化境界` | 固定済み membership item の release ack がすべてそろったかを判定する。`personalAbort` receipt は判定対象に含まない（利用者を `active` へ戻す復帰ゲートは述語より強く、ユースケース側が持つ — ADR 053） |
| DOM-common-022 | `AccountDeletionManifestStore.allRequiredAcknowledged` | `spec/domains/index.md#ScopeKey-と永続化境界` | 固定済み全 item の完全 ack と宣言された全 receipt の両方がそろって初めて true にする。membership item は cleanup レーンが ack して初めて完全 ack になるので、prepare ack ＋ 宣言 receipt だけでは true にならない |
| DOM-common-023 | `AccountDeletionManifestStore.compactItems` | `spec/domains/index.md#ScopeKey-と永続化境界` | ack 済み item を有界に縮約する |
| DOM-common-024 | `AccountDeletionManifestStore.markCompleted` | `spec/domains/index.md#ScopeKey-と永続化境界` | 成功した manifest を終端・保持期限付きにする |
| DOM-common-025 | `AccountDeletionManifestStore.markRejected` | `spec/domains/index.md#ScopeKey-と永続化境界` | rejection manifest を終端・保持期限付きにする |
| DOM-common-026 | `AccountDeletionManifestStore.pruneTerminal` | `spec/domains/index.md#ScopeKey-と永続化境界` | 期限切れ terminal manifest を keyset で回収し、件数ではなく回収した operationId 列を返す |
| DOM-common-027 | `GlobalMaintenanceRunStore.beginOrResumeKind` | `spec/domains/index.md#ScopeKey-と永続化境界` | kind ごとの最古 run を開始または再開し lease 状態を返す |
| DOM-common-028 | `GlobalMaintenanceRunStore.claimLanes` | `spec/domains/index.md#ScopeKey-と永続化境界` | maintenance lane を有界に claim する |
| DOM-common-029 | `GlobalMaintenanceRunStore.checkpointLane` | `spec/domains/index.md#ScopeKey-と永続化境界` | cursor と次 command key を原子的に checkpoint する |
| DOM-common-030 | `GlobalMaintenanceRunStore.advanceOrAck` | `spec/domains/index.md#ScopeKey-と永続化境界` | lane を進め、進めた先の position と shard / run 完了を返す |
| DOM-common-031 | `GlobalMaintenanceRunStore.recoverLease` | `spec/domains/index.md#ScopeKey-と永続化境界` | 失効した run lease を owner が回収する |
| DOM-common-032 | `GlobalMaintenanceRunStore.pruneCompleted` | `spec/domains/index.md#ScopeKey-と永続化境界` | 期限切れ completed run を keyset で回収する |
| DOM-common-033 | `MailSender.send` | `spec/domains/index.md#MailSenderapplicationportsmailsenderts` | locale と template を指定してメールを送る |
| DOM-common-034 | `TimeZoneResolver.monthRange` | `spec/domains/index.md#TimeZoneResolverapplicationportstimeZoneResolverts` | 暦月を time zone 上の半開区間へ変換する |
| DOM-common-035 | `TimeZoneResolver.monthOf` | `spec/domains/index.md#TimeZoneResolverapplicationportstimeZoneResolverts` | instant が属する time zone 上の暦月を返す |
| DOM-common-036 | `TimeZoneResolver.dayKey` | `spec/domains/index.md#TimeZoneResolverapplicationportstimeZoneResolverts` | instant の現地日を YYYY-MM-DD で返す |
| DOM-common-037 | `OAuthStateStore.put` | `spec/domains/index.md#OAuthStateStoreapplicationportsoauthStateStorets` | OAuth state を TTL 付きで保存する |
| DOM-common-038 | `OAuthStateStore.take` | `spec/domains/index.md#OAuthStateStoreapplicationportsoauthStateStorets` | 束縛が一致したときだけ state を原子的に取得・削除する（一致すれば期限切れでも削除して `null`、不一致は常に行を残して `null`） |
| DOM-common-039 | `OAuthStateStore.deleteExpired` | `spec/domains/index.md#OAuthStateStoreapplicationportsoauthStateStorets` | 期限切れ state を cursor と limit で回収する |
| DOM-common-040 | `IdempotencyStore.markProcessed` | `spec/domains/index.md#IdempotencyStoreapplicationportsidempotencyStorets` | consumer と EventId を原子的に記録し重複なら false を返す |
| DOM-common-041 | `ScopeCleanupAdmissionStore.describePersonalCleanup` | `spec/domains/index.md#ScopeKey-と永続化境界` | personal barrier がまだ running か・どの component が ack 済みかを読み、receipt が無い場合と別 operation が scope を持つ場合は null を返す |
| DOM-common-042 | `AccountDeletionManifestStore.describe` | `spec/domains/index.md#ScopeKey-と永続化境界` | manifest header の読み取り射影（2 つの build cursor と所有 user）を返し、既に消えていれば null を返す |
| DOM-identity-001 | `UserId` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-identity-002 | `IdentityId` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-identity-003 | `SessionId` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-identity-004 | `AuthTokenId` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-identity-005 | `Email` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | trim・小文字化し 254 文字以内の email 形式を保証する |
| DOM-identity-006 | `Handle` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | 文字種・長さ・端点・予約語を検証し小文字で比較する |
| DOM-identity-007 | `DisplayName` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | trim 後 1〜50 文字を保証する |
| DOM-identity-008 | `Bio` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | 空を許し 500 文字以内を保証する |
| DOM-identity-009 | `PasswordHash` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | 空を拒否し生成を PasswordHasher に限定する |
| DOM-identity-010 | `PlainPassword` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | 8〜128 文字で英字・数字を含み記録不能とする |
| DOM-identity-011 | `TokenHash` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | 空を拒否し生成を SecureTokenGenerator に限定する |
| DOM-identity-012 | `OAuthProvider` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | 既知 provider のみを表す |
| DOM-identity-013 | `AuthTokenPurpose` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | purpose ごとの 24 時間・1 時間 TTL を導く |
| DOM-identity-014 | `LoginAttemptKey` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | signIn と share を namespaced key で分離し秘密は hash を使う |
| DOM-identity-015 | `User` エンティティ | `spec/domains/identity.md#エンティティ` | pending・active・deleting・deleted を型で分け authEpoch と PII 削除を保つ |
| DOM-identity-016 | `Identity` エンティティ | `spec/domains/identity.md#エンティティ` | password・OAuth 認証手段の生成と password 変更 event を担う |
| DOM-identity-017 | `Session` エンティティ | `spec/domains/identity.md#エンティティ` | authEpoch と発行から 30 日の絶対期限を保持する |
| DOM-identity-018 | `AuthToken` エンティティ | `spec/domains/identity.md#エンティティ` | purpose TTL・authEpoch・pending から consumed の単回遷移を保つ |
| DOM-identity-019 | `IdentityPolicy` ドメインサービス | `spec/domains/identity.md#ドメインサービス` | 最終認証手段・password 重複を検査し、8 件の上限超過を `BusinessRuleError(IdentityLimitExceeded)` にする。`findOAuth` で 1 利用者の集合内の同一 `(provider, providerAccountId)` を引く |
| DOM-identity-020 | `AccountLinkingPolicy` ドメインサービス | `spec/domains/identity.md#ドメインサービス` | provider email 確認と既存 User 状態から linking 判定を返す |
| DOM-identity-021 | `LoginThrottlePolicy` ドメインサービス | `spec/domains/identity.md#ドメインサービス` | 失敗数から delay・15 分 lock を純粋に導出する |
| DOM-identity-022 | `UserRepository.insert` | `spec/domains/identity.md#ポート` | 新規 User を保存する |
| DOM-identity-023 | `UserRepository.findById` | `spec/domains/identity.md#ポート` | UserId で OCC token 付き User を取得する |
| DOM-identity-024 | `UserRepository.save` | `spec/domains/identity.md#ポート` | 期待版一致時だけ User を更新する |
| DOM-identity-025 | `UserRepository.delete` | `spec/domains/identity.md#ポート` | 期待版一致時だけ User を削除する |
| DOM-identity-026 | `UserBatchReader.resolveMany` | `spec/domains/identity.md#ポート` | 最大 100 UserId を shard 横断で version 付き解決し、上限超過は `SystemError(DatabaseError)` にする |
| DOM-identity-027 | `IdentityUniqueDirectory.resolve` | `spec/domains/identity.md#ポート` | 一意キーの恒久 claim を持つ UserId を解決する（`reserved` と `releasing` はどちらも null に見える）。`resolveClaim` の射影であり、常に `resolveClaim(k,n)?.userId ?? null` と一致する |
| DOM-identity-028 | `IdentityUniqueDirectory.reserve` | `spec/domains/identity.md#ポート` | email・handle・provider account を operation 単位で予約する。provider account の一意性を担保する唯一の場所で、`releasing` の鍵は奪えず conflict を返す（奪えるのは失効した `reserved` だけ） |
| DOM-identity-029 | `IdentityUniqueDirectory.activate` | `spec/domains/identity.md#ポート` | 期待 User version で予約を恒久 claim へ昇格させる |
| DOM-identity-030 | `IdentityUniqueDirectory.release` | `spec/domains/identity.md#ポート` | operation の `reserved` と `releasing` の行を落とす（`active` には触れない） |
| DOM-identity-031 | `IdentityRepository.insert` | `spec/domains/identity.md#ポート` | 新規 Identity を保存する。provider account の一意性はここでは検査しない（担保は `IdentityUniqueDirectory` の claim 索引だけが持つ） |
| DOM-identity-032 | `IdentityRepository.findById` | `spec/domains/identity.md#ポート` | IdentityId で OCC token 付き Identity を取得する |
| DOM-identity-033 | `IdentityRepository.save` | `spec/domains/identity.md#ポート` | 期待版一致時だけ Identity を更新する |
| DOM-identity-034 | `IdentityRepository.delete` | `spec/domains/identity.md#ポート` | 期待版一致時だけ Identity を削除する |
| DOM-identity-035 | `IdentityRepository.listByUserId` | `spec/domains/identity.md#ポート` | 利用者の認証手段を最大 8 件返す |
| DOM-identity-036 | `SessionRepository.insert` | `spec/domains/identity.md#ポート` | Session を保存する |
| DOM-identity-037 | `SessionRepository.findByTokenHash` | `spec/domains/identity.md#ポート` | UserId と token hash で Session を取得する |
| DOM-identity-038 | `SessionRepository.deleteById` | `spec/domains/identity.md#ポート` | SessionId の行を削除する |
| DOM-identity-039 | `SessionRepository.refreshAuthEpoch` | `spec/domains/identity.md#ポート` | 現在 Session だけを新 auth epoch へ追随させる |
| DOM-identity-040 | `SessionRepository.deleteOlderEpochByUser` | `spec/domains/identity.md#ポート` | 旧世代 Session を利用者単位で有界削除する |
| DOM-identity-041 | `SessionRepository.deleteExpired` | `spec/domains/identity.md#ポート` | 期限切れ Session を keyset で有界削除する |
| DOM-identity-042 | `AuthTokenRepository.insert` | `spec/domains/identity.md#ポート` | AuthToken を保存する |
| DOM-identity-043 | `AuthTokenRepository.findByTokenHash` | `spec/domains/identity.md#ポート` | UserId と hash で token を取得する |
| DOM-identity-044 | `AuthTokenRepository.save` | `spec/domains/identity.md#ポート` | pending 行だけを条件付きで consumed に更新する |
| DOM-identity-045 | `AuthTokenRepository.deleteByUserAndPurpose` | `spec/domains/identity.md#ポート` | 利用者・用途の token を有界削除する |
| DOM-identity-046 | `AuthTokenRepository.deleteOlderEpochByUser` | `spec/domains/identity.md#ポート` | 旧世代 token を利用者単位で有界削除する |
| DOM-identity-047 | `AuthTokenRepository.deleteExpired` | `spec/domains/identity.md#ポート` | 期限切れ token を keyset で有界削除する |
| DOM-identity-048 | `PasswordHasher.hash` | `spec/domains/identity.md#ポート` | PlainPassword を PasswordHash に変換する |
| DOM-identity-049 | `PasswordHasher.verify` | `spec/domains/identity.md#ポート` | 平文と hash を安全に照合する |
| DOM-identity-050 | `SecureTokenGenerator.issue` | `spec/domains/identity.md#ポート` | 256 bit 以上の token と保存用 hash を生成する |
| DOM-identity-051 | `SecureTokenGenerator.issueForUser` | `spec/domains/identity.md#ポート` | UserId locator 付き token と hash を生成する |
| DOM-identity-052 | `SecureTokenGenerator.locateUser` | `spec/domains/identity.md#ポート` | locator 形式を検証して UserId を取り出す |
| DOM-identity-053 | `SecureTokenGenerator.hashOf` | `spec/domains/identity.md#ポート` | 任意 token の保存用 hash を算出する |
| DOM-identity-054 | `SignInOAuthClient.buildAuthorizationUrl` | `spec/domains/identity.md#ポート` | PKCE・state を含む認可 URL を構築する |
| DOM-identity-055 | `SignInOAuthClient.exchangeCode` | `spec/domains/identity.md#ポート` | authorization code を OAuth profile に交換する |
| DOM-identity-056 | `LoginAttemptStore.get` | `spec/domains/identity.md#ポート` | namespaced key の失敗記録を取得する |
| DOM-identity-057 | `LoginAttemptStore.recordFailure` | `spec/domains/identity.md#ポート` | 失敗回数を単一原子操作で加算し加算後状態を返す |
| DOM-identity-058 | `LoginAttemptStore.clear` | `spec/domains/identity.md#ポート` | 認証成功時に失敗記録を削除する |
| DOM-identity-059 | `LoginAttemptStore.deleteExpired` | `spec/domains/identity.md#ポート` | 期限切れ失敗記録を keyset で有界削除する |
| DOM-identity-060 | `AuthTokenRepository.findPendingByUserAndPurpose` | `spec/domains/identity.md#ポート` | (user, purpose) 部分一意索引が保証する at-most-one live token を読み、再送間隔の判定に使う |
| DOM-identity-061 | `SignInOAuthClient.deriveCodeChallenge` | `spec/domains/identity.md#ポート` | code verifier から PKCE S256 challenge を純粋・決定的に導く |
| DOM-identity-062 | `IdentityUniqueDirectory.beginRelease` | `spec/domains/identity.md#ポート` | normalizedKey で引いた行が `active`・所有者一致・`expectedClaimToken` 一致のときだけ `releasing` にして解放側 operation へ付け替える。行なし・`reserved`・`releasing`・別利用者・トークン不一致はすべて no-op |
| DOM-identity-063 | `AccountDeletionRetryPolicy` ドメインサービス | `spec/domains/identity.md#ドメインサービス` | 120 日の窓と 8 件の上限を持ち、保持中の terminal 行が上限に達していれば `BusinessRuleError(AccountDeletionRetryLimitExceeded)` にする |
| DOM-identity-064 | `AvatarUrl` 値オブジェクト | `spec/domains/identity.md#値オブジェクト` | trim 後 1〜2048 文字で、アプリ相対パスか `appUrl` と同一オリジンの絶対 URL だけを許し、違反を `BusinessRuleError(InvalidAvatarUrl)` にする。自オリジンの情報は引数で受け取る |
| DOM-identity-065 | `SameOriginPolicy` ドメインサービス | `spec/domains/identity.md#ドメインサービス` | `//` 始まり・バックスラッシュ・C0 制御文字を拒む自オリジン述語を 1 本だけ持ち、真偽値だけを返す |
| DOM-identity-066 | `IdentityUniqueDirectory.resolveClaim` | `spec/domains/identity.md#ポート` | 恒久 claim の持ち主と、観測した `(kind, normalizedKey)` の文脈で 1 つの claim を同定する `claimToken` を返す。トークンは claim が生きているあいだ不変で、張り直した claim とは（同じ operation ID であっても）必ず異なる。契約はこの 2 性質だけで、他の鍵のトークンとの不一致も推測困難性も含まない |
| DOM-workspace-001 | `WorkspaceId` 値オブジェクト | `spec/domains/workspace.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-workspace-002 | `MembershipId` 値オブジェクト | `spec/domains/workspace.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-workspace-003 | `InvitationId` 値オブジェクト | `spec/domains/workspace.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-workspace-004 | `WorkspaceSlug` 値オブジェクト | `spec/domains/workspace.md#値オブジェクト` | 長さ・文字種・端点・予約語を検証し小文字で比較する |
| DOM-workspace-005 | `WorkspaceName` 値オブジェクト | `spec/domains/workspace.md#値オブジェクト` | trim 後 1〜80 文字を保証する |
| DOM-workspace-006 | `WorkspaceDescription` 値オブジェクト | `spec/domains/workspace.md#値オブジェクト` | 空を許し 500 文字以内を保証する |
| DOM-workspace-007 | `WorkspaceRole` 値オブジェクト | `spec/domains/workspace.md#値オブジェクト` | owner・editor・viewer の順序と atLeast を定義する |
| DOM-workspace-008 | `Workspace` エンティティ | `spec/domains/workspace.md#エンティティ` | private・published と active・deleting の不正組合せを型で防ぐ |
| DOM-workspace-009 | `Membership` エンティティ | `spec/domains/workspace.md#エンティティ` | workspace・user・role を保持し role 変更 event を発行する |
| DOM-workspace-010 | `Invitation` エンティティ | `spec/domains/workspace.md#エンティティ` | pending・accepted・revoked と発行から 14 日の期限を保つ |
| DOM-workspace-011 | `WorkspaceAuthorization` ドメインサービス | `spec/domains/workspace.md#ドメインサービス` | action ごとの最小 role を唯一の表から判定する |
| DOM-workspace-012 | `MembershipPolicy` ドメインサービス | `spec/domains/workspace.md#ドメインサービス` | 最終 owner・自己変更・自己除名・所有 workspace 上限を検査する |
| DOM-workspace-013 | `WorkspaceRepository.insert` | `spec/domains/workspace.md#ポート` | 新規 Workspace を保存する |
| DOM-workspace-014 | `WorkspaceRepository.findById` | `spec/domains/workspace.md#ポート` | WorkspaceId で OCC token 付き集約を取得する |
| DOM-workspace-015 | `WorkspaceRepository.save` | `spec/domains/workspace.md#ポート` | 期待版一致時だけ Workspace を更新する |
| DOM-workspace-016 | `WorkspaceRepository.delete` | `spec/domains/workspace.md#ポート` | 期待版一致時だけ Workspace を削除する |
| DOM-workspace-017 | `UserWorkspaceDirectory.listActiveByUser` | `spec/domains/workspace.md#ポート` | 利用者の active edge を署名 keyset cursor で返す |
| DOM-workspace-018 | `WorkspaceDirectoryBatchReader.resolveMany` | `spec/domains/workspace.md#ポート` | 最大 20 WorkspaceId の directory 状態を shard 横断解決する |
| DOM-workspace-019 | `PublicWorkspaceDirectoryReader.listPublished` | `spec/domains/workspace.md#ポート` | 公開 workspace を全 shard から keyset merge する |
| DOM-workspace-020 | `MembershipRepository.insert` | `spec/domains/workspace.md#ポート` | 新規 Membership を保存する |
| DOM-workspace-021 | `MembershipRepository.findById` | `spec/domains/workspace.md#ポート` | MembershipId で OCC token 付き集約を取得する |
| DOM-workspace-022 | `MembershipRepository.save` | `spec/domains/workspace.md#ポート` | 期待版一致時だけ Membership を更新する |
| DOM-workspace-023 | `MembershipRepository.delete` | `spec/domains/workspace.md#ポート` | 期待版一致時だけ Membership を削除する |
| DOM-workspace-024 | `MembershipRepository.findByWorkspaceAndUser` | `spec/domains/workspace.md#ポート` | workspace・user の membership を取得する |
| DOM-workspace-025 | `MembershipRepository.listByWorkspace` | `spec/domains/workspace.md#ポート` | workspace の membership をページングする |
| DOM-workspace-026 | `MembershipRepository.countByRole` | `spec/domains/workspace.md#ポート` | 指定 role の人数を数える |
| DOM-workspace-027 | `MembershipRepository.deleteByIds` | `spec/domains/workspace.md#ポート` | 最大 100 MembershipId を削除する |
| DOM-workspace-028 | `InvitationRepository.insert` | `spec/domains/workspace.md#ポート` | 新規 Invitation を保存する |
| DOM-workspace-029 | `InvitationRepository.findById` | `spec/domains/workspace.md#ポート` | InvitationId で OCC token 付き集約を取得する |
| DOM-workspace-030 | `InvitationRepository.save` | `spec/domains/workspace.md#ポート` | 期待版一致時だけ Invitation を更新する |
| DOM-workspace-031 | `InvitationRepository.delete` | `spec/domains/workspace.md#ポート` | 期待版一致時だけ Invitation を削除する |
| DOM-workspace-032 | `InvitationRepository.findByTokenHash` | `spec/domains/workspace.md#ポート` | token hash で招待を取得する |
| DOM-workspace-033 | `InvitationRepository.findPendingByWorkspaceAndEmail` | `spec/domains/workspace.md#ポート` | workspace・email の pending 招待を取得する |
| DOM-workspace-034 | `InvitationRepository.listByWorkspace` | `spec/domains/workspace.md#ポート` | workspace の招待をページングする |
| DOM-workspace-035 | `InvitationRepository.countPendingIssuedSince` | `spec/domains/workspace.md#ポート` | 期間内の未処理招待数を返す |
| DOM-workspace-036 | `InvitationRepository.deleteByIds` | `spec/domains/workspace.md#ポート` | 最大 100 InvitationId を削除する |
| DOM-workspace-037 | `InvitationRouteStore.resolveActive` | `spec/domains/workspace.md#ポート` | token hash の active route を解決する |
| DOM-workspace-038 | `InvitationRouteStore.reserve` | `spec/domains/workspace.md#ポート` | 新規 token route を TTL 付き予約する |
| DOM-workspace-039 | `InvitationRouteStore.activate` | `spec/domains/workspace.md#ポート` | operation の route を有効化する |
| DOM-workspace-040 | `InvitationRouteStore.reserveReplacement` | `spec/domains/workspace.md#ポート` | 再送用の旧新 token route 交換を予約する |
| DOM-workspace-041 | `InvitationRouteStore.activateReplacement` | `spec/domains/workspace.md#ポート` | 旧新 route の交換を原子的に有効化する |
| DOM-workspace-042 | `InvitationRouteStore.abandon` | `spec/domains/workspace.md#ポート` | 未確定 token route を破棄する |
| DOM-workspace-043 | `InvitationRouteStore.revoke` | `spec/domains/workspace.md#ポート` | invitation route を取消済みにする |
| DOM-workspace-044 | `InvitationRouteStore.consume` | `spec/domains/workspace.md#ポート` | invitation route を受諾済みにする |
| DOM-workspace-045 | `MembershipDirectoryReservationStore.reserveAndClaimActivation` | `spec/domains/workspace.md#ポート` | User active 検査と pending edge activation claim を原子的に行う |
| DOM-workspace-046 | `MembershipDirectoryReservationStore.activate` | `spec/domains/workspace.md#ポート` | membership directory edge を active にする |
| DOM-workspace-047 | `MembershipDirectoryReservationStore.abandon` | `spec/domains/workspace.md#ポート` | activation edge を破棄する |
| DOM-workspace-048 | `MembershipDirectoryReservationStore.prepareAccountDeletion` | `spec/domains/workspace.md#ポート` | account deletion 用 edge prepare を開始する |
| DOM-workspace-049 | `MembershipDirectoryReservationStore.renewAccountDeletion` | `spec/domains/workspace.md#ポート` | prepare lease を更新する |
| DOM-workspace-050 | `MembershipDirectoryReservationStore.commitAccountDeletion` | `spec/domains/workspace.md#ポート` | edge removal を committed にする |
| DOM-workspace-051 | `MembershipDirectoryReservationStore.releaseAccountDeletion` | `spec/domains/workspace.md#ポート` | deletion prepare lock を解放する |
| DOM-workspace-052 | `MembershipDirectoryReservationStore.listActivatingByUser` | `spec/domains/workspace.md#ポート` | 利用者の activating edge を有界列挙する |
| DOM-workspace-053 | `MembershipRemovalPreparationStore.prepare` | `spec/domains/workspace.md#ポート` | membership version を検査して removal lock を取る |
| DOM-workspace-054 | `MembershipRemovalPreparationStore.renew` | `spec/domains/workspace.md#ポート` | removal prepare lease を更新する |
| DOM-workspace-055 | `MembershipRemovalPreparationStore.commit` | `spec/domains/workspace.md#ポート` | removal lock を committed にする |
| DOM-workspace-056 | `MembershipRemovalPreparationStore.release` | `spec/domains/workspace.md#ポート` | removal lock を解放する |
| DOM-workspace-057 | `MembershipRemovalPreparationStore.hasConflict` | `spec/domains/workspace.md#ポート` | user に有効または未回収 lock があるか返す |
| DOM-workspace-058 | `WorkspaceOperationLockStore.hasActiveMove` | `spec/domains/workspace.md#ポート` | active move lock の有無を返す |
| DOM-workspace-059 | `WorkspaceOperationLockStore.hasMoveConflict` | `spec/domains/workspace.md#ポート` | user と競合する move lock の有無を返す |
| DOM-workspace-060 | `WorkspaceOperationLockStore.beginDeletion` | `spec/domains/workspace.md#ポート` | Workspace の deletion CAS と manifest header 作成を原子的に行う |
| DOM-workspace-061 | `WorkspaceOperationLockStore.assertWritable` | `spec/domains/workspace.md#ポート` | deletion 中・削除後の通常書き込みを拒否する |
| DOM-workspace-062 | `WorkspaceOperationLockStore.assertDeletionOwner` | `spec/domains/workspace.md#ポート` | deletion worker の operation 所有権を検査する |
| DOM-workspace-063 | `WorkspaceOperationLockStore.assertMaintenanceAllowed` | `spec/domains/workspace.md#ポート` | 削除後に許可された maintenance 種別だけを通す |
| DOM-workspace-064 | `WorkspaceDeletionManifestStore.appendMembershipPage` | `spec/domains/workspace.md#ポート` | membership page と cursor を manifest に固定する |
| DOM-workspace-065 | `WorkspaceDeletionManifestStore.appendInvitationPage` | `spec/domains/workspace.md#ポート` | invitation page と cursor を manifest に固定する |
| DOM-workspace-066 | `WorkspaceDeletionManifestStore.markReady` | `spec/domains/workspace.md#ポート` | manifest を対象固定済みにする |
| DOM-workspace-067 | `WorkspaceDeletionManifestStore.listLocalPending` | `spec/domains/workspace.md#ポート` | local 未完了 item を有界列挙する |
| DOM-workspace-068 | `WorkspaceDeletionManifestStore.acknowledgeLocal` | `spec/domains/workspace.md#ポート` | local deletion 完了を記録する |
| DOM-workspace-069 | `WorkspaceDeletionManifestStore.listItems` | `spec/domains/workspace.md#ポート` | manifest item を cursor 付きで列挙する |
| DOM-workspace-070 | `WorkspaceDeletionManifestStore.acknowledge` | `spec/domains/workspace.md#ポート` | global cleanup 完了を記録する |
| DOM-workspace-071 | `WorkspaceDeletionManifestStore.compactAcknowledged` | `spec/domains/workspace.md#ポート` | local・global ack 済み item を有界縮約する |
| DOM-workspace-072 | `WorkspaceDeletionManifestStore.markCompleted` | `spec/domains/workspace.md#ポート` | item が空の manifest を完了 tombstone にする |
| DOM-storage-001 | `StoredFileId` 値オブジェクト | `spec/domains/storage.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-storage-002 | `ObjectKey` 値オブジェクト | `spec/domains/storage.md#値オブジェクト` | 1〜1024 文字で traversal と先頭 slash を拒否し owner・purpose から構築する |
| DOM-storage-003 | `FileName` 値オブジェクト | `spec/domains/storage.md#値オブジェクト` | 1〜255 文字へ安全化し path separator・制御文字を除く |
| DOM-storage-004 | `MimeType` 値オブジェクト | `spec/domains/storage.md#値オブジェクト` | type/subtype を保証し未知値を octet-stream に落とす |
| DOM-storage-005 | `ByteSize` 値オブジェクト | `spec/domains/storage.md#値オブジェクト` | 0 以上の整数と上限比較を提供する |
| DOM-storage-006 | `Checksum` 値オブジェクト | `spec/domains/storage.md#値オブジェクト` | sha256 と 64 桁 hex を保証し、違反は `BusinessRuleError(InvalidChecksum)` にする |
| DOM-storage-007 | `FilePurpose` 値オブジェクト | `spec/domains/storage.md#値オブジェクト` | source・media・reference・artifact・avatar の用途を表す |
| DOM-storage-008 | `StorageOwner` 値オブジェクト | `spec/domains/storage.md#値オブジェクト` | user または workspace の容量帰属を表す |
| DOM-storage-009 | `ReferenceAttempt` 値オブジェクト | `spec/domains/storage.md#値オブジェクト` | resource・stylesheet と結果の合法な組合せを保証する |
| DOM-storage-010 | `ReferenceImportSummary` 値オブジェクト | `spec/domains/storage.md#値オブジェクト` | 最新取り込みの CSS 除去を分類別件数で有界保持する |
| DOM-storage-011 | `StoredFile` エンティティ | `spec/domains/storage.md#エンティティ` | provenance と persistent・ephemeral を型で結び artifact に期限を必須化する |
| DOM-storage-012 | `UploadValidationPolicy` ドメインサービス | `spec/domains/storage.md#ドメインサービス` | `{ purpose, body }` を受け、MIME を先頭バイトの署名で・サイズを実バイト長で決めた `AcceptedUpload` を返す。許可形式外と byte 上限超過は拒否する |
| DOM-storage-013 | `ExternalFetchPolicy` ドメインサービス | `spec/domains/storage.md#ドメインサービス` | SSRF 条件と 200 件・100 MiB の取得 budget を検査する |
| DOM-storage-014 | `StorageUrlPolicy` ドメインサービス | `spec/domains/storage.md#ドメインサービス` | URL が service 内 storage を指すか構成依存で判定する |
| DOM-storage-015 | `StoredFileRepository.insert` | `spec/domains/storage.md#ポート` | 新規 StoredFile を保存する |
| DOM-storage-016 | `StoredFileRepository.findById` | `spec/domains/storage.md#ポート` | StoredFileId で OCC token 付き集約を取得する |
| DOM-storage-017 | `StoredFileRepository.save` | `spec/domains/storage.md#ポート` | 期待版一致時だけ StoredFile を更新する |
| DOM-storage-018 | `StoredFileRepository.delete` | `spec/domains/storage.md#ポート` | 期待版一致時だけ StoredFile を削除する |
| DOM-storage-019 | `StoredFileRepository.listByIds` | `spec/domains/storage.md#ポート` | current scope の複数 file を ID で取得する |
| DOM-storage-020 | `StoredFileRepository.listByNote` | `spec/domains/storage.md#ポート` | ノートに属する全 file metadata を返す |
| DOM-storage-021 | `StoredFileRepository.listDeletableByNote` | `spec/domains/storage.md#ポート` | ノート削除対象 file を有界列挙する |
| DOM-storage-022 | `StoredFileRepository.findArtifactByNoteAndVersion` | `spec/domains/storage.md#ポート` | 有効期限内の同版 artifact を取得する |
| DOM-storage-023 | `StoredFileRepository.listExpired` | `spec/domains/storage.md#ポート` | 期限切れ ephemeral file を有界列挙する |
| DOM-storage-024 | `StoredFileRepository.listByPurposeOlderThan` | `spec/domains/storage.md#ポート` | current scope の用途・作成時刻で file を有界列挙する |
| DOM-storage-025 | `StoredFileRepository.sumSizeByOwner` | `spec/domains/storage.md#ポート` | artifact を除く owner の使用容量を合計する |
| DOM-storage-026 | `StoredFileRepository.listByOwner` | `spec/domains/storage.md#ポート` | owner と用途で file をページングする |
| DOM-storage-027 | `ReferenceImportRecordRepository.saveAttempts` | `spec/domains/storage.md#ポート` | 取得試行を note・URL キーで上書き保存する |
| DOM-storage-028 | `ReferenceImportRecordRepository.putSummary` | `spec/domains/storage.md#ポート` | ノート単位の最新取り込み要約を保存する |
| DOM-storage-029 | `ReferenceImportRecordRepository.listAttemptsByNote` | `spec/domains/storage.md#ポート` | ノートの取得試行記録を返す |
| DOM-storage-030 | `ReferenceImportRecordRepository.findSummaryByNote` | `spec/domains/storage.md#ポート` | ノートの最新取り込み要約を取得する |
| DOM-storage-031 | `ReferenceImportRecordRepository.deleteByNote` | `spec/domains/storage.md#ポート` | attempt と summary を合わせて有界削除する |
| DOM-storage-032 | `ObjectStorage.put` | `spec/domains/storage.md#ポート` | バイト列だけを受けて保存し実サイズと checksum を返す（ストリーム受けは契約に持たない） |
| DOM-storage-033 | `ObjectStorage.get` | `spec/domains/storage.md#ポート` | バイト列と metadata を持つ `ObjectBody` を取得し、未知の key では null を返す |
| DOM-storage-034 | `ObjectStorage.deleteMany` | `spec/domains/storage.md#ポート` | 指定 object key 群を冪等に削除し、存在しない key も許容する |
| DOM-storage-035 | `ObjectStorage.createDownloadUrl` | `spec/domains/storage.md#ポート` | file name と期限付きの download URL を発行する |
| DOM-storage-036 | `RemoteResourceFetcher.fetch` | `spec/domains/storage.md#ポート` | byte 上限と timeout を守って外部 URL を取得する |
| DOM-storage-037 | `DnsResolver.resolve` | `spec/domains/storage.md#ポート` | hostname を IP address 群へ解決する |
| DOM-storage-038 | `ObjectStorage.publicUrl` | `spec/domains/storage.md#ポート` | 公開配信してよい object の読み取り先 URL を組み立てる（期限つき URL とは別のメソッドとして型で分ける） |
| DOM-conversion-001 | `SourceFormat` 値オブジェクト | `spec/domains/conversion.md#値オブジェクト` | detector 由来の既知入力形式だけを表す |
| DOM-conversion-002 | `ConversionCapability` 値オブジェクト | `spec/domains/conversion.md#値オブジェクト` | LLM の available・unavailable・declined を区別する |
| DOM-conversion-003 | `ConversionPlan` 値オブジェクト | `spec/domains/conversion.md#値オブジェクト` | 変換手段と unavailable 理由を判別可能 union で表す |
| DOM-conversion-004 | `ConversionInstruction` 値オブジェクト | `spec/domains/conversion.md#値オブジェクト` | 空を許し 2000 文字以内を保証する |
| DOM-conversion-005 | `ConversionFailureReason` 値オブジェクト | `spec/domains/conversion.md#値オブジェクト` | Note と Job が共有する説明可能な失敗語彙を限定する |
| DOM-conversion-006 | `InitialContentState` 値オブジェクト | `spec/domains/conversion.md#値オブジェクト` | processing・awaiting・reason 付き failed の合法状態だけを表す |
| DOM-conversion-007 | `TranscriptText` 値オブジェクト | `spec/domains/conversion.md#値オブジェクト` | 空でない transcript を保証する |
| DOM-conversion-008 | `ConversionPlanner` ドメインサービス | `spec/domains/conversion.md#ドメインサービス` | format・capability から plan と初期本文状態を決定する |
| DOM-conversion-009 | `ConversionExecutor` ドメインサービス | `spec/domains/conversion.md#ドメインサービス` | plan ごとの port 呼出順と失敗分類を統一する |
| DOM-conversion-010 | `FormatDetector.detect` | `spec/domains/conversion.md#ポート` | 内容と申告 MIME から形式・実 MIME・password 保護を判定する |
| DOM-conversion-011 | `FileContentReader.readBytes` | `spec/domains/conversion.md#ポート` | StoredFileId の全 bytes を読む |
| DOM-conversion-012 | `FileContentReader.readText` | `spec/domains/conversion.md#ポート` | 指定または推定 encoding で text を読む |
| DOM-conversion-013 | `FileContentReader.readHead` | `spec/domains/conversion.md#ポート` | 指定 byte 数の先頭を読む |
| DOM-conversion-014 | `MarkdownRenderer.render` | `spec/domains/conversion.md#ポート` | Markdown を HTML 断片へ変換する |
| DOM-conversion-015 | `MarkdownRenderer.toMarkdown` | `spec/domains/conversion.md#ポート` | HTML を Markdown へ変換し非表現要素は HTML で残す |
| DOM-conversion-016 | `DocumentTextExtractor.extract` | `spec/domains/conversion.md#ポート` | 文書 bytes から block と title を抽出する |
| DOM-conversion-017 | `DocumentTextExtractor.renderPages` | `spec/domains/conversion.md#ポート` | 文書を指定 page 数・DPI の画像へ描画する |
| DOM-conversion-018 | `StructuringModel.structureText` | `spec/domains/conversion.md#ポート` | credential・model・text block から HTML を構造化する |
| DOM-conversion-019 | `StructuringModel.structureImages` | `spec/domains/conversion.md#ポート` | credential・model・page image から HTML を構造化する |
| DOM-conversion-020 | `TranscriptionModel.transcribe` | `spec/domains/conversion.md#ポート` | 音声 bytes を指定 model で空でない transcript にする |
| DOM-note-001 | `NoteId` 値オブジェクト | `spec/domains/note.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-note-002 | `RevisionId` 値オブジェクト | `spec/domains/note.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-note-003 | `NoteTitle` 値オブジェクト | `spec/domains/note.md#値オブジェクト` | 200 文字（UTF-16 コード単位）超は `BusinessRuleError(InvalidTitle)` で拒否し、空になった場合だけ `"無題"` に置換して auto・manual origin を保持する |
| DOM-note-004 | `NoteHtml` 値オブジェクト | `spec/domains/note.md#値オブジェクト` | sanitize 済み HTML を 800,000 UTF-8 bytes 以内に制限する |
| DOM-note-005 | `PlainTextContent` 値オブジェクト | `spec/domains/note.md#値オブジェクト` | 抽出平文を 800,000 UTF-8 bytes 以内に制限する |
| DOM-note-006 | `Excerpt` 値オブジェクト | `spec/domains/note.md#値オブジェクト` | 平文から最大 200 文字（UTF-16 コード単位）を切り出し、切り詰めでサロゲートペアを割らない |
| DOM-note-007 | `NoteHeading` 値オブジェクト | `spec/domains/note.md#値オブジェクト` | level 1〜6・100 文字（UTF-16 コード単位）以内へ切り詰めた text・anchor を保証し最大 200 件にする。切り詰めでサロゲートペアを割らない |
| DOM-note-008 | `StyleMode` 値オブジェクト | `spec/domains/note.md#値オブジェクト` | default または preserve のみを表す |
| DOM-note-009 | `NoteOwner` 値オブジェクト | `spec/domains/note.md#値オブジェクト` | user・workspace と対応 ID の合法な組合せを表す |
| DOM-note-010 | `ShareLink` 値オブジェクト | `spec/domains/note.md#値オブジェクト` | hash・暗号化 token・password hash と更新時刻を一体で保持する |
| DOM-note-011 | `SharePass` 値オブジェクト | `spec/domains/note.md#値オブジェクト` | token hash・password 世代・24 時間期限を持つ通過証を表す |
| DOM-note-012 | `NoteFailureReason` 値オブジェクト | `spec/domains/note.md#エンティティ` | integrationRequired を除き canceled を加えた本文失敗語彙を表す |
| DOM-note-013 | `Note` エンティティ | `spec/domains/note.md#エンティティ` | content・visibility・lifecycle の合法状態と全遷移 event を保つ。`ready` 以外の本文と公開・限定公開の組は**どちらの向きからも**作れず、`reconstruct` は ready 本文の必須列の欠落を空文字で補完せず拒否する |
| DOM-note-014 | `NoteRevision` エンティティ | `spec/domains/note.md#エンティティ` | ready 本文の不変 snapshot を作り最新 20 件保持に使う |
| DOM-note-015 | `NoteAccessPolicy` ドメインサービス | `spec/domains/note.md#ドメインサービス` | owner・role・lifecycle・公開・share credential の順で権限を判定する |
| DOM-note-016 | `NoteOwnershipPolicy` ドメインサービス | `spec/domains/note.md#ドメインサービス` | 移動元編集権・移動先作成権・processing lock を検査する |
| DOM-note-017 | `HtmlProcessor.process` | `spec/domains/note.md#ポート` | ADR 013 で sanitize し本文・平文・抜粋・見出し・除去報告を返す |
| DOM-note-018 | `HtmlProcessor.extractExternalReferences` | `spec/domains/note.md#ポート` | 内部 URL を含む属性ベース参照を抽出する |
| DOM-note-019 | `HtmlProcessor.rewriteReferences` | `spec/domains/note.md#ポート` | URL 参照を置換して NoteHtml を返す |
| DOM-note-020 | `HtmlProcessor.inlineStylesheets` | `spec/domains/note.md#ポート` | stylesheet 痕跡を imported・unavailable 状態へ遷移する |
| DOM-note-021 | `HtmlProcessor.editTextNodes` | `spec/domains/note.md#ポート` | expected 一致の text node edit だけを適用し skip を返す |
| DOM-note-022 | `PdfRenderer.render` | `spec/domains/note.md#ポート` | style mode と timeout を守って本文を PDF bytes にする |
| DOM-note-023 | `NoteExportComposer.composeSelfContainedHtml` | `spec/domains/note.md#ポート` | asset を可能な範囲で埋め込んだ単一 HTML を組み立てる |
| DOM-note-024 | `NoteRepository.insert` | `spec/domains/note.md#ポート` | 新規 Note を保存する |
| DOM-note-025 | `NoteRepository.findById` | `spec/domains/note.md#ポート` | NoteId で OCC token 付き Note を取得する |
| DOM-note-026 | `NoteRepository.save` | `spec/domains/note.md#ポート` | 期待版一致時だけ Note を更新する |
| DOM-note-027 | `NoteRepository.delete` | `spec/domains/note.md#ポート` | 期待版一致時だけ Note を削除する |
| DOM-note-028 | `NoteRepository.listByIds` | `spec/domains/note.md#ポート` | current scope の複数 Note を ID で取得する |
| DOM-note-029 | `NoteRepository.listPurgeable` | `spec/domains/note.md#ポート` | purgeAfter 到来済み TrashedNote を有界列挙する |
| DOM-note-030 | `NoteRepository.countByOwner` | `spec/domains/note.md#ポート` | owner と lifecycle 条件の Note 数を返す |
| DOM-note-031 | `NoteRepository.listByOwner` | `spec/domains/note.md#ポート` | owner と lifecycle で Note を `updatedAt DESC, id DESC` の全順序でページングする |
| DOM-note-032 | `NoteRevisionRepository.insert` | `spec/domains/note.md#ポート` | 不変な NoteRevision を保存する |
| DOM-note-033 | `NoteRevisionRepository.listByNote` | `spec/domains/note.md#ポート` | ノートの最新 revision を limit 件返す |
| DOM-note-034 | `NoteRevisionRepository.findById` | `spec/domains/note.md#ポート` | RevisionId で revision を取得する |
| DOM-note-035 | `NoteRevisionRepository.deleteOlderThanNewest` | `spec/domains/note.md#ポート` | 最新 keep 件を残し古い revision を削除する |
| DOM-note-036 | `NoteRevisionRepository.deleteByNote` | `spec/domains/note.md#ポート` | ノートの revision を全削除する |
| DOM-note-037 | `LocalNoteQueryService.search` | `spec/domains/note.md#ポート` | local projection を条件・sort・pagination で検索する。`highlightedExcerpt` は投影が持つマークアップをエスケープしてから強調を付ける |
| DOM-note-038 | `LocalNoteQueryService.listMonthsWithNotes` | `spec/domains/note.md#ポート` | owner のノートがある現地暦月を列挙する |
| DOM-note-039 | `LocalNoteQueryService.countByDay` | `spec/domains/note.md#ポート` | 半開期間を time zone の日別に集計する |
| DOM-note-040 | `LocalNoteQueryService.countByContentStatus` | `spec/domains/note.md#ポート` | owner・本文状態の Note 数を返す |
| DOM-note-041 | `PublicNoteQueryService.searchPublic` | `spec/domains/note.md#ポート` | public shard を署名 cursor で有界検索・merge する |
| DOM-note-042 | `PublicNoteQueryService.listPublicSitemapEntries` | `spec/domains/note.md#ポート` | 公開 Note sitemap entry を shard 横断列挙する |
| DOM-note-043 | `PublicNoteQueryService.listPublicAuthors` | `spec/domains/note.md#ポート` | 個人所有の公開 Note を持つ owner を重複なく列挙する |
| DOM-note-044 | `LocalNoteProjectionWriter.replaceSnapshotIfNewer` | `spec/domains/note.md#ポート` | 世代ベクトルが新しい完全 snapshot を原子的に置換する |
| DOM-note-045 | `LocalNoteProjectionWriter.remove` | `spec/domains/note.md#ポート` | Note・FTS・tag projection をすべて削除する |
| DOM-note-046 | `PublicNoteProjectionWriter.replaceSnapshotIfNewer` | `spec/domains/note.md#ポート` | route version と世代ベクトルで public snapshot を置換する |
| DOM-note-047 | `PublicNoteProjectionWriter.removeIfNewer` | `spec/domains/note.md#ポート` | route・projection revision が新しければ public 行を削除する |
| DOM-note-048 | `PublicNoteProjectionWriter.removeForPurge` | `spec/domains/note.md#ポート` | purge operation の public 削除を冪等に完了する |
| DOM-note-049 | `NoteProjectionSnapshotReader.read` | `spec/domains/note.md#ポート` | Note・tag・projection revision を同一 read transaction で返す |
| DOM-note-050 | `NoteProjectionRevisionStore.bump` | `spec/domains/note.md#ポート` | Note の projection revision を原子的に増やす |
| DOM-note-051 | `NoteRouteStore.resolve` | `spec/domains/note.md#ポート` | 外部 read 可能な Note route を解決する |
| DOM-note-052 | `NoteRouteStore.resolveMany` | `spec/domains/note.md#ポート` | 最大 500 Note route を shard 横断解決し、上限超過は `SystemError(DatabaseError)` にする |
| DOM-note-053 | `NoteRouteStore.reserveCreate` | `spec/domains/note.md#ポート` | Note 作成 route を TTL 付き予約する |
| DOM-note-054 | `NoteRouteStore.activateCreate` | `spec/domains/note.md#ポート` | 作成 route を active にする |
| DOM-note-055 | `NoteRouteStore.abandonCreate` | `spec/domains/note.md#ポート` | 作成途中の route を破棄する |
| DOM-note-056 | `NoteRouteStore.beginMove` | `spec/domains/note.md#ポート` | expected route version で moving 状態を開始する |
| DOM-note-057 | `NoteRouteStore.abortMove` | `spec/domains/note.md#ポート` | switch 前の move route を source active へ戻す |
| DOM-note-058 | `NoteRouteStore.switchMove` | `spec/domains/note.md#ポート` | moving route を target scope へ切り替える |
| DOM-note-059 | `NoteRouteStore.beginPurge` | `spec/domains/note.md#ポート` | purge 中へ遷移して外部到達を閉じる |
| DOM-note-060 | `NoteRouteStore.abortPurge` | `spec/domains/note.md#ポート` | local 削除前の purge を active へ戻す |
| DOM-note-061 | `NoteRouteStore.finishPurge` | `spec/domains/note.md#ポート` | purge route を期限付き tombstone にする |
| DOM-note-062 | `NoteRouteFanOutReader.listByCreatedBy` | `spec/domains/note.md#ポート` | author の `active` / `moving` / `purging` route を署名 cursor で shard 横断列挙する（除外は `reserved` だけ。`tombstone` は unspecified） |
| DOM-note-063 | `NoteRouteFanOutReader.listByScope` | `spec/domains/note.md#ポート` | scope の `active` / `moving` / `purging` route を署名 cursor で shard 横断列挙する（除外は `reserved` だけ。`tombstone` は unspecified） |
| DOM-note-064 | `ShareTokenProtector.protect` | `spec/domains/note.md#ポート` | share token を現行版鍵で暗号化する。失敗は `SystemError(DataIntegrityError)` |
| DOM-note-065 | `ShareTokenProtector.reveal` | `spec/domains/note.md#ポート` | 保存 key version の鍵で share token を復号する。未知の keyVersion・ciphertext の破損は `SystemError(DataIntegrityError)` |
| DOM-note-066 | `NoteMovePort.freezeSource` | `spec/domains/note.md#ポート` | source を再認可して move snapshot を固定する |
| DOM-note-067 | `NoteMovePort.stageTarget` | `spec/domains/note.md#ポート` | target を再認可し snapshot を冪等 stage する |
| DOM-note-068 | `NoteMovePort.activateTarget` | `spec/domains/note.md#ポート` | staged target を指定 route version で有効化する |
| DOM-note-069 | `NoteMovePort.retireSource` | `spec/domains/note.md#ポート` | switch 後の source データを退役させる |
| DOM-note-070 | `NoteMovePort.abortBeforeSwitch` | `spec/domains/note.md#ポート` | switch 前の target credit・stage・lock・freeze を冪等に戻す |
| DOM-note-071 | `LocalNoteProjectionWriter.redactAuthor` | `spec/domains/note.md#ポート` | 保存済みの著者表示を `redactionVersion` の退会既定値へ 1 行だけ置換し、行が変わったかを返す。行が無い / 別人が作った / 既に同世代以降はいずれも no-op |
| DOM-note-072 | `PublicNoteProjectionWriter.redactAuthor` | `spec/domains/note.md#ポート` | 保存済みの著者表示を `redactionVersion` の退会既定値へ 1 行だけ置換し、行が変わったかを返す。行が無い / 別人が作った / 既に同世代以降はいずれも no-op |
| DOM-tag-001 | `TagId` 値オブジェクト | `spec/domains/tag.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-tag-002 | `AssignmentId` 値オブジェクト | `spec/domains/tag.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-tag-003 | `TagName` 値オブジェクト | `spec/domains/tag.md#値オブジェクト` | 1〜50 文字を表示名と NFKC 相当の正規化名で保持する |
| DOM-tag-004 | `TagScope` 値オブジェクト | `spec/domains/tag.md#値オブジェクト` | user・workspace scope を表し NoteOwner から導く |
| DOM-tag-005 | `Tag` エンティティ | `spec/domains/tag.md#エンティティ` | scope 内一意の名前を作成・rename し event を発行する |
| DOM-tag-006 | `TagAssignment` エンティティ | `spec/domains/tag.md#エンティティ` | tag・note・scope・assigner の不変な付与を表す |
| DOM-tag-007 | `TagAssignmentPolicy` ドメインサービス | `spec/domains/tag.md#ドメインサービス` | 1 Note 50 件上限と scope 一致を検査する |
| DOM-tag-008 | `TagRelocationPolicy` ドメインサービス | `spec/domains/tag.md#ドメインサービス` | 移動先の同名 Tag への付替えと drop を決定する |
| DOM-tag-009 | `TagRepository.insert` | `spec/domains/tag.md#ポート` | 新規 Tag を保存する |
| DOM-tag-010 | `TagRepository.findById` | `spec/domains/tag.md#ポート` | TagId で OCC token 付き Tag を取得する |
| DOM-tag-011 | `TagRepository.save` | `spec/domains/tag.md#ポート` | 期待版一致時だけ Tag を更新する |
| DOM-tag-012 | `TagRepository.delete` | `spec/domains/tag.md#ポート` | 期待版一致時だけ Tag を削除する |
| DOM-tag-013 | `TagRepository.findByScopeAndName` | `spec/domains/tag.md#ポート` | scope と normalized name で Tag を取得する |
| DOM-tag-014 | `TagRepository.listByScope` | `spec/domains/tag.md#ポート` | scope 内の Tag を列挙する |
| DOM-tag-015 | `TagRepository.listByIds` | `spec/domains/tag.md#ポート` | 複数 TagId の Tag を取得する |
| DOM-tag-016 | `TagRepository.deleteByScope` | `spec/domains/tag.md#ポート` | assignment なし Tag を scope 内で有界削除する |
| DOM-tag-017 | `TagRepository.deleteUnusedInScope` | `spec/domains/tag.md#ポート` | 未使用・unlocked Tag を原子的に有界削除し ID を返す |
| DOM-tag-018 | `TagAssignmentRepository.insert` | `spec/domains/tag.md#ポート` | 不変な TagAssignment を保存する |
| DOM-tag-019 | `TagAssignmentRepository.findByTagAndNote` | `spec/domains/tag.md#ポート` | tag・note の assignment を取得する |
| DOM-tag-020 | `TagAssignmentRepository.listByNote` | `spec/domains/tag.md#ポート` | ノートの assignment を列挙する |
| DOM-tag-021 | `TagAssignmentRepository.listByNotes` | `spec/domains/tag.md#ポート` | 複数ノートの assignment を列挙する |
| DOM-tag-022 | `TagAssignmentRepository.listByTag` | `spec/domains/tag.md#ポート` | noteId 昇順の keyset page を最大 limit 件返す |
| DOM-tag-023 | `TagAssignmentRepository.countByNote` | `spec/domains/tag.md#ポート` | ノートの assignment 数を返す |
| DOM-tag-024 | `TagAssignmentRepository.delete` | `spec/domains/tag.md#ポート` | AssignmentId の行を削除する |
| DOM-tag-025 | `TagAssignmentRepository.deleteBatchByTag` | `spec/domains/tag.md#ポート` | tag の assignment を有界削除し影響行を返す |
| DOM-tag-026 | `TagAssignmentRepository.deleteByScope` | `spec/domains/tag.md#ポート` | scope の assignment を有界削除する |
| DOM-tag-027 | `TagAssignmentRepository.deleteByNote` | `spec/domains/tag.md#ポート` | note の assignment を有界削除する |
| DOM-tag-028 | `TagAssignmentRepository.reassignBatch` | `spec/domains/tag.md#ポート` | assignment を衝突処理込みで有界付替えし影響 NoteId を返す |
| DOM-tag-029 | `TagOperationStore.startDelete` | `spec/domains/tag.md#ポート` | delete operation と対象 lock を開始する |
| DOM-tag-030 | `TagOperationStore.startMerge` | `spec/domains/tag.md#ポート` | merge operation と両 Tag lock を開始する |
| DOM-tag-031 | `TagOperationStore.startDeleteUnused` | `spec/domains/tag.md#ポート` | unused cleanup operation を開始する |
| DOM-tag-032 | `TagOperationStore.find` | `spec/domains/tag.md#ポート` | operation の進捗・状態を取得する |
| DOM-tag-033 | `TagOperationStore.assertUnlocked` | `spec/domains/tag.md#ポート` | 指定 Tag 群に operation lock がないことを検査する |
| DOM-tag-034 | `TagOperationStore.addProcessed` | `spec/domains/tag.md#ポート` | operation の処理件数を加算する |
| DOM-tag-035 | `TagOperationStore.complete` | `spec/domains/tag.md#ポート` | operation を完了し lock を解放する |
| DOM-tag-036 | `TagOperationStore.markFailed` | `spec/domains/tag.md#ポート` | operation を失敗化し lock を保持する |
| DOM-tag-037 | `TagOperationStore.retryFailed` | `spec/domains/tag.md#ポート` | failed operation と task を再開する |
| DOM-tag-038 | `TagOperationStore.abortUnstarted` | `spec/domains/tag.md#ポート` | 未処理 failed operation だけを中止・解錠する |
| DOM-tag-039 | `TagQueryService.listWithUsage` | `spec/domains/tag.md#ポート` | scope の TagUsage を検索・sort・page する |
| DOM-tag-040 | `TagQueryService.suggest` | `spec/domains/tag.md#ポート` | prefix に合う候補を limit 件返す |
| DOM-integration-001 | `ConnectionId` 値オブジェクト | `spec/domains/integration.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-integration-002 | `BackupRecordId` 値オブジェクト | `spec/domains/integration.md#値オブジェクト` | 空白のみを拒否する公称 ID とする |
| DOM-integration-003 | `ProviderKind` 値オブジェクト | `spec/domains/integration.md#値オブジェクト` | openrouter・googleDrive のみを表す |
| DOM-integration-004 | `EncryptedSecret` 値オブジェクト | `spec/domains/integration.md#値オブジェクト` | 空でない cipher text と key version を保持し記録不能にする |
| DOM-integration-005 | `DriveFolderRef` 値オブジェクト | `spec/domains/integration.md#値オブジェクト` | 空でない folder ID と表示名を保持する |
| DOM-integration-006 | `ModelPreference` 値オブジェクト | `spec/domains/integration.md#値オブジェクト` | 3 用途の model ID を各 1〜200 文字で保持する |
| DOM-integration-007 | `ExternalFileRef` 値オブジェクト | `spec/domains/integration.md#値オブジェクト` | 空でない external file ID と view URL を保持する |
| DOM-integration-008 | `ExternalConnection` エンティティ | `spec/domains/integration.md#エンティティ` | active・expired と provider 固有 setting・credential 廃棄を型で保つ |
| DOM-integration-009 | `BackupRecord` エンティティ | `spec/domains/integration.md#エンティティ` | note・source file の外部参照・owner・checksum を一意に記録する |
| DOM-integration-010 | `CredentialResolver` ドメインサービス | `spec/domains/integration.md#ドメインサービス` | decrypt・refresh・touch・expired 遷移を resolved union で返す |
| DOM-integration-011 | `BackupPlanner` ドメインサービス | `spec/domains/integration.md#ドメインサービス` | 記録・checksum・requester から upload・replace・skip を決める |
| DOM-integration-012 | `ExternalConnectionRepository.insert` | `spec/domains/integration.md#ポート` | 新規 ExternalConnection を保存する |
| DOM-integration-013 | `ExternalConnectionRepository.findById` | `spec/domains/integration.md#ポート` | ConnectionId で OCC token 付き集約を取得する |
| DOM-integration-014 | `ExternalConnectionRepository.save` | `spec/domains/integration.md#ポート` | 期待版一致時だけ connection を更新する |
| DOM-integration-015 | `ExternalConnectionRepository.delete` | `spec/domains/integration.md#ポート` | 期待版一致時だけ connection を削除する |
| DOM-integration-016 | `ExternalConnectionRepository.findByUserAndProvider` | `spec/domains/integration.md#ポート` | 利用者・provider の connection を取得する |
| DOM-integration-017 | `ExternalConnectionRepository.listByUser` | `spec/domains/integration.md#ポート` | 利用者の connection を列挙する |
| DOM-integration-018 | `ExternalConnectionRepository.deleteByUser` | `spec/domains/integration.md#ポート` | 利用者の connection を有界削除する |
| DOM-integration-019 | `BackupRecordRepository.insert` | `spec/domains/integration.md#ポート` | 新規 BackupRecord を保存する |
| DOM-integration-020 | `BackupRecordRepository.findById` | `spec/domains/integration.md#ポート` | BackupRecordId で OCC token 付き集約を取得する |
| DOM-integration-021 | `BackupRecordRepository.save` | `spec/domains/integration.md#ポート` | 期待版一致時だけ BackupRecord を更新する |
| DOM-integration-022 | `BackupRecordRepository.delete` | `spec/domains/integration.md#ポート` | 期待版一致時だけ BackupRecord を削除する |
| DOM-integration-023 | `BackupRecordRepository.findByNoteAndFile` | `spec/domains/integration.md#ポート` | note・source file の記録を取得する |
| DOM-integration-024 | `BackupRecordRepository.listByNotes` | `spec/domains/integration.md#ポート` | 複数ノートの backup 記録を列挙する |
| DOM-integration-025 | `BackupRecordRepository.deleteByNote` | `spec/domains/integration.md#ポート` | ノートの記録を有界削除する |
| DOM-integration-026 | `BackupRecordRepository.deleteByUser` | `spec/domains/integration.md#ポート` | current scope 内の利用者記録を有界削除する |
| DOM-integration-027 | `SecretCipher.encrypt` | `spec/domains/integration.md#ポート` | plain secret を現行 key version で暗号化する |
| DOM-integration-028 | `SecretCipher.decrypt` | `spec/domains/integration.md#ポート` | 保存 key version を使って secret を復号する |
| DOM-integration-029 | `SecretCipher.currentKeyVersion` | `spec/domains/integration.md#ポート` | 新規暗号化に使う現在の key version を返す |
| DOM-integration-030 | `IntegrationOAuthClient.buildAuthorizationUrl` | `spec/domains/integration.md#ポート` | scopes・PKCE・login hint を含む認可 URL を作る |
| DOM-integration-031 | `IntegrationOAuthClient.exchangeCode` | `spec/domains/integration.md#ポート` | code を issued credential に交換する |
| DOM-integration-032 | `IntegrationOAuthClient.revoke` | `spec/domains/integration.md#ポート` | provider の access token を失効させる |
| DOM-integration-033 | `TokenRefresher.refresh` | `spec/domains/integration.md#ポート` | refresh token を新しい issued credential に交換する |
| DOM-integration-034 | `ConnectionProbe.probe` | `spec/domains/integration.md#ポート` | credential の疎通と account label を検査する |
| DOM-integration-035 | `LlmModelCatalog.list` | `spec/domains/integration.md#ポート` | access token で利用可能 model 情報を列挙する |
| DOM-integration-036 | `CloudDriveClient.ensureFolder` | `spec/domains/integration.md#ポート` | folder がなければ作り直し参照を返す |
| DOM-integration-037 | `CloudDriveClient.listFolders` | `spec/domains/integration.md#ポート` | parent 配下の folder を列挙する |
| DOM-integration-038 | `CloudDriveClient.upload` | `spec/domains/integration.md#ポート` | stream を folder へ upload し外部参照を返す |
| DOM-integration-039 | `CloudDriveClient.download` | `spec/domains/integration.md#ポート` | external file を stream で取得する |
| DOM-integration-040 | `CloudDriveClient.headFile` | `spec/domains/integration.md#ポート` | external file の size・MIME または不存在を返す |
| DOM-job-001 | `JobId` 値オブジェクト | `spec/domains/job.md#値オブジェクト` | scope prefix を埋め込み外部 I/O なしで route 可能にする |
| DOM-job-002 | `JobKind` 値オブジェクト | `spec/domains/job.md#値オブジェクト` | 11 種の登録経路 kind を限定する |
| DOM-job-003 | `JobTarget` 値オブジェクト | `spec/domains/job.md#値オブジェクト` | note・storedFile・batch target を判別可能 union で表す |
| DOM-job-004 | `JobProgress` 値オブジェクト | `spec/domains/job.md#値オブジェクト` | 0 <= completed <= total と ratio を保証する |
| DOM-job-005 | `JobFailure` 値オブジェクト | `spec/domains/job.md#値オブジェクト` | 利用者向け reason と運用者向け detail を分離する |
| DOM-job-006 | `JobNotice` 値オブジェクト | `spec/domains/job.md#値オブジェクト` | 成功時の visibilityNotApplied 申し送りだけを表す |
| DOM-job-007 | `JobPayload` 値オブジェクト | `spec/domains/job.md#値オブジェクト` | kind ごとの必須 payload 形を判別可能 union で表す |
| DOM-job-008 | `ArtifactRef` 値オブジェクト | `spec/domains/job.md#値オブジェクト` | StoredFileId と生成時刻より後の期限を保持する |
| DOM-job-009 | `AttemptCount` 値オブジェクト | `spec/domains/job.md#値オブジェクト` | 0 以上整数と自動試行上限 3 を判定する |
| DOM-job-010 | `Job` エンティティ | `spec/domains/job.md#エンティティ` | queued・running・terminal、lease、batch reopen、匿名帰属の合法遷移を保つ |
| DOM-job-011 | `BatchProgressCalculator` ドメインサービス | `spec/domains/job.md#ドメインサービス` | 子結果から親 progress・terminal・readyToAssemble を決める |
| DOM-job-012 | `JobConcurrencyPolicy` ドメインサービス | `spec/domains/job.md#ドメインサービス` | duplicate target と利用者単位 bulkExport slot を検査する |
| DOM-job-013 | `JobRepository.insert` | `spec/domains/job.md#ポート` | 新規 Job を保存する |
| DOM-job-014 | `JobRepository.findById` | `spec/domains/job.md#ポート` | JobId で OCC token 付き Job を取得する |
| DOM-job-015 | `JobRepository.save` | `spec/domains/job.md#ポート` | 期待版一致時だけ Job を更新する |
| DOM-job-016 | `JobRepository.delete` | `spec/domains/job.md#ポート` | 期待版一致時だけ Job を削除する |
| DOM-job-017 | `JobRepository.listByRequester` | `spec/domains/job.md#ポート` | requester の current scope Job を条件付きページングする |
| DOM-job-018 | `JobRepository.listChildren` | `spec/domains/job.md#ポート` | 親の子 Job をページングする |
| DOM-job-019 | `JobRepository.listActiveByTarget` | `spec/domains/job.md#ポート` | target の未終端 Job を有界列挙する |
| DOM-job-020 | `JobRepository.listActiveByRequester` | `spec/domains/job.md#ポート` | requester の未終端 Job を有界列挙する |
| DOM-job-021 | `JobRepository.listActiveByRequesterAndKinds` | `spec/domains/job.md#ポート` | requester・kind 群の未終端 Job を有界列挙する |
| DOM-job-022 | `JobRepository.listActiveByScope` | `spec/domains/job.md#ポート` | scope の未終端 Job を有界列挙する |
| DOM-job-023 | `JobRepository.listExpiredRunning` | `spec/domains/job.md#ポート` | lease 失効 running Job を有界列挙する |
| DOM-job-024 | `JobRepository.summarizeChildren` | `spec/domains/job.md#ポート` | 親 1 件の子現況を集計する |
| DOM-job-025 | `JobRepository.summarizeChildrenOf` | `spec/domains/job.md#ポート` | 複数親の子現況をまとめて集計する |
| DOM-job-026 | `JobRepository.listRemovableRoots` | `spec/domains/job.md#ポート` | cutoff 前の削除可能 root を有界列挙する |
| DOM-job-027 | `JobRepository.listRemovableRootsByRequester` | `spec/domains/job.md#ポート` | requester の削除可能 root を有界列挙する |
| DOM-job-028 | `JobRepository.claimFamilyForRemoval` | `spec/domains/job.md#ポート` | expected version で root family removal を claim する |
| DOM-job-029 | `JobRepository.assertFamilyMutable` | `spec/domains/job.md#ポート` | root family が removal 中でないことを検査する |
| DOM-job-030 | `JobRepository.deleteFamilyPage` | `spec/domains/job.md#ポート` | claim owner を検査し子から family を有界削除する |
| DOM-job-031 | `JobHistoryQueryService.listByRequester` | `spec/domains/job.md#ポート` | global history shard から requester の履歴をページングする |
| DOM-job-032 | `JobHistoryQueryService.findById` | `spec/domains/job.md#ポート` | requester と JobId で履歴詳細を取得する |
| DOM-job-033 | `JobHistoryProjectionWriter.upsertIfNewer` | `spec/domains/job.md#ポート` | source version が新しく tombstone がなければ履歴を upsert する |
| DOM-job-034 | `JobHistoryProjectionWriter.tombstoneAndRemove` | `spec/domains/job.md#ポート` | removal tombstone 保存と履歴削除を原子的に行う |
| DOM-job-035 | `JobHistoryProjectionWriter.markTargetRemoved` | `spec/domains/job.md#ポート` | route の target label を削除済みにする |
| DOM-job-036 | `JobHistoryProjectionWriter.pruneRemovalTombstones` | `spec/domains/job.md#ポート` | 期限切れ removal tombstone を keyset で回収する |
| DOM-job-037 | `JobTargetHistoryRouteStore.registerBeforeHistory` | `spec/domains/job.md#ポート` | history 前に reverse route を冪等登録し tombstone 状態を返す |
| DOM-job-038 | `JobTargetHistoryRouteStore.tombstoneTargetBeforeFanOut` | `spec/domains/job.md#ポート` | fan-out 前に target tombstone を保存する |
| DOM-job-039 | `JobTargetHistoryRouteStore.listByTarget` | `spec/domains/job.md#ポート` | target の history route を keyset で列挙する |
| DOM-job-040 | `JobTargetHistoryRouteStore.tombstoneRoute` | `spec/domains/job.md#ポート` | 個別 route tombstone を冪等保存する |
| DOM-job-041 | `JobTargetHistoryRouteStore.pruneExpiredTombstones` | `spec/domains/job.md#ポート` | 期限切れ route・target tombstone を有界回収する |
| DOM-job-042 | `JobRemovalManifestStore.beginOrResume` | `spec/domains/job.md#ポート` | family removal manifest を開始・再開・親 operation attach する |
| DOM-job-043 | `JobRemovalManifestStore.appendPage` | `spec/domains/job.md#ポート` | Job route page と cursor を manifest に固定する |
| DOM-job-044 | `JobRemovalManifestStore.markReady` | `spec/domains/job.md#ポート` | manifest を対象固定済みにする |
| DOM-job-045 | `JobRemovalManifestStore.listUnacknowledged` | `spec/domains/job.md#ポート` | 未 ack history route を有界列挙する |
| DOM-job-046 | `JobRemovalManifestStore.acknowledge` | `spec/domains/job.md#ポート` | JobId 群の global cleanup 完了を記録する |
| DOM-job-047 | `JobRemovalManifestStore.markCompleted` | `spec/domains/job.md#ポート` | item が空の manifest を完了化する |
| DOM-job-048 | `JobRemovalManifestStore.compactItems` | `spec/domains/job.md#ポート` | ack 済み item を有界縮約する |
| DOM-job-049 | `JobRemovalManifestStore.hasIncompleteByRequester` | `spec/domains/job.md#ポート` | requester に未完了 manifest があるか返す |
| DOM-job-050 | `JobRemovalManifestStore.pruneExpiredHeaders` | `spec/domains/job.md#ポート` | 期限切れ完了 header を有界回収する |
| DOM-job-051 | `JobSlotStore.reserve` | `spec/domains/job.md#ポート` | 利用者の bulkExport slot を条件付き原子予約する |
| DOM-job-052 | `JobSlotStore.attach` | `spec/domains/job.md#ポート` | operation slot を作成済み JobId に結び付ける |
| DOM-job-053 | `JobSlotStore.release` | `spec/domains/job.md#ポート` | bulkExport slot を JobId で解放する |
| DOM-job-054 | `ScopeJobAdmissionStore.tryAcquire` | `spec/domains/job.md#ポート` | current scope の同時実行上限内なら lease slot を取得する |
| DOM-job-055 | `ScopeJobAdmissionStore.renew` | `spec/domains/job.md#ポート` | Job admission lease を更新する |
| DOM-job-056 | `ScopeJobAdmissionStore.release` | `spec/domains/job.md#ポート` | Job admission slot を解放する |
| DOM-job-057 | `ScopeJobAdmissionStore.releaseExpired` | `spec/domains/job.md#ポート` | 期限切れ admission slot を有界解放し JobId を返す |
| DOM-job-058 | `JobDispatcher.dispatch` | `spec/domains/job.md#ポート` | scope・JobId・kind を at-least-once 実行系へ送る |
| DOM-usage-001 | `QuotaSubject` 値オブジェクト | `spec/domains/usage.md#値オブジェクト` | user・workspace の quota 帰属を表す |
| DOM-usage-002 | `ByteQuota` 値オブジェクト | `spec/domains/usage.md#値オブジェクト` | 正整数上限と subject 別 5 GiB・20 GiB 既定値を持つ |
| DOM-usage-003 | `LlmCallQuota` 値オブジェクト | `spec/domains/usage.md#値オブジェクト` | 0 以上の月間 call 上限と利用者 300 回既定値を持つ |
| DOM-usage-004 | `BillingPeriod` 値オブジェクト | `spec/domains/usage.md#値オブジェクト` | UTC の年・1〜12 月を表し等価比較する |
| DOM-usage-005 | `UsageWarningLevel` 値オブジェクト | `spec/domains/usage.md#値オブジェクト` | 消費率から none・warning・exceeded を表す |
| DOM-usage-006 | `StorageQuota` エンティティ | `spec/domains/usage.md#エンティティ` | bytes・note count・limit の増減と、スキャン結果を正本として消費量・ノート数を上書きする `replaceTotals`、残量、警告、保存可否を保つ |
| DOM-usage-007 | `LlmUsage` エンティティ | `spec/domains/usage.md#エンティティ` | user・period の call 消費、残量、警告、呼出可否を保つ |
| DOM-usage-008 | `QuotaEnforcement` ドメインサービス | `spec/domains/usage.md#ドメインサービス` | upload 前の storage・LLM quota 検査と表示 snapshot をまとめる |
| DOM-usage-009 | `StorageQuotaRepository.find` | `spec/domains/usage.md#ポート` | QuotaSubject の OCC token 付き quota を取得する |
| DOM-usage-010 | `StorageQuotaRepository.insert` | `spec/domains/usage.md#ポート` | 新規 StorageQuota を保存する |
| DOM-usage-011 | `StorageQuotaRepository.save` | `spec/domains/usage.md#ポート` | 期待版一致時だけ StorageQuota を更新する |
| DOM-usage-012 | `StorageQuotaRepository.listBySubjects` | `spec/domains/usage.md#ポート` | 複数 subject の quota を列挙する |
| DOM-usage-013 | `StorageQuotaRepository.delete` | `spec/domains/usage.md#ポート` | subject の StorageQuota を削除する |
| DOM-usage-014 | `LlmUsageRepository.find` | `spec/domains/usage.md#ポート` | user・period の OCC token 付き usage を取得する |
| DOM-usage-015 | `LlmUsageRepository.insert` | `spec/domains/usage.md#ポート` | 新規 LlmUsage を保存する |
| DOM-usage-016 | `LlmUsageRepository.save` | `spec/domains/usage.md#ポート` | 期待版一致時だけ LlmUsage を更新する |
| DOM-usage-017 | `LlmUsageRepository.deleteByUser` | `spec/domains/usage.md#ポート` | 利用者の usage を有界削除する |

