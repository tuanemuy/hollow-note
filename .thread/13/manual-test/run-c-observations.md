# Run C 観測ログ（DEV・失効／削除） — Issue #13 / PR #36

**環境:** DEV `pnpm dev` / http://localhost:3100
**セッション:** verify-run-c（+ verify-run-c2）
**セッション失効の再現手段:** `verify-run-c2` は `verify-run-c` と Cookie を共有しないため、そのままでは「別タブでサインアウト」を再現できないと判断した。代わりに、同一 `--session verify-run-c` の中で `agent-browser tab new` により Cookie を共有する第 2 タブ（t2）を開き、t2 で `/settings/profile` を開いてアカウントメニューから「サインアウト」をクリックする方式を採った。t1（観測対象タブ）はナビゲートさせず、t2 のサインアウトによる Cookie 破棄（`hollow_session` の消去）だけを t1 に反映させた。`verify-run-c2` はタスク手順どおり起動・close はしたが、Cookie 非共有のため実際のセッション失効操作には使用していない。

## エッジケース 2: preload が in-flight のままクリックすると本数が 1 本少なく出る

**期待:** クリック以降の `_serverFn` が **0 本**になることがある（`loadRouteMatch` が進行中の `loaderPromise` を見て早期 return するため）。画面は正常に描画され、redirect も背景ロード側で拾われる。これは不具合ではなく、この形で測った数値を AC の実測値として記録しないこと。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | `/notes/{noteId}` で `performance.clearResourceTimings()` を実行後、「ノート一覧」リンクを `hover` → 応答を待たずに同リンクを `click`（`hover` と `click` を同一 `batch` 呼び出しで連続実行、間に待機なし） | 遷移先 URL: `http://localhost:3100/notes`。計測スニペットで読んだ `_serverFn` エントリは **1 件**のみ: `{fn: <base64デコードで "renderNoteList_createServerFn_handler">, start: 3248, end: 3287}`。画面は `/notes` 一覧として正常に描画された。 |
| 2 | 参考として、同一手順を再度 `hover`→`click` の別呼び出しで実行 | エントリは同じく **1 件**（`renderNoteList`、start 22686 end 22707）。 |
| 3 | 参考として、`pointerenter`/`mouseenter`/`mouseover`/`click` を 1 回の `eval` 内で同期的に連続発火させた場合 | エントリは **2 件**（同じ `renderNoteList`、start 5227/end 5245 と start 5278/end 5287、間隔約 33ms）。 |

**備考:** 手順 1・2 では「クリック以降に追加で発生した `_serverFn`」が観測上 0 件（preload の 1 件のみで完結）となり、testing.md が説明する早期 return の状況と一致する形の観測が得られた。手順 3 では 2 件観測されており、preload の応答（end 5245）がクリック処理（start 5278）より先に終わっていたと見られる。ローカル in-memory バックエンドの応答が非常に高速（数十 ms）なため、「preload が確実に in-flight のまま」を毎回狙って再現できたとは言い切れない。HAR のエクスポートは行っていない（本 Issue の担当範囲は AC 実測ではなくこのエッジケースの再現確認のため、testing.md 記載のスニペット出力のみを記録した）。

## 確認項目 9: 別タブでサインアウトしたあと、既訪の `/notes` に戻るとガードが再判定される

**期待:** DEV・本番ビルドの**どちらでも** `/signin?redirect=/notes` に着く。DEV 実行は「環境差が消えたこと」の確認としてのみ記録する（`shouldReload` の有無を判別できるのは本番側の 1 回だけ）。

**観測（DEV での観測。本番ビルド側は別担当が実施）:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | t1 でサインインし `/notes` を開く | 着地 URL: `http://localhost:3100/notes` |
| 2 | t1 で一覧のノートをクリックして `/notes/{noteId}` へ遷移（両方を訪問済みにする） | 着地 URL: `http://localhost:3100/notes/01a02d56-ef05-777e-93ed-7ef09b01d778` |
| 3 | （t1 はナビゲートさせず）同一セッションの t2 で `/settings/profile` を開き、アカウントメニューから「サインアウト」をクリック | t2 の着地 URL: `http://localhost:3100/`（フルナビゲーション）。t2 の Cookie（`hollow_session`）が消去された（`cookies get --json` で確認、`cookies: []`）。 |
| 4 | t1 に戻り、上部バーの「ノート一覧」リンクをクリックして `/notes` へ移動 | 着地 URL: `http://localhost:3100/signin?redirect=%2Fnotes`（デコードすると `/signin?redirect=/notes`） |

**備考:** 本項目は DEV のみで実施した。testing.md の記載どおり、DEV では `cause === "enter"` だけで再取得されるため `shouldReload` の有無を判別できない旨を踏まえ、「環境差が消えたこと」の確認として記録する。本番ビルドでの実測は別担当の担当範囲。

## エッジケース 5: セッション失効後に `/settings` のタブへホバーしても `/signin` へナビゲートしない

**期待:** URL は **`/settings/profile` のまま**で `/signin` へナビゲートしない。ホバーぶんのガード要求は飛び、その応答は redirect だが、preload の解決として握り潰される。`main` と同じ挙動になる。**想定内（退行として記録しない）:** ホバーだけで子断片の 401 が 1 本飛び、その cached match が `status: "error"` のまま残る（画面には `ServerErrorState` は出ない）。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | t1 で再サインインし `/settings/profile` を開く。`network requests --clear` でログを初期化 | 着地 URL: `http://localhost:3100/settings/profile` |
| 2 | （t1 はナビゲートさせず）同一セッションの t2 で `/settings/profile` を開き、アカウントメニューから「サインアウト」をクリック | t2 の着地 URL: `http://localhost:3100/`。Cookie 消去を確認。 |
| 3 | t1 に戻り、タブ列の「ログイン方法」「使用量」の上にマウスを乗せるだけ（クリックしない）。3 秒待機 | `get url` の結果: `http://localhost:3100/settings/profile`（変化なし）。画面のスナップショットは「公開プロフィール」フォームのまま（`ServerErrorState` 等の表示は見られない）。 |
| 4 | ホバー後に記録されたネットワークログ（`_serverFn` フィルタ） | 3 件: `POST 200`（AccountMenu の `signOutFn`、t2 起因）、`GET 200`（`sessionUserFn`）、`GET 401`（`settings/-action.tsx` の `renderUsage...` 断片）。ログはセッション全体で共有されており t1/t2 のどちらの操作かを個別に切り分けてはいない。 |

**備考:** ネットワークログは `--session verify-run-c` 全体（t1・t2 両方）に対して記録される仕様のため、上記 4 の一覧には t2 でのサインアウト操作由来のリクエストも混在している。「ログイン方法」（`renderIdentityList`）側の 401 はこの回では観測されなかった（`renderUsage...` の 401 のみ観測）。この項目は `main` との比較実行は行っていない（担当範囲外・別担当が本番/`main` 側を実施）。

## エッジケース 6: セッション失効後に `/settings` のタブをクリックすると `/signin?redirect=<タブのパス>` に着く

**期待:** **`/signin?redirect=/settings/auth`** に着く。遷移の間、設定カラムに `ServerErrorState` が閃かない。`renderIdentityList` の 401 が 1 本残るのは想定内で、画面には出ない。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | エッジケース 5 に続けて（同一の失効済みセッション、t1 は `/settings/profile` のまま）、`network requests --clear` でログを初期化 | - |
| 2 | タブ列の「ログイン方法」をクリック | 着地 URL: `http://localhost:3100/signin?redirect=%2Fsettings%2Fauth`（デコードすると `/signin?redirect=/settings/auth`） |
| 3 | クリック直後のスナップショット | 見出し「サインイン」のサインインフォームが表示されている。`ServerErrorState` に該当する表示は見られない。 |
| 4 | ネットワークログ（`_serverFn` フィルタ） | 2 件: `GET 200`（`sessionUserFn`）、`GET 401`（`settings/-action.tsx` の `renderIde...`＝`renderIdentityList` 断片）。 |

**備考:** 期待どおり `/signin?redirect=/settings/auth` に着地し、`renderIdentityList` の 401 が 1 本残ることも観測どおり一致した。`main` との比較実行は行っていない（担当範囲外）。

## 確認項目 14: 未サインインで `/settings/danger` が開け、受理直後のリロードで進捗が復帰する

**期待:**
- 手順 1: `/signin` へ飛ばずに `/settings/danger` のパネルが描画される（この状態では上部バーもタブ列も出ない）。
- 手順 5: `/signin` へ飛ばず、`sessionStorage` に退避された ticket から進捗表示が復帰する（「アカウントを削除しています」または終端の「アカウントを削除しました」）。空の削除フォームに戻らない。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | サインアウト状態（Cookie 無しを `cookies get --json` で確認済み）で `http://localhost:3100/settings/danger` をアドレスバー相当（`open`）で直開き | 着地 URL: `http://localhost:3100/settings/danger`（`/signin` へのリダイレクトなし）。スナップショット: 見出し「設定」「アカウントを削除」、確認用メールアドレスのテキストボックス、「アカウントを削除する」ボタンのみが表示され、「検索・操作」ボタン・「アカウントメニュー」ボタン・タブ列（プロフィール／ログイン方法／使用量／アカウント削除のナビゲーション）は表示されなかった。 |
| 2 | 改めて `/signin` → Google で続ける → `/dev/oauth/authorize` でメール `nav@example.com` / 表示名「ナビ太郎」/ `email_verified` ON で「許可する」 | 着地 URL: `http://localhost:3100/notes`（サインイン済み） |
| 3 | `/settings/danger` を開き、確認欄に `nav@example.com` を入力して「アカウントを削除する」をクリックし、1 秒待機後にスナップショット | URL は `http://localhost:3100/settings/danger` のまま。スナップショット: 見出し「アカウントを削除しました」、ボタン「トップページへ」が表示された（1 秒待機の間に受理〜完了まで進んでおり、途中の「アカウントを削除しています」表示は捕捉できなかった）。 |
| 4 | 上記の画面をそのまま `reload` | 着地 URL: `http://localhost:3100/settings/danger`（`/signin` へのリダイレクトなし）。スナップショット: 見出し「アカウントを削除」、確認用メールアドレスの**空の**テキストボックス、「アカウントを削除する」ボタンが表示された（「アカウントを削除しています」「アカウントを削除しました」のいずれの進捗表示にもなっていない）。 |
| 5 | リロード後の `sessionStorage` の中身を `eval` で確認 | キーは `tsr-scroll-restoration-v1_3` のみで、削除進捗のチケットに該当するキーは見つからなかった。 |
| 6 | リロード後の Cookie を `cookies get --json` で確認 | `cookies: []`（未サインイン状態） |

**備考:** 手順 4 は期待結果の「`sessionStorage` に退避された ticket から進捗表示が復帰する（『アカウントを削除しています』または終端の『アカウントを削除しました』）。空の削除フォームに戻らない」という記載に対し、観測では空の削除フォームが再表示された。手順 3 で受理から完了までが 1 秒未満で完了しており、「受理表示が出た直後」を狙ったリロードにはならなかった点も付記する（in-memory バックエンドの応答が高速なため）。本項目の実施によりアカウント `nav@example.com` は削除された。DEV 環境ではこれが最後の確認項目。
