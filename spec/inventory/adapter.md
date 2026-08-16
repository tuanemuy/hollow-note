# Inventory — adapter

生成元: `spec/domains/`（最終同期: 2026-08-16）

**1 行 = 1 ポートメソッド**。適合スイートのケースは行にせず、ケース名（`it` の第 1 引数）の先頭に ADP ID を置く命名規約で追う（複数メソッドを拘束するケースは ID を短縮せず並べる）。**新規ポートメソッドには通常どおり採番し、各群の末尾に足す（ID は行位置ではない）**（[ADR 052](../adr/052-adapter-inventory-granularity.md)）。同じポートメソッドの ADP 行と `domain.md` の DOM 行が食い違う場合、そろえるのは片側の主張が本文に由来するときだけとする（[ADR 059](../adr/059-ledger-row-asymmetry.md)）。

| ID | 要素 | 定義場所 | 実装されるべき振る舞いの要点 |
| --- | --- | --- | --- |
| ADP-common-001 | `ScopeRouter.forScope` | `spec/domains/index.md#ScopeKey-と永続化境界` | ScopeKey に対応する scope handle を返す |
| ADP-common-002 | `ScopeRouter.resolveNote` | `spec/domains/index.md#ScopeKey-と永続化境界` | NoteId の現在 scope と route version を解決する |
| ADP-common-003 | `ScopeUnitOfWorkProvider.run` | `spec/domains/index.md#ScopeKey-と永続化境界` | 指定 scope の単一 UoW でコールバックを実行する |
| ADP-common-004 | `ScopeCleanupAdmissionStore.assertWritable` | `spec/domains/index.md#ScopeKey-と永続化境界` | current scope の通常書き込み可否を検査する |
| ADP-common-005 | `ScopeCleanupAdmissionStore.assertActorWritable` | `spec/domains/index.md#ScopeKey-と永続化境界` | actor の削除・除名準備ロックを含め書き込み可否を検査する |
| ADP-common-006 | `ScopeCleanupAdmissionStore.beginPersonalAccountDeletion` | `spec/domains/index.md#ScopeKey-と永続化境界` | 個人 scope の削除 barrier を operation 単位で開始する |
| ADP-common-007 | `ScopeCleanupAdmissionStore.abortPersonalAccountDeletion` | `spec/domains/index.md#ScopeKey-と永続化境界` | 同じ owner operation の個人削除 barrier を解除する |
| ADP-common-008 | `ScopeCleanupAdmissionStore.assertOwner` | `spec/domains/index.md#ScopeKey-と永続化境界` | cleanup operation の所有権を検査し、別 ID・欠落・未 commit に加えて完了済みの barrier も拒否する |
| ADP-common-009 | `ScopeCleanupAdmissionStore.acknowledgePersonalComponent` | `spec/domains/index.md#ScopeKey-と永続化境界` | 個人 cleanup component の完了を記録する |
| ADP-common-010 | `ScopeCleanupAdmissionStore.markCompleted` | `spec/domains/index.md#ScopeKey-と永続化境界` | 全 component 完了後に barrier を保持期限付きで完了化する |
| ADP-common-011 | `ScopeCleanupAdmissionStore.pruneCompleted` | `spec/domains/index.md#ScopeKey-と永続化境界` | 期限切れ完了 barrier を有界に回収する |
| ADP-common-012 | `AccountDeletionManifestStore.begin` | `spec/domains/index.md#ScopeKey-と永続化境界` | account deletion manifest を冪等に開始する。再投入された `begin` は既に記録済みのものをすべて保つ |
| ADP-common-013 | `AccountDeletionManifestStore.appendMembershipPage` | `spec/domains/index.md#ScopeKey-と永続化境界` | membership edge を有界ページで manifest に固定する |
| ADP-common-014 | `AccountDeletionManifestStore.appendAuthorRoutePage` | `spec/domains/index.md#ScopeKey-と永続化境界` | author route ページを cursor と原子的に固定する |
| ADP-common-015 | `AccountDeletionManifestStore.markBuilt` | `spec/domains/index.md#ScopeKey-と永続化境界` | 対象固定済みへ遷移する |
| ADP-common-016 | `AccountDeletionManifestStore.beginRollback` | `spec/domains/index.md#ScopeKey-と永続化境界` | prepare rejection 後の rollback を開始する |
| ADP-common-017 | `AccountDeletionManifestStore.claimPending` | `spec/domains/index.md#ScopeKey-と永続化境界` | 指定 phase の未処理 item を最大 limit 件 claim する。membership item は prepare ack だけでは完了せず、cleanup phase でも claim できる |
| ADP-common-018 | `AccountDeletionManifestStore.acknowledge` | `spec/domains/index.md#ScopeKey-と永続化境界` | item phase の完了を冪等に記録する |
| ADP-common-019 | `AccountDeletionManifestStore.acknowledgeReceipt` | `spec/domains/index.md#ScopeKey-と永続化境界` | 配備が宣言した global・personal receipt の完了を記録する。receipt が全部そろっても item の完全 ack を代替しない |
| ADP-common-020 | `AccountDeletionManifestStore.allRollbackReleased` | `spec/domains/index.md#ScopeKey-と永続化境界` | 固定済み membership item の release ack がすべてそろったかを判定する。`personalAbort` receipt は判定対象に含まない（利用者を `active` へ戻す復帰ゲートは述語より強く、ユースケース側が持つ — ADR 053） |
| ADP-common-021 | `AccountDeletionManifestStore.allRequiredAcknowledged` | `spec/domains/index.md#ScopeKey-と永続化境界` | 固定済み全 item の完全 ack と宣言された全 receipt の両方がそろって初めて true にする。membership item は cleanup レーンが ack して初めて完全 ack になるので、prepare ack ＋ 宣言 receipt だけでは true にならない |
| ADP-common-022 | `AccountDeletionManifestStore.compactItems` | `spec/domains/index.md#ScopeKey-と永続化境界` | ack 済み item を有界に縮約する |
| ADP-common-023 | `AccountDeletionManifestStore.markCompleted` | `spec/domains/index.md#ScopeKey-と永続化境界` | 成功した manifest を終端・保持期限付きにする |
| ADP-common-024 | `AccountDeletionManifestStore.markRejected` | `spec/domains/index.md#ScopeKey-と永続化境界` | rejection manifest を終端・保持期限付きにする |
| ADP-common-025 | `AccountDeletionManifestStore.pruneTerminal` | `spec/domains/index.md#ScopeKey-と永続化境界` | 期限切れ terminal manifest を keyset で回収し、件数ではなく回収した operationId 列を返す |
| ADP-common-026 | `GlobalMaintenanceRunStore.beginOrResumeKind` | `spec/domains/index.md#ScopeKey-と永続化境界` | kind ごとの最古 run を開始または再開し lease 状態を返す |
| ADP-common-027 | `GlobalMaintenanceRunStore.claimLanes` | `spec/domains/index.md#ScopeKey-と永続化境界` | maintenance lane を有界に claim する |
| ADP-common-028 | `GlobalMaintenanceRunStore.checkpointLane` | `spec/domains/index.md#ScopeKey-と永続化境界` | cursor と次 command key を原子的に checkpoint する |
| ADP-common-029 | `GlobalMaintenanceRunStore.advanceOrAck` | `spec/domains/index.md#ScopeKey-と永続化境界` | lane を進め、shard または run 完了を返す |
| ADP-common-030 | `GlobalMaintenanceRunStore.recoverLease` | `spec/domains/index.md#ScopeKey-と永続化境界` | 失効した run lease を owner が回収する |
| ADP-common-031 | `GlobalMaintenanceRunStore.pruneCompleted` | `spec/domains/index.md#ScopeKey-と永続化境界` | 期限切れ completed run を keyset で回収する |
| ADP-common-032 | `MailSender.send` | `spec/domains/index.md#MailSenderapplicationportsmailsenderts` | locale と template を指定してメールを送る |
| ADP-common-033 | `TimeZoneResolver.monthRange` | `spec/domains/index.md#TimeZoneResolverapplicationportstimeZoneResolverts` | 暦月を time zone 上の半開区間へ変換する |
| ADP-common-034 | `TimeZoneResolver.monthOf` | `spec/domains/index.md#TimeZoneResolverapplicationportstimeZoneResolverts` | instant が属する time zone 上の暦月を返す |
| ADP-common-035 | `TimeZoneResolver.dayKey` | `spec/domains/index.md#TimeZoneResolverapplicationportstimeZoneResolverts` | instant の現地日を YYYY-MM-DD で返す |
| ADP-common-036 | `OAuthStateStore.put` | `spec/domains/index.md#OAuthStateStoreapplicationportsoauthStateStorets` | OAuth state を TTL 付きで保存する |
| ADP-common-037 | `OAuthStateStore.take` | `spec/domains/index.md#OAuthStateStoreapplicationportsoauthStateStorets` | state を原子的に取得・削除する |
| ADP-common-038 | `OAuthStateStore.deleteExpired` | `spec/domains/index.md#OAuthStateStoreapplicationportsoauthStateStorets` | 期限切れ state を cursor と limit で回収する |
| ADP-common-039 | `IdempotencyStore.markProcessed` | `spec/domains/index.md#IdempotencyStoreapplicationportsidempotencyStorets` | consumer と EventId を原子的に記録し重複なら false を返す |
| ADP-common-040 | `ScopeCleanupAdmissionStore.describePersonalCleanup` | `spec/domains/index.md#ScopeKey-と永続化境界` | personal barrier がまだ running か・どの component が ack 済みかを読み、receipt が無い場合と別 operation が scope を持つ場合は null を返す |
| ADP-common-041 | `AccountDeletionManifestStore.describe` | `spec/domains/index.md#ScopeKey-と永続化境界` | manifest header の読み取り射影（2 つの build cursor と所有 user）を返し、既に消えていれば null を返す |
| ADP-identity-001 | `UserRepository.insert` | `spec/domains/identity.md#ポート` | 新規 User を保存する |
| ADP-identity-002 | `UserRepository.findById` | `spec/domains/identity.md#ポート` | UserId で OCC token 付き User を取得する |
| ADP-identity-003 | `UserRepository.save` | `spec/domains/identity.md#ポート` | 期待版一致時だけ User を更新する |
| ADP-identity-004 | `UserRepository.delete` | `spec/domains/identity.md#ポート` | 期待版一致時だけ User を削除する |
| ADP-identity-005 | `UserBatchReader.resolveMany` | `spec/domains/identity.md#ポート` | 最大 100 UserId を shard 横断で version 付き解決し、上限超過は `SystemError(DatabaseError)` にする |
| ADP-identity-006 | `IdentityUniqueDirectory.resolve` | `spec/domains/identity.md#ポート` | 一意キーの恒久 claim を持つ UserId を解決する（`reserved` と `releasing` はどちらも null に見える） |
| ADP-identity-007 | `IdentityUniqueDirectory.reserve` | `spec/domains/identity.md#ポート` | email・handle・provider account を operation 単位で予約し、鍵の種類に対応する conflict で他者を弾く。奪えるのは失効した `reserved` だけで、`releasing` の鍵は奪えない |
| ADP-identity-008 | `IdentityUniqueDirectory.activate` | `spec/domains/identity.md#ポート` | 期待 User version で予約を恒久 claim へ昇格させる |
| ADP-identity-009 | `IdentityUniqueDirectory.release` | `spec/domains/identity.md#ポート` | operation の `reserved` と `releasing` の行を落とす（`active` には触れない） |
| ADP-identity-010 | `IdentityRepository.insert` | `spec/domains/identity.md#ポート` | 新規 Identity を保存する。provider account の一意性はここでは検査しない（担保は `IdentityUniqueDirectory` の claim 索引だけが持つ — ADR 054）。バックエンドが DB 側に一意制約を置くのは自由だが契約としては要求しない |
| ADP-identity-011 | `IdentityRepository.findById` | `spec/domains/identity.md#ポート` | IdentityId で OCC token 付き Identity を取得する |
| ADP-identity-012 | `IdentityRepository.save` | `spec/domains/identity.md#ポート` | 期待版一致時だけ Identity を更新する |
| ADP-identity-013 | `IdentityRepository.delete` | `spec/domains/identity.md#ポート` | 期待版一致時だけ Identity を削除する |
| ADP-identity-014 | `IdentityRepository.listByUserId` | `spec/domains/identity.md#ポート` | 利用者の認証手段を最大 8 件返す |
| ADP-identity-015 | `SessionRepository.insert` | `spec/domains/identity.md#ポート` | Session を保存する |
| ADP-identity-016 | `SessionRepository.findByTokenHash` | `spec/domains/identity.md#ポート` | UserId と token hash で Session を取得する |
| ADP-identity-017 | `SessionRepository.deleteById` | `spec/domains/identity.md#ポート` | SessionId の行を削除する |
| ADP-identity-018 | `SessionRepository.refreshAuthEpoch` | `spec/domains/identity.md#ポート` | 現在 Session だけを新 auth epoch へ追随させる |
| ADP-identity-019 | `SessionRepository.deleteOlderEpochByUser` | `spec/domains/identity.md#ポート` | 旧世代 Session を利用者単位で有界削除する |
| ADP-identity-020 | `SessionRepository.deleteExpired` | `spec/domains/identity.md#ポート` | 期限切れ Session を keyset で有界削除する |
| ADP-identity-021 | `AuthTokenRepository.insert` | `spec/domains/identity.md#ポート` | AuthToken を保存する |
| ADP-identity-022 | `AuthTokenRepository.findByTokenHash` | `spec/domains/identity.md#ポート` | UserId と hash で token を取得する |
| ADP-identity-023 | `AuthTokenRepository.save` | `spec/domains/identity.md#ポート` | pending 行だけを条件付きで consumed に更新する |
| ADP-identity-024 | `AuthTokenRepository.deleteByUserAndPurpose` | `spec/domains/identity.md#ポート` | 利用者・用途の token を有界削除する |
| ADP-identity-025 | `AuthTokenRepository.deleteOlderEpochByUser` | `spec/domains/identity.md#ポート` | 旧世代 token を利用者単位で有界削除する |
| ADP-identity-026 | `AuthTokenRepository.deleteExpired` | `spec/domains/identity.md#ポート` | 期限切れ token を keyset で有界削除する |
| ADP-identity-027 | `PasswordHasher.hash` | `spec/domains/identity.md#ポート` | PlainPassword を PasswordHash に変換する |
| ADP-identity-028 | `PasswordHasher.verify` | `spec/domains/identity.md#ポート` | 平文と hash を安全に照合する |
| ADP-identity-029 | `SecureTokenGenerator.issue` | `spec/domains/identity.md#ポート` | 256 bit 以上の token と保存用 hash を生成する |
| ADP-identity-030 | `SecureTokenGenerator.issueForUser` | `spec/domains/identity.md#ポート` | UserId locator 付き token と hash を生成する |
| ADP-identity-031 | `SecureTokenGenerator.locateUser` | `spec/domains/identity.md#ポート` | locator 形式を検証して UserId を取り出す |
| ADP-identity-032 | `SecureTokenGenerator.hashOf` | `spec/domains/identity.md#ポート` | 任意 token の保存用 hash を算出する |
| ADP-identity-033 | `SignInOAuthClient.buildAuthorizationUrl` | `spec/domains/identity.md#ポート` | PKCE・state を含む認可 URL を構築する |
| ADP-identity-034 | `SignInOAuthClient.exchangeCode` | `spec/domains/identity.md#ポート` | authorization code を OAuth profile に交換する |
| ADP-identity-035 | `LoginAttemptStore.get` | `spec/domains/identity.md#ポート` | namespaced key の失敗記録を取得する |
| ADP-identity-036 | `LoginAttemptStore.recordFailure` | `spec/domains/identity.md#ポート` | 失敗回数を単一原子操作で加算し加算後状態を返す |
| ADP-identity-037 | `LoginAttemptStore.clear` | `spec/domains/identity.md#ポート` | 認証成功時に失敗記録を削除する |
| ADP-identity-038 | `LoginAttemptStore.deleteExpired` | `spec/domains/identity.md#ポート` | 期限切れ失敗記録を keyset で有界削除する |
| ADP-identity-039 | `AuthTokenRepository.findPendingByUserAndPurpose` | `spec/domains/identity.md#ポート` | (user, purpose) 部分一意索引が保証する at-most-one live token を返し、無ければ null を返す |
| ADP-identity-040 | `SignInOAuthClient.deriveCodeChallenge` | `spec/domains/identity.md#ポート` | code verifier から PKCE S256 challenge を純粋・決定的に導く |
| ADP-identity-041 | `IdentityUniqueDirectory.beginRelease` | `spec/domains/identity.md#ポート` | normalizedKey で引いた `active` の行を `releasing` にして解放側 operation へ付け替える。`reserved`・行なし・別利用者はすべて no-op |
| ADP-workspace-001 | `WorkspaceRepository.insert` | `spec/domains/workspace.md#ポート` | 新規 Workspace を保存する |
| ADP-workspace-002 | `WorkspaceRepository.findById` | `spec/domains/workspace.md#ポート` | WorkspaceId で OCC token 付き集約を取得する |
| ADP-workspace-003 | `WorkspaceRepository.save` | `spec/domains/workspace.md#ポート` | 期待版一致時だけ Workspace を更新する |
| ADP-workspace-004 | `WorkspaceRepository.delete` | `spec/domains/workspace.md#ポート` | 期待版一致時だけ Workspace を削除する |
| ADP-workspace-005 | `UserWorkspaceDirectory.listActiveByUser` | `spec/domains/workspace.md#ポート` | 利用者の active edge を署名 keyset cursor で返す |
| ADP-workspace-006 | `WorkspaceDirectoryBatchReader.resolveMany` | `spec/domains/workspace.md#ポート` | 最大 20 WorkspaceId の directory 状態を shard 横断解決する |
| ADP-workspace-007 | `PublicWorkspaceDirectoryReader.listPublished` | `spec/domains/workspace.md#ポート` | 公開 workspace を全 shard から keyset merge する |
| ADP-workspace-008 | `MembershipRepository.insert` | `spec/domains/workspace.md#ポート` | 新規 Membership を保存する |
| ADP-workspace-009 | `MembershipRepository.findById` | `spec/domains/workspace.md#ポート` | MembershipId で OCC token 付き集約を取得する |
| ADP-workspace-010 | `MembershipRepository.save` | `spec/domains/workspace.md#ポート` | 期待版一致時だけ Membership を更新する |
| ADP-workspace-011 | `MembershipRepository.delete` | `spec/domains/workspace.md#ポート` | 期待版一致時だけ Membership を削除する |
| ADP-workspace-012 | `MembershipRepository.findByWorkspaceAndUser` | `spec/domains/workspace.md#ポート` | workspace・user の membership を取得する |
| ADP-workspace-013 | `MembershipRepository.listByWorkspace` | `spec/domains/workspace.md#ポート` | workspace の membership をページングする |
| ADP-workspace-014 | `MembershipRepository.countByRole` | `spec/domains/workspace.md#ポート` | 指定 role の人数を数える |
| ADP-workspace-015 | `MembershipRepository.deleteByIds` | `spec/domains/workspace.md#ポート` | 最大 100 MembershipId を削除する |
| ADP-workspace-016 | `InvitationRepository.insert` | `spec/domains/workspace.md#ポート` | 新規 Invitation を保存する |
| ADP-workspace-017 | `InvitationRepository.findById` | `spec/domains/workspace.md#ポート` | InvitationId で OCC token 付き集約を取得する |
| ADP-workspace-018 | `InvitationRepository.save` | `spec/domains/workspace.md#ポート` | 期待版一致時だけ Invitation を更新する |
| ADP-workspace-019 | `InvitationRepository.delete` | `spec/domains/workspace.md#ポート` | 期待版一致時だけ Invitation を削除する |
| ADP-workspace-020 | `InvitationRepository.findByTokenHash` | `spec/domains/workspace.md#ポート` | token hash で招待を取得する |
| ADP-workspace-021 | `InvitationRepository.findPendingByWorkspaceAndEmail` | `spec/domains/workspace.md#ポート` | workspace・email の pending 招待を取得する |
| ADP-workspace-022 | `InvitationRepository.listByWorkspace` | `spec/domains/workspace.md#ポート` | workspace の招待をページングする |
| ADP-workspace-023 | `InvitationRepository.countPendingIssuedSince` | `spec/domains/workspace.md#ポート` | 期間内の未処理招待数を返す |
| ADP-workspace-024 | `InvitationRepository.deleteByIds` | `spec/domains/workspace.md#ポート` | 最大 100 InvitationId を削除する |
| ADP-workspace-025 | `InvitationRouteStore.resolveActive` | `spec/domains/workspace.md#ポート` | token hash の active route を解決する |
| ADP-workspace-026 | `InvitationRouteStore.reserve` | `spec/domains/workspace.md#ポート` | 新規 token route を TTL 付き予約する |
| ADP-workspace-027 | `InvitationRouteStore.activate` | `spec/domains/workspace.md#ポート` | operation の route を有効化する |
| ADP-workspace-028 | `InvitationRouteStore.reserveReplacement` | `spec/domains/workspace.md#ポート` | 再送用の旧新 token route 交換を予約する |
| ADP-workspace-029 | `InvitationRouteStore.activateReplacement` | `spec/domains/workspace.md#ポート` | 旧新 route の交換を原子的に有効化する |
| ADP-workspace-030 | `InvitationRouteStore.abandon` | `spec/domains/workspace.md#ポート` | 未確定 token route を破棄する |
| ADP-workspace-031 | `InvitationRouteStore.revoke` | `spec/domains/workspace.md#ポート` | invitation route を取消済みにする |
| ADP-workspace-032 | `InvitationRouteStore.consume` | `spec/domains/workspace.md#ポート` | invitation route を受諾済みにする |
| ADP-workspace-033 | `MembershipDirectoryReservationStore.reserveAndClaimActivation` | `spec/domains/workspace.md#ポート` | User active 検査と pending edge activation claim を原子的に行う |
| ADP-workspace-034 | `MembershipDirectoryReservationStore.activate` | `spec/domains/workspace.md#ポート` | membership directory edge を active にする |
| ADP-workspace-035 | `MembershipDirectoryReservationStore.abandon` | `spec/domains/workspace.md#ポート` | activation edge を破棄する |
| ADP-workspace-036 | `MembershipDirectoryReservationStore.prepareAccountDeletion` | `spec/domains/workspace.md#ポート` | account deletion 用 edge prepare を開始する |
| ADP-workspace-037 | `MembershipDirectoryReservationStore.renewAccountDeletion` | `spec/domains/workspace.md#ポート` | prepare lease を更新する |
| ADP-workspace-038 | `MembershipDirectoryReservationStore.commitAccountDeletion` | `spec/domains/workspace.md#ポート` | edge removal を committed にする |
| ADP-workspace-039 | `MembershipDirectoryReservationStore.releaseAccountDeletion` | `spec/domains/workspace.md#ポート` | deletion prepare lock を解放する |
| ADP-workspace-040 | `MembershipDirectoryReservationStore.listActivatingByUser` | `spec/domains/workspace.md#ポート` | 利用者の activating edge を有界列挙する |
| ADP-workspace-041 | `MembershipRemovalPreparationStore.prepare` | `spec/domains/workspace.md#ポート` | membership version を検査して removal lock を取る |
| ADP-workspace-042 | `MembershipRemovalPreparationStore.renew` | `spec/domains/workspace.md#ポート` | removal prepare lease を更新する |
| ADP-workspace-043 | `MembershipRemovalPreparationStore.commit` | `spec/domains/workspace.md#ポート` | removal lock を committed にする |
| ADP-workspace-044 | `MembershipRemovalPreparationStore.release` | `spec/domains/workspace.md#ポート` | removal lock を解放する |
| ADP-workspace-045 | `MembershipRemovalPreparationStore.hasConflict` | `spec/domains/workspace.md#ポート` | user に有効または未回収 lock があるか返す |
| ADP-workspace-046 | `WorkspaceOperationLockStore.hasActiveMove` | `spec/domains/workspace.md#ポート` | active move lock の有無を返す |
| ADP-workspace-047 | `WorkspaceOperationLockStore.hasMoveConflict` | `spec/domains/workspace.md#ポート` | user と競合する move lock の有無を返す |
| ADP-workspace-048 | `WorkspaceOperationLockStore.beginDeletion` | `spec/domains/workspace.md#ポート` | Workspace の deletion CAS と manifest header 作成を原子的に行う |
| ADP-workspace-049 | `WorkspaceOperationLockStore.assertWritable` | `spec/domains/workspace.md#ポート` | deletion 中・削除後の通常書き込みを拒否する |
| ADP-workspace-050 | `WorkspaceOperationLockStore.assertDeletionOwner` | `spec/domains/workspace.md#ポート` | deletion worker の operation 所有権を検査する |
| ADP-workspace-051 | `WorkspaceOperationLockStore.assertMaintenanceAllowed` | `spec/domains/workspace.md#ポート` | 削除後に許可された maintenance 種別だけを通す |
| ADP-workspace-052 | `WorkspaceDeletionManifestStore.appendMembershipPage` | `spec/domains/workspace.md#ポート` | membership page と cursor を manifest に固定する |
| ADP-workspace-053 | `WorkspaceDeletionManifestStore.appendInvitationPage` | `spec/domains/workspace.md#ポート` | invitation page と cursor を manifest に固定する |
| ADP-workspace-054 | `WorkspaceDeletionManifestStore.markReady` | `spec/domains/workspace.md#ポート` | manifest を対象固定済みにする |
| ADP-workspace-055 | `WorkspaceDeletionManifestStore.listLocalPending` | `spec/domains/workspace.md#ポート` | local 未完了 item を有界列挙する |
| ADP-workspace-056 | `WorkspaceDeletionManifestStore.acknowledgeLocal` | `spec/domains/workspace.md#ポート` | local deletion 完了を記録する |
| ADP-workspace-057 | `WorkspaceDeletionManifestStore.listItems` | `spec/domains/workspace.md#ポート` | manifest item を cursor 付きで列挙する |
| ADP-workspace-058 | `WorkspaceDeletionManifestStore.acknowledge` | `spec/domains/workspace.md#ポート` | global cleanup 完了を記録する |
| ADP-workspace-059 | `WorkspaceDeletionManifestStore.compactAcknowledged` | `spec/domains/workspace.md#ポート` | local・global ack 済み item を有界縮約する |
| ADP-workspace-060 | `WorkspaceDeletionManifestStore.markCompleted` | `spec/domains/workspace.md#ポート` | item が空の manifest を完了 tombstone にする |
| ADP-storage-001 | `StoredFileRepository.insert` | `spec/domains/storage.md#ポート` | 新規 StoredFile を保存する |
| ADP-storage-002 | `StoredFileRepository.findById` | `spec/domains/storage.md#ポート` | StoredFileId で OCC token 付き集約を取得する |
| ADP-storage-003 | `StoredFileRepository.save` | `spec/domains/storage.md#ポート` | 期待版一致時だけ StoredFile を更新する |
| ADP-storage-004 | `StoredFileRepository.delete` | `spec/domains/storage.md#ポート` | 期待版一致時だけ StoredFile を削除する |
| ADP-storage-005 | `StoredFileRepository.listByIds` | `spec/domains/storage.md#ポート` | current scope の複数 file を ID で取得する |
| ADP-storage-006 | `StoredFileRepository.listByNote` | `spec/domains/storage.md#ポート` | ノートに属する全 file metadata を返す |
| ADP-storage-007 | `StoredFileRepository.listDeletableByNote` | `spec/domains/storage.md#ポート` | ノート削除対象 file を有界列挙する |
| ADP-storage-008 | `StoredFileRepository.findArtifactByNoteAndVersion` | `spec/domains/storage.md#ポート` | 有効期限内の同版 artifact を取得する |
| ADP-storage-009 | `StoredFileRepository.listExpired` | `spec/domains/storage.md#ポート` | 期限切れ ephemeral file を有界列挙する |
| ADP-storage-010 | `StoredFileRepository.listByPurposeOlderThan` | `spec/domains/storage.md#ポート` | current scope の用途・作成時刻で file を有界列挙する |
| ADP-storage-011 | `StoredFileRepository.sumSizeByOwner` | `spec/domains/storage.md#ポート` | artifact を除く owner の使用容量を合計する |
| ADP-storage-012 | `StoredFileRepository.listByOwner` | `spec/domains/storage.md#ポート` | owner と用途で file をページングする |
| ADP-storage-013 | `ReferenceImportRecordRepository.saveAttempts` | `spec/domains/storage.md#ポート` | 取得試行を note・URL キーで上書き保存する |
| ADP-storage-014 | `ReferenceImportRecordRepository.putSummary` | `spec/domains/storage.md#ポート` | ノート単位の最新取り込み要約を保存する |
| ADP-storage-015 | `ReferenceImportRecordRepository.listAttemptsByNote` | `spec/domains/storage.md#ポート` | ノートの取得試行記録を返す |
| ADP-storage-016 | `ReferenceImportRecordRepository.findSummaryByNote` | `spec/domains/storage.md#ポート` | ノートの最新取り込み要約を取得する |
| ADP-storage-017 | `ReferenceImportRecordRepository.deleteByNote` | `spec/domains/storage.md#ポート` | attempt と summary を合わせて有界削除する |
| ADP-storage-018 | `ObjectStorage.put` | `spec/domains/storage.md#ポート` | バイト列だけを受けて保存し実サイズと checksum を測って返す。既存 key は上書きする（ストリーム受けは契約に持たない） |
| ADP-storage-019 | `ObjectStorage.get` | `spec/domains/storage.md#ポート` | バイト列と metadata を持つ `ObjectBody` を取得し、未知の key では null を返す |
| ADP-storage-020 | `ObjectStorage.deleteMany` | `spec/domains/storage.md#ポート` | 指定 object key 群を冪等に削除し、存在しない key も許容する |
| ADP-storage-021 | `ObjectStorage.createDownloadUrl` | `spec/domains/storage.md#ポート` | file name と期限付きの download URL を発行する |
| ADP-storage-022 | `RemoteResourceFetcher.fetch` | `spec/domains/storage.md#ポート` | byte 上限と timeout を守って外部 URL を取得する |
| ADP-storage-023 | `DnsResolver.resolve` | `spec/domains/storage.md#ポート` | hostname を IP address 群へ解決する |
| ADP-storage-024 | `ObjectStorage.publicUrl` | `spec/domains/storage.md#ポート` | 公開配信してよい object の読み取り先 URL を同じ key に対して安定して組み立てる |
| ADP-conversion-001 | `FormatDetector.detect` | `spec/domains/conversion.md#ポート` | 内容と申告 MIME から形式・実 MIME・password 保護を判定する |
| ADP-conversion-002 | `FileContentReader.readBytes` | `spec/domains/conversion.md#ポート` | StoredFileId の全 bytes を読む |
| ADP-conversion-003 | `FileContentReader.readText` | `spec/domains/conversion.md#ポート` | 指定または推定 encoding で text を読む |
| ADP-conversion-004 | `FileContentReader.readHead` | `spec/domains/conversion.md#ポート` | 指定 byte 数の先頭を読む |
| ADP-conversion-005 | `MarkdownRenderer.render` | `spec/domains/conversion.md#ポート` | Markdown を HTML 断片へ変換する |
| ADP-conversion-006 | `MarkdownRenderer.toMarkdown` | `spec/domains/conversion.md#ポート` | HTML を Markdown へ変換し非表現要素は HTML で残す |
| ADP-conversion-007 | `DocumentTextExtractor.extract` | `spec/domains/conversion.md#ポート` | 文書 bytes から block と title を抽出する |
| ADP-conversion-008 | `DocumentTextExtractor.renderPages` | `spec/domains/conversion.md#ポート` | 文書を指定 page 数・DPI の画像へ描画する |
| ADP-conversion-009 | `StructuringModel.structureText` | `spec/domains/conversion.md#ポート` | credential・model・text block から HTML を構造化する |
| ADP-conversion-010 | `StructuringModel.structureImages` | `spec/domains/conversion.md#ポート` | credential・model・page image から HTML を構造化する |
| ADP-conversion-011 | `TranscriptionModel.transcribe` | `spec/domains/conversion.md#ポート` | 音声 bytes を指定 model で空でない transcript にする |
| ADP-note-001 | `HtmlProcessor.process` | `spec/domains/note.md#ポート` | ADR 013 で sanitize し本文・平文・抜粋・見出し・除去報告を返す |
| ADP-note-002 | `HtmlProcessor.extractExternalReferences` | `spec/domains/note.md#ポート` | 内部 URL を含む属性ベース参照を抽出する |
| ADP-note-003 | `HtmlProcessor.rewriteReferences` | `spec/domains/note.md#ポート` | URL 参照を置換して NoteHtml を返す |
| ADP-note-004 | `HtmlProcessor.inlineStylesheets` | `spec/domains/note.md#ポート` | stylesheet 痕跡を imported・unavailable 状態へ遷移する |
| ADP-note-005 | `HtmlProcessor.editTextNodes` | `spec/domains/note.md#ポート` | expected 一致の text node edit だけを適用し skip を返す |
| ADP-note-006 | `PdfRenderer.render` | `spec/domains/note.md#ポート` | style mode と timeout を守って本文を PDF bytes にする |
| ADP-note-007 | `NoteExportComposer.composeSelfContainedHtml` | `spec/domains/note.md#ポート` | asset を可能な範囲で埋め込んだ単一 HTML を組み立てる |
| ADP-note-008 | `NoteRepository.insert` | `spec/domains/note.md#ポート` | 新規 Note を保存する |
| ADP-note-009 | `NoteRepository.findById` | `spec/domains/note.md#ポート` | NoteId で OCC token 付き Note を取得する |
| ADP-note-010 | `NoteRepository.save` | `spec/domains/note.md#ポート` | 期待版一致時だけ Note を更新する |
| ADP-note-011 | `NoteRepository.delete` | `spec/domains/note.md#ポート` | 期待版一致時だけ Note を削除する |
| ADP-note-012 | `NoteRepository.listByIds` | `spec/domains/note.md#ポート` | current scope の複数 Note を ID で取得する |
| ADP-note-013 | `NoteRepository.listPurgeable` | `spec/domains/note.md#ポート` | purgeAfter 到来済み TrashedNote を有界列挙する |
| ADP-note-014 | `NoteRepository.countByOwner` | `spec/domains/note.md#ポート` | owner と lifecycle 条件の Note 数を返す |
| ADP-note-015 | `NoteRepository.listByOwner` | `spec/domains/note.md#ポート` | owner と lifecycle で Note を `updatedAt DESC, id DESC` の全順序でページングし、ページ境界で重複・欠落を出さない |
| ADP-note-016 | `NoteRevisionRepository.insert` | `spec/domains/note.md#ポート` | 不変な NoteRevision を保存する |
| ADP-note-017 | `NoteRevisionRepository.listByNote` | `spec/domains/note.md#ポート` | ノートの最新 revision を limit 件返す |
| ADP-note-018 | `NoteRevisionRepository.findById` | `spec/domains/note.md#ポート` | RevisionId で revision を取得する |
| ADP-note-019 | `NoteRevisionRepository.deleteOlderThanNewest` | `spec/domains/note.md#ポート` | 最新 keep 件を残し古い revision を削除する |
| ADP-note-020 | `NoteRevisionRepository.deleteByNote` | `spec/domains/note.md#ポート` | ノートの revision を全削除する |
| ADP-note-021 | `LocalNoteQueryService.search` | `spec/domains/note.md#ポート` | local projection を条件・sort・pagination で検索する。`highlightedExcerpt` は投影が持つマークアップをエスケープしてから強調を付ける |
| ADP-note-022 | `LocalNoteQueryService.listMonthsWithNotes` | `spec/domains/note.md#ポート` | owner のノートがある現地暦月を列挙する |
| ADP-note-023 | `LocalNoteQueryService.countByDay` | `spec/domains/note.md#ポート` | 半開期間を time zone の日別に集計する |
| ADP-note-024 | `LocalNoteQueryService.countByContentStatus` | `spec/domains/note.md#ポート` | owner・本文状態の Note 数を返す |
| ADP-note-025 | `PublicNoteQueryService.searchPublic` | `spec/domains/note.md#ポート` | public shard を署名 cursor で有界検索・merge する |
| ADP-note-026 | `PublicNoteQueryService.listPublicSitemapEntries` | `spec/domains/note.md#ポート` | 公開 Note sitemap entry を shard 横断列挙する |
| ADP-note-027 | `PublicNoteQueryService.listPublicAuthors` | `spec/domains/note.md#ポート` | 個人所有の公開 Note を持つ owner を重複なく列挙する |
| ADP-note-028 | `LocalNoteProjectionWriter.replaceSnapshotIfNewer` | `spec/domains/note.md#ポート` | 世代ベクトルが新しい完全 snapshot を原子的に置換する |
| ADP-note-029 | `LocalNoteProjectionWriter.remove` | `spec/domains/note.md#ポート` | Note・FTS・tag projection をすべて削除する |
| ADP-note-030 | `PublicNoteProjectionWriter.replaceSnapshotIfNewer` | `spec/domains/note.md#ポート` | route version と世代ベクトルで public snapshot を置換する |
| ADP-note-031 | `PublicNoteProjectionWriter.removeIfNewer` | `spec/domains/note.md#ポート` | route・projection revision が新しければ public 行を削除する |
| ADP-note-032 | `PublicNoteProjectionWriter.removeForPurge` | `spec/domains/note.md#ポート` | purge operation の public 削除を冪等に完了する |
| ADP-note-033 | `NoteProjectionSnapshotReader.read` | `spec/domains/note.md#ポート` | Note・tag・projection revision を同一 read transaction で返す |
| ADP-note-034 | `NoteProjectionRevisionStore.bump` | `spec/domains/note.md#ポート` | Note の projection revision を原子的に増やす |
| ADP-note-035 | `NoteRouteStore.resolve` | `spec/domains/note.md#ポート` | 外部 read 可能な Note route を解決する |
| ADP-note-036 | `NoteRouteStore.resolveMany` | `spec/domains/note.md#ポート` | 最大 500 Note route を shard 横断解決し、501 件目からは `SystemError(DatabaseError)` にする |
| ADP-note-037 | `NoteRouteStore.reserveCreate` | `spec/domains/note.md#ポート` | Note 作成 route を TTL 付き予約する |
| ADP-note-038 | `NoteRouteStore.activateCreate` | `spec/domains/note.md#ポート` | 作成 route を active にする |
| ADP-note-039 | `NoteRouteStore.abandonCreate` | `spec/domains/note.md#ポート` | 作成途中の route を破棄する |
| ADP-note-040 | `NoteRouteStore.beginMove` | `spec/domains/note.md#ポート` | expected route version で moving 状態を開始する |
| ADP-note-041 | `NoteRouteStore.abortMove` | `spec/domains/note.md#ポート` | switch 前の move route を source active へ戻す |
| ADP-note-042 | `NoteRouteStore.switchMove` | `spec/domains/note.md#ポート` | moving route を target scope へ切り替える |
| ADP-note-043 | `NoteRouteStore.beginPurge` | `spec/domains/note.md#ポート` | purge 中へ遷移して外部到達を閉じる |
| ADP-note-044 | `NoteRouteStore.abortPurge` | `spec/domains/note.md#ポート` | local 削除前の purge を active へ戻す |
| ADP-note-045 | `NoteRouteStore.finishPurge` | `spec/domains/note.md#ポート` | purge route を期限付き tombstone にする |
| ADP-note-046 | `NoteRouteFanOutReader.listByCreatedBy` | `spec/domains/note.md#ポート` | author の commit 済み route（`active` / `moving` / `purging`）を署名 cursor で shard 横断列挙し、`reserved` だけを除外する。`tombstone` は unspecified で、失効まで残しても物理的に回収してもよい |
| ADP-note-047 | `NoteRouteFanOutReader.listByScope` | `spec/domains/note.md#ポート` | scope の commit 済み route（`active` / `moving` / `purging`）を署名 cursor で shard 横断列挙し、`reserved` だけを除外する。`tombstone` は unspecified で、失効まで残しても物理的に回収してもよい |
| ADP-note-048 | `ShareTokenProtector.protect` | `spec/domains/note.md#ポート` | share token を現行版鍵で暗号化する。失敗は `SystemError(DataIntegrityError)` |
| ADP-note-049 | `ShareTokenProtector.reveal` | `spec/domains/note.md#ポート` | 保存 key version の鍵で share token を復号する。未知の keyVersion・ciphertext の破損は `SystemError(DataIntegrityError)` |
| ADP-note-050 | `NoteMovePort.freezeSource` | `spec/domains/note.md#ポート` | source を再認可して move snapshot を固定する |
| ADP-note-051 | `NoteMovePort.stageTarget` | `spec/domains/note.md#ポート` | target を再認可し snapshot を冪等 stage する |
| ADP-note-052 | `NoteMovePort.activateTarget` | `spec/domains/note.md#ポート` | staged target を指定 route version で有効化する |
| ADP-note-053 | `NoteMovePort.retireSource` | `spec/domains/note.md#ポート` | switch 後の source データを退役させる |
| ADP-note-054 | `NoteMovePort.abortBeforeSwitch` | `spec/domains/note.md#ポート` | switch 前の target credit・stage・lock・freeze を冪等に戻す |
| ADP-note-055 | `LocalNoteProjectionWriter.redactAuthor` | `spec/domains/note.md#ポート` | 保存済みの著者表示を `redactionVersion` の退会既定値へ 1 行だけ置換し、行が変わったかを返す。行が無い / 別人が作った / 既に同世代以降はいずれも no-op |
| ADP-note-056 | `PublicNoteProjectionWriter.redactAuthor` | `spec/domains/note.md#ポート` | 保存済みの著者表示を `redactionVersion` の退会既定値へ 1 行だけ置換し、行が変わったかを返す。行が無い / 別人が作った / 既に同世代以降はいずれも no-op |
| ADP-tag-001 | `TagRepository.insert` | `spec/domains/tag.md#ポート` | 新規 Tag を保存する |
| ADP-tag-002 | `TagRepository.findById` | `spec/domains/tag.md#ポート` | TagId で OCC token 付き Tag を取得する |
| ADP-tag-003 | `TagRepository.save` | `spec/domains/tag.md#ポート` | 期待版一致時だけ Tag を更新する |
| ADP-tag-004 | `TagRepository.delete` | `spec/domains/tag.md#ポート` | 期待版一致時だけ Tag を削除する |
| ADP-tag-005 | `TagRepository.findByScopeAndName` | `spec/domains/tag.md#ポート` | scope と normalized name で Tag を取得する |
| ADP-tag-006 | `TagRepository.listByScope` | `spec/domains/tag.md#ポート` | scope 内の Tag を列挙する |
| ADP-tag-007 | `TagRepository.listByIds` | `spec/domains/tag.md#ポート` | 複数 TagId の Tag を取得する |
| ADP-tag-008 | `TagRepository.deleteByScope` | `spec/domains/tag.md#ポート` | assignment なし Tag を scope 内で有界削除する |
| ADP-tag-009 | `TagRepository.deleteUnusedInScope` | `spec/domains/tag.md#ポート` | 未使用・unlocked Tag を原子的に有界削除し ID を返す |
| ADP-tag-010 | `TagAssignmentRepository.insert` | `spec/domains/tag.md#ポート` | 不変な TagAssignment を保存する |
| ADP-tag-011 | `TagAssignmentRepository.findByTagAndNote` | `spec/domains/tag.md#ポート` | tag・note の assignment を取得する |
| ADP-tag-012 | `TagAssignmentRepository.listByNote` | `spec/domains/tag.md#ポート` | ノートの assignment を列挙する |
| ADP-tag-013 | `TagAssignmentRepository.listByNotes` | `spec/domains/tag.md#ポート` | 複数ノートの assignment を列挙する |
| ADP-tag-014 | `TagAssignmentRepository.listByTag` | `spec/domains/tag.md#ポート` | noteId 昇順の keyset page を最大 limit 件返す |
| ADP-tag-015 | `TagAssignmentRepository.countByNote` | `spec/domains/tag.md#ポート` | ノートの assignment 数を返す |
| ADP-tag-016 | `TagAssignmentRepository.delete` | `spec/domains/tag.md#ポート` | AssignmentId の行を削除する |
| ADP-tag-017 | `TagAssignmentRepository.deleteBatchByTag` | `spec/domains/tag.md#ポート` | tag の assignment を有界削除し影響行を返す |
| ADP-tag-018 | `TagAssignmentRepository.deleteByScope` | `spec/domains/tag.md#ポート` | scope の assignment を有界削除する |
| ADP-tag-019 | `TagAssignmentRepository.deleteByNote` | `spec/domains/tag.md#ポート` | note の assignment を有界削除する |
| ADP-tag-020 | `TagAssignmentRepository.reassignBatch` | `spec/domains/tag.md#ポート` | assignment を衝突処理込みで有界付替えし影響 NoteId を返す |
| ADP-tag-021 | `TagOperationStore.startDelete` | `spec/domains/tag.md#ポート` | delete operation と対象 lock を開始する |
| ADP-tag-022 | `TagOperationStore.startMerge` | `spec/domains/tag.md#ポート` | merge operation と両 Tag lock を開始する |
| ADP-tag-023 | `TagOperationStore.startDeleteUnused` | `spec/domains/tag.md#ポート` | unused cleanup operation を開始する |
| ADP-tag-024 | `TagOperationStore.find` | `spec/domains/tag.md#ポート` | operation の進捗・状態を取得する |
| ADP-tag-025 | `TagOperationStore.assertUnlocked` | `spec/domains/tag.md#ポート` | 指定 Tag 群に operation lock がないことを検査する |
| ADP-tag-026 | `TagOperationStore.addProcessed` | `spec/domains/tag.md#ポート` | operation の処理件数を加算する |
| ADP-tag-027 | `TagOperationStore.complete` | `spec/domains/tag.md#ポート` | operation を完了し lock を解放する |
| ADP-tag-028 | `TagOperationStore.markFailed` | `spec/domains/tag.md#ポート` | operation を失敗化し lock を保持する |
| ADP-tag-029 | `TagOperationStore.retryFailed` | `spec/domains/tag.md#ポート` | failed operation と task を再開する |
| ADP-tag-030 | `TagOperationStore.abortUnstarted` | `spec/domains/tag.md#ポート` | 未処理 failed operation だけを中止・解錠する |
| ADP-tag-031 | `TagQueryService.listWithUsage` | `spec/domains/tag.md#ポート` | scope の TagUsage を検索・sort・page する |
| ADP-tag-032 | `TagQueryService.suggest` | `spec/domains/tag.md#ポート` | prefix に合う候補を limit 件返す |
| ADP-integration-001 | `ExternalConnectionRepository.insert` | `spec/domains/integration.md#ポート` | 新規 ExternalConnection を保存する |
| ADP-integration-002 | `ExternalConnectionRepository.findById` | `spec/domains/integration.md#ポート` | ConnectionId で OCC token 付き集約を取得する |
| ADP-integration-003 | `ExternalConnectionRepository.save` | `spec/domains/integration.md#ポート` | 期待版一致時だけ connection を更新する |
| ADP-integration-004 | `ExternalConnectionRepository.delete` | `spec/domains/integration.md#ポート` | 期待版一致時だけ connection を削除する |
| ADP-integration-005 | `ExternalConnectionRepository.findByUserAndProvider` | `spec/domains/integration.md#ポート` | 利用者・provider の connection を取得する |
| ADP-integration-006 | `ExternalConnectionRepository.listByUser` | `spec/domains/integration.md#ポート` | 利用者の connection を列挙する |
| ADP-integration-007 | `ExternalConnectionRepository.deleteByUser` | `spec/domains/integration.md#ポート` | 利用者の connection を有界削除する |
| ADP-integration-008 | `BackupRecordRepository.insert` | `spec/domains/integration.md#ポート` | 新規 BackupRecord を保存する |
| ADP-integration-009 | `BackupRecordRepository.findById` | `spec/domains/integration.md#ポート` | BackupRecordId で OCC token 付き集約を取得する |
| ADP-integration-010 | `BackupRecordRepository.save` | `spec/domains/integration.md#ポート` | 期待版一致時だけ BackupRecord を更新する |
| ADP-integration-011 | `BackupRecordRepository.delete` | `spec/domains/integration.md#ポート` | 期待版一致時だけ BackupRecord を削除する |
| ADP-integration-012 | `BackupRecordRepository.findByNoteAndFile` | `spec/domains/integration.md#ポート` | note・source file の記録を取得する |
| ADP-integration-013 | `BackupRecordRepository.listByNotes` | `spec/domains/integration.md#ポート` | 複数ノートの backup 記録を列挙する |
| ADP-integration-014 | `BackupRecordRepository.deleteByNote` | `spec/domains/integration.md#ポート` | ノートの記録を有界削除する |
| ADP-integration-015 | `BackupRecordRepository.deleteByUser` | `spec/domains/integration.md#ポート` | current scope 内の利用者記録を有界削除する |
| ADP-integration-016 | `SecretCipher.encrypt` | `spec/domains/integration.md#ポート` | plain secret を現行 key version で暗号化する |
| ADP-integration-017 | `SecretCipher.decrypt` | `spec/domains/integration.md#ポート` | 保存 key version を使って secret を復号する |
| ADP-integration-018 | `SecretCipher.currentKeyVersion` | `spec/domains/integration.md#ポート` | 新規暗号化に使う現在の key version を返す |
| ADP-integration-019 | `IntegrationOAuthClient.buildAuthorizationUrl` | `spec/domains/integration.md#ポート` | scopes・PKCE・login hint を含む認可 URL を作る |
| ADP-integration-020 | `IntegrationOAuthClient.exchangeCode` | `spec/domains/integration.md#ポート` | code を issued credential に交換する |
| ADP-integration-021 | `IntegrationOAuthClient.revoke` | `spec/domains/integration.md#ポート` | provider の access token を失効させる |
| ADP-integration-022 | `TokenRefresher.refresh` | `spec/domains/integration.md#ポート` | refresh token を新しい issued credential に交換する |
| ADP-integration-023 | `ConnectionProbe.probe` | `spec/domains/integration.md#ポート` | credential の疎通と account label を検査する |
| ADP-integration-024 | `LlmModelCatalog.list` | `spec/domains/integration.md#ポート` | access token で利用可能 model 情報を列挙する |
| ADP-integration-025 | `CloudDriveClient.ensureFolder` | `spec/domains/integration.md#ポート` | folder がなければ作り直し参照を返す |
| ADP-integration-026 | `CloudDriveClient.listFolders` | `spec/domains/integration.md#ポート` | parent 配下の folder を列挙する |
| ADP-integration-027 | `CloudDriveClient.upload` | `spec/domains/integration.md#ポート` | stream を folder へ upload し外部参照を返す |
| ADP-integration-028 | `CloudDriveClient.download` | `spec/domains/integration.md#ポート` | external file を stream で取得する |
| ADP-integration-029 | `CloudDriveClient.headFile` | `spec/domains/integration.md#ポート` | external file の size・MIME または不存在を返す |
| ADP-job-001 | `JobRepository.insert` | `spec/domains/job.md#ポート` | 新規 Job を保存する |
| ADP-job-002 | `JobRepository.findById` | `spec/domains/job.md#ポート` | JobId で OCC token 付き Job を取得する |
| ADP-job-003 | `JobRepository.save` | `spec/domains/job.md#ポート` | 期待版一致時だけ Job を更新する |
| ADP-job-004 | `JobRepository.delete` | `spec/domains/job.md#ポート` | 期待版一致時だけ Job を削除する |
| ADP-job-005 | `JobRepository.listByRequester` | `spec/domains/job.md#ポート` | requester の current scope Job を条件付きページングする |
| ADP-job-006 | `JobRepository.listChildren` | `spec/domains/job.md#ポート` | 親の子 Job をページングする |
| ADP-job-007 | `JobRepository.listActiveByTarget` | `spec/domains/job.md#ポート` | target の未終端 Job を有界列挙する |
| ADP-job-008 | `JobRepository.listActiveByRequester` | `spec/domains/job.md#ポート` | requester の未終端 Job を有界列挙する |
| ADP-job-009 | `JobRepository.listActiveByRequesterAndKinds` | `spec/domains/job.md#ポート` | requester・kind 群の未終端 Job を有界列挙する |
| ADP-job-010 | `JobRepository.listActiveByScope` | `spec/domains/job.md#ポート` | scope の未終端 Job を有界列挙する |
| ADP-job-011 | `JobRepository.listExpiredRunning` | `spec/domains/job.md#ポート` | lease 失効 running Job を有界列挙する |
| ADP-job-012 | `JobRepository.summarizeChildren` | `spec/domains/job.md#ポート` | 親 1 件の子現況を集計する |
| ADP-job-013 | `JobRepository.summarizeChildrenOf` | `spec/domains/job.md#ポート` | 複数親の子現況をまとめて集計する |
| ADP-job-014 | `JobRepository.listRemovableRoots` | `spec/domains/job.md#ポート` | cutoff 前の削除可能 root を有界列挙する |
| ADP-job-015 | `JobRepository.listRemovableRootsByRequester` | `spec/domains/job.md#ポート` | requester の削除可能 root を有界列挙する |
| ADP-job-016 | `JobRepository.claimFamilyForRemoval` | `spec/domains/job.md#ポート` | expected version で root family removal を claim する |
| ADP-job-017 | `JobRepository.assertFamilyMutable` | `spec/domains/job.md#ポート` | root family が removal 中でないことを検査する |
| ADP-job-018 | `JobRepository.deleteFamilyPage` | `spec/domains/job.md#ポート` | claim owner を検査し子から family を有界削除する |
| ADP-job-019 | `JobHistoryQueryService.listByRequester` | `spec/domains/job.md#ポート` | global history shard から requester の履歴をページングする |
| ADP-job-020 | `JobHistoryQueryService.findById` | `spec/domains/job.md#ポート` | requester と JobId で履歴詳細を取得する |
| ADP-job-021 | `JobHistoryProjectionWriter.upsertIfNewer` | `spec/domains/job.md#ポート` | source version が新しく tombstone がなければ履歴を upsert する |
| ADP-job-022 | `JobHistoryProjectionWriter.tombstoneAndRemove` | `spec/domains/job.md#ポート` | removal tombstone 保存と履歴削除を原子的に行う |
| ADP-job-023 | `JobHistoryProjectionWriter.markTargetRemoved` | `spec/domains/job.md#ポート` | route の target label を削除済みにする |
| ADP-job-024 | `JobHistoryProjectionWriter.pruneRemovalTombstones` | `spec/domains/job.md#ポート` | 期限切れ removal tombstone を keyset で回収する |
| ADP-job-025 | `JobTargetHistoryRouteStore.registerBeforeHistory` | `spec/domains/job.md#ポート` | history 前に reverse route を冪等登録し tombstone 状態を返す |
| ADP-job-026 | `JobTargetHistoryRouteStore.tombstoneTargetBeforeFanOut` | `spec/domains/job.md#ポート` | fan-out 前に target tombstone を保存する |
| ADP-job-027 | `JobTargetHistoryRouteStore.listByTarget` | `spec/domains/job.md#ポート` | target の history route を keyset で列挙する |
| ADP-job-028 | `JobTargetHistoryRouteStore.tombstoneRoute` | `spec/domains/job.md#ポート` | 個別 route tombstone を冪等保存する |
| ADP-job-029 | `JobTargetHistoryRouteStore.pruneExpiredTombstones` | `spec/domains/job.md#ポート` | 期限切れ route・target tombstone を有界回収する |
| ADP-job-030 | `JobRemovalManifestStore.beginOrResume` | `spec/domains/job.md#ポート` | family removal manifest を開始・再開・親 operation attach する |
| ADP-job-031 | `JobRemovalManifestStore.appendPage` | `spec/domains/job.md#ポート` | Job route page と cursor を manifest に固定する |
| ADP-job-032 | `JobRemovalManifestStore.markReady` | `spec/domains/job.md#ポート` | manifest を対象固定済みにする |
| ADP-job-033 | `JobRemovalManifestStore.listUnacknowledged` | `spec/domains/job.md#ポート` | 未 ack history route を有界列挙する |
| ADP-job-034 | `JobRemovalManifestStore.acknowledge` | `spec/domains/job.md#ポート` | JobId 群の global cleanup 完了を記録する |
| ADP-job-035 | `JobRemovalManifestStore.markCompleted` | `spec/domains/job.md#ポート` | item が空の manifest を完了化する |
| ADP-job-036 | `JobRemovalManifestStore.compactItems` | `spec/domains/job.md#ポート` | ack 済み item を有界縮約する |
| ADP-job-037 | `JobRemovalManifestStore.hasIncompleteByRequester` | `spec/domains/job.md#ポート` | requester に未完了 manifest があるか返す |
| ADP-job-038 | `JobRemovalManifestStore.pruneExpiredHeaders` | `spec/domains/job.md#ポート` | 期限切れ完了 header を有界回収する |
| ADP-job-039 | `JobSlotStore.reserve` | `spec/domains/job.md#ポート` | 利用者の bulkExport slot を条件付き原子予約する |
| ADP-job-040 | `JobSlotStore.attach` | `spec/domains/job.md#ポート` | operation slot を作成済み JobId に結び付ける |
| ADP-job-041 | `JobSlotStore.release` | `spec/domains/job.md#ポート` | bulkExport slot を JobId で解放する |
| ADP-job-042 | `ScopeJobAdmissionStore.tryAcquire` | `spec/domains/job.md#ポート` | current scope の同時実行上限内なら lease slot を取得する |
| ADP-job-043 | `ScopeJobAdmissionStore.renew` | `spec/domains/job.md#ポート` | Job admission lease を更新する |
| ADP-job-044 | `ScopeJobAdmissionStore.release` | `spec/domains/job.md#ポート` | Job admission slot を解放する |
| ADP-job-045 | `ScopeJobAdmissionStore.releaseExpired` | `spec/domains/job.md#ポート` | 期限切れ admission slot を有界解放し JobId を返す |
| ADP-job-046 | `JobDispatcher.dispatch` | `spec/domains/job.md#ポート` | scope・JobId・kind を at-least-once 実行系へ送る |
| ADP-usage-001 | `StorageQuotaRepository.find` | `spec/domains/usage.md#ポート` | QuotaSubject の OCC token 付き quota を取得する |
| ADP-usage-002 | `StorageQuotaRepository.insert` | `spec/domains/usage.md#ポート` | 新規 StorageQuota を保存する |
| ADP-usage-003 | `StorageQuotaRepository.save` | `spec/domains/usage.md#ポート` | 期待版一致時だけ StorageQuota を更新する |
| ADP-usage-004 | `StorageQuotaRepository.listBySubjects` | `spec/domains/usage.md#ポート` | 複数 subject の quota を列挙する |
| ADP-usage-005 | `StorageQuotaRepository.delete` | `spec/domains/usage.md#ポート` | subject の StorageQuota を削除する |
| ADP-usage-006 | `LlmUsageRepository.find` | `spec/domains/usage.md#ポート` | user・period の OCC token 付き usage を取得する |
| ADP-usage-007 | `LlmUsageRepository.insert` | `spec/domains/usage.md#ポート` | 新規 LlmUsage を保存する |
| ADP-usage-008 | `LlmUsageRepository.save` | `spec/domains/usage.md#ポート` | 期待版一致時だけ LlmUsage を更新する |
| ADP-usage-009 | `LlmUsageRepository.deleteByUser` | `spec/domains/usage.md#ポート` | 利用者の usage を有界削除する |
