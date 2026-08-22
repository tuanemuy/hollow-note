# ブラウザ観測結果 Run A — Issue #20（項目1〜6 + エッジ2）

**実行日:** 2026-08-22
**サーバー:** http://localhost:3100

## ツールの制約について（先に記載）

`agent-browser network request <id>` は、レスポンスヘッダーオブジェクト（`Access-Control-Allow-Origin` / `Connection` / `Date` / `Keep-Alive` / `Transfer-Encoding` / `Vary` / `cache-control` / `content-security-policy` / `content-type` / `referrer-policy` / `x-content-type-options` / `x-tss-serialized`）を返したが、**`set-cookie` キーは含まれなかった**（`--json` / `--body` / `--raw` いずれのオプションでも同じ）。また応答ボディも取得できなかった（`--body` を付けても postData 以外の本文フィールドは返らない）。そのため項目1・2 の「応答ヘッダーの set-cookie 全文」「応答ボディに state が含まれないこと」は、`network request` からは直接確認できず、`cookies get --json` で反映結果（値・属性）を確認する形で代替した。

## 項目 1: 束縛 Cookie の値が `state` から計算できない独立した乱数である

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 1 | `/signin` を開く | サインイン画面表示 | 表示された（`heading "サインイン"`） |
| 2 | `network requests --clear` → 「Google で続ける」押下 | POST が発生する | POST `http://localhost:3100/_serverFn/...startOAuthSignInFn...` (requestId `57998.223`, status 200) を記録 |
| 3 | POST の応答ヘッダー `set-cookie` を読む | `hollow_oauth_state=<値>` | `network request` の `responseHeaders` に `set-cookie` キーは存在しなかった（上記「ツールの制約」参照）。`cookies get --json` で確認した実際の値: `dFO57QySXp6yNPZ9qgHI6ZcCpI20DTwGlXdjfjI0-HE` |
| 4 | 遷移先 URL の `state` を控える | — | `get url` = `http://localhost:3100/dev/oauth/authorize?client_id=dev-google&redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback%2Fgoogle&response_type=code&scope=openid+email+profile&state=976dm8BwZtyL-daeMlmcTjDOJBgo4sbmNJjamc_5KG0&code_challenge=lxIl7qD_r-0cbpkKKZ_SJxRVam61iwL6T_IppO6HsI4&code_challenge_method=S256` |
| 5 | `cookies get --json` の値が手順3と一致するか | 一致 | `hollow_oauth_state` value = `dFO57QySXp6yNPZ9qgHI6ZcCpI20DTwGlXdjfjI0-HE`（手順3と同一値） |
| 6 | `sha256(state)` を計算 | 64 hex | `c30314951c24f6f34c4034733f8316c056c7f71a5764a10a5cf2975e5a49a321` |

**期待結果との比較（事実のみ）:**
- Cookie 値 `dFO57QySXp6yNPZ9qgHI6ZcCpI20DTwGlXdjfjI0-HE`（43文字、`[A-Za-z0-9_-]` のみ）は `state` の値 `976dm8BwZtyL-daeMlmcTjDOJBgo4sbmNJjamc_5KG0`（43文字）と**不一致**
- Cookie 値は `sha256(state)` = `c30314951c24f6f34c4034733f8316c056c7f71a5764a10a5cf2975e5a49a321` とも**不一致**
- Cookie 値は `state` の部分文字列でも、`state` を含む文字列でもない
- `authorizationUrl`（遷移先URL、上記手順4）にも同意画面URLにも Cookie 値 `dFO57QySXp6yNPZ9qgHI6ZcCpI20DTwGlXdjfjI0-HE` は現れなかった
- POST の応答ボディは `network request` からは取得できず、`state` の有無は直接確認できなかった（ツール制約）

## 項目 2: `Set-Cookie` の属性と寿命が現状のまま

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 1 | `set-cookie` ヘッダー全文を読む | — | `network request` からは取得不可（項目1参照）。以下は `cookies get --json` による代替確認 |
| 2 | `cookies get --json` の属性 | HttpOnly / SameSite=Lax / Path=/ / Secure なし / 発行10分後に失効 | `httpOnly: true`, `sameSite: "Lax"`, `path: "/"`, `secure: false`, `expires: 1787389919.641738` |
| 3 | `eval "document.cookie"` | `hollow_oauth_state` が出ない | 結果は空文字 `""` |

**期待結果との比較（事実のみ）:**
- POST 応答のタイムスタンプ（1787389319565ms = 2026-08-22T09:01:59.565Z）と `expires`（2026-08-22T09:11:59.641Z）の差は **600.077秒（約10分0秒）**
- `httpOnly: true`, `sameSite: "Lax"`, `path: "/"`, `secure: false` を観測（期待どおり Secure なし）
- `document.cookie` は空文字で `hollow_oauth_state` は現れなかった

## 項目 3: 正しい束縛でサインインが完了する

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 1 | メール `bind-a@example.com`、表示名 `束縛太郎`、`email_verified` ON にして「許可する」 | — | フォームの `email_verified` チェックボックスは既定で `checked=true`（変更不要）。入力後クリック実行 |
| 2 | 遷移先の表示 | 「手続きを完了しています」→成功→`/notes` | `get url` は既に `http://localhost:3100/notes` になっていた（遷移が速く「手続きを完了しています」の中間表示は個別のスナップショットで捕捉できなかった） |
| 3 | `cookies get --json` | `hollow_oauth_state` 消滅、新規セッション Cookie | `hollow_oauth_state` は存在せず、`hollow_session`（httpOnly:true, sameSite:Lax, path:/, secure:false, session:false, expires:1789981387.368319, value:`MDFhMDI4YjUtYTI2NS03NDRhLWIwNWUtNWRjMjc2YWM4NTNi.nv0CIr_K4DeT2-qReY0aydnGn_KKGwjGZDDyU3oxHJ8`）が新規に存在 |
| 4 | アカウントメニューを開く | `束縛太郎` 表示 | ヘッダーのテキストに `束縛`／`束縛太郎` が表示されていることを確認 |

**結論:** 正常系は最後まで実行でき、期待結果と一致する観測が得られた（以降の項目を続行）。

## 項目 4: `state` だけを知る第三者は照合を通せない

**開始時刻:** 2026-08-22T09:03:20Z (UTC)

**手順1（サインアウト→再度「Google で続ける」）:**
- サインアウト後 `get url` = `http://localhost:3100/`
- `/signin` → 「Google で続ける」押下後の URL: `http://localhost:3100/dev/oauth/authorize?client_id=dev-google&redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fcallback%2Fgoogle&response_type=code&scope=openid+email+profile&state=4rfgJzA-IIl91jIXsDc1DL1fUvwzNBT6ZDRLXn9nbng&code_challenge=-0bChC-wPpI93cHO0sqoHZEMyfeAornyUR7MQjJHwAU&code_challenge_method=S256`

**手順2（控えた正しい値）:**
- state = `4rfgJzA-IIl91jIXsDc1DL1fUvwzNBT6ZDRLXn9nbng`
- 正しい `hollow_oauth_state` 値 = `CeLoxAYy2dKpjASCtoweA4xFkZjUpE3nkIQrzruvtWc`
- 属性: `httpOnly: true, sameSite: "Lax", path: "/", secure: false, expires: 1787390004.544578`

| # | Cookie に設定した値 | 期待結果 | 実際の画面 | 実際の `hollow_oauth_state`（消費要求後） |
|---|---|---|---|---|
| 4 | `state` の値そのもの (`4rfgJzA-...`) | 失敗表示・再試行なし | `heading "手続きを完了できませんでした"` + `link "Hollow に戻る"` のみ（再試行ボタンなし） | 残存。value=`4rfgJzA-IIl91jIXsDc1DL1fUvwzNBT6ZDRLXn9nbng`（size 61） |
| 7 | `sha256(state)` (`5d60250853fb50d1a7eb1e4376983b3037ca79e41daae42dc5b80c94ff1bef2e`) | 失敗表示・再試行なし | 同上（「手続きを完了できませんでした」＋「Hollow に戻る」のみ） | 残存。value=`5d60250853fb50d1a7eb1e4376983b3037ca79e41daae42dc5b80c94ff1bef2e`（size 82） |
| 8 | `x` | 失敗表示・再試行なし | 同上 | 残存。value=`x`（size 19） |
| 9 | 空文字 `""` | 失敗表示・再試行なし | 同上 | 残存。value=`""`（size 18） |

コールバック URL（4回とも共通）: `http://localhost:3100/auth/callback/google?code=eyJ2IjoxLCJwcm92aWRlckFjY291bnRJZCI6IjM3NTY4OWQ4ZWIxNzQwOGNkZjRjMmRmM2Y1ZWU0ZTU1IiwiZW1haWwiOiJiaW5kLWFAZXhhbXBsZS5jb20iLCJlbWFpbFZlcmlmaWVkIjp0cnVlLCJkaXNwbGF5TmFtZSI6Iuadn-e4m-WkqumDjiIsImNvZGVDaGFsbGVuZ2UiOiItMGJDaEMtd1BwSTkzY0hPMHNxb0haRU15ZmVBb3JueVVSN01RakpId0FVIn0&state=4rfgJzA-IIl91jIXsDc1DL1fUvwzNBT6ZDRLXn9nbng`

## 項目 5: 束縛 Cookie を持たない消費要求は `state` を消費しない

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 1 | ウィンドウ2（Cookie を `cookies clear` 済み）で項目4のコールバック URL を開く | 失敗表示 | `heading "手続きを完了できませんでした"` + `link "Hollow に戻る"` |
| 2 | 画面表示 | 同上 | 同上 |
| 3 | `cookies get --json` | `hollow_oauth_state` が作られない | `cookies: []`（何も作られなかった） |

## 項目 6: 束縛が一致しなければ `state` は消費されない（後から正しい束縛で完了できる）

**開始時刻（項目4開始）:** 2026-08-22T09:03:20Z (UTC)
**実行時刻（項目6・1回目、手順ミス）:** 2026-08-22T09:04:07Z (UTC)
**実行時刻（項目6・訂正後の再実行）:** 2026-08-22T09:04:25Z (UTC)

**手順の実行ミスと訂正について（そのまま記録）:** 手順1で Cookie を「正しい値」に戻す際、誤って `state` の値 (`4rfgJzA-IIl91jIXsDc1DL1fUvwzNBT6ZDRLXn9nbng`) を再設定してしまった。その状態でコールバック URL を開いたところ「手続きを完了できませんでした」（失敗）となった（これは項目4の延長の再現であり、項目6の検証結果ではない）。直後に Cookie を項目4手順2で控えた正しい値 `CeLoxAYy2dKpjASCtoweA4xFkZjUpE3nkIQrzruvtWc` に設定し直し、同じコールバック URL を再度開いた。

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 1 | `hollow_oauth_state` を正しい値 `CeLoxAYy2dKpjASCtoweA4xFkZjUpE3nkIQrzruvtWc` に設定 | — | `cookies get --json` で value 一致を確認 |
| 2 | コールバック URL を開き直す | サインイン完了・`/notes` へ遷移 | `get url` = `http://localhost:3100/notes` |
| 3 | 画面・アカウントメニュー | `束縛太郎` 表示 | `get text header` に `束縛`／`束縛太郎` を確認 |
| 4 | `cookies get --json` | `hollow_oauth_state` 消滅 | `hollow_oauth_state` なし。`hollow_session`（value=`MDFhMDI4YjUtYTI2NS03NDRhLWIwNWUtNWRjMjc2YWM4NTNi.oEV0gr1F-mWwlyiZ9Yxk2bc5wLMeNLiUf74j380fMk4`、httpOnly:true, sameSite:Lax, path:/, secure:false, expires:1789981474.990478）が新規に存在 |

項目4開始（09:03:20Z）から項目6訂正後実行（09:04:25Z）までの経過時間: 約65秒（10分の TTL 内）。

## エッジケース: 成功したコールバック URL をもう一度開く

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|---|---|---|
| 1 | 項目6手順2 で成功したコールバック URL をウィンドウ1で再度開く | サインイン状態は維持、コールバック画面は失敗表示 | `get url` はコールバック URL のまま、`heading "手続きを完了できませんでした"` + `link "Hollow に戻る"` を表示。続けて `/notes` を開くと `get text header` に `束縛` が表示され、`hollow_session` の value（`...oEV0gr1F...`）は変わらずサインイン状態が維持されていた |

**控えた値:**
- 項目1 state: `976dm8BwZtyL-daeMlmcTjDOJBgo4sbmNJjamc_5KG0`
- 項目1 Cookie 値: `dFO57QySXp6yNPZ9qgHI6ZcCpI20DTwGlXdjfjI0-HE`
- 項目1 sha256(state): `c30314951c24f6f34c4034733f8316c056c7f71a5764a10a5cf2975e5a49a321`
- 項目4/6 state: `4rfgJzA-IIl91jIXsDc1DL1fUvwzNBT6ZDRLXn9nbng`
- 項目4/6 正しい Cookie 値: `CeLoxAYy2dKpjASCtoweA4xFkZjUpE3nkIQrzruvtWc`
- 項目4 sha256(state): `5d60250853fb50d1a7eb1e4376983b3037ca79e41daae42dc5b80c94ff1bef2e`
- コールバック URL（項目4〜6・エッジケース共通）: `http://localhost:3100/auth/callback/google?code=eyJ2IjoxLCJwcm92aWRlckFjY291bnRJZCI6IjM3NTY4OWQ4ZWIxNzQwOGNkZjRjMmRmM2Y1ZWU0ZTU1IiwiZW1haWwiOiJiaW5kLWFAZXhhbXBsZS5jb20iLCJlbWFpbFZlcmlmaWVkIjp0cnVlLCJkaXNwbGF5TmFtZSI6Iuadn-e4m-WkqumDjiIsImNvZGVDaGFsbGVuZ2UiOiItMGJDaEMtd1BwSTkzY0hPMHNxb0haRU15ZmVBb3JueVVSN01RakpId0FVIn0&state=4rfgJzA-IIl91jIXsDc1DL1fUvwzNBT6ZDRLXn9nbng`
