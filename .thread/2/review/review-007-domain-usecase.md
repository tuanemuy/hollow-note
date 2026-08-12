### Domain / Use Case

ゼロベースで再検証した（過去ラウンドのレビューファイルは未読）。`git status` はクリーン（`nothing to commit, working tree clean`）、共有ツリーへの変異は一切行っていない。`pnpm test:unit` は 75 files / 915 passed / 3 skipped で緑。

#### Blockers

なし

#### Warnings

なし

以下は「実害なし」と判断して指摘に上げなかった検討事項。再指摘を防ぐために根拠だけ残す。

- **finalize の到達可能性**（`deleteAccount/finalize.ts`）: 必須 receipt の 3 生産者（`globalCleanup` の `uniquenessRelease` / `authResidueCleanup` の `authResidue` / `cleanupDispatch` → `redaction` 経由の manifest item ack）はいずれも「自分の ack をコミットした直後に、自分の名前を cursor に載せた finalize 試行を積む」形になっている。最後に ack した生産者の試行 ID は必ず初回書き込みになるので、`OutboxRepository.save` の「既存行はそのまま」規約と組み合わせても finalize が取りこぼされる交錯は作れない。`personalCleanup` が最後になる場合も、そこから `redaction` → `finalize:redaction` が続くので同じ。
- **一意性解放を finalize ではなく cleanup フェーズで行う**（`deleteAccount/globalCleanup.ts`）: spec 手順 4 の字面は「finalize 時に」だが、`uniquenessRelease` が finalize の必須 receipt である以上 finalize 内で解放すると receipt が自分自身を待つ。解放後・finalize 前の窓で同一メール／ハンドルが第三者に取られても、finalize 側は directory に触れないので上書き衝突は起きず、削除中 User は別行として独立に tombstone 化される。
- **`beginRelease` → `release` の間でプロセスが落ちた場合**: 行は `releasing` のまま残り `reserve` を弾くが、`deleteAccount` 側は receipt 未記録なので cleanup イベントが再配送され、`beginRelease` が同じ決定的 operationId へ再キーして `release` が消す（memory アダプターで確認）。`identityRemovalRelease` も同様に収束する。`updateProfile` の旧ハンドルだけ再駆動主体が無いが、これは plan の縮退（引き継ぎ先 #9）に記録済み。
- **`authResidueCleanup` の `stale` 分岐が deletion 由来だと ack せず終わる**: `authEpoch` を進める 4 経路（`resetPassword` / `changePassword` / `signOutOtherSessions` / `deleteAccount`）はいずれも `ActiveUser` を要求し、`finalizeDeletion` は epoch を据え置くため、`deleting` の間に epoch が動く経路が存在しない。到達不能な防御分岐。
- **`removeIdentity` が `DeletingUser` を拒まない**: 削除受理が `authEpoch` を進めて全セッションを失効させるため、`requireSession()` を通る経路が残らない。仮に通っても directory 解放は双方 `expectedUserId` 一致でのみ効くので冪等に収束する。
- **`completeOAuthSignIn.createUser` の `parentOperationId` が毎回ランダム**: commit 済み・activate 前でプロセスが落ちると 10 分後に予約が失効し、到達不能な User 行が残る。ただし `signUpWithPassword`（#1 で確定済み）と同一構造で本 PR の新規劣化ではなく、`activateUniqueKeys` の `confirm` が同一呼び出し内の応答喪失は収束させている。

#### 観点別の確認結果（要点）

- **ドメイン配置**: `UsageWarningLevel` の 80% / 100% 境界、`ByteQuota.defaultFor`（user 5GB / workspace 20GB）、`BillingPeriod` の UTC 暦月、`UploadValidationPolicy`（マジックバイトから型・サイズを再導出し宣言値を信用しない）、`IdentityPolicy.isRemovable`、`AccountDeletionRetryPolicy`（しきい値と 120 日窓をドメインに保持し、ストアは `countTerminalSince` の観測のみ）、`SameOriginPolicy`（`//`・`\`・C0 制御の 3 形を 1 か所で判定）— いずれも判断がドメイン側にあり、ユースケースは順序付けだけを持つ。逆方向（ドメインに漏れた I/O・設定読み）も無い（`AvatarUrl.create` が `appUrl` を引数で受ける、`User.reconstruct` が検証をスキップする理由を明示）。
- **不変条件の型表現**: `PersistentFile` から artifact provenance を除外して「期限なしの生成物」を表現不能にしている、`personalCleanupParticipants` / `globalCleanupParticipants` が `satisfies Record<enum, ...>` で全列挙を強制し必須集合を participant 側から導出、`continuationSubscribers` が継続種別ごとの非空タプルで未登録をコンパイルエラーにする、`PERSONAL_CLEANUP_COMMANDS` が `Record<ActivePersonalCleanupComponent, …>` で網羅。
- **UoW の規律**: 全 46 箇所の `*UnitOfWorkProvider.run` を追跡し、入れ子は無い。`deleteStoredFiles` / `completePersonalCleanupIfDone` は ctx を引数に取る共有手順で自分では `run` を開かない（spec「UoW の合成」の規約どおり）。同一 UoW 要件は `removeIdentity`（delete + receipt + outbox）、`resendVerificationEmail` / `requestPasswordReset`（status 再検査 + 旧 token 削除 + 新 token）、`resetPassword` / `changePassword`（identity + epoch + token/session + 継続）、`deleteQuota` / `deleteFilesByOwner`（削除 + 継続タスク再登録）で満たされている。
- **Outbox / 冪等性**: `mintEventIdFor` が `continuationKey` から決定的 ID を導出し、`turn` ごとに key が変わることが `cursor` で担保されている（`compaction` / `redaction` はターン番号、`finalize` は生産者名）。`IdempotencyStore` を通さない購読者（`identityRemovalRelease` / `deleteStoredObjects` / `authResidueCleanup`）は、それぞれ JSDoc に冪等性の根拠（削除の冪等性・epoch 未満の有界削除・receipt と現行 identity の両検査）を書いている。
- **Cross-layer catch policy**: 広い `try/catch` は `releaseUniqueKeys`（補償）、`activateUniqueKeys`（応答喪失の照合）、`storeAvatar`（オブジェクトのロールバック）、`runDueScopeTasks` / `pruneAccountDeletionManifests`（行単位の部分失敗許容）、メール送信の記録継続、`changePassword` の `PlainPassword` → `INVALID_CREDENTIALS` 変換のみ。いずれも明示的な境界で、ドメインエラーの再翻訳は無い。
- **入力バリデーション 2 点**: 転送境界（`routes/settings/-action.tsx` の zod は形と DoS 上限のみ。表示名 50 / ハンドル 3〜30 / 5MB / UUID は値オブジェクト・ドメインポリシー側に一本化されているとコメントで明示）と VO 構築の 2 点に収まっている。`userId` を要求本文から取らずセッションから取る形も全ハンドラーで守られている。
- **削除オーケストレーション**: 受理（`admission.ts`）が「terminal 件数を数える → 判定する → operation を作る」順で、`beginDeletion` を resume で二度呼ばないため epoch の二重バンプが起きない。barrier はコミット後に scope 自身のトランザクションで取り、`startAccountDeletionManifestBuild` はその後。継続入力は `(phase, cursor)` で 1 ターンを完全記述し、リプレイが同じ後続を再発行する。`AccountDeletionManifestStore.claimPending("redaction")` は行に印を付けないので、claim 後 ack 前のクラッシュでも item が取り残されない。
- **`DeletingUser` / `DeletedUser` での倒れ方**: signIn（`ACCOUNT_DELETING` / `INVALID_CREDENTIALS`）、`completeOAuthSignIn`（既存リンク・`AccountLinkingPolicy.existingUserUnavailable` の両方で `ACCOUNT_UNAVAILABLE`）、`startOAuthFlow` / `linkOAuthIdentity`、`requestPasswordReset`（無送信・同一応答）、`resetPassword`（`AUTH_TOKEN_NOT_FOUND`）、`changePassword` / `signOutOtherSessions`（`UNAUTHENTICATED`）、`addPasswordIdentity` / `updateProfile` / `getProfile`（`ACCOUNT_UNAVAILABLE` / `USER_NOT_FOUND`）、scope 書き込み 3 経路（`createBlankNote` / `storeAvatar` / `recalculateStorageUsage` がいずれも `assertWritable` + `assertActorWritable` を呼ぶ）— 全経路を確認。
- **テストによる担保**: 対象 TC を grep で突合し、AC-3〜AC-27 が挙げる TC ID（TC-identity-024..054 / 081..111 / 119..133 / 179..212 / 238..246 / 264..304、TC-storage-037..050 / 167..174、TC-usage-026..033 / 044..047 / 055..059 / 065..072）がテスト名に揃っていることを確認した。`deletionDriver.runUntilSettled` は relay ラウンドと scope task ラウンドを交互に回し、「動かないまま running」を明示的に失敗させるので、チェーン断裂が緑で通らない。
- **残す必要のない記述**: コード・コメントを `レビュー` / `指摘` / `previously` / `以前は` などで走査したが、修正の経緯・弁明の類は残っていない（ヒットしたのは無関係な語義のみ）。

#### カバレッジ

合計 294 件（確認 148 + スキップ 146）。

**確認（148）**

- `packages/core/src/domain/**` — 33 件（`usage/` 全 9、`storage/` 全 7、`identity/` の変更 8、`note/` の変更 5、`common/event.ts`、および各 `__tests__` 4）
- `packages/core/src/application/**` — 108 件
  - 非テスト 64 件（`identity/*.ts` 全 26、`identity/deleteAccount/*.ts` 全 10、`storage/*.ts` 全 6、`usage/*.ts` 全 4、`cleanup/*.ts` 2、`ports/*.ts` 10、`workers/*.ts` 3、`execution/*.ts` 2、`di/{types,memoryRuntime,serverNode}.ts` 3）はソースを読了
  - `__tests__` 44 件は「TC ID の網羅・ハーネス/ドライバーの構造・全件緑」のレベルで確認（`deletionDriver.ts` / `deletionHarness.ts` / `helpers.ts` は読了）
- `packages/core/src/adapters/memory/repositories/{identityUniqueDirectory,accountDeletionManifestStore,noteProjection}.ts` — 3 件（ポート契約の意味論をユースケース側の推論に使うため読了）
- `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/storage.$.tsx`, `apps/web/app/worker/node/runner.ts` — 3 件（転送境界のバリデーションと継続の駆動主体の確認）
- `.thread/2/plan.md` — 1 件

**スキップ（146）**

- `packages/core/src/adapters/**`（上記 3 件を除く 40 件） — アダプター観点のレビュアーの担当。契約側（ポート JSDoc）と適合スイートの存在は確認済み
- `apps/web/**`（上記 3 件を除く 67 件） — フロントエンド／プレゼンテーション観点の担当。ミューテーション三層・skeleton・ticket 署名は本観点の対象外
- `.thread/2/**`（`plan.md` を除く 36 件） — 過去ラウンドのレビュー記録は本レビューの前提にしない指示のため。`adr.md` / `steps.md` / `progress.md` / `testing.md` / `triage.md` も、必要な設計判断は `plan.md` の受け入れ基準・縮退の節から辿った
- `docs/runtime_node.md`, `docs/test.md`, `vitest.config.ts` — 3 件。ドキュメント／テスト実行設定でドメイン・ユースケースの契約に関わらない
