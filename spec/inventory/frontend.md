# Inventory — frontend

生成元: `spec/pages/`、`spec/presentation/`（最終同期: 2026-08-16）

| ID | 要素 | 定義場所 | 実装されるべき振る舞いの要点 |
| --- | --- | --- | --- |
| PAGE-p01-001 | P-01 サインアップページ | `spec/pages/index.md#P-01: サインアップ` | メール・パスワード・強度・規約同意・Google・招待元情報を 1 カラムで表示し、入力、項目エラー、送信、通常完了、招待経由完了、全体エラーを表現する |
| PAGE-p01-002 | パスワードでサインアップ | `spec/pages/index.md#P-01: サインアップ` | メール、パスワード、表示名、規約同意、任意の招待 token を送信し、未確認なら確認メール案内、招待適合時は session Cookie を安全属性付きで受けて招待確認へ戻る。発信元単位の rate limit を扱う |
| PAGE-p01-003 | Google サインアップを開始 | `spec/pages/index.md#P-01: サインアップ` | sign-in intent の Google OAuth 認可へ遷移し、同一オリジンの復帰先を保持する |
| PAGE-p01-004 | サインインへ移動 | `spec/pages/index.md#P-01: サインアップ` | 入力中でも明示操作で P-02 へ遷移する |
| PAGE-p02-001 | P-02 サインインページ | `spec/pages/index.md#P-02: サインイン` | メール・パスワード・Google・再設定・登録導線を表示し、認証失敗、未確認、待機、ロック、送信、成功を次の一手が異なる状態として表現する |
| PAGE-p02-002 | パスワードでサインイン | `spec/pages/index.md#P-02: サインイン` | メール、パスワード、発信元 key を送信し、成功時は HttpOnly・Secure・SameSite=Lax の session Cookie を設定して元の遷移先へ戻る。`THROTTLED` と `LOCKED` の待機情報・解除導線を分ける |
| PAGE-p02-003 | Google サインインを開始 | `spec/pages/index.md#P-02: サインイン` | Google OAuth 認可へ遷移し、state・PKCE と元の同一オリジン遷移先を維持する |
| PAGE-p02-004 | パスワード再設定へ移動 | `spec/pages/index.md#P-02: サインイン` | P-04 の申請状態へ遷移する |
| PAGE-p02-005 | サインアップへ移動 | `spec/pages/index.md#P-02: サインイン` | P-01 へ遷移する |
| PAGE-p02-006 | 確認メールを再送 | `spec/pages/index.md#P-02: サインイン` | 未確認状態からメール再送を要求し、存在や発行制限を漏らさない同一の完了表示にする |
| PAGE-p03-001 | P-03 メール確認ページ | `spec/pages/index.md#P-03: メール確認` | token 処理中、成功、確認済み・サインインが必要、使用済み、期限切れ、無効、一時障害（再試行）の 7 状態を表示し、成功時は session Cookie 設定後にアプリへ遷移する。「確認済み・サインインが必要」は、確認を要求したブラウザーの印（確認待ち Cookie）が無い、または確認した token の持ち主と一致しない場合に出る（別ブラウザーで開いた場合が代表例だが、Cookie 削除・プライベートウィンドウ・確認待ち Cookie の寿命切れでも到達する） |
| PAGE-p03-002 | 確認 token を消費 | `spec/pages/index.md#P-03: メール確認` | URL token を一度だけ検証要求へ渡し、成功・既確認・確認済み（確認要求元のブラウザーではないためセッションを発行しない）・期限切れ・無効・一時障害に応じて状態を切り替える |
| PAGE-p03-003 | 確認メールを再送 | `spec/pages/index.md#P-03: メール確認` | 期限切れ・無効の状態から email を送信して、存在秘匿された再送完了を表示する |
| PAGE-p03-004 | サインインへ移動 | `spec/pages/index.md#P-03: メール確認` | 確認済み・サインインが必要 / 使用済み / 期限切れ / 無効の 4 状態から P-02 へ遷移する。期限切れ・無効では主導線が再送であり、サインインは再送フォームに従属する逃げ道として置く |
| PAGE-p04-001 | P-04 パスワード再設定ページ | `spec/pages/index.md#P-04: パスワード再設定` | email による申請と token による新 password 設定を扱い、送信中、一定文言の申請完了、実行成功、token 無効・期限切れを表示する |
| PAGE-p04-002 | パスワード再設定を申請 | `spec/pages/index.md#P-04: パスワード再設定` | email を送信し、利用者・password identity の有無によらず同一の完了文言を表示する |
| PAGE-p04-003 | 新しいパスワードを設定 | `spec/pages/index.md#P-04: パスワード再設定` | token と一致確認済みの新 password を送信し、強度違反、token 無効・期限切れ、成功を表示する |
| PAGE-p04-004 | 再申請へ戻る | `spec/pages/index.md#P-04: パスワード再設定` | token 無効・期限切れから申請フォームへ状態遷移する |
| PAGE-p05-001 | P-05 OAuth コールバックページ | `spec/pages/index.md#P-05: OAuth コールバック` | Google・OpenRouter の callback を処理中、成功、cancel、state・期限・通信失敗、scope 不足として表示し、成功時は保存済み復帰先へ戻る |
| PAGE-p05-002 | OAuth callback を完了 | `spec/pages/index.md#P-05: OAuth コールバック` | provider、state、code を callback 完了 action に渡し、state 単回消費と PKCE を経て sign-in session または integration 接続を確定する |
| PAGE-p05-003 | OAuth を再許可 | `spec/pages/index.md#P-05: OAuth コールバック` | scope 不足・失効状態から同じ provider の認可開始へ戻る |
| PAGE-p06-001 | P-06 招待確認ページ | `spec/pages/index.md#P-06: 招待の確認` | workspace、説明、role、招待者を表示し、未 sign-in、期限切れ、revoked、used、already member、workspace missing、処理中、完了を区別する |
| PAGE-p06-002 | 招待 preview を取得 | `spec/pages/index.md#P-06: 招待の確認` | URL token と任意 user session を送って、参加前情報と受諾可否状態を取得する |
| PAGE-p06-003 | 招待を受諾 | `spec/pages/index.md#P-06: 招待の確認` | sign-in 済み user と token を送信し、membership 作成後に対象 workspace 文脈へ遷移する |
| PAGE-p06-004 | 認証して招待へ復帰 | `spec/pages/index.md#P-06: 招待の確認` | 未 sign-in 時に invitation URL を安全な同一オリジン復帰先として P-01 または P-02 へ遷移する |
| PAGE-p06-005 | 招待を辞退 | `spec/pages/index.md#P-06: 招待の確認` | server state を変更せずトップまたは元画面へ遷移する |
| PAGE-p10-001 | P-10 ノート一覧ページ | `spec/pages/index.md#P-10: ノート一覧` | current scope の notes を tile・list・calendar で表示し、loading、追加読込、空、絞込ゼロ、error、selection、bulk progress・結果を持つ。viewer は download 以外の bulk 操作を隠す |
| PAGE-p10-002 | 一覧表示形式・並び順を変更 | `spec/pages/index.md#P-10: ノート一覧` | tile・list・calendar と sort を選び、current scope・filters を保った一覧 query に反映する |
| PAGE-p10-003 | コマンドパレットで検索・絞り込み | `spec/pages/index.md#P-10: ノート一覧` | keyword、tag、作成月を current scope に固定して適用し、条件 chip と URL state を更新する。chip 解除・mobile bottom sheet も同じ条件モデルを使う |
| PAGE-p10-004 | ノートを追加読込 | `spec/pages/index.md#P-10: ノート一覧` | current filters と pagination で次 page を取得し、既存一覧へ重複なく追加する |
| PAGE-p10-005 | ノートを開く | `spec/pages/index.md#P-10: ノート一覧` | 選択 note の current scope 用 P-11 URL へ遷移する |
| PAGE-p10-006 | ノートへインラインでタグを追加 | `spec/pages/index.md#P-10: ノート一覧` | tag 候補を取得して assignment を楽観更新し、失敗時に巻き戻す |
| PAGE-p10-007 | ノートメニューから操作へ進む | `spec/pages/index.md#P-10: ノート一覧` | 権限に応じて公開、移動、download、trash など対象 note の操作または P-11 へ遷移する |
| PAGE-p10-008 | 選択モードを開始・終了 | `spec/pages/index.md#P-10: ノート一覧` | current source scope 内の note IDs だけを selection に保持し、終了時に selection と bulk bar を解除する |
| PAGE-p10-009 | 選択ノートへタグを一括適用 | `spec/pages/index.md#P-10: ノート一覧` | source ScopeKey と IDs、add・remove tag operation を送信し、parent job と skipped の note・理由を表示する |
| PAGE-p10-010 | 選択ノートの公開範囲を一括変更 | `spec/pages/index.md#P-10: ノート一覧` | source ScopeKey と visibility を送信し、handle・slug 不足を全体エラー、個別除外を理由付き結果として示す |
| PAGE-p10-011 | 選択ノートを一括移動 | `spec/pages/index.md#P-10: ノート一覧` | target owner と source scope を送信し、閲覧喪失・drop tags の warning を確認して bulk move job を開始する |
| PAGE-p10-012 | 選択ノートを一括バックアップ | `spec/pages/index.md#P-10: ノート一覧` | Drive 接続と editor 権限のある選択を送信し、not found・permission denied・source file なしの skipped を note ごとに表示する |
| PAGE-p10-013 | 選択ノートを一括ダウンロード | `spec/pages/index.md#P-10: ノート一覧` | format と source scope を送信して bulk export を開始し、同一 user の実行中 slot があれば受付不可として完了後の再実行を案内する |
| PAGE-p10-014 | 選択ノートを一括削除 | `spec/pages/index.md#P-10: ノート一覧` | 確認後に bulk trash を登録し、権限外・not found を理由付きで表示する |
| PAGE-p10-015 | 新規ノート作成へ移動 | `spec/pages/index.md#P-10: ノート一覧` | current scope を取り込み先として P-12 の new URL へ遷移する |
| PAGE-p10-016 | アップロードへ移動・ファイルを drop | `spec/pages/index.md#P-10: ノート一覧` | 上部導線は current scope 付き P-13 へ遷移し、drop 時は files をその画面へ引き渡す |
| PAGE-p11-001 | P-11 ノート詳細ページ | `spec/pages/index.md#P-11: ノート詳細` | isolated 本文、title、tags、visibility、share、source、backup、headings、reference provenance を表示し、loading、processing、integration wait、failure、read-only、not found、optimistic mutation、download states を表現する |
| PAGE-p11-002 | タイトルを変更 | `spec/pages/index.md#P-11: ノート詳細` | expected version 付き rename を楽観適用し、競合・validation・権限失敗で巻き戻す |
| PAGE-p11-003 | タグを追加・削除 | `spec/pages/index.md#P-11: ノート詳細` | current note scope で tag suggestion、assign、unassign を行い、結果を楽観更新する |
| PAGE-p11-004 | 公開範囲を変更 | `spec/pages/index.md#P-11: ノート詳細` | private・unlisted・public と expected version を送信し、public handle・slug 不足、空本文を表示し、unlisted の share URL を受け取る |
| PAGE-p11-005 | 共有パスワードを設定・解除 | `spec/pages/index.md#P-11: ノート詳細` | unlisted note の password を送信し、強度・状態エラーを表示して `hasSharePassword` を更新する |
| PAGE-p11-006 | 共有リンクを再発行 | `spec/pages/index.md#P-11: ノート詳細` | 確認後に expected version 付き再発行を行い、新 URL を表示して旧 URL が無効になったことを示す |
| PAGE-p11-007 | ノート編集へ移動 | `spec/pages/index.md#P-11: ノート詳細` | edit 権限がある場合だけ current note の P-12 URL へ遷移する |
| PAGE-p11-008 | 表示スタイルを変更 | `spec/pages/index.md#P-11: ノート詳細` | `default`・`preserve` と expected version を送信し、本文描画へ即時反映して失敗時に戻す |
| PAGE-p11-009 | ノートを移動 | `spec/pages/index.md#P-11: ノート詳細` | target owner と expected version を送信し、dropped tags を表示して route switch 後の canonical scope URL へ遷移する |
| PAGE-p11-010 | LLM または元ファイルから再生成 | `spec/pages/index.md#P-11: ノート詳細` | source、任意 instruction・model を送信して regeneration job を開始し、未接続・失効・source 不在・duplicate を次の一手付きで示す |
| PAGE-p11-011 | Drive へバックアップ | `spec/pages/index.md#P-11: ノート詳細` | editor 以上で note ID と source scope を送信し、未接続・source file なし・duplicate を表示する |
| PAGE-p11-012 | ノートをダウンロード | `spec/pages/index.md#P-11: ノート詳細` | HTML・Markdown は即時保存し、PDF は signed ExportTicket を画面 state にのみ保持して status polling と 5 分 URL 取得まで進める。ticket を URL・Cookie に載せず、権限喪失、ticket・artifact 期限、相乗りを扱う |
| PAGE-p11-013 | ノートをゴミ箱へ移す | `spec/pages/index.md#P-11: ノート詳細` | 確認後 expected version を送信し、関連 jobs の取消を含む結果を反映して一覧へ戻る |
| PAGE-p11-014 | 見出しへ移動 | `spec/pages/index.md#P-11: ノート詳細` | 折りたたみ見出し一覧から本文内 anchor へスクロールし、URL fragment を更新する |
| PAGE-p12-001 | P-12 ノート編集ページ | `spec/pages/index.md#P-12: ノート編集` | new・existing note を visual・HTML・WYSIWYG で編集し、title、media、autosave、revision、external reference option を扱う。保存・競合・offline・lock・権限喪失・sanitize・media states を表現する |
| PAGE-p12-002 | 新規ノートの保存を開始 | `spec/pages/index.md#P-12: ノート編集` | 初回 autosave で current owner に private blank note を作り、返った note ID の edit URL へ置換する |
| PAGE-p12-003 | 編集モードを切り替え | `spec/pages/index.md#P-12: ノート編集` | visual・HTML・WYSIWYG を切替え、WYSIWYG の損失 warning を確認し、既存 note の端末内 preference だけを保存する |
| PAGE-p12-004 | 本文を自動保存 | `spec/pages/index.md#P-12: ノート編集` | mode に応じて text-node edits または raw HTML、expected version、reference import option を送信し、pending・saved・unsaved、sanitize removals、processing lock、競合を扱う |
| PAGE-p12-005 | タイトルを保存 | `spec/pages/index.md#P-12: ノート編集` | expected version 付き title 変更を autosave 系列に統合し、本文更新との version 競合を再取得で解決する |
| PAGE-p12-006 | メディアを挿入 | `spec/pages/index.md#P-12: ノート編集` | file を送信し、進捗・形式・size・quota・権限失敗を表示して返った internal URL を本文へ挿入する |
| PAGE-p12-007 | 過去の版を復元 | `spec/pages/index.md#P-12: ノート編集` | revisions を取得し、対象 revision と expected version を送信して復元後本文を再取得する。外部参照再取り込みの進捗は P-11 へ委ねる |
| PAGE-p12-008 | 編集を破棄して戻る | `spec/pages/index.md#P-12: ノート編集` | 未保存内容があれば確認し、破棄または local fallback 保存後に P-11 へ遷移する |
| PAGE-p13-001 | P-13 アップロードページ | `spec/pages/index.md#P-13: アップロード` | files、検証、owner、visibility、conversion preference、LLM warning、全体・個別進捗、cancel、結果内訳を表示する。public handle 不足と machine-only 不可を開始前に案内する |
| PAGE-p13-002 | ファイル・フォルダを選択 | `spec/pages/index.md#P-13: アップロード` | chooser または drop から files を列挙し、name・size・宣言形式を検証して除外可能な選択一覧を作る |
| PAGE-p13-003 | 取り込み設定を変更 | `spec/pages/index.md#P-13: アップロード` | owner、visibility、auto・machineOnly を変更し、public handle・slug と暫定 LLM required count に応じた警告を更新する |
| PAGE-p13-004 | アップロードを開始 | `spec/pages/index.md#P-13: アップロード` | bulk metadata を JSON POST して parent job を作り、accepted files は FormData または stream action で個別保管する。個別 conversion job の状態と最終内訳を追う |
| PAGE-p13-005 | アップロードをキャンセル | `spec/pages/index.md#P-13: アップロード` | 未送信 files を止め、登録済み jobs は取消可能なものを cancel し、完了・失敗・未送信の内訳を残す |
| PAGE-p13-006 | 失敗分を再試行 | `spec/pages/index.md#P-13: アップロード` | 保存前失敗は同じ file 設定で再送し、job failure は P-15 の retry 経路または設定変更後の取り込み直しへ分ける |
| PAGE-p13-007 | 連携・handle 設定へ移動 | `spec/pages/index.md#P-13: アップロード` | LLM 未接続は P-23、公開 identifier 不足は P-21 または P-31 へ復帰先付きで遷移する |
| PAGE-p14-001 | P-14 ゴミ箱ページ | `spec/pages/index.md#P-14: ゴミ箱` | current scope の trashed notes と残日数を表示し、loading、empty、error、確認、実行、同期完了、51 件以上の予約状態、viewer 権限なしを表現する |
| PAGE-p14-002 | ノートを復元 | `spec/pages/index.md#P-14: ゴミ箱` | expected version を送信して一覧から楽観除去し、失敗時は戻す |
| PAGE-p14-003 | ノートを完全削除 | `spec/pages/index.md#P-14: ゴミ箱` | destructive confirmation 後に expected version 付き purge を送信し、route cleanup 完了後に一覧から除く |
| PAGE-p14-004 | ゴミ箱を空にする | `spec/pages/index.md#P-14: ゴミ箱` | current scope を送信し、50 件以下の `purged` は完了件数を表示、51 件以上の `scheduled` は一覧を即時空にせず job IDs と P-15 導線を表示する |
| PAGE-p15-001 | P-15 処理履歴ページ | `spec/pages/index.md#P-15: 処理履歴` | requester の jobs を新しい順に表示し、filter、parent 展開、failure、notice、artifact、automatic refresh、retry・cancel・assembly 制約、expiry を表現する |
| PAGE-p15-002 | 履歴を絞り込み・ページ移動 | `spec/pages/index.md#P-15: 処理履歴` | status、kind、parentsOnly、pagination を変更して一覧を再取得する |
| PAGE-p15-003 | 親ジョブの子内訳を開く | `spec/pages/index.md#P-15: 処理履歴` | JobId から scope-local detail と children page を取得し、summary と個別結果を展開する |
| PAGE-p15-004 | ジョブを再試行 | `spec/pages/index.md#P-15: 処理履歴` | failed job を retry し、連携・権限・対象・assembly・canceled parent の拒否を案内する。親 reopen 時は画面を running へ戻す |
| PAGE-p15-005 | 失敗した子を一括再試行 | `spec/pages/index.md#P-15: 処理履歴` | parent ID を送信し、retried count と skipped 理由を表示する。assembly 中は 1 件も送らず完了待ち、canceled 親は元操作へ誘導する |
| PAGE-p15-006 | ジョブをキャンセル | `spec/pages/index.md#P-15: 処理履歴` | 確認後 cancel を送信し、parent の canceled children 件数と terminal state を反映する |
| PAGE-p15-007 | 生成物をダウンロード | `spec/pages/index.md#P-15: 処理履歴` | requester 本人の job artifact file ID から期限付き URL を取得し、ExportTicket を使わず期限切れを表示する |
| PAGE-p16-001 | P-16 タグ管理ページ | `spec/pages/index.md#P-16: タグ管理` | current scope の tags、usage、search、sort と async merge・delete operations を表示し、lock 中、failure、retry・abort、empty、validation、read-only を表現する |
| PAGE-p16-002 | タグ一覧を検索・並べ替え | `spec/pages/index.md#P-16: タグ管理` | keyword、sort、pagination で usage 付き一覧を取得する |
| PAGE-p16-003 | タグ名を変更 | `spec/pages/index.md#P-16: タグ管理` | 新 name を送信し、同名衝突では merge confirmation に遷移、非衝突では保存結果を反映する |
| PAGE-p16-004 | タグ統合を確認・開始 | `spec/pages/index.md#P-16: タグ管理` | source・target を確認して merge operation を開始し、operation ID の poll と対象行 lock を有効にする |
| PAGE-p16-005 | タグを削除 | `spec/pages/index.md#P-16: タグ管理` | 影響を確認して delete operation を開始し、完了まで対象行操作を無効にする |
| PAGE-p16-006 | 未使用タグを一括削除 | `spec/pages/index.md#P-16: タグ管理` | delete-unused operation を開始して processed・deleted count を自動更新する |
| PAGE-p16-007 | タグ操作を再試行・中止 | `spec/pages/index.md#P-16: タグ管理` | failed operation を同じ ID で retry し、processed count が 0 の場合だけ abort を表示・送信する |
| PAGE-p16-008 | タグでノート一覧へ移動 | `spec/pages/index.md#P-16: タグ管理` | 選択 tag の正規化名を P-10 の filter URL に載せて current scope の一覧へ遷移する |
| PAGE-p20-001 | P-20 設定タブ | `spec/pages/index.md#P-20: 設定タブ` | L-01 内で個人設定と workspace 設定を別々の水平 tab 列として表示し、mobile は列だけ横 scroll させる |
| PAGE-p20-002 | 設定セクションを切り替え | `spec/pages/index.md#P-20: 設定タブ` | current 個人・workspace 設定 context を保って対応 route へ遷移し、異なる tab 列を混在させない |
| PAGE-p21-001 | P-21 プロフィール設定ページ | `spec/pages/index.md#P-21: プロフィール設定` | 初期表示を `getProfile` から供給し、display name、avatar、bio、handle と public preview を表示して、重複候補、不正・予約語、upload error、saving、warning、failure を表現する |
| PAGE-p21-002 | プロフィールを保存 | `spec/pages/index.md#P-21: プロフィール設定` | 変更 fields を JSON POST し、handle 重複・validation・競合を表示して current profile を更新する。入力中の重複候補は `checkHandleAvailability` から供給する |
| PAGE-p21-003 | アイコンをアップロード | `spec/pages/index.md#P-21: プロフィール設定` | FormData で avatar を送信し、形式・size error と preview を表示する |
| PAGE-p21-004 | 公開プロフィールを preview | `spec/pages/index.md#P-21: プロフィール設定` | current handle の P-42 を新しい navigation として開く |
| PAGE-p22-001 | P-22 ログイン方法設定ページ | `spec/pages/index.md#P-22: ログイン方法設定` | 最大 8 identities と削除可否を表示し、password・Google の追加変更解除、再認証、他 session 失効、最後 1 件不可を表現する |
| PAGE-p22-002 | パスワード認証を追加 | `spec/pages/index.md#P-22: ログイン方法設定` | 新 password と確認を送信し、強度、既存 password、identity 上限を表示する |
| PAGE-p22-003 | パスワードを変更 | `spec/pages/index.md#P-22: ログイン方法設定` | current password、新 password、current session token を送信し、成功時は現在以外の sessions が失効したことを表示する |
| PAGE-p22-004 | Google 認証を追加 | `spec/pages/index.md#P-22: ログイン方法設定` | linkIdentity OAuth flow を開始し、callback 後に一覧を再取得する。別 user 紐づきと上限を表示する |
| PAGE-p22-005 | 認証手段を解除 | `spec/pages/index.md#P-22: ログイン方法設定` | 対象 identity を確認後削除し、最後 1 件は禁止、既削除 receipt は成功として一覧へ反映する |
| PAGE-p22-006 | 他端末からサインアウト | `spec/pages/index.md#P-22: ログイン方法設定` | current session を送信して auth epoch を進め、現在端末を維持した accepted 状態を表示する |
| PAGE-p23-001 | P-23 連携設定ページ | `spec/pages/index.md#P-23: 連携設定` | OpenRouter・Drive の status、account、last used、model、folder、auto backup を表示し、未接続、認可、失効、catalog fallback、probe failure、awaiting notes、async disconnect を表現する |
| PAGE-p23-002 | 外部連携を開始・再連携 | `spec/pages/index.md#P-23: 連携設定` | provider と復帰先で integration OAuth を開始し、callback 完了後に connection 一覧を更新する。OpenRouter 新規時だけ awaiting note count を案内する |
| PAGE-p23-003 | 外部連携を解除 | `spec/pages/index.md#P-23: 連携設定` | 確認後 disconnect operation を開始し、202 の operation ID を poll して running・retrying・completed・failed を表示し、操作を重ねない |
| PAGE-p23-004 | 利用モデルを変更 | `spec/pages/index.md#P-23: 連携設定` | catalog を用途別に取得し、fallback 表示を保ったまま structuring・vision・transcription を保存する |
| PAGE-p23-005 | Drive フォルダを閲覧・選択 | `spec/pages/index.md#P-23: 連携設定` | parent ID で folders を取得し、失効・権限不足を表示して folder ID・name を設定 state に反映する |
| PAGE-p23-006 | バックアップ設定を保存 | `spec/pages/index.md#P-23: 連携設定` | folder と auto backup を送信し、folder 必須・権限・provider mismatch を表示する |
| PAGE-p23-007 | LLM 待ちノート・履歴へ移動 | `spec/pages/index.md#P-23: 連携設定` | awaiting count から P-10 の content status filter、処理履歴から P-15 へ遷移する |
| PAGE-p24-001 | P-24 使用量ページ | `spec/pages/index.md#P-24: 使用量` | personal・workspace storage、note count、当月 LLM calls、updated time を表示し、20 件 page、workspace partial unavailable、80% warning、limit、global error を表現する |
| PAGE-p24-002 | workspace 使用量を追加読込 | `spec/pages/index.md#P-24: 使用量` | opaque cursor で次の 20 memberships を取得し、available・unavailable items を既存一覧へ追加する |
| PAGE-p24-003 | 削除画面へ移動 | `spec/pages/index.md#P-24: 使用量` | personal は P-25、workspace は P-34 へ current context 付きで遷移する |
| PAGE-p25-001 | P-25 アカウント削除ページ | `spec/pages/index.md#P-25: アカウント削除` | 削除対象・workspace 所有 note の残存を説明し、email 確認、唯一 owner rejection、即時 sign-out 後の multi-scope progress、完了を表示する。**この 1 画面だけが認証ガードの明示的な例外**で、受理と同時にセッションが消えるため到達性をセッションに依存させず、セッションが無い状態では他の導線を描かない |
| PAGE-p25-002 | アカウント削除を開始 | `spec/pages/index.md#P-25: アカウント削除` | confirmation email と新 UUID request ID を JSON POST し、202 operation ID と signed 30 分 status ticket を受け、session Cookie を破棄して progress へ移る |
| PAGE-p25-003 | 削除 operation を照会 | `spec/pages/index.md#P-25: アカウント削除` | session なしで status ticket を明示送信し、accepted・running・completed・rejected・failed を表示する（running・completed・rejected は `distributed_operations.state` の 3 値そのもの、accepted は 202 応答の転送 status、failed は再試行不能と確定した場合の表示語彙で、そこへ移す遷移を定めた箇所は設計に無い）。読み取り権限は ticket が持ち、ticket が名指す 1 件しか返らない。ticket は当該 operation 読取以外に使わない。ticket の失効（発行から 30 分。削除が長引けば正常系でも到達する）と無効では進捗を追えず、ticket を捨ててトップページへの導線だけを出す。進捗取得の一時障害では ticket を保ち、同じ ticket で追い直す導線を出す |
| PAGE-p25-004 | 唯一 owner 問題を解消 | `spec/pages/index.md#P-25: アカウント削除` | rejected（P-25 の状態直和では「実行不可」）後に sign-in へ進み、該当 workspace の P-32 または P-34 へ誘導する |
| PAGE-p30-001 | P-30 ワークスペース作成ページ | `spec/pages/index.md#P-30: ワークスペース作成` | name、description、slug を入力し、slug 重複候補、不正、owner 上限、作成中、完了、failure を表示する |
| PAGE-p30-002 | ワークスペースを作成 | `spec/pages/index.md#P-30: ワークスペース作成` | 入力を送信し、作成成功時は新 workspace context と P-32 の invitation 導線を表示する |
| PAGE-p31-001 | P-31 ワークスペース一般設定ページ | `spec/pages/index.md#P-31: ワークスペース一般設定` | name、description、avatar、slug を表示し、owner 以外の read-only、slug 重複・不正、変更 warning、saving、failure を表現する |
| PAGE-p31-002 | ワークスペース profile を保存 | `spec/pages/index.md#P-31: ワークスペース一般設定` | name、description、avatar URL を送信し、role・validation・version failure を表示する |
| PAGE-p31-003 | ワークスペース slug を変更 | `spec/pages/index.md#P-31: ワークスペース一般設定` | slug を送信し、重複・予約語・公開中解除不可を表示して public URL を更新する |
| PAGE-p31-004 | ワークスペース icon をアップロード | `spec/pages/index.md#P-31: ワークスペース一般設定` | FormData で avatar を送信し、manage 権限と file validation を扱う |
| PAGE-p32-001 | P-32 メンバー管理ページ | `spec/pages/index.md#P-32: メンバー管理` | members、owner count、pending invitations を表示し、read-only、invite states、expiry、role change、last owner 禁止、remove・leave confirmations を表現する |
| PAGE-p32-002 | メンバーを招待 | `spec/pages/index.md#P-32: メンバー管理` | email と role を送信し、already member、在庫上限、rate limit、mail warning を表示して invitation URL を返す |
| PAGE-p32-003 | 招待リンクをコピー | `spec/pages/index.md#P-32: メンバー管理` | invitation URL を clipboard へコピーし、成功・permission failure を局所表示する |
| PAGE-p32-004 | 招待を再送 | `spec/pages/index.md#P-32: メンバー管理` | pending invitation ID を送信し、新 expiry・URL を反映する。workspace×発行者の rate limit を表示する |
| PAGE-p32-005 | 招待を取り消す | `spec/pages/index.md#P-32: メンバー管理` | confirmation 後 pending invitation ID を revoke し、一覧から除く |
| PAGE-p32-006 | メンバー role を変更 | `spec/pages/index.md#P-32: メンバー管理` | membership と new role を送信し、self change、last owner、operation conflict を表示する。降格時の job cancellation は結果再取得へ反映する |
| PAGE-p32-007 | メンバーを除名 | `spec/pages/index.md#P-32: メンバー管理` | destructive confirmation 後 membership を送信し、self・last owner・operation lock を表示して security cleanup 中は対象を無効化する |
| PAGE-p32-008 | ワークスペースから脱退 | `spec/pages/index.md#P-32: メンバー管理` | confirmation 後 current user の leave を送信し、last owner を拒否、成功時は personal context へ遷移する |
| PAGE-p33-001 | P-33 ワークスペース公開設定ページ | `spec/pages/index.md#P-33: ワークスペース公開設定` | publication、public URL、public note count を表示し、private、published、slug missing、zero note、confirmation、saving、failure、read-only を表現する |
| PAGE-p33-002 | ワークスペースを公開・非公開化 | `spec/pages/index.md#P-33: ワークスペース公開設定` | confirmation 後 publish または unpublish を送信し、slug 必須・権限・競合を表示して publication を更新する |
| PAGE-p33-003 | 公開 URL をコピー・開く | `spec/pages/index.md#P-33: ワークスペース公開設定` | current URL を clipboard へコピーするか P-43 を開く |
| PAGE-p34-001 | P-34 ワークスペース削除ページ | `spec/pages/index.md#P-34: ワークスペース削除` | 影響、note 移動案内、name confirmation を表示し、mismatch、running、completed、read-only を表現する |
| PAGE-p34-002 | ワークスペース削除を開始 | `spec/pages/index.md#P-34: ワークスペース削除` | workspace name confirmation を送信して 202 operation を開始し、通常操作を無効化して完了まで状態を追う |
| PAGE-p34-003 | ノート移動へ進む | `spec/pages/index.md#P-34: ワークスペース削除` | 削除前案内から P-10 selection または各 P-11 move action へ遷移する |
| PAGE-p40-001 | P-40 トップページ | `spec/pages/index.md#P-40: トップ` | service 説明、public search、sign-up・sign-in を表示する。状態は「通常」のみで、sign-in 済みはノート一覧へリダイレクトするため P-40 に到達しない。導線の出し分けの分岐は持たない |
| PAGE-p40-002 | 公開検索を開始 | `spec/pages/index.md#P-40: トップ` | keyword を P-41 の query state に載せて遷移する |
| PAGE-p40-003 | サインアップ・サインインへ移動 | `spec/pages/index.md#P-40: トップ` | P-01 または P-02 へ遷移する |
| PAGE-p40-004 | サインイン済みのリダイレクト（`/` → P-10） | `spec/pages/index.md#P-40: トップ` | sign-in 済み user を current または personal P-10 へ送る。P-40 は画面内の導線ではなく `/` のリダイレクトでこの役割を果たすため、sign-in 済みの訪問者はこの画面を見ない |
| PAGE-p41-001 | P-41 公開検索ページ | `spec/pages/index.md#P-41: 公開検索` | keyword、tags、UTC updated period と results を表示し、initial、searching、results、zero、short query、rate limit、error を表現する。公開 CSP と referrer policy を適用する |
| PAGE-p41-002 | 公開ノートを検索・絞り込み | `spec/pages/index.md#P-41: 公開検索` | 2 文字以上 keyword、tags、inclusive date range を送信し、署名 cursor の query fingerprint を保持する。発信元 rate limit と範囲 error を扱う |
| PAGE-p41-003 | 公開検索結果を追加読込 | `spec/pages/index.md#P-41: 公開検索` | 同一 filter の opaque cursor で次 page を読み、results を追加する |
| PAGE-p41-004 | 公開ノートを開く | `spec/pages/index.md#P-41: 公開検索` | result note ID の P-44 へ遷移する |
| PAGE-p42-001 | P-42 利用者公開ページ | `spec/pages/index.md#P-42: 利用者の公開ページ` | public profile と owner-filtered public notes を表示し、loading、list、empty、not found、self banner を表現する。公開 CSP と metadata を適用する |
| PAGE-p42-002 | 利用者内のノートを検索・タグ絞込 | `spec/pages/index.md#P-42: 利用者の公開ページ` | owner handle を固定して keyword・tags・cursor を public search へ渡す。条件なし一覧を許す |
| PAGE-p42-003 | 公開ノートを開く | `spec/pages/index.md#P-42: 利用者の公開ページ` | 選択 result の P-44 へ遷移する |
| PAGE-p43-001 | P-43 ワークスペース公開ページ | `spec/pages/index.md#P-43: ワークスペースの公開ページ` | published workspace 情報と owner-filtered public notes を表示し、loading、list、empty、not found、member banner を表現する。公開 CSP と metadata を適用する |
| PAGE-p43-002 | ワークスペース内を検索・タグ絞込 | `spec/pages/index.md#P-43: ワークスペースの公開ページ` | workspace slug を固定して keyword・tags・cursor を public search へ渡す。条件なし一覧を許す |
| PAGE-p43-003 | 公開ノートを開く | `spec/pages/index.md#P-43: ワークスペースの公開ページ` | 選択 result の P-44 へ遷移する |
| PAGE-p44-001 | P-44 ノート公開ページ | `spec/pages/index.md#P-44: ノートの公開ページ` | Declarative Shadow DOM で public note、author、workspace、tags、metadata を表示し、not found と public のまま trash の gone を区別する。編集導線を出さず、CSP、nosniff、referrer policy を適用する |
| PAGE-p44-002 | 著者・workspace・tag へ移動 | `spec/pages/index.md#P-44: ノートの公開ページ` | author handle は P-42、workspace slug は P-43、tag は対応 owner-filtered search へ遷移する |
| PAGE-p44-003 | 公開ノートをダウンロード | `spec/pages/index.md#P-44: ノートの公開ページ` | HTML・Markdown は即時、PDF は ExportTicket を明示送信して poll・download する。anonymous PDF の発信元 rate limit、相乗り、ticket・artifact expiry、閲覧再評価を扱い、history 導線は出さない |
| PAGE-p45-001 | P-45 共有リンクページ | `spec/pages/index.md#P-45: 共有リンクのノート` | share token note を password required または isolated content として表示し、invalid・reissued・deleted・private を同じ not found にする。保護ありは初回 server render で必ず password 要求にし、公開 CSP と referrer policy を適用する |
| PAGE-p45-002 | 共有パスワードを照合 | `spec/pages/index.md#P-45: 共有リンクのノート` | password と発信元を送信し、成功した signed SharePass を token ごとの client storage に保持して要求ごとに明示送信する。Cookie にせず、誤り・`THROTTLED` を表示する |
| PAGE-p45-003 | 保持済み SharePass で本文を再取得 | `spec/pages/index.md#P-45: 共有リンクのノート` | client hydration 後に保持 pass を明示して shared note を再取得し、有効なら password state を本文へ置換、無効なら入力状態を維持する |
| PAGE-p45-004 | 共有ノートをダウンロード | `spec/pages/index.md#P-45: 共有リンクのノート` | share token と任意 SharePass で HTML・Markdown 即時または PDF ticket flow を実行し、password、rate limit、権限再評価、ticket expiry を扱う |
| PAGE-p45-005 | 編集画面へ移動 | `spec/pages/index.md#P-45: 共有リンクのノート` | sign-in user に edit 権限がある場合だけ app 内 P-12 へ遷移する |
| PAGE-p46-001 | P-46 見つかりません・エラーページ | `spec/pages/index.md#P-46: 見つかりません / エラー` | not found と権限なしを同じ表示にし、system error、rate limit を区別してトップ・一覧・retry 導線を出す。serialized error kind・code の presentation-only status mapping と system detail の秘匿を適用する |
| PAGE-p46-002 | 失敗した取得を再試行 | `spec/pages/index.md#P-46: 見つかりません / エラー` | server・一時通信 error で元の安全な read request を再実行し、mutation は自動再送しない |
| PAGE-p46-003 | トップ・ノート一覧へ移動 | `spec/pages/index.md#P-46: 見つかりません / エラー` | session の有無に応じて P-40 または P-10 へ遷移する |
| PAGE-p47-001 | P-47 規約・プライバシーページ | `spec/pages/index.md#P-47: 利用規約・プライバシーポリシー` | sign-up 同意対象の静的本文を public layout、CSP、nosniff、referrer policy 下で表示する |
