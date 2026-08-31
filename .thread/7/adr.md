# ADR — Issue #7: ノート本文・メディア・タイトル・ゴミ箱を編集する

## ADR-001: `HtmlProcessor` アダプターを本スライスで実装する

### Context

Issue #7 のチェックリストは UC / PAGE / TC 行だけで構成され、アダプター台帳（`spec/inventory/adapter.md`）の ADP 行を含んでいない。`HtmlProcessor` は `packages/core/src/domain/note/ports/htmlProcessor.ts` にポート定義だけがあり、その JSDoc は「Port definition only in the walking-skeleton slice — the adapter ships with the import slice」と書いている。import slice は Issue #6 で、#7 の依存には挙がっていない（#7 の依存は #1 のみ）。

一方、#7 のチェックリストのうち TC-note-682〜724（サニタイズの許可リスト・URL スキーム・CSS 宣言・壊れた HTML）と TC-note-001〜006 / 011〜012（テキストノードの経路解決・`expected` 不一致・`<style>` に経路を割り当てない）は、いずれもこのアダプターの振る舞いそのものを検証する行である。合わせて 70 行以上が、アダプターなしでは満たせない。

選択肢は 3 つあった。

1. #6 の完了を待って #7 を後ろへ回す
2. #7 の中で `HtmlProcessor` アダプターを実装する
3. 該当する TC 行を見送り、理由を Issue のコメントに残す

### Decision

2 を採る。#7 で `HtmlProcessor` アダプター（ADP-note-001〜005）を実装し、ポート JSDoc の「adapter ships with the import slice」を現状に合わせて書き換える。

1 は成立しない — #6 の側もこのアダプターに依存するので、どちらが先に着手されてもアダプターを作るのは先着したスライスになる。#7 のほうが先に着手されている。3 は Issue の完了条件（全行の実装、スタブ・部分実装は不可）を大きく削り、しかもチェックリストの中核（サニタイズ）を丸ごと外すため、スライスとして意味をなさなくなる。

### Consequences

- 良い点: #7 が自己完結する。#6 は完成した `HtmlProcessor` を前提に取り込み経路だけを書けばよくなり、二重実装の危険がない
- 良い点: サニタイズ規則（[ADR 013](../../spec/adr/013-html-sanitization-policy.md)）の唯一の適用点が本スライスで実物になり、TC 行が実際の振る舞いを検証するようになる
- トレードオフ: #7 のスコープが台帳上の割り当てより広がる。#6 の残作業がその分軽くなるので総量は変わらないが、#7 単体のレビュー負荷は上がる
- トレードオフ: `HtmlProcessor` は永続化ポートではないため conformance スイートの枠組みに乗らない。実装を差し替えても同じ表を通せるよう、アダプター単体テストをテーブル駆動で書く必要がある

---

## ADR-002: 不在の集約に依存する手順は、境界を切って本スライスの持ち分だけを実装する

### Context

#7 のチェックリスト行が指す spec の手順が、本リポジトリにまだ存在しない集約を要求している箇所が 4 つある。

- **Job 集約（Issue #5 / #6 の持ち分。`application/cleanup/participants.ts:44` に不在が明記）** — `spec/usecases/note.md#updateNoteBody` 手順 2・8（`JobRepository.listActiveByTarget` と参照取り込みジョブの登録）、`#applyTextNodeEdits` 手順 2、`#trashNote` 手順 2・3（`Job.cancel` と強制終端の後始末）
- **一括操作ジョブ** — `spec/usecases/note.md#emptyTrash` の 51 件以上の経路（`requestBulkNoteOperation`）
- **Tag 集約（`participants.ts:46` が "curation"（#8）へ handoff と宣言）** — UC-tag-013 `deleteAssignmentsForNote`
- **BackupRecord（`participants.ts:47` が "#4" へ handoff と宣言）** — UC-integration-013 `deleteBackupRecordsForNote`

後ろの 2 つはチェックリストに UC 行として明示的に載っており、`purgeNote` 手順 5 の `note.purged` 購読者としても spec に書かれている。前の 2 つはチェックリストに UC 行がないが、#7 の TC 行（TC-note-665 / 671〜676 / 728〜730 / 733 / 736〜740、TC-note-101〜107）が直接その振る舞いを検証する。

### Decision

依存の向きで扱いを分ける。

- **`note.purged` の購読者（UC-tag-013 / UC-integration-013）は本スライスで実装する。** これらは `note.purged` を入力とする追随処理であり、完全削除（ED-10 の「元ファイル・メディア・版の履歴も削除される」）の一部として #7 の受け入れ基準に入っている。Tag / BackupRecord の**書き込み側**（タグの付与・バックアップの作成）は #8 / #4 の持ち分のままで、本スライスが足すのは削除側の集約最小形とその購読者に限る。`participants.ts` の `absent(...)` は実装した分だけ `participant` へ移す
- **Job 集約に依存する手順は、Job 側のポートを呼ぶ形のまま実装し、集約そのものは作らない。** `updateNoteBody` / `applyTextNodeEdits` / `trashNote` の手順から Job への呼び出しを削らず、spec の手順のとおり書く。Job の実体がまだ無い状態でどう成立させるか（ポートを定義して不在アダプターを噛ませるのか、`participants.ts` と同じ「不在の宣言」の形にするのか）は実装フェーズがコードを読んで決める — 既存の `absent(...)` レジストリと `identity` の削除サガが、この repo が不在をどう表現しているかの先例になる
- **Job 集約が無いと成立しない TC 行（`NoteLockedByJob` の分岐、強制終端、参照取り込みジョブの登録、`emptyTrash` の 51 件以上）は、Job の実体が入るまで完全には満たせない。** 見送る行が確定した時点で、チェックせず理由を Issue #7 のコメントに残す（Issue の完了条件が定める手順）

### Consequences

- 良い点: `note.purged` の fan-out が本スライスで揃い、完全削除が「消したつもりで残る」状態にならない。`note.purged` は購読者が 1 件も登録されていないと `dispatchDomainEvent` が warn ログだけで ack してしまうため、ここを埋めないと欠落がテストで検出できない
- 良い点: Job への呼び出しを spec の手順どおり残すので、#5 / #6 が Job を入れたときに呼び出し側を書き直さずに済む
- トレードオフ: Tag / Integration の集約が、書き込み側を持たないまま削除側だけ先に生える。#8 / #4 が後から書き込み側を足すとき、本スライスが置いた形に合わせる必要がある
- トレードオフ: Job 依存の TC 行が #7 の完了時点で残る可能性がある。残る行は Issue のコメントで理由とともに明示し、#5 / #6 側で回収する

---

## ADR-003: ワークスペース文脈の編集ページ・ゴミ箱ページも本スライスに含める

### Context

本計画の初稿（2026-08-28）は、ワークスペース文脈（`/workspaces/:workspaceId/...` 配下の同構成）をスコープ外に置いていた。理由は「`application/note/accessControl.ts` の `WorkspaceAuthorization` はプレースホルダで Issue #3 の持ち分」というものだった。

その後 Issue #3（ワークスペース管理・公開）の PR #58 が main にマージされ、この前提は成り立たなくなった。現状を読んで確認した事実は次の 3 点である。

- `packages/core/src/application/note/accessControl.ts` は `domain/workspace/services/workspaceAuthorization` の実在の `WorkspaceAuthorization` を `createNoteAccessPolicy` に渡しており、`viewerFor` は `resolveWorkspaceAccess` でスコープ側の `Membership` から役割を引いている。プレースホルダは残っていない
- `apps/web/app/routes/workspaces/$workspaceId/notes/index.tsx` と `.../notes/$noteId.tsx` が実在し、個人側の `/notes` / `/notes/:noteId` と**同じコンポーネント**（`components/note/NoteList` / `NoteDetail`）を文脈プロップ付きで描いている。2 文脈が 1 つの画面を共有する形は #3 が既に確立している
- `spec/pages/index.md#URL の割り当て` は `/workspaces/:workspaceId/...` を「ワークスペース文脈の同構成（`notes` / `tags` / `trash`）」と定め、続けて「以下では文脈によらない**1 つの画面**として記述する」と明記している。P-12（ノート編集）と P-14（ゴミ箱）の節も文脈を分けて書いていない

選択肢は 3 つあった。

1. 初稿どおり個人文脈だけを実装し、ワークスペース文脈は後続スライスに回す
2. 両文脈を本スライスに含める
3. ワークスペース文脈のルートだけ先に置き、中身は個人文脈へリダイレクトする暫定形にする

### Decision

2 を採る。P-12 / P-14 を個人・ワークスペースの 2 ルートずつ（計 6 ルート）実装し、画面本体は #3 が確立した共有パターン（`components/note/` の 1 コンポーネント + 文脈プロップ、文脈ごとの断片 server function、`noteId` で定まるミューテーションは 1 本を共有）に倣う。

1 は成立しない。spec が両者を 1 つの画面として記述している以上、「ワークスペース文脈だけ編集できない・ゴミ箱が無い」状態はチェックリストの PAGE 行を満たしたことにならず、`spec/manual-tests/editing.md` の TC-23（ユーザー A / B の競合）・TC-24（保存時の除名）・TC-28（viewer の制限）・TC-32（viewer のゴミ箱）がそもそもワークスペース前提で書かれていて実行できない。3 は URL だけ生えて中身が個人文脈という嘘の構成になり、後続スライスがリダイレクトを剥がす作業を余分に負う。

### Consequences

- 良い点: 本スライスの完了時点で編集体験が両文脈で end-to-end に成立し、`spec/manual-tests/editing.md` の権限系・競合系 TC がそのまま実行できる
- 良い点: `NoteAccessPolicy` の削除権限（本スライスで追加する）が、実在の `WorkspaceAuthorization` に対して初めて実際に効く経路を持つ。個人文脈だけではワークスペース役割の分岐が一度も踏まれない
- 良い点: 追加するのはルートとシェルの差だけで、画面本体・ミューテーション・ユースケースはすべて共有される。#3 が先例を残しているので新しい設計判断は要らない
- トレードオフ: フロントエンドのルート数が P-12 / P-14 で倍になり、ステップ 10 / 11 の実装量とレビュー範囲が増える
- トレードオフ: ワークスペース側のゴミ箱は `getWorkspaceSettings` の読み取り・`foldScopeSelectionForUnavailable` の畳み込み・`workspaceUnavailability` の写像という #3 由来の作法を守る必要があり、個人側より手順が 1 段多い。ここを個人側と同じ形で書くと、権限のないワークスペースを開いたときに画面と引き継ぎ Cookie が別の結論を出す

---

## ADR-004: 署名を持たない SVG の受理判定は「プロローグを読み飛ばしてルート要素を見る」形にする

### Context

[ADR 050](../../spec/adr/050-upload-acceptance-from-bytes.md) は受理判定を申告値ではなく実体から行うと決め、`spec/domains/storage.md` は「`ensureAcceptable` が署名から判定できるのは現時点では PNG / JPEG / WebP である。署名を持たない形式（`text/markdown`、`image/svg+xml` など）を許可する purpose を足すスライスが、入口の形をさらに広げる」と、その形の決定を後続スライスに委譲している。`media` を足す本スライスがその最初の一件になる。

`media` の許可形式（`spec/scenario/editing.md#ED-06`）のうち 3 つが単純なバイト比較で決まらない。

- **SVG** — 署名を持たない XML。先頭は BOM・XML 宣言・コメント・DOCTYPE のいずれでも始まりうる
- **MP4** — オフセット 4 の `ftyp` ボックスは HEIC / 3GP / QuickTime も持つ。ボックスの有無だけでは「ブラウザが `video/mp4` として再生できるもの」を選べない
- **WebM** — 先頭の EBML 署名は Matroska（`.mkv`）と共通で、両者を分けるのは DocType だけ

### Decision

- **SVG**: 先頭 4096 バイトをテキストとして読み、BOM → （XML 宣言 / コメント / DOCTYPE の任意の繰り返し）を読み飛ばしたうえで、**ルート要素が `svg` であること**を要求する。本文中に `<svg` が現れるだけの HTML は受理しない。内部サブセットを持つ DOCTYPE は走査が途中で終わって不受理になる（推測して通さない）
- **MP4**: `ftyp` に加えてメジャーブランドを許可リスト（`isom` / `iso2` / `iso4` / `iso5` / `iso6` / `avc1` / `mp41` / `mp42` / `mmp4` / `dash`）と照合する
- **WebM**: EBML 署名に加えて、EBML ヘッダー内（先頭 64 バイト）に DocType `webm` が現れることを要求する
- テキスト判定は署名判定の**後**に置く（バイト比較で決まる形式を先に終端させる）

### Consequences

- 良い点: `image/svg+xml` として保管したものが実際に SVG 文書であることが入口で保証され、HEIC を `video/mp4` として配信して再生できない、という取り違えも起きない
- 良い点: 判定が純粋関数のままで、ドメイン層に I/O もパーサー依存も持ち込まない
- トレードオフ: ブランド許可リストにない MP4（古い機器の独自ブランドなど）は弾かれる。取り違えて保管するより弾くほうを選んだ結果であり、要求が出たらリストに足して解消する
- トレードオフ: SVG 判定は先頭 4096 バイトしか見ない。プロローグがそれを超える文書は不受理になる

---

## ADR-005: SVG のサニタイズは `UploadValidationPolicy` に置かず `HtmlProcessor` に残す

### Context

steps.md のステップ 2 は `UploadValidationPolicy` に「`media` の規則とマジックバイト判定、SVG サニタイズ」を足すと書いている。一方 [ADR 013](../../spec/adr/013-html-sanitization-policy.md) は「規則の正典はこの ADR の表であり、**適用点は Note ドメインのポート `HtmlProcessor` ただ 1 つ**」と定め、その適用先として「SVG ファイルの保管（`storeMedia`）」を名指ししている。`spec/domains/note.md` も「取り込み・編集・メディア挿入・SVG ファイルの保管はいずれもこのポートを通す」と書く。

Storage ドメインのサービスにサニタイザーを置くと、許可リスト（要素・属性・URL スキーム・CSS 宣言）が 2 か所に生え、本文中のインライン `<svg>` と保管する SVG ファイルで別々に育つ。`spec/testcases/storage/storeMedia.md` はまさに「本文中のインライン `svg` と保管する SVG ファイルで同じ部分集合を使う」ことを期待結果にしている。

### Decision

`UploadValidationPolicy` は **`image/svg+xml` を受理してよいかまで**を決め、内容の無害化は行わない。サニタイズは `HtmlProcessor`（ステップ 1）が持ち、`storeMedia`（ステップ 6）が保管前にそのポートを通す — `spec/usecases/storage.md#storeMedia` の手順 4 がすでにそう書いている。ポリシー側にはその責務の所在を JSDoc で明記する。

### Consequences

- 良い点: ADR 013 の「適用点は 1 つ」が実装でも保たれ、TC-storage-176〜178 が本文のサニタイズと同じ規則で満たされる
- 良い点: 許可リストの改訂が 1 か所で済む
- トレードオフ: `storeMedia` の実装者は、SVG の経路で `HtmlProcessor` を呼ぶことを忘れると「受理はされたが無害化されていない SVG」を保管できてしまう。ステップ 6 の TC-storage-177 / 178 がこの穴を塞ぐ唯一の防御になる
- 未決: 保管する SVG は単体のファイルとして配信されるため、`HtmlProcessor.process` が本文断片向けに正規化した結果をそのまま `.svg` として置けるか（`xmlns` の保持など）はステップ 1 / 6 が確かめる必要がある

---

## ADR-006: `StoredFileRepository` には本スライスの経路が呼ぶ列挙だけを足す

### Context

`spec/domains/storage.md` のポート定義は 8 メソッドを挙げるが、実装済みは `listByIds` / `listByOwner` / `sumSizeByOwner` の 3 つで、JSDoc は残りを「the import slice adds the note / artifact / expiry listings」としていた。本スライスが必要とするのは `deleteFilesForNote` の `listDeletableByNote` と `collectOrphanMedia` の `listByPurposeOlderThan` の 2 つで、`listByNote`（move サガ）・`findArtifactByNoteAndVersion`・`listExpired`（生成物の回収）は本スライスのどの経路も呼ばない。

### Decision

呼ぶ 2 つだけを足し、[ADR 026](../../spec/adr/026-port-contract-and-conformance.md) の 3 点セット（ポート JSDoc → conformance スイート → memory / cloudflare 両実装）を同時に更新する。残る 3 つは JSDoc に「artifact を生成するスライスが足す」と現在形で書き換えて据え置く。契約として JSDoc とスイートに固定したのは次の 2 点。

- `listByPurposeOlderThan` の `createdBefore` は**閉区間**（`spec/testcases/storage/collectOrphanMedia.md` の「作成からちょうど 30 日 → 走査の起点に含まれる」）
- 同メソッドの**古い順**は契約であって実装の都合ではない。走査は残す判断をした行を消さないので、新しい行が古い行を押しのける順序だと同じページを永久に読み直す

### Consequences

- 良い点: 呼び出し側のいない契約を conformance に固定せずに済む。使われないメソッドは「正しさの基準」が実際には検証されない
- トレードオフ: `relocateFilesForNote` は `listByNote` が無いまま所有者走査を note で絞る形（`SCAN_PAGE_SIZE`）に留まる。`listByNote` を足すスライスがそこを寄せる

---

## ADR-007: `HtmlProcessor` は provider 非依存の `adapters/html/` に置き、実装基盤に parse5 を採る

### Context

`HtmlProcessor` は永続化ポートではない。`adapters/` の既存の区分は `memory/`（参照バックエンド）、`cloudflare/`（プロバイダー）、`node/`（ランタイム）、`oauth/`（関心事）の 4 つで、`oauth/` だけが「プロバイダーではなく関心事で切った箱」であり、その中に `googleSignInOAuthClient` / `devSignInOAuthClient` の 2 実装が並ぶ。サニタイズはバックエンドにもランタイムにも依存しない純粋な計算なので、`memory/` にも `cloudflare/` にも属さない。

実装基盤も決める必要があった。`@repo/core` の依存は `uuid` / `zod` だけで、HTML パーサーは無い。選択肢は「トークナイザーから自作する」か「HTML5 パーサーを依存に加える」かである。

[ADR 013](../../spec/adr/013-html-sanitization-policy.md) は本文が「攻撃者が任意の HTML を正規ドメイン上に置ける」経路であることを前提にしている。自作パーサーの誤りは mXSS（パースと再直列化の見え方がずれることによる回避）に直結し、その正しさは許可リストの正しさとは独立に検証しなければならない。

### Decision

`packages/core/src/adapters/html/` に置く（`allowList.ts` / `css.ts` / `htmlProcessor.ts`）。`oauth/` と同じ「関心事で切った箱」であり、バックエンドを差し替えても同じ実装を両ランタイムが共有する。DI では memory / cloudflare の**両方の composition root が同じ 1 インスタンス**を `RequestContainer.htmlProcessor` に載せる。

パースと直列化は **parse5**（HTML5 仕様準拠、依存は `entities` のみ、Node / workerd の双方で動く純 JS）に委ねる。サニタイズは parse5 が組んだ木に対して許可リストを適用し、parse5 で再直列化する。CSS の宣言単位の検査だけは自前（`css.ts`）で、これは CSS パーサーではなく「`;` / `{` / 文字列 / コメント / 括弧を数える走査器」に留める。

### Consequences

- 良い点: 壊れた HTML の補正（TC-note-720）が仕様準拠のパーサーの性質としてただで手に入る。ポートの契約が言う「壊れた HTML は例外にせず補正した結果を返す」は parse5 の fragment パーサーが全域関数であることそのものになる
- 良い点: 保存する本文は必ずパーサーの出力であり、攻撃者が書いた文字列がそのまま残る経路が無い
- 良い点: 置き場が provider 非依存なので、Cloudflare 側に別実装を持つ必要がない。サニタイズ規則がバックエンド間で分岐しない
- トレードオフ: `@repo/core` に実行時依存が 1 つ増える（`parse5` + `entities`）。フレームワーク非依存という制約は保たれるが、依存ゼロではなくなる
- トレードオフ: ポートの `SystemError(ExternalServiceError)`（パース不能）の分岐は、この実装では到達しない。死んだ `try / catch` を置くより、到達しない根拠をポートの JSDoc に書き、パーサーが失敗しうるバックエンドが翻訳する責務であると明示した

---

## ADR-008: 許可リスト外の要素は原則 unwrap し、本文の散文でない内容を持つ要素だけ subtree ごと落とす

### Context

[ADR 013](../../spec/adr/013-html-sanitization-policy.md) は「列挙にないものはすべて除去する」と決めているが、**要素を除去したときにその子をどうするか**は書いていない。2 通りある。

1. 要素と子孫をまとめて落とす
2. 要素だけ落として子を親へ繰り上げる（unwrap）

1 を全体に適用すると、`<center>`・`<font>`・未知の Web Component のような「装飾のためのラッパー」の中の本文が丸ごと消える。取り込みの中核要件（[ADR 006](../../spec/adr/006-html-content-model.md) の「装飾された HTML をそのまま取り込む」）に反する。2 を全体に適用すると、`<noscript>` の中身がテキストとして本文に昇格し、ADR 013 が名指しした「パーサーによってはサニタイズを経ずに DOM へ復活する」経路をこちらから開いてしまう。

### Decision

**既定は unwrap**、`DROP_WITH_CONTENT`（`allowList.ts`）に挙げた要素だけ subtree ごと落とす。挙げる基準は「内容が本文の散文ではないこと」— スクリプト / マークアップ源（`script`, `noscript`, `template`）、埋め込み文書（`iframe`, `frame`, `frameset`, `object`, `embed`, `applet`）、文書メタ情報（`head`, `title`）、UI ラベルであって散文でない内容（`textarea`, `select`, `optgroup`, `option`）、および foreign content の `math`。SVG の内側は許可リストが描画要素の部分集合に閉じているので、非許可の SVG 要素は常に subtree ごと落とす。

`form` / `button` / `label` などは unwrap 側に置く。要素は消えるが中の文章は残り、TC-note-692 が求める「フォーム系要素が残らない」は満たされる。

### Consequences

- 良い点: 未知のラッパーが本文を削らない。取り込み経路で本文が静かに減る事故が起きない
- 良い点: 落とす側の集合が「なぜ落とすか」で説明でき、要素を足すときの判断基準になる
- 既知の制限: `frame` / `frameset` は HTML5 パーサーが body 文脈の断片から**構文解析の段階で捨てる**ため、サニタイザーの目に触れず `removed` に載らない。出力に現れないことは構造的に保証されるが、TC-note-688 の「`removed` に含まれる」は `iframe` についてのみ検証できる。テストはその旨をケース名に持つ

---

## ADR-009: `extractExternalReferences` はリソース属性と痕跡だけを返し、ナビゲーション属性を含めない

### Context

[domains/note.md](../../spec/domains/note.md) は `extractExternalReferences` を「本文中の**属性ベースの URL 参照をすべて**返す」と書き、内部 / 外部の切り分けは `StorageUrlPolicy.isInternal` を使う呼び出し側の責務だと定める。文字どおり読むと `a[href]` や `blockquote[cite]` も対象になる。

しかし唯一の消費者である `importExternalReferences`（[usecases/storage.md](../../spec/usecases/storage.md) 手順 5）は、渡された参照を「リソース参照」と「スタイルシートの痕跡」の 2 つにしか分岐させず、リソース参照は `RemoteResourceFetcher.fetch` で取得して `ObjectStorage.put` で保管し、`rewriteReferences` で**その属性を保管先の URL に差し替える**。`a[href]` を含めると、本文中の外部リンクがリンク先ページのコピーに差し替えられる。同じ手順の記述はリソース参照を「`src` / `srcset` / `poster` といった属性が指すもの」と名指ししている。

### Decision

対象は `src` / `srcset`（候補ごと）/ `poster` と、`style[data-stylesheet-href]` の痕跡に限る。ナビゲーション属性（`a[href]`, `cite`）は返さない。あわせて、URL 自体も「取得または保管の対象になりうるもの」に絞る — 空・フラグメントのみ・`data:` / `mailto:` / `tel:` は返さない（`data:` は既に本文の中に内容があり、`mailto:` / `tel:` は取得先を持たない）。相対 URL とルート相対 URL は返す。内部 / 外部の判定は呼び出し側のままである。

`rewriteReferences` は `extractExternalReferences` と**同じ 1 つの走査**（`visitReferences`）を共有する。2 つが「何が参照か」で食い違うと、抽出できたのに差し替えられない参照が生まれる。

### Consequences

- 良い点: 外部リンクを含むだけのノートが保存のたびに参照取り込みジョブを登録しなくなる（`updateNoteBody` 手順 8 の登録条件は「内部を指さない抽出結果が 1 件以上あるか」なので、リンク 1 本で真になってしまう）
- 良い点: 抽出と差し替えの対象集合が型ではなくコード上で 1 か所に固定される
- トレードオフ: `<a href="/storage/x.png">` の形でしか本文に現れない保管メディアは、`collectOrphanMedia` から孤児と見える。メディア挿入（ED-06）が生成するのは `img` / `video` / `audio` なので現状の経路では起きないが、ダウンロードリンクを本文に置く機能が入るときは再考が要る

---

## ADR-010: 見出しの `anchorId` は `process` が本文の `id` として書き戻す

### Context

`ProcessedHtml.headings[].anchorId` は保存時に算出して保持する（[domains/note.md](../../spec/domains/note.md)）。読み取り側の `components/note/NoteBody` は目次のクリックで `shadowRoot.getElementById(anchorId)` を引く。つまり `anchorId` は**本文の中に実在する `id`** でなければならないが、取り込んだ HTML の見出しに `id` があるとは限らず、あっても重複しうる。ポートの型は `headings` と `html` を同じ 1 回の呼び出しで返すので、両者を突き合わせられるのはここだけである。

### Decision

`process` は見出しごとに、既存の `id` が空でなく他の見出しにまだ取られていなければそれを `anchorId` にし、そうでなければ見出しテキストの slug（空なら `section`）を文書全体の `id` 集合と衝突しないよう `-2`, `-3` … で一意化して `anchorId` とし、**その値を要素の `id` 属性に書き戻す**。`id` は許可リストの内側なので、この書き戻しはサニタイズ規則に反しない。

件数の上限（200 件）はここでは掛けない。`Note.updateBody` が `capHeadings` で切るのが既存の実装で、[ADR 017](../../spec/adr/017-content-size-budget.md) の行サイズ予算は集約の不変条件だからである。

### Consequences

- 良い点: 目次が必ず動く。`anchorId` が本文に無いという状態が型ではなく構築手順で排除される
- 良い点: 利用者が書いた `id` は尊重され、重複したときだけ生成 ID に置き換わる
- トレードオフ: 見出しテキストを変えると `anchorId` が変わりうるので、外部に共有された `#fragment` が切れる。本文の保存ごとに再計算する契約（「取得のたびに再計算しない」の裏返し）から来る性質で、本文が変われば版も変わる以上ここは受け入れる

---

## ADR-011: 保管する SVG の名前空間宣言は `storeMedia` が復元する

### Context

ADR-005 は SVG のサニタイズを `HtmlProcessor` に残すと決め、「保管する SVG は単体のファイルとして配信されるため、`HtmlProcessor.process` が本文断片向けに正規化した結果をそのまま `.svg` として置けるか（`xmlns` の保持など）はステップ 1 / 6 が確かめる必要がある」を未決として残した。ステップ 6 で実際に通したところ、そのままでは置けないことが分かった。

`HtmlProcessor` は `xmlns` / `xmlns:xlink` を許可リスト外として除去する。本文断片としては正しい — インラインの `<svg>` は HTML パーサーから SVG 名前空間を受け取るので、宣言は死んだ属性でしかない。しかし単体ファイルには宿主文書がない。`image/svg+xml` として配信されると XML として解析されるため、

- `xmlns` が無い SVG は何も描画されない
- 同一文書内を指す `xlink:href` が残っているのに `xmlns:xlink` が宣言されていない文書は、未宣言の接頭辞として **XML の致命的な解析エラー**になる（`use` だけでなく文書全体が表示されない）

選択肢は 3 つあった。

1. `HtmlProcessor` の許可リストに `xmlns` / `xmlns:xlink` を足す
2. `storeMedia` がサニタイズ結果に宣言を復元する
3. `xlink:href` を許可リストから外し、`href` だけを許可する（SVG 2 の書き方に寄せる）

### Decision

2 を採る。`storeMedia` の `asStandaloneSvg` が、サニタイズ済みの markup のルート `<svg>` 開始タグへ、まだ宣言されていない `xmlns` と（`xlink:` 接頭辞の属性が生き残っている場合だけ）`xmlns:xlink` を挿入する。

名前空間宣言は許可リストの一部ではなく**文書の形式**であり、サニタイザーが落とすと決めた要素も属性も 1 つも足さない。したがって ADR 013 の「規則の適用点は `HtmlProcessor` ただ 1 つ」は保たれる。1 を採らなかったのは、本文断片では意味を持たない属性を全経路で通すことになり、`HtmlProcessor` が「本文断片のサニタイザー」であるという性質を単体ファイルの都合で歪めるため。3 は既存の SVG 1.1 ファイルを描画できなくする。

### Consequences

- 良い点: 保管された SVG がそのまま配信可能な文書になる。許可リストは 1 か所のまま
- 良い点: `xmlns:xlink` は `xlink:` 属性が生き残ったときだけ宣言されるので、何も束縛しない宣言が付かない
- トレードオフ: 文字列操作でルート開始タグへ属性を挿入している。パーサー出力が入力なので形は予測できるが、`HtmlProcessor` が将来 `xmlns` を保持するようになれば重複宣言（= XML エラー）になりうる。開始タグに既に宣言があれば足さないガードで塞いでいる
- 付随: TC-storage-178 の「そのまま保管される」はバイト一致では検証しない。`<rect/>` はパーサーの直列化で `<rect></rect>` になるため、描画構文（図形・パス・テキスト・グラデーション・同一文書内 `use`）が属性ごと生き残ることをアサートする形にした

---

## ADR-012: Job の不在は、ユースケース引数で受け取る `NoteEditingJobs` の継ぎ目として表す

### Context

ADR-002 は「Job 側のポートを呼ぶ形のまま実装し、集約そのものは作らない」と決め、その表し方（不在アダプターを噛ませるのか、`participants.ts` と同じ宣言の形にするのか）は実装フェーズに委ねた。編集経路が Job に触るのは 2 点だけである — `updateNoteBody` / `applyTextNodeEdits` 手順 2 の `JobRepository.listActiveByTarget`、`updateNoteBody` 手順 8 と `restoreNoteRevision` 手順 6 の参照取り込みジョブの登録。

選択肢は 3 つあった。

1. `JobRepository` のポートを丸ごと定義し、常に空を返す不在アダプターを DI コンテナに載せる
2. 編集経路が呼ぶ 2 メソッドだけの継ぎ目を作り、ユースケースの引数として渡す
3. `application/cleanup/participants.ts` と同じ `absent(...)` レジストリに載せる

### Decision

2 を採る。`application/note/jobs.ts` に `NoteEditingJobs`（`listActiveForNote` / `requestReferenceImport`）を置き、既定値 `noNoteEditingJobs`（空配列と `null`）をユースケースの省略可能な引数で受ける。`RequestContainer` には載せない。

1 は成立しない。`JobRepository` の契約は `spec/domains/job.md` が持ち、リース・重複防止・終端の規則を含む。それを #5 / #6 より先に定義すると、呼び出し側が 2 メソッドしか使わないのに契約全体を先取りすることになり、Job のスライスが入るときに合わない形を剥がす作業が増える。3 も違う — `absent(...)` は「削除サガの参加者がまだ居ない」ことを型で網羅させる仕組みで、宣言した分だけ完了判定が変わる。ここで要るのは完了判定ではなく、呼び出しの戻り値である。

`requestReferenceImport` が `null` を返して例外を投げないのは、この呼び出しが本文の保存が commit した**後**に走るためである。ここで拒むと、効果がすでに永続化された要求を失敗として返すことになる。DTO は最初から `referenceImportJobId: null` を「取り込みジョブなし」として持っている。

### Consequences

- 良い点: #5 / #6 が Job を入れるとき、実装を 1 つ書いて DI で渡すだけで済む。ユースケース本体（順序・重複防止・`scope` の導出）は書き換わらない
- 良い点: 継ぎ目が 2 メソッドしかないので、Job の契約を先取りして誤った形に固めることがない
- 良い点: `hasImportableReference` / `requestReferenceImportIfNeeded` が `jobs.ts` に共通化され、`updateNoteBody` 手順 8 と `restoreNoteRevision` 手順 6 が同じ判定を 2 か所に書かない
- トレードオフ: 引数の既定値が「何もしない」なので、Job のスライスが入ったときに渡し忘れた呼び出し側は静かに無効化される。呼び出し側が 3 か所しかないうちは目視で足りるが、増えるなら `RequestContainer` へ移すべき境目になる
- 既知の制限: Job の実体が無い間、`NoteLockedByJob` の分岐と参照取り込みジョブの登録は**この継ぎ目に対してのみ**検証されている（TC-note-007〜010 / 728〜730 / 733〜740、TC-note-481 / 484）。実際の `listActiveByTarget` が「未終端のジョブだけを返す」ことは Job のスライスが検証する

---

## ADR-013: 編集の許可判定は入口と transaction 内で 2 回取る

### Context

編集系ユースケース（`updateNoteBody` / `applyTextNodeEdits` / `renameNote` / `changeNoteStyleMode` / `restoreNoteRevision`）は、先頭で「共通: 閲覧者コンテキストの解決」を行って `canEdit` を確認する。この読み取りは scope に束縛された `NoteReader` 経由で、transaction の外にある。

一方、`spec/testcases/note/updateNoteBody.md` は「保存時に除名されている → `NotFoundError("NOTE_NOT_FOUND")`」を要求する。除名は `Membership` の削除であって `Note` を書き換えないので、**楽観ロックでは検出できない**。入口の判定だけを持つ実装は、除名された編集者の保存をそのまま通してしまう。

### Decision

`application/note/editing.ts` に入口（`resolveEditableNote`）と commit 直前（`claimNoteForEdit`）の 2 つを置き、後者を書き込み transaction の内側で必ず通す。`claimNoteForEdit` は同じ scope の `MembershipRepository` から役割を引き直して `NoteAccessPolicy.evaluate` を再実行し、続けてゴミ箱の壁と `expectedVersion` を見る。

拒否の順序は権限 → ゴミ箱 → 版に固定する。順序が決めるのは「複数該当したときどれを報告するか」だけだが、この順序なら「編集できない」が呼び出し側の再試行対象である競合として報告されることがない。

### Consequences

- 良い点: 除名・降格が保存の直前に起きても書き込みが成立しない。入口の判定は「無駄な作業を避ける」ためのもので、正しさを担うのは transaction 内の判定であるという役割分担が型ではなく配置で表れる
- 良い点: 5 つのユースケースが同じ 2 段の門を共有するので、片方だけが判定を落とす形にならない
- トレードオフ: 権限読み取りが 1 リクエストあたり 2 回になる。ワークスペース所有のノートでは `Membership` を 2 回引く
- 検証: この窓は実装に分岐を足さず、`ScopeUnitOfWorkProvider` を薄く包んで `run` の直前に除名を差し込むことで再現している（TC-note-732）。入口の判定しか持たない実装はこのテストで落ちる

---

## ADR-014: `restoreNoteRevision` はドメイン遷移を合成するので、1 回の復元で version が 2〜3 進む

### Context

`spec/usecases/note.md#restoreNoteRevision` の手順 5 は「`Note.updateBody` と `Note.changeStyleMode`、必要なら `Note.rename` を適用して保存する」と書く。この 3 つはいずれも `Version.next` を含む遷移で、合成すると version が 1 回の保存で 2（タイトルが同じ）または 3（違う）進む。OCC の token は読み取り時の値なので保存自体は成立するが、「1 保存 = 1 版」を前提に version を数える呼び出し側は狂う。

避ける案は 2 つあった — 遷移を合成せず復元専用の遷移をドメインに足す、あるいは保存直前に version を 1 つだけ進めた形へ組み直す。

### Decision

spec の手順どおり 3 つを合成し、version が 2〜3 進むことを受け入れる。ドメインに復元専用の遷移は足さない。

復元は本文・タイトル・スタイルという 3 つの独立した変化であり、読み取りモデルはそれぞれのイベント（`note.contentUpdated` / `note.styleModeChanged` / `note.renamed`）で投影される。1 つの遷移に畳むと、どのイベントを発行するかを畳んだ遷移の内側で決め直すことになり、`changeNoteStyleMode` / `renameNote` と規則が二重になる。version を組み直す案は、ドメインが進めた version を使わずアプリケーション層が数字を作ることになり、`Version.next` を集約の外へ持ち出す。

`Note.rename` だけは値が実際に変わるときにだけ適用する。復元先の版が現在と同じタイトルを持つとき、`note.renamed` を発行して「名前を変えた」と読み取り側に言うのは事実に反する。

### Consequences

- 良い点: 復元後の読み取りモデルが 3 つの側面すべてで最新になる。どれか 1 つのイベントを発行し忘れて一覧が恒久的に古くなる、という失敗が起きない
- 良い点: 版・スタイル・タイトルの規則が 1 か所（各ドメイン遷移）にとどまる
- トレードオフ: 画面は復元の応答が返す `version` を次の保存の `expectedVersion` に使う必要がある。差分を数えて予測すると外れる
- トレードオフ: `note.styleModeChanged` は復元のたびに発行される（値が同じでも）。`changeNoteStyleMode` が同値でも発行する既存の判断（TC-note-022）と揃えた結果で、投影は現在の状態からの上書きなので結果は変わらない

---

## ADR-015: 削除側の 2 段の門は `editing.ts` を capability でパラメーター化して共有する

### Context

ADR-013 は編集系の 5 ユースケースが入口（`resolveEditableNote`）と transaction 内（`claimNoteForEdit`）の 2 段の門を共有する形を決めた。ゴミ箱の 2 経路（`trashNote` / `restoreNote`）は同じ手順を踏むが、要求する権限が `canEdit` ではなく `canDelete` で、真ん中の「ゴミ箱の壁」の意味も逆になる — `trashNote` は既にゴミ箱にあるものを成功として返し、`restoreNote` はゴミ箱にないものを `NOTE_NOT_TRASHED` で拒む。

選択肢は 2 つ。門を削除側にもう 1 組複製するか、既存の門を capability でパラメーター化して共有するか。

### Decision

共有する。`editing.ts` の内部を `resolveNoteFor(container, input, capability)` / `claimNote(ctx, { …, capability })` に切り出し、`resolveDeletableNote` / `claimNoteForDelete` を足した。既存の `resolveEditableNote` / `claimNoteForEdit` は同じ内部を `"canEdit"` で呼ぶ薄い包みになり、振る舞いは変わらない。

ライフサイクルと版の判定だけは共有しない。`claimNoteForDelete` は権限までを見て返し、ゴミ箱の壁と `ensureExpectedVersion`（新たに export した OCC の拒否）は呼び出し側が順に当てる。ADR-013 が固定した拒否順（権限 → ゴミ箱 → 版）は保つが、真ん中が経路ごとに違う以上、共有できるのはその前後だけである。

複製しない理由は ADR-013 が門を 1 か所に置いた理由と同じで、「片方だけが判定を落とす形にならない」ことが目的だから。7 経路のうち 2 経路だけが自前の門を持つと、除名の検出（ADR-013 の主眼）が削除側で静かに抜けうる。

### Consequences

- 良い点: 除名・降格が保存直前に起きたときの拒否が、編集と削除で同じコードから出る
- 良い点: `purgeNote` 以降（ステップ 8・9）も同じ 2 つを呼ぶだけで済み、3 つ目の形が生えない
- トレードオフ: `capability` という分岐が門の内部に 1 つ増える。`WorkspaceAuthorization` の表では `editNote` と `deleteNote` がともに `editor` なので、この分岐は**現時点のテストでは判別できない**（両者に差が出るのは表が変わったときで、`NoteAccessPolicy.ensureCanDelete` の JSDoc が既にその前提を書いている）
- トレードオフ: `ensureExpectedVersion` が export された。呼び忘れれば OCC が黙って外れる。呼び出し側は 7 つに収まるうちは目視で足りる

---

## ADR-016: `trashNote` の Job 依存は ctx を取る `NoteTrashJobs` で表し、継続要求は scope task として積む

### Context

ADR-012 は編集経路の Job 不在を `NoteEditingJobs`（`container` を引数に取る 2 メソッド）で表した。`trashNote` が Job に触るのは別の 2 点である — 手順 2 の `listActiveByTarget` と、そこで引いたジョブへの `Job.cancel`。spec はこの 2 つを**ゴミ箱への移動と同一 UoW** で行うことを明記している（「手順 2 の `listActiveByTarget` も UoW の内側で引く」）。

加えて手順 2 は「網が 100 件に達したら同じ UoW で継続要求 `job.terminationContinued` を積む」を要求する。`application/workspace/membershipMutation.ts` は同じ継続要求を**あえて積まない**と決めており（`continuationSubscribers` が継続種別に対して網羅的で、購読者のない継続は「無視されるイベント」ではなく「止まった鎖」になるため）、その判断と衝突しうる。

### Decision

**継ぎ目は `NoteEditingJobs` に足さず、`NoteTrashJobs` として別に定義する。** メンバーは `listActiveForNote(ctx, noteId)` と `cancelAll(ctx, { jobs, now })` の 2 つで、どちらも `RequestContainer` ではなく `ScopeUnitOfWorkContext` を取る。`JobRepository` は scope-local なので、ctx を取る形のほうが Job のスライスが入ったときの実装に近く、「UoW の内側で引く」という spec の要求が型に現れる。編集側の継ぎ目と混ぜないのは、編集側の 2 メソッドが transaction の外で呼ばれる（本文の保存が commit した後に取り込みジョブを登録する）という逆の性質を持つためである。

後始末の手順 1（`processing` のままの本文の回復）は継ぎ目のメンバーにしない。書き換える対象は `Note` であり、`Note.trash` より先に当てるという順序も呼び出し元が握るからである。手順 2（生成物の回収）は `listActiveByTarget({ type: "note" })` が batch 親を返さないことから**この経路では恒等的に空**なので、コードとしては書かず JSDoc で理由を残す（TC-note-674 / 676 がその空を検証する）。

**継続要求は `ScopeTaskScheduler.schedule` で積む。** `membershipMutation.ts` が省いたのは outbox 継続イベントで、`continuationSubscribers` の網羅性が「購読者なし = コンパイルエラー」を作る場所である。scope task はそうではなく、`scopeTaskRunner` の `scopeTaskHandlers` に kind が無い行は「due のまま残し報告する」と明示的に決めてある — 止まった鎖ではなく、見える停滞になる。加えて、この行を積める唯一の条件（網が 100 件返る）は既定の `noNoteTrashJobs` では起こりえないので、Job のスライスが入るまで本番で armed になることがない。`operationId` は `noteId`（1 ノートにつき 1 掃き）で、応答を失った再実行が同じ行を上書きする。

### Consequences

- 良い点: `runBulkNoteOperationItem`（#5 / #6）が `excludingJobId` を渡す形と、その除外が継続の 2 巡目まで運ばれる形が、Job の実体を待たずに固定される
- 良い点: 掃き出しと本文の回復とゴミ箱への移動が 1 transaction であることをテストで示せる（UoW を薄く包んで commit 直前に落とす窓）
- トレードオフ: 継ぎ目が 2 つ（`NoteEditingJobs` / `NoteTrashJobs`）になった。Job のスライスは実装を 2 つ書くことになるが、どちらも `JobRepository` の薄い包みである
- 既知の制限: `Job.cancel` の適用そのもの（未終端のジョブだけが返る、終端遷移がリースを解放する）は継ぎ目に対してしか検証されていない。実体の検証は #5 / #6 の持ち分（TC-note-665 / 666 / 669 / 670 / 673 / 675）
- 既知の制限: `job.terminationContinued` を受け取る `continueForcedTermination` は本スライスに無い。行が armed になった状態で Job のスライスが未着なら、`scopeTaskRunner` が停滞として報告し続ける

---

## ADR-017: `purgeNote` は public projection の除去と tombstone を自分で駆動し、`PublicNoteProjectionWriter` を `RequestContainer` に載せる

### Context

`spec/usecases/note.md#purgeNote` の手順 6 は「global consumer が `PublicNoteProjectionWriter.removeForPurge` を呼び、その確定後だけ `finishPurge` で 30 日 tombstone にする」と書く。つまり手順 6 は `note.purged` の out-of-band な受け手である。

しかし本リポジトリでこの受け手を成立させる部品が揃っていない。

- `WorkerContainer` は `publicNoteProjectionWriter` を持つが `NoteRouteStore` は `Pick<…, "resolve">`（`noteRouteResolver`）しか持たないので `finishPurge` に届かない
- `RequestContainer` は `noteRouteStore` を丸ごと持つが `publicNoteProjectionWriter` を持たない
- 購読者の登録先 `application/workers/subscribers.ts` は本スライスの別担当の持ち分で、手順 6 の受け手は 5 購読者のどれでもない（6 つ目にあたる）

このまま手順 6 を誰も駆動しないと、purge した route は永久に `purging` のまま残り、public 行も消えない。TC-note-354 / 355 は検証不能になる。

### Decision

**手順 6 を `purgeNote` 自身が local delete の直後に駆動する。** そのために `PublicNoteProjectionWriter` を `RequestContainer` に足し、両ランタイム（memory / Cloudflare）で配線した。

`moveNote` の先例がそのまま当てはまる — route saga の全 phase を要求経路で駆動し、switch 後に失敗したら「forward-only で止まった」ことをログに残す。purge も同じ形で、local delete が commit した瞬間から forward-only になり、`removeForPurge` → `finishPurge` の順序（ack の後だけ tombstone）はこの 1 か所で守られる。

`publicNoteProjectionWriter` を `RequestContainer` に置くのは、そこに載っている他のポートと同じ理由による — public projection は global で、どの scope の UoW にも属さない。`noteRouteStore` が「transaction の外にある saga」として同じ場所に載っているのと対になる。

### Consequences

- 良い点: purge が 1 回の呼び出しで終端まで到達する。route が `purging` のまま取り残されるのは、プロセスが落ちたときだけになる
- 良い点: 「public 削除の確定後だけ tombstone」が 1 つの関数の中の 2 行になり、順序を守る主体が分散しない（TC-note-353 の変異テストがこの順序を検出する）
- トレードオフ: spec の「global consumer」という担当分けから外れる。Cloudflare へ行くときは、この 2 行を `note.purged` の consumer へ移し、`WorkerContainer` の `noteRouteResolver` を `finishPurge` まで広げるのが移行手順になる
- トレードオフ: `RequestContainer` のポートが 1 つ増えたので、`adapters/cloudflare/__tests__/runtimeComposition.test.ts` のキー一覧にも 1 行足した

---

## ADR-018: 内部 operation ID は cleanup では派生、利用者要求では採番し、再開は `beginPurge` 自身を route の読み取りに使う

### Context

`purgeNote` 手順 2 は「`scopeCleanup` なら `sha256("ownerPurge:" + deletionOperationId + ":" + noteId)`、`userRequest` なら新規採番。ただし route が既に `purging` なら新規採番せず保存済み operation ID / phase を返して forward recovery を再開する」と決める。

ところが `NoteRouteStore` には `purging` の route を読む手段がない。`resolve` は契約として `reserved` / `purging` を返さず（ポートの JSDoc と両バックエンドが一致）、`NoteRouteFanOutReader` が返す `NoteRoute` には `operationId` が無い。つまり「route に保存済みの operation ID を読み戻す」経路そのものが存在しない。

### Decision

3 つに分けた。

1. **`scopeCleanup` の ID は spec のとおり sha256 で派生する。** 再配送が正常系である経路なので、同じ命令が同じ purge を必ず再開する
2. **`userRequest` の ID は spec のとおり `IdGenerator.next()` で採番する。** 同じノートに 2 つの要求が同時に来たとき、両者は 1 つの saga ではなく 2 人の競合者として route を取り合わなければならない（TC-note-370 の「片方は成功、もう片方は `NotFoundError`」）。派生 ID にすると `beginPurge` の冪等分岐で両方が成功してしまう
3. **再開時の route 読み取りは `beginPurge` 自身で行う。** `beginPurge` は「同じ operation の `purging` 行」を世代比較より先に返すので、ありえない世代（`RESUME_CLAIM = -1`）を渡した claim が、そのまま「この operation が握っている route を読む」操作になる。他人の route はその state か世代で必ず拒まれるので、この番兵で誤って奪うことはない。返ってきた `NoteRoute` から scope と routeVersion が復元でき、以降は「Note が残っていれば再検査して abort、消えていれば public remove から再開」を spec どおり進められる

`beginPurge` の CAS が拒否されたら、その理由（他の purge・move・tombstone）に関わらず `NOTE_NOT_FOUND` に畳む。呼び出し側から見れば、読んだノートは自分の手の届かないところへ行きつつあり、競合として返すと再試行を誘うだけだからである。

### Consequences

- 良い点: 中断・再送の窓（abort 応答喪失・local delete 後の停止・tombstone 応答喪失）が、実装に分岐を足さずポートを 1 回だけ落とすテストで全部塞げる（TC-note-352 / 353 / 355）
- 良い点: 完了済みの purge に再配送が届いても、`resolve` が返す `tombstone` を見て無操作で成功する。再配送が永久に失敗し続けることがない
- 既知の制限: **TC-note-361（利用者要求の purge が `purging` 切替後に応答を失い、再送する）は満たせない。** 入口の門は route を `resolve` するので `NOTE_NOT_FOUND` になり、採番済みの operation ID には誰も到達できない。塞ぐには `NoteRouteStore` に `purging` 行を読む契約（例: `resolveForRecovery`）を足し、両バックエンドと conformance スイートを揃える必要がある — ポートの契約変更なので本スライスの持ち分を越える
- 既知の制限: 停止した operation を走査する recovery driver（TC-note-371 / 372 の global recovery Cron）は本リポジトリに無い。`DistributedOperationStore` にも due operation を列挙する手段はなく、`moveNote` が同じ状態に置かれているのと同じ

---

## ADR-019: 完全削除の後始末は `note.purged` に載せ、`purgeNote` は local projection も使用量も触らない

### Context

`purgeNote` 手順 4 は「Note を削除し `note.purged` を収集する」までで、タグ付与・保管ファイル・バックアップ記録・読み取りモデル（`projectNoteChanges`）・使用量（`applyStorageDelta`）はすべて手順 5 の購読者に委ねる。一方 `moveNote` の `retireSource` は、同じ scope の中にある `localNoteProjectionWriter.remove` と `storageQuotaRepository` を transaction の内側で直接触っている。purge でも同じようにできてしまうため、どちらに寄せるかを決める必要があった。

### Decision

spec に従い、`purgeNote` は Note 本体と `NoteRevision` だけを消し、残りは `note.purged` の購読者に渡す。`localNoteProjectionWriter.remove` も `storageQuotaRepository` も呼ばない。

`moveNote` と分かれるのは、移動が「同じ 1 要求の中で source を退役させる」のに対し、完全削除は 5 つの独立した後始末が結果整合で追随する設計（[ADR 008](../../spec/adr/008-domain-boundaries.md)）だからである。片方を usecase に取り込むと、同じ後始末が「usecase 側」と「購読者側」の 2 か所に生えて、どちらが権威か決められなくなる。

`NoteRevision` だけは例外として transaction の内側で消す。spec の TC は「DB の FK CASCADE で同時に削除される」と書くが、本リポジトリのスキーマは FOREIGN KEY を宣言しない方針（`0001_global_schema.sql` の冒頭）で、CASCADE 相当は「それを起こした書き込み」か「イベント」が担う。版は Note と同じ scope・同じ transaction にあるので前者に寄せた（`moveNote.retireSource` と同じ形）。

### Consequences

- 良い点: 後始末の権威が購読者側の 1 か所に集まる。`emptyTrash` が 50 件を 1 transaction に束ねない理由（結果整合で後始末する以上まとめても保証は増えない）と整合する
- 既知の制限: `note.purged` の購読者が揃うまで、local projection の行と使用量の減算は残る。本スライスの `listNotes` は `NoteRepository` を直接読むので画面には出ないが、読み取りモデルを読む経路が増える前に埋める必要がある
- 既知の制限: TC-note-357 / 358 / 359 / 365 / 366 / 367（タグ付与・保管ファイル・バックアップ記録・読み取りモデル・使用量・Drive 上のファイル）は購読者側の持ち分で、`purgeNote` のテストは「`note.purged` が正しい形で 1 回だけ収集される」までしか見ない

---

## ADR-020: `note.purged` の 3 購読者は同じ継続の形を共有し、task の `operationId` に purge の operation ID を使う

### Context

`deleteFilesForNote` / `deleteAssignmentsForNote` / `deleteBackupRecordsForNote` は、いずれも「1 ターンで有界のページを消し、満ページなら自分を再登録する」同じ形をとる（spec の各節）。継続要求の名前は `storage.noteDeleteContinued` / `tag.noteDeleteContinued` / `integration.noteDeleteContinued` で、payload は 3 つとも `{ noteId, deletionOperationId }`（`spec/domains/index.md` の継続要求表）。

一方 `ScopeTaskScheduler` の行は `(kind, operationId)` で一意になる。spec は payload の形は定めるが、この `operationId` に何を使うかは書いていない。加えて priority（0〜3）についても、note purge の追随がどの階級に属するかの記述がない。

### Decision

- **task の `operationId` は `note.purged` の `operationId`（purge の内部 operation ID、ADR-018）をそのまま使う。** kind が 3 つに分かれているので 3 購読者は衝突せず、同じイベントが再配送されても `schedule` が同じ 1 行を上書きするだけで継続が増えない
- **priority は 3 つとも `securityCleanup`（0）。** `deletionOperationId` の有無で分けない。完全削除が回収するのは「利用者が消えたことにしてくれと言ったデータ」であり、account / workspace deletion 由来のときは同じ行がその barrier の後始末でもある。分岐を入れると、同じ行が由来によって別の階級で走ることになる
- **共有部分は `application/cleanup/notePurgeFanOut.ts` に置く。** 3 購読者が共有するのは turn の型・payload の読み取り・継続の再登録・`NoteOwner → ScopeKey` の写像だけで、ページの読み書きは各ユースケースが自分のポートに対して行う
- **継続 kind のハンドラは `application/workers/scopeTaskRunner.ts` の `scopeTaskHandlers` に登録する。** 未登録の kind は「due のまま warn を出し続ける」扱いになり、250 件のノートの 101 件目以降が永久に残る

### Consequences

- 良い点: 3 購読者が同じ形なので、レビューと再開の挙動が 1 か所を読めば分かる。継続の増殖・取りこぼしの原因が payload と `operationId` の 2 つに閉じる
- 良い点: 購読者ごとに独立して冪等なので、1 つが失敗して再配送されても他は 0 件で終わる（TC-storage-061 / TC-tag-030 / TC-integration-021 が購読者単位で押さえている）
- トレードオフ: `scopeTaskRunner.ts` はステップ 9 も触るファイルで、本ステップは 3 エントリを足すだけだが衝突しうる
- 既知の制限: `deleteFilesForNote` の spec 手順 3 後半（`ReferenceImportRecordRepository.deleteByNote` による取得記録・要約の削除）は実装していない。当該ポートも `reference_import_attempts` / `reference_import_summaries` も本リポジトリに存在せず、取り込みスライス（#6）の持ち分だからである。保管ファイル側の回収だけが本スライスの実装で、記録側は #6 が同じ継続 task に足す

---

## ADR-021: Tag / BackupRecord は削除側だけを生やし、`participants.ts` の `absent` は動かさない

### Context

ADR-002 は「`participants.ts` の `absent(...)` は実装した分だけ `participant` へ移す」と書いていた。実装フェーズで `application/ports/scopeCleanupAdmissionStore.ts` と `application/cleanup/participants.ts` を読むと、`PersonalCleanupComponent` の `tag` / `backup` が指しているのは **scope 全体を掃く後始末**（`deleteTagsForScope` と利用者単位のバックアップ記録回収）であって、ノート 1 件ごとに走る `note.purged` の購読者ではないことが分かる。

`participant` へ移すと `REQUIRED_PERSONAL_CLEANUP_COMPONENTS` に載り、`markCompleted` がその ack を待つようになる。ack する実装が無いまま移せば、退会したアカウントが `deleting` のまま二度と完了しない。

### Decision

- **`tag` / `backup` は `absent` のまま残し、理由の文面だけ現状に合わせる。** 「集約が存在しない」から「scope 全体を掃く後始末が無い」へ書き換える。`participant` への昇格は `deleteTagsForScope`（#8）と利用者単位の記録回収（#4）が入るときに行う
- **足すのは削除側の最小形だけ。** `TagAssignment` / `BackupRecord` は `reconstruct` だけを持ち、`create` / `record` / `replace` とそれらが出すイベント（`tag.assigned` / `integration.backupCompleted`）は作らない。`TagRepository`（タグ語彙）と `BackupRecordRepository` の OCC 半分（`findById` / `save` / `delete`）も作らない。ポートに載せるのは `insert` / `listByNote` / `deleteByNote` の 3 つで、`insert` は conformance と usecase テストが行を置くために要る
- **`TagName` の正規化は作らない。** 小文字化・全角半角・空白畳みは語彙の同一判定の規則で、`assignTag` / `renameTag` / `mergeTags` を持つ #8 が決める。削除側は `tagId` を不透明な ID として扱う

### Consequences

- 良い点: 退会の barrier が壊れない。`REQUIRED_PERSONAL_CLEANUP_COMPONENTS` は「実際に ack する実装がある」ものだけを列挙し続ける
- 良い点: #8 / #4 は既存の行の形（テーブル定義・`reconstruct`・conformance スイート）を引き継いで書き込み側を足すだけでよく、削除側を書き直す必要がない
- トレードオフ: TC-tag-024（「タグ本体は残る」）は `tags` テーブルがまだ無いため直接は書けない。代わりに「このユースケースは scope の中で `tag_assignments` 以外のどのテーブルも増減させない」を検証している。語彙の残存そのものは #8 が `TagRepository` を入れた時点で直接書ける
- 既知の制限: TC-storage-074（`applyStorageDelta` との重複排除）は `applyStorageDelta` が未実装のため書けない。TC-storage-063 / 066 / 067 / 073 は、`deleteStoredObjects` の実装が spec の「1 配送分のまとまりを受け取り `deletedCount` / `failed` を返す」形ではなく `storage.fileDeleted` を 1 件ずつ受ける形になっているため、購読者を 1 件ずつ回して「失敗した鍵だけが残り、他は回収される」を検証する形に読み替えている。署名を spec に合わせるかは、本ステップの担当範囲（実装は変えない）の外

---

## ADR-022: `emptyTrash` の 51 件以上の経路は `NoteBulkPurgeJobs` の継ぎ目で表す

### Context

ADR-002 は「一括操作ジョブ（`requestBulkNoteOperation` の `{ kind: "purge" }`）は Job 集約が無いので、spec の手順から呼び出しを削らずに実装する」と決めた。`emptyTrash` が Job に触るのは 1 点だけである — 手順 2 の 50 件超の分岐で、500 件ごとの分割を親 Job として登録する箇所。

### Decision

ADR-012 / ADR-016 と同じ形をとる。`emptyTrash.ts` に `NoteBulkPurgeJobs`（`requestBulkPurge` の 1 メソッド）を置き、既定値 `noNoteBulkPurgeJobs`（`null` を返す）をユースケースの省略可能な引数で受ける。置き場所を `jobs.ts` にしないのは、このメソッドの呼び出し側が 1 か所しかなく、編集経路（transaction の外）とゴミ箱経路（transaction の内側）という `jobs.ts` の 2 つの継ぎ目のどちらの性質も持たないためである。

`null` は「この配備には Job を登録する先が無い」を意味し、`jobIds` に積まれない。件数と `mode` は Job の有無に関わらず spec のとおり返るので、画面の文言分岐（`"purged"` / `"scheduled"`）は Job のスライスを待たずに正しく動く。

分割は列挙しながら 500 件ごとに flush する。この経路は 1 件も消さないので、offset ページングでも列挙が自分の足元を崩さない。

### Consequences

- 良い点: TC-note-102 / 103 / 106 / 107（境界 51、分割 500、1200 件の 500/500/200、各分割の source ScopeKey）が継ぎ目に対して検証できる。実際の `bulkDelete` Job 行が生えるかは #5 / #6 の持ち分
- 既知の制限: `jobIds` に**本物の Job ID** が返ることは検証できない。テストは記録用の継ぎ目が返す ID を見ている

---

## ADR-023: 完全削除を駆動できるのは request plane だけなので、一括・自動の回収は `RequestContainer` を取り、`scopeTaskRunner` には登録しない

### Context

ADR-017 は `purgeNote` に route saga の全 phase（`beginPurge` → local delete → `removeForPurge` → `finishPurge`）を駆動させ、そのために `PublicNoteProjectionWriter` を `RequestContainer` に載せた。結果として `purgeNote` の引数は `RequestContainer` である。

一方 `WorkerContainer` が持つ note route のポートは `noteRouteResolver`（`Pick<NoteRouteStore, "resolve">`）だけで、`beginPurge` / `abortPurge` / `finishPurge` に届かない。`scopeRouter` / `noteReaderFor` / `workspaceReaderFor` も無い。つまり **worker plane からは 1 件のノートも purge できない**。

`deleteNotesForOwner` / `purgeExpiredTrash` は spec 上は Alarm / cleanup command から呼ばれる worker plane の経路である。両者は `purgeNote` の合成で成り立つので、この非対称が直接ぶつかる。

### Decision

- **2 つのユースケースは `RequestContainer` を取る。** `purgeNote` と同じ plane に置き、合成をそのまま成立させる
- **`application/workers/scopeTaskRunner.ts` には登録しない。** `ScopeTaskHandler` は `WorkerContainer` を受け取るので、登録しても呼べる実装が書けない。未登録の kind は「due のまま warn を出して残す」と runner が明示的に決めており、嘘の完了より見える停滞のほうがよい
- **`application/cleanup/participants.ts` の `note` は `absent` のまま、理由の文面だけ現状に合わせる。** `participant` へ移すと `REQUIRED_PERSONAL_CLEANUP_COMPONENTS` に載り、`PERSONAL_CLEANUP_COMMANDS`（`WorkerContainer` を受け取る）に `note` の行が要るが、その行が書けない。ack する実装が無いまま移せば退会が永久に完了しない（ADR-021 と同じ判断）
- **`deleteNotesForOwner` は `acknowledgePersonalComponent(operationId, "note")` を呼ぶ。** 不在宣言されている component を ack しても完了判定は変わらず、worker plane が広がって `participant` へ移した瞬間に配線が揃う

解消の手順は 1 つに絞れる — `WorkerContainer` に `noteRouteStore` / `scopeRouter` / `noteReaderFor` / `workspaceReaderFor` を足す（か、`purgeNote` の引数を構造的に絞る）こと。どちらも DI の型と両ランタイム、`adapters/cloudflare/__tests__/runtimeComposition.test.ts` を触るので、本ステップの担当範囲の外である。

### Consequences

- 良い点: 2 ユースケースは今日から呼べて、TC 行のほぼ全部が実 backend の上で検証できる
- 既知の制限: `deleteNotesForOwner` が積む `note.ownerPurgeContinued` を処理する受け手が居ない。101 件目以降は次の呼び出しが来るまで残り、runner は行を due のまま報告し続ける
- 既知の制限: 退会 / ワークスペース削除からこのユースケースを起動する経路（`cleanupDispatch` の command、`workspace.deleted` の購読者）が無い。どちらも `WorkerContainer` 側の配線で、上の解消手順とセットになる

---

## ADR-024: `purgeExpiredTrash` の purge は `ExpiredNotePurge` の継ぎ目にする

### Context

`spec/usecases/note.md#purgeNote` の入力 DTO は `userRequest` と `scopeCleanup` の 2 種だけである。保持期限の回収はそのどちらでもない — 要求した人が居ないので `userRequest` の権限判定に評価する相手が無く（ワークスペース所有ノートでは名指しできる member すら決まらない）、削除 barrier も無いので `scopeCleanup` の `assertOwner` に拒まれる。

`spec/usecases/note.md#purgeExpiredTrash` は手順 2 を「内部 purge command を開始し、route を閉じてから local delete・public remove・tombstone まで進める」と書き、`emptyTrash` / `deleteNotesForOwner` と違って `purgeNote` を名指ししていない。spec 側にも同じ穴がある。

### Decision

列挙・境界・上限・継続の判断は本ユースケースが持ち、purge の 1 件分だけを `ExpiredNotePurge` として呼び出し側から受ける。**既定値は置かない**。「何もしない」既定を置くと、期限切れのノートを 1 件も消さないまま成功を返す掃除になるからである。

塞ぐには `PurgeNoteInput` に 3 つ目の admission 種別（actor も barrier も要求せず、scope 一致と expected version だけを見るもの）を足す。`purgeNote.ts` の変更は本ステップの担当範囲の外なので、継ぎ目のまま残す。

### Consequences

- 良い点: 保持期限の述語（`purgeAfter <= now`）、`limit` の上限、満ページでの再武装、進捗 0 での backoff が実 backend の上で検証できる（TC-note-340〜343 / 345 / 346）
- 既知の制限: 本番の駆動経路が無い。上記の admission 種別に加えて、`trashNote` が最小の `purgeAfter` で `scheduled_tasks` を upsert する手順（spec の概要）も未実装で、そちらも本ステップの担当範囲の外
- 既知の制限: TC-note-347（実行後に使用量が減っている）は `applyStorageDelta` が未実装のため書けない

---

## ADR-025: `deleteNotesForOwner` の継続要求は、バッチの最後の削除とは別の transaction で積む

### Context

`spec/usecases/note.md#deleteNotesForOwner` の手順 4 は、継続要求 `note.ownerPurgeContinued` を「そのバッチの最後の削除と同じ scope-local `UnitOfWorkProvider.run` の中で」積むことを求める。`deleteFilesByOwner` はこれを満たしている — 削除も継続も同じ 1 つの `run` の中にあるからである。

`deleteNotesForOwner` の削除は `purgeNote` の呼び出しで、`purgeNote` は自分の transaction を開いて確定する。`run` の入れ子は禁止なので、同じ transaction に相乗りする方法が無い。

### Decision

継続の判断（settled / continued / stalled）とその書き込みを、バッチの直後に開く 1 つの独立した `run` にまとめる。同じ transaction に置けない代わりに、**その窓で失われるものが何かを固定する**: バッチの purge は既に確定しており、落ちるのは task 行の武装だけである。同じ cleanup command の再配送がそれを取り戻す（再配送はこの経路の正常系で、残りを先頭から読み直すだけで前に進む）。

`assertOwner` はバッチの前に 1 回、`purgeNote` の中で 1 件ごとにもう 1 回取られる。前者は「所有権を失った command に列挙もさせない」ため、後者は削除そのものと同じ transaction にあるための判定で、役割が違う。

### Consequences

- 良い点: `run` の入れ子を作らずに spec の手順の意味（残作業がある限り 1 系列 1 行の継続が残る）を保てる
- トレードオフ: 「バッチは進んだが継続が積まれていない」窓が開く。塞ぐには purge の transaction を呼び出し側が握れる形（ADR-023 の解消手順）が要る

---

## ADR-026: `purgeNote` の依存を構造的に絞り、内部 admission を両面から駆動できるようにする

### Context

ADR-023 は「完全削除を駆動できるのは request plane だけ」と結論し、`deleteNotesForOwner` / `purgeExpiredTrash` を `RequestContainer` に置いて `scopeTaskRunner` に登録しなかった。結果、`note.ownerPurgeContinued` は積まれるが受け手が居らず、退会・ワークスペース削除からノートを 1 件も回収できない状態が残った。同 ADR は解消手順を「`WorkerContainer` にポートを足すか、`purgeNote` の引数を構造的に絞る」と 2 案で書いている。

### Decision

**後者を採る。** `purgeNote` が本当に要求するのは saga の 3 ストア（scope UoW・`NoteRouteStore`・`PublicNoteProjectionWriter`）と `SharedDeps` だけで、`RequestContainer` の残り（`scopeRouter` / `noteReaderFor` / `workspaceReaderFor`）は `userRequest` の閲覧者解決にしか使わない。そこで

- `application/di/types.ts` に `NotePurgeContainer`（`SharedDeps` + 上記 3 つ）を定義する。`RequestContainer` も `WorkerContainer` も構造的にこれを満たす
- `purgeNote` は `PurgeNoteInput` 全体を受ける入口のまま残し、actor を名指ししない admission を `purgeNoteInternally(NotePurgeContainer, InternalPurgeNoteInput)` として切り出す
- `WorkerContainer` の `noteRouteResolver`（`Pick<…, "resolve">`）を `noteRouteStore` 丸ごとに広げる。route の claim / abort / tombstone は読み取りでは書けない。author redaction の用途は呼び出しとして `resolve` のままにする
- `deleteNotesForOwner` / `purgeExpiredTrash` は `NotePurgeContainer` を取り、`scopeTaskRunner` の `scopeTaskHandlers` に `note.ownerPurgeContinued` / `note.trashExpiryContinued` を登録する

`deleteNotesForOwner` の列挙は `container.noteReaderFor(scope)` をやめ、`assertOwner` と同じ transaction の中で `ctx.noteRepository.listByOwner` を引く。読み取り view は request 面にしかないので、両面から届く唯一の面である scope UoW に寄せた。ADR-025 の「継続は別 transaction」は変わらない（`purgeNote` が自分の transaction を持つ以上、入れ子は依然禁止）。

**ADR-023 の判断はこの ADR が上書きする。** ADR-017（`purgeNote` が public projection と tombstone を自分で駆動する）はそのまま有効で、変わったのは「その駆動が request plane に限られる」という前提だけである。

### Consequences

- 良い点: 退会の cleanup wave からノートが回収される。`PERSONAL_CLEANUP_COMMANDS` に `note` の行が書けるようになった
- 良い点: `purgeNote` の依存が型で最小化され、worker 面が request 面の閲覧者解決を抱え込まずに済む
- トレードオフ: `WorkerContainer` のポートが 1 つ広がったので `adapters/cloudflare/__tests__/runtimeComposition.test.ts` のキー一覧と両ランタイムの配線を触った
- 既知の制限: `workspace.deleted` から `deleteNotesForOwner` を起動する経路はまだ無い。ワークスペース削除の local 側 3 フェーズ（`workspaceDeletionLocal`）は Membership / Invitation しか掃かず、そこに note の phase を足すのは削除サガ側の持ち分である

---

## ADR-027: 保持期限の purge は `retention` admission にし、Alarm は「最小の次期限」を scope から読み直して張り替える

### Context

ADR-024 は `purgeExpiredTrash` の purge を `ExpiredNotePurge` の継ぎ目にし、塞ぐには `PurgeNoteInput` の 3 つ目の admission 種別と、`trashNote` の `purgeAfter` upsert が要ると書いた。どちらも未実装で、本番の駆動経路が無かった。

`ScopeTaskScheduler.schedule` は `(kind, operationId)` の upsert で、`dueAt` を無条件に入力値へ書き換える。したがって `trashNote` が「自分の `purgeAfter`」を積むと、新しいノートを捨てるたびに古いノートの期限が後ろへ押し出され、捨て続ける scope は永久に回収されない。spec が「**最小の** `purgeAfter` を upsert」と書いているのはこの点である。ところが `NoteRepository` には最小の `purgeAfter` を読む手段が無い。

### Decision

- **`PurgeNoteInput` に `retention` を足す。** actor も barrier も持たず、残るのは列挙が既に立てた 2 つの主張（このノートはこの scope に居る・この版である）だけ。operation ID は `sha256("trashExpiry:" + noteId)` の派生とする — sweep 自身に operation が無く、turn は自由に再実行されるので、重なった 2 turn は 1 つの purge を再開しなければならない
- **`NoteRepository.findNextPurgeDeadline()` を足す**（ポート JSDoc + memory + cloudflare + conformance の 3 点セット、[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)）。`listPurgeable` の JSDoc にも順序（`purgeAfter ASC, id ASC`）を明記し、conformance で固定した
- **`trashNote` は保存と同じ transaction で、scope の最小期限を読み直して Alarm を張る。** 自分の `purgeAfter` を書かないのは上の理由による。ゴミ箱が空なら張らない
- **`purgeExpiredTrash` は「due が 0 件」で `complete` せず、次の期限へ行を張り替える。** 完了するのはゴミ箱が空のときだけ。UC-note-021 の「残件または次期限に Alarm を設定する」がこの形で、`complete` だけだと「まだ期限前のノート」が、無関係なノートが捨てられるまで誰にも見られなくなる
- 継ぎ目 `ExpiredNotePurge` は削除する。ADR-024 が「admission 種別ができるまで」と条件付きで置いたものなので、条件が満たされた時点で残す理由が無い

### Consequences

- 良い点: AC-10（保持期限による自動削除）が Alarm → runner → sweep → purge の実経路で成立する
- 良い点: 「最小期限」を毎回読み直すので、復元・利用者による完全削除で期限集合が変わっても次の turn が自分で正しい位置へ張り替える。取りこぼしの回復に別の driver が要らない
- トレードオフ: ゴミ箱に何か入っている限り scope に task 行が 1 本常駐する。行は 1 scope 1 本で、`dueAt` は最も近い期限なので、runner の tick が空振りするのは期限が来たときだけである
- 既知の制限: TC-note-347（実行後に使用量が減っている）は `applyStorageDelta` が未実装のため依然書けない

---

## ADR-028: `participants.ts` の `note` を participant へ昇格する

### Context

ADR-021 / ADR-023 は「ack する実装が無いまま `participant` へ移せば、退会したアカウントが `deleting` のまま二度と完了しない」として `note` を `absent` に留めた。理由は `PERSONAL_CLEANUP_COMMANDS`（`WorkerContainer` を受け取る）に書ける行が無かったことである。

### Decision

ADR-026 で `deleteNotesForOwner` が `WorkerContainer` からそのまま呼べるようになったので、**`note` を `{ kind: "participant", taskKind: NOTE_OWNER_PURGE_TASK_KIND }` へ昇格する。** `NOTE_OWNER_PURGE_TASK_KIND` の定義は `participants.ts` へ移し、`deleteNotesForOwner` はそれを再輸出する（他の 2 参加者と同じ形。逆向きに import すると `personalCleanup` 経由で循環する）。

`PERSONAL_CLEANUP_COMMANDS` の `note` は `commandKey` を渡さない。この turn は「列挙して壊す」ので、再配送は前回の残りを読むだけで収束し、抑止すべき「適用済み」状態が存在しない（`deleteFilesByOwner` / `deleteQuota` の `commandKey` は 1 回性のある turn のためのもの）。

`tag` / `backup` / `job` / `localProjection` / `outbox` は ADR-021 のまま `absent` に据え置く — これらは scope 全体を掃く後始末が本当に無い。

### Consequences

- 良い点: 退会の barrier が「ノートも消えた」ことを実際に待つようになった。`REQUIRED_PERSONAL_CLEANUP_COMPONENTS` は `storage` / `usage` / `note` の 3 つ
- 良い点: cleanup wave → `deleteNotesForOwner` → 継続 task → runner → `deleteNotesForOwner` の連鎖が閉じ、`note.ownerPurgeContinued` を積みっぱなしにする経路が無くなった
- トレードオフ: 退会テストで barrier を手組みしていた箇所は、コンポーネント列を `REQUIRED_PERSONAL_CLEANUP_COMPONENTS` から取るよう直した。以後 participant が増えても手組み側が置いていかれない

---

## ADR-029: 孤児メディアの走査は worker 面へ `HtmlProcessor` の読み取り半分を渡して駆動する

### Context

`collectOrphanMedia` は「所属ノートの本文に当該ファイルの URL が現れるか」を `HtmlProcessor.extractExternalReferences` で調べる（`spec/usecases/storage.md#collectOrphanMedia` 手順 2）。駆動は scope Alarm なので受け手は `scopeTaskRunner` の `ScopeTaskHandler` で、引数は `WorkerContainer` である。ところが `htmlProcessor` は `RequestContainer` にしか載っておらず、ADR-023 が `purgeNote` で踏んだのと同じ「worker 面から呼べないユースケース」がそのまま再現する。

### Decision

ADR-026 と同じ形を採る。

- **`WorkerContainer` に `htmlProcessor` を足す。ただしポート丸ごとではなく `HtmlReferenceReader`（`Pick<HtmlProcessor, "extractExternalReferences">`）にする。** `process` はサニタイズ結果（html / text / excerpt / headings）を作る**書き込みの判断**で、worker 面にその判断をする経路は無い。本文を読むだけの用途に読み取り半分だけを渡す
- **ユースケース側は `OrphanMediaContainer`（`SharedDeps` + `scopeUnitOfWorkProvider` + `Pick<ObjectStorage, "publicUrl">` + `HtmlReferenceReader`）を自分で名乗る。** `RequestContainer` も `WorkerContainer` も構造的に満たす
- **`storage.orphanMediaContinued` を `scopeTaskHandlers` に登録する。** 未登録の kind は due のまま warn を出し続けるだけで、走査は一度も走らない

`objectStorage` は既に `WorkerContainer` にある。`appUrl` は無いので、本文中の参照とファイルの公開 URL の突き合わせは配備の origin を知らずに済む形（完全一致 → 解決後の pathname 一致）にした。誤答は「消さずに残す」側へ倒れる。

### Consequences

- 良い点: Alarm → runner → 走査 → 削除 → 再武装の連鎖が実経路として閉じ、TC-storage-027 を worker 面から完走で検証できる
- トレードオフ: `WorkerContainer` のポートが 1 つ増えたので、両ランタイムの配線と `adapters/cloudflare/__tests__/runtimeComposition.test.ts` の `WORKER_PORTS` を触った（ADR-026 と同じ範囲）
- 既知の制限: `publicUrl` が絶対 URL の配備では、別ホストの同一 path を持つ URL を本文が指していると参照中と誤判定する。倒れる向きは「残す」なので回収漏れにしかならない

---

## ADR-030: 日次 task の起点は `storeMedia` の「scope 最初の 1 件」に置き、走査は行を complete せず張り替える

### Context

`spec/usecases/storage.md#collectOrphanMedia` は「scopeで最初のmediaを登録するときに日次taskを自己登録し」「処理後は翌日のtaskを自己登録する」「`limit`件に達したときは直後にも継続taskを設定」と定める。`ScopeTaskScheduler.schedule` は `(kind, operationId)` の upsert で `dueAt` を無条件に上書きするため、**毎回の登録で張り直すと、メディアを毎日挿入する scope の走査が永久に後ろへ逃げる**（ADR-027 が `trashNote` で踏んだのと同じ罠）。

また `listByPurposeOlderThan` にはカーソルが無く、走査は残すと決めた行をページの先頭に残す。満ページで無条件に「直後」を張ると、全件が参照中のページを永久に読み直す spin になる。

### Decision

- **起点は `storeMedia` が張る。** transaction の中、`StoredFile` を insert する前に `listByPurposeOlderThan("media", now, 1)` を引き、**0 件のときだけ**翌日の行を張る。「まだ media が無い」と「これが 1 件目」が同じ読みになる位置に置いた
- **走査は行を `complete` しない。** 周期的な掃除なので、翌日（既定）か直後（残件あり）へ張り替える。ゴミ箱の sweep（ADR-027）が「空になったら complete」なのと非対称なのは、ゴミ箱には「空」という終端があるがメディアには無いため
- **「直後」を張る条件は「満ページ**かつ**当該 turn が 1 件以上回収した」。** 満ページだけを条件にすると上記の spin になる。進捗が無いページは翌日へ回し、次の日にもう一度同じ判断をする
- **削除は 1 件 1 transaction。** spec の「個々の失敗は記録して継続」を満たすには、1 件の失敗がページ全体を巻き戻してはならない。判定（列挙 + 本文の読み）は 1 つの transaction にまとめる
- **所属ノートが不在なら回収、本文が読めない（`processing` / `failed` など）なら残す。** 不在は終端だが、本文が無い状態は一時的で、「本文が無い」ことは「参照が外れた」証拠にならない

### Consequences

- 良い点: 実運用の駆動経路（最初の 1 件 → 翌日 → 残件があれば直後 → 翌日）が揃い、TC-storage-026 / 027 が実 backend の上で成立する
- トレードオフ: media を 1 件でも持った scope には task 行が 1 本常駐する。runner の tick は 1 日 1 回しか当たらない
- 既知の制限: カーソルが無いため、先頭 `limit` 件がすべて参照中のまま滞留すると、その後ろにある孤児へ到達できない。解消にはポートへキーセットを足す必要があり、本スライスの担当範囲の外

---

## ADR-031: `getNote` の出力 DTO に `version` を足す

### Context

P-12 の保存経路はすべて `expectedVersion: number` を要求する（`updateNoteBody` / `applyTextNodeEdits` / `renameNote` / `changeNoteStyleMode` / `restoreNoteRevision`、ゴミ箱側の `trashNote` / `restoreNote` も同じ）。応答は新しい版を返すので、**2 回目以降**の保存に渡す版は画面が持てる。持てないのは**最初の 1 回**である。

読み取り側を全部当たったが、版を返す読み取りが 1 つも無い。`spec/usecases/note.md#getNote` の出力 DTO 表に `version` の行が無く、`listNotes` の `NoteListItemView` にも無い。`spec/usecases/identity.md` の「対象の版を持たない呼び出し元は、呼ぶ直前に自分で対象を引いてそのときの版を渡す」という規約はユースケース間の合成についてのもので、転送境界の向こうにいる画面には使えない。既存コード自身がこの穴を書き残していて、`apps/web/app/routes/notes/-action.tsx` の `moveNoteFn` の JSDoc は「`getNote` が版を返すようになったら、画面が見た版をここで受け取る形にする」と述べている（`moveNote` は `expectedVersion: number | null` を取れるので回避できていた）。

つまり **P-12 は現状の読み取りだけでは 1 文字も保存できない**。選択肢は 3 つあった。

1. `getNote` に `version` を足す
2. 編集画面専用の読み取りユースケース（`getNoteForEdit` など）を新設する
3. 保存のサーバー関数の中でコンテナのポート（`scopeRouter` / `noteReaderFor`）を直に引いて版を得る

### Decision

1 を採る。`NoteDetailView` に `version: number` を足し、`getNote` が `note.version` を載せる（2 行）。

3 は却下。presentation が application を飛び越えてドメインのポートを駆動することになり、CLAUDE.md の依存方向（presentation → application → domain）を破る。2 は「同じ集約を同じ権限で読む」ユースケースが 2 本並ぶことになり、`getNote` の分岐（共有トークン・匿名閲覧）を複製する。`getNote` は現状 P-11 の認証済み経路からしか呼ばれておらず（公開ページは別経路）、版が漏れる範囲は「そのノートを読める者」に閉じている。値は単調増加のカウンターで、編集回数以上のことは語らない。

### Consequences

- 良い点: 編集画面が最初の保存から楽観ロックを効かせられる。ED-08 の「競合」が実際に検出される状態になる
- 良い点: P-11 のタイトルインライン編集（PAGE-p11-002）と P-14 のゴミ箱（復元・完全削除）も同じ値を使える。後続スライスが同じ穴を再発見しなくて済む
- トレードオフ: **`spec/usecases/note.md#getNote` の出力 DTO 表が実装より 1 行少ない状態になった。** spec 側の追記が要る（本スライスの担当範囲外なので実施していない）
- トレードオフ: バックエンドは完成済みという前提のもとでフロントエンド側の作業として `packages/core` に触れた。追加は純粋に加算的で振る舞いを変えないが、レビューの対象にすべき変更である

---

## ADR-032: 編集ルートは `$noteId_.edit.tsx` にする（`$noteId.edit.tsx` は詳細の子になる）

### Context

steps.md のステップ 10 は「既存の `$noteId.tsx` と衝突しない命名（`$noteId.edit.tsx`）を守る」と指示している。実際に `routes/notes/$noteId.edit.tsx` を置いて route tree を生成すると、TanStack のフラットルーティングは `$noteId` を共通の親セグメントと見なし、

```
getParentRoute: () => NotesNoteIdRoute
```

を出す。`routes/notes/$noteId.tsx` は `<Outlet />` を持たない（P-11 は単独の画面である）ため、`/notes/:noteId/edit` を開くと**詳細がそのまま描かれ、編集画面は 1 度も描かれない**。ファイル名は衝突していないのに、ルーティングとしては衝突している。

### Decision

`$noteId_.edit.tsx` にする。末尾のアンダースコアは TanStack の「このセグメントで入れ子にしない」記法で、生成結果は `getParentRoute: () => rootRouteImport` / `path: '/notes/$noteId/edit'` になる。URL は steps.md が定めたものと同一で、変わったのはファイル名だけである。

`$noteId.tsx` に `<Outlet />` を足して親にする案は採らない。P-11 と P-12 は共有するシェルを持たない（編集画面の上部バーはモード切替と保存状態を載せる別物）ので、親子にすると詳細の DOM が編集画面の上に必ず残る。

### Consequences

- 良い点: 個人・ワークスペースの 2 本とも同じ規則で置ける。`router.navigate({ to: "/notes/$noteId/edit" })` の型も URL も steps.md のとおり
- トレードオフ: ファイル名が steps.md の字面と 1 文字違う。理由をここに残す

---

## ADR-033: 新規作成の初回保存は「作成 → 読み直し → 本文更新」を 1 つのサーバー関数に束ねる

### Context

PAGE-p12-002 は「初回 autosave で private blank note を作り、返った note ID の edit URL へ置換する」と定める。素直に組むと画面が `createBlankNote` → `updateNoteBody` の 2 本を続けて呼ぶことになるが、`createBlankNote` の出力 DTO（`CreatedNoteView`）に `version` が無いため、2 本目に渡す `expectedVersion` を画面が持てない。ADR-031 で `getNote` が版を返すようになっても、画面から呼ぶには往復がもう 1 つ増える。

### Decision

`createNoteWithBodyFn` 1 本に束ねる。ハンドラーの中で `createBlankNote` → `getNote`（版のためだけ）→ `updateNoteBody` を順に呼び、`{ noteId, workspaceId, version, removed }` を返す。本文が空のときは `updateNoteBody` を呼ばない。

これは**ユースケースの合成ではなく呼び出しの連鎖**で、各ユースケースが自分の UoW を開いて独立に確定する（`spec/usecases/identity.md`「UoW の合成と、ユースケースどうしの呼び出し」）。転送境界の検証は 1 つのスキーマ（`createNoteWithBodySchema`）で足りる。

読み直しと本文更新のあいだに他者が割り込む窓は理屈のうえでは残るが、作成直後の非公開ノートの存在を知る者は作成者しかいない。

### Consequences

- 良い点: 新規作成が 1 往復で確定し、画面はその応答の版から続けられる。空のまま離れた場合も白紙のノートが 1 件残るだけで、版も Revision も消費しない
- トレードオフ: presentation が 3 つのユースケースを順に呼ぶ。部分的な失敗（作成は成功、本文が失敗）ではノートが白紙で残り、画面は「保存できませんでした」を出したまま `noteId` を持たない。次の自動保存がもう 1 件作る余地がある
- 検証: `spec/manual-tests/editing.md` の新規作成の手順で、URL が `/notes/:noteId/edit` に置き換わることを確認する

---

## ADR-034: ビジュアルモードはテキストノードごとに編集ホストを分ける

### Context

ED-02 は「テキスト部分だけが編集可能」「要素の追加・削除・並べ替えはできない」を要求する。本文全体を 1 つの `contenteditable` にして操作を後から検査する形にすると、禁止された操作を**起きたあとで**拒む UI になり、ADR 013 の迂回（`<style>` の書き換え）も検査の網羅性に依存する。

### Decision

本文を DOM に展開し、`HtmlProcessor` と同じ規約（body ルートからのドット区切り 0 始まり子インデックス、`<style>` / `<script>` は不透明）で経路を数えたうえで、**各テキストノードを `contenteditable="plaintext-only"` の `span` に置き換える**。編集ホストが分かれるので、要素の追加・削除・並べ替えは操作として存在しない。`<style>` の中身は経路を持たないので `span` にもならず、編集面に現れない。

経路は **`span` を差し込む前の DOM** で数える。差し込んだあとで数えると `childNodes` のインデックスがサーバー側の木とずれ、編集が全件 `pathNotFound` に落ちる。

面は Shadow DOM に載せる（`NoteBody` と同じ隔離）。本文の装飾が編集中も効き、本文の CSS がアプリ側へ漏れない。

### Consequences

- 良い点: 「試みた場合はその旨を示す」を実装せずに済む。禁止された操作が発生しない
- 良い点: 空白だけのテキストノードを編集面から外しても経路は動かない（インデックスは元の `childNodes` で数えるため）
- トレードオフ: `contenteditable="plaintext-only"` に依存する。対応していないブラウザーでは `span` の中に要素を貼り付けられるが、送るのは `textContent` なので保存される内容は変わらない
- トレードオフ: テキストノードをまたぐ選択・置換ができない。ビジュアルモードは「その場の文字を直す」ための面であり、書き換えは HTML / WYSIWYG が担う

---

## ADR-035: ゴミ箱の一覧は `listTrashedNotes` を足して読む

### Context

P-14 は 3 つのものを要求する — 削除日時の新しい順の行、行ごとの残り日数、そして復元・完全削除に渡す `expectedVersion` である。読み取り側を全部当たったが、この 3 つを揃えて返せる経路が 1 つも無かった。

- `listNotes` は `listByOwner(owner, "active", …)` で lifecycle を固定していて、ゴミ箱の行は 1 件も返さない
- `NoteListItemView` に `version` も `trashedAt` も `purgeAfter` も無い
- spec の正典は `searchNotes` の `lifecycle: "trashed"`（`spec/usecases/note.md#searchNotes`）だが、`searchNotes` 自体が検索スライス（#8）の持ち分で存在しない。`listNotes` はその「歩く骨格」の代役として置かれたもので、JSDoc も「`searchNotes` と同じ owner 対を取るので呼び出し元はそのまま移れる」と述べている

選択肢は 4 つあった。

1. `listNotes` に `lifecycle` 引数を足し、`NoteListItemView` に `version` / `trashedAt` / `purgeAfter` を nullable で足す
2. ゴミ箱専用の読み取り `listTrashedNotes` を足す
3. 画面が `noteId` ごとに `getNote` を引いて版を得る
4. P-14 を実装せず不足として報告する

### Decision

2 を採る。`packages/core/src/application/note/listTrashedNotes.ts` を新設し、`TrashedNoteListItemView`（`noteId` / `title` / `version` / `trashedAt` / `purgeAfter`）を返す。既存ファイルへの変更は `view.ts` への型と射影の追加だけで、`listNotes` の振る舞いは動かさない。

1 は却下。権限が違う（ゴミ箱は `viewNote` ではなく `viewTrash`。最小ロールが editor なので viewer は一覧そのものに触れない）ので、引数で意味の変わる門を 1 つのユースケースに持たせることになる。加えて、active な行すべてに「必ず `null` の保持期限」を背負わせる。2 つの illegal state を型の上で表現可能にしてまで 1 本にまとめる理由が無い。

3 は N+1 になるうえ、`getNote` は `purgeAfter` を返さないので残り日数が出せない。4 は AC-10 と PAGE-p14-001〜004 が丸ごと落ちる。

並び順は `listByOwner` の `updatedAt DESC, id DESC` をそのまま使う。ゴミ箱に入っている間はノートを更新できる経路が無いので、trashed な行の `updatedAt` は削除の瞬間そのもので、P-14 が言う「削除日時の新しい順」と一致する。

### Consequences

- 良い点: 検索スライスが `searchNotes(lifecycle: "trashed")` を実装したら、この 1 ファイルを消して呼び出し元を差し替えるだけで済む。`listNotes` と同じ形の代役が 2 つ並ぶだけで、既存の経路には触れていない
- 良い点: `viewTrash` の門が初めて実際に踏まれる経路を持つ。TC-32（viewer のゴミ箱）が実行できる
- トレードオフ: **`spec/usecases/note.md` に対応する節が無い実装が 1 本増えた**（`listNotes` と同じ立場）。spec 側の追記は本スライスの担当範囲外なので実施していない
- トレードオフ: バックエンドは完成済みという前提のもとでフロントエンド側の作業として `packages/core` に触れた（ADR-031 と同じ扱い）。追加は純粋に加算的だが、レビューの対象にすべき変更である

---

## ADR-036: P-11 の版を握る島を 1 つにし、本文の描画もその中へ移す

### Context

P-11 に本スライスが足す操作は 3 つあり、どれも `expectedVersion` を取って成功のたびに版を 1 つ進める — タイトルの自動保存（PAGE-p11-002）、表示スタイルの切替（PAGE-p11-008）、ゴミ箱への移動（PAGE-p11-013）である。素直に組むと、タイトルは見出しの位置に、残り 2 つはメニュー（`menu.tsx`）の中に、それぞれ別の島として置くことになる。

そうすると版の持ち主が 2 つになる。タイトルを 1 度保存した直後にメニューから表示スタイルを切り替えると、メニュー側は開いたときの版を送り、必ず `OPTIMISTIC_LOCK_FAILURE` になる。逆順でも同じである。競合の表示は正しく出るが、競合していない操作が競合として見える。

もう 1 つ、ED-11 は「切り替えると、**その場で**表示が変わる」を要求する。本文を描くのは `NoteBody` で、`styleMode` はその prop である。サーバーコンポーネントが `NoteBody` を描いて島が横に居ると、切替は往復が終わって断片が作り直されるまで見えない。

### Decision

`NoteDetail/detail.tsx` に `NoteDetailIsland` を置き、**公開バッジからメニュー・タイトル・本文までを 1 つのクライアント島にする**。版は島の `useRef` が 1 つだけ持つ。`menu.tsx` は開閉と確認の状態だけを持つ表示部品になり、表示スタイルと削除は島から渡されたハンドラーを呼ぶ。

サーバーコンポーネント（`index.tsx`）に残るのは `getNote`・「見つかりません」・URL 正規化・日時の整形（`Intl` をサーバー側に閉じてハイドレーションのずれを避ける）だけになる。

移動（`moveNote`）だけは例外で `menu.tsx` が自分で実行し続ける。`moveNote` は版を取らず（`moveNoteFn` の JSDoc）、この画面では行の増減にもならないので、島へ引き上げる理由が無い。

`NoteBody` は元から `"use client"` なので、島の中から描いても構造は変わらない。

### Consequences

- 良い点: 3 つの操作が同じ版を見る。競合の表示は「他の利用者が更新した」ときだけ出る
- 良い点: 表示スタイルが `useOptimistic` で往復を待たずに切り替わる（ED-11 手順 3）
- トレードオフ: 詳細画面のほぼ全体がクライアント島になった。本文の HTML は元から `NoteBody`（クライアント）が受け取っていたので RSC ペイロードの中身は変わらないが、タグ・共有パネル・ダウンロードを足す後続スライスは「島に足すか、島の外に置くか」を毎回決めることになる。判断の基準は版を触るかどうかで、触るものは島の中に置く

---

## ADR-037: 詳細からの削除は一覧へ送らず、その場に「元に戻す」を出す

### Context

ED-09 は 3 つを順に要求する — メニューから削除を選び、確認して実行するとゴミ箱に移って一覧から消え、**削除直後は画面上の「元に戻す」で取り消せる**。台帳の PAGE-p11-013 はこれに「一覧へ戻る」を添えている。

この 2 つは素直には両立しない。削除した直後に `/notes` へ遷移すると、「元に戻す」を出せる場所は一覧を握る島（`NoteListBoard`）になるが、その島は別ルートの別マウントで、いま消したのが何だったかを知らない。ルートを跨いで運ぶには検索パラメータか大域 state が要り、どちらもこの画面 1 つのために持ち込む仕掛けとしては重い。

さらに「元に戻す」には版が要る。`restoreNote` は `expectedVersion` を取るのに、`trashNote` の応答（`TrashedNoteView`）は保持期限しか返さない。削除の過程で変換ジョブの強制終端が本文を `failed` にすると版がもう 1 つ進むので（`trashNote` の `recoverCanceledConversion`）、元の版に 1 を足して当てることもできない。

### Decision

削除は詳細画面に留まり、島が「ゴミ箱に移しました」の通知を出す。通知は「元に戻す」と「ノート一覧へ」の 2 つを並べ、一覧へ戻るのは利用者の選択にする。

「元に戻す」に渡す版は、削除が成功した直後に `readNoteEditStateFn`（`getNote` の薄い包み）で取り直す。ゴミ箱に入ったノートは所有者・editor から読めるので、この読み取りは成立する。取れなかった場合は「元に戻す」を出さない — 版を持たない復元は楽観ロックがあるように見えて無いためで、そのときは一覧（と P-14）から戻してもらう。

削除の直後に `router.invalidate()` は呼ばない。断片が作り直されると、いま出した「元に戻す」ごと消える。ノート一覧のルートはどれも `shouldReload: ({ cause }) => cause !== "preload"` を持ち、訪問のたびに loader を再実行するので、戻った先が古いことはない。

### Consequences

- 良い点: ED-09 手順 3 が実際に動く。ルートを跨ぐ state も検索パラメータも増やさずに済む
- 良い点: 復元の版が推測でなく実測になる。ジョブの強制終端が絡んでも外れない
- トレードオフ: PAGE-p11-013 の「一覧へ戻る」が自動ではなくリンクになった。削除したノートが画面に残って見えるが、ゴミ箱のノートは所有者にはまだ読めるものなので嘘ではない
- トレードオフ: 削除が 2 往復（`trashNote` → `getNote`）になった。2 本目は失敗しても削除の成否には影響しない

---

## ADR-038: スコープトークンの `canWrite` は省略可にし、省略は「出さない」と読む

### Context

ED-10 手順 1 は「スコープトークンのメニューから、現在の文脈の『ゴミ箱』を開く」と定め、`spec/pages/index.md` L-01 は「使えない行き先は並べずに消す」を課している。ワークスペースのゴミ箱は `viewTrash`（最小ロール editor）を要するので、viewer には行き先ごと出せない。

`ShellScope`（`components/layout/ScopeToken/listing.ts`）はロールを持っていない。スコープトークンを描くルートは 3 つあり、うち `/workspaces/:workspaceId/notes` と新設の `/workspaces/:workspaceId/notes/trash` は `getWorkspaceSettings` を読むのでロールを持てるが、ワークスペース設定のレイアウト（`settings/route.tsx`）は別の loader で開いていて、そこまで手を伸ばすと本スライスの担当範囲を越える。

### Decision

`ShellScope` のワークスペース側に `canWrite?: boolean` を**省略可**で足し、`canWrite === true` のときだけゴミ箱を並べる。**省略は「出さない」と読む。**

必須にすると、ロールを読まないルートが嘘の `true` を書くか、`false` を書いて同じ結果になるかのどちらかになる。省略可なら「知らない」を型で表せて、知らない画面は行き先を出さない — 権限のない行き先を並べて失敗させるより、開ける画面から開いてもらうほうがよい。

個人文脈のゴミ箱（`/notes/trash`）は権限の分岐が無いので常に並べる。

### Consequences

- 良い点: viewer のトークンにゴミ箱が出ない（TC-32）。判定はサーバー側の `WorkspaceRole.atLeast(role, "editor")` 1 か所から来る
- トレードオフ: **ワークスペース設定の 4 タブからはゴミ箱へ移れない。** ロールを渡すには `settings/-action.tsx` と `settings/route.tsx` を触ることになり、本スライスの担当範囲外なので見送った。ノート一覧とゴミ箱自身のトークンからは移れるので、行き先が完全に失われるわけではない

---

## ADR-039: spec へ書き戻すのは「本スライスが決めたこと」だけにし、他スライスの未実装は spec から消さない

### Context

仕上げで spec と実装を突き合わせたところ、乖離が 2 種類に分かれた。

- **実装が spec より先に決めたこと** — `getNote` の `version`、`listTrashedNotes`、`NoteAccessPolicy.ensureCanDelete`、`ensureAcceptable` が判定する 7 形式、`purgeNote` の `retention` admission と手順 6 の駆動主体、`StorageUrlPolicy` の `deliveryBaseUrl` の出どころ
- **spec が実装より先に書いていること** — `purgeNote` 手順 5 の 5 購読者のうち `projectNoteChanges` / `applyStorageDelta`、`UploadValidationPolicy` の `source` / `reference` / `artifact` の行、recovery driver

後者を「実装に合わせて」spec から削ると、他スライスが実装すべき対象そのものが消える。

### Decision

**前者だけを spec に書き戻し、後者は 1 行も触らない。** spec は設計の正典であって進捗表ではないので、まだ実装されていない設計は正典に残る。逆に、実装が spec より先に決めてしまったことは、決めた側が spec に戻すまで正典が嘘をつく。

書き戻したのは次の 7 か所。

| spec | 変更 |
| --- | --- |
| `usecases/note.md#getNote` | 出力 DTO に `version` を足し、OCC トークンである理由を添えた |
| `usecases/note.md` | `listNotes` / `listTrashedNotes` の節を新設（ADR-040） |
| `usecases/note.md#renameNote` / `#changeNoteStyleMode` / `#restoreNoteRevision` | エラー表に `NoteIsTrashed` を追加。`changeNoteStyleMode` には版の競合も（`expectedVersion` を取るのに行が無かった） |
| `usecases/note.md#purgeNote` | 入力 DTO に `retention` を足し（ADR-027）、手順 6 の駆動主体を「global consumer」からユースケース自身に直した（ADR-017） |
| `usecases/storage.md#storeMedia` | SVG の名前空間の付け直しと、transaction 失敗時のオブジェクト削除を手順に追加 |
| `domains/note.md` | `NoteAccessPolicy` の表に `ensureCanDelete` を追加 |
| `domains/storage.md` | `ensureAcceptable` の判定表を 7 形式に更新。`StorageUrlPolicy` に `create` を足し、`deliveryBaseUrl` の出どころを `AppConfig` から `ObjectStorage.publicUrl`（[ADR 049](../../spec/adr/049-object-storage-public-url.md)）へ直した |

最後の 1 つは `spec/presentation/index.md` の `AppConfig` 表からも「ストレージの配信元」の行を落とした。実装の `AppConfig` にその項目は無く、ADR 049 が「配信 URL の形はアダプターに閉じる」と決めているため、2 か所が同時に嘘をついていた。

### Consequences

- 良い点: spec を読んで実装を書く人が、本スライスが決めたことを `.thread/` を読まずに知れる
- 良い点: 未実装の設計が正典に残るので、後続スライスのチェックリストが痩せない
- トレードオフ: 「実装が spec より遅れている」ことは spec からは読めない。読むのは Issue のチェックリストであって spec ではない、という分担にした

---

## ADR-040: `listTrashedNotes` の節を足すなら `listNotes` の節も同時に足す

### Context

ADR-035 は「`spec/usecases/note.md` に対応する節が無い実装が 1 本増えた（`listNotes` と同じ立場）」をトレードオフとして残した。仕上げで `listTrashedNotes` の節を足すことになったが、`listNotes` にも節が無い状態は変わっていない。

### Decision

**両方足す。** 片方だけ書くと「`listNotes` は正典に無いから読み替えなくてよい」と誤読できる。2 つは `searchNotes` の同じ代役で、置き換わるときも一緒に置き換わる。節の冒頭で「`searchNotes` の代役であり、読み取りモデルが揃った時点でこの節ごと置き換わる」と明示し、`spec/inventory/usecase.md` に `UC-note-037` / `UC-note-038` を（[ADR 052](../../spec/adr/052-adapter-inventory-granularity.md) に従いドメイン群の末尾へ）追加した。

`listNotes` は既にマージ済みのスライスの持ち分だが、書くのは実装ではなく正典への記述なので、他スライスの実装には触れていない。

### Consequences

- 良い点: 検索スライスが `searchNotes` を実装するとき、消すべき節と台帳行が 2 組そろって見える
- トレードオフ: 一時的な代役が正典に載る。節の冒頭がそう書いているので、残り続けることはない

---

## ADR-041: ビジュアルモードではメディア挿入を出さない（実装を canon に合わせた唯一の変更）

### Context

`spec/scenario/editing.md` の ED-06 は「ビジュアルモードでは要素を追加できないため、この操作を提供しない」と定める。実装では下端の操作バーの `MediaButton` がモードによらず常に描かれていた。手順書 TC-15 手順 3 は canon に忠実で、実装のほうが違反していた。

手順書と実装の食い違いは他にもあるが（HTML モードのシンタックスハイライト、保存前の構文補正の警告、アップロード中の離脱確認、本文へのプレースホルダー挿入、先頭行からの自動命名）、いずれも新しい機能を作る規模で、仕上げの担当範囲を越える。

### Decision

**`MediaButton` をビジュアルモードで描かない**（1 行の分岐）だけを直し、残りは手順書を canon のまま残して報告する。手順書は「正しい実装を FAIL にしない」ために直すのであって、**違反している実装を PASS にするために直すものではない**。

### Consequences

- 良い点: TC-15 手順 3 が実機で通るようになった
- トレードオフ: 残る 5 件は手順書を実行すると FAIL する。FAIL が正しい状態なので、手順書には手を入れていない
