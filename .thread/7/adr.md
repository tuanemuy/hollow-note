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
- **「直後」を張る条件は「満ページ**かつ**当該 turn が 1 件以上回収した」。** 満ページだけを条件にすると上記の spin になる。進捗が無いページは翌日へ回し、次の日にもう一度同じ判断をする（→ **ADR-059 で置き換え**。カーソルを足したので条件は「満ページ」だけになった）
- **削除は 1 件 1 transaction。** spec の「個々の失敗は記録して継続」を満たすには、1 件の失敗がページ全体を巻き戻してはならない。判定（列挙 + 本文の読み）は 1 つの transaction にまとめる
- **所属ノートが不在なら回収、本文が読めない（`processing` / `failed` など）なら残す。** 不在は終端だが、本文が無い状態は一時的で、「本文が無い」ことは「参照が外れた」証拠にならない

### Consequences

- 良い点: 実運用の駆動経路（最初の 1 件 → 翌日 → 残件があれば直後 → 翌日）が揃い、TC-storage-026 / 027 が実 backend の上で成立する
- トレードオフ: media を 1 件でも持った scope には task 行が 1 本常駐する。runner の tick は 1 日 1 回しか当たらない
- 既知の制限: カーソルが無いため、先頭 `limit` 件がすべて参照中のまま滞留すると、その後ろにある孤児へ到達できない（→ **ADR-059 で解消**）

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

---

## ADR-042: HTML モードのシンタックスハイライトは依存を増やさず自前で書く

### Context

ED-03 手順 2 と TC-05 手順 1 は「シンタックスハイライト付きのソースエディタ」を要求する。実装は素の `textarea` で、色分けが無かった。

`apps/web/package.json` と `packages/core/package.json` を当たったが、ハイライターも構文解析の部品も入っていない（依存は TanStack・React・Tailwind・zod だけ）。選択肢は 3 つあった。

1. 汎用ハイライター（highlight.js / Shiki / Prism）を足す
2. CodeMirror などのエディタ部品ごと差し替える
3. HTML 1 言語ぶんのトークナイザーを書き、背面の `pre` に色を付ける

### Decision

3 を採る。`NoteEditor/highlight.ts` に HTML のトークナイザー（テキスト / 記号 / タグ名 / 属性名 / 属性値 / コメント）を置き、面（`surfaces.tsx`）が背面の `pre` に `span` として描く。前面の `textarea` は文字を透明にして caret と選択だけを持つ。

1 は、必要なのが 1 言語ぶんの色分けなのに、言語定義一式とテーマ一式を持ち込むことになる。`spec/design/index.md` は `--code-keyword` / `--code-string` / `--code-comment` / `--code-function` / `--code-number` を既に定義しており（本スライスまで未使用だった）、配色の正典はこちらにある。ハイライターのテーマを当てると、正典が 2 つ並ぶ。2 は入力の実装ごと差し替わるので、自動保存・退避・モード切替が載っている現在の形を壊す。

トークナイザーは HTML パーサーではない。壊れた構文（閉じていないタグ、引用符の無い属性値）もそのまま色が付く — 補正は保存側の `HtmlProcessor` が行うのであって、書いている最中の面が構文を正すのではない。

長さの上限（60,000 文字）を超えたら色分けを止めて素のまま描く。トークン 1 つが `span` 1 つになるので、本文の上限（サニタイズ後 800 KB）に近いソースでは DOM が数十万ノードになり、打鍵のたびに固まる。色が無いことより、書けないことのほうが重い。

### Consequences

- 良い点: 依存が 1 つも増えず、配色は `--code-*` トークン 1 か所から来る
- 良い点: トークン列の連結が入力と一致する（不変条件）ので、背面の `pre` と前面の `textarea` の桁がずれない
- トレードオフ: 色分けの粒度は 6 種類だけで、`<script>` / `<style>` の中身は色が付かない
- トレードオフ: 60,000 文字を超えるソースは色が付かない。上限に当たったことは画面上では何も告げない

---

## ADR-043: 離脱の確認はルーターの blocker に一本化する

### Context

確認が要る離脱は 3 通りある — 画面内のリンク（TC-22 手順 1）、ブラウザーの戻る（TC-22 手順 3）、タブを閉じる。加えて ED-06 は「アップロード中に編集画面を離れようとした場合、中断される旨を確認する」（TC-27）を別の理由として要求する。

実装は 2 つに分かれていた。`beforeunload` の listener（タブを閉じる／再読み込みだけ）と、`BackLink` の `onClick` での `window.confirm`（そのリンクだけ）である。SPA の遷移は前者を通らず、戻るボタンは後者を通らない。したがって TC-22 手順 3 は素通りしていた。アップロード中はどちらの経路にも条件が無かった。

### Decision

`useBlocker`（`@tanstack/react-router`）1 つにまとめる。`shouldBlockFn` が `window.confirm` を出し、取りやめられたときだけ遷移を止める。`enableBeforeUnload` に同じ条件を渡すのでタブを閉じる経路も同じ判定に載る。`BackLink` の `onNavigate` は用が無くなったので prop ごと外した。

確認の文言は理由で分ける — アップロード中なら「中断されます」、未保存なら「失われます」。アップロード中を先に見るのは、そちらのほうが取り返しがつかないためである（未保存の本文は端末に退避されるが、中断したアップロードは何も残さない）。

`shouldBlockFn` / `enableBeforeUnload` は `useCallback` で固定し、条件は ref 経由で読む。blocker は関数の同一性で購読を張り直すので、毎描画で作り直す関数を渡すと打鍵のたびに登録が動く。

### Consequences

- 良い点: TC-22 の 3 手順と TC-27 が同じ 1 つの判定から出る。経路ごとに条件が食い違うことがない
- 良い点: 確認を出す場所が増えない。リンクを 1 本足しても勝手に守られる
- トレードオフ: `window.confirm` に依存する。画面内のダイアログにするには blocker の `withResolver` へ移す必要があり、その分だけ状態が増える

---

## ADR-044: メディアの仮の要素は本文へ差し込み、成否で差し替えるか取り除く

### Context

ED-06 は「アップロードに失敗した場合、挿入されたプレースホルダーを取り除き、再試行できるようにする」と定め、TC-26 は手順 1 で「プレースホルダーが挿入され」ることを期待する。実装は本文に何も挿入せず、成功したときだけ `img` / `video` を入れていた。失敗は本文の外の一覧に 1 行出るだけで、再試行の導線も無かった（同じファイルを選び直すしかない）。

### Decision

挿入を始めた時点で `<span data-hollow-upload="{id}">…</span>` を本文へ差し込み、成功したら保管した要素で置き換え、失敗したら取り除く。`id` は属性セレクターと正規表現の両方に載るので、ファイル名を混ぜず `[a-z0-9-]` だけで組む。

置き換えは面によって経路が違う。WYSIWYG の本文は DOM が正本なので `querySelector` で引いて `outerHTML` を差し替え、HTML モードは文字列なので正規表現で置換する。どちらの場合も本文の state を揃えてから `dirty` に戻す。

失敗した項目は `File` を持ち続け、「再試行」がそのファイルをもう一度送る。選び直させると、TC-26 手順 4（通信を回復して再試行する）が「同じファイルをもう一度選ぶ」という別の操作になる。

### Consequences

- 良い点: 挿入位置が最初から見え、完了しても位置が動かない
- 良い点: 失敗の後始末が本文の中で完結する。利用者が仮の要素を手で消す必要がない
- トレードオフ: 仮の要素は保存されうる。自動保存はアップロード中は待つようにしたが、明示保存を押せば `data-hollow-upload` が落ちた素の `span` が本文に残る
- トレードオフ: 自動保存がアップロードの間だけ止まる。表示は「未保存」のままになる
- トレードオフ: HTML モードでの置換は正規表現なので、利用者が仮の要素の中身を書き換えると当たらなくなる

---

## ADR-045: 一覧からの削除のために `NoteListItemView` に `version` を足す

### Context

ED-09 手順 1 は「ノート詳細**または一覧**のメニューから『削除』を選ぶ」と定め、P-10 は行ごとのメニューを機能に挙げている。実装は一覧のメニューに「移動」しか無かった。ステップ 11 の担当者は「`NoteListItemView` に `version` が無く、追加すると core の変更がもう 1 つ増える」ことを理由に見送っている。

`trashNote` は `expectedVersion` を要求する。CLAUDE.md「Frontend」の所有権の規則により削除を実行するのは一覧を握る島であり（楽観的な除去がリーフを先に unmount する）、その島は行から版を受け取るしかない。サーバー関数の中で引き直すと、自分で読んだ値と突き合わせるだけの恒真な検査になり、楽観ロックが**あるように見えて無い**状態になる（`moveNoteFn` の JSDoc と同じ論点）。

### Decision

`NoteListItemView` に `version: number` を足す（ADR-031 / ADR-035 と同じ純粋な加算）。`spec/usecases/note.md#listNotes` の出力 DTO にも書き戻し、OCC トークンである理由を添えた。

削除の可否は既存の `NoteListOwner.canWrite` をそのまま使う。`WorkspaceAuthorization` の最小ロールは `deleteNote` も `moveNote` も editor なので、可否が分かれる余地が無い。

削除直後の「元に戻す」は詳細画面と同じ形にする（ADR-037）。版は `readNoteEditStateFn` で取り直す — `trashNote` の応答は保持期限しか返さず、ジョブの強制終端で版がもう 1 つ進むことがあるので差分を数えて当てにはできない。詳細と違って `router.invalidate()` は呼ぶ。楽観的な除去は transition が終わると戻るので、行を実際に消すのは読み直しであり、通知は島の state なので断片が作り直されても消えない。

### Consequences

- 良い点: ED-09 手順 1 の「一覧のメニューから」が実際に動く。TC-12 に手順 6・7 を足して手順書からも辿れるようにした
- 良い点: 一覧が版を持つので、後続スライスの一括操作（OR-09）も同じ値を使える
- トレードオフ: バックエンドは完成済みという前提のもとでフロントエンド側の作業として `packages/core` に触れた（ADR-031 / ADR-035 と同じ扱い）

---

## ADR-046: `storeMedia` の `routeVersion` は spec 側を直す

### Context

`spec/usecases/storage.md#storeMedia` の手順 1 は「その1つのscope objectでノート・routeVersion・`canEdit`を確認する」と書いているが、実装は `scopeRouter.resolveNote` が返す `routeVersion` を読み捨てている。

読み直した結果は次のとおりである。

- `routeVersion` を実際に消費するのは route の**状態遷移**だけである（`beginMove` / `abortMove` の `expectedRouteVersion`、`beginPurge`）。`NoteRouteStore` の JSDoc も CAS を `beginMove` / `beginPurge` に結び付けている
- 編集系ユースケースは全部 `editing.ts` の `resolveNoteFor` を通り、`EditableNote.routeVersion` を受け取るが、`purgeNote` 以外は 1 つも使っていない。`updateNoteBody` / `renameNote` / `applyTextNodeEdits` / `changeNoteStyleMode` / `trashNote` / `restoreNote` はどれもノート自身の `version` で楽観ロックする
- 「共通: 閲覧者コンテキストの解決」（`spec/usecases/note.md`）は `routeVersion` の確認を手順に含めていない。含めているのは「scope miss / stale route version なら primary から1回だけ引き直す」だけで、`storeMedia` の実装はこれを満たしている

つまり `storeMedia` が書くのは scope 内の `StoredFile` 1 行であって route の状態遷移ではなく、`routeVersion` を固定する相手（CAS を取る呼び出し）が存在しない。

### Decision

**spec を直す。** 手順 1 を「共通: 閲覧者コンテキストの解決と同じ手順」に読み替え、**route の CAS は取らない**ことと、その理由（書き先が route ではない）を明記した。解決から保存までの間に移動が起きた場合の帰結（旧 scope に残った行は `collectOrphanMedia` の回収対象になる）も添えた。

実装側に CAS を足す案は採らない。`NoteRouteStore` に「読み取りだけの CAS」は無く、足すとすべての編集系ユースケースが同じものを要求することになる（`storeMedia` だけ強い保証を持つ理由が無い）。窓の実体は編集系ユースケース共通のもので、`storeMedia` に固有の欠陥ではない。

### Consequences

- 良い点: spec が「取っていない CAS」を約束しなくなる。読んだ人が実装の欠落と誤解しない
- 良い点: 移動と保存が交差したときの帰結が正典に書かれた（回収に任せる、という既存の設計と同じ結論）
- トレードオフ: 移動の窓は残る。塞ぐなら編集系ユースケース全体の設計判断になるので、本スライスでは扱わない

---

## ADR-047: ED-01 の「先頭行からの自動タイトル」は本スライスの持ち分ではない

### Context

`spec/scenario/editing.md#ED-01` の異常系は「タイトルが未入力のまま保存した場合、本文の先頭行から自動で仮のタイトルを付ける。本文も空なら『無題』とする」と定める。実装にこの導出は無い。plan.md はスコープから ED-01 を外しているが、「導出が `updateNoteBody` の振る舞いなら本スライスの持ち分」という留保が残っていた。

判定のために当たったのは 3 か所である。

- `spec/usecases/note.md#createBlankNote` 手順 2 — 「`title` が空なら `NoteTitle.auto("無題")`」。本文を受け取らないので先頭行を知りようがない
- `spec/usecases/note.md#updateNoteBody` 手順 1〜8 — タイトルに触れる手順が 1 つも無い。出力 DTO にも `title` が無い
- `domain/note/note.ts` の `Note.updateBody` — `content` と `version` と `updatedAt` しか動かさない。`NoteTitle` の `auto` / `manual` の区別は「後の変換結果で上書きしてよいか」を表すものであって、本文からの導出を指すものではない

つまり導出を担うユースケースは正典のどこにも無く、`updateNoteBody` の振る舞いでもない。ED-01 の異常系の受け皿は `createBlankNote`（依存 Issue #1）側にある。

### Decision

**実装しない。** 手順書（`spec/manual-tests/editing.md` の TC-02）も直さない — canon が要求していて実装が無い状態が正しく FAIL するのは、手順書が仕事をしている姿である。

### Consequences

- 良い点: 他スライスの持ち分を先取りしない。`createBlankNote` に本文を渡す形にするのか、`updateNoteBody` に手順を足すのかは、実装する側が決めるべき設計判断として残る
- トレードオフ: TC-02 は引き続き FAIL する

---

## ADR-048: `beginPurge` の「操作単位の冪等は CAS より先」をポート契約へ昇格する

### Context

`purgeNote` の forward recovery（`resumeInternal`）は、どの route も持ちえない世代 `-1`（`RESUME_CLAIM`）で `beginPurge` を呼び、自分の `purging` 行を読み戻して停止した purge を再開する。`resolve` が `purging` を隠す以上、これが scope と世代を知る唯一の経路である。

ところが依存している「同一 `operationId` の `purging` 行は世代 CAS より**先**に返る」という順序は、ポートの JSDoc にも conformance にも無かった。memory / D1 の両実装がたまたま同じ順序で書かれているだけで、`checkVersion` を先に置いた 3 つ目のバックエンドはコンフォーマンス緑のまま、停止した purge を全て復旧不能（route は `purging` のまま = ノートは永久に到達不能）にできた。

### Decision

**契約側に書く。** `NoteRouteStore.beginPurge` の JSDoc に「同一 operation の `purging` 行は `expectedRouteVersion` を見ずに冪等に返す」「recovery がこれに依存して番兵世代で再 claim する」「他人の operation は state か CAS で拒まれるので番兵は route を奪えない」を明記し、`describeNoteRouteStoreContract` に ADP-note-043 の 2 ケースを足した（自分の claim は番兵世代でも同一の route を返す / まだ `purging` でない active route は番兵世代を CAS で拒む）。ADR 026 の 3 点セット（ポート JSDoc・memory・cloudflare が同じスイートを通る）を満たす。

台帳 ID は `ADP-note-043`（`beginPurge`）を流用し、新しい ID は起こさない。冪等順序は `beginPurge` の一節であって別のポートメソッドではない。

### Consequences

- 良い点: 順序の破れが「アダプターを差し替えたときに初めて分かる」から「conformance が落ちる」に変わる。両バックエンドで変異（`checkVersion` を先頭へ移動）が red になることを確認済み
- 良い点: `RESUME_CLAIM` の番兵が実装の小細工ではなく契約の一部として読める
- トレードオフ: `spec/domains/note.md` の `NoteRouteStore` 節と `spec/inventory/adapter.md:ADP-note-043` の説明文に同じ一節を足す作業が残る（spec の更新は別ユニット）

---

## ADR-049: `emptyTrash` の同期削除が飛ばす失敗は spec のエラー表どおりに限る

### Context

`purgeEachNote` は `purgeNote` の例外を全部握り潰して次のノートへ進んでいた。`spec/usecases/note.md#emptyTrash` が飛ばしてよいと定めるのは「版が競合（`ConflictError`）」「既に削除済み（`NOTE_NOT_TRASHED` / 不在）」の 2 つだけで、実装は `SystemError(DatabaseError)` も同じ扱いにしていた。scope が丸ごと落ちていても `{ mode: "purged", purgedCount: 0 }` が返り、画面は「0 件を完全に削除しました」と表示する。要求経路なので CLAUDE.md の「broad try / catch は worker の per-row tolerance だけ」にも当たる。

出力 DTO に失敗件数を足す案は採らなかった。`spec/usecases/note.md#emptyTrash` の出力 DTO は `mode` / `purgedCount` / `jobIds` の 3 つで、飛ばした件数は「数えた総数と `purgedCount` の差」として既に呼び出し側に見えている。飛ばせない失敗は件数ではなく**失敗そのもの**として報告されるべきで、DTO を増やすと spec の改訂が要る。

### Decision

`isConflictError` / `isNotFoundError` / `ValidationError("NOTE_NOT_TRASHED")` **だけ**を飛ばし、それ以外は再送出する。途中で投げると既に確定した purge は戻らないが、これは spec が「ゴミ箱を空にする操作は部分的に進んでも矛盾しない」と明記している性質そのものである。

### Consequences

- 良い点: 全滅が成功として返らない。到達不能な scope は要求ごと失敗し、画面は誤った完了通知を出さない
- 良い点: DTO も spec も変えずに済む
- トレードオフ: `spec/testcases/note/emptyTrash.md` / `spec/inventory/test.md` の TC-note-111（「一部の削除が失敗する → 他の削除は継続し、失敗件数が分かる」）は、飛ばせる失敗の行として読み直す必要があり、飛ばせない失敗の行が 1 つ足りない（spec の更新は別ユニット）

---

## ADR-050: ジョブ経路の列挙は `countByOwner` の結果で束縛する

### Context

`scheduleBulkPurge` の列挙は `for (let page = 1; ; page += 1)` で、終了条件が「満ページでなくなる」だけだった。直前に `countByOwner` で総数を知っているのに、1 要求の中の逐次読みに上限が無い。`listByOwner` のページングが壊れた場合は要求が返らない。`spec/platform/index.md`「実行予算と分割単位」は 1 実行の逐次量を上限で縛る設計であり、`EMPTY_TRASH_SYNCHRONOUS_LIMIT` の JSDoc（応答時間を束縛する）とも噛み合っていなかった。

### Decision

`total` を `scheduleBulkPurge` へ渡し、`Math.ceil(total / ENUMERATION_PAGE_SIZE)` ページまでで打ち切る（満たないページで早く抜けるのは従来どおり）。列挙の途中で新たにゴミ箱へ入ったノートは次の要求の持ち分とし、追いかけない。

ページ数に絶対上限を置いて超過を `SystemError` にする案は採らなかった。上限を超えたゴミ箱が「空にできない」状態になり、分割・再開の設計（spec 側の判断）が要る。本スライスの指摘は「上限が無い」ことであって「総数に比例する」ことではない。

### Consequences

- 良い点: 逐次読みが、要求が既に支払って知っている数で束縛される。ページングのバグは「返らない要求」ではなく「足りない列挙」になる
- 良い点: `purgedCount`（登録した件数）は実際に列挙できた件数のままで、嘘をつかない
- トレードオフ: 巨大なゴミ箱の応答時間は依然として件数に比例する。定数上限と再開はジョブ集約のスライスの持ち分

---

## ADR-051: 保存後の正本は面を差し替える瞬間にサーバーから引き直す

### Context

編集画面は「確定済みの本文」を 1 つしか持っていなかった。モードを切り替えると `applyMode` がその値で面を再シードするが、その値は**サーバーが持っている本文ではない**。

1. ビジュアルモードの保存（`applyTextNodeEdits`）は経路単位の書き換えなので、結果の HTML が画面の手元に無い。保存後に HTML / WYSIWYG へ切り替えると編集前の本文が面に載り、そこから保存すれば書き換えが消える
2. `UpdatedNoteBodyView` は除去の一覧を返すがサニタイズ後の本文を返さない。「除去しました」と告げた直後の面には除去対象が残り、次の保存でまた送られる
3. 「保存して切り替える」は `await commit(true)` のあとにクリック時の閉包から `applyMode` を呼ぶので、そこで読む state は保存前の値である。切り替えた瞬間に本文が巻き戻り、直後の自動保存がその巻き戻りをサーバーへ書き戻す

保存の応答に本文を足す案（`UpdatedNoteBodyView` / `AppliedTextNodeEditsView` に `html` を追加）もあるが、`packages/core` の DTO を 2 つ広げ、自動保存のたびに本文をもう 1 往復ぶん運ぶ。

### Decision

正本の取得を**面を差し替える瞬間**に寄せる。`applyMode` は `readNoteEditStateFn` で `title` / `html` / `version` を引き直し、その値で `mode` と本文・`baseline` を同時に載せる。引き直しに失敗したらモードを切り替えず、エラーの状態だけを出す。

`dirty` の基準は引き続き**送った内容**にする（`rememberSaved` が唯一の書き込み口）。サニタイズ後の本文を基準にすると入力欄との差が消えず、自動保存が同じ本文を延々と送り直す。

閉包から読む値を断つため、確定済みの値は `savedRef` にも持つ。`applyMode` が非同期 transition の中から呼ばれる以上、state 側は必ず 1 世代古い。ノートがまだ無い（新規作成）ときだけ、この ref が再シードの出所になる。

`commit` は成否を返す。「保存して切り替える」は `true` のときだけ切り替える — 切り替えは面を保存済みの内容へ戻す操作なので、失敗したまま進むと書きかけがそこで消える。

### Consequences

- 良い点: 3 つの巻き戻りが 1 か所の変更で消える。ビジュアルモードの保存もサニタイズも、切り替えた面に反映される
- 良い点: 版も同時に引き直すので、切り替えを挟んだ次の保存が古い版で競合しない
- トレードオフ: モードの切り替えが 1 往復ぶん遅くなる。往復の最中はモードのラジオを押せなくする（後着が勝つと面と `mode` が食い違う）
- トレードオフ: サニタイズで除去された内容は、モードを切り替えるまで面に残ったままになる。除去の通知は出ているので誤解は生まないが、面と正本が一時的に食い違う

---

## ADR-052: HTML モードのプレビューは描く前にクライアント側でも落とす

### Context

プレビューは `NoteBody` に渡され、`shadowRoot.innerHTML = ...` で **live DOM** に入る。渡していたのは保存前の本文そのもので、`<img onerror=...>` のような属性はそこで実行される。コードのコメントは「実際の安全は保存時のサニタイズと CSP が担う」と書いていたが、`apps/web/app/server.node.ts` の CSP は `frame-ancestors` / `form-action` / `object-src` / `base-uri` だけで `script-src` を持たない。攻撃は自己 XSS に限られるものの、根拠が事実と食い違っていた。

### Decision

プレビュー用の HTML を作る時点で、`on*` 属性・`javascript:` の URL・`script` / `iframe` / `object` / `embed` / `link` / `meta` / `base` / `form` / `noscript` を落とす。`<template>` へのパースは構文補正の判定ですでに行っているので、同じ 1 回の解析で補正結果とプレビューの両方を作る。

サーバー側の `HtmlProcessor` を呼ばないのは、プレビューが打鍵のたびに更新される描画であり、サニタイズだけを行う読み取り経路が無いためである。落とす対象は `HtmlProcessor` が落とすものの**部分集合**にしてあるので、プレビューが「実際に保存される形」から外れる向きには動かない。

CSP に `script-src` を足すかどうかは配信側（`server.node.ts`）の判断で、ここでは前提にしない。

### Consequences

- 良い点: 保存前の本文を live DOM へ入れる経路が無くなる。防御が CSP の有無に依存しない
- 良い点: プレビューが保存後の姿へ 1 歩近づく（許可リスト外の要素はサーバーでも落ちる）
- トレードオフ: 走査が 1 回増える。打鍵から 500 ms の据え置きに載せてあるので描画のたびには走らない
- トレードオフ: プレビューはサニタイズの完全な再現ではない。CSS 宣言・URL スキームの細かい規則はサーバー側にしかなく、除去の一覧は保存後にしか出ない

## ADR-053: `media` を公開配信の鍵空間に入れ、配信・ポート契約・spec の 3 点を同時に動かす

### Context

`storeMedia` は `ObjectStorage.publicUrl(objectKey)` を返し、エディタはその URL を本文に挿す。ところが `/storage/$` は `purpose !== "avatar"` を 404 で弾いており、挿した画像・動画は必ず壊れていた（AC-6 / ED-06 が成立しない）。`collectOrphanMedia` の孤児判定も本文中の URL を `publicUrl` の戻り値と突き合わせるので、本文に載ることのない住所を正としていた。

配信しない側に倒す案（`createDownloadUrl` 相当の期限つき URL を返す）は取れない。公開ノートの本文は匿名の閲覧者にも配信され、本文に埋め込まれた URL は**長命でなければならない**（期限つき URL は `spec/domains/storage.md` が「長命な参照には流用できない」と明記している）。

### Decision

`media` を `avatar` と並ぶ公開配信の purpose とする。読める条件は「鍵を知っていること」で、鍵は推測できないファイル ID を含み、列挙する経路も無い（avatar と同じ担保）。

同じ決定が 3 か所に現れるので、3 つを同時に動かす規約にした。`apps/web/app/routes/storage.$.tsx` の `PUBLICLY_SERVED_PURPOSES`（適用点）、`application/ports/objectStorage.ts` の `publicUrl` の JSDoc（契約）、`spec/domains/storage.md`（正典）。`source` / `reference` / `artifact` は同じストアを共有するため、配信側が引き続き境界を自分で持つ。

### Consequences

- 良い点: 本文に挿した URL が実際に読め、`collectOrphanMedia` の突き合わせと配信が同じ 1 つの住所を見る
- 良い点: `apps/web/app/routes/__tests__/storage.delivery.test.ts` が「media は 200、source / reference / artifact は 404」を押さえる（ルートの GET ハンドラーを直接呼ぶ）
- トレードオフ: media は URL さえ知っていれば非公開ノートのものでも読める。ノート単位の権限を配信に持ち込むには鍵からメタデータ行を引く必要があり、公開ノートの匿名配信では引く先の scope も権限も無い。avatar と同じ「capability URL」の担保に揃えた
- SVG を同一オリジンから配るので、`X-Content-Type-Options: nosniff` と `Content-Security-Policy: sandbox; default-src 'none'` が media にも掛かることを配信側の担保として明記した

## ADR-054: `image/svg+xml` の上限は 128 KB — サニタイズ後に本文上限を割れる値にする

### Context

`storeMedia` は SVG だけを `HtmlProcessor.process` に通す。`process` の戻り値は**ノート本文の値オブジェクト**（`NoteHtml`、800,000 バイト上限）なので、上限表の 20 MB は到達できない値だった。1 MB 級の SVG を上げると `NOTE_CONTENT_TOO_LARGE` が返り、画面には「内容が上限を超えています。分割してからもう一度お試しください。」という**ノート本文向けの文言**が出る。Storage の入口が Note の不変条件で落ちるのは責務の漏れでもある（ADR 008）。

`HtmlProcessor` に単体文書用の入口（戻り値が `NoteHtml` でないもの）を足す案は、同じ PR で別の担当が触っているアダプターと衝突するため取らない。

### Decision

`image/svg+xml` の上限を 128 KB（131,072 バイト）とする。値の根拠は「どんな入力に対しても到達可能であること」: HTML の直列化で 1 バイトが増えるのは最大 6 倍（属性値中の `"` が `&quot;`）で、131,072 × 6 = 786,432 は 800,000 を超えない。したがって、この上限を通った SVG がサニタイズで本文上限に触れることはない。

あわせて `storeMedia` は**実際に保管するバイト列**を同じ上限へ測り直す。容量に効くのも行に載るのもサニタイズ後の長さなので、受理判定の対象と保管される実体を一致させる。

`spec/domains/storage.md` の上限表・`errorDisplay.ts` の文言・`.thread/7/testing.md` の TC-25 を同時に揃えた。

### Consequences

- 良い点: 上限が到達可能になり、超過は `STORAGE_FILE_TOO_LARGE`（「SVG は 128 KB まで」）で返る
- 良い点: サニタイズで増えたバイトが容量計算から漏れなくなる
- トレードオフ: 作図ツールが書き出す 1 MB 級の SVG は受け付けられない。上げるには `HtmlProcessor` に単体文書用の入口を足す（戻り値を `NoteHtml` にしない）必要があり、そのスライスの判断になる
- `spec/usecases/storage.md#storeMedia` の手順 5 は「保管するサイズは手順 4 のあとのバイト長」までしか言っていないので、測り直しの一文を足す改訂が要る（本ユニットは `spec/domains/storage.md` しか触らないため、そちらに記した）

## ADR-055: 孤児メディア掃引の起動は「初めての保管」ではなく「初めての流入」で行う

### Context

`armOrphanMediaSweepOnFirstMedia` は「この scope に media 行が 1 件も無い」を掃引 task 未登録の代用にしている。ノートを個人 → ワークスペースへ移すと `relocateFilesForNote` の `stageTarget` が target scope へ media 行だけを挿し、掃引は登録されない。以後その scope で `storeMedia` を呼んでも早期 return するため、**その scope の孤児 media は二度と回収されない**。

レビューの推奨は `ScopeTaskScheduler` に「無ければ積む」入口を足す案だったが、ポート契約の変更は JSDoc・conformance スイート・memory / cloudflare の 4 点セット（ADR 026）になり、本ユニットが触ってよい範囲の外にアダプターが含まれる。

### Decision

`stageTarget` が media を 1 件でも運ぶときに `armOrphanMediaSweepOnFirstMedia` を呼ぶ。呼ぶ位置は**行を挿す前**である — 「media がまだ無い」は行そのものから読んでおり、staged 行は source 側の `createdAt` を持ち込むので、挿した後では常に「もう有る」になる。

これで「scope に media が入る経路」＝「arm する経路」が 2 本とも揃い、既存の「2 回目以降は `dueAt` を押し出さない」性質もそのまま保たれる。

### Consequences

- 良い点: 移動で media が流入した scope も掃引される。ポート契約を変えずに済む
- トレードオフ: 述語は依然「media 行の有無」の代用で、掃引行そのものを見てはいない。`scheduled_tasks` を直接読む入口が要るなら、ポートを広げるスライスがそこで正す
- `spec/domains/storage.md` の該当段落（「`register` で `purpose: "media"` を初めて保存するとき…」）を「初めての流入」に改訂した

---

## ADR-056: `note.purged` の追随者は「完了済みの障壁も通す」形の所有権検査にする

### Context

3 つの追随者（`deleteFilesForNote` / `deleteAssignmentsForNote` / `deleteBackupRecordsForNote`）は `deletionOperationId` が非 null のとき毎ターン `ScopeCleanupAdmissionStore.assertOwner` を通していた。`assertOwner` の契約は「**完了済みの receipt は拒否**する」であり（`application/ports/scopeCleanupAdmissionStore.ts`）、その完了を起こすのは `deleteNotesForOwner` の最終ターン、すなわち `note` コンポーネント自身の ack である。

一方 `note.purged` は各 purge のトランザクションで outbox に入り、リレーが**その後**非同期に配送する。したがって「障壁の完了」と「fan-out の配送・継続」は必ず競合し、完了が先に立った瞬間から初回配送も継続 task も毎回 `ConflictError` で落ちる。outbox 行は `maxAttempts` で隔離、継続 task は `SCOPE_TASK_MAX_ATTEMPTS` で `failed` になり、tag 付与とバックアップ記録は恒久的に取り残される（ADR-021 のとおり両者は participant ではなく、scope 全体を掃く経路も無い）。

### Decision

**共有ヘルパー `assertNotePurgeAdmission`（`application/cleanup/notePurgeFanOut.ts`）を 3 購読者すべてに入れ、`assertOwner` を置き換える。** 判定は `describePersonalCleanup(deletionOperationId)` 1 本で、

- 自分の receipt がある（`running` / `completed` のどちらでも）→ 通す
- `null`（receipt 不在・abort 済み・別 operation が所有・prune 済み）→ `ConflictError("CLEANUP_OPERATION_MISMATCH")`

「検査自体を落とす」案（レビューの (b)）は採らなかった。`spec/usecases/{tag,integration,storage}.md` と `spec/testcases/` が「各 turn で deletion owner を再確認する」「cleanup owner receipt 一致時だけ削除する」と定めており、検査を消すと正典と実装が食い違う。本案は「一致するか」を毎ターン問い直す点でその記述を満たしたまま、**完了だけを通す**という最小の差にとどまる。

完了を通してよい理由は、追随者が何も ack しないことにある。`assertOwner` が完了で false に転じるのは「`pruneCompleted` を過ぎた配送が barrier を `running` へ巻き戻す」ことを防ぐためだが、追随者は purge 済みノートの行を消すだけで receipt に触れない。

### Consequences

- 良い点: 障壁完了後の初回配送・継続の両方が通るようになり、恒久的な取り残しが無くなった。3 購読者ぶんのテスト（`TC-tag-028` / `TC-integration-024` / `TC-storage-059` の各「barrier completed」ケース）が直接それを守る
- 良い点: 既存の拒否経路（別 operation の token、abort された障壁）は 1 件も緩んでいない。`TC-tag-027` / `TC-storage-060` / `TC-integration-024` はそのまま通る
- トレードオフ: receipt が prune される 120 日後にはまた拒否側に倒れる。その時点で生きている配送は `maxAttempts` をとうに超えているので実害は無い
- 既知の制限: 3 つのユースケースの JSDoc に「完了後も通る」ことを書き足したが、`spec/usecases/` 側の手順 1 は依然 `assertOwner` を名指ししている。文言の更新は spec を持つ担当が行う

---

## ADR-057: 1 イベントの複数購読者は、先頭の失敗でも全員を走らせてから最初の失敗を投げ直す

### Context

`dispatchDomainEvent` は同じ event type の購読者を登録順に直列で回し、途中の 1 件が throw するとそこで配送全体が終わっていた。`note.purged` の 3 購読者は互いに独立な集約を掃除するため、先頭の恒久失敗（片方の DB 障害など）が後続を**一度も呼ばないまま** outbox 行を隔離まで押し流す。

### Decision

**購読者ごとに `try / catch` で囲み、全員を走らせてから最初の失敗を投げ直す。** 失敗した購読者は `consumerName` 付きで `logger.error` に残す。CLAUDE.md の catch 方針でいう「worker の部分失敗許容」に当たる唯一の箇所である。

投げ直しは残す。配送そのものは失敗させて再配送に委ねる必要があり、成功済みの購読者も再実行されるが、購読者は購読者単位で冪等なので結果は変わらない（ADR-020）。

### Consequences

- 良い点: 1 つの追随者の障害が兄弟の行を巻き添えにしなくなった。`subscribers.test.ts` の「runs the siblings of a failing subscriber」が順序・全実行・失敗の伝播を同時に固定する
- 良い点: どの購読者が落ちたかがログに残る。従来は 1 本の例外しか見えなかった
- トレードオフ: 1 回の配送で複数が落ちても投げ直すのは最初の 1 つだけ。残りはログにしか残らない

---

## ADR-058: Tag / BackupRecord の `insert` は 2 つの一意制約を別の種類のエラーに写す

### Context

Cloudflare の `tagAssignmentRepository` / `backupRecordRepository` は `classifySqlError(cause) === "unique"` だけで判定し、主キー衝突も業務上の対衝突と同じ `ConflictError` に写していた。memory は主キー衝突に `duplicateKey()`＝`SystemError(DatabaseError)` を投げるため、同一入力で 2 つのバックエンドが別の種類のエラーを返していた（ADR 026 違反）。conformance は対衝突しか突いていないので緑のまま通っていた。

### Decision

**2 つの制約は意味が違うので別のエラーにする。** `(tagId, noteId)` / `(noteId, sourceFileId)` の衝突は呼び手が受け入れられる `ConflictError`、`id` の再利用は呼び手が直すべき `SystemError(DatabaseError)`。ポート JSDoc にこの区別を書き、conformance に 1 本ずつケースを足した（`ADP-tag-010` / `ADP-integration-008` の追加ケース）。

Cloudflare 側は `storedFileRepository` と同じ二段構えにした。業務キーと `id` を 1 回の pre-read で見て分岐し、駆動側の UNIQUE index は同時実行に対する fence としてだけ残す。fence 側は落ちた制約の列名（`tag_assignments.tag_id` / `backup_records.source_file_id`）を**肯定形**で見る — 判定できないメッセージ形式は `throwTranslated`（＝ `SystemError`）へ倒れるので、未知の形式が業務エラーに化けることがない。

### Consequences

- 良い点: 両バックエンドが同じ入力に同じ種類のエラーを返す。追加した conformance ケースは memory と cloudflare の両方から走る
- 良い点: 書き込み側（#8 / #4）が `insert` を使い始めたとき、再試行してよい衝突と直すべき採番事故を型ではなく種類で見分けられる
- トレードオフ: `insert` ごとに pre-read が 1 回増える。`storedFileRepository` が既に払っているコストと同じで、書き込み側が来るまでは conformance と usecase テストしか通らない経路である

---

## ADR-059: 孤児メディア掃引はキーセットカーソルで前進させ、継続の条件を「回収できたか」から「ページが満ちたか」へ移す

### Context

ADR-030 は「直後に継続する条件は満ページ**かつ** 1 件以上回収した」と決め、カーソルが無いことを既知の制限として残していた。この制限は運用上の欠陥である。掃引は残すと決めた行をそのまま残すので、scope の最古の `limit`（既定 100）件がすべて本文から参照されている状態 — 稼働中の scope ではごく普通 — になると `collectedCount === 0` で毎日同じページを読み直し、**101 件目以降の孤児は 1 度も検査されない**。`spec/platform/index.md` の「実行予算と分割単位」が置く上限は 1 turn が**読む**行数に掛かるので、turn 内でページを跨いで走査し切る形にも逃げられない。

位置を持ち越す先の候補は 2 つあった。

1. `listByPurposeOlderThan` にキーセット引数を足し、位置を task の payload に載せる
2. 掃引専用の位置ストアを新設する

### Decision

1 を採る。

- **ポートにキーセットを足す。** `listByPurposeOlderThan(purpose, createdBefore, limit, after)` の `after` は `{ createdAt, id }` の**排他的**な位置（`null` は先頭）。順序は `createdAt` 昇順・同時刻は `id` 昇順の全順序で、これは以前から両アダプターが満たしていたが契約としては「古い順」までしか書かれていなかったので、同時刻の tie-break まで JSDoc に上げた。ADR 026 の 3 点セット（ポート JSDoc → conformance → memory / cloudflare）を同時に触っている
- **カーソルは行ではなく位置とする。** 採った行が消えていても解決できる。掃引は読んだページの一部を消すのが常態なので、これは例外ではなく既定である。offset ではなくキーセットにするのはそのため
- **継続の条件を「満ページ」だけにする。** 回収数は条件から落とした。カーソルが毎回厳密に前進するので、満ページで直後を張っても spin にならない — 走査対象は有限で、短いページを引いた時点で翌日へ戻る。`spec/platform/index.md:159` の「対象が残っているのに進捗 0 なら continuation を増やさない」は満たしている。カーソルが進むこと自体が進捗だからである
- **位置は task の payload に載せる。** `scheduled_tasks` の payload は `(kind, operationId)` の upsert で掃引行そのものと一緒に書かれるので、位置の寿命が掃引行の寿命と一致する。2 の専用ストアは同じ寿命を 2 つの行で管理することになり、片方だけ残る状態を作る。`scopeTaskRunner` の該当ハンドラーが `readOrphanMediaSweepTurn(task.payload)` を通して渡す（`readNotePurgeTurn` と同じ形）
- **読めない payload は throw せず先頭からやり直す。** `readNotePurgeTurn` が `SystemError(DataIntegrityError)` を投げるのと非対称なのは、あちらの payload が「掃除すべき 1 件のノート」を名指す**本体**なのに対し、こちらは周期的な全走査の**再開位置**でしかないためである。先頭からやり直せば作業は重複するが取りこぼしはない。逆に投げると backoff が回り、上限に達したところで scope 唯一の掃引行が `failed` で駐車される — 掃引は自分を張り直せないので、その scope の回収は二度と動かない

### Consequences

- 良い点: 参照され続ける満ページの後ろにある孤児へ到達できる。TC-storage-027 の「満ページは翌日へ回す」ケースは「満ページの先へ継続し、後ろに何も無ければ翌日へ戻る」ケースに書き換わり、worker 面から 2 turn で完走することを直接検証している
- 良い点: `CollectOrphanMediaView` が `nextCursor` を返すので、継続が要るかどうかを呼び手が観測できる（従来は `collectedCount` から推測するしかなかった）
- トレードオフ: 走査中に 30 日境界を跨いだ行はカーソルの後ろに現れうるので、そのパスでは拾われない。翌日の先頭からの走査で拾う。境界が前進する掃引でカーソルを持つ以上避けられず、「回収が 1 日遅れる」以上の害はない
- 追随が要る: `spec/usecases/storage.md#collectOrphanMedia` の継続規則（「`limit`件に達したときは残件を先に処理するため直後にも継続taskを設定し」）は文面のままで正しくなったが、入力 DTO にカーソルが増えたことと手順 1 の引数は改訂が要る。`spec/inventory/adapter.md` の ADP-storage-010 の説明も同様

---

## ADR-060: ADR 013 の表は実装へ寄せる（`blockquote` / `q` の `datetime` を落とし、`math` を非許可に明記する）

### Context

`adapters/html/allowList.ts` は冒頭で「ADR 013 の表の転記であって、それ以外ではない」と宣言しているのに、2 か所で表と食い違っていた。ADR 013 の属性表は `blockquote` / `q` / `del` / `ins` の 4 要素へ `cite, datetime` をまとめて与えているが、コードは `blockquote` / `q` に `cite` しか与えていない。`math` はコードの `DROP_WITH_CONTENT` にあるが、ADR のどの行にも現れない。

許可リストは列挙そのものが正典なので、コードと表がずれた瞬間に「どちらが正典か」が読めなくなる。

### Decision

**ADR 013 の側を実装に合わせる。** どちらもコードの判断のほうが正しい。

- `datetime` は HTML として `del` / `ins` / `time` にしか意味がない。`blockquote` / `q` へ与えても不活性な属性を 2 要素ぶん余計に通すだけで、許可リストを広げる理由がない。表を `blockquote` / `q` → `cite` と `del` / `ins` → `cite, datetime` の 2 行に割った
- `math` は「明示的に許可しないもの」へ 1 行足した。MathML 配下は foreign content として解析され、要素を剥がして中身を本文へ昇格させると数式のトークンが地の文になる。`annotation-xml` のように解析を HTML へ戻す入口も残るので、`DROP_WITH_CONTENT`（内容ごと除去）が正しい扱いである

コード側を表どおりに戻す案は採らない。上の 2 つはどちらも「表が実態より広い」方向の誤りで、実装へ寄せるほうが許可リストが狭くなる。

### Consequences

- 良い点: `allowList.ts` の「転記であって、それ以外ではない」という宣言が真になる
- 良い点: 許可リストが 2 要素ぶん狭くなり、MathML の扱いが明文化される
- トレードオフ: 数式は本文の表現力の外に置いたままになる。MathML を通すなら ADR 013 の線引き（「本文は文書としての HTML である」）そのものを動かす判断が要る

---

## ADR-061: 51 件以上の予約は ID を出すが、TC-13 手順 7 の手順書は書き換えない

### Context

`spec/pages/index.md#P-14` は「削除を予約」状態に「処理履歴（P-15）への導線を出す」と定め、`spec/manual-tests/editing.md` TC-13 手順 7 はその導線から処理履歴を開くよう求める。実装の Alert は「処理の進みは処理履歴で確認できます」と文言で触れるだけで、`emptyTrash` が返す `jobIds` を捨てていた。P-15 は Issue #5 の持ち分（ADR-002）なのでルートが無いこと自体は妥当だが、`jobIds` を捨てているのは画面側の欠落である。

### Decision

**画面は `jobIds` を保持して表示し、手順書（`spec/manual-tests/editing.md`）は書き換えない。**

- `TrashList/board.tsx` の `EmptyOutcome` に `jobIds` を持たせ、空でないときだけ「登録した処理: …」として出す。P-15 が入れば導線の材料はそのまま揃う
- TC-13 手順 7 を「ID を数える」へ書き換える案は採らない。`spec/` は「いま何が正か」を持つ正典であって進捗表ではなく（ADR-039）、未実装のスライスに合わせて手順書の要求を弱めると、P-15 が入ったときに誰も導線を確認しなくなる。手順 5 の期待結果にだけ「登録された処理の ID が示される」を足し、`spec/pages/index.md#P-14` の状態にも同じ一言を入れた
- 「本スライスでは確認できない」という読み替えは `.thread/7/testing.md` の該当行が持つ。CLAUDE.md が禁じているのは `spec/` から `.thread/` を参照することであって、逆向きに読み替えを置くことではない

本スライスの `NoteBulkPurgeJobs` は `null` を返す縫い目なので `jobIds` は常に空である。したがって ID の提示だけでは TC-13 手順 7 は実行可能にならない — 手順 7 を止めているのは画面ではなく Job 集約であり、そこを画面側の文言で埋めることはしない。

### Consequences

- 良い点: `emptyTrash` の出力 DTO が持つ 3 つのフィールドのうち、画面が捨てているものが無くなった
- 良い点: Job 集約が入った時点で、画面を触らずに手順 5〜7 がそのまま通る
- トレードオフ: 本スライス単独では手順 7 は依然 FAIL する。その事実は `.thread/7/testing.md` の「本スライス単独では確認できない手順」に残した

---

## ADR-062: P-11 の viewer 行は ED-11 に寄せる

### Context

`spec/pages/index.md#P-11` は「viewer に残るのは『ダウンロード』と表示スタイルのみ」と書き、`spec/scenario/editing.md#ED-11` は「権限のない利用者には切り替え操作を出さず、表示のみとする」と書いていた。同じ操作について正典が 2 つあり、読み手がどちらを採るか決められない。本 PR の変更起因ではない既存の食い違いである。

### Decision

**ED-11 に寄せて P-11 を直す。** `changeNoteStyleMode` の手順 1 が `canEdit` を要求しており（`spec/usecases/note.md`）、権限のない利用者に出した操作は必ず `NOTE_NOT_FOUND` で終わる。出せない操作をメニューに残す記述のほうが誤りである。実装（`NoteDetail/detail.tsx`）も `canEdit` が偽ならメニューごと出さない ED-11 側に従っている。

「ダウンロード」が viewer に残ることは書き換えない。ダウンロードは書き出しのスライス（#10）の持ち分でメニューにまだ無いが、これは spec が実装より先に書いていることであって、消す対象ではない（ADR-039）。

### Consequences

- 良い点: 表示スタイルの権限について正典が 1 つになった
- トレードオフ: 装飾を持たない本文を viewer が読むとき、既定スタイルを当て直す手段は無い。ED-11 がそう決めている

---

## ADR-063: 台帳 ID は末尾に採番し、既存テストの `it` 名を新 ID へ付け替える

### Context

canon の同期で、既存の行に収まらない振る舞いが 6 つ出た — `NoteRepository.findNextPurgeDeadline`、`emptyTrash` の飛ばせない失敗とジョブ経路の列挙上限、SVG の 128 KB 境界とサニタイズ後の測り直し、孤児掃引のカーソル前進と読めない payload。いずれもテストは既に存在したが、`it` 名は近い既存 ID（`ADP-note-013` / `TC-note-111` / `TC-note-106` / `TC-storage-180` / `TC-storage-181` / `TC-storage-027`）を流用していた。

### Decision

`spec/inventory/*.md` の採番規則どおり、**各群の末尾に新規採番し、行位置には挿入しない**（`ADP-note-057`、`TC-note-778` / `779`、`TC-storage-251`〜`255`）。中間に挿すと以降の ID がすべてずれ、テストコード・レビュー・コミットの過去の参照が別のケースを指すことになる。

あわせて、流用していた `it` 名を新 ID へ付け替えた。台帳は「TC ID を `it` 名に書くことは推奨するが要求しない」（ADR 058）としているが、**誤った ID を書くことは推奨も許容もしていない** — 無印より悪い。

`ADP-note-043`（`beginPurge`）だけは新 ID を起こさず説明文を厚くした。冪等順序は `beginPurge` の一節であって別のポートメソッドではない（ADR-048）。

### Consequences

- 良い点: 台帳の行とテストの `it` 名が 1 対 1 で辿れる
- トレードオフ: 群の末尾に新しい振る舞いが並ぶので、台帳を上から読んでもユースケースの順にはならない。台帳の ID は識別子であって順序ではない、という規則どおりの帰結である

---

## ADR-064: `spec/inventory/usecase.md` の UC-storage-012 は直さない

### Context

`UC-storage-012`（`deleteFilesForNote`）は「source・media・reference files と **reference import records** を各 100 件ずつ削除・継続し」と書いているが、実装は取り込み記録の回収を取り込みスライス（#6）へ先送りしている（`ReferenceImportRecordRepository` とその背後の表がまだ無い）。

### Decision

**直さない。** これは ADR-039 が「spec が実装より先に書いていること」として 1 行も触らないと決めた側に当たる。`spec/usecases/storage.md#deleteFilesForNote` の手順 3・4 も同じ設計を書いており、台帳だけを実装に合わせて削ると、取り込みスライスが実装すべき対象が正典から消える。台帳は「実装されるべき振る舞いの要点」を持つ列であって、実装済みかどうかを持つ列ではない。

進捗を読む先は Issue のチェックリストであり、`deleteFilesForNote` の JSDoc も「取り込みスライスが同じ継続へ自分のページを足す」と明記している。

### Consequences

- 良い点: 取り込みスライスのチェックリストが痩せない
- トレードオフ: 台帳だけを読むと `deleteFilesForNote` が既に取り込み記録を消していると読める。実装との差は Issue が持つ

---

## ADR-065: `purgeNote` の abort は「拒否」だけに限り、判定不能な失敗では route を `purging` に残す

### Context

`drive` は local transaction のあらゆる例外で `abortPurge` を呼び、route を `active` へ戻していた。`spec/usecases/note.md#purgeNote` の手順 3 が abort を許すのは「競合して Note が残る場合」だけで、手順 4 以降は forward-only と書いてある。

差が出るのは commit 後に応答を失ったときである。Cloudflare DO / D1 では現実に起こる形で、そのとき `ctx.noteRepository.delete` は確定し `note.purged` は outbox に載っているのに、呼び出し側から見えるのは例外だけになる。旧実装はここで route を `active` に戻すので、Note は消え fan-out は走り、それでも route は「解決するが実体の無い」行として残り、`finishPurge` も走らないので tombstone も付かない。以後この route を通る全経路が `NOTE_NOT_FOUND` を返し続ける。

「commit したかどうか」は外からは判定できない — 応答を失った commit と、そもそも走らなかった transaction は同じ形をしている。

### Decision

**abort するのは transaction が「削除しない」と決めた拒否だけに限る。** `isAbortableRefusal` が集合を閉じ、`isConflictError`（版・foreign scope・cleanup ownership・書き込み障壁）／ `isNotFoundError`（権限を潰した形）／ `ValidationError("NOTE_NOT_TRASHED")` の 3 つだけを通す。これは `reclaim` が「Note を残したまま」投げうる例外の全体でもある。

それ以外の例外では abort せず、route を `purging` のまま残してログに残す。到達不能は事実の表現であり、2 つの答えのうち回復できるのは片方だけである — `purging` の route は同じコマンドの再送で再開できるが、消えた Note の上で開き直した route は永久に解決不能になる。

`userRequest` だけは再送口が無い（operation ID を採番し、`resolve` が `purging` を隠す）。この制約は既に JSDoc の「Not covered by this slice」が recovery driver の持ち分として宣言しており、そこに 1 文足すに留めた。

### Consequences

- 良い点: forward-only 規則が実装と一致し、「解決するが実体の無い route」が原理的に作れなくなる
- 良い点: abort する条件が名前の付いた 1 つの述語になり、`reclaim` に拒否を足すときに見る場所が 1 か所になった
- トレードオフ: `userRequest` で判定不能な失敗が起きると、route は recovery driver が来るまで `purging` のまま残る。利用者から見ればノートは消えたままで、復元も再削除もできない。旧実装ではこの窓で route が `active` に戻り「消えたのに一覧に見える」形になっていたので、壊れ方が「見えないまま」へ寄った
- テスト: `purgeNote.test.ts` に TC-note-353 として 2 本。commit 直後に応答を失う wrapper を 1 回だけ噛ませ、(1) `userRequest` で Note が消え `note.purged` が 1 件出た上で route が `purging` に残ること、(2) `scopeCleanup` では同じコマンドの再送が tombstone まで到達し `note.purged` が二重にならないことを見る

---

## ADR-073: `position` の値は許可リストで判定する

### Context

`filterCss` は `position` の値が `fixed` / `sticky`（とベンダー接頭辞付きの同義語）に一致するかだけを見ていた。ブラウザは `var()` を CSS の解決時に展開するので、`:host{--x:fixed}` と `.o{position:var(--x)}` を 1 つの `<style>` に並べるだけで、ADR 013 の中核防御（公開ページ全面を覆うオーバーレイを描かせない）が素通りする。CSP は `position` を止めないため多層防御も効かない。

### Decision

**値の判定を許可リストへ転換する。** `static` / `relative` / `absolute` とグローバルキーワード（`inherit` / `initial` / `revert` / `revert-layer` / `unset`）だけを残し、それ以外の値は宣言ごと落として `removed` に載せる。`var()` / `env()` / 将来の `attr()` は綴りを列挙しなくても自動的に落ちる。

否認リストへ `var(` を足す案は採らない。ブラウザが解決する間接の形を先回りして列挙し続けることになり、ADR 013 が要素・属性で否認リストを捨てた理由と同じ失敗形に戻る。

過剰除去の代償は無い。許可リストに載らない値は、ブラウザから見れば解決できる間接（`var()`）か無効な宣言として無視される綴り（`position:absolutely`）のどちらかで、どちらも落としても装飾を失わない。

新しく足したテストのうち「未列挙の値を落とす」「グローバルキーワードを残す」の 2 件は許可リスト自体の帰結であって台帳に行が無いので、`SanitizeCase.tc` を省略可能にし、`it` 名は振る舞いだけを述べる形にした（ADR-058 / ADR-063 の「誤った ID を書かない」に従う）。

### Consequences

- 良い点: 間接の綴りを列挙せずに `position: fixed` への到達経路が閉じる
- 良い点: ADR 013 の「許可リスト方式」が要素・属性・URL スキームだけでなく CSS の値にも一貫して掛かる
- トレードオフ: 将来 CSS に安全な `position` の値が増えたら、許可リストへ足すまで落ちる。ADR 013 の表が正典なので更新点は 1 か所である
- プレビュー（ADR-052）は CSS 宣言を一切見ないため、サーバー側が落とす量が増えても「プレビューは `HtmlProcessor` の部分集合」の不変条件は保たれる

---

## ADR-066: 本文の転送上限は生 HTML の 2 MB、テキストノード編集の枠はサニタイズ後の 800 KB

### Context

`NOTE_HTML_TRANSPORT_MAX` は 800,000 文字で、根拠のコメントは「バイト上限と同じ数の文字数を許せばドメインの判定より必ず緩い」と書いていた。比べている 2 つが違う — ドメインの 800,000 バイトは**サニタイズ後**の `NoteHtml` に掛かり、転送の上限は**サニタイズ前**の生 HTML に掛かる。生 HTML はサニタイズで縮む側なので「必ず緩い」は成り立たず、ED-03 の中核要件（インラインスクリプト込みで 1 MB ある保存済み Web ページ）が `NOTE_CONTENT_TOO_LARGE` ではなく `INVALID_INPUT` で弾かれていた。

### Decision

転送上限を `spec/usecases/note.md#updateNoteBody` の入力 DTO 表どおり **2,000,000 文字**にする。DoS の枠としてはそれで足り、`ContentTooLarge` はサニタイズ後にドメインが出す。

あわせて、`applyTextNodeEdits` の枠が使っていた定数を `NOTE_HTML_SANITIZED_MAX`（800,000）へ分けた。あの枠の根拠は「書き換えの前後どちらの本文もサニタイズ後 800 KB に収まる」であって生 HTML の上限ではないので、転送上限に相乗りしたままだと 2 MB への緩和が理由の無い 4 MB を連れてくる。運ぶのがテキストノードの中身である以上、サニタイズ後の上限が正しい枠である。

### Consequences

- 良い点: ED-03 の「800 KB 超は保存を拒否し、分割を促す」が設計どおりの種別で返る
- 良い点: 2 つの上限が別のものを測っていることが定数名から読める
- トレードオフ: 転送が受け取る最大バイト数が増える。サニタイズ前の 1 回の POST に掛かる枠なので、`ContentTooLarge` を出すために必要な余白の範囲に収まっている

---

## ADR-067: `note.purged` 追随者の受理判定は personal barrier 専用と明記し、workspace 削除経路は開けない

### Context

`assertNotePurgeAdmission` は `ScopeCleanupAdmissionStore.describePersonalCleanup` だけを引く（ADR-056）。一方 `NotePurgeFanOutTurn.deletionOperationId` の JSDoc は「account **or workspace** deletion 由来の token」と書き、受理判定の JSDoc も「この scope を名指さない token を拒む」という scope 非依存の述語として読める。workspace scope には personal receipt が無いので、workspace 削除由来の token を積んだ `note.purged` は初回配送も継続も一律 `ConflictError("CLEANUP_OPERATION_MISMATCH")` になる。「対応しているように読める JSDoc」「対応を要求する TC」「対応していない実装」の三すくみである。

### Decision

**実装ではなく JSDoc を直す。正典は `spec/usecases/{tag,integration,storage}.md` の手順 1 で、そこは `describePersonalCleanup` を名指しし「同じ operation の receipt が current scope にあること」を要求している。** 実装はその正典どおりであり、広げれば正典と食い違う。

- `NotePurgeFanOutTurn.deletionOperationId` を「personal barrier の token に限る」と書き直し、workspace scope が見るのは常に `null` であること、非 null が届けば拒否されることを明記した
- `assertNotePurgeAdmission` の JSDoc に、述語が personal receipt 1 本であること、workspace の追随を開くスライスは**この述語と usecase 手順の両方**を広げる必要があることを書いた
- `deleteNotesForOwner` の `scope` の JSDoc から「workspace deletion は workspace を名指す」という現在形の主張を外し、`workspaceDeletionLocal.ts` がノートを purge しない事実を書いた

実装側に workspace 半分（`WorkspaceOperationLockStore.assertDeletionOwner` へのフォールバック）を足す案は採らなかった。理由は 2 つある。1 つは正典との食い違いで、上のとおり。もう 1 つは `assertDeletionOwner` が完了済み manifest tombstone で false に転じることで、ADR-056 が personal で避けた「完了と fan-out が必ず競合する」問題をそのまま workspace 側に作る — workspace の完了条件は manifest の item 数であってノートではないので、fan-out が in-flight のまま `markCompleted` に到達しうる。**追随を開くなら、受理判定に「完了済みも通す」workspace 側の read が要る**。これはポートの新設であり、本スライスの持ち分ではない。

### Consequences

- 良い点: 3 者（JSDoc・usecase 正典・実装）のうち 2 者が既に一致していた側へ寄り、読み手が「どちらが正か」を決められる
- 良い点: workspace 追随を開くスライスに、必要な作業（受理述語の workspace 半分 + usecase 手順の改訂 + 完了済みを通す read）が JSDoc と本 ADR に残る
- トレードオフ: `spec/testcases/integration/deleteBackupRecordsForNote.md` の「ワークスペース削除に伴う `note.purged`」行と `spec/testcases/storage/deleteFilesForNote.md` の TC-storage-060 は、依然「workspace 削除由来」を名乗っている。文言は spec を持つ担当の持ち分として残す。ただし TC-integration-022 の実体（ワークスペース所有ノートの記録がこの経路で消えること）は `subscribers.test.ts` に追加したケースが直接押さえた

---

## ADR-068: `note.purged` 追随者の継続 priority は turn の出自で決める

### Context

`armNotePurgeContinuation` は継続を無条件に `securityCleanup`（priority 0）で積んでいた。`spec/database/index.md` と `spec/platform/index.md` は priority 0 を「security cleanup / lease reaping」と定義し、「低 priority task が継続的に補充されても security cleanup と lease reaping を飢餓させない」ことを保証としている。この保証は class 0 の中身が membership / account の後始末と lease 回収に限られることに依存する — `ScopeTaskScheduler` は priority ごとに 1 枠を予約するが、**同じ priority の中には公平化が無く** `(dueAt, kind, operationId)` 順でしかない。ユーザーがゴミ箱を空にした purge や retention sweep の fan-out まで class 0 に入れると、退会中の scope で `note.ownerPurgeContinued` / `storage.ownerDeleteContinued` と同じ枠を奪い合う。

### Decision

**`deletionOperationId !== null` の turn だけ `securityCleanup`、それ以外は `expiryCollection`（3）にする。** 分類の基準は追随者ではなく turn の出自である。削除由来の turn が回収する行は障壁が待っている行そのものなので class 0 に属し、通常の purge の後始末は「期限回収」の定義にそのまま収まる。

spec の priority 定義を広げる案は採らない。広げれば飢餓保証の前提を書き換えることになり、その根拠（fan-out は 1 ノートあたり満ページのときだけ 1 行）を保証として書き足す必要がある。既存の 2 つの class にそのまま収まるなら、正典を動かさないほうが安い。

### Consequences

- 良い点: class 0 が `spec/database/index.md` の定義どおりの中身に戻り、飢餓保証の前提が保たれる
- 良い点: 出自による分類なので、削除由来の追随は従来どおり最優先で走る（TC-tag-027 の 1 本目がそれを固定している）
- トレードオフ: ユーザーがゴミ箱を空にした直後の付与・記録・ファイルの回収は、同じ scope に投影や outbox の仕事があるとその後ろに回る。回収が観測される画面は無く、1 turn ぶんの遅れに留まる

---

## ADR-069: ワークスペース設定のシェルも `canWrite` を渡す（ADR-038 のトレードオフを覆す）

### Context

ADR-038 は `ShellScope` の `canWrite` を省略可にし、「省略は出さないと読む」と定めたうえで、ワークスペース設定のレイアウトは「別の loader で開いていて、そこまで手を伸ばすと本スライスの担当範囲を越える」としてゴミ箱の導線を落とした。

これは事実の確認を落としていた。`settings/route.tsx` の loader（`loadWorkspaceSettingsShell`）はすでに `getWorkspaceSettings` を呼んでおり、その `WorkspaceSettingsView` は `role` を非 null で持っている。ロールを読まない画面ではなく、**読んでいるのに黙っている**画面だった。

結果として、owner / editor が設定の 4 タブを開いているあいだだけスコープトークンから「ゴミ箱」が消え、同じメニューの「ワークスペース設定」「公開ページ」はロール判定なしで並び続けるという非対称が残っていた。`spec/pages/index.md#L-01` の「パレット以外に最低 1 つの視覚的導線」を満たす導線が、この画面では 0 になる。

### Decision

`loadWorkspaceSettingsShell` が `canWrite: WorkspaceRole.atLeast(settings.role, "editor")` を返し、`settings/route.tsx` がそれを `scope` へ渡す。ノート一覧の loader（`workspaces/$workspaceId/-action.tsx`）と同じ 1 行である。

`canWrite` を省略可に保つ判断（ADR-038 の主文）はそのまま残す。覆すのは「設定配下は見送る」というトレードオフのほうだけで、規約は「**ロールを読む画面は省略しない**」と読み替える — 省略は「知らない」であって「持っていない」ではないので、答えを持っている loader が黙るとその画面でだけ導線が消える。この読み替えは `listing.ts` の JSDoc にも書いた。

### Consequences

- 良い点: owner / editor は設定配下からもゴミ箱へ移れる。viewer には引き続き並ばない（TC-32）
- 良い点: 判定の出所が `WorkspaceRole.atLeast(role, "editor")` の 1 種類に揃う
- トレードオフ: 同じ 1 行を 2 か所に持つ。まとめる先は「ロールを読む loader が返す形」だが、2 つの loader の戻り値の形が違うので今回は寄せていない
- 残件: `invitations/-action.tsx` は `getWorkspaceSettings` を読まない経路なので省略のまま。ここは ADR-038 の原則どおり

---

## ADR-070: HTML 由来のノートは WYSIWYG で開かず、既定モードの復元も ED-04 の門を通す

### Context

編集画面は既存ノートを常に WYSIWYG で開き、端末に覚えた既定モードの復元は `setMode(preferred)` を直接呼んでいた。ED-04 の警告と `wysiwygConversion` の版理由は `enterMode` にしか無いので、次の 2 つが常用パスとして素通りしていた。

1. 既定が WYSIWYG の端末で HTML 由来のノートを開く（`setMode` は初期値と同じなので何も起きない）
2. 既定が無い端末で HTML 由来のノートを開く（初期値がそのまま WYSIWYG）

どちらも「警告を出さないまま WYSIWYG に居る」状態で、そこで 1 文字打って保存すれば装飾は正規化され、版理由は `manualEdit` になる。ED-04 が保証する「保存前に自動で版を保持し、元に戻せる」経路に到達しない。

復元だけを `enterMode` に通しても 1 と 2 は消えない。**初期値が無条件に WYSIWYG である**ことが原因なので、そこを動かさない限り「警告なしに WYSIWYG に居る」状態は残る。

加えて ED-04 は「警告は『今後表示しない』を選べる。設定画面から再表示に戻せる」と定めるが、`WYSIWYG_WARNING_KEY` を消す UI はどこにも無く、一度押すと永久に戻せなかった。

### Decision

- 既存ノートの初期モードを `mayLoseDecoration ? "html" : "wysiwyg"` にする。WYSIWYG へ入るのは必ず明示の切り替えになり、そのすべてが `enterMode` の門を通る
- 既定モードの復元も同じ門を通す。ただし開いた直後の正本は `target` そのものなので `applyMode` の引き直しは挟まず、`seedMode` を直接呼ぶ
- 「今後表示しない」は**出さない**。戻し口（設定画面からの再表示）は本スライスの外にあり、戻せない一方通行の抑止だけを先に出すと、一度押した端末では装飾の喪失が二度と告げられなくなる。`preferences.ts` からも `readWysiwygWarningDismissed` / `writeWysiwygWarningDismissed` と鍵を落とした
- `seedMode` は同じモードへ載せ直すとき（破棄）に、まだ記録していない変換の予定を落とさない

新規作成（ED-05）は `mayLoseDecoration` を持たないので、引き続き常に WYSIWYG で開く。

### Consequences

- 良い点: 「警告なしに WYSIWYG に居る」状態が構造的に無くなる。HTML 由来のノートの最初の保存は必ず `wysiwygConversion` として版に残る
- 良い点: 抑止の状態が端末に残らないので、戻し口が無いことが実害にならない
- トレードオフ: **取り込み由来のノートは HTML モードで開く。** `mayLoseDecoration` は `sourceFileId !== null || styleMode === "preserve"` なので、装飾を持たない取り込み（Markdown 由来など）もソース面で開くことになる。1 回モードを切り替えれば端末の既定が更新され、以降はそちらで開く
- トレードオフ: ED-04 の「今後表示しない」は spec に残ったまま実装が持たない。設定画面のスライスが入るときに、鍵・抑止・戻し口の 3 つを同時に足す

---

## ADR-071: 破棄はモードによらずサーバーから正本を引き直す

### Context

「破棄」は手元の「確定済みの値」（`savedRef`）へ戻す実装だった。ビジュアルモードではこれが成立しない。

ビジュアルモードの保存は経路単位の書き換え（`applyTextNodeEdits`）なので、`commit` が確定済みとして持つ本文は**面を差し替える前の HTML** のままである。つまり `savedRef.current.body` はビジュアルモードにいるあいだ一度も進まない。そこで破棄を押すと、

1. `setBaseline(nextBody)` が同じ文字列なので `VisualSurface` の再シードが起きず、span の中身は編集したまま残る（画面上は何も破棄されない）
2. `visualDirty` だけが下りて `visualCurrent` は編集後の値を保持し続けるため、次に 1 文字打つと破棄したはずの編集まで差分に混ざり、自動保存がそれを送る

手元の値で再シードする形に直しても直らない。保存済みの書き換えを画面から消したうえで、次の編集が古い `expected` で送られて全件 `contentChanged` に落ちるだけである。確定済みの本文の HTML は、ADR-051 が書いたとおり**引き直すしか手が無い**。

### Decision

破棄は `applyMode(mode)` に落とす — モードを変えずに、同じ経路で正本を引き直して面ごと載せ直す。退避（`clearDraft`）と提案（`draftOffer`）はその前に畳む。ノートがまだ無い（新規作成）ときだけ、`applyMode` の既存の分岐が `savedRef` から載せ直す。

あわせて `replaceBody` を「面を組み直す唯一の口」にする。

- `baselineSeed` を必ず 1 つ進め、`VisualSurface` はそれを再シードの鍵に加える。破棄はまさに**同じ文字列へ戻す**操作なので、文字列の同一性だけでは鍵にならない
- ビジュアルの経路表（`visualOriginal` / `visualCurrent`）を捨てる。残すと破棄した書き換えが次の差分に混ざる
- サニタイズ通知（`removed`）と skip 通知（`skipped`）を落とす。どちらも「直近の保存結果」を指す表示で、正本を載せ直した面の上に前の保存の結果が残ってはならない

### Consequences

- 良い点: ED-08 手順 3 と TC-10 が 3 モードすべてで成立する。破棄したあとの面と `expected` がサーバーの正本と一致する
- 良い点: 通知の寿命が「面の世代」に揃う。モード切替・版の復元・競合解決でも同じ規則で消える
- トレードオフ: 破棄が 1 往復ぶん遅くなる。往復の最中は `busy` なので破棄ボタンも押せない
- トレードオフ: 通信が切れているあいだは破棄できない（引き直しに失敗すると、モード切替と同じくエラーの状態だけが出る）。手元へ戻すだけの破棄なら成立したが、ビジュアルモードでその「手元」が正しくない以上、モードごとに別の意味を持たせるよりは揃えるほうを採った

---

## ADR-072: HTML プレビューの断言は「補正した構文」までに限り、はみ出しは `contain` で止める

### Context

ADR-052 はプレビューが落とすものを「保存時のサニタイズが落とすものの**部分集合**」に保つと定めた。この不変条件は維持したい — プレビューが `HtmlProcessor` より多く落とすと、保存されるはずの内容が保存前に見えなくなる。

一方で補正アラートの文言は「保存すると、下のプレビューの内容で保存されます」と言い切っていた。実際にプレビューが落とすのは危険要素・`on*`・`javascript:` URL だけで、許可リスト外の要素・属性・CSS 宣言はそのまま残る。ED-03 が「除去された要素・属性・URL・CSS 宣言が保存後に一覧表示される」と定めているのと合わせて読むと、利用者には「プレビュー＝保存される内容」と読めてしまう。

`position: fixed` / `sticky` はこの差分の中でも性質が違う。Shadow DOM が隔離するのはスタイルの**適用範囲**だけで、ビューポート基準の配置は隔離しないので、プレビューが編集画面全体を覆う形も作れる。

### Decision

- 文言を実態へ合わせる。「下のプレビューは補正した構文で描いています。保存時にはさらに、許可されていない要素・属性・CSS 宣言が取り除かれます（除去された分は保存後に一覧で示します）」
- `scrubForPreview` には `position` を足さない。ADR-052 の部分集合の不変条件を崩すうえ、`adapters/html/css.ts` の許可規則が動いているあいだ、両側で別々の値判定を持つことになる
- 代わりにプレビューのホストへ `contain: layout paint` を掛ける。固定配置の包含ブロックになるので、中身が何であれ面の外へ出られない。HTML には触らないので不変条件に関わらない

### Consequences

- 良い点: 断言が実態と一致し、ED-03 の「保存後に一覧で示す」との関係も文言の中で繋がる
- 良い点: はみ出しの封じ込めが、サニタイズ規則の変更から独立する
- トレードオフ: プレビューと保存後の姿の差は残る。埋めるには読み取り専用のサニタイズ経路をサーバーに置く必要があり、打鍵ごとの描画には重すぎる

---

## ADR-074: 保管する SVG は「単体の 1 文書であること」を保管直前に確かめ、そうでなければ受理しない

### Context

ADR-011 は `HtmlProcessor.process` の戻り値へ名前空間宣言を付け直す形を採ったが、確かめていたのは**根要素が `svg` であること**だけだった。受理判定（`UploadValidationPolicy.opensAsSvg`）もプロローグを読み飛ばして根要素を見るところまでで、文書がその根要素で閉じるかは見ていない。

`process` は本文断片のサニタイザーなので、`<svg …></svg>trailing text<p>and a paragraph</p>` は許可リストを通った残骸ごとそのまま返る。それが `.svg` として `ObjectStorage.put` され、`/storage/$` が `image/svg+xml` で配る。XML はルート要素の後ろの内容を**致命的エラー**として扱うので、この文書はどのブラウザでも 1 ドットも描かれない。`spec/usecases/storage.md#storeMedia` 手順 4 の「単体の `.svg` として開けるよう」という契約を、受理した入力に対して満たしていなかった。

加えて開始タグの抽出が `markup.indexOf(">")` だったため、parse5 が属性値中の `>` をエスケープしないこと（`data-x="a>b"`）と噛み合わず、`xmlns` 重複ガードが誤判定しうる状態だった。

選択肢は 2 つ。

1. `opensAsSvg` を「ルート外に非空白の内容が無い」まで強める
2. サニタイズ後の markup が 1 つの `svg` 文書であることを `storeMedia` が確かめ、そうでなければ拒否する

### Decision

2 を採る。`storeMedia` の `findSvgRoot` が、サニタイズ後の markup を**属性値を不透明として扱う走査**でたどり、(a) 最初の要素が `svg` の開始タグ、(b) その対応する終了タグまでで入れ子が閉じる、(c) ルートの外に空白以外が無い、の 3 つを確かめる。満たさなければ `BusinessRuleError(UnsupportedMimeType)` で拒否する。

1 を採らないのは、判定の対象と保管される実体が違うためである。受理判定が見るのは**受け取ったバイト列**、実際に配られるのは**サニタイザーの出力**で、両者は SVG では別物になる（ADR-054 が測り直しを入れたのと同じ理由）。ルート外の内容はサニタイズで増減もするので、保証は保管する側の実体に当てるほかない。

同じ走査が `>` 問題も畳む。開始タグの終端が引用符を意識して決まるので、`xmlns` / `xmlns:xlink` の重複ガードが本当のルート開始タグを見るようになる。

### Consequences

- 良い点: 保管された `image/svg+xml` は必ず XML として開ける。「アプリ自身のオリジンから、宣言した型と異なる攻撃者由来の HTML を配る」状態が閉じ、CSP が付かない公開ドメイン配信（`spec/platform/index.md`）へ移っても担保が残る
- 良い点: `ALLOWED_SVG_ATTRIBUTES` の `xmlns` が将来到達可能になっても、二重宣言のガードが実際に効く
- トレードオフ: 走査は文字列レベルのタグスキャンで、正しい HTML パーサーではない。入力がパーサー出力に限られるため成り立つ（コメントも doctype も既に落ちている）ので、コメント・doctype・裸の `<` を見つけたら拒否する側に倒している
- トレードオフ: ルート外にコメントだけを持つ SVG も拒否される。サニタイザーがコメントを落とすので実際には到達しない
- 追随が要る: `spec/usecases/storage.md#storeMedia` 手順 4 に「1 文書にならなければ `UnsupportedMimeType`」の一文と、エラー表への行が要る（本ユニットは当該ファイルを触れないため未反映）

---

## ADR-075: 孤児メディアの参照元には保持中の版の本文も数える

### Context

`collectOrphanMedia` の `isOrphan` は所属ノートの**現在の本文**だけを見ていた。本スライスは同時に `restoreNoteRevision`（AC-8「直近 20 版から復元できる」）を実装しており、`NoteRevision` は `html: NoteHtml` を保持している。回収の起点は作成時刻なので、「挿入 → 翌日に本文から外す → 29 日後に回収」の順で、まだ復元できる版が指すメディアが消える。復元は成功して画像だけが 404 になる。20 版は数か月をまたぐので稀ではない。

### Decision

判定を「現在の本文 ∪ 保持している版（`NoteRevision.RETENTION` 件）の本文」に広げる。読み取りは**ファイル単位ではなくノート単位**にして 1 turn のあいだ持ち回る（`readNoteReferences` + `byNote` の Map）。ページは 1 つのノートの画像であることが普通なので、これで版の分だけ CPU が倍増するのを防ぐ。

### Consequences

- 良い点: 版から復元した本文の画像が生きている。回収規則と保持規則が同じ「生きた参照」の定義を共有する
- トレードオフ: 1 ノートあたり `RETENTION + 1` 本の本文解析と、版一覧の読み取り 1 回が増える。turn の上限は読む**行数**に掛かる（`spec/platform/index.md`）ので、`ORPHAN_MEDIA_BATCH_SIZE` はそのままにし、ノート単位のキャッシュで実際の増分を抑えた
- トレードオフ: 版が消えるまでメディアも消えない。保持は直近 20 版なので上限があり、`deleteFilesForNote` の完全削除経路は変わらない
- 追随が要る: `spec/usecases/storage.md#collectOrphanMedia` 手順 2 と `spec/testcases/storage/collectOrphanMedia.md` に版の行が要る（本ユニットは当該ファイルを触れないため未反映。`spec/domains/storage.md` の `FilePurpose` 表と直後の段落には反映済み）

---

## ADR-076: 掃引 turn は自分を `failed` に落とさない — 失敗したら記録して翌日へ張り直す

### Context

ADR-059 は「読めない payload で失敗させると上限で `failed` に駐車し、掃引は自分を張り直せない」と認識して payload だけを手当てした。しかし駐車の原因は payload に限らない。掃引行を張り直せる経路は `armOrphanMediaSweepOnFirstMedia` だけで、その述語は「scope に media が 1 件も無い」である。media を持つ scope は二度とその条件を満たさないので、いったん `failed` になればその scope の回収は永久に止まる。

推奨されたのは `ScopeTaskScheduler` に存在確認を足す案だったが、ポート契約の変更は ADR-026 の 4 点セットになり、本ユニットが触れないアダプターを含む（ADR-055 と同じ理由）。

### Decision

掃引 turn 自身が駐車を避ける。

- **turn 全体を包み、失敗したら記録して翌日へ張り直し、`{ collectedCount: 0, nextCursor: null }` を返す。** runner は正常終了として扱うので `backoff` が回らず、`attempt` が上限に届かない。周期的な全走査は 1 回落としても取りこぼしにならない — ADR-059 が payload に当てた理屈を turn 全体へ広げただけである
- **1 件の判定失敗はその行を残して継続する。** 走査の transaction は読み取りしかしないので、途中で握りつぶしても半端な書き込みは残らない。ここで turn を失うと、その毒された行のあるページでカーソルが止まり、後ろの行が永久に検査されなくなる（まさに避けたい状態）
- 張り直し自体が失敗したときだけ throw する。行を書けない状況では、誰にも張り直せない

### Consequences

- 良い点: `failed` に駐車する経路が無くなり、`spec/adr/026` のポート 4 点セットを動かさずに済む
- トレードオフ: 恒久的な不具合はログにしか出ず、毎日静かに失敗し続ける。掃引には観測される画面が無いので、監視はログ側の仕事になる
- トレードオフ: 掃引行だけが「上限で駐車しない」scope task になる。他の継続要求は名指しの対象を持つので駐車が正しい振る舞いで、こちらだけが「自分を張り直せない周期 task」という別の性質を持つ

---

## ADR-077: `readNotePurgeTurn` は `NoteId` の不変条件を自分の門で全域化する

### Context

`readNotePurgeTurn` は「読めない payload には `SystemError(DataIntegrityError)` を返す」を唯一の答えとして持つ。ところが門は `typeof !== "string" || length === 0` だけで、最後の `NoteId.create` はその外にある。`NoteId.create` は trim してから空判定するので、`{ noteId: "   " }` は門を素通りして `BusinessRuleError(NOTE_INVALID_ID)` になる。scope task の payload は自分たちが書いたものなので実害は小さいが、「保存した行が壊れている」と「呼び手が禁じられたことを要求した」は別種で、後者を返すと配送側の扱い（隔離するか、呼び手へ返すか）も変わる。

### Decision

**門の判定を `noteId.trim().length === 0` にして、`NoteId` の不変条件と一致させる。** `NoteId.create` を `try` で包む案は採らない — 包むと「値オブジェクトが将来どんな理由で throw しても DataIntegrityError に写す」ことになり、業務不変条件の違反まで壊れた行として報告する。門で不変条件を写しておけば、`NoteId.create` に到達する値は必ず通ることが読んで分かる。

代償として、`NoteId` に新しい不変条件が入ったときこの門も直す必要がある。その結合は WHY コメントとして門の直上に置き、`readNotePurgeTurn` の対応表（`""` / 空白のみ / 非文字列 / 欠落）を `subscribers.test.ts` の 1 ケースが押さえる。

### Consequences

- 良い点: 「payload が読めないときの答えは `corrupt()` ひとつ」が全域の主張になった
- トレードオフ: `NoteId` の不変条件が 2 か所に書かれる。片方は値オブジェクトの正典、もう片方はこの門の写しで、テストが両者の一致を見る

---

## ADR-078: `filterCss` は元に無い終端子を書き戻さない — サニタイズは不動点である

### Context

`HtmlProcessor.process` の出力は入力に戻ってくる。`applyTextNodeEdits` は自動保存のたびに保存済みの本文をもう一度通し、`restoreNoteRevision` と `listNoteRevisions` も同じことをする。つまり `process(process(x)) === process(x)` は暗黙の前提だったが、どこにも書かれておらず、`filterCss` がそれを破っていた。

`filterCss` は分類できた文を `${text};` で押し、ブロックには常に `}` を足していた。終端子が入力に無くても足す。ところが**終端子が見つからないのは、走査が閉じていない文字列か閉じていない `(` に呑まれたときだけ**なので、足した `;` はその構文の内側に落ちる。次の走査はそれを終端子として見ず、また 1 つ足す。`</style>` は raw text を切るので `<style>.a{content:"</style>…` という入力は現実に作れ、ビジュアルモードの自動保存が回るあいだ本文が保存のたびに伸び続ける。増分は `removed` にも画面にも出ない。

### Decision

**終端子は入力にあったものだけを書き戻す。** `pushStatement` は「その文が実際に `;`（または閉じ側の `}`）で終わっていたか」を受け取り、終わっていなければ何も足さずにそのまま押す。ブロックの `}` も `findBlockEnd` が実際に見つけたときだけ書き戻す。停止位置が見つかったということは、そこまでに開いたままの文字列も括弧も無かったということなので、書き戻した終端子が次の走査で呑まれることはない。これで各文の出力が入力の部分文字列そのものになり、不動点が構造的に成立する。

「閉じていない文字列だけを特例にする」案は採らない。呑まれる構文は文字列・括弧・（ブロックでは）波括弧の 3 つあり、特例を数えるより「無かったものは足さない」1 つの規則のほうが短い。`css.ts` 冒頭が既に「壊れた CSS は拒否せず carried through する」と宣言しており、その宣言を文字どおりにしたことになる。

不動点そのものは `htmlProcessor.test.ts` の表全体を 2 回通す形で押さえる。個別のパターンを潰すのではなく、**性質**として持つためである。

### Consequences

- 良い点: 再サニタイズで本文が伸びる経路が閉じる。`applyTextNodeEdits` / `restoreNoteRevision` / `listNoteRevisions` のどれも本文を変えない
- 良い点: サニタイズ表に行を足すたび、不動点のケースも自動で 1 つ増える
- トレードオフ: **`;` の正規化を失う。** `style="color:red"` はこれまで `color:red;` になっていたが、そのまま残る。ブロックの閉じ波括弧も、入力に無ければ補われない（`<style>.a{color:red</style>` は閉じないまま保存される）。どちらもブラウザは EOF で閉じるので描画は変わらず、「取り込んだ HTML をそのまま保つ」（[ADR 006](../../spec/adr/006-html-content-model.md)）の側に寄る
- 残件: `spec/adr/013` は不動点について何も書いていない。再サニタイズが 3 経路あることを踏まえると、規則の正典に 1 行あってよい

---

## ADR-079: `ALLOWED_SVG_ATTRIBUTES` から `xmlns` を落とし、空 prefix を「prefix 無し」と読む

### Context

parse5 は foreign content の裸の `xmlns` を `{ prefix: "", name: "xmlns" }` として持つ。`attributeName` は `prefix === undefined` でしか prefix 無しと判定しないので、この属性の名前は `":xmlns"` になっていた。帰結が 2 つある。許可リストの `"xmlns"` は決して一致せず**到達不能**（ADR-011 が「`HtmlProcessor` は `xmlns` を落とす」と決めて `asStandaloneSvg` に復元させているのは、この事故の上に乗って正しく動いていた）。そして AC-3 の除去一覧に `:xmlns` という存在しない属性名が、インライン `<svg>` を含む本文を保存するたび出ていた。

### Decision

**落とす側で確定する。** `ALLOWED_SVG_ATTRIBUTES` から `"xmlns"` を削り、`attributeName` は空 prefix を prefix 無しとして読む。

- 落とす側が正しいのは ADR 011 が既に決めている。`spec/adr/013` の属性表に名前空間宣言の行は無く、`spec/usecases/storage.md` の `storeMedia` 手順 4 も「`process` は XML 名前空間の宣言を落とす」を前提に `asStandaloneSvg` の復元を書いている。許可側へ倒すと、この 2 つと ADR-011 の選択（案 2）を同時にひっくり返すことになる
- `attributeName` の修正は許可判定と報告名の両方に効く。`:xmlns` のまま `xmlns` だけ許可リストから消しても、利用者に見せる名前が壊れたままになる

`xmlns` を報告しない案（宣言は装飾ではないので黙って落とす）は採らない。AC-3 は「除去された要素・属性の一覧」であり、除去したものを隠す例外を 1 つ作ると、次の例外の線引きが要る。

### Consequences

- 良い点: 許可リストが「書いてあるものは到達する」状態に戻る。到達不能な行が 1 つ減る
- 良い点: 一覧に出る名前が実在する属性名になる（`xmlns` / `xmlns:xlink`）
- 良い点: `xml:space` のように本当に prefix を持つ属性の名前は変わらない
- トレードオフ: インライン `<svg>` を貼るたび除去が 1〜2 行出る。装飾は失われない（宣言は本文断片では不活性）が、利用者から見れば「何も壊れていないのに除去された」と読める行である


---

## ADR-080: 孤児掃引の 1 turn は「読む行数」と「読むノート数」の 2 つで有界にし、失敗した turn は位置を捨てない

### Context

ADR-075 が参照元に保持中の版を足したあと、1 turn の CPU の根拠が実態から外れた。`ORPHAN_MEDIA_BATCH_SIZE`（100）が縛るのは**読む行数**だけで、費用がかかるのは本文解析であり、その回数は**ノート数**に従う。ADR-075 はノート単位のメモ化でこれを抑えたつもりだったが、メモ化は上限ではない — ページが 100 件のファイル 100 ノートに散れば何も再利用されず、1 turn の解析は最大 2,100 本（`NoteHtml` は 800,000 バイトまで）になる。走査順は `createdAt` なので、複数ノートを並行して編集している scope ではページは素直に散る。

そのうえ ADR-076 の「失敗したら翌日へ張り直す」は payload の位置を**捨てて**張り直していた。恒久的に失敗するページ（毒された本文、読めない行）が走査の手前にあると、毎日そのページを先頭から読み直して落ち、その後ろの孤児に永久に到達しない。ADR-076 が避けたはずの「回収が止まる」がカーソル側で再発していた。

### Decision

- **`ORPHAN_MEDIA_NOTE_BUDGET = 5` を足す。** 1 turn が本文を読むノート数の上限で、ノートあたり最大 `RETENTION + 1` 本の解析なので 1 turn の解析は 105 本に収まる。版を数える前の「1 候補につき 1 解析」（100 本）と同じ桁で、`ORPHAN_MEDIA_BATCH_SIZE` が選ばれた根拠に揃う。読みの回数は**試行**で数える（失敗した読みも 1 と数える）ので、同じノートを何度も読み直す毒行でも上限が効く
- **予算で打ち切った turn も継続を張る。** 位置は「判定し終えた最後の行」であって「ページの最後の行」ではない。位置は必ず前進するので、打ち切りは取りこぼしではなく後回しになる。継続の条件は「満ページ」から「満ページ **または** 予算切れ」へ広がる
- **失敗した turn は開始位置を残して翌日へ張り直す。** `nextCursor` にも同じ位置を返す。周期的な全走査なので、位置を保っても短いページを引いた時点で先頭へ戻る機会は残る

### Consequences

- 良い点: 1 turn の CPU が「行数 × ノート数」の 2 つで有界になり、`spec/platform/index.md`「実行予算と分割単位」の 100 files（イベント生成量が根拠）と CPU の根拠が別々に立つ
- 良い点: 恒久的に失敗するページの後ろへ到達できる。失敗が費やすのは 1 日であって走査位置ではない
- トレードオフ: ノートに散ったページは 1 turn で読み切れず、turn 数が増える。継続は直後（`dueAt: now`）に張るので日数は増えない
- トレードオフ: 予算は定数で、`limit` に比例しない。`limit` を小さくした呼び出しでは予算に届かないだけなので害はない
- 併せて `stored_files_purpose_created_idx` を `(purpose, created_at, id)` にした。ADR-059 のキーセットは `(created_at, id)` 順で `created_at = ? AND id > ?` を継続条件にするので、`id` を持たない index では同時刻の行の tie-break が一時 B-tree に落ちる
- 追随が要る: `spec/database/index.md` の索引一覧（`stored_files_purpose_created_idx` の列）と `spec/testcases/storage/collectOrphanMedia.md`（予算で打ち切る行、失敗 turn が位置を保つ行 = TC-storage-259）、`spec/inventory/test.md` の TC-storage 行。本ユニットは `spec/usecases/storage.md` 以外の spec を触れないため未反映

---

## ADR-081: ゴミ箱のノートへのメディアのアップロードは `NoteIsTrashed` で拒む

### Context

`storeMedia` の `resolveEditableNote` は route の `purging` / tombstone と `canEdit` は見るが `lifecycle` を見ていなかった。`NoteAccessPolicy.evaluate` は**所有者本人**の trashed ノートに `canEdit: true` を返す（trash の壁は所有者以外の経路にしかない）ので、ゴミ箱のノートへのアップロードが成功して `StoredFile` が 1 行増える。一方で本文側は `application/note/editing.ts:ensureNotTrashed` が `BusinessRuleError(NoteIsTrashed)` を返すため、保管したメディアを本文へ入れる手段が無い。容量だけ占めたまま、完全削除か 30 日後の孤児回収まで残る。編集フローの前半（保管）と後半（本文）で lifecycle の扱いが割れていた。

`NOTE_NOT_FOUND` に畳む案もあったが、ゴミ箱のノートの存在は所有者自身には見えている（ゴミ箱の一覧に並ぶ）ので、隠す相手がいない。

### Decision

`resolveEditableNote` が `canEdit` の判定の直後に `ensureNotTrashed` を通す。本文側と**同じ関数**を呼ぶので、判定が 2 つに分かれて drift することがない。返り値の型も `ActiveNote` に狭まる。

拒否の順序は「不在・権限なし（`NOTE_NOT_FOUND`）→ ゴミ箱（`NoteIsTrashed`）」で、`note/editing.ts` の固定順と同じである。

### Consequences

- 良い点: 編集フローの前半と後半が同じ lifecycle の門を通る。入れられない本文のためにメディアが容量を食う経路が閉じる
- 良い点: 画面には本文の保存と同じエラーが出るので、利用者に見える説明が 1 つで済む
- トレードオフ: Storage のユースケースが Note のエラーコードを投げる。`accessControl` を既に借りている経路なので依存は増えないが、`storeMedia` のエラー表に Note 由来の行が 1 つ増える
- 追随済み: `spec/usecases/storage.md#storeMedia` の手順 1 とエラーケース表
- 追随が要る: `spec/testcases/storage/storeMedia.md`（TC-storage-260）と `spec/inventory/test.md`

---

## ADR-082: 編集島の「版を進めうる往復」は判別ユニオン 1 つで表し、入口を 1 か所に絞る

### Context

P-12 の島は版を握る唯一の主体だが、版を進めうる往復は 3 つの pending フラグに分かれていた — `isSaving`（自動保存・明示保存の transition）、`isBusy`（モード切替・破棄・版の復元・競合の解決・メディアの保管）、`isSubmitting`（`useActionState`）。自動保存の停止条件は `isSaving` しか見ておらず、依存配列にも残り 2 つが無い。

そのため次が同時に走る。

1. **破棄**: 「破棄」は `dirty` のときだけ押せるので、押した時点で自動保存タイマーは必ず生きている。ADR-071 で破棄は `readNoteEditStateFn` の往復になったので、この往復が残りタイマーより長いと**破棄対象の本文がサーバーへ書き込まれ**、戻ってきた再シードが「いま保存された内容」を正本として載せ直す。画面上も破棄は起きない
2. **明示保存**: `commit(true)` の `setStatus({kind:"saving"})` で effect が張り直され、`dirty` はまだ下りていないのでタイマーが 1 本増える。往復が 1.5 秒を超えると同じ `versionRef.current` で 2 本目が飛び、後着が偽の競合になる
3. **版の復元**: `restore` は `dirty` を要件にしないので未保存でも押せる。2 往復のあいだに自動保存が入ると、復元前の内容が復元後の版の上に書かれる

ガードを 3 つ並べる直し方もあるが、「どれとどれが同時に走ってよいか」が型に現れないままなので、往復を 1 つ足すたびに同じ書き落としが起こりうる。

### Decision

版を進めうる往復を判別ユニオン `EditorActivity`（`idle` / `saving` / `reseeding` / `restoring`）1 つで表し、`runExclusive` を唯一の入口にする。`idle` からしか入れず、入れなかった側は何もしない（`null` を返す）。占有の判定は同じ tick で決まる必要があるので判定の正本は ref に置き、state 側は表示と effect の依存のために持つ。

- 自動保存のガードと依存配列は `busy`（= `activity.kind !== "idle" || isSideBusy || isSubmitting`）1 つで置き換える。往復の開始で保留中のタイマーが落ち、落ちる前に発火しても `runExclusive` が占有を取れずに空振りする（二重の歯止め）
- `busy` の宣言は自動保存 effect より前へ移す（`useActionState` ごと繰り上げる）
- メディアの保管と版一覧の取得は版を進めないので、別の `useTransition`（`isSideBusy`）に残して並行を許す
- 「保存して切り替える」は往復 2 つなので、占有を 1 つずつ順に取る（`await` で直列に並べる）

### Consequences

- 良い点: TC-10 の破棄が遅い回線でも成立する。破棄・明示保存・版の復元・競合の解決のどれと自動保存の組み合わせでも、版が枝分かれしない
- 良い点: 往復を足すときはユニオンに 1 行足すことになり、ガードの書き落としが起こらない
- トレードオフ: 往復中に押された保存は静かに落ちる（`null`）。ボタンは `busy` で無効なので通常は到達しないが、到達しても「何も起きない」だけで、走っている往復が同じ内容を保存している
- トレードオフ: `status.kind === "saving"` と `activity.kind === "saving"` の 2 つが残る。前者は P-12 の状態表（表示）、後者は占有（進行）で、`commit` は必ず後者の中から呼ばれるため食い違わない

---

## ADR-083: ビジュアルモードの「いま面が持っている本文」は経路表を `baseline` へ当て直して組む

### Context

ビジュアルモードの面は本文 state を動かさない（動くのは経路表 `visualCurrent` だけ）。そのため `body` をそのまま「面が持っている本文」として使う経路が 3 つとも壊れていた。

- **退避**（ED-08）: `writeDraft` が書くのは編集前の本文そのもので、`draft.html !== savedBody` も成立しないため復元の提案すら出ない。再試行を押さずに画面を離れると編集は消える
- **ダウンロード**（権限喪失）と**競合の「自分の内容で上書きする」**: どちらも編集を 1 文字も含まない

逆向きの穴もある。`commit` のビジュアル分岐は `diffTextNodeEdits` しか送らないのに、直後の `settleSaved` を無条件に呼ぶので、`body` が経路表と無関係に動いていても「保存済み」になる。`body` が面の外から動く経路は 2 つ（退避の復元、競合の上書き）あり、どちらも**利用者が明示的に選んだ内容が 1 度もサーバーへ送られないまま無言で消える**。

### Decision

`composeBody()` を「いま面が持っている本文」の唯一の定義にする。ビジュアルモードでは `composeEditedHtml(baseline, visualCurrent)` — 面と同じ `baseline` を同じ走査（`collectEditableTextNodes`）で数えて経路表を当て直す — を返す。退避・ダウンロード・競合の上書き・`commit` の全部がこれを読む。

`commit` のビジュアル分岐は `body === savedBody`（面の外から本文が入っていない）を条件に付ける。

- 満たすとき: これまでどおり経路単位で送り、確定値は `body` のまま
- 満たさないとき: 経路では表せないので `updateNoteBody` で丸ごと送り、そのあと `readNoteEditStateFn` で面ごと正本を載せ直す（送った内容とサーバーの木が噛み合わないままだと、次の編集が全件 `contentChanged` に落ちる）

サニタイズ通知（`removed`）と skip 通知（`skipped`）は `commit` の最後で必ず両方置き直す。どちらも直近の保存結果を指すので、本文を送らなかった保存（タイトルだけ）でも前回の結果を残さない。載せ直しの枝より後に置くのは、`replaceBody` が通知を畳むためである。

### Consequences

- 良い点: ED-08 の「保存済み / 未保存」が実態と一致する。退避の復元と競合の上書きは、ビジュアルモードでも必ずサーバーへ届く
- 良い点: TC-23（退避と復元の提案）がビジュアルモードでも成立する
- トレードオフ: 面の外から本文が入ったあとの最初の保存だけ 2 往復（保存 + 引き直し）になる。到達するのは退避の復元と競合の上書きの直後だけ
- トレードオフ: `composeEditedHtml` は `template.innerHTML` の往復なので、属性の引用符など直列化の揺れが入りうる。`dirty` の判定には使わない（判定は `body` と `savedBody` の比較のまま）ので、揺れが自動保存を誘発することはない

## ADR-084: scope cleanup の `note` 成分は「列挙が尽きた」ではなく「止まった purge を持ち回れなくなった」で ack する

### Status

Accepted

### Context

`deleteNotesForOwner` は `note` 障壁の唯一の ack 元である。ack の条件は `listByOwner` の総件数を今回消せた件数と比べるだけで、`spec/usecases/note.md#deleteNotesForOwner` の「全 purge operation が tombstone へ到達したことを確認して ack する」と食い違っていた。そこへ 2 系統の流入がある。

1. `purgeNote.resumeInternal` が `beginPurge` の `NotFoundError` と `ConflictError` を同じ `null`（＝このコマンドにやることは無い）に畳んでいた。`ConflictError` は「別の operation が `purging` の route を握っている」「作成が `reserved` のまま」であって、ノートが消えたことを何も意味しない。呼び出し側は「例外を投げずに返った」を purge 済みと数えるので、本文ごと残ったノートを削除済みと数えて ack していた。
2. `purgeNote` は local delete の commit 後に停止すると route を `purging` のまま残す。その時点でノート行は消えているので次の turn の `listByOwner` には現れず、`resolve` は `purging` を隠し、`purging` 行を列挙する手段は無い。つまり止まった purge は**どの列挙からも到達できない**まま、次の turn が「列挙が空」を根拠に ack してしまう。閉じた barrier は後続の cleanup command を `assertOwner` で拒むので、この ack は取り消せない。

### Decision

- `resumeInternal` は `NotFoundError`（route 行が無い＝ノートも無い）だけを `null` に畳み、`ConflictError` は送出する。
- `deleteNotesForOwner` は、purge が失敗したノートについて `NoteRouteStore.resolve` を 1 度引き、`null`（＝どの列挙からも見えない）なら `{ noteId, expectedVersion }` を継続要求の payload に載せて次の turn へ持ち回る。次の turn はページと持ち回り分を併せて駆動する。
- ack は「ページの列挙が尽き（`page.count <= ページ由来の purge 済み件数`）かつ持ち回る対象が 0 件」の turn だけが返す。
- 「対象があるのに 1 件も消せなかった」＝ backoff の枝から、**その turn で新たに持ち回る対象が生まれた場合**を除く。`backoffOrSchedule` は既存行の payload を書き換えない契約なので、そこへ落とすと新しい ID がどこにも残らないためである。1 つのノートが「新たに持ち回る対象」になるのは高々 1 度なので、この例外は継続を無限には増やさない。

持ち回る版を payload に載せるのは、route が閉じているあいだノートを編集できる主体が居らず、止まった turn が読んだ版がそのまま有効だからである。local delete が commit 済みなら再開時に行が無く、版は参照されない。

### Alternatives

- **ポートに「`purging` の route を列挙する」を足す**: 台帳をアダプター側に置けるが、グローバル route store に scope 横断の走査を持ち込むことになり、目標プラットフォーム（shard 化した route）で最も高くつく操作を新設する。継続 payload は既にこの turn 専用の器としてあるので採らなかった。
- **spec を実装に寄せ、「列挙が尽きたら ack する / 中断した purge は回収しない」と書く**: AC-9 / AC-10（完全削除で公開・共有 URL から消える）と退会のデータ消去そのものが破れるため採れない。

### Consequences

- 良い点: 止まった purge が残るあいだ `note` は ack されず、退会は `running` のまま可視化される。回復不能な「ack 済みだがノートは残っている」状態にならない。
- 良い点: 他人の operation が握る route が「削除済み」に化けない。`emptyTrash` はこれを飛ばして続け、`purgeExpiredTrash` は記録して次の turn へ回す。
- トレードオフ: 継続 payload が scope のノート件数と同じオーダーまで伸びうる（1 turn で増えるのは失敗した件数だけ、`continued` の turn 数は総ノート数で頭打ち）。
- トレードオフ: `backoffOrSchedule` が既存行の payload を保つため、backoff の枝で書こうとした持ち回りは既存行の持つ集合の部分集合であることに依存している。この不変条件が崩れるのは backoff の枝に「新たに持ち回る対象」を通したときだけで、上の例外がそれを禁じている。

---

## ADR-085: ゴミ箱の判定材料は `getNote` の `trashedAt` に載せ、画面の入口で終端させる

### Context

`NoteAccessPolicy` の所有者経路はゴミ箱の壁より手前で `canEdit: true` / `canDelete: true` を返す（ゴミ箱の壁は他人にしかない）。`getNote` にもゴミ箱の除外は無く、出力 DTO はゴミ箱かどうかを一切語らなかった。結果、削除したノートの `/notes/:noteId` を開き直すと通常どおり描かれ、タイトルのインライン編集も「削除...」も出た。編集画面（P-12）に至っては書けてしまい、最初の自動保存が `NOTE_IS_TRASHED` で落ちて初めて権限喪失の表示に相乗りしていた。`spec/pages/index.md#P-11` の状態表は「見つかりません | 不在・**削除済み**・権限なし」と定めており、その状態へ到達する経路が無かった。

案は 2 つ。`getNote` をゴミ箱で `NOTE_NOT_FOUND` に畳む、あるいは判定材料を DTO に足して画面が終端させる。

### Decision

`NoteDetailView` に `trashedAt: Date | null` を足し、`NoteDetail` / `NoteEditor` の入口が非 `null` なら `NotFoundState` を返す。

`getNote` 自体は畳まない。所有者がゴミ箱のノートを読めること（`spec/testcases/note/getNote.md`「ゴミ箱のノート（所有者） — 取得できる」）は既に決まっており、ゴミ箱一覧・完全削除・復元がその読み取りの上に乗る。畳むと、ゴミ箱を扱う画面が別の読み取りを要求することになる。「読めるが、この 2 画面では終端状態」という線引きは画面側の判断であり、DTO はその判断に要る事実だけを運ぶ。

権限で代用はできない。所有者のゴミ箱のノートでは 3 つの `permissions` がすべて真のままだからで、これはテストにも書いてある。

### Consequences

- 良い点: P-11 / P-12 が spec の定める「削除済み」へ到達する。ゴミ箱のノートで書けてしまう窓が閉じる
- 良い点: `getNote` の契約は動かないので、ゴミ箱一覧や復元の経路は影響を受けない
- トレードオフ: 「読めるが開けない」という判断が画面側に 2 か所ある。どちらも入口 1 行で、判断の根拠（`trashedAt`）は 1 つ
- トレードオフ: P-12 の状態表にゴミ箱用の行は無いままで、そこは「見つかりません」に寄せている（P-11 の表がその文言を持つ）

---

## ADR-086: ゴミ箱の往復の版は応答が運ぶ — `TrashedNoteView` / `RestoredNoteView` に `version` を足す

### Context

`TrashedNoteView` は `noteId` / `trashedAt` / `purgeAfter` しか返さなかったので、詳細も一覧も削除のたびに `readNoteEditStateFn`（＝ `getNote` 一式）をもう 1 往復投げて「元に戻す」に要る版を取り直していた。`RestoredNoteView` も版を返さないため、詳細画面は `versionRef.current = restoreVersion + 1` と実装の内側を推測していた。

`restoreNote` は今日たしかに `save` を 1 回しか行わないが、それは DTO が保証していることではない。`trashNote` の側は既に反例を持っており、変換ジョブを強制終端した turn は同じ transaction で `markConversionFailed` も書くので版が 2 つ進む。

### Decision

両方の DTO に `version` を足し、**ドメインが進めた版をそのまま返す**（アプリケーション層で数字を作らない）。画面は追加の読み取りも推測もやめる。

`RestoredNoteRevisionView` が同じ理由で既に `version` を返しており、ゴミ箱の 2 つだけが非対称だった。既にゴミ箱にあるノートを再度削除する idempotent な経路では、書き込みが無いので現在の版をそのまま返す。

### Consequences

- 良い点: 削除 1 回あたりの往復が 2 から 1 に減る。取り直しの失敗で「元に戻す」が出せない枝も消えた（`TrashedState` の `restoreVersion` が `number | null` から `number` になった）
- 良い点: 復元後もタイトルの自動保存が正しい版で続く。`restoreNote` の保存回数が増えても画面は壊れない
- トレードオフ: DTO が 1 フィールドずつ広がる。運ぶのは `number` 1 つで、`spec/usecases/note.md` の該当節に理由を書いた

---

## ADR-087: 持ち回る purge の ID は「検知した瞬間」に行へ書き、turn の精算は行を狭めるだけにする

### Status

Accepted

### Context

ADR-084 は「止まった purge を継続要求の payload で持ち回る」と決めたが、書く位置は turn の最後の 1 か所（`settle`）だった。`settle` の transaction は落ちうる（stuck purge を生んだ障害と同じ incident で十分ありうる）。落ちるとその turn が見つけた ID はどこにも残らない。以後:

1. local delete は commit 済みなので `listByOwner` に出ない
2. route は `purging` なので `resolve` にも出ず、`purging` を列挙する手段は無い
3. 次の turn（同じ行の再駆動でも、`cleanupDispatch` からの再配送でも）は `stuckPurges` を持たない

結果、次の turn は「列挙が空 ＝ scope が空」と読んで `note` 成分を ack する。ack は取り消せない（以後の cleanup command は `assertOwner` で拒まれる）ので、公開投影の行が残ったまま退会が完了する。ADR-084 が閉じたはずの窓が `settle` の失敗ぶんだけ開いたままだった。

[ADR 025](../../spec/adr/025-single-reference-runtime.md) がこの種の窓を受け入れたのは「失うのは行の武装だけで、同じコマンドの再配送が回復する」が前提である。ADR-084 の持ち回りはこの前提を満たさない — payload に載るのは**再配送では再構成できない**情報だからである。

### Decision

`isOutOfReach` が真になった瞬間、その場で小さな scope UoW を開いて `scheduled_tasks` の行を `schedule` で upsert する。`settle` は残件と持ち回りの最終形で行を精算するだけの役に落とす。

- 書く集合は「継続が運んできた対象 − この turn で purge できた対象 ＋ 新たに止まった対象」。継続が運んできた分を種にするので、ループ途中の書き込みが行の持つ集合を**狭めることはない**。狭める（purge できた分を落とす）のは `settle` だけで、その transaction を失っても実害は無い
- 書き込みは purge の外側で開く。1 件の purge は自分の transaction を持ち `run` の入れ子は禁止なので、既存の `run` の内側には置けない
- この upsert 自体が落ちた場合は log に残して turn を続ける。投げても同じ ID が書けないことは変わらず、残りのノートを purge する機会だけが失われるため

残余は消えない: purge の local delete の commit と、その停止を検知して行へ書くまでの間にプロセスが死ぬと ID はどこにも残らない。これは scope の route を走査する回収ドライバ無しには閉じられず（ADR-084 が棄却した案）、`spec/usecases/note.md#deleteNotesForOwner` の手順 4 と同じ節に「閉じ切れない残余」として明記した。

### Alternatives

- **`settle` を再試行する**: 応答喪失と区別できないので、成功した `settle` を二重に適用しうるうえ、プロセス死には効かない
- **turn の頭で「今から駆動する対象」を全部行へ書く**: 検知前に書けるが、まだ止まってもいない対象を持ち回ることになり、`backoffOrSchedule` の「既存行の payload を保つ」契約と組み合わさって、解消済みの ID が行に残り続ける

### Consequences

- 良い点: ADR-084 の主張（「持ち回る対象が 0 件の turn だけが ack する」）が `settle` の成否に依らず成り立つ
- 良い点: 検知時の書き込みは `schedule` なので、その turn が backoff に落ちても行は due のまま残り、次の turn が持ち回りを読み直せる
- トレードオフ: 1 turn で新たに止まった件数ぶんだけ scope transaction が増える。増えるのは失敗が起きたときだけで、1 ノートにつき高々 1 度である
- トレードオフ: 行が turn の途中で `pending` に戻る（`schedule` は lease を解放する）。同じ scope を同一 tick で二重に claim しない runner の性質と、2 系列が並走しても収束する ADR-084 の性質に依存している

---

## ADR-088: `purgeNote` の commit gate は「ノートが在ること」を先に確かめ、cleanup の所有はその後で問う

### Status

Accepted

### Context

`deleteLocally` は `assertOwner`（cleanup の所有）を `reclaim`（ノートの再取得）より先に呼んでいた。通常の駆動では差が無いが、resume 経路（route が `purging` で `resolve` に出ないノートを `beginPurge` の番兵世代で拾い直す経路）では意味が変わる。resume が返す plan は「local delete が既に commit しているかもしれない」状態を表すので、そこで所有を先に問うと、**ノートがもう無いのに** `ConflictError` が出る。`ConflictError` は ADR-065 の abortable refusal なので route が `active` へ戻り、消えたノートを指す route が永久に何も解決しない行として残る。さらに route が `active` に戻ると `isOutOfReach` が偽になり、次の turn がその ID を持ち回らずに ack しうる（ADR-084 / ADR-087 の窓に合流する）。

### Decision

`reclaim` を先に呼ぶ。`null`（＝ノートが既に無い）なら所有を問わずに forward-only 経路へ入り、ノートが実在した場合だけ `assertOwner` を問う。

abort は「削除しないという決定」に限るという ADR-065 の規則を、判定材料の取得順に反映しただけである。所有を失った cleanup がノートを消せないことは変わらない（実在するノートに対しては従来どおり `ConflictError` で拒み、route を返す）。route を閉じる前の入口では `admitInternal` が従来どおり所有を先に問うので、所有を失ったコマンドが route を新たに閉じることもない。

### Consequences

- 良い点: 「commit 後に abort しない」が resume 経路でも成り立つ
- 良い点: cleanup が中断され、その後で退会が中止された（barrier が消えた）場合でも、中断した purge は tombstone まで前進できる
- トレードオフ: 所有の確認が「ノートを読んだ後」に下がるので、所有を失ったコマンドでも `findById` 1 回ぶんは走る。route は既にこのコマンド自身の入口検査を通って閉じられているので、読める範囲は変わらない

---

## ADR-089: 保存が確定させるのは「送った写し」— 面の内容は `EditorSnapshot` からしか読めない

### Context

前ラウンドで塞いだ「送っていない内容を保存済みにする」欠陥（ADR-083）が、ビジュアル分岐の別の場所で再発した。送る差分は `await` の前に組むのに、適用済みの基準（`visualOriginal`）と `visualDirty` は `await` の**後**に `visualCurrent.current` を読み直して作っていた。面は保存中も凍らないので、往復のあいだに打った文字が「サーバーへ送られていないのに」新しい基準へ入り、`setVisualDirty(false)` が自動保存を止める。続く打鍵は `expected` がサーバーの持つ値と食い違うので全件 `contentChanged` に落ち、画面には原因と無関係な「反映できなかった編集があります」だけが出る。

HTML / WYSIWYG に同種の欠陥が無いのは、あちらが `await` の前に確定した値を `settleSaved` へ渡していたからにすぎない。つまり守られていたのは規律であって構造ではなく、分岐を 1 つ足すたびに同じ書き落としが起こりうる。

### Decision

「いま面が持っている内容」を読む手段を `takeSnapshot(): EditorSnapshot` 1 つに絞り、**確定（`settleSaved`）はその写しからしか作れない**形にする。

- `EditorSnapshot` は `title` / `body` / `textNodes`（経路単位で送れるときの経路表、それ以外は `null`）を 1 つの瞬間から取る。本文と経路表を別々の瞬間から読む書き方が存在しなくなる
- `settleSaved(sent, appliedTitle)` は写しと**応答のタイトル**だけを受け取る。`title` / `body` / `visualCurrent` の「いま」は読まない。ビジュアルの新しい基準は `sent.textNodes` であり、`setVisualDirty` は `diffTextNodeEdits(sent.textNodes, visualCurrent.current)` — つまり**送った値といまの値の差**がそのまま次の保存の対象として残る
- 経路単位で送れるか（ADR-083 の `body === savedBody`）の判定も写しを取る時点へ移す。`commit` は分岐の中で状態を読み直さない
- 退避・ダウンロード・競合の「自分の内容で上書きする」も同じ写しを読む（ADR-083 が `composeBody()` に集めた役割をそのまま引き継ぐ）

新規作成の初回保存が確定させるタイトルも同じ規則で応答の値にした（`createNoteWithBodyFn` に `title` を足す。版のための読み直しを既に行っているので往復は増えない）。送った生値を確定済みにすると、空タイトルのノートが一覧では「無題」なのに編集画面のタイトル欄だけ空のまま残る。

### Consequences

- 良い点: 往復のあいだの打鍵が消えない。ビジュアルモードでも次の自動保存が正しい `expected` で送る
- 良い点: 「送った値」と「いまの値」の取り違えが型の上で書けなくなる。保存の枝を足しても、確定に渡せるのは写しだけである
- トレードオフ: ビジュアルの確定で `body` state を写しの本文（`composeEditedHtml` の結果）へ揃える。`dirty` の基準を「送った内容」に保つための措置で、サーバーの正本とは別物である（`rememberSaved` の JSDoc がもともと宣言している性質）
- トレードオフ: `skipped` に落ちた経路も基準に取り込む。取り込まないと同じ編集が同じ `expected` で送り直され、二度と通らない保存を自動保存が繰り返す

---

## ADR-090: 編集島の活性は「版を進めうる往復」だけを見る

### Context

ADR-082 は往復を 2 種に分けた — 版を進めうる往復（`EditorActivity` / `runExclusive`）と、版を進めない往復（`isSideBusy`：メディアの保管・版一覧の取得。「並行してよい」と JSDoc で宣言）。ところが UI の活性は `busy = activity.kind !== "idle" || isSideBusy || isSubmitting` の 1 つだけを見ていたので、宣言した並行が画面上では起きない。とくに書式ツールバーの 6 コマンドとリンク挿入は `document.execCommand` で面の DOM を触るだけで**往復を 1 回も持たない**のに、1.5 秒ごとの自動保存のたびに暗くなる。面は保存中も打鍵を受け付けるので「打てるが太字にできない」という食い違った状態になっていた。

### Decision

`busy` を「版を進めうる操作を受け付けられないか」に限る（`activity.kind !== "idle" || isSubmitting || uploading`）。`isSideBusy` は入れない。

- `busy` を見るのは保存・破棄・モード切替・版の復元・競合の解決・WYSIWYG 警告の「了解して進む」だけ
- 書式ツールバー・メディア挿入・アップロードの「再試行」は `editable` だけを見る。変更は打鍵と同じく `body !== savedBody` として残り、次の保存が拾う
- 「版を復元」（一覧の取得）は `isSideBusy` だけを見る。落とすのは二重取得だけである
- アップロード中（`uploading`）は `busy` に畳む。本文に仮の要素が入ったまま保存・載せ直しをすると、`data-hollow-upload` が落ちた素の `span` が本文に残る。従来 `isSideBusy` が偶然担っていた歯止めを、理由のある条件へ置き換えた

### Consequences

- 良い点: JSDoc が宣言した並行が画面の挙動と一致する。自動保存のたびに書式が押せなくなる不整合が消える
- 良い点: 止める理由（版が枝分かれする / 仮の要素が保存される）と活性が 1 対 1 で対応する
- トレードオフ: 保存中に押した書式コマンドはその保存には乗らず、次の保存に乗る。打鍵と同じ扱いである

---

## ADR-091: 編集島のノートの同一性は判別ユニオンで持ち、版の sentinel を消す

### Context

`EditorTarget` は `new`（`noteId` も `version` も無い）と `existing`（両方ある）を型で分けているのに、島に入った直後に `noteId: string | null` と `versionRef = -1` という独立した 2 つの値へ崩れていた。以降の分岐はすべて `noteId === null` だけを見て、版の整合は人手の約束に依存する。`-1` は転送境界の `expectedVersion`（`z.number().int().min(0)`）が受け付けない値でもあり、届かないことは「型で無理」ではなく「読んで確かめた」に過ぎなかった。

### Decision

`NoteIdentity = { kind: "new" } | { kind: "existing"; noteId; version }` 1 本にする。書き戻しの入口は `rememberIdentity` だけで、ADR-082 の `activityRef` と同じ理由から判定の正本は ref（往復の中から次の `expectedVersion` を読むため）、state は描画のために持つ。版を読んでよいのは往復の中だけなので、描画側へ渡すのは `noteId` の派生値だけにする。

併せて `EditorTarget.styleMode` を落とした（島の中で 1 度も読まれず、`mayLoseDecoration` はサーバー側で畳んでいる）。

### Consequences

- 良い点: 「ID はあるが版が無い」「版だけある」が書けない。sentinel が消えたので転送境界に届く値が型で 0 以上に閉じる
- 良い点: 版を進める往復が識別子と版を同じ 1 つの値として持ち回るので、応答の版を書き戻し忘れた枝が読んで分かる
- トレードオフ: 版が進むたびに state 更新が 1 回入る（従来は ref だけで再描画しなかった）。自動保存の依存配列は版を見ないので、タイマーの張り直しは起こらない

---

## ADR-092: 未保存の本文を live DOM へ入れる 3 経路は同じ scrub を通す

### Context

`scrubForPreview` の JSDoc は「プレビューは live DOM なので、保存前の本文をそのまま渡すと `<img onerror>` のようなハンドラーがこの画面で走る」と危険を名指ししていたが、通していたのは HTML モードのプレビューだけだった。`WysiwygSurface` は `baseline` をそのまま `innerHTML` へ代入し、`VisualSurface` は `template.content` を shadow root へ移す。そして `baseline` に未保存の HTML が入る経路は実在する — 退避データの「復元する」。

### Decision

`scrubForSurface`（改名）を 3 つの面すべてに通す。木を受け取る形のままにしたのは、通す位置が面ごとに違うためである。

- `WysiwygSurface`: `baseline` をパースして scrub してから `innerHTML` に載せる
- `VisualSurface`: **経路を数え終えたあと**に scrub する。数える木がサーバー（`HtmlProcessor`）の見る木と 1 つでも違うと、編集が全件 `pathNotFound` に落ちる
- `HtmlSurface`: 構文補正の判定（scrub 前の直列化）を取ったあとに scrub する。scrub が落とした分を「構文を補正しました」として報せないため

落とす対象は保存時のサニタイズ（ADR 013 の許可リスト）が落とすものの部分集合なので、面が保存し直しても失われるものは無い（`script` / `iframe` / `on*` / `javascript:` はどれも許可リストに無い）。

### Consequences

- 良い点: 危険を明文化した JSDoc と実装が一致する。退避の復元で自分の書いた `on*` がこの画面で走ることが無くなる
- 良い点: 「未保存の本文が live DOM へ入る経路」を数えるとき、面の実装を読まずに `scrubForSurface` の呼び出し元を数えれば足りる
- トレードオフ: ビジュアルの面では、scrub で消えた要素の中にあったテキストノードが編集欄にならない（経路表には残るが、差分は生じないので送られない）。許可リストに無い要素の中身なので、保存しても残らない部分である

---

## ADR-093: `css.ts` の低レベル走査は 1 つのプリミティブに集約する（パーサーには置き換えない）

### Context

`filterCss` のエスケープ処理は 3 ラウンド続けて指摘された。ラウンド 001 で `\66 ixed` / `@\69 mport`（識別子のエスケープ）を `skipString` / `canonicalize` に入れたが、**文と規則を分割する側**（`scanTo` / `findBlockEnd`）には入らなかった。その取り残しで、`content:\";position:fixed` は `\"` が文字列の開始と読まれて終端子が見つからず、宣言全体が 1 つの `content` 宣言として素通りする（ブラウザは `\"` を識別子の一部として読むので `;` がそこで宣言を終える）。`background:url\(x;position:fixed`、`@import url\(a;.b{position:fixed}` も同じ根で、後者は逆向きに `.b` の規則ごと飲み込む。出荷アダプターを走らせて 5 パターンとも確認されている。

3 連続は「同じ原因の再発」ではない。ラウンド 002 は値の判定方式（否認→許可リスト。ADR-073）で字句とは無関係で、字句のクラスは 2 回である。それでも 2 回目が同じ場所に落ちたのは、**同じ規則を知っている必要のある走査が 4 つあり、そのどれかを直しても他が残る**構造だったからである。

`parse5` などの CSS パーサーへ置き換える案は採らない。`parse5` は HTML 用で CSS には効かず、CSS パーサーは新しい依存になる（`packages/core` は依存 3 つで Workers でも走る）。加えて ADR 013 は「壊れた CSS を拒否せず原文のまま運ぶ」「終端子は入力にあったものだけ書き戻す」（ADR-078 の不動点）を要求しており、正規化して書き戻すパーサーはこの不動点を壊す。

### Decision

**コメント・文字列・エスケープを認識する場所を `readLexeme` 1 つに集約し、`css.ts` のどの走査もそこを通す。** `canonicalize`（分類用の複製）、`scanTo`（文の分割）、`findBlockEnd`（ブロックの分割）、`filterCss` の先頭（文の前のコメント）、`skipString`（文字列の中のエスケープ）がすべて同じ関数を呼ぶ。`readLexeme` は「その位置が低レベルの字句なら、その正規形と次の位置」を返し、そうでなければ `null` を返す — 呼び手は「字句なら飛ばす、そうでなければ自分の文法を見る」だけになる。

不変条件は module の JSDoc に置く: **この module のどの走査もエスケープを 1 つの字句として消費し、`\` の次の文字はけっして構文にならない**。ADR 013 の CSS の節にも同じ規則を 1 段落で書く（正典は spec 側）。

個別のパターンを潰す形は採らない。次に走査が 1 つ足されたとき、同じ穴がまた開く。

### Consequences

- 良い点: 「引用符のエスケープ」「括弧のエスケープ」の両方向（素通り・飲み込み）が同時に閉じる。新しい走査を足しても、`readLexeme` を通す限り 3 規則が自動で効く
- 良い点: 依存は増えない。`filterCss` の出力は入力の部分文字列のままなので、ADR-078 の不動点も崩れない（回帰表とテーブルの不動点入力にエスケープの行を足して確認した）
- トレードオフ: `readLexeme` は 3 種類を 1 つの戻り値型で表すので、呼び手のうち `filterCss` だけが `kind` を見る（文の前に置けるのはコメントだけ）。判別が要るのはここ 1 か所だけなので、型で分けるより安い
- 変異スポットチェック: `readLexeme` からエスケープの分岐を落とすと、新しい 6 ケースと既存の識別子エスケープの 1 ケースが red になる

---

## ADR-094: `<svg>` の内側の許可リストは、要素の名前空間ではなく祖先で決める

### Context

`desc` / `title`（と非許可の `foreignObject`）は HTML の integration point で、配下では HTML の解析が再開する。`sanitizeNode` は要素ごとに `isSvg(node)` を見ていたので、`<svg><desc>…</desc></svg>` の内側だけ **`ALLOWED_ELEMENTS`（HTML の表）全体**が通っていた。帰結は 2 つある。

- ADR 013 が SVG の部分集合から外した `<style>` が `<desc>` 経由で残る。保管した `.svg` を XML として読むとそれは SVG 名前空間の `style` 要素になり、CSS が文書全体に効く
- `img` / `br` のような void 要素は閉じタグ無しで直列化される。XML から見ると開始と終了の不一致で、その `.svg` は 1 ドットも描かれない（レビューで実測）

### Decision

**`sanitizeNodes` / `sanitizeNode` に「`<svg>` の下にいるか」を持ち回り、その内側では要素の名前空間によらず `ALLOWED_SVG_ELEMENTS` だけを許可リストとする。** 属性の判定も同じフラグを使う。載らない要素は SVG 名前空間の未許可要素と同じく**内容ごと**除去する。

規則を 1 つにするために、テキストだけを残す（子要素を昇格させる）扱いは採らない。`<desc><style>…</style></desc>` の CSS 原文が地の文として残るのは避けたいし、「`<svg>` の内側は SVG の表がすべて」という 1 文で言い切れる形のほうが、integration point という細部を知らない読み手にも守れる。

### Consequences

- 良い点: ADR 013 の「インライン `<svg>` と保管する `.svg` は同じ表を使う」が、integration point の穴を含めて本当になる
- 良い点: 保管する SVG の XML 適合が、拒否ではなく**サニタイズ**で成立する経路が増える（`<desc>` に `<br/>` を持つ正当な SVG は、拒否されずに `<br>` だけ落ちて保管される）
- トレードオフ: `<desc><b>説明</b></desc>` のようにテキストを要素で包んでいた場合、その説明文は失われる（要素ごと落とすため）。`desc` / `title` は代替テキストであり、装飾を持つ意味は薄いと判断した
- 変異スポットチェック: フラグを外して `isSvg(node)` に戻すと、integration point のケースが red になる

---

## ADR-095: 保管する SVG は「XML として整形式か」を入口と保管直前の同じ述語に問い、入れ子は 64 段で切る

### Context

ADR-074 は「単体の 1 文書であること」を保管直前に確かめる形にしたが、見ていたのは**ルートの外側の形**（根が `svg` で閉じ、外に空白しか無い）だけだった。ルートの内側が XML として読めるかは誰も見ておらず、`process` が返すのは parse5 の **HTML 直列化**なので、次がそのまま `image/svg+xml` として保管されていた（レビューが `xmllint` で実測）。

- U+00A0 は `&nbsp;` に直列化される。DTD を持たない `.svg` に `nbsp` は定義されておらず、未定義実体は致命的エラー
- `<desc>` の integration point 経由の void 要素（ADR-094）
- タブ・CR・LF 以外の C0 制御文字（XML の `Char` に無い）

さらに受理判定（`opensAsSvg`）が先頭 4096 バイトの**プロローグしか読まない**ことから、W-001 の 2 症状が出ていた。閉じない整形要素とブロック要素を交互に並べた入力は、HTML パーサーの active formatting elements の再構成で**出力が要素数の二乗**に膨らむ（実測: 3 KB → 446 KB、6 KB → 1.8 MB、128 KB → OOM）。128 KB の SVG が Note の語彙の `ContentTooLarge` で落ち、`spec/domains/storage.md` の「6 倍」という上限の根拠そのものが成立していなかった。深い入れ子（6 KB で 1,000 段）は素の再帰の `sanitizeNodes` を溢れさせ、`toSerialized()` を持たない `RangeError` になっていた。

### Decision

**判定を「XML として整形式で、根が `svg` ひとつの文書か」に強め、受理の入口（`UploadValidationPolicy`）と保管直前（`storeMedia`）が同じ 1 つの述語（`readSvgDocument`）を呼ぶ。** 見るのは、根の外に XML の `S` とプロローグしか無いこと・タグが名前まで一致して閉じること・名前が XML の `Name` で属性値が引用されその中に `<` が無いこと・実体参照が定義済み 5 つか妥当な数値参照であること・文字が XML の `Char` であること・**入れ子が 64 段以内**であること。あわせて `storeMedia` は判定の前に `&nbsp;` を `&#160;` へ書き換える（直列化が出しうる非定義の参照はこれ 1 つで、残りは XML の定義済みに収まる）。

入口でも問うのは、ADR-074 が「判定の対象と保管される実体が違う」として退けた案 1 の**やり直しではない**。保管直前の検査はそのまま残す（`process` の出力は入力とは別物なので、そちらにも問う必要がある）。入口に置く理由は別で、**壊れた入力をサニタイザーへ渡さないこと自体が目的**である。膨張率を定数にできるのは整形式な入力に限られ（複製は入れ子が壊れているときだけ起きる）、それが 128 KB という上限の根拠を成立させる。`.svg` は XML として解析される以上、整形式でないものはブラウザも開けないので、入口で断っても描けたものは失わない。

深さの 64 は、実在の図版が数段しか入れ子にしないことと、1,000 段でスタックが溢れる実測の両側から取った。`process` を明示スタックへ書き換える案は、note 本文（2 MB）側にも同じ再帰があるためこのユニットの範囲を超える。SVG の入口を有界にするほうが小さい。

### Consequences

- 良い点: 保管された `image/svg+xml` が XML として開けることが、「ルート外の形」ではなく**整形式性そのもの**として担保される。同じ述語が両端に効くので、片側だけ緩いという状態が作れない
- 良い点: `MEDIA_SVG_MAX_BYTES` の「6 倍」の根拠が本当になる。受理された SVG が `NOTE_CONTENT_TOO_LARGE` や `RangeError` で落ちる経路が閉じる
- トレードオフ: **整形式でない `.svg` は拒否される**（これまではサニタイズして保管していた）。ブラウザも開けないファイルなので描画は失わないが、「サニタイズで直して受け入れる」側には倒していない。エラーは `UnsupportedMimeType` で、Storage の語彙のまま
- トレードオフ: 入口が本文全体を復号して走査する（上限を超える長さのものは除く — どのみち `FileTooLarge` になり、サニタイザーへ渡らないため）。128 KB の 1 パスなので費用は小さい
- 残件: note 本文（`updateNoteBody` の HTML モード、2 MB）は同じ二乗の膨張と深い再帰にいまも露出している。SVG の入口はこれを塞がない。閉じるには `process` 側を有界にする必要があり、別スライスの課題として残る
- 変異スポットチェック: 深さの境界を +1 に動かすと 65 段のケースが green になって red 化し（境界 ±1）、`&nbsp;` の書き換えを外すと U+00A0 のケースと膨張のケースが red になる

---

## ADR-096: `url(` の内側は字句規則が止まる — `readLexeme` が url-token を 1 つの字句として返す

### Context

ADR-093 が「コメント・文字列・エスケープを認識する場所を `readLexeme` 1 つに集約し、`css.ts` のどの走査もそこを通す」と決め、実際にエスケープの穴は閉じた。ところがその一本化が逆向きに効いた。CSS Syntax の `consume-a-url-token`（§4.3.6）は、`url(` の直後が引用符でないときコード点をそのまま `)` まで読む。コメントと文字列の解決は `consume-a-token` の入口でしか起きないので、**`url(` の内側の `/*` はブラウザにとってコメントではない**。しかし `readLexeme` は位置しか見ないため、そこでもコメントを認識して `*/`（無ければ入力末尾）まで読み飛ばし、`;` を見失う。

出荷アダプターを走らせて 5 例とも確認されている（`background:url(x/*);position:fixed` / `background:url(/*)*/;position:fixed` の各 2 形と `@media` 入れ子）。いずれも `removed: []` で入力のまま出てくる。ADR 013 の中核防御（Shadow DOM はレイアウトを隔離しないので `<style>` 1 個で公開ページ全面を覆える）がそのまま破れる。`url("x")` は文字列として正しく読めているので、穴は**引用符なしの url-token に限られる**。

### Decision

**`readLexeme` に url-token の分岐を足し、`url(` から `)`（無ければ入力末尾）までを 1 つの字句として返す。** その内側で解決するのはエスケープだけで、コメントも文字列も字句にならない。`url` かどうかは**エスケープ解決後の識別子**で判定する（`\75 rl(` もブラウザは url-token として読む）。`(` の直後（空白を挟んでよい）が引用符のときだけは `null` を返して従来の関数トークンの扱いに落とす — そこはブラウザも字句解析を再開する分岐である。

識別子は `(` から後ろへ辿るのではなく `start` から前向きに読む。走査は 1 文字ずつ進むので必ず識別子の頭に立つ位置で呼ばれるし、`myurl(` のように途中から一致してしまう過剰判定は「ブラウザが隠している終端子を走査が見る」向きにしか効かない（除去が増える側で、素通りは作らない）。

ADR-093 の不変条件は壊さない — url-token も**同じプリミティブが返す 1 つの字句**であり、`canonicalize` / `scanTo` / `findBlockEnd` / `filterCss` は「字句なら飛ばす」という既存の呼び方のままである。個別パターン潰しや CSS パーサーの導入は ADR-093 が退けた理由（次の走査が同じ穴を開ける / 依存が増え、正規化して書き戻すと ADR-078 の不動点が壊れる）がそのまま当てはまる。

ADR 013 の CSS の節は「コメント・文字列・エスケープの 3 つ」と書き切っており、この反例はその 3 つの列挙に載っていない。**4 つ目として「引用符なしの `url(` の内側では前 2 つが効かず、`)` までが 1 つのトークンである」を足し**、「認識する場所は 1 か所」の条項をその 4 つ目も含む形に改めた（正典は spec 側）。

新しい 9 ケースには TC を新設せず、既存の TC-note-705 / 707 / 710 を綴りの別形として再利用した — エスケープの綴り（ADR-093）と同じ扱いで、`spec/testcases/note/updateNoteBody.md` に定義の無い台帳行を作らないためである。

### Consequences

- 良い点: レビュアーが実測した 5 例がすべて `position` の除去に至る。`url(` の内側にコメント記法を混ぜて `;` を隠す経路が閉じる
- 良い点: 出力は入力の部分文字列のままなので ADR-078 の不動点は崩れない（未終端の `url(` を含む 2 入力を不動点の一覧に足して確認した）
- 良い点: `url(a;b)` のように url-token の内側に `;` を持つ装飾は、括弧深度ではなく字句として守られる。1 字句なので入れ子の `(` に依存しない
- トレードオフ: `myurl(` / `üurl(` のような綴りは url-token として過剰に一致する。ブラウザは関数トークンとして読むので判定はずれるが、ずれる向きは「宣言の切れ目を余分に見る」= 除去が増える側だけで、`position` の素通りは作らない
- 変異スポットチェック: `readLexeme` から url の分岐を落とすと新しい 6 ケースが red、引用符の判定を反転すると同じ 6 ケースが red、url-token 内のエスケープの分岐を落とすと `url(a\);…)` のケースが red になる

---

## ADR-097: `NoteOwner → ScopeKey` の写像は `application/scope.ts` に 1 本だけ置く

### Context

「ノートの owner はその scope object を名指す」という 3 行の三項演算子が 7 箇所に散っていた（`note/{createBlankNote,moveNote,listNotes,listTrashedNotes,emptyTrash,editing}.ts` と `cleanup/notePurgeFanOut.ts`）。うち唯一 export されていたのは ADR-020 で fan-out のために作った `notePurgeFanOut.ts` の `scopeOfNoteOwner` で、note 側からは参照しづらい位置にあった。写像そのものは自明だが、決定の中身は `spec/platform/index.md` の scope 分割そのもので、7 箇所に散らして良いものではない。

### Decision

**`ScopeKey` の持ち主である `application/scope.ts` に `scopeOfNoteOwner` を 1 本置き、7 箇所すべてがそれを呼ぶ。** cleanup 配下ではなく scope 配下にしたのは、写像の主語が fan-out ではなく `ScopeKey` だからで、`scope.ts` の冒頭 JSDoc が既に「`NoteOwner` を正規化したものが `ScopeKey`」と宣言している。`NoteOwner` は型としてのみ import するので実行時の依存は増えない。

`editing.ts` の `scopeOfOwner` は名前を残した再エクスポートにした（`export { scopeOfNoteOwner as scopeOfOwner }`）。実装は 1 つに畳まれており、`purgeNote.ts` の import 側を触らずに済む。名前を 1 つにするなら `purgeNote.ts` の import 行を書き換えるだけでよい。

### Consequences

- 良い点: scope 分割の決定が 1 箇所になり、`subscribers.test.ts` の workspace 分岐（TC-integration-022）がその 1 箇所を守る
- 良い点: note 側の 6 箇所が cleanup 配下を参照しなくなり、依存の向きが素直になった
- トレードオフ: `editing.ts` に別名の再エクスポートが 1 行残る

---

## ADR-098: 追随者の turn の決着は 1 関数に集約し、「満ページか」は呼び手が渡す

### Context

3 追随者の末尾は「`limit` 未満なら `complete` して返す、さもなくば再武装する」という同一形の 2 分岐で、共通因子のうち turn 型・受理判定・再武装だけが `notePurgeFanOut.ts` に括り出され、**決着だけが 3 コピーのまま**残っていた。`complete` は継続の連鎖を止める唯一の手段（呼ばなければ scope-task runner が同じ行を claim し続ける）なので、3 箇所に散らすと 1 箇所落としても他 2 つが緑のままになる。

### Decision

**`settleNotePurgeTurn(ctx, { kind, operationId, turn, now, full })` に集約し、`armNotePurgeContinuation` は export をやめてこの関数に畳む。** 分岐の述語は関数の中に固定し、**「満ページか」だけを呼び手が渡す**。3 追随者で述語の対象が違うためである — tag / integration は `deleteByNote` が返した削除件数だが、storage は `listDeletableByNote` が返した**ページ長**で判定する。別の turn が先に取ったファイルは削除件数を減らすがページ長は減らさないので、削除件数で判定すると残りがあるのに `complete` してしまう。この違いは関数の中では判別できないので、境界を `full: boolean` に置いた。

### Consequences

- 良い点: `complete` の有無と再武装の priority が 1 箇所になり、`spec/usecases/{tag,integration}.md` の手順に書き足した記述と 1 対 1 で読める
- 良い点: 分岐を反転させる 1 変異で 3 追随者のテスト 13 本が同時に red になる（変異スポットチェック済み）
- トレードオフ: 呼び手が `full` を誤って渡す余地は残る。型では `deletedCount` と `files.length` を区別できないため、根拠は storage 側の 3 行コメントに置いた


## ADR-099: 保管する SVG は breakout tag の要素名を拒む — 膨張を止めるのは整形式性ではなく foster parenting の遮断

### Context

**ADR-095 が上限の根拠として書いた「整形式なら複製は起きない」は偽である。** 実測で覆った（レビュー review-005 の B-001）。`<svg><table><b a="0">…<b a="60">` の下に `<tr>X</tr>` を 13,018 行並べた 131,050 バイトは、**完全に整形式で、すべてのタグが閉じ、入れ子も 64 段以内**であり、`readSvgDocument` を素通りする。それでも `HtmlProcessor.process` は 11,300,523 バイト（**86 倍**）を 886 ms かけて作り、Note の `NOTE_CONTENT_TOO_LARGE` で落ちる。ADR-095 が閉じたと考えた 2 症状（Storage の語彙の破れ、増幅 DoS）は閉じていなかった。しかも到達点は `ensureUploadAllowed` の**後**・オブジェクト書き込みの**前**なので、容量ゼロの利用者でも踏める。

複製を生むのは adoption agency（misnest）ではなく **foster parenting** である。`<tr>` は "clear the stack back to a table context" で `<b>` を open elements から外すが active formatting elements のリストには残すため、次の行の先頭で "reconstruct the active formatting elements" が `k` 個を作り直す。属性を全部違えれば Noah's Ark clause（同一要素 3 個）を避けられ、テキストを `<td>` ではなく `<tr>` 直下に置けば marker も入らない。**閉じないタグも食い違いも 1 つも要らない。**

### Decision

**`readSvgDocument` の受理条件に「HTML の breakout tag の要素名を含まないこと」を足す。** 集合は HTML 仕様「foreign content 内のトークンの解析規則」の列挙そのもの（parse5 8.0.1 の `EXITS_FOREIGN_CONTENT` と一致することを確認した）— `b` / `big` / `blockquote` / `body` / `br` / `center` / `code` / `dd` / `div` / `dl` / `dt` / `em` / `embed` / `h1`〜`h6` / `head` / `hr` / `i` / `img` / `li` / `listing` / `menu` / `meta` / `nobr` / `ol` / `p` / `pre` / `ruby` / `s` / `small` / `span` / `strong` / `strike` / `sub` / `sup` / `table` / `tt` / `u` / `ul` / `var` の 44 個と、`color` / `face` / `size` のいずれかを持つ `font`。HTML のトークナイザーが名前を小文字化するので、比較も小文字で行う（`<TABLE>` は XML では別名だが同じトークンになる）。

これで foster parenting の入口が両方塞がる。foreign content を出る道は breakout tag か HTML integration point（`desc` / `title` / `foreignObject`）の 2 つで、後者から table 系の挿入モードへ入るにも `table` の開始タグが要り、それ自体が breakout 集合にある。

**失うものは無い。** `ALLOWED_SVG_ELEMENTS` と breakout 集合の交わりは空で、これらの要素はどのみちサニタイズで落ちる。逆に残る整形要素は `a` と `font` だけで、同じ構成を `a` / `font` に替えた実測は 221 KB（1.7 倍）/ 130 KB（1.0 倍）に落ちる。

**容量判定もサニタイズ後のバイト長に揃える**（同レビュー W-001）。`ensureUploadAllowed` を手順 4 へ動かし、上限・容量・行に載る値・オブジェクトに書く値の 4 つを 1 つの `storedSize` に一致させた。容量の門がサニタイズの後に来ることは意図的で、受理判定が SVG を 128 KB とその形で縛るためサニタイズの費用は有界であり、この門より前にオブジェクトストレージへは 1 バイトも書かない。

### Consequences

- 良い点: **上限の根拠が実測で裏打ちされた形に置き換わる。** 「整形式なら複製が起きない」ではなく「HTML の table 挿入モードへ入れないので行ごとの再構成が起きない」。ADR-095 の Consequences の 2 番目（「`MEDIA_SVG_MAX_BYTES` の 6 倍の根拠が本当になる」）はこの ADR が置き換える
- 良い点: 増幅 DoS の経路が受理判定で閉じる。拒否は 1 パスの走査で済み、サニタイザーは 1 度も走らない
- 良い点: 容量の超過も過剰拒否も消える。SVG は膨らむ側にも縮む側にも動くが、判定する値が 1 つになった
- トレードオフ: **`<svg>` の中に HTML を書いた文書は、サニタイズすれば安全になるものも含めて受理しない。** ブラウザは開けるが、描かれるのはサニタイズ後と同じもの（これらの要素は許可リストに無い）なので、失われる描画は無い
- トレードオフ: 容量が尽きた利用者の SVG も 1 度サニタイズされる（128 KB の有界な仕事）。オブジェクトは書かない
- 残件: ADR-095 の「note 本文（2 MB）は同じ膨張に露出している」は変わらない。本文側には foster parenting の入口を塞ぐ相当物が無く、`process` 自体を有界にする別スライスの課題として残る
- 変異スポットチェック: 受理条件から breakout の判定を落とすと TC-storage-269 が domain / application の両側で red、`font` の属性条件を落とす（無条件に拒む）と TC-storage-269 の受理側が red、容量判定を `accepted.size` へ戻すと TC-storage-271 の 2 本が red

---

## ADR-100: 孤児掃引の turn は「読む」と「判る」を分け、本文の解析を transaction の外へ出す

### Context

`sweepOnce` は scope の UoW の**内側**で `readNoteReferences` を呼び、その中で `htmlProcessor.extractExternalReferences` を回していた。ADR-080 が 1 turn を「読む行数 100 × 読むノート数 5」で有界にしたので回数は抑えられているが、抑えた先の値は依然として最大 105 本 × 800,000 バイトである。scope = Durable Object の配備では、その解析のあいだ当該 scope へのあらゆる要求が待つ。`OrphanMediaContainer` の JSDoc が「`htmlProcessor` は純粋な計算なので transaction の外で読む」と宣言しているのに、実際の呼び出しだけが内側に残っている形でもあった。

### Decision

1 turn を 3 段に分ける。

- **読む（transaction 1 つ）** — ページの列挙と、そのページが名指すノートの本文・保持中の版の本文を**文字列のまま**集める（`readNoteBodies`）。ノート予算の判定と `judgedThrough` の前進はここで決まる。判定材料の読みはすべてこの 1 つの transaction に入る
- **判る（transaction の外）** — 集めた文字列を解析して参照 URL を採り、孤児を選ぶ（`decideOrphans`）。純関数であり、ポートは `htmlProcessor` と `publicUrl` しか使わない
- **消す（1 件 1 transaction）** — 従来どおり

読み取りの一貫性は**失われない**。判定に効く読み（列挙・ノート・版）は 1 つの transaction のままで、外へ出したのはその結果に対する純粋な計算だけである。

### Consequences

- 良い点: scope object を握る時間が「11 回前後の読み」に縮む。解析の CPU は誰も待たせない
- 良い点: 解析が投げたときの扱い（そのファイルを見送って続行）が、読みが投げたときの扱いと同じ形で外側に並ぶ。どちらも `[collectOrphanMedia] a file could not be judged` を残す
- トレードオフ: 解析までのあいだ本文の文字列を保持する。上限はノート予算 × (`RETENTION` + 1) 本で、これは元々 1 turn が解析していた集合そのものなので新しい上限ではないが、**同時に**保持する点だけが変わった。予算 5 を下げれば保持も下がる
- トレードオフ: `NoteReferences`（判定済み）と `NoteBodies`（読んだだけ）の 2 つの型が並ぶ。`gone` / `unreadable` の 2 枝は同じ意味を運ぶので、`referencesOf` はその 2 枝をそのまま返す
- 変異スポットチェック: `decideOrphans` の呼び出しを scope の UoW の内側へ戻すと TC-storage-259（解析の位置）と TC-storage-028（解析の失敗を見送る枝）が red

---

## ADR-101: `tag_assignments.scope_type` / `scope_id` は scope 鍵として検査する

### Context

`spec/domains/tag.md` は「assignment の scope は付けたノートの scope」と定め、`TagScope` は `NoteOwner` と同形である。つまりこの 2 列は会計上の帰属ではなく **scope 鍵**であり、`spec/database/index.md`「共通の規約」の scope 検証の対象に当たる。ところが両バックエンドとも `_scope_identity` の pin と突き合わせておらず、`notes.owner_type` / `owner_id` の扱いと非対称だった。今スライスに書き込み経路が無いので実害は潜在だが、curation スライスが `assignTag` を足した瞬間に「間違った scope object へ黙って書ける」状態になる。

### Decision

`notes` と同じ形を入れる。cloudflare は deps に `ScopeKey` を取り、`insert`（保存）と `listByNote` の行復元（restore）の両方で pin と突き合わせて `DataIntegrityError` を投げる。memory は `ScopeStore.scope` と `insert` で突き合わせる（行が scope ごとの表に物理的に分かれているので、読み側に検査するものが無い）。

`backup_records.user_id` は逆の側で、Drive の持ち主を名指す帰属列なので検査しない。両方の判断を `do/schema.ts` の scope 鍵の列挙と `spec/database/index.md`「共通の規約」に反映した — 物理分離が pin だけに乗っている設計では、この列挙が古びると次に表を足す人が判断の根拠を失う。

### Consequences

- 良い点: curation スライスが `assignTag` を書くとき、scope を取り違えた配線は最初の 1 件で落ちる
- 良い点: 「scope 鍵か帰属か」の判断が、表を足すたびに 3 箇所（ポート実装・スキーマのコメント・spec）で同じ答えになる
- トレードオフ: これはポート契約ではなく**バックエンドの整合ガード**なので conformance には置かない（どのユースケースからも到達できず、配線を誤ったときだけ起こる）。memory 側に 1 本だけテストを置いた
- トレードオフ: cloudflare のリポジトリが `ScopeKey` を要求するようになり、組み立て地点 2 か所（DI・適合ハーネスの `forScope`）が 1 行ずつ増える
- 変異スポットチェック: memory の突き合わせを反転させると新しい ADP-tag-010（`memory/__tests__/scopeGuards.test.ts`）と tag assignment の conformance 4 本が同時に red

---

## ADR-102: 詳細の島も「版を進めうる往復」を判別ユニオン 1 つで表す

### Context

ADR-082 は編集島の往復を `EditorActivity` / `runExclusive` で直列化したが、同じ問題を持つ隣の島（`NoteDetail`）はそのままだった。タイトルの自動保存・表示スタイルの切替・ゴミ箱への移動・元に戻すの 4 つはどれも `versionRef.current` を送って版を 1 つ進めるのに、共有しているのは `useTransition` 1 つだけで、`useTransition` は往復を**直列化しない**。とくにタイトルの 800ms タイマーは進行中の往復を一切見ないので、「1 文字打つ → 800ms 以内にメニューから表示スタイルを切り替える」だけで両者が同じ版を送り、後着が必ず `OPTIMISTIC_LOCK_FAILURE` になってタイトルが巻き戻る。メニューのボタンは `disabled={busy}` で守られていたが、守れないのはタイマー側である。

### Decision

編集島と同じ形を持たせる。`DetailActivity`（`idle` / `renaming` / `styling` / `trashing` / `restoring`）と `runExclusive` を置き、4 つの往復すべてをその中からしか呼ばない。占有の正本は ref（タイマーの発火とクリックが同じ描画に並ぶため）、state は表示と effect の依存のために持つ。自動保存の effect は `busy` を停止条件と依存の両方に入れる。

落ちたタイトル保存は失われない。`title` は `savedTitle` から離れたままなので、`busy` が下りた時点で effect がタイマーを張り直す。「切替の直前に保留中のタイトル保存を流す」形は採らなかった — 流す側の往復も版を進めるので、結局 2 往復を順に取ることになり、後回しにするのと同じ結果になる。

併せて表示を占有の種類で分けた（「保存中...」は `renaming` のとき、「元に戻しています...」は `restoring` のとき）。

### Consequences

- 良い点: ED-07 の自動保存と ED-09 / ED-11 のメニュー操作を混ぜても版が枝分かれしない
- 良い点: 往復を足すときはユニオンに 1 行足すことになり、2 つの島が同じ読み方になる
- トレードオフ: 往復中に発火したタイトル保存は静かに落ち、最大 800ms 遅れて走る。表示は「未保存」のままなので、利用者から見て消えたようには見えない

---

## ADR-103: 退避した本文は 7 日で切れる — 期限切れは読まず、読みのついでに掃く

### Context

`writeDraft` が `localStorage` に置くのはノート本文そのもの（転送上限 2 MB）で、消える契機は「保存に成功する」「明示的に破棄する」の 2 つしかない。保存に成功しないまま端末を離れると無期限に残り、共用端末では次の利用者が `localStorage` を列挙するだけで読める。ED-08 は退避を要求しているが、保持期間も消去の契機も定めていない。

サインアウト経路での一掃は identity スライスの持ち分（この島は自分がいつサインアウトされたかを知らない）なので、ここでは期限で閉じる。

### Decision

`DRAFT_MAX_AGE_MS = 7 日`。`readDraft` は `savedAt` から期限を測り、切れていたら**読まずに捨てる**。あわせて読みのたびに `hollow.noteEditor.draft.` 前置きの鍵を列挙し、期限切れと読めない値をまとめて落とす — 鍵ごとの判定だけでは、二度と開かないノートの退避が永久に残るためである。

期限は「いつまで復元できるか」の約束ではない。ED-08 が求めるのは保存に失敗した直後に復元を提案できることで、それは分〜時間の話である。7 日は「休暇を挟んでも戻ってこられる」側に寄せた上限で、下げても ED-08 は壊れない。

### Consequences

- 良い点: 未保存の本文が端末に残る期間に上限が付く。サインアウト時の一掃が入っても、この期限はその後ろで独立に働く
- 良い点: 掃除の契機が「編集画面を開く」1 つなので、余分な effect も listener も増えない
- トレードオフ: 掃除は編集画面を開いた端末でしか走らない。二度と編集画面を開かない端末では期限切れの退避が残る（読まれることはない）
- トレードオフ: `localStorage` の列挙そのものを拒む端末では掃除が諦められる。鍵ごとの期限判定は残るので、その端末でも期限切れの退避は読まれない

---

## ADR-104: WYSIWYG の面は `<style>` を落とし、その喪失を ED-04 の門の後ろへ寄せる

### Context

3 つの書く面はどれも live DOM で、同じ `scrubForSurface` を通していた（ADR-092）。その scrub が落とす集合は保存時のサニタイズが落とすものの**部分集合**なので、面は「実際に保存される形」から外れる向きには動かない。この不変条件が成り立つ前提で、`<style>` は落としていなかった — `<style>` は許可リストが**意図して残す**要素で（ED-03 の「スタイルシートは本文に埋め込みます」）、落とすと部分集合の性質そのものが破れるからである。

ところが 3 つの面のうち WYSIWYG だけが shadow root の外にある（ビジュアルと HTML のプレビューは `attachShadow`）。HTML の `<style>` は挿入位置によらず**文書全体**に効くので、本文が持つセレクターが編集画面の上部バー・保存ボタン・警告 Alert にそのまま当たる。共有ワークスペースでは他のメンバーが書いた本文が自分の編集画面を壊せる。

面のホストに掛けた `contain` は担保にならない。WYSIWYG のホストにはそもそも `contain` が無く、あるのは HTML プレビューのホストだけで、しかも `contain: layout paint` はレイアウトと描画の閉じ込め（`position: fixed` の包含ブロックになる）であって**セレクターの到達範囲は閉じない**。JSDoc は「面の外へ出られないことはホスト側の `contain` が担保する」と断言していたが、閉じているのは shadow root のほうである。

到達経路は ED-04 の主動線そのものだった。`<style>` を持つ本文でも `sourceFileId === null` かつ `styleMode === "default"` なら `mayLoseDecoration` が偽になり、編集画面は警告も出さずいきなり WYSIWYG で開く。

### Decision

`<style>` を落とすのは **WYSIWYG の面だけ**にし（`dropStyleElements`）、`scrubForSurface` の部分集合の性質はそのまま保つ。そのうえで、落ちることを ED-04 の門の後ろへ寄せる。

- `mayLoseDecoration` に「本文が `<style>` を持つ」を加える（`NoteEditor/index.tsx`）。判定はサーバーコンポーネントなので走査（`/<style[\s/>]/i`）で行い、取りこぼさない側へ倒す — 過検出は警告が 1 回余分に出るだけだが、見落とすと装飾が警告も版も無しに失われる
- したがって `<style>` を持つノートは既定で HTML モードで開き、WYSIWYG へ入るには警告の「了解して進む」を通る。その最初の保存は `wysiwygConversion` として版を残すので、落ちた装飾は版から戻せる
- 警告の文言に「本文に埋め込まれたスタイルシート」を明記する（従来は「取り込んだ外部スタイルシート」だけだった）
- WYSIWYG の貼り付けも同じ scrub（+ `dropStyleElements`）を通す。ADR-092 が数えた「面へ本文が入る経路」はシードだけではなく、貼り付けが素通りしていた

### Consequences

- 良い点: 本文の CSS が編集画面の UI を覆う・消すことが無くなる。他人の本文で自分の編集画面が壊れない
- 良い点: `scrubForSurface` は「保存で落ちるものしか落とさない」ままなので、面が保存し直しても失われるものは無いという読み方が保てる。実際に失う側は関数も理由も別に立っている
- 良い点: 「セレクターを閉じるのは shadow root、`contain` が閉じるのはレイアウトと描画」という区別が JSDoc と実装で一致する
- トレードオフ: `<style>` を持つノートは WYSIWYG を既定にできない（警告を了解するまで HTML モードで開く）。ED-04 が要求する警告の対象がその分広がる
- トレードオフ: WYSIWYG で編集して保存すると `<style>` が本文から消える。ED-04 の「装飾が失われることがある」の一部として告げ、保存前の版で戻せる形に留める

---

## ADR-105: 面を載せ直してよいのは、面が「送った写し」と同じ値のままのときだけ

### Context

ADR-089 は「保存が確定させるのは送った写し」を通したが、ビジュアルモードには確定ではなく**面ごと載せ直す**枝が 2 つある。丸ごと送る保存（`updateNoteBody`）のあとは、サーバーがサニタイズ後に持つ木と手元の経路表が噛み合わないので載せ直すしかない。ところが `replaceBody` は経路表を捨てて `visualDirty` を落とすので、面が凍らない以上、往復のあいだに打った文字がそのまま消える — 写しの規則の逆向きである。

もう 1 つの穴が同じ場所にあった。経路単位の保存は経路ごとに `pathNotFound` / `contentChanged` で個別に落ち、落ちた経路はサーバー側で**一切適用されていない**。にもかかわらず確定は成否を問わず送った経路表を丸ごと新しい基準にしていたので、落ちた経路の `expected` は「一度も適用されていない文字列」になり、以後その経路は何度打っても `contentChanged` で落ち続ける（ADR-089 が「取り込まないと同じ `expected` で送り直す」と書いてトレードオフに置いた点だが、取り込むほうが永久に直らない）。

### Decision

載せ直しを 1 つの述語の後ろに集める（`reseedIfUnchanged`）。**面がまだ写しと同じ値のままのときだけ**載せ直す。

- 載せ直す契機は 2 つ — ビジュアルモードで丸ごと送ったあと、および経路単位の保存が 1 件でも `skipped` を返したあと。どちらも「手元の経路表がサーバーの木と噛み合っていない」という同じ理由である
- 載せ直せなかったとき（往復中に打鍵があったとき）は送った写しで確定させるだけにする。面の値と確定済みの値が食い違ったまま残るので、次の保存は経路単位ではなく丸ごと送る枝に落ち（`takeSnapshot` の分岐）、打鍵をそこで拾う。打鍵の無い往復が 1 回あれば載せ直しが通って噛み合いが戻る
- 載せ直せなかった経路単位の保存では、`settleSaved` が `skipped` の経路だけ**旧値のまま**基準に残す。次の `expected` がサーバーの持つ値と一致するので、同じ経路が構造的に保存不能になることが無い
- 「反映できなかった編集があります」の文言を、読み直しを利用者に頼む形から「最新の本文で編集欄を読み直す」形へ直す

### Consequences

- 良い点: 往復中の打鍵を失う枝が無くなる。写しの規則が「確定」だけでなく「載せ直し」にも及ぶ
- 良い点: `skipped` に落ちた経路が永久に保存できなくなる状態が消える。載せ直しが 1 回入るか、旧値のまま基準に残るかのどちらかで、必ず整合が戻る
- トレードオフ: 打鍵が続くあいだは載せ直しが繰り返し見送られ、その間ビジュアルの保存は丸ごと送る枝で走る（経路単位より重い）。打鍵が止まれば 1 往復で戻る
- トレードオフ: `skipped` のあとに面が読み直されるので、適用されなかった書き換えは画面からも消える。消えることは通知が名指しする

---

## ADR-106: 冪等でない初回作成は、落ちたら再送させない

### Context

`createNoteWithBodyFn` は `createBlankNote` → `getNote` → `updateNoteBody` の 3 段を 1 往復に束ねている（版のため）。`createBlankNote` が通ったあとで後段が落ちる、あるいは応答が届かないと、サーバーにはノートが 1 件残るのに画面は「まだ作られていない」ままになる。失敗の Alert が出す「再試行」も下端の「保存」も同じ経路を呼び直すので、押すたびに白紙のノートが 1 件ずつ増える。とくに本文が上限を超えているような決定的な失敗では、押した回数だけ確実に増える。

同じ状態にもう 1 つの嘘があった。退避（`writeDraft`）の鍵は `noteId` なので、ノートがまだ無い `/notes/new` では退避が成立しない。ところが Alert は状態の種別だけを見て「内容はこの端末に退避したので、次に開いたときに復元できます」と無条件に書いていた。利用者はその案内を信じて画面を離れる。

### Decision

`SaveStatus` の `failed` に `stashed`（**実際に端末へ退避できたか**）を持たせ、案内と逃げ道をその値で分ける。

- 退避できた（＝ノートが在る）: 従来どおり「再試行」と「退避したので次に開いたときに復元できます」
- 退避できていない（＝ノートがまだ無い）: 「内容をダウンロード」と「退避できていません」。あわせて明示保存の入口（下端の「保存」、モード切替の「保存して切り替える」）も落とす。自動保存は `failed` から自力で再開しないので、これで再送の入口が塞がる

冪等鍵は導入しない。畳むための鍵は作成そのもの（`createBlankNote`）の持ち分で、この経路からは持ち込めない。代わりに `createNoteWithBodyFn` の JSDoc に窓と、画面が再送を出さない理由を書く。

### Consequences

- 良い点: していない退避を「した」と告げなくなる。P-12 の状態表が持たない「退避の無い保存失敗」を、状態ではなく文言の分岐で表す
- 良い点: 孤児の白紙ノートが押した回数だけ増えることが無くなる
- トレードオフ: 新規作成の初回保存が落ちると、その画面からは保存し直せない。逃げ道はダウンロードだけで、続きは読み直してからになる。冪等鍵が入れば再試行を戻せる

---

## ADR-107: `deleteNotesForOwner` の 1 turn は global D1 の statement 数で決める — 40 notes

### Context

`spec/platform/index.md`「実行予算と分割単位」は 1 invocation の D1 query 上限を 500（実上限 1,000 の半分）と定め、同じ節で「`deleteNotesForOwner` の 1 turn の global query 数は概ねノート数 × 4〜6」「上表の 100 rows はこの 500 query 上限に張り付く値」と書いていた。この 4〜6 は**ポート呼び出し**の数であって query 数ではない。

Cloudflare 実装を数えると、`NoteRouteStore` は autocommit session なので 1 呼び出しが「読み 1 + guard 1 + 書き 1〜」に開く（`d1/repositories/noteRouteStore.ts` の `requireRow` + `commit`）。public projection の `removeForPurge` も `readStored` 1 + `[vectorGuard, (fts delete), delete, tags delete]` の原子適用に開く（`projection/snapshotWriter.ts`）。1 件の purge は `resolve` 1 ＋ `beginPurge` 3 ＋ `removeForPurge` 4〜5 ＋ `finishPurge` 3 ＝ **11〜12 statement**。既定 100 件では 1,100〜1,200 で、設計上限 500 どころか実上限 1,000 も超える。「張り付く」ではなく踏み抜いていた。

### Decision

見積もりの言い換えではなくバッチ側を直す。`OWNER_PURGE_BATCH_SIZE` を 100 → **40** にする（40 × 12 = 480 で設計上限の内側）。`spec/platform/index.md` には数える単位が statement であること、内訳、および上表の 100 rows がこの経路には使えないことを書く。表の「owner / workspace cleanup」行にも例外を併記する。

持ち回る `StuckPurge` はページの**上に**載るので、回収中の turn は 480 を超えうる。これは実上限 1,000 との差で吸収する — 持ち回りはページと違って turn 側が選べる量ではないため、ページの上限をさらに下げても保証にはならない。

### Alternatives

- **1 件あたり 5 以下に抑えられる根拠を書いて見積もりの幅を狭める**（レビューが挙げたもう一方）: 実装が 11〜12 を使う以上、正典に嘘を書くことになる。
- **100 のまま「予算超過を承知で運用する」と書く**: 設計上限を宣言している節に自己矛盾を残すのと同じ。
- **1 件あたりの statement 数を減らす**（route の読みを `beginPurge` に畳む等）: アダプター契約に触れる変更で、今スライスの守備範囲外。将来 40 を上げたくなったときの正攻法はこちら。

### Consequences

- 良い点: Cloudflare 配備で 1 turn が D1 の実上限を踏まない。参照ランタイム（Node + memory）には D1 予算が無いので、効くのは turn 数が 2.5 倍になることだけ
- 良い点: 「query 数」がポート呼び出し数ではないことが正典に明記され、次に予算を数える人が同じ取り違えをしない
- トレードオフ: `100` を写している正典が 4 箇所残る（`spec/usecases/note.md`「既定・最大100」ほか、`spec/inventory/usecase.md` UC-note-022、`spec/inventory/test.md` TC-note-073 / 074 / 079、`spec/testcases/note/deleteNotesForOwner.md`）。本作業の担当ファイル外なので同時に直せていない
- 変異スポットチェック: `OWNER_PURGE_BATCH_SIZE` を 41 にすると TC-note-079 が red

---

## ADR-108: 編集島の確定済み状態は `EditorSnapshot` 1 つで持ち、遷移は `confirm` と `reseed` の 2 つに限る

### Context

ラウンド 003・004・005・006 の Blocker はすべて「送った写しを確定させる」規則（ADR-089）の**別の穴**だった。003 はビジュアルの基準を `await` の後に読み直す穴、005 は `skipped` の経路を基準に取り込む穴、006 は 2 つ同時に出た — 載せ直し（ADR-105 の `reseedIfUnchanged`）の門が本文しか見ておらず往復中に打ったタイトルを捨てる穴（B-001）と、載せ直しに入らない枝がビジュアルの面と `body` state の食い違いを直さず `dirty` が永久に下りない穴（W-005）である。

根は 1 つで、確定済み状態が `savedTitle` / `savedBody` / `savedRef` / `baseline` / `baselineSeed` / `visualOriginal` / `visualDirty` に散っていたことにある。散っている以上、保存の経路ごとに「どれを進めるか」が違ってよく、実際に違っていた — rename の直後は `savedTitle` だけを進め（本文を進めない）、丸ごと送る保存の確定は `savedBody` だけを進める（`body` state を揃えない）。B-001 と W-005 は同じ穴の裏表である。個別に塞いでも、次に枝を 1 つ足したときに同じ形の穴がもう 1 つ空く。

ADR-105 の門（「面が写しと同じ値のままなら載せ直す」）は判断そのものは正しいが、比較の対象が本文 1 つだったために規則の適用範囲が本文に閉じていた。本 ADR はその門を写し全体の比較へ広げ、ADR-105 を置き換える。

### Decision

確定済み状態を `EditorSnapshot`（`title` / `body` / `visual`）**1 つの値**で持ち、確定値が動く経路を 2 つに限る。

- `confirm(sent, next)` — 確定を 1 段**進める**。受け取るのは送った写しと、その往復のあとにサーバーが持っている**写し全体**の 2 つだけである。項目を 1 つだけ進める入口（旧 `rememberSaved(title, body)`）は消した。タイトルだけが通った窓（rename は通ったが本文の保存が落ちた）も、`{ ...confirmed, title: applied }` という**完全な写し**を渡す形でしか表せない
- `reseed(title, body)` — 確定を丸ごと**置き換える**。サーバーの正本を面ごと載せ直す経路がこれで、面へ本文を載せるだけの操作（`loadSurface`：退避の復元、競合の「自分の内容で上書きする」の後半）は確定値を動かさない別の関数に分けた
- 門は `sameSnapshot` で**写し全体**を比べる。本文だけ・タイトルだけを見る比較はコードから消えている
- 経路単位で送れるか（旧 `body === savedBody` の近似）は `VisualPaths.pathwise` として確定値の中に持つ。`true` へ戻るのは面を正本から組み直したときだけで、その判定は `onReady` の `baseline === confirmed.body` 1 か所に閉じる
- `confirm` はビジュアルモードで必ず `body` state を写しの本文へ揃える。ビジュアルの面は打鍵で `body` を動かさないので、揃えないと面と state が食い違ったまま `dirty` が下りない

あわせて ED-04 の門（`needsWysiwygWarning`）の材料を「断片を描いた時点の本文」から「**これから面へ載る本文**」に変え、`enterMode`（確定値）と `reseedFromServer`（引き直した正本）の 2 か所で問う。判定は面が実際に落とすもの（`dropStyleElements`）と同じパーサーに聞く（`willDropStyleElements`）。サーバーコンポーネント側の走査による判定は取り込み由来の分と or で残す。

### Consequences

- 良い点: 「保存経路ごとに進める部分集合が違う」が構造として書けない。確定値を動かす関数は 2 つで、どちらも写しを丸ごと受け取る
- 良い点: B-001（往復中のタイトルが消える）と W-005（`dirty` が永久に下りない）が個別の分岐ではなく同じ 1 か所で塞がる。次に保存の枝を足しても、確定に渡せるのは写し全体だけである
- 良い点: 「経路単位で送れるか」が `body === savedBody` という偶然の等式ではなく明示の値になり、丸ごと送ったあとに `true` へ戻らないことが読んで分かる
- 良い点: ED-04 の門が、自動保存で入った `<style>`（断片は描き直されない）にも掛かる
- トレードオフ: 確定値の更新が 1 回の state 更新にまとまるので、`confirmed` を依存に持つ effect は本文とタイトルのどちらが動いても走る（退避の検出 effect 1 本のみ。読むのは 1 件だけなので無視できる）
- トレードオフ: `pathwise` が `false` のあいだビジュアルの保存は丸ごと送る枝で走る。`true` へ戻るのは面の載せ直しが 1 回入ったときで、これは ADR-105 が置いた性質をそのまま引き継ぐ
- **ADR-105 を置き換える**。載せ直しの契機と「載せ直せなかったら送った写しで確定させる」規則はそのまま生きているが、門の比較対象が本文から写し全体になった

---

## ADR-109: 面の scrub は保存側の「落とす / unwrap」の割り方まで写す

### Context

面の scrub（`scrubForSurface`）は「保存で落ちるものの部分集合しか落とさない」という不変条件で書かれていた（ADR-092）。ところが落とし方は写していなかった — 面は集合に載っている要素を `remove()`（subtree ごと）するのに対し、保存側（`adapters/html/allowList.ts`）が subtree ごと落とすのは `DROP_WITH_CONTENT` に載っているものだけで、それ以外の未許可要素は unwrap する（散文を黙って消さないという ADR 006 由来の要件）。両者がずれるのは `form` 1 つで、`script` / `noscript` / `iframe` / `object` / `embed` は両側とも subtree ごと、`link` / `meta` / `base` は子を持てないので差が出ない。

WYSIWYG は面の DOM が本文の正本なので、これは表示だけの差では済まない。`<form>` に包まれた領域を貼ると中の散文が面から消え、そのまま次の保存でサーバーへ書き戻る。

### Decision

面の集合を 2 つに割る — `UNSAFE_DROP_ELEMENTS`（子ごと落とす。保存側の `DROP_WITH_CONTENT` の部分集合）と `UNSAFE_UNWRAP_ELEMENTS`（要素だけ外して子を残す）。割り方の正典は保存側の `DROP_WITH_CONTENT` である。

### Consequences

- 良い点: 「面が落とすものは保存でも落ちる」が、要素の集合だけでなく**落ち方**についても成り立つ
- 良い点: `<form>` を含む Web ページを WYSIWYG へ貼っても散文が消えない
- トレードオフ: 面に `<form>` の子（`input` / `button`）が残る。保存では未許可要素として unwrap されるので、保存後の姿とは違う — これは scrub がもともと「保存後の姿ではない」ことの一部である

---

## ADR-110: scrub 済みの木は直列化せずにそのまま面へ渡す

### Context

「サニタイズした木を直列化し、別の解析文脈で読み直す」は既知のサニタイザー迂回（mXSS）の形で、`<svg>` / `<math>` 由来の名前空間混同や `<style>` / `<title>` の raw text で属性境界が動くと、scrub 後に無かった `on*` が再パースで復活しうる。3 つの面のうちビジュアルだけが `root.replaceChildren(style, template.content)` で木のまま渡していて、WYSIWYG のシード（`surface.innerHTML = template.innerHTML`）と貼り付け（`execCommand("insertHTML", …, template.innerHTML)`）は挟んでいた。ここへ未保存の他所由来 markup が入る経路は実在する（WYSIWYG への貼り付け、ED-03 の中核である「保存済み Web ページを HTML モードへ貼る」）。

### Decision

WYSIWYG の 2 経路を木の受け渡しに変える。

- シード: `surface.replaceChildren(template.content)`。直列化してよいのは「載せ替えが要るか」の比較だけで、比較した文字列は DOM へ戻さない
- 貼り付け: `Range.insertNode(template.content)` で caret 位置へ差し込み、caret を差し込んだ末尾の直後へ移す

HTML のプレビューだけは窓を承知で残す。`NoteBody` は本文を**文字列で**受け取る API で、そこを fragment に変えると保存済み本文を描く経路（`NoteDetail`）まで巻き込む。代わりに `<style>` の連結（`` `<style>${css}</style>${html}` ``）をやめて要素として組み、残る窓を JSDoc に明記した。

### Consequences

- 良い点: 未保存の他所由来 markup が入る 2 経路から窓が消える
- 良い点: `<style>` の境界が本文の中身に依存しなくなる
- トレードオフ: WYSIWYG の貼り付けがブラウザーの取り消し履歴に載らない（`execCommand` を通らないため）。Ctrl+Z で貼り付けが戻らない
- トレードオフ: HTML のプレビューには窓が 1 本残る。閉じるには `NoteBody` の受け取り方を変える必要がある

---

## ADR-111: shadow root のホストは `contain` の親で包む — `:host` は shadow root では閉じない

### Context

「shadow root なのでセレクターの到達範囲はそこで閉じる」は `:host` に対しては成り立たない。shadow tree の中の `:host { … }` は**ホスト要素**（light DOM 側）に当たり、CSS Scoping の並び順は通常宣言なら外側の木が勝つが、`!important` が付くと内側の木が勝つ。したがって本文の `<style>` に `:host { transform: scale(40) !important }` が 1 行あると、ホストに掛けてある `relative` では止まらず、面・本文が編集画面や詳細画面を覆える。保存側の CSS フィルターが絞っているのは `position` だけで、`transform` / `width` / `margin` は通る。

HTML のプレビューだけは外側の `[contain:layout_paint]` が包含ブロックと描画のクリップを作っていて閉じていたが、同じ包みがビジュアルの面と `NoteBody` に無かった。共有ワークスペースでは他のメンバーが書いた本文が閲覧者の画面を覆える（クリックの誘導も同じ形で作れる）。

### Decision

shadow root のホストは `[contain:layout_paint]` の**親**で包む。ホスト自身に掛けても、`:host` が当たる先はそのホストなので効かない。ビジュアルの面と `NoteBody` に HTML プレビューと同じ包みを足した。

### Consequences

- 良い点: 本文の CSS が面・本文の枠の外へ出られない。3 つの描画先で担保が揃う
- 良い点: 「セレクターを閉じるのは shadow root、レイアウトと描画を閉じるのは `contain`、そして `:host` は前者の外側にある」が JSDoc と実装で一致する
- トレードオフ: `NoteBody` のホストに div が 1 枚増える

---

## ADR-112: 決定的な業務拒否は「退避して再試行」に畳まない

### Context

編集島の `classify` は既知のコード以外をすべて `failed`（通信エラー＝退避して再試行）に畳んでいた。そこへ来るのは通信エラーだけではなく、`NOTE_CONTENT_TOO_LARGE`（800 KB 超）・`NOTE_INVALID_TITLE`・転送境界の `INVALID_INPUT` も同じ枝に落ちる。結果として、同じ本文を送るかぎり必ず同じ拒否が返るのに「再試行」を勧め、上限を超えた本文を毎回 `localStorage` へ書いていた。エラーの文言（「分割してからもう一度お試しください」）が分割を勧めているのに、隣のボタンが分割しない再送を勧める形である。

### Decision

`SaveStatus` に `rejected`（利用者が内容を直すまで再試行が意味を持たない拒否）を足し、退避も再試行も出さない。

- 自動保存は `rejected` から自力で再開しない（同じ答えを返し続けるため）。再開の起点は打鍵（＝内容を直す操作）で、`markDirty` が `rejected` を降ろす
- ただしノートがまだ作られていないあいだは降ろさない。初回作成は冪等ではないので、再送は白紙のノートを 1 件ずつ増やす。この場合の逃げ道は `failed` と同じダウンロードにする

### Consequences

- 良い点: 成功しない再試行を勧めなくなる。上限超えの本文で `localStorage` の quota を押さない
- 良い点: 「通信エラー」と「内容の拒否」が別の状態として提示される
- トレードオフ: `spec/pages/index.md#P-12` の状態表に「保存できません（内容の拒否）」に当たる行が無い。表への追記が要る（本作業の担当ファイル外）

---

## ADR-113: サニタイズは「入力の形」ではなく「使う資源」で有界にする

### Context

`HtmlProcessor.process` の費用を「この形の入力なら有界だ」と論証する試みは、**3 ラウンド続けて実測に否定された**。

- ADR-095 は「膨張率を定数にできるのは整形式な入力に限られる（複製は入れ子が壊れているときだけ起きる）」と書き、128 KB という SVG の上限の根拠をそこに置いた。**これは偽である**（ラウンド 005 の実測: 完全に整形式・64 段以内の 131 KB が 11.3 MB = 86 倍）
- ADR-099 はそれを「foster parenting の入口は breakout tag と HTML integration point の 2 つしかなく、後者から table 系の挿入モードへ入るにも `table` の開始タグが要り、それ自体が breakout 集合にある」と置き換えた。**これも偽である**（ラウンド 006 の実測: `<svg><desc><template><tr><font …>` の 131 KB が 21.9 MB = 180 倍・heap 186 MB。"in template" 挿入モードは `caption` / `tbody` / `tr` / `td` などで **`table` の開始タグを介さずに** table 系へ切り替わり、`template` / `tr` / `td` は breakout 集合に 1 つも無い）

3 回とも、誤っていたのは集合の中身ではなく**集合が十分だという推論**である。列挙は HTML の挿入モード全体を相手にしており、名前の網羅で証明する形になっていない。次に `template` を集合へ足しても、同じ推論の穴が残る。

同じラウンドで本文側も測られた。`sanitizeNodes` ↔ `sanitizeNode` の相互再帰は 22 KB（`<div>` 2,000 段）で `RangeError`、`filterCss` の `findBlockEnd` は階層ごとに残り全体を読み直すので 108 KB（`@media a{` 12,000 段）で 26 秒。`RangeError` は `CodedError` ではないので `toSerialized()` を持たず、`kind` による構造的な直列化に乗らない。転送境界は 2,000,000 バイトを通す。

### Decision

**`HtmlProcessor` が自分の使う資源に上限を持ち、超えたら `BusinessRuleError(NOTE_HTML_TOO_COMPLEX)` で打ち切る。入力の形については何も論証しない。**

| 上限 | 値 | 根拠 |
| --- | --- | --- |
| 解析後の木（直列化長で測る） | 入力長 × 4、下限 262,144 / 上限 4,000,000 バイト | HTML の解析は active formatting elements の再構成以外で内容を複製しない。正当な 1,040,000 バイトの本文の実測は 1.06 倍。下限は短い入力の省略タグ補完（`<table><tr><td>x` は 2.8 倍）、上限は転送境界 2,000,000 の 2 倍 |
| 走査の深さ | 256 段 | 実在の文書は数十段。木を辿るすべての走査が数百フレームに収まり、スタックが尽きる水準から 1 桁以上遠い |
| CSS のブロックの入れ子 | 32 段 | 実在のスタイルシートは 5 段程度。ブロックの終端探索が二乗を生むので、ここを切ると線形に戻る |
| CSS の走査の総量 | `process` 1 回につき 8,000,000 歩 | 転送境界の 1 バイトあたり 4 回。深さの上限をすり抜ける形への歯止め |

**測るのは解析が終わってからではなく、解析しながらである。** 木の大きさは `parse5` の tree adapter を `defaultTreeAdapter` の委譲で包み、`createElement` / `insertText` / `insertTextBefore` / `createCommentNode` が要求されるたびに直列化長を課金する。深さは同じ adapter の `onItemPush` / `onItemPop`（開いている要素の数）でも見る。解析が終わってから測る形は、費用を払い終えてから測ることになる — 180 倍の SVG は 15 MB の木と 200 MB の heap を作ったあとでしか測れず、`<div>` 50,000 段は木ができるまでに 21 秒かかる。

**再帰は `RangeError` を投げない形にする。** 深さを測る走査だけを明示スタックで書き（それが溢れる深さこそがこの走査の対象である）、木を辿る他の走査・`filterCss` のブロック走査・`parse5` の直列化はすべて上限より深くならないので、`toSerialized()` を持たない例外はどこからも出ない。`sanitizeNode` を明示スタックへ書き換える案は採らない — 木の構築・再親子付け・`<style>` の特例・内容ごと除去・子の昇格の 5 分岐を持つので、書き換えは出力の同一性を壊す危険のほうが大きく、上限を先に置けば同じ結論（`RangeError` が出ない）が 1 つの走査で得られる。

**上限以下の入力は 1 バイトも変わらない。** 上限は観測であって変換ではない（tree adapter は課金してから `defaultTreeAdapter` へ委譲し、深さの走査は木を読むだけ、CSS の予算は分岐を持たない）。`htmlProcessor.test.ts` の 204 ケース（サニタイズ表全体・不動点・派生情報・他の 4 メソッド）が変更前と同一のまま通ることがその証拠である。

許可リストにも breakout 集合にも触らない。後者は前段の安価な防御として残す — 1 パスの走査で済み、サニタイザーを 1 度も走らせない。

### Consequences

- 良い点: SVG（`storeMedia`）と本文（`updateNoteBody`）の両方が、適用点 1 つで同時に有界になる。ADR-095 の残件（「note 本文は同じ二乗の膨張と深い再帰にいまも露出している」）と ADR-099 の残件（「本文側には foster parenting の入口を塞ぐ相当物が無い」）がここで閉じる。別 Issue に切っていた「境界のない markup を再帰的サニタイザーに渡す件」も同じ根なので同時に閉じる
- 良い点: 実測（この worktree の Node）— `<div>` 2,000 段: `RangeError` 73 ms → 拒否 7 ms。`<div>` 50,000 段: `RangeError` 20.9 s → 拒否 2 ms。`@media a{` 12,000 段: `RangeError` 26.5 s → 拒否 164 ms。`<svg><desc><template><tr><font>` 131 KB: 306 ms / heap 202 MB → 拒否 15 ms。`<table><tr><font>` 131 KB（本文経路）: 同上 → 拒否 13 ms
- 良い点: 失敗が `kind: "business"` を持つ 1 つの語彙（`NOTE_HTML_TOO_COMPLEX`）になる。`RangeError` も、Storage の語彙でない `NOTE_CONTENT_TOO_LARGE` も出なくなる
- トレードオフ: **上限は `HtmlProcessor` の契約に属する定数として `domain/note/ports/htmlProcessor.ts` に置いた。** 値そのものはアダプターの実装事情（parse5 の費用）から決めているが、バックエンドごとに違うと「同じ本文がバックエンドによって通ったり通らなかったりする」ので、ポート側に 1 つ置く形にした
- トレードオフ: 深さ 257 段の文書・CSS 33 段のスタイルシートは保存できなくなる。実在の文書には無い深さだが、機械生成の HTML には理論上ありうる
- 残件: 費用のうち `parse5` 自体の解析時間は入力長に比例して残る（正当な 2 MB の本文で 3 秒前後）。これは形ではなく長さの関数なので、転送境界 2,000,000 バイトと SVG の 128 KB が上限として効いている
- 変異スポットチェック: 改行の bad-string 分岐を落とすと 5 ケースが red、url-token の識別子境界の判定を落とすと 1 ケース、CSS の深さの上限を +1 すると境界の 1 ケース、走査の歩数の meter を落とすと 1 ケース、木の深さの上限を `>=` にすると境界の 1 ケース、`createElement` の課金を落とすと膨張の 2 ケース、解析中の深さの番人を落とすと「木ができる前に拒む」1 ケースが red になる

---

## ADR-114: global statement の勘定は `purgeNote` を回す 3 経路すべてに適用し、結論だけを制約ごとに分ける

### Context

ADR-107 は「1 件の purge は global に 11〜12 statement を費やす」ことを `spec/platform/index.md` の正典に書き、`OWNER_PURGE_BATCH_SIZE` を 40 に下げた。しかしその勘定を `deleteNotesForOwner` にしか当てていなかった。同じ `purgeNote` / `purgeNoteInternally` を回す経路は 3 つある。

- `purgeExpiredTrash`（`TRASH_EXPIRY_BATCH_SIZE = 100`）→ 1 turn 1,100〜1,200 文。同じ節が「実上限 1,000 も超える」と名指しで不可能と宣言した数そのもの
- `emptyTrash` の同期削除（`EMPTY_TRASH_SYNCHRONOUS_LIMIT = 50`）→ 1 mutation 550〜600 文。設計上限 500 は超えるが実上限 1,000 の内側
- しかも `emptyTrash.ts` の JSDoc は「scope-local SQL carries no D1 budget」と、正典が新しく書いたことの逆を根拠付きで主張していた。手順の複製ではなく `purgeNote` を**呼ぶ**設計だからこそ、この経路は scope-local に閉じていない

勘定そのものは Cloudflare 実装で裏取り済み — `noteRouteStore` の `resolve` は `readRow` 1 文、`beginPurge` / `finishPurge` は `requireRow` 1 ＋ `commit(unchangedGuard, upsert)` 2 で 3 文、`removeForPurge` は `readStored` 1 ＋ `remove` の原子適用（vectorGuard 1 ＋ FTS withdraw 0〜1 ＋ body DELETE 1 ＋ tags DELETE 1）で 4〜5 文。`emptyTrash` 側の `resolve` は `scopeRouter.resolveNote` 経由で同じ `routeStore.resolve` に落ちる。

### Decision

勘定は 3 経路に一律で当てる。ただし**結論は制約が違うので分かれる**。

1. `TRASH_EXPIRY_BATCH_SIZE` を 100 → **40** へ下げる。この値は利用者に見える閾値を持たない alarm turn の内部値で、下げても画面も手順書も動かない。`deleteNotesForOwner` と同じ 40 を共有する
2. `EMPTY_TRASH_SYNCHRONOUS_LIMIT` は **50 のまま据え置く**。600 は実上限の内側であり、かつ 50 は「51 件以上はジョブ」という利用者に見える閾値として `spec/pages/index.md` / `spec/inventory/{usecase,frontend}.md` / `spec/manual-tests/editing.md` / `spec/design/pages/P14-trash.html` に固定されている。値を下げよという指摘は、その 6 つの正典を同時に動かす提案としてしか成立しない。**許容の根拠のほうを正典に書く** — 設計上限を超える 100 文は「実上限の半分を余裕として宣言した」その余裕から支払う、と
3. `emptyTrash.ts` の「scope-local SQL carries no D1 budget」は事実として撤回する
4. `spec/platform/index.md` の除外の列挙は追随者しか数えていなかったので、`purgeNote` を回す 3 経路を明示し、除外側を「`purgeNote` を回さない経路」と書き直す

### Alternatives

- **`EMPTY_TRASH_SYNCHRONOUS_LIMIT` も 40 へ下げて 3 経路を 1 つの値に揃える**: 見た目は整うが、閾値を 6 つの正典から同時に動かす変更になる。予算の勘定は「51 件以上はジョブ」という利用者向けの分岐を動かす理由として弱い — 600 は実上限の内側だからである
- **`purgeExpiredTrash` を「例外」として据え置き、根拠を書く**: 1,200 は実上限 1,000 も超えるので、書ける根拠が無い
- **1 件あたりの statement 数を減らす**（route の読みを `beginPurge` に畳む等）: アダプター契約に触れる変更で、今スライスの守備範囲外。ADR-107 と同じ判断

### Consequences

- 良い点: 「global 予算が上限を決める」判断が 3 経路に一貫して当たり、どこが例外でなぜ例外かが正典から読める
- 良い点: `EMPTY_TRASH_SYNCHRONOUS_LIMIT` は「予算の割り算の答え」ではなく「利用者に見える閾値」であることが JSDoc と正典に固定された。次に予算を数える人が黙って下げない
- トレードオフ: 期限切れが 41 件以上溜まった scope は turn 数が 2.5 倍になる。参照ランタイム（Node + memory）には D1 予算が無いので効くのはそこだけ
- トレードオフ: `100` を写している正典が担当外に 2 箇所残る（`spec/inventory/test.md` TC-note-343、`spec/testcases/note/purgeExpiredTrash.md`）
- 残件: `SCOPE_TASK_TICK_LIMIT = 100` により 1 invocation が `note.ownerPurgeContinued`（480）と `note.trashExpiryContinued`（480）を同居させうる。960 は実上限の内側だが、持ち回る停止 purge がその上に載ると超えうる。**分割の再設計はせず、余地の根拠として 1 行だけ正典に書いた** — 次の一手は 40 を下げることではなく 1 turn が訪問する purge 系 task を 1 本に絞ること、と明記してある
- 変異スポットチェック: `TRASH_EXPIRY_BATCH_SIZE` を 41 / 39 にすると TC-note-344 が red、`listPurgeable` の limit を +1 すると TC-note-343 の 2 ケースと TC-note-344 が red、`EMPTY_TRASH_SYNCHRONOUS_LIMIT` を 49 にすると TC-note-101 / 115 が、51 にすると TC-note-101 / 102 / 104 / 115 が red

---

## ADR-115: `HtmlProcessor` の資源上限は Storage の境界で `FileTooLarge` へ翻訳し、breakout tag の gate は「上限の根拠」から降ろす

### Context

`readSvgDocument` はコメントを `-->` まで、処理命令を `?>` まで読み飛ばす（XML の終端）。HTML のトークナイザーは `<?a>` を bogus comment として最初の `>` で、`<!-->` を abrupt-closing の完結したコメントとして即座に終える。この差の中に `<table>` を置くと、受理判定には見えないままパーサーには見える。レビュー 007 [B-001] の実証では、128 KB 以内・整形式・64 段以内の 2 形が `ensureAcceptable` を通り、`storeMedia` が `BusinessRuleError("NOTE_HTML_TOO_COMPLEX")` を投げた。このコードは `NoteErrorCode` にも `storeMedia` のエラー表にも表示辞書にも無く、UI では kind 共通の「入力内容を確認してもう一度お試しください」に倒れる（レビュー 007 backend-note [W-001] と同じ穴）。

### Decision

**構文を塞ぐ側は採らない。翻訳する側を採る。** 塞ぐのは「入力の形の論証」の 5 版目であり、ADR-113 がその路線を降ろした判断（資源で有界にする）と矛盾する。次に `<![CDATA[` や属性値の差を見つければ 6 版目が要る。

1. `storeMedia` の `processSvg` が `HTML_PROCESSOR_TOO_COMPLEX` を捕まえ、`BusinessRuleError(StorageErrorCode.FileTooLarge)` へ写す。翻訳先に `FileTooLarge` を選ぶのは、受理された 128 KB 以内の SVG が届きうる上限が**膨張の上限**（入力長の 4 倍）であり、その上限に当たる入力はサニタイズが完走していれば手順 4 の測り直しで同じ `FileTooLarge` になるからである — 翻訳は「費用を払えば得られたはずの答えを、払わずに返す」形になる。`UnsupportedMimeType`（「この形式は扱えない」）は SVG を受理形式として案内している辞書と矛盾し、利用者に直せるものを示さない。
2. `MEDIA_SVG_MAX_BYTES = 128 KB` の根拠を、受理する markup の形（エスケープの 6 倍、foster parenting の入口が 2 つ）から **`HtmlProcessorLimit.maxExpansionFactor`** へ置き換える。131,072 × 4 = 524,288 < 800,000 は入力の形に依存しない不等式で、これが「上限が到達可能である」ことの唯一の根拠になる。
3. breakout tag の gate は**残す**が、位置づけを「前段の安価な防御」に降ろす。1 パスの走査でもっとも安い膨張を断り、サニタイザーを 1 度も走らせない価値はそのままである。
4. `NoteErrorCode.HtmlTooComplex` を足し、ポートの定数はその別名にする。`spec/usecases/note.md` の `updateNoteBody` / `restoreNoteRevision` のエラー表と `errorDisplay.ts` の辞書に 1 行ずつ足し、`NOTE_HTML_TOO_COMPLEX` が「何を変えれば通るか」を言う文言で利用者へ届く経路を通す。

### Consequences

- 良い点: 「Storage の語彙で返す」という約束が、gate の完全性ではなく**境界の翻訳**で担保される。gate に穴が 1 つ残っていても約束は破れない
- 良い点: 128 KB の根拠が、実測に 3 度否定された種類の論証から、上限どうしの不等式へ変わる
- 良い点: 本文側（`updateNoteBody`）でも `NOTE_HTML_TOO_COMPLEX` が実行不能な共通文言に倒れなくなる
- トレードオフ: 隠された breakout tag は**サニタイザーを 1 度走らせてから**拒まれる（実測 11〜16 ms、膨張なし）。gate を通る分の費用は資源メーターが断つ
- トレードオフ: `FileTooLarge` は 128 KB 未満のファイルにも出うる。文言「ファイルが大きすぎます」は厳密には「この大きさでは扱えない」であり、利用者の取れる行動（小さく・単純にする）は一致する
- 変異スポットチェック: `processSvg` の翻訳条件を `false` にすると TC-storage-272 が red（`BusinessRuleError: HTML expands past 524256 bytes when parsed` が漏れる）、`readSvgDocument` の `<?` の終端を HTML と同じ「最初の `>`」にすると TC-storage-272 の受理側アサーションが red、`errorDisplay` の `NOTE_HTML_TOO_COMPLEX` の行を落とすと errorDisplay の 2 ケースが red

---

## ADR-116: 形の検査を打ち切る物差しは purpose の上限表から引く

### Context

`identifySvg` は `ensureAcceptable` から purpose に依らず呼ばれるのに、`readSvgDocument` を飛ばす条件に `media` 専用の定数 `MEDIA_SVG_MAX_BYTES` を直接使っていた（レビュー 007 backend-storage [W-003]）。これが正しいのは「SVG を許す purpose は `media` ひとつで、その上限がこの定数である」あいだだけで、`RULES` に別の上限で SVG を許す purpose が増えると、2 つの上限のあいだのバイト列が形を検査されずに受理される。

### Decision

`identifyContentType` / `identifySvg` に `purpose` を渡し、打ち切りの物差しを `RULES` から引く（`limitOf(purpose, "image/svg+xml")`）。SVG を許さない purpose では `undefined` が返るので、本文の復号にも入らずに `false` を返す。

### Consequences

- 良い点: 「上限表がそのまま許可リスト」という `RULES` の性質が、形の検査の打ち切りにも及ぶ。purpose が増えても定数を書き換える場所が増えない
- 良い点: `avatar` に SVG を投げた場合、従来は文書全体を復号・走査してから `UnsupportedMimeType` になっていたのが、復号せずに同じ答えを返す
- トレードオフ: **今日の観測可能な挙動は変わらない**（`media` 以外に SVG を許す purpose が無いため）ので、この変更を単独で赤にする変異テストは書けない。守っているのは将来の `RULES` の変更であり、防御は JSDoc ではなく導出そのものに置いた

---

## ADR-121: ED-04 の門は「モードが変わるか」ではなく「面へ載る本文と面が持つ本文の差」で判定する

### Context

ADR-104 は「WYSIWYG の面だけが `<style>` を落とし、その喪失は ED-04 の門の後ろへ寄せる」と決め、ADR-108 は門の材料を「これから面へ載る本文」に直した。それでも門の条件には `next !== mode` が残っていた — 門は「モードを変える瞬間」にしか評価されない。

一方 `WysiwygSurface` は `baseline` が変わるたびに無条件で `dropStyleElements` を掛ける。両者がずれる経路が 4 本あった。

1. **版の復元** — `restore` は `reseedFromServer(mode, true)`。WYSIWYG に居るまま変換前の版へ戻すと、戻したはずの `<style>` が面へ載る前に落ちる。ED-04 が「保存前に版が保持され、版から戻せる」と約束している当の機能が戻らない（`spec/manual-tests/editing.md` TC-06 手順 7）
2. **競合の解決** — `resolveConflict` は `reseedFromServer` を経由せず `reseed` へ直行する。共有ワークスペースで、他人が HTML モードで足したスタイルシートが自分の面から落ち、次の保存で本文からも消える
3. **退避の復元** — 退避は HTML モードで書かれた `<style>` 入りの本文でもありうる
4. **保存後の載せ直し** — `reseedIfUnchanged` が `acknowledged` を立てていた

どれも「面に載っている本文より装飾が落ちる」経路で、モードが変わるかどうかは関係が無かった。しかも `confirmed.body` には `<style>` が入ったまま残るので `dirty` が下りず、次の 1 打鍵で `body` が面の `innerHTML`（`<style>` 無し）に置き換わり、その保存で本文からも消える。装飾の喪失が警告も版理由（`wysiwygConversion`）も無しに起きる。

### Decision

門の問いを「WYSIWYG へ入るか」から「**これから面へ載る本文の装飾が、いま面に載っている本文より多く落ちるか**」へ変える。

- WYSIWYG へ**入る**とき（`mode !== "wysiwyg"`）の材料はこれまでどおり `target.mayLoseDecoration` と `willDropStyleElements(nextBody)` の or
- すでに WYSIWYG に**居る**とき（`mode === "wysiwyg"`）は、比較対象を**面がいま持っている本文**（`wysiwygRef.current.innerHTML`）にする。そこからは `<style>` が既に落ちているので、載せ直す本文が `<style>` を持てば新しい喪失である。`mayLoseDecoration` は入る瞬間の材料なので足さない — 足すと取り込み由来のノートで保存のたびに警告が出る
- 門に掛かったときの載せ先を `surfaceModeFor` に閉じ、**WYSIWYG から逃げる**（据え置きでは面がそのまま落とすので門が何も守らない）。逃げ先は HTML で、`initialMode` が `<style>` 持ちのノートを HTML で開くのと同じ理由である
- 4 経路すべてを同じ門に通す。`restore` / `reseedIfUnchanged` の `acknowledged` 固定を外し、`resolveConflict` は `seedMode(surfaceModeFor(...))` を経由させ、退避の復元は `switchMode(surfaceModeFor(...))` を挟む
- 面へ本文を載せるだけの経路が門を通せるよう、`seedMode` を `switchMode`（モードだけ）と `reseed`（確定＋載せる）に割った

### Consequences

- 良い点: 面が実際に落とすものと門が守るものが一致する。共有ワークスペースで他人の装飾が黙って消えない
- 良い点: TC-06 手順 7 の「元の装飾を持つ内容に戻る」が成立する（HTML モードで戻り、警告から WYSIWYG へ入り直せる）
- 良い点: 門の判定が「モードの遷移表」から「2 つの本文の比較」になったので、載せ直しの経路を足しても同じ 1 つの述語で守れる
- トレードオフ: 版の復元・競合の破棄で、利用者が触っていないのに面のモードが HTML へ移ることがある。装飾を黙って捨てるよりは良いという判断で、警告がその場で理由を説明する
- トレードオフ: 退避の復元で門に掛かった場合、警告の「了解して進む」は正本を引き直す（復元した退避は面から降りる）。退避そのものは `localStorage` に残っていて提案として出直すので失われない
- **ADR-108 の門の部分を置き換える**（材料が「これから面へ載る本文」であることは引き継ぎ、条件から `next !== mode` を外した）

---

## ADR-122: 確定値の遷移は 3 つで、部分確定は `VisualPaths` しか受けない 1 つに閉じる

### Context

ADR-108 は「確定値を動かせるのは `confirm` と `reseed` の 2 つだけ」と宣言していたが、実装には 3 つ目があった — `VisualSurface` の `onReady` が `setConfirmedSnapshot({ ...confirmedRef.current, visual: … })` を呼んでいる。`setConfirmedSnapshot` は `EditorSnapshot` を受けるだけなので、型は部分確定を何も妨げていない。「illegal state を型で潰した」と JSDoc が宣言している一方で、その宣言を根拠に読む次の書き手が同じ入口から 4 つ目の部分確定を足せる状態だった。

`onReady` の書き込み自体は正しい。面が組み上がったという事実は保存とは別種で、経路表は面が組まれるまで手元に無い。消せる 3 つ目ではない。

### Decision

3 つ目を**名前と型を持つ遷移**にし、汎用の書き込み口を消す。

- `attachVisualPaths(paths)` を足す。受け取るのは経路表だけなので、タイトルと本文はここから動かせない。`pathwise` の判定（`baseline === confirmed.body`）もここに閉じる
- `setConfirmedSnapshot` を**削除**する。`confirmedRef` と state を書くのは 3 つの遷移がそれぞれ自分で行う（各 2 行）。汎用の setter を残すと、それが「安全な入口」に見えてしまう
- JSDoc を実態に合わせる。遷移は 3 つで、写しを丸ごと動かせるのは 2 つ、3 つ目は経路表しか触れない。`commit` の `catch` が書く `{ ...confirmed, title }` は `confirm` を通る**完全な写し**であり、部分確定の入口ではない

### Consequences

- 良い点: 部分確定を書ける場所が引数の型で 1 か所に閉じる。4 つ目を足すには遷移を 1 つ書き足すことになり、そのとき `EditorSnapshot` の JSDoc が目に入る
- 良い点: 「型で閉じた」という主張と実装が一致する（CLAUDE.md の「illegal states unrepresentable」を根拠に読める記述だけが残る）
- トレードオフ: ref と state を揃える 2 行が 3 か所に散る。1 か所の funnel より書き落としやすいので、`confirmedRef` の JSDoc に「3 つの遷移がそれぞれ同じ行で揃える」と明記した
- **ADR-108 の「遷移は 2 つ」を 3 つへ改める**（写しを丸ごと動かす 2 つ、という性質はそのまま）

---

## ADR-117: 初回保存の URL 置き換えは書きかけが下りてから行い、blocker を素通りさせる

### Context

`/notes/new` の初回保存はノートを作ってから `router.navigate(..., { replace: true })` で編集の URL へ移していた。移る先は別のルートなので島はアンマウントされ、新しい編集画面はサーバーから読み直した本文で開く — 往復のあいだに打った分はどこにも無い。`confirm(sent, …)` が「送った写しだけを確定させる」ことで守った打鍵が、その 2 行あとで捨てられていた。

加えてこの navigate はルーターの blocker の下にある。`dirty` が真なら `leaveConfirmRef.current` は離脱確認なので、**利用者が何も操作していないのに**「未保存の変更があります」という素の `confirm()` が出る。取り消すと URL は `/notes/new` のまま残り、了解すると打鍵が消える。自動保存は 1.5 秒の無操作で走るので、打ち続けている利用者は普通に踏む。

### Decision

置き換えを保存の中から外し、`createdNote` state と effect に移す。

- `commit` は「作られたノート」を state に置くだけで、移らない
- effect は `dirty` が下り、版を進めうる往復（`busy`）も無いときにだけ移す。打鍵が残っていれば自動保存が 1.5 秒後に拾い、下りた描画で移る
- 遷移のあいだだけ `selfNavigateRef` を立て、blocker（`shouldBlockFn` / `enableBeforeUnload`）を素通りさせる

### Consequences

- 良い点: 往復中の打鍵が消えない。ADR-108 の「送った写しだけを確定させる」規則が、画面の遷移まで含めて成り立つ
- 良い点: 自分が起こした遷移で自分の離脱確認が出ない。利用者に選べることが何も無い確認を出さない
- トレードオフ: 打ち続けているあいだ URL は `/notes/new` のままである。`identity` は既に `existing` なので保存は正しいノートへ行くが、その状態で再読み込みすると画面の書きかけは失われる（サーバーには最後の自動保存まで入っている）
- トレードオフ: 置き換えが 1 描画ぶん遅れる。`replace: true` なので履歴には残らない

---

## ADR-118: 保存の失敗の案内は「退避できたか」ではなく「ノートが作られたか」で分ける

### Context

`SaveStatus.failed.stashed` は「実際に端末へ退避できたか」で、退避を書けるのは `commit` の `catch` だけである。ところが `classify(error)` をそのまま `setStatus` へ渡す経路が 3 つある — モード切替 / 破棄（`applyMode`）・競合の解決・版の復元。そこは正本を引き直す往復で、**ノートは確実に存在している**のに `stashed: false` で入る。

Alert は `status.stashed` の 1 本で分岐していたので、既存ノートで「ノートがまだ作られていないため、内容はこの端末に退避できていません」という事実に反する説明が出て、逃げ道が「内容をダウンロード」だけになり「再試行」が出なかった（`spec/pages/index.md#P-12` の「保存失敗 | 通信エラー（ローカル退避と再試行）」と逆を向く）。

### Decision

案内と逃げ道の分岐を `creationFailed`（= `identity.kind === "new"`）に掛け、文面を 3 通りに割る。

- ノートがまだ作られていない → ダウンロードのみ（再送は白紙のノートを増やす。ADR-112 と同じ理由）
- 退避できた → 再試行 ＋「次に開いたときに復元できます」
- 退避していないが既存のノート → 再試行 ＋「まだ退避していません」

`stashed` が語るのは 3 つ目の文だけになり、逃げ道の判断からは外れる。

### Consequences

- 良い点: 既存ノートで事実に反する説明が出ない。通信エラーの逃げ道（再試行）が 3 経路ぶん戻る
- 良い点: `stashed` の意味が「退避の有無」だけに縮み、`failed` を作る場所が増えても案内が壊れない
- トレードオフ: 保存以外の往復（版の復元など）が落ちたときの「再試行」は、その往復ではなく**保存**を走らせる。押して困ることは無い（書きかけがサーバーへ届く）が、押した操作と走る操作は一致しない

---

## ADR-119: 書き戻しは終端子を足さないだけでなく、**落とさない**

### Context

ADR-078 は「入力に無かった終端子を書き戻さない」で不動点を作った。逆向きの穴が残っていた。`filterCss` は文と規則の前置きを `input.slice(...).trim()` で切り出しており、**文字列を終わらせた当の改行**（CSS Syntax の bad-string。ADR 013 の 5 つ目の字句規則）が末尾にあると、それを落としてから `;` を書く。出力は `content:"a;` になり、そこから先はブラウザにとって開いたままの文字列なので、入力では効いていた後続の規則がまるごと値に飲まれる。

実測（出荷アダプター）: `<style>.o{content:"a⏎;position:fixed}⏎.p{color:red}⏎.q{font-weight:bold}</style>` は `position` を 1 件だけ除去して `.p` / `.q` を出力に残すが、ブラウザに届く規則は `.o` だけになる。`position` を含まない同じ形（`content:"a⏎;color:blue}⏎.p{…}`）は `removed` が空のまま `.p` を失う — 利用者からは「何も除去されていないのに装飾が消えた」になり、ADR 013 の「除去した内容は提示する」も空振りする。規則の前置き（`.o"a⏎{…}`）にも同じ経路がある。

### Decision

**`pushStatement` と前置きに渡す文字列の末尾の空白を落とさない。** 切り出しの始点は `filterBlock` が空白を読み飛ばしたあとなので、前方の trim はもともと無効であり、`trim()` を外すことは「末尾を保つ」ことと同義である。これで各文・各前置きの出力は入力の部分文字列そのものに戻り、ADR-078 の「足さない」と合わせて**書き戻しは入力の切り出しそのもの**になる。

閉じ引用符を補う案（`content:"a";`）は採らない。ブラウザが 1 つ目の宣言について計算する値そのものにはなるが、`css.ts` 冒頭の「filter は source が持たない `;` も `}` も供給しない」を破る。同じ約束を引用符について破れば、次に別の字句で同じ判断が要る。

「bad-string で終わる文とだけ特例で扱う」案も採らない。ADR-078 と同じ理由で、特例を数えるより「入力の切り出しをそのまま押す」1 つの規則のほうが短い。

### Consequences

- 良い点: 壊れた宣言の後ろの正当な装飾がブラウザに届く。安全側（`position:fixed` の除去）はそのまま
- 良い点: 不動点は保たれる（2 巡目が同じ位置で同じ分割をし、同じ部分文字列を押す）。サニタイズ表 209 ケース + 不動点の一覧が緑
- トレードオフ: **`;` の前後の空白の正規化を失う。** `.a { color: red }` は `.a {color: red }` になる（従来は `.a{color: red}`）。宣言の意味は変わらず、「取り込んだ HTML をそのまま保つ」（ADR 006）の側に寄る
- 変異スポットチェック: 文側の `trim()` を戻すと 5 ケース、前置き側の `trim()` を戻すと 1 ケースが red

---

## ADR-120: 解析は `<template>` で包んでから行う — parse5 は最上位の節点を 1 つずつ移す

### Context

4 つの資源上限のどれにも掛からない本文が、秒オーダーの CPU を焼いてから拒まれていた。`<p>xxxxxxxx</p>` を 130,000 個（1,950,000 バイト、転送境界の内側）は膨張 1.0 倍・深さ 3・CSS 0 で、`NoteHtml` の 800,000 バイト上限に当たるまで走り切る。**必ず失敗すると分かっている 1 リクエストに 1.5 秒**（参照ランタイムは HTTP と worker を兼ねる単一 Node プロセス、目標プラットフォームでは単一スレッドの DO）。

`--cpu-prof` を取ると、その 97.7% が parse5 の `detachNode` だった。`parseFragment` は最上位の節点をいったん解析用の根に付け、最後に返す fragment へ 1 つずつ移す（`_adoptNodes`）。移すたびに根の子配列に対して `indexOf` + `splice` が走るので、**最上位の節点数の二乗**になる。実測: 同じ入力を `<div>` で包むと 1,407 ms → 81 ms。入力長に対しても超線形で、600 KB で 200 ms、1.95 MB で 1,400 ms。

上限を足す案・上限を早く効かせる案はどちらも採れない。サニタイズは内容を大きく削りうる（ED-03 の中核要件は「スクリプト込み 1 MB → 数十 KB」）ので、**入力長から出力長を決めて事前に拒む安全な判定は無い**。かつ解析後の派生情報（見出し・本文テキスト）を後回しにしても、費用の 93% は解析そのものにある（実測: 解析 1,556 ms / それ以外 110 ms）。

### Decision

**解析は `<template>` を前置した `` `<template>${html}` `` に対して行い、その template の content fragment を結果として使う。** 最上位の節点は template の content に積まれ、解析用の根に残るのは包みの 1 つだけなので、二乗の移動が消える（1.95 MB で 1,407 ms → 87 ms）。

包みは**閉じない**。`</template>` を後ろに足すと、原文が閉じていない raw text 要素（`<plaintext>`、閉じていない `<style>`）の内容にその文字列が入り、「filter は source が持たない文字を供給しない」を解析側で破る。EOF が包みを閉じるので閉じタグは要らない。

**`</template` か `<form` を含む入力は従来どおり素で解析する。** parse5 で「template が開いているかどうか」に依存する分岐はこの 2 つだけである（`tmplCount` の参照箇所を全数確認した）: 前者は包みそのものを閉じ、後者は form 要素ポインタの扱いが変わって入れ子がずれる。どちらも安価な正規表現 1 本で振り分けられるので、包んだ結果を検査して再解析する（= 病的な入力で解析を 2 回払う）形にはしない。

木を数える meter には包みの 1 要素分（21 バイト）を上乗せして渡す。包みはこの module のものであって原文の膨張枠ではない。

fragment の文脈要素を `<div>` や `<body>` に替える案は採らない。それは挿入モードを "in body" に変えるので、最上位の `<tr>` / `<td>` / `<caption>` の扱いが変わる（parse5 の既定の文脈要素は `template` であり、包みはその挿入モードを保つ）。`detachNode` を tree adapter 側で速い実装に差し替える案も採らない — 配列の意味を保ったまま O(1) にはできず、解析中の他の `detachNode`（adoption agency / foster parenting）まで巻き込む。

### Consequences

- 良い点: 上限に掛からない大きい本文の費用が入力長に比例した範囲へ戻る。1.95 MB の平坦な本文で `process` 全体が 1,994 ms → 250 ms（vitest 内）。**拒まれる入力だけでなく、正当な大きい本文（ED-03 の取り込み）も同じだけ速くなる**
- 良い点: 上限も許可リストも触っていないので、`spec/adr/013` の 4 上限はそのまま
- 良い点: 出力は変わらない。許可リストの語彙で作った 20,000 個の無作為な markup で素の解析と包んだ解析が 1 バイトも違わず、違ったものはすべて上の 2 パターンに一致した。サニタイズ表 209 ケースも変更前と同一
- トレードオフ: `<form` を含む本文（保存済みの Web ページにはありうる）は素の経路のままなので速くならない。速さのために解析の意味を変えないほうを採った
- 残件: parse5 の `_adoptNodes` 自体は上流の問題である。包みはその回避であって修正ではない
- 変異スポットチェック: 包みを外して素の解析に落とすと TC-note-826 が red（同じ入力で 1/10 の本文に対する比が 10.2 倍 → 44 倍以上）
