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
