# 指摘台帳 — Issue #2 / PR #17

判定は `fix`（コード・テスト・挙動に触る修正）/ `fix-editorial`（コメント・ドキュメントの文言のみ）/ `wont-fix`（直さない）/ `defer`（別 Issue）。
Key はファイル＋シンボル＋問題カテゴリで正規化する。重複指摘は代表 ID に統合し、Key 欄に統合元を併記する。

## R1

### Blockers

| Key | 初出 | 判定 | 理由（一行） | 再指摘 |
|---|---|---|---|---|
| `deleteAccount/globalCleanup.ts:receipt/UoW・応答喪失`（B-001） | R1 | fix | ack と finalize 継続が別 UoW ＋早期 return で削除が恒久停止。再現確認済み | 0 |
| `domain/identity/valueObject.ts:AvatarUrl.create/同一オリジン検査`（B-002 + W-S01） | R1 | fix | `/\host` と C0 制御文字が素通り。実測確認済み。兄弟実装が正しい手本を持つ | 0 |
| `ports/outboxRepository.ts:save/port-contract`（B-003） | R1 | fix | ADR-019 の決定的 EventId が契約外の memory 特性（upsert）に依存 | 0 |
| `workers/scopeTaskRunner.ts:catch/liveness`（B-004 + W-D02 + W-A03） | R1 | fix | throw に backoff が掛からず 1Hz 無限再実行。`claimDue` が適合テスト専用な点と同根 → **裁定 8: (a) runner を `claimDue` 経由に寄せ、ADR-061 を supersede** | 0 |
| `routes/settings/-action.tsx:uploadAvatarFn/CSRF`（B-005） | R1 | wont-fix | **誤指摘**。差分外の `apps/web/app/start.ts` が `createCsrfMiddleware` を全 server fn に登録済みで、dist にも残存。Security 観点の反対結論をコードで確定 | 0 |
| `identity/startOAuthFlow.ts:state/login CSRF`（B-006） | R1 | fix | `state` がブラウザーに束縛されず攻撃者セッションを焼ける。ADR-029 と同型の脅威 | 0 |
| `di/serverNode.ts + scripts/listen.node.ts:dev IdP ガード`（B-007） | R1 | fix | `pnpm start` は `NODE_ENV` 未設定でガードが発火せず、`.env.example` 既定のまま本番で dev IdP が公開される | 0 |
| `identity/completeOAuthCallback.ts/テスト欠落`（B-008 + Frontend W-012） | R1 | fix | plan.md のテスト方針が明示した intent 分岐のテストがゼロ | 0 |

### Warnings

| Key | 初出 | 判定 | 理由（一行） | 再指摘 |
|---|---|---|---|---|
| `identity/updateProfile.ts:planHandle/サガ回復`（W-D01） | R1 | fix | **裁定 3: (a) 最小修正を本 PR で入れる**。3 ファイルに閉じ、他単位と競合しない。放置すると他人が handle を奪える | 0 |
| `identity/listIdentities.ts:removable/ドメイン規則の再実装`（W-D03） | R1 | fix | `IdentityPolicy.isRemovable` を足して呼ぶだけ | 0 |
| `identity/completeOAuthSignIn.ts:DISPLAY_NAME_MAX_LENGTH/定数複写`（W-D04） | R1 | fix | VO 側に `truncate` を生やす | 0 |
| `deleteAccount/cleanupDispatch.ts:JSDoc/過剰保証`（W-D05） | R1 | fix-editorial | plan.md の縮退と JSDoc が矛盾。文言のみ | 0 |
| `deleteAccount/authorRedaction.ts:継続判定/フィルタ後件数`（W-D06） | R1 | fix | 未 ack を残して finalize へ渡しうる。生件数判定か型で表現不能化 | 0 |
| `storage/storeAvatar.ts:put/孤児オブジェクト`（W-D07 + W-A05） | R1 | fix | 失敗時に行を持たないオブジェクトが残り回収経路ゼロ。**Adapter 案（`deleteMany` で巻き戻し）を採用** | 0 |
| `di/serverNode.ts:initNodeRuntime/fail-open`（W-A01 + W-S06） | R1 | fix | `??=` のサイレント no-op と OAuth 既定 dev。危険側に倒れている | 0 |
| `conformance/signInOAuthClient.ts:live/空 pass`（W-A02 + W-T06） | R1 | fix | 資格情報があると「無検証なのに pass」に化ける。gate 条件のみ | 0 |
| `ports/objectStorage.ts:checksum/契約の矛盾`（W-A04） | R1 | fix | **裁定 1: (a) ポートの "measured" を正とし、スイートの「宣言値をそのまま返す」ケースを削る**（ADR-026: 契約の正本はポート定義）。size の measured も実効化する | 0 |
| `storage/deleteFilesByOwner.ts:backoff/初回 stalled`（W-A06） | R1 | fix | 行不在で `backoff` が黙って no-op になり再駆動主体が消える | 0 |
| `adapters/oauth/googleSignInOAuthClient.ts:timeout`（W-A07） | R1 | fix | 外部サービス境界の既定防御 | 0 |
| `di/types.ts:identity_removal_receipts/保持回収`（W-A08） | R1 | fix | `AuthStateTable` / `authStateSweeps` 未登録で 30 日保持が回収されない | 0 |
| `routes/storage.$.tsx:purpose/無認可配信`（W-A09 + W-S02） | R1 | fix | purpose を見ずに全オブジェクトを配信。`avatar` 以外 404 で `publicUrl` の契約が守られる | 0 |
| `worker/node/runner.ts:起動ドレイン/直列化迂回`（W-A10） | R1 | fix | 直後のコメントの保証と食い違う。`kick()` に置換 | 0 |
| `components/auth/OAuthCallbackPanel:cancelled,failed/intent`（W-F01） | R1 | fix | **裁定 4: (c) 文言を intent 中立にし戻り先を汎用導線に倒す**（(a) は往復増、(b) は Google が許さない） | 0 |
| `components/layout/AccountMenu:Link/メニュー開閉`（W-F02） | R1 | fix | サインアウト側だけ `setOpen(false)` している非対称 | 0 |
| `routes/settings/index 不在/ルーティング`（W-F03） | R1 | fix | `/settings` 直接アクセスが行き止まり。index ルート 1 本 | 0 |
| `routes/settings/route.tsx:未認証の danger/認可表示`（W-F04） | R1 | wont-fix / 一部 fix | **裁定 6: ルートの挙動は ADR-062 で宣言済みのため wont-fix。ただし 401 がメール不一致用の項目エラー欄に `aria-invalid` 付きで出る点は ADR の射程外なので fix**（パネル全体のエラーへ移す） | 0 |
| `components/settings/ProfileForm/editor.tsx:保存状態/三項の評価順`（W-F05） | R1 | fix | 「保存しました」が張り付く。順序入れ替えのみ | 0 |
| `ChangePasswordForm,SignOutOthersPanel:router.invalidate 欠落`（W-F06） | R1 | fix | plan.md「P-25 だけが例外」への未記録の逸脱 | 0 |
| `ProfileForm/editor.tsx:AVATAR_MAX_BYTES/定数二重化`（W-F07） | R1 | fix | `-action.tsx` 自身が「上限の理由はドメイン 1 か所に」と書いている | 0 |
| `OAuthCallbackPanel:classify/文言辞書`（W-F08） | R1 | fix | `OAUTH_CODE_INVALID` の辞書エントリーが到達不能 | 0 |
| `DeleteAccountPanel:crypto.randomUUID/try 外`（W-F09） | R1 | fix | 非セキュアコンテキストで無言の全画面エラー | 0 |
| `ProfileFormSkeleton/レイアウトシフト`（W-F10） | R1 | fix | 実 DOM の sticky 下部バーを写していない | 0 |
| `IdentityList/board.tsx:formatDate/ハイドレーション`（W-F11） | R1 | fix | `"use client"` 島で `timeZone` 未指定。`UsagePanel` は配慮済み | 0 |
| `identity/completeOAuthCallback.ts:as RequestContainer/無効キャスト`（W-F12） | R1 | fix | `ServiceArgs<T>.container` は既に `RequestContainer` | 0 |
| `DeleteAccountPanel:DeletionProgress/型モデル`（W-F13） | R1 | fix | 到達しない `idle` が「削除しています」に落ちる。型で消せる | 0 |
| `DeleteAccountPanel:poll catch/恒久失効 ticket`（W-F14） | R1 | fix | 失効 ticket が残り削除フォームに戻れない | 0 |
| `storage/storeAvatar.ts:MIME/マジックナンバー未検証`（W-S03） | R1 | fix | **裁定 7: 本 PR で入れる**。現状の防御が配信ルートのヘッダーのみで、`publicUrl` が R2 へ移ると防御ゼロになる | 0 |
| `identity/{resendVerificationEmail,requestPasswordReset}:応答時間オラクル`（W-S04） | R1 | defer (#18) | **裁定 5: 別 Issue**。正しい形（一律の下限時間）は実 MailSender と一緒に決めるべき横断的関心事。ADR に記録する | 0 |
| `deleteAccount/terminalPrune.ts:駆動主体/PII 保持`（W-S05） | R1 | fix | **裁定 2: (a) `runner.ts` の prune tick に配線する**。アカウント削除の中核的な約束で、lease / checkpoint は既にある | 0 |
| `identity/addPasswordIdentity.ts:再認証`（W-S07） | R1 | fix-editorial | 実装は plan.md の縮退で宣言済み。セキュリティ上の帰結の 1 行追記のみ | 0 |
| `deleteAccount.admission.test.ts:TC-identity-040/前提未再現`（W-T01） | R1 | fix | 10,000 件の前提が無く O(1) 性が観測できない | 0 |
| `authResidueCleanup.test.ts:TC-identity-043/世代巻き戻し`（W-T02） | R1 | fix | 1 行の assert 追加 | 0 |
| `authResidueCleanup.test.ts:TC-identity-042/finalize 条件`（W-T03） | R1 | fix | 隣の TC-041 と同じ形にする | 0 |
| `deleteAccount.finalize.test.ts:TC-identity-090/再試行時刻`（W-T04） | R1 | fix | 未検証 ＋ progress.md の ID 単位表にも無い | 0 |
| `deleteAccount.terminalPrune.test.ts:TC-identity-107/前提未再現`（W-T05） | R1 | fix | 105 と結合され checkpoint 前停止が再現されていない | 0 |
| `deleteFilesByOwner.test.ts:TC-storage-042/逐次`（W-T07） | R1 | fix | 「2 系列が並走」が完全に逐次。誤読源 | 0 |
| `identity/{checkHandleAvailability,getProfile}.ts/テスト無し`（W-T08） | R1 | fix | ADR-047 の新設入口。回帰検知の価値が高い | 0 |
| `routes/dev/oauth/authorize.tsx:OAUTH_DEV_MODE 404/検証無し`（W-T09） | R1 | fix | AC-6 の一部。B-007 の修正と一緒にテストで固める | 0 |

R1: 新規 42（統合前 56）/ fix 37 / fix-editorial 2 / wont-fix 2 / defer 1 / 継承 0（方針フェーズ: 実施）
観点別 fix 件数: domain-usecase 7 / adapter 10 / frontend 12 / security 4 / test 8（重複統合後）

## 要確認の裁定（メイン）

1. **`ObjectStorage` の checksum 契約** → **(a)**。ADR-026「契約の正本はポート定義」に従い、ポートの "measured" を正とする。適合スイートの「宣言値をそのまま返す」ケースを削り、size の measured 検証も実効化する。
2. **削除 PII の回収** → **(a) 配線する**。「アカウント削除」の中核的な約束であり、lease / checkpoint を持つ prune が既にあるので日次 tick に載せるだけ。無記録で残すのが最悪という triage の指摘に同意。
3. **`updateProfile` の handle サガ** → **(a) 本 PR で最小修正**。3 ファイルに閉じて他単位と競合せず、放置すると他人が handle を奪える。defer 基準（このPRで対応できないもの）に当たらない。
4. **P-05 の cancel / failed の intent** → **(c) 文言を intent 中立にし、戻り先を汎用導線に倒す**。(a) は往復が増え U-5 と競合、(b) は Google が authorized redirect URI にクエリを許さないため採用不可。
5. **認証系メールの応答時間オラクル** → **defer**。応答内容は既に同一で、正しい形（全経路一律の下限時間）は実 MailSender と一緒に決めるべき横断的関心事。ADR に判断を記録し Issue を起票する。
6. **`/settings/danger` の未認証フォーム** → **ルートの挙動は wont-fix**（ADR-062 で宣言済み）。**401 がメール不一致用の項目エラー欄に出る点だけ fix**（ADR の射程外の UX 不具合）。
7. **MIME のマジックナンバー検証** → **本 PR で入れる**。現状の防御は配信ルートの `nosniff` + CSP のみで、`publicUrl` が R2 の公開ドメインへ移る配備では防御がゼロになる。`spec/domains/storage.md` の契約範囲に収まる。
8. **`claimDue` の去就** → **(a) runner を `claimDue` 経由に寄せる**。契約と実駆動が一致し W-D02 / W-A03 も同時に解消。AC-31「適合テスト専用のポートが残らない」の趣旨に沿う。**ADR-061「runner は claim しない」を supersede する ADR を起こすこと**。

## R2

| Key | 初出 | 判定 | 理由（一行） | 再指摘 |
|---|---|---|---|---|
| `identity/updateProfile.ts:releaseUniqueKeys/補償解放の巻き添え`（D-B001） | R2 | fix | 敗者の補償解放が勝者の reserved 行を消し user 行と directory が乖離。再現確認済み。**案 2（ポート不変・OCC 失敗時は解放を飛ばす）を採る** | 0 |
| `identity/updateProfile.ts:releaseActiveUniqueKey/再駆動主体不在`（D-W001） | R2 | fix | 旧ハンドルの active 行が残ると誰も取れない。縮退として記録する | 0 |
| `domain/identity/user.ts:UserBase.avatarUrl/型で表現`（D-W002） | R2 | fix | **裁定 1: (a) 型を `AvatarUrl \| null` に上げ、`reconstruct` は「書き込み時に検証済み」としてキャスト**。他 4 フィールドと形が揃う | 0 |
| `domain/identity/valueObject.ts:PlainPassword/フロント複写`（D-W003 + F-W001） | R2 | fix | 3 か所複写。`ChangePasswordForm` は 128 上限が無く 200 文字が送信可能 | 0 |
| `workers/subscribers.ts:consumerName/死んだ JSDoc`（D-W004） | R2 | fix-editorial | 非テスト参照 0 件。実在しない用途を主張 | 0 |
| `コード内の裸 ADR-0NN 参照`（D-W005 + T-W005） | R2 | fix | 116 件中 21 件が `.thread/2/adr.md` しか指し得ず `spec/adr/` の同番号と衝突。`.thread` 直参照 3 件も実在 | 0 |
| `deleteAccount/globalCleanup.ts:JSDoc/outbox 契約と不整合`（D-W006） | R2 | fix-editorial | 挙動は正しくコメントの根拠だけが誤り | 0 |
| `execution/eventId.ts:continuationKey/構造的読み取り`（D-W007） | R2 | wont-fix | **裁定 2: (a)**。実害は仮説段階で、`EventDraft` に `deterministicId` を足すとアプリ層の関心が domain draft base へ逆流する。規約は `eventId.ts` の JSDoc で明文化済み | 0 |
| `docs/runtime_node.md/実装との乖離`（A-W001） | R2 | fix-editorial | 運用の正典が古いまま（consumer no-op / scope task 行なし / `DELETION_TICKET_KEY` 未記載） | 0 |
| `server.node.ts:bootPromise/dev 再ロードで runner 多重起動`（A-W002） | R2 | fix | ALS だけ `import.meta.hot.data` に退避され `bootPromise` はモジュールスコープ。`process.once` も累積 | 0 |
| `worker/node/runner.ts:receipt sweep/コメントと実態`（A-W003） | R2 | fix-editorial | **裁定 3: runner の sweep を残し JSDoc を実態に合わせる**。`pruneExpiredAuthState` は本番呼び出しが無く（cron は #15）、一本化すると 30 日保持の回収が止まる。二重定義は #15 への引き継ぎとして記録 | 0 |
| `worker/node/runner.ts:prune tick/起動ドレイン欠落`（A-W004） | R2 | fix | relay と scope task は即時駆動、prune だけ 24h interval 登録のみ。短命プロセスで一度も走らない | 0 |
| `workers/scopeTaskRunner.ts:未知 kind/警告ログ洪水`（A-W005） | R2 | fix-editorial | 「可視な停滞」は妥当な設計判断。JSDoc に定常ログ化を明記するに留める | 0 |
| `ports/identityUniqueDirectory.ts:beginRelease/reserved 契約欠落`（A-W006） | R2 | fix | ADR-026「契約の正本はポート定義」に照らしポート文とスイートの両方が欠けている | 0 |
| `ports/scopeTaskScheduler.ts:priority/縮退未記録`（A-W007） | R2 | fix | `spec/database` の `scheduled_tasks` から `priority` と lease を落としたが縮退記録が無い。#11 の前提になるので Issue も起票する | 0 |
| `adapters/oauth/googleSignInOAuthClient.test.ts/翻訳無検証`（A-W008） | R2 | fix | 共有スイートの exchange は Google では常に skip され、翻訳規則を守る唯一のテストが空 | 0 |
| `workers/subscribers.ts/継続イベント網羅性`（A-W009） | R2 | fix | 継続 4 種の登録漏れが「削除チェーンの無言停止」になる。AC-29 の核心 | 0 |
| `worker/node/runner.ts/テスト無し`（A-W010） | R2 | fix | **裁定 5: A-W002（多重起動しない）と A-W004（起動時に prune が 1 回走る）の 2 点に限定**。stop のドレイン・例外隔離は受け入れ基準の要求を超える | 0 |
| `cleanup/personalCleanup.ts:ページ継続/到達不能`（A-W011） | R2 | fix-editorial | 到達不能を確認。JSDoc に明記して #11 へ引き継ぐ | 0 |
| `ProfileForm/editor.tsx:handleProblem/項目エラー振り分け`（F-W002） | R2 | fix | `suggestions.length > 0` 判定のため不正・予約語が `aria-invalid` に乗らない | 0 |
| `DeleteAccountPanel:ticket 復元/主体未束縛`（F-W003） | R2 | fix | ticket claims に userId が無く、別アカウントに「削除しました」を 1 回必ず誤表示 | 0 |
| `DeleteAccountPanel:settled/再開手段なし`（F-W004） | R2 | fix | ADR-085 が ticket を残した意図（再読込で再開）が利用者に到達しない | 0 |
| `OAuthCallbackPanel:retryExchange/消費済み state`（F-W005） | R2 | fix | 単回消費の state を再 POST。「state 未消費と判る失敗だけ交換再試行」に絞る | 0 |
| `{ProfileForm,UsagePanel}Skeleton/レイアウトシフト`（F-W006） | R2 | fix | 実 DOM 側が無条件表示。**ProfileForm 分は R1（W-F10）の修正が不十分**（継承・再指摘 +1） | 1 |
| `ProfileForm/editor.tsx:input[type=file]/アクセシブルネーム`（F-W007） | R2 | fix | `sr-only` かつ id / aria-label 無し | 0 |
| `UsagePanel:updatedAt/timeZone 未指定`（F-W008） | R2 | fix | 同一パネル内のリセット日は UTC 明示。1 行の非対称 | 0 |
| `AccountMenu:JSDoc/項目数`（F-W009） | R2 | fix-editorial | 実項目 2 件。判断は妥当、根拠の記述だけ古い | 0 |
| `oauthStateCookie:clear/破棄経路が片肺`（S-W001） | R2 | fix | 破棄が成功パスのみで、失敗・キャンセル時に 10 分残る | 0 |
| `routes/auth/-action.tsx:束縛の配線/テスト無し`（S-W002） | R2 | fix | 「2 行消しても全テストが緑」。順序が壊れた瞬間に login CSRF が復活する | 0 |
| `scripts/listen.node.ts:本文サイズ上限なし`（S-W003） | R2 | fix | 未認証で数百 MB を実体化させられ、同居するワーカー平面（削除継続）にも及ぶ | 0 |
| `routes/storage.$.tsx:Cache-Control immutable`（S-W004） | R2 | fix | 1 年 CDN 残留が P-25 の「消える」約束と矛盾。`private` 化は 1 語 | 0 |
| `usage/recalculateStorageUsage.ts:subject と actor の非結合`（S-W005） | R2 | fix | 現状到達不能だが `storeAvatar:70` の手本を 3 行複写するだけ。**workspace 主体は AC-22 / TC-usage-072 が要求するので user 主体のみ束縛する** | 0 |
| `googleSignInOAuthClient.ts:id_token/iss・aud・exp 未検証`（S-W006） | R2 | fix | OIDC §3.1.3.7 が省けるのは署名検証だけ | 0 |
| `deleteAccount.finalize.test.ts:TC-identity-090/再試行時刻`（T-B001） | R1 | fix-editorial | **裁定 4**。実装は plan.md / ADR-026 が宣言済み（スコープ外）、ID 単位の記録は progress.md に既にある。**残るはテスト名の欠落明示だけ** | 1 |
| `deleteFilesByOwner.test.ts:TC-storage-043/3 文`（T-B002） | R2 | fix-editorial | **裁定 4**。ADR-057（Accepted）と progress.md に ID 単位で記録済みなので「記録が無い」は誤り。テスト名とコメントの言い回しのみ | 0 |
| `policies.test.ts:TC-identity-052/見送り行の ID 冠`（T-W001） | R2 | fix-editorial | AC-33 の機械照合が取れなくなる。テスト名から ID を落とす | 0 |
| `quota.test.ts:codeOf/例外の取りこぼし`（T-W002） | R2 | fix | 許容側境界が「BusinessRuleError 以外で落ちても緑」 | 0 |
| `pruneExpiredAuthState.test.ts:identity_removal_receipts/実削除未検証`（T-W003） | R2 | fix | AC-14 の 30 日保持を担保する唯一の経路が 0 件確認だけ | 0 |
| `conformance/storedFileRepository.ts:ADP-storage-003/save 未検証`（T-W004） | R2 | fix | 姉妹スイート 2 本は検証済みでここだけ非対称 | 0 |

R2: 新規 36 / 継承 3 / fix 24 / fix-editorial 14 / wont-fix 1 / defer 0（方針フェーズ: 実施）
観点別 fix 件数: domain-usecase 5 / adapter 6 / frontend 7 / security 6 / test 3（重複統合後）

## 要確認の裁定（メイン・R2）

1. **`UserBase.avatarUrl` の型付け** → **(a)**。型を `AvatarUrl | null` に上げ、`reconstruct` は「書き込み時に検証済み」としてキャストする。`AvatarUrl.create` が `appUrl` を要求するため `reconstruct` で再検証するとドメインに設定が漏れ、他 4 フィールドと形も揃わない。
2. **継続イベント ID の決定性を型で縛るか** → **(a) wont-fix**。`EventDraft` は domain の `DomainEventDraftBase` 由来で、`deterministicId` を足すとアプリ層の関心が domain へ逆流する。規約は `eventId.ts` の JSDoc で明文化済みで、危険は仮説段階。
3. **receipt 回収の一本化 vs コメント修正** → **runner の sweep を残し JSDoc を実態に合わせる**。`pruneExpiredAuthState` の cron 配線は #15（本 Issue 外）で本番呼び出しが無く、一本化すると 30 日保持の回収が止まる。二重定義は #15 への引き継ぎとして記録する。
4. **TC-identity-090 / TC-storage-043 の記録の置き場所** → **plan.md に複写しない**。ID 単位の記録は `progress.md`（Issue コメントの原本）に既にあり、plan.md は契約という役割分担を保つ。修正はテスト名・テスト内コメントの欠落明示に限る。
5. **runner テストの範囲** → **A-W002（多重起動しない）と A-W004（起動時に prune が 1 回走る）の 2 点に限定**。stop のドレイン・prune 3 本の例外隔離は本 Issue の受け入れ基準の要求を超える。

## R3

| Key | 初出 | 判定 | 理由（一行） | 再指摘 |
|---|---|---|---|---|
| `__tests__/completeOAuthSignIn.test.ts:TC-identity-026/セッション未検証`（Test B-001） | R3 | fix | **実測確定**: `attachToExistingUser` の `sessionRepository.insert` を消しても 891 全緑。AC-8 の期待結果が無防備 | 0 |
| `__tests__/startOAuthFlow.test.ts:TC-identity-265/userAuthEpoch 既定値`（Test B-002） | R3 | fix | 3 アサーションが全て 0 で、定数 0 実装が通る。AC-7 の「epoch を state に保持」が未検証 | 0 |
| `identity/uniqueness.ts:reservationOperationId/ログ PII`（Security W-001） | R3 | fix | `operationId` に生メールが入り `logger.error` → stdout に出る。`main` には無かった本 PR の新規露出 | 0 |
| `routes/settings/-action.tsx:uploadAvatarFn/CSRF`（Frontend W-001） | R1 | wont-fix | **誤指摘（R1 B-005 の判定を継承）**。`start.ts` の `createCsrfMiddleware` が serverFn の requestMiddleware 層でハンドラー到達前に照合し、ヘッダー不在は 403。**2 周連続の再指摘なので、非自明な制約として 1 行の why コメントを置く**（裁定 3） | 1 |
| `ProfileForm/editor.tsx:handleProblem/saveFailure の陳腐化`（Frontend W-002） | R3 | fix | 候補チップを押しても前回の `HANDLE_ALREADY_USED` と `aria-invalid` が残り、AC-20 の目的動作を壊す | 0 |
| `IdentityListSkeleton/レイアウトシフト`（Frontend W-003） | R3 | fix | 実 DOM の強度メーター等を写しておらず JSDoc の宣言を満たさない。R1/R2 の Skeleton 指摘とは別コンポーネント | 0 |
| `memory/scopeUnitOfWork.ts:commit kick/無観測`（Adapter W-001） | R3 | fix | AC-29 が名指す commit kick が全テストから到達不能。**memory ローカルの単体テスト 1 本に限定**（適合バックエンドは触らない） | 0 |
| `ports/distributedOperationStore.ts:markState/契約と実装の乖離`（Adapter W-002） | R3 | fix-editorial | **裁定 1: 契約文を実装に合わせる**。実装側で terminal → running を拒否するのは本 Issue の AC 外の強化。#7 への引き継ぎとして記録する | 0 |
| `vitest.config.ts:testTimeout ↔ docs/test.md`（Adapter W-003 + Test W-009） | R3 | fix-editorial | **統合。裁定 2: 10s へ下げ、コメントを実測（最遅 278ms）に合わせる**。docs も 1 行更新 | 0 |
| `worker/node/runner.ts:scope tick・relay ドレインのテスト無し`（Test W-001） | R2 | wont-fix | R2 **裁定 5** で runner テストの範囲を限定済み（判定継承）。commit kick 側の観測は Adapter W-001 で閉じる | 1 |
| `deleteFilesByOwner.test.ts:batchSize 上限 100/未検証`（Test W-002） | R3 | fix | AC-25 が明示要件にしている 100 のクランプが一度も踏まれない | 0 |
| `linkOAuthIdentity.test.ts:TC-identity-126/敗者の理由未検証`（Test W-003） | R3 | fix | AC-15 の対象行。隣の TC-125 はコードを確認しており非対称 | 0 |
| `ports/scopeTaskQueue.ts:listDue/JSDoc の逃げ道`（Test W-004） | R3 | fix-editorial | plan.md のテスト方針が `listDue` の契約をスイートに含めよと明示。**スイートを残し JSDoc の「空配列も完全な実装」を削る** | 0 |
| `conformance/accountDeletionManifestStore.ts:item key の文字列表現`（Test W-005） | R3 | fix | 「契約化するのは観測可能な結果だけ」に反し memory の符号化を契約化している | 0 |
| `conformance/scopeCleanupAdmissionStore.ts:completed 後 ack の no-op`（Test W-006） | R3 | fix | 「投げない」だけで `running` へ巻き戻す実装も通る。ADR-018 の追加分の要求 | 0 |
| `{deleteQuota,deleteFilesByOwner}.test.ts:継続の同一 UoW 登録`（Test W-007） | R3 | fix | AC-24 の明示要件。schedule を別トランザクションに出しても緑 | 0 |
| `{storeAvatar,recalculateStorageUsage}:assertWritable 2 本/検証不能`（Test W-008） | R3 | fix-editorial | `actorLocks` を立てる経路が本 Issue に無く構造的に閉じられない（#3 依存）。progress.md の縮退に 1 行足す | 0 |
| `authResidueCleanup.test.ts:注入障害のコメント誤り`（Test W-010） | R3 | fix-editorial | テストは正しくコメントだけが誤り | 0 |
| `scopeTaskRunner.test.ts:再起動ケースの自明アサーション`（Test W-011） | R3 | fix | 別バックエンドで模しており「空 DB に due が無い」しか言っていない。同一 backend でコンテナだけ組み直す | 0 |
| `deleteAccount.redaction.test.ts:TC-identity-081/item ack 側の門`（Test W-012） | R3 | wont-fix | item ack 側の門は適合スイートが押さえており、ユースケーステストでの二重化は AC の要求ではない | 0 |

R3: 新規 18 / 継承 2 / fix 11 / fix-editorial 6 / wont-fix 3 / defer 0（方針フェーズ: 実施）
観点別 fix 件数: domain-usecase 0→休止 / adapter 2 / frontend 2 / security 1 / test 6（重複統合後）

## 要確認の裁定（メイン・R3）

1. **`DistributedOperationStore.markState` の遷移拘束** → **契約文を実装に合わせる（fix-editorial）**。実装側で terminal → running を `ConflictError` にするのは本 Issue の AC 外の強化で、`AccountDeletionRetryPolicy` の根拠は現状の呼び出し側が守っている。ポート定義が実装より強い約束をしている状態のほうが害なので、約束を実態に合わせる。同ポートを再利用する #7 への引き継ぎとして記録する。
2. **`testTimeout` の値** → **10s へ下げ、コメントを実測に合わせる**。実測の最遅テストは 278ms で、30s は根拠のない過剰。10s でも 35 倍の余裕がある。
3. **Frontend W-001 の再指摘防止** → **1 行の why コメントを置く**。2 ラウンド連続で誤指摘が上がっており、「Origin 検証は `start.ts` の `createCsrfMiddleware` が serverFn 全経路で行う」はまさに CLAUDE.md が言う「隠れた制約」に当たる。

## R4

| Key | 初出 | 判定 | 理由（一行） | 再指摘 |
|---|---|---|---|---|
| `identity/identityRemovalRelease.ts:ガード/再連携後の再配送`（D-W001） | R4 | fix | **再現済み・実質 Blocker**。解除 → 同 provider account を再連携 → 同イベント再配送で active claim が解放され、**別利用者が被害者の Google アカウントを奪取できる**。**裁定 1: (a) 解放前に同じ key を名乗る現行 identity が無いことを確認**（ポート不変・本 PR 範囲） | 0 |
| `workers/scopeTaskRunner.ts:settleCleanupTurn/ack 喪失の再駆動`（D-W002） | R4 | fix | **再現済み**。barrier が scope task ターンで閉じる場合、ack 喪失で削除が恒久的に `running`。plan.md が書く復旧経路（P-25 再送）は**実在しない**。**裁定 2: 最小案（runner の catch を `backoff` → `backoffOrSchedule` に寄せる）+ plan.md / progress.md の縮退記述の訂正** | 0 |
| `ports/distributedOperationStore.ts:deleteTerminal/契約欠落`（A-W001） | R4 | fix-editorial | 実装は running を `ConflictError`・unknown を no-op なのに JSDoc に記載ゼロ（ADR-026 違反） | 0 |
| `ports/scopeTaskScheduler.ts:backoff/式が 2 倍ずれ`（A-W002） | R4 | fix-editorial | JSDoc `2^attempt` に対し実装・スイートは `2^(attempt-1)`。実装が正 | 0 |
| `UsagePanel:updatedAt/時間帯表記なし`（F-W001） | R4 | fix | **裁定 4: (c)「（UTC）」の表記を足す**。UTC 固定の時刻を無表記で出しており JST 利用者には常に 9 時間前に見える | 0 |
| `DeleteAccountPanel:削除されるもの/完了文言`（F-W002） | R4 | fix | 実際に消えるのは `storage` / `usage` のみ。plan.md 自身が「File / Usage だけの部分削除を『全データ削除』と読み替えない」と明記しており UI が真逆を断言している | 0 |
| `presentation/oauthStateBinding.ts:sha256(state)/束縛の一方向性`（S-W001） | R4 | fix-editorial + defer (#20) | **裁定 3**。宣言された脅威（login CSRF）は成立しており残存経路は「未消費コールバック URL の漏洩」が前提。**JSDoc の過剰主張だけ直し、双方向化は別 Issue（#20）** | 0 |
| `worker/node/runner.ts:queue received/payload 全体をログ`（S-W002） | R4 | fix | `displayName` / `handle` / `google:<sub>` が production の info ログに出る。隣の `subscribers.ts` が既に正しい形 | 0 |
| `startOAuthFlow.test.ts:TC-identity-268/spec-sync 未記録`（T-W001） | R4 | fix-editorial | AC-33 の「spec-sync 候補を漏れなく記録」の取りこぼし | 0 |
| `deleteAccount.admission.test.ts:expectCode/クラス未固定`（T-W002） | R4 | fix | spec がクラスを名指す 2 行で、別クラスに倒れても緑。HTTP ステータス写像の入力なので実効性がある | 0 |

R4: 新規 10 / 継承 0 / fix 6 / fix-editorial 4 / wont-fix 0 / defer 1（S-W001 の設計変更分）

## 要確認の裁定（メイン・R4）

1. **D-W001 の重大度と修正方式** → **Blocker 相当として扱い、(a) を採る**（解放前に同じ key を名乗る現行 identity が無いことを確認）。(b)（receipt に directory 行の operationId を凍結して `beginRelease` で照合）はポート + 適合スイート + 全アダプターに波及するので本 PR の範囲を超える。
2. **D-W002 の修正範囲** → **最小案**（runner の catch を `backoffOrSchedule` に寄せて完了済み行を復活させる）。「再駆動さえあれば ack はやり直せる」ことが実測で確認済み。あわせて plan.md / progress.md の縮退記述（P-25 再送で復旧＝事実誤り）を訂正する。
3. **S-W001 を本 PR でやるか** → **JSDoc の過剰主張だけ直して defer**。双方向束縛はポート・memory アダプター・適合スイート・presentation・テストの 5〜8 ファイルに及び、宣言された脅威は現状で成立している。
4. **F-W001 の対応範囲** → **(c)「（UTC）」の 1 行追記**で収める。相対表記や島化は本 PR の範囲を超える。

## R5

| Key | 初出 | 判定 | 理由（一行） | 再指摘 |
|---|---|---|---|---|
| `identity/completeOAuthSignIn.ts:signInLinkedUser/Identity 行未確認`（Domain B-001） | R5 | fix | **再現済み**。spec 手順 3 の「返った UserId shard で既存 Identity と User を確認する」を落としており、**解除済み OAuth 手段でサインインが通る**（quarantine / receipt の 30 日 TTL 経過で恒久化） | 0 |
| `identity/linkOAuthIdentity.ts:existingLinkId/コメントの事実誤認`（Domain W-001） | R5 | fix | B-001 と同根で「no successful path can produce」が偽。文言も「別の利用者」と誤誘導する。**裁定 1: 新コード `PROVIDER_ACCOUNT_RELEASE_PENDING` を新設して両方に使う** | 0 |
| `identity/authResidueCleanup.ts:receipt/UoW 分離`（Domain W-002） | R5 | fix-editorial | **裁定 3**。JSDoc の理由（manifest store がこの UoW に無い）は事実誤りだが、形自体は ADR-069 が明示的に承認済みで、同一 UoW 化しても quarantine 耐性は増えない。**理由の記述のみ訂正** | 0 |
| `identity/identityRemovalRelease.ts:判定と beginRelease の TOCTOU`（Security W-001） | R5 | defer (#21) | 正しい形は `beginRelease` へのポート契約拡張で、**R4 裁定 1 が本 PR 範囲外と既決**。Node では窓がサブ ms かつ本人自身の再連携が競合する必要があり権限昇格に至らない | 0 |
| `AddPasswordForm:mismatch/確認欄が空でも送信可`（Frontend W-001） | R5 | fix | `ChangePasswordForm` / `ResetPasswordPanel` は `confirmation !== password` で無効化しており、ここだけ非対称。二重入力チェックが完全に無効 | 0 |
| `ProfileForm/editor.tsx:表示名の欄内エラー`（Frontend W-002） | R5 | wont-fix | **中核の事実主張が誤り**。`errorDisplay.ts` に `IDENTITY_INVALID_DISPLAY_NAME` は実在する。残るのは `aria-invalid` の欄割り当てのみで P-21 の状態一覧にも AC-20 にも無い | 0 |
| `DeleteAccountPanel:live region/新規マウント`（Frontend W-003） | R5 | fix | **裁定 2**。最も後戻りできない操作でフォーカスも喪失する。同 PR 内の `ResetPasswordPanel.Result` が手本を持ち 6 行で揃う | 0 |
| `{updateProfile,completeOAuthSignIn}.test.ts:activate 応答喪失の注入`（Test W-001） | R5 | wont-fix | spec 期待結果（TC-032 / TC-281）は満たしている。`confirm()===null` の release 分岐に対応する TC 行は存在せず AC-8 / AC-18 の要求外 | 0 |
| `deleteAccount.cleanup.test.ts:TC-identity-086/0 件配置`（Test W-002） | R5 | wont-fix | 0 件 seed は「最終 page が 0 件」の退化形で spec 期待結果は成立。produced-state 版が `scopeTaskRunner.test.ts` にある | 0 |
| `getUsageSnapshot.test.ts:TC-usage-055/ハードコード`（Test W-003） | R5 | wont-fix | plan.md 縮退が既に「workspace セクションは常に空配列／検証は #3」と宣言済み。自明性はその直接の帰結 | 0 |
| `vitest.config.ts:TZ 未固定/DOM-usage-004 の自明化`（Test W-004） | R5 | fix | **CI で実際に無効**（`ubuntu-latest` = UTC）。AC-1 の「BillingPeriod（UTC 暦月）」を守る唯一のテストが CI で `getMonth` 実装と区別できない | 0 |
| `deleteAccount.terminalPrune.test.ts:TC-identity-111/arranged state`（Test W-005） | R5 | wont-fix | spec 期待結果「期限後に completed receipt を回収できる」は満たされている。同一 UoW 保存の produced-state 証明は TC-identity-084 にある | 0 |

R5: 新規 12 / 継承 0 / fix 5 / fix-editorial 1 / wont-fix 5 / defer 1（方針フェーズ: 実施）
観点別 fix 件数: domain-usecase 2 / adapter 0→休止 / frontend 2 / security 0 / test 1

## 要確認の裁定（メイン・R5）

1. **B-001 / W-001 が返すエラーコード** → **新コード `PROVIDER_ACCOUNT_RELEASE_PENDING` を新設**し、`signInLinkedUser` と `existingLinkId` の両方に使う。既存の `PROVIDER_ACCOUNT_ALREADY_LINKED` の文言は「別の利用者に紐づいています」で、自分が今解除したアカウントについて出ると誤誘導になる（W-001 の実害そのもの）。
2. **Frontend W-003 を本 PR で入れるか** → **入れる**。AC-28 は読み上げまでは要求していないが、同 PR 内に手本があり 6 行で、最も後戻りできない操作でフォーカスも喪失する。
3. **Domain W-002 を構造修正まで踏み込むか** → **fix-editorial に留める**。ADR-069 が現行形を明示的に承認済みで、同一 UoW 化しても quarantine 耐性は増えない。

## R6

| Key | 初出 | 判定 | 理由（一行） | 再指摘 |
|---|---|---|---|---|
| `adapters/memory/repositories/accountDeletionManifestStore.ts:requiredReceipts/.slice 切り詰め`（Domain B-001） | R6 | wont-fix | **誤検知**。実ファイルに `.slice(0, 1)` は無く作業ツリーもクリーン。並行して走った Test 観点の変異テスト中の状態を観測したもの | 0 |
| `di/serverNode.ts:superRefine/dev IdP ガードが denylist`（Security W-001） | R6 | fix | **Warning ラベルだが実質 Blocker。再現済み**: `NODE_ENV=staging` / 空文字で本番バンドルが起動し `/dev/oauth/authorize` が 200 を返す（任意メールで全アカウント乗っ取り可）。**裁定 1: allowlist へ反転し `development` のみ受理** | 0 |
| `conformance/accountDeletionManifestStore.ts:必須 receipt の部分欠落が未検証`（Domain W-001 + Test W-003） | R6 | fix | AC-31 が両ポートに同じ担保を要求するのに兄弟スイートだけが変異を捕まえる非対称。ADR-017 の自由度に対する唯一の防波堤 | 0 |
| `ports/scopeTaskQueue.ts:listDue/ADR-005 と矛盾`（Adapter W-001） | R6 | fix-editorial | **裁定 4**。設計判断は ADR-103（Accepted）で決着済み。残るは ADR-005（Proposed）の当該段落が未更新なことだけ | 0 |
| `ports/identityRemovalReceiptStore.ts:record/冪等キーの記述誤り`（Adapter W-002） | R6 | fix | `spec/database/index.md` が `identity_id` PK と定め実装もそれに従う。JSDoc だけが誤り。適合スイートも両キー一致 fixture で判別できていない | 0 |
| `workers/subscribers.ts:storage.fileDeleted/既定レジストリ未検証`（Test W-001） | R6 | fix | AC-32 が名指す 3 イベントの 1 つ。entry 削除で全緑（変異実証済み） | 0 |
| `routes/dev/-action.tsx:submitDevConsentFn/404 ガード未検証`（Test W-005） | R6 | fix | AC-6 の一部。R1 W-T09 の修正は env→フラグ経路のみで、承認コードを実発行するこの経路を射程外にしている | 1 |
| `presentation/deletionTicket.ts:署名検証→期限判定の順序が未検証`（Test W-006） | R6 | fix | 偽造ケースの期限が遠未来のため順序入替でも緑。plan.md テスト方針が名指す ADR-006 の核心 | 0 |
| `conformance/distributedOperationStore.ts:(kind, partitionKey) の kind 側未検証`（Test W-002） | R6 | fix | **裁定 3: 本 PR で入れる**（数行で、#7 が同ポートを別 kind で再利用する）。`row.kind === kind` を落として全緑＝どこにも担保が無い | 0 |
| `conformance/noteProjection.ts:public 平面の redactAuthor/効果未検証`（Test W-004） | R6 | fix | **裁定 3: 本 PR で入れる**。適合バックエンドは `publicNoteQueryService` を公開済みで読み戻し 1 行で閉じる | 0 |
| `AddPasswordForm:<dialog>/送信中の Esc`（Frontend W-001） | R6 | fix | 「やめる」は `disabled={isPending}` で塞ぐのに Esc だけ空いている非対称。JSDoc の主張も実態と食い違う | 0 |
| `identity/updateProfile.ts:OPTIMISTIC_LOCK_FAILURE/抑止条件の広さ`（Domain W-002） | R6 | fix-editorial | 主張は成立するが残るのは TTL 10 分で自然消滅する `reserved` 行で、#9 送りの既知縮退（`active` 行の永久残留）とは重大度が別。コメントのみ訂正 | 0 |

R6: 新規 12 / 継承 0 / fix 8 / fix-editorial 2 / wont-fix 1 / defer 0（方針フェーズ: 実施）

## 要確認の裁定（メイン・R6）

1. **dev IdP の allowlist の許容値** → **`NODE_ENV === "development"` のみ受理**。未設定・空文字・`test`・`staging` を含む他の全値で起動失敗させる。`pnpm dev`（vite が `development` を立てる）だけが通り、`pnpm start` 系は値によらず必ず落ちる。CI で `readNodeServerEnv` を実 env から呼ぶ経路が無いので `test` は足さない。
2. **Security W-001 の記録上の重大度** → **「Warning ラベルだが実質 Blocker」として扱う**（R4 D-W001 / R5 Domain B-001 と同じ）。本番ビルドが乗っ取り可能な状態で起動する。
3. **適合スイートの判別性補強（Test W-002 / W-004）を本 PR に入れるか** → **入れる**。どちらも数行で、対象ファイルは他単位が触らない。defer は最終手段という基準に照らして、別 Issue を立てるほうが高くつく。
4. **Adapter W-001 の直し方** → **ADR-005 側に追記するだけ**（JSDoc・適合スイートは無変更）。設計判断は ADR-103（Accepted）で決着済み。ADR-005 の Status が Proposed のままである点も併せて整理する。

## レビュー運用の是正（R6 で発生した事故を受けて）

**変異テスト（実装を一時的に壊して落ちることを確認する手法）は、並列レビュー中に共有作業ツリーで行わない。** R6 では Test 観点のレビュアーが書き込んだ一時的な変異を、別プロセスの Domain 観点レビュアーが実装だと信じて Blocker として報告した。以降のラウンドでは:

1. 変異は隔離環境（`git worktree` 等）で行う。共有作業ツリーで `Edit` → 実行 → `git checkout` する形は、並列レビュアーがいる限り禁止
2. レビュアーへの指示に「実装の事実主張は `git status` がクリーンであることを確認してから行う」を含める
3. 「差分に含まれない変更」を根拠とする指摘は、判定前にメインが実ファイルで再確認する
