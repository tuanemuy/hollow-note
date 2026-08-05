# 転送境界の設計

HTTP 境界で下す決定を 1 か所に集める。扱うのは資格情報の運搬、CSRF 対策、公開ページのセキュリティヘッダー、エラーと HTTP ステータスの対応づけ、レート制限の要件である。

## この文書の役割

ドメインとユースケースは「何が正しいか」を定め、それをどう運ぶかは定めない。`CLAUDE.md` の方針が「HTTP status mapping is presentation-only」「Errors themselves do not carry transport concerns」であるためで、Cookie の属性やステータス番号をドメイン／ユースケース文書に書くと、同じ決定が複数の文書に散り、転送手段を変えるたびに内側の層の文書を書き換えることになる。

この分担は既に一部で成立している。`SharePass`（[domains/note.md](../domains/note.md)）と `ExportTicket`（[usecases/note.md](../usecases/note.md) の「共通: ExportTicket」）は「署名と検証は presentation 層の責務」とだけ書き、手段を内側に持ち込んでいない。本文書はその委譲先であり、次を正典とする。

| 決めること | 正典 |
| --- | --- |
| 資格情報を Cookie で運ぶか、要求ごとに載せるか | 本文書 |
| Cookie の属性 | 本文書 |
| **設定から供給される値（秘密・鍵）の一覧と供給の形** | 本文書の [`AppConfig`](#appconfig) |
| CSRF 対策の一次防御と、経路ごとの追加要件 | 本文書 |
| セキュリティヘッダー（CSP ほか）の指令 | 本文書 |
| エラーの `kind` / コードと HTTP ステータスの対応 | 本文書 |
| レート制限の対象と要件（実現手段は除く） | 本文書 |
| どの状態がどのエラーになるか | 各ユースケース文書 |
| 資格情報の有効期間・失効条件 | 各ドメイン／ユースケース文書 |

**値の正典は「その値が意味を持つ層」に置く**。有効期間はドメイン（`Session.ttlMs` / `AuthTokenPurpose.ttlMs`）、しきい値はドメインサービス（`LoginThrottlePolicy`）、秘密と鍵は本文書の `AppConfig` に置く。本文書がすべての値を集める台帳になるのではない — 集めると転送手段を変えるたびにドメインの決定を書き換えることになり、この文書が存在する理由そのものと反する。`AppConfig` が持つのは「配備ごとに変わり、コードにも仕様にも書けないもの」だけである。

本文書は**ブラウザと HTTP の水準で閉じる決定**を書く。実行基盤に属する決定（どのストアで数えるか、発信元をどのヘッダーから取るか等）は [ADR 015](../adr/015-cloudflare-runtime.md) / [ADR 020](../adr/020-coordination-state.md) で確定しており、値の正典は [platform/index.md](../platform/index.md) にある。本文書はそこを参照し、**要件**（何が保証されなければならないか）を持つ。

---

## 資格情報の運搬

本サービスが扱う資格情報は 3 種類ある。

### セッショントークン

`signInWithPassword` / `completeOAuthSignIn` などが返す `sessionToken`（[usecases/identity.md](../usecases/identity.md)）を **Cookie** で運ぶ。`authenticateSession` の入力はこの Cookie から取り出す。

| 属性 | 値 | 理由 |
| --- | --- | --- |
| `HttpOnly` | 付ける | このトークン単体でアカウント全体を操作できるため、JavaScript から読めてはならない。本サービスは利用者由来の HTML を自分のオリジンで描画する（[ADR 006](../adr/006-html-content-model.md) / [ADR 013](../adr/013-html-sanitization-policy.md)）ので、スクリプト実行の抜け道が 1 つ通るとそのままアカウント乗っ取りに直結する。**ブラウザに既定値はなく、指定しなければ JS から読める**ため、明示的な規定を置く |
| `Secure` | 付ける | 平文経路に載せない。これもブラウザの既定ではない |
| `SameSite` | `Lax` | 下記の理由により `Strict` は採れず、`None` は CSRF に対して無防備になる |
| `Path` | `/` | アプリのすべての経路で必要になる。個別の経路に絞る意味がない |
| `Domain` | 指定しない | 発行元ホストだけに限定する。サブドメインへ広げると、将来別用途のサブドメインを置いたときにそこへも送られる |
| 寿命 | `Session.expiresAt` に一致させる | サーバー側の失効（[domains/identity.md](../domains/identity.md) の `Session`）が唯一の正であり、Cookie 側を長く持たせても失効済みトークンを送るだけになる。有効期間そのもの（30 日の絶対期限）は Identity 側の決定であり本文書では決めない |

**「サインイン状態を保持しない」選択肢は持たない**。ブラウザセッション限りの Cookie（`Expires` / `Max-Age` を付けない形）を選ばせる案を採らないのは、サーバー側の `Session` を短命にする手段が別に要り、「サーバー側の失効が唯一の正」という上の分担が 2 系統に割れるためである。共用端末での対処はサインアウトに委ねる（[domains/identity.md](../domains/identity.md) の「受け入れたリスク」）。

`SameSite=Strict` を採らない理由は、**外部から戻るトップレベルのナビゲーションでセッションが必要になる経路が実在する**ためである。`Strict` はそれらの要求に Cookie を添付しないので、サインイン済みの利用者が未サインインとして描画される。

| 経路 | 外部からの遷移元 |
| --- | --- |
| `/auth/callback/:provider` | OAuth プロバイダー（[usecases/identity.md](../usecases/identity.md) の `completeOAuthSignIn`） |
| `/verify-email`, `/reset-password` | メール本文のリンク |
| `/invitations/:token` | 招待メールのリンク |

### SharePass

パスワード保護された共有リンクの通過証（[domains/note.md](../domains/note.md)）。有効期間は発行から 24 時間。

- **保持**: 署名付きの値としてクライアントが持つ。サーバー側には保存しない。共有トークンを鍵にして端末のストレージへ置き、要求ごとにパラメーターとして明示的に載せる
- **Cookie に置かない理由**: Cookie に置くとブラウザが自動添付するアンビエントな資格情報になり、下表の「CSRF の影響を受けない」という構造上の性質を失う。`HttpOnly` にもできない（要求ごとに載せるのはクライアントのコードである）ので、Cookie にする利点がない
- **署名鍵**: [`AppConfig`](#appconfig) から供給する。テーブルには置かない
- **奪われたときの被害**: 対象のノート 1 件について「リンクとパスワードを知っている人」と同じところまでしか到達しない。`NoteAccessPolicy.evaluate` は要求のたびに再評価されるため、非公開化・削除・リンク再発行はそのまま効く。セッショントークンとの被害の非対称性が、一方だけに `HttpOnly` を要求する根拠である

初回のサーバー描画では通過証が載らないため、共有リンクのノート（P-45）はまず `passwordRequired` の状態で描画され、クライアントが保持している通過証を載せて引き直したうえで本文に差し替わる。

### ExportTicket

PDF 書き出しの結果に到達するための証（[usecases/note.md](../usecases/note.md) の「共通: ExportTicket」、[ADR 010](../adr/010-anonymous-export-and-ticket.md)）。有効期間は発行から 30 分。

- **保持**: `exportNote` の応答で受け取り、要求元の画面が保持する。進捗照会（`getExportStatus`）とダウンロード（`downloadExportArtifact`）の要求に明示的に載せる。永続化しない — 有効期間 30 分は 1 回の書き出し操作を通すためのものであり、画面を離れたら `exportNote` をやり直せばよい
- **URL に載せない**: `downloadExportArtifact` は署名付きの短命なダウンロード URL を返す設計であり、チケット自体を URL に置く必要がない。クエリに載せると `Referer` や履歴・ログに残る
- **署名鍵**: SharePass と同じく [`AppConfig`](#appconfig) から供給する（別の鍵を使う）

署名鍵を交換すると、それ以前に発行した署名付きの値はすべて失効する。SharePass は 24 時間、ExportTicket は 30 分で自然に入れ替わり、どちらも再取得の導線（パスワードの再入力・書き出しのやり直し）を持つため、鍵の交換に伴う失効は回復可能な範囲に収まる。

### AppConfig

`AppConfig` は**起動時に環境から解決される読み取り専用の設定**である。テーブルには置かず、要求のたびに読める形でアプリケーションに渡す。持つのは「配備ごとに変わり、コードにも仕様にも書けないもの」に限る — 有効期間やしきい値のように設計上の決定であるものは、それぞれのドメイン文書が正典を持つ（本文書の冒頭「値の正典は『その値が意味を持つ層』に置く」）。

| 項目 | 用途 | 形 |
| --- | --- | --- |
| SharePass の署名鍵 | 共有パスワードの通過証の署名と検証 | 単一の鍵 |
| ExportTicket の署名鍵 | 書き出しチケットの署名と検証 | 単一の鍵。SharePass とは別の鍵を使う |
| `SecretCipher` の鍵束 | 外部連携の資格情報の暗号化と復号 | **版 → 鍵の写像と、現在の版**（[domains/integration.md](../domains/integration.md)） |
| `ShareTokenProtector` の鍵束 | 共有 URL の再表示に必要なトークンの暗号化と復号 | **版 → 鍵の写像と、現在の版**（[domains/note.md](../domains/note.md)）。資格情報とは用途を分離した鍵を使う |
| ストレージの配信元 | `StorageUrlPolicy.isInternal` の判定材料（[domains/storage.md](../domains/storage.md)） | 自サービスのストレージを指す URL の前置き |
| 転送境界のレート制限のしきい値 | サインアップ・匿名の PDF 書き出し・公開検索・招待の発行（下記「レート制限」） | 対象ごとの「60 秒あたりの要求数」。**既定値は本文書が持ち、`AppConfig` はそれを配備ごとに上書きするためだけにある**（規模で変わるが、設計としての妥当な出発点はある） |

`SecretCipher` と `ShareTokenProtector` の鍵が単一でないのは、暗号化した値がデータベースに残り続けるためである。署名付きの値は最長でも 24 時間で入れ替わるので鍵を 1 本ずつ差し替えればよいが、暗号化された資格情報と共有トークンは交換前の版で書かれた行が残る。鍵を交換したあとも**用途ごとの旧版を保持し続ける**必要があり、保持をやめた版の行を読むと `SystemError(DataIntegrityError)` になる。旧版をいつ捨てられるかは再暗号化が全行に行き渡ったかで決まる運用上の判断で、設計としては「保持が要る」ことだけを定める。

`clientKey`（発信元を表す文字列）は `AppConfig` に持たない。材料が **`CF-Connecting-IP` ヘッダー**に確定したためである（[ADR 020](../adr/020-coordination-state.md)）— 配備ごとに変わる値ではなく、コードに書ける決定になった。

### 3 者の比較

| | セッショントークン | SharePass | ExportTicket |
| --- | --- | --- | --- |
| 表すもの | サインイン状態 | 共有パスワードを通過済み | 書き出し結果への到達 |
| 有効期間 | `Session.expiresAt` | 24 時間 | 30 分 |
| サーバー側の保存 | あり（`sessions.token_hash`） | なし（署名付きの値） | なし（署名付きの値） |
| 運搬 | Cookie | 要求ごとに明示的に載せる | 要求ごとに明示的に載せる |
| ブラウザが自動で添付するか | **する** | しない | しない |
| CSRF の影響 | **受ける** | 受けない | 受けない |
| JS から読めるか | 読めない（`HttpOnly`） | 読める | 読める |
| 単独で何ができるか | アカウントの全操作 | 対象ノート 1 件の閲覧（毎回再評価） | 対象ジョブ／ファイル 1 件への到達（毎回再評価） |

**セッショントークンだけがアンビエントな資格情報である**。ExportTicket と SharePass は要求ごとにクライアントのコードが明示的に載せる帯域内のクレデンシャルなので、他所のページから仕掛けられた要求には載らず、構造的に CSRF の対象外になる。セッションはブラウザが自動で添付するため、要求を組み立てた主体が誰かをサーバーが区別できない。次節が必要なのはこの 1 種類のためである。

---

## CSRF

### 一次防御

`SameSite=Lax` を一次防御とする。クロスサイトの `<form>` から発される POST に Cookie は添付されない。

ただし**これはブラウザの既定の振る舞いであって、本サービスが与えた保証ではない**。既定は変わりうるし、古い実装や非ブラウザのクライアントには効かない。したがって単独の防御にはせず、以下を併せて規約とする。

### 規約

| 規約 | 理由 |
| --- | --- |
| 状態を変更する経路は原則として **JSON を受け取る POST** とする | 転送境界の既定（`createServerFn({ method: "POST" })`）がこれに当たる。クロスサイトの `<form>` は `application/json` の本文を送れないため、この経路には到達できない |
| **`FormData` を受けるサーバー関数を作る場合は `Origin` ヘッダーの検証を必須とする** | `<form action={fn}>` のためにこの形を用意すると、クロスサイトの `<form>` から到達しうる唯一の経路になる。到達しうる以上、`SameSite` に頼らない検証をその経路自身が持つ必要がある。`Origin` が自分のオリジンと一致しない、または欠けている要求は拒否する |
| **状態を変更する GET 経路を作らない** | `SameSite=Lax` はトップレベルのナビゲーションによる GET には Cookie を添付する。副作用を持つ GET を作ると、一次防御を素通りして単なるリンクから起動できる |

### この節の対象外

- **OAuth の CSRF**（認可応答のすり替え）は `state` と PKCE で防ぐ。`OAuthStateStore`（[domains/index.md](../domains/index.md)）が `state` と `codeVerifier` を保持し、`completeOAuthSignIn` / `completeIntegrationOAuth` が `take` で消費する。同じ「CSRF」という語を使うが対象も仕組みも別であり、本節の規約はこれを置き換えない
- **SharePass / ExportTicket を使う経路**は前節のとおり構造的に対象外である。ただしそれらの経路が同時にセッションも読む場合（サインイン済みの利用者が共有リンクを開く場合など）は、セッションを読む以上ここの規約に従う

---

## 公開ページのセキュリティヘッダー

### 対象

公開レイアウト（[pages/index.md](../pages/index.md) の L-02）配下の画面 — 公開検索（P-41）、利用者の公開ページ（P-42）、ワークスペースの公開ページ（P-43）、ノートの公開ページ（P-44）、共有リンクのノート（P-45）。

ノートの本文はアプリ側の画面（P-11 / P-12）でも描画されるため、下記のうち本文由来の危険を抑える指令は**サービス全体の応答の既定**として敷き、公開ページはそこからさらに絞る。公開ページを特に名指しするのは、匿名の閲覧者に対して利用者由来の HTML を配信する唯一の面であり、攻撃者が自分で作ったノートを公開して任意の閲覧者に踏ませられるためである。

### CSP

最低限、次の指令を規定する。

| 指令 | 値の方針 | 何を防ぐか |
| --- | --- | --- |
| `frame-ancestors` | 自オリジンのみ（または `'none'`） | 公開ページを外部サイトに埋め込んで操作を誘導するクリックジャッキング。`X-Frame-Options` ではなくこちらを正とする（複数オリジンを表現でき、指令として後継であるため） |
| `form-action` | 自オリジンのみ | 本文に混入した `<form>` が外部へ送信すること。サニタイズを通り抜けたフォームがあっても、送信先が自オリジンに限られれば資格情報や入力の外部持ち出しにはならない |
| `object-src` | `'none'` | `<object>` / `<embed>` によるプラグイン経由のスクリプト実行。本文の表現に必要なく、無条件に落としてよい |
| `base-uri` | `'self'`（または `'none'`） | 本文に混入した `<base>` が相対 URL の解決先を書き換え、ページ内のリンクや送信先をまとめて外部へ向けること |

`script-src` については「**本文由来のインラインスクリプトが実行されないこと**」を要件とする。具体的な指定（nonce か hash か、アプリ自身のスクリプトをどう許可するか）はフレームワークが出力する HTML の形に依存するため、ここでは決めない。

`style-src` はインラインスタイルを許さざるを得ない。[ADR 007](../adr/007-default-style-isolation.md) の `preserve` は本文に含まれる `<style>` 要素と `style` 属性をそのまま活かす設計であり、これを禁じると本文の見た目が壊れる。**したがって「本文にスタイルを書かせない」形の制限は採れず、スタイルが持つ危険のうち「何を書けるか」の側は ADR 013 の許可リストが単独で担う**。上表に挙げた 4 指令がいずれもスタイルと衝突しないものだけで構成されているのはこのためである。

一方、スタイルが持つもう 1 つの危険 — `<style>` の中の `url()` や `@import` による外部参照（ADR 013 が「属性ベースの検査では塞がらない」と明記している穴）— は、参照**先**を絞る指令で受ける。`style-src` / `img-src` / `font-src` の許可元を自オリジンと必要な配信元に限れば、本文を開いただけで任意の外部へ要求が飛ぶ経路は塞がる。具体的な許可元は配信構成に依存するため、ここでは「本文由来の外部参照を無制限にしない」という要件だけを置く。

### サニタイズとの多層防御の関係

本文の安全は第一に [ADR 013](../adr/013-html-sanitization-policy.md) の許可リスト方式のサニタイズが担う。本節の CSP はそれを置き換えるものではなく、**サニタイザーの抜け道が 1 つ見つかっただけで即座にオリジンが奪われる状態にしない**ための第 2 層である。

この 2 つは独立した対策ではない。サニタイズは「サービス自身のオリジン上で利用者由来の HTML が動く」という面を残す方式であり、そこを通り抜けたスクリプトはサービスと同じ権限で動く。このとき **`HttpOnly` が規定されていなければ、1 か所の抜け道がセッション奪取によるアカウント乗っ取りにそのまま化ける**。前節の Cookie 属性・本節の CSP・ADR 013 のサニタイズは、同じ 1 つのリスクに対する 3 つの層として読むこと。

### Declarative Shadow DOM に関する注意

公開ページの本文はサーバー側で描画され、`<template shadowrootmode="open">` による Declarative Shadow DOM に載る（[ADR 007](../adr/007-default-style-isolation.md)）。ここで取り違えてはならないのは、**Shadow DOM が隔離するのはスタイルとセレクターであって、権限ではない**という点である。

- シャドウツリーの内側も同じ文書・同じオリジンであり、そこで動くスクリプトは外側と同じ `document.cookie` に到達する
- CSP は文書単位で効くため、シャドウ境界は CSP を弱めも強めもしない
- したがって「Shadow DOM に入れてあるから安全」という推論は成り立たない。本文の安全はサニタイズと CSP だけが担う

本文を載せるホスト要素は、絶対配置の包含ブロックになるように描画する（`position: relative` 相当）。[ADR 013](../adr/013-html-sanitization-policy.md) が `position: absolute` を許可リストに残す前提が「基準が本文の内側に閉じること」であり、その前提を満たすのは描画側の責務であるため。これを怠ると、本文の要素が画面全体を覆ってアプリ側の操作に重なりうる。

### その他のヘッダー

| ヘッダー | 値 | 理由 |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | 利用者が上げたファイルや生成物を配信する経路があるため、内容から MIME 型を推測されると宣言した型と違う扱いを受けうる |
| `Referrer-Policy` | 参照元のパスを外部へ送らない方針 | 共有リンクの URL（`/s/:token`）そのものが秘密であり、外部リンクを踏んだときに `Referer` として漏れてはならない |

---

## HTTP ステータスの対応

エラーは `kind` タグ付きの直列化形式を持ち、ステータスへの対応づけは presentation 層のみが行う（`CLAUDE.md`）。したがって対応表はここが唯一の正典であり、ユースケース文書はステータスを書かない。

### `kind` による既定の対応

| エラー | `kind` | ステータス | 備考 |
| --- | --- | --- | --- |
| `ValidationError` | `validation` | 422 | 転送境界での形の違反、および入力値に起因する拒否 |
| `NotFoundError` | `notFound` | 404 | 存在を漏らさないための「見つかりません」もここに含む（権限不足を 403 と区別しない設計判断は各ユースケースが下している） |
| `BusinessRuleError` | `business` | 422 | 要求の形は正しく、不変条件に反する |
| `ConflictError` | `conflict` | 409 | 版の不一致・一意制約違反・二重消費 |
| `SystemError` | `system` | 500 | `code` と `message` はクライアントへ返す前に伏せる。内部の構成が推測材料になるため。サーバー側のログには元の値を残す |

上記に該当しない値（直列化形式を持たない例外）は `unknown` として 500 に対応づける。

### コードによる例外

`kind` だけでは表現できない差のうち、**クライアント（ブラウザ・検索エンジン・API 利用者）の振る舞いを変える必要があるもの**に限って、コードを見て対応を変える。

| エラーとコード | ステータス | 理由 |
| --- | --- | --- |
| `NotFoundError("NOTE_GONE")` | **410** | かつて公開されていたものが恒久的に失われたことを示し、検索エンジンにインデックスの削除を促す。どの状態がこれに当たるかの正典は [usecases/note.md](../usecases/note.md) の `getPublicNote` であり、本文書は対応づけだけを持つ |
| `NotFoundError("NOTE_NOT_FOUND")` | 404 | 上記以外。存在しなかったのか到達できないのかを区別しない |
| `ValidationError("UNAUTHENTICATED")` | **401** | `authenticateSession`（[usecases/identity.md](../usecases/identity.md)）の失敗。クライアントはサインインへ誘導する必要があり、入力の訂正で解決する 422 とは扱いが異なる |
| `ValidationError("THROTTLED")` / `("LOCKED")` / `("RATE_LIMITED")` | **429** | 待機すれば解決することを示す。入力の訂正では解決しない |
| `ValidationError("INVITATION_LIMIT_REACHED")` | **429** | 未処理の招待の在庫が上限に達した（[usecases/workspace.md](../usecases/workspace.md) の `inviteMember`）。時間の経過では解けないが、受け手にとっては「今は受け付けられないが状況が変われば通る」ことを示すのがもっとも近い。解除までの時間は添えない |

この例外は上表の 5 行だけとし、増やすときは「クライアントの振る舞いが実際に変わるか」を基準にする。ステータスは分類の表現手段ではなく、受け手への指示である。

### 抑止を表す 3 コードを 1 本に畳まない理由

`THROTTLED` / `LOCKED` / `RATE_LIMITED` は同じ 429 に対応づくが、コードとしては分けたまま残す。**ステータス表の側の整理は上表 1 行に畳んだ時点で完了しており**、上の「増やすときは」の基準はステータスの例外を増やすときのものであってコードを統合する基準ではない。

- `THROTTLED`（待機。待機秒数を添える）と `LOCKED`（一時的なロック。解除時刻と**パスワード再設定への導線**を添える）は、利用者に出す文言と次の一手が違う（[scenario/account.md](../scenario/account.md)）。1 コードに畳んで待機秒数だけで区別しようとすると、画面が「60 秒を超えるかどうか」で分岐することになり、その 60 秒は `LoginThrottlePolicy` の待機上限（[domains/identity.md](../domains/identity.md)）の写しになる。本文書の冒頭が避けようとした「同じ決定が複数の文書に散る」形そのものである
- `RATE_LIMITED` は**転送境界の粗いレート制限**（サインアップ・匿名の PDF 書き出し・公開検索・招待の発行）に限って使う。数える仕組みが違い（Rate Limiting binding はロケーション単位で結果整合）、解除までの時間の供給元も持たないため、`THROTTLED` と同じ保証を持てない。この保証の差がそのまま仕組みを分けた理由でもある（[ADR 020](../adr/020-coordination-state.md)）

名前から `LOGIN_` を外したのは、共有リンクのパスワード照合（`verifySharePassword`）が同じ `LoginThrottlePolicy` を使うためである。サインインだけの語彙ではない。

招待の発行上限（`INVITATION_LIMIT_REACHED`）はレート制限ではなく**クォータ**なので、この 4 つに含めない（下記「レート制限」）。

---

## 複数 scope にまたがる操作

`deleteAccount` と `disconnectIntegration` は複数の Durable Object を同一要求で完了させない。転送境界は `operationId` と `status: "accepted"` を **202 Accepted** で返し、クライアントは operation status をpollする。`deleteAccount` はsessionを直ちに失効させるため、応答に30分有効の署名済みstatus ticketを含める。このticketは当該operationの状態だけを読め、再実行・取消・他データの取得には使えない。

状態は `accepted` / `running` / `completed` / `rejected` / `failed`。`rejected` は唯一のworkspace ownerなど事前条件の不成立で、UIは解消方法を示す。`failed` は再試行不能と確定した場合だけで、通信失敗・応答喪失は `running` のままserver-side recoveryが続ける。同じ冪等keyの再要求には既存operationを返す。

## レート制限

### 対象

**要求される保証で 2 系統に分かれる**。正確な計数を要するもの（施錠）は D1 の原子的な加算で数え、粗く抑えれば足りるものは Workers の Rate Limiting binding で数える（[ADR 020](../adr/020-coordination-state.md)）。

| 対象 | 数える単位 | 仕組み | 既定のしきい値 |
| --- | --- | --- | --- |
| パスワードによるサインイン | メールアドレス × 発信元（[usecases/identity.md](../usecases/identity.md) の `signInWithPassword`） | `LoginAttemptStore` + `LoginThrottlePolicy`（D1） | `LoginThrottlePolicy`（3 回目から待機 / 10 回で 15 分ロック） |
| 共有リンクのパスワード照合 | 共有トークンのハッシュ × 発信元（[usecases/note.md](../usecases/note.md) の `verifySharePassword`） | 同上 | 同上 |
| サインアップ | 発信元 | Rate Limiting binding | 5 回 / 60 秒 |
| 匿名の PDF 書き出し | 発信元（[ADR 010](../adr/010-anonymous-export-and-ticket.md)） | Rate Limiting binding | 3 回 / 60 秒 |
| 公開検索 | 発信元（[usecases/note.md](../usecases/note.md) の `searchPublicNotes`） | Rate Limiting binding | 30 回 / 60 秒 |
| 招待の発行 | ワークスペース × 発行者（[usecases/workspace.md](../usecases/workspace.md) の `inviteMember` / `resendInvitation`） | Rate Limiting binding | 10 回 / 60 秒。メール送信を伴うため、乱用は第三者への迷惑になる |

しきい値は `AppConfig` から供給する（配備の規模で変わるため）。上表は既定値である。窓が 60 秒に揃うのは binding が 10 秒か 60 秒しか受け付けないためで、Rate Limiting binding はロケーション単位で数えるので**実効の上限は Cloudflare のロケーション数だけ緩む**。粗い上限としてこれを受け入れる（下記「要件」の 1 が求める正確さは施錠の側にだけ掛かる）。

`clientKey`（発信元）は **`CF-Connecting-IP`** から導く。Cloudflare が自分で設定し、クライアントが送った同名のヘッダーを上書きするため詐称できない。`X-Forwarded-For` は詐称できるので使わない（[ADR 020](../adr/020-coordination-state.md)）。

**招待の未処理件数の上限はここに含めない**。`inviteMember` が持つ「24 時間に 50 件」（[usecases/workspace.md](../usecases/workspace.md)）は時間あたりの要求数ではなく**未処理の招待の在庫**に対する上限であり、招待が 1 件受諾されるか取り消されればその場で枠が空く。待てば解けるとは限らず、解除までの時間も出せない（`countPendingIssuedSince` は件数しか返さない。[domains/workspace.md](../domains/workspace.md)）。したがって別のコード `INVITATION_LIMIT_REACHED` を割り当て、下の要件 3 の対象から外す。ステータスは 429 のままとする — 受け手にとっては「今は受け付けられないが、状況が変われば通る」ことを示すのがもっとも近い。

### 要件

1. **失敗回数の加算はロストアップデートを起こしてはならない。** 素朴に「読んでから書く」形で実装すると、並行した失敗が同じ `failure_count` を読んで同じ値を書き、**攻撃者は要求を並列化するだけで施錠を回避できる**。しきい値の設計（3 回目から待機、10 回で 15 分ロック）がどれだけ精密でも、加算が数えられなければ意味を持たない。**この要件は `LoginAttemptStore.recordFailure` を単一の原子的な操作とすることで満たす**（[domains/identity.md](../domains/identity.md) の契約、[ADR 020](../adr/020-coordination-state.md)）。D1 では `INSERT … ON CONFLICT DO UPDATE SET failure_count = failure_count + 1 … RETURNING` の 1 文にあたる
2. 判定と加算は同じ鍵の上で直列化されること。加算が 1 文に収まっていれば、同じ鍵の行に対する更新は保存先が直列化する。判定に使う読み取り（`get`）が古い値を返しても、その試行の失敗は必ず数えられるため施錠は追いつく
3. 制限に掛かったことを示す応答は 429 とする（前節のコードによる例外）。解除までの時間を添えられるかは経路で異なる。
   - `THROTTLED` / `LOCKED`（`LoginThrottlePolicy` 由来）は**必ず添える**。`ThrottleDecision` が `waitMs` / `until` を持つため供給元がある
   - 転送境界のレート制限（`RATE_LIMITED`）は**添えない**。Rate Limiting binding は超過したかどうかだけを返し、窓の残り時間を返さない。窓が 60 秒であることは設計上の既知だが、それを解除までの時間として提示すると実際より長い待機を示すことになる
   - `INVITATION_LIMIT_REACHED` は添えない。枠が空く時刻を原理的に出せない（上記）
4. 記録は期限で自然に回収されること。`LoginThrottlePolicy.attemptTtlMs` と `pruneExpiredAuthState` が既にこの形を採っている。Rate Limiting binding 側は窓の経過で自動的に落ちるため、回収の設計を持たない

---

## 関連文書

- [実行基盤の設計](../platform/index.md) — `clientKey` の材料・レート制限の実現手段・基盤の実上限
- [ADR 020. 調整状態は D1 に置き、原子性を単一 SQL 文で与える](../adr/020-coordination-state.md) — 本節のレート制限の実現手段
- [ADR 013. HTML のサニタイズ方針](../adr/013-html-sanitization-policy.md) — 本文の許可リスト。本文書の CSP と多層防御の関係にある
- [ADR 007. 既定スタイルと Shadow DOM による隔離](../adr/007-default-style-isolation.md) — 公開ページの本文描画
- [ADR 010. 匿名の PDF エクスポートと署名チケット](../adr/010-anonymous-export-and-ticket.md) — `ExportTicket` とレート制限の委譲元
- [domains/identity.md](../domains/identity.md) — `Session` / `LoginAttemptKey` / `LoginThrottlePolicy`
- [domains/note.md](../domains/note.md) — `SharePass` / `NoteAccessPolicy`
- [pages/index.md](../pages/index.md) — 公開レイアウト（L-02）と URL の割り当て
