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
