# Run A 観測ログ（DEV・サインイン済み） — Issue #13 / PR #36

**環境:** DEV `pnpm dev` / http://localhost:3100（起動済み環境をそのまま使用。`.env`: `APP_URL=http://localhost:3100` / `OAUTH_DEV_MODE=true` / `MEMORY_MAIL_LOG_ACTION_URL=true`）
**セッション:** verify-run-a
**計測方法:** `performance.getEntriesByType("resource")` を `eval` で実行するスニペットを使用（testing.md 記載のものを、`fn` を base64url デコードして関数名を可読化する形に拡張）。一部の確認（本数のみでよい箇所）は `network requests --filter "_serverFn" --json` でも併用。
**担当項目:** 確認項目 1, 2, 3, 4, 5, 6, 7, 12, 13, 15, 19 / エッジケース 3, 4
**対象アカウント:** dev IdP `nav@example.com` / 表示名「ナビ太郎」（Run A 内で「ナビ太郎（更新済み）」に変更、item 19 参照）
**注記（全項目共通の制約）:**
- `main` ブランチとの比較実測は本ランでは実施していない（作業ブランチのみを観測。ブランチ切替を伴う比較は別ランの担当と想定し、本ログは「今のブランチで実際に何が起きたか」のみを記録する）。
- `agent-browser` の `hover` コマンドは狙った要素で preload の `_serverFn` を発火させないことがあった（1回目の `hover e1` では発火せず、リトライで発火した等、再現性が不安定）。preload 欄が空の場合は「hover 実施したが検出されず」であり、「preload が 0 本だった」という断定ではないことに注意。
- **Network throttling（Slow 4G）を掛けるコマンドが見つからなかった。** `agent-browser --help` / `agent-browser network route --help` / `agent-browser set --help` を確認したが、レイテンシ・帯域を制御するサブコマンドは存在しない（`set` は viewport/device/geo/offline/headers/credentials/media のみ、`network route` は `--abort`/`--body` のみ）。項目 12・13・19 はこの制約下で実施した（詳細は各項目に明記）。

## 確認項目 1: `/notes` へのクライアント遷移が 1 本 / 1 段になる

**期待:** クリック以降の `_serverFn` が 1 本（`renderNoteList`）で、1 段。`main` では 3 本 / 3 段（`loadAppContext` → `sessionUserFn` → `renderNoteList` が直列）になる。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | `/notes/{noteId}` を開き、Network 静止を待つ | 到達。`link "ノート一覧" [ref=e1]` を確認 |
| 2 | `performance.clearResourceTimings()` | 実行 |
| 3 | 「ノート一覧」リンクに `hover` | preload 欄: `renderNoteList_createServerFn_handler`, start=4275, end=4291（1 本） |
| 4 | `performance.clearResourceTimings()` → リンクをクリック | URL が `http://localhost:3100/notes` に変化 |
| 5 | スニペット実行（クリック以降） | `renderNoteList_createServerFn_handler`, start=17107, end=17161 の **1 本のみ** |

**備考:** 一覧が描画され、上部バーのアカウントメニューに「ナビ」（イニシャル表示、当時アバター未設定）が表示された。

## 確認項目 2: `/notes/:noteId` へのクライアント遷移が 1 本 / 1 段になる

**期待:** クリック以降の `_serverFn` が 1 本（`renderNoteDetail`）で、1 段。`main` では 3 本 / 3 段。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | `/notes` を開き Network 静止を待つ | 到達 |
| 2 | `performance.clearResourceTimings()` → ノートカードに `hover` | preload 欄: リクエスト検出されず（`[]`） |
| 3 | `performance.clearResourceTimings()` → ノートカードをクリック | URL が `/notes/01a02d3f-6b4c-772a-b1d1-6a3c359dde1d` に変化 |
| 4 | スニペット実行 | `renderNoteDetail_createServerFn_handler`, start=40826, end=40867 の **1 本のみ** |

**備考:** ノート本文（見出し「無題」）が描画され、上部バーに「ノート一覧」リンクのみ、表示名は出ない（仕様どおり）。preload 欄が検出できなかったのは上記「hover 不安定」の制約による。

## 確認項目 3: `/notes` → `/settings/profile`（外から入る）が 2 本同時 / 1 段になる

**期待:** クリック以降の `_serverFn` が 2 本（`/settings` レイアウトのガードと `renderProfileForm`）で、1 段（`max(start) < min(end)`）。`main` では 3 本 / 3 段。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | `/notes` を開き、アカウントメニュー（e6）を開く | メニュー展開、「設定」リンク（e8）表示 |
| 2 | `performance.clearResourceTimings()` → 「設定」リンクに `hover` | preload 欄: `sessionUserFn_createServerFn_handler` start=56927 end=56963、`renderProfileForm_createServerFn_handler` start=56927 end=57077 の **2 本**、両方 start が同一（56927） |
| 3 | `performance.clearResourceTimings()` → 「設定」リンクをクリック | URL が `/settings/profile` に変化 |
| 4 | スニペット実行 | `sessionUserFn_createServerFn_handler` start=65661 end=65698、`renderProfileForm_createServerFn_handler` start=65661 end=65703 の **2 本**、両方 start が同一（65661、`max(start)=65661 < min(end)=65698` を満たす） |

**備考:** プロフィールフォーム（表示名「ナビ太郎」等）が描画された。

## 確認項目 4: `/settings/profile` → `/settings/auth`（タブ間）が 2 本同時 / 1 段になる

**期待:** クリック以降の `_serverFn` が 2 本（レイアウトのガードと `renderIdentityList`）で、1 段。`main` では 3 本 / 3 段。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | `/settings/profile` で「ログイン方法」タブに `hover` | preload 欄: `sessionUserFn_createServerFn_handler` start=73161 end=73195、`renderIdentityList_createServerFn_handler` start=73161 end=73254 の **2 本**、start 同一 |
| 2 | `performance.clearResourceTimings()` → 「ログイン方法」タブをクリック | URL が `/settings/auth` に変化 |
| 3 | スニペット実行 | `sessionUserFn_createServerFn_handler` start=81326 end=81368、`renderIdentityList_createServerFn_handler` start=81326 end=81378 の **2 本**、start 同一（81326、`max(start) < min(end)` を満たす） |

**備考:** 「有効なログイン方法」パネルが描画された。

## 確認項目 5: `/settings/profile` → `/settings/danger`（タブ間・loader なし）が 1 本 / 1 段になる

**期待:** クリック以降の `_serverFn` が 1 本（レイアウトのガード）で、1 段。`main` では 2 本 / 2 段。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | `/settings/profile` で「アカウント削除」タブに `hover` | preload 欄: `sessionUserFn_createServerFn_handler` start=91752 end=91794 の **1 本** |
| 2 | `performance.clearResourceTimings()` → 「アカウント削除」タブをクリック | URL が `/settings/danger` に変化 |
| 3 | スニペット実行 | `sessionUserFn_createServerFn_handler` start=101091 end=101134 の **1 本のみ** |

**備考:** 削除パネル（「アカウントを削除」見出し、メール確認欄、「アカウントを削除する」ボタン）が描画された。タブ列・上部バーも従来どおり表示。削除は実行していない。

## 確認項目 6: 公開ルートへのクライアント遷移が 0 本になる

**期待:** クリック（および戻る）以降の `_serverFn` が すべて 0 本。`main` ではいずれも 1 本（`loadAppContext`）。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | アカウントメニューから「サインアウト」をクリック | URL が `http://localhost:3100/` に変化 |
| 2 | `/` → 「サインイン」リンク（preload→click） | preload 0 本 / クリック後 0 本。URL `/signin` |
| 3 | `/signin` → 「アカウントを作る」リンク | preload 0 本 / クリック後 0 本。URL `/signup` |
| 4 | `/signup` → 利用規約リンク | preload 0 本 / クリック後 0 本。URL `/terms` |
| 5 | `/terms` → フッター「プライバシーポリシー」リンク | preload 0 本 / クリック後 0 本。URL `/privacy` |
| 6 | `/signin` → 「パスワードを忘れた」リンク | preload 0 本 / クリック後 0 本。URL `/reset-password` |
| 7 | `/verify-email` を直開き → 「サインインへ」リンク | preload 0 本 / クリック後 0 本。URL `/signin` |
| 8 | 上記状態からブラウザ戻る | 戻り後 0 本。URL `/verify-email` |

**備考:** 各遷移で `<title>` は正しく変化していた（各 `snapshot`/`open` の見出しで確認、例: `アカウントを作る`, `利用規約` 等）。手順 7 は「クリックして `/signin` に移り、そこから戻るで `/verify-email` に戻る」という testing.md の記述どおり、前進（クリック）と後退（戻る）の両方を測定し、いずれも 0 本だった。

## 確認項目 7: 代表ルートの `<head>` が変更前と一致する

**期待:** 7 ルート × SSR / クライアント遷移の 14 通りで `<title>` / `description` / `canonical` / `og:*` / `twitter:*` / `theme-color` が一致すること（`main` との比較は本ランでは未実施 — 上記の全体注記のとおり）。

**観測（本ランでは「SSR 出力とクライアント遷移後 DOM の内部整合性」を確認した）:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | `curl` で SSR HTML を 7 ルート取得（`/`, `/signin`, `/terms`, `/notes`, `/notes/{noteId}`, `/settings/profile` は `hollow_session` Cookie 付き、`/settings/danger` は Cookie なし） | 全 7 ルートで 200 相当の本文取得（`/settings/danger` は未サインインでもリダイレクトされず本文が返った＝ガードが redirect を投げない分岐） |
| 2 | 同 7 ルートをクライアント内遷移で開き、`document.head` から `title`/`canonical`/`og:url`/`og:title` を `eval` で抽出（`/settings/danger` の未サインイン版を除く 6 ルート） | 全 6 ルートで SSR 側と **完全一致**（例: `/notes/{noteId}` の `canonical` は SSR・クライアントとも `http://localhost:3100/notes/01a02d3f-6b4c-772a-b1d1-6a3c359dde1d`、`og:title` は `ノート — Hollow`） |
| 3 | `/settings/danger`（未サインイン）のクライアント遷移版 | **未実行**。理由: 未サインイン状態から `/settings/danger` へ到達するアプリ内リンクが見当たらなかった（公開ページに `/settings/*` へのリンクは無く、サインイン済みで開いた後にサインアウトすると URL 自体が `/` に遷移してしまうため、リンク経由のクライアント内遷移で到達する経路を確認できなかった）。SSR 版のみ手順 1 で取得済み |

**備考:** `canonical` タグは各ページで祖先ルート分も含め複数（例: `/settings/profile` は `/`, `/settings`, `/settings/profile` の 3 つ）DOM に存在していたが、SSR・クライアントいずれも同じ本数・同じ値の組み合わせだった。

## 確認項目 12: `/notes` 系はブリッジ応答の完了前にスケルトンが出る

**期待:** ガードの 1 往復ぶんは遷移がブロックされ、そのあと URL が確定して `NoteListSkeleton` / `NoteDetailSkeleton` が表示され、断片が届いた時点で本体に差し替わる。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | `/notes/{noteId}` を開き、Network throttling を「Slow 4G」に設定しようとした | **無応答（環境制約）**。`agent-browser` に network throttling を設定するコマンドが存在しない（`--help` 各所で確認、全体注記参照）。以降、通常速度（throttle 無し）で実施 |
| 2 | ホバーせず「ノート一覧」リンクを直接クリックし、直後に `snapshot` | クリック直後の snapshot はすでに `/notes` の最終コンテンツ（ノートカード一覧）を表示しており、スケルトンの過渡状態は捕捉できなかった |
| 3 | リクエストタイミングを確認 | `renderNoteList_createServerFn_handler` start=29100, end=29144（44ms で完了） |
| 4 | 2 件目のノートを新規作成し、`/notes` → 別ノート詳細へ直接クリック、直後に `snapshot` | 同様に最終コンテンツ（ノート本文）が即座に表示され、スケルトンの過渡状態は捕捉できなかった。リクエストは start=47236, end=47271（35ms） |

**備考:** Slow 4G 相当のスロットリングができなかったため、「ガード 1 往復ぶんブロックされたあとスケルトンが出て、断片到着で差し替わる」という時間的シーケンスそのものは目視で確認できていない。確認できたのは「クリック後、URL 確定とコンテンツ表示が単一の `_serverFn` 往復（30〜45ms）で完了する」という事実のみ。

## 確認項目 13: `/settings/profile` はガード応答のあとに URL が確定する

**期待:** レイアウトのガード応答が返ってから URL が `/settings/profile` に確定し、子の断片スケルトンが表示される。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | `/notes` から Network throttling「Slow 4G」設定を試行 | **無応答（環境制約、項目 12 と同一理由）**。通常速度で実施 |
| 2 | アカウントメニューの「設定」をホバーせず直接クリックし、直後に `snapshot` | URL は既に `/settings/profile` に変化。**タブ列（プロフィール/ログイン方法/使用量/アカウント削除）は描画済みだが、プロフィールフォーム本体（見出し「公開プロフィール」・入力欄）はまだ描画されていない過渡状態**を 1 回捕捉できた |
| 3 | `wait --load networkidle` 後に再 `snapshot` | フォーム本体（見出し・表示名欄「ナビ太郎」・自己紹介欄・ハンドル欄）が描画された最終状態に変化 |
| 4 | リクエストタイミング確認 | `sessionUserFn_createServerFn_handler` start=60645 end=60668、`renderProfileForm_createServerFn_handler` start=60645 end=60678（両方 start 同一） |

**備考:** Slow 4G ではないため `RoutePendingFallback` の表示有無は確認していないが、「URL 確定 → レイアウトのタブは即描画 → フォーム本体は遅れて描画」という段階的な差し替えは通常速度でも 1 回観測できた。

## 確認項目 15: 上部バーに表示名とアバターが従来どおり出る

**期待:** すべての画面で上部バーにアバター画像が出る（未設定なら表示名先頭 2 文字のイニシャル）。アカウントメニューに表示名が出る。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | `/settings/profile` で `input[type=file]` にテスト画像（1x1 PNG, 70 bytes）をアップロード | アップロード後、「画像を選ぶ」ボタンの隣に「削除」ボタンが出現。`document.querySelectorAll('img')` で `http://localhost:3100/storage/users/...` を src に持つ `<img>` を 2 件検出（編集フォーム内 + 上部バー） |
| 2 | `/notes` へ遷移 | `<img src="http://localhost:3100/storage/users/...">` を 1 件検出（上部バー） |
| 3 | `/settings/profile` | `<img>` 2 件検出（上部バー + 編集フォーム） |
| 4 | `/settings/auth` | `<img>` 1 件検出（上部バー） |
| 5 | `/settings/usage` | `<img>` 1 件検出（上部バー） |
| 6 | `/settings/danger` | `<img>` 1 件検出（上部バー） |
| 7 | `/settings/danger` でアカウントメニューを開き、`read` でテキスト取得 | 表示名行に「ナビ太郎（更新済み）」（項目 19 の手順 4 で表示名を変更済みのため）を確認 |

**備考:** `/notes/{noteId}` の `ReaderShell` は「ノート一覧」リンクのみでアカウント要素が無いこと自体は本項目の手順に含まれていなかったため個別確認はしていないが、項目 1・2 の snapshot でも上部バーのアカウントメニュー要素は出ていなかった（仕様どおり）。

## 確認項目 19: `Deferred` の deferred lane 化が他の断片ルートを壊していない

**期待:** 初回マウント（手順 1〜3）でスケルトンが出ること、ミューテーション後（手順 4〜6）は前の内容を残したまま新しい断片で置き換わること。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | Network throttling「Slow 4G」設定を試行 | **無応答（環境制約、項目 12/13 と同一理由）**。通常速度で実施 |
| 2 | `/settings/profile` → `/settings/auth` へ初回遷移、クリック直後に `snapshot` | URL は `/settings/auth` に変化済みだが、タブ列のみでコンテンツ列は空（ヘッダー「有効なログイン方法」等が未描画）の過渡状態を捕捉。`wait` 後の再 `snapshot` でログイン方法一覧が描画された |
| 3 | `/settings/auth` → `/settings/usage` へ初回遷移、クリック直後に `snapshot` | URL は `/settings/usage` に変化済みだが、**snapshot 内容は直前ページ（`/settings/auth` の「有効なログイン方法」パネル）のままだった**。`wait` 後の再 `snapshot` では使用量パネル固有の見出しはアクセシビリティツリーに現れなかったため `read` でテキスト取得し、「0 B / 5 GB」「0 件のノート」「AI 実行回数（今月）0 / 300 回」を確認（正しく使用量パネルに置き換わっていた） |
| 4 | `/notes` への初回遷移 | 項目 12 と同一操作（再確認）。クリック直後の `snapshot` は既に最終コンテンツで、過渡状態は捕捉できず |
| 5 | `/settings/profile` で表示名を「ナビ太郎（更新済み）」に変更して保存 | 保存後、フォームの表示名欄が新しい値のまま表示され続けた（元の値への巻き戻りは無し）。「変更を取り消す」「保存」ボタンは再び disabled に戻った |
| 6 | `/settings/auth` でパスワードログイン方法を追加（`Passw0rd123`） | 追加後、一覧が「解除」ボタン 2 つ（Google + パスワード）と「パスワードを変更」セクションに更新された（「パスワードを追加」ボタンは消えた）。巻き戻りは無し |
| 7 | `/notes` で「新規作成」→ 詳細 → 上部バー「ノート一覧」で戻る | ノート一覧が 2 件 → 3 件に増えていることを確認（新規ノートが一覧に反映） |

**備考:** 手順 3 で「初回遷移直後に前ページのコンテンツが一瞬残る」という状態を観測したが、これが `useDeferredValue` の deferred lane によるものか、ルーターの pending 表示（前の match の描画保持）によるものかは、本ランの観測だけでは切り分けられない（原因分析はしない方針のため事実のみ記録）。`ProfileFormSkeleton` / `IdentityListSkeleton` / `UsagePanelSkeleton` / `NoteListSkeleton` という具体的なスケルトンコンポーネントの出現有無は、アクセシビリティツリーに現れない要素であることと Slow 4G が掛けられなかったことの両方から、視覚的に確認できていない。

## エッジケース 3: `/settings` のタブにホバーするたびレイアウトのガード要求が 1 本飛ぶ

**期待:** ホバーごとにレイアウトのガード要求 + 子の断片 preload が飛ぶ（`main` と本数が変わらない）。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | `/settings/profile` を開き、「ログイン方法」タブに 1 回目の `hover` | `sessionUserFn_createServerFn_handler` start=7802 end=7809、`renderIdentityList_createServerFn_handler` start=7802 end=7811 の **2 本**（同時） |
| 2 | 別要素にホバーして外し、「ログイン方法」タブに 2 回目の `hover`（同一タブへの再ホバー） | `sessionUserFn_createServerFn_handler` start=16918 end=16926 の **1 本のみ**（`renderIdentityList` は再発火せず） |
| 3 | 別要素にホバーして外し、「使用量」タブに（初回）`hover` | `sessionUserFn_createServerFn_handler` start=29527 end=29551、`renderUsagePanel_createServerFn_handler` start=29528 end=29559 の **2 本**（同時） |
| 4 | `/notes` を開き、ノートカードに 1 回目の `hover` | 1 本（renderNoteDetail 相当、start=5149 end=5175） |
| 5 | 別要素にホバーして外し、同じノートカードに 2 回目の `hover` | **0 本**（リクエスト検出されず） |

**備考:** 「同一タブへの 2 回目以降のホバーではレイアウトガードのみ 1 本（子の断片 preload は再発火しない）」という挙動を確認した。これが `main` と比べて本数が減っているのか同じなのかは、本ランでは `main` 側を測っていないため比較できていない（全体注記のとおり）。「`/notes` 側でホバーを繰り返しても要求が飛ばない」ことは手順 4・5 で確認した。

## エッジケース 4: `/` へのクライアント遷移が 1 本になる（スコープ外の記録項目）

**期待:** クリック以降の `_serverFn` が 1 本（`sessionUserFn`）で、1 段。`main` では 2 本。

**観測:**
| # | 操作 | 観測した内容 |
| --- | --- | --- |
| 1 | 未サインインで `/signin` を開く | 到達 |
| 2 | `performance.clearResourceTimings()` → ロゴ「Hollow のトップへ」に `hover` | preload 欄: `sessionUserFn_createServerFn_handler`（base64 デコードで確認、ファイルは `app/presentation/auth.ts`）start=3294, end=3298 の **1 本** |
| 3 | `performance.clearResourceTimings()` → ロゴをクリック | URL が `http://localhost:3100/` に変化。スニペット実行結果: `sessionUserFn_createServerFn_handler` start=11827 end=11864、**および** `sessionUserFn_createServerFn_handler` start=11892 end=11897 の **2 本**（2 本目の start=11892 は 1 本目の end=11864 より後 = 直列） |
| 4 | 再現性確認のため `/signin` に開き直し、今度はホバーせず直接ロゴをクリック | URL が `/` に変化。`sessionUserFn_createServerFn_handler` start=3871 end=3892、**および** `sessionUserFn_createServerFn_handler` start=3894 end=3903 の **2 本**（2 本目の start=3894 は 1 本目の end=3892 より後 = 直列）。手順 3 と同じパターンで再現 |

**備考:** **期待（1 本 / 1 段）と観測（2 本 / 2 段、いずれも `sessionUserFn`）が一致しなかった。** 2 回とも同一パターン（`sessionUserFn` が時間差で 2 回、後続が先行の応答完了後に開始）で再現している。`main` との比較は本ランでは実施していないため、`main` でも同様に 2 本なのか、ブランチ側で増えているのかは本ログだけでは判別できない（原因分析はしない方針のため、事実のみ記録）。
