# レビュー 007 — backend-storage

`.thread/7/review/triage-keys.md` の判定済みキー（`[W-006] spec/domains/storage.md:273`、`[W-006] storeMedia.ts:resolveEditableNote`、`[W-002] collectOrphanMedia.ts:orphans`、`[W-009] application/usage/`、`[W-003] spec/adr/013:163`、`[W-003] routes/storage.$.tsx:GET`）は再掲しない。ラウンド 006 が閉じた「膨張率の新しい実測例」も、それ単体では持ち込まない。

### backend-storage

#### Blockers

##### [B-001] `packages/core/src/domain/storage/services/uploadValidationPolicy.ts:501-516`（`readSvgDocument` のコメント / 処理命令の読み飛ばし） — breakout tag の拒否は 8 文字で迂回でき、その結果 `storeMedia` が Note の語彙 `NOTE_HTML_TOO_COMPLEX` を漏らす

**要旨.** 受理判定は「breakout tag の要素名を含まない」ことを条件にしている（`spec/domains/storage.md:201` / `:225`、`spec/usecases/storage.md:149`）。しかし `readSvgDocument` が読み飛ばす**コメントと処理命令の終端が、HTML のトークナイザーのそれと違う**。この差の中に breakout tag を入れると、受理判定には見えないまま HTML パーサーには見える。

**実証（`createHtmlProcessor()` と `storeMedia` を直接呼んで確認。プローブは削除済み）.**

| 迂回 | 入力 | `ensureAcceptable` | `process()` |
| --- | --- | --- | --- |
| `<svg …><?a><table><b a="0">…<tr>X</tr>×13,000<?b?></svg>` | 130,672 B | **受理**（`image/svg+xml`） | `NOTE_HTML_TOO_COMPLEX`（`HTML expands past 522,688 bytes`）、11–16 ms |
| `<svg …><!--><table><b a="0">…<tr>X</tr>×12,000--></svg>` | 120,671 B | **受理** | 同上（`482,684 bytes`） |

- 処理命令: `readSvgDocument` は `<?` を見ると `?>` まで飛ぶ（:509-515）。HTML のトークナイザーにとって `<?a>` は**最初の `>` で終わる bogus comment** なので、後続の `<table>` は本物の開始タグとして foreign content を抜ける。
- コメント: `readSvgDocument` は `<!--` を見ると `-->` まで飛ぶ（:501-508）。HTML では `<!-->` / `<!--->` は abrupt-closing の**完結したコメント**なので、やはり後続が開始タグになる。
- 同じ差は `opensAsSvg` の `PROLOGUE_PARTS`（:143-148 / :191-220）にもあるため、根要素の**前**に置いても通る。

`storeMedia` を通した end-to-end でも `BusinessRuleError("NOTE_HTML_TOO_COMPLEX")` が投げられた（オブジェクトも行も残らないことは確認済み）。

**なぜこれがラウンド 006 の「閉じた話」の蒸し返しではないか.**

1. **DoS ではない**。ラウンド 006 で入った資源メーター（`HtmlProcessorLimit` / `createMeteredTreeAdapter`）が費用を `入力長 × 4` で断っており、実測 11–16 ms・膨張なしで終わる。膨張率の新しい実測例としての価値は無い。指摘しているのは**費用ではなく、正典が置いている命題の真偽**である。
2. `spec/adr/013-html-sanitization-policy.md:181` は「**『この入力の形なら費用は有界だ』という論証が 3 度続けて実測に否定された**」と書き、だから資源の上限へ切り替えたと宣言している。ところが `spec/domains/storage.md:199-201` は**その論証の 4 版目**を、受理規則（`:225` の「breakout tag の要素名を含まない」）と 128 KB の根拠として今も置いている。上の実証はそれを 4 度目に否定する。ADR と domain spec が同じスライスの中で反対のことを言っている。
3. `spec/usecases/storage.md:149` は gate の存在理由を「**Storage の語彙ではない形で失敗するため**」と明記している。gate が迂回可能である以上、その約束は守られていない — 実際に出るのは `NOTE_HTML_TOO_COMPLEX` で、これは `storeMedia` のエラーケース表（`spec/usecases/storage.md:157-165`、`spec/testcases/storage/storeMedia.md`）のどこにも無く、`apps/web/app/presentation/errorDisplay.ts` の辞書にも無いので UI では kind 共通の一般文言に落ちる。

**同じ原因で直すべき記述（1 件にまとめる）.**

| 場所 | 現状 | 実態 |
| --- | --- | --- |
| `uploadValidationPolicy.ts:43-53` | 「That mechanism has exactly two entrances, and both are named」 | 名前の前に**構文の読み飛ばし**という 3 つ目の入口がある |
| `uploadValidationPolicy.ts:466-470` | 「a bound on what the *sanitizer* can be made to produce」 | 上限を与えているのは資源メーターで、この述語ではない |
| `storeMedia.ts:178-187` | 「an accepted input cannot reach the parser's foster parenting」 | 到達する |
| `storeMedia.ts:280-283` | 「Sanitizing an over-quota upload first is bounded work — the intake caps an SVG at `MEDIA_SVG_MAX_BYTES` **and bounds its shape**」 | 有界なのは正しいが、根拠は intake の形の縛りではなく資源メーター |
| `spec/domains/storage.md:199` / `:201` / `:225` | 形の縛りが 128 KB の見積もりの前提／入口は 2 つ | 前提として成立しない |
| `spec/usecases/storage.md:149` | 迂回すると `NOTE_CONTENT_TOO_LARGE` や素の `RangeError` になる | どちらも起きない（先に `NOTE_HTML_TOO_COMPLEX`） |
| `spec/testcases/storage/storeMedia.md:23`、`spec/inventory/test.md:2053` / `:2608` | 「受理すると Note の語彙の `NOTE_CONTENT_TOO_LARGE` で落ちる」 | 同上 |

**修正の方向（どちらか、または両方）.**

- **塞ぐ**: `readSvgDocument` / `opensAsSvg` の `<?…?>` と `<!--…-->` を HTML のトークナイザーと同じ終端で読む（`<?` は最初の `>` まで、`<!--` は `<!-->` / `<!--->` / `--!>` を含む形で）。XML として正しいコメント・処理命令だけを通せば両者は一致する。塞いだうえで JSDoc / spec の主張を「資源メーターが最終的な上限で、名前の拒否と構文の一致は前段の安価な防御」と書き直す。
- **翻訳する**: `sanitizeSvg`（`storeMedia.ts:188-202`）で `HTML_PROCESSOR_TOO_COMPLEX` を捕まえて `BusinessRuleError(StorageErrorCode.UnsupportedMimeType)`（または `FileTooLarge`）へ写し、`spec/usecases/storage.md` のエラーケース表に載せる。「Storage の語彙で返す」という約束を、gate の完全性ではなく境界の翻訳で担保する形にする。

**テストの穴（同じ指摘に含む）.** `TC-storage-269`（`storeMedia.test.ts:807`）と domain 側の `TC-storage-269`（`storage.test.ts`）は、いずれも**歩行が見える位置**にある breakout tag しか与えていない。上の 2 つの構文に隠した形のケースが無いので、gate が塞がっているという主張はテストでも支えられていない。塞ぐ側で直すなら、この 2 形を境界値として足す必要がある。

#### Warnings

##### [W-001] `packages/core/src/domain/storage/ports/storedFileRepository.ts:73-76`（`listDeletableByNote`） — 「`id` 昇順」が port JSDoc と conformance だけの契約で、spec / 台帳に無い

このラウンドは順序を契約として明文化する作業を各所で行っている — `listByPurposeOlderThan` は `spec/domains/storage.md:297` と `spec/inventory/adapter.md` の ADP-storage-010 に全順序を書き、`spec/domains/tag.md` は `listByNote` / `deleteByNote` に「どの `limit` 件を消すかは契約であってバックエンドの裁量ではない」と書いた。

`listDeletableByNote` は同じ性質を持つ（100 件ずつの継続削除なので、途中の turn で残っている集合がバックエンド間で一致しないと `TC-storage-058` のような観測が成立しない）にもかかわらず、順序は port JSDoc（:70-71）と `adapters/conformance/storedFileRepository.ts` の ADP-storage-007 ケースにしか無く、`spec/domains/storage.md:284-295` にも `spec/inventory/adapter.md` の ADP-storage-007 行（「ノート削除対象 file を有界列挙する」）にも書かれていない。両アダプターは `ORDER BY id` / `sort(compareStrings)` で揃っているので実装のズレは無い。書く場所の基準が揃っていないだけである。

##### [W-002] `packages/core/src/application/storage/storeMedia.ts:302-350` — `put` と commit のあいだでプロセスが落ちた場合の窓が spec に無い

`storeMedia` は `objectStorage.put` を transaction の外・前で行い、transaction が**例外で失敗した**ときだけ `deleteMany` で補償する（:337-350）。`spec/usecases/storage.md:152`（手順 5）もこの補償だけを書き、その理由を「メディアには回収の手掛かりになる行が残らない」と説明している。

その理由がそのまま、書かれていない窓を作っている。`put` が返ったあと commit 前にプロセス／isolate が落ちると `catch` は走らず、行を持たないオブジェクトが残る。`collectOrphanMedia` は `StoredFileRepository` の行から走査するので永久に拾えず、`deleteFilesByOwner` も同じ。利用者への影響は無い（行が無いので容量に計上されず、鍵も配られていない）が、実体は恒久的に残る。

`storeUpload` は同じ窓を「孤児として回収に任せる」と書けるのに対し、`storeMedia` にはその受け皿が無い。少なくとも spec 手順 5 に窓を明記し、回収を持つスライスへの handoff として残すべきである（`spec/domains/storage.md` の `put` のストリーム化と同じ扱い方ができる）。

##### [W-003] `packages/core/src/domain/storage/services/uploadValidationPolicy.ts:601-613`（`identifySvg`） — purpose を知らずに `MEDIA_SVG_MAX_BYTES` で形の検査を打ち切る

`identifySvg` は `ensureAcceptable` から purpose に依らず呼ばれるが、形の検査（`readSvgDocument`）を飛ばす条件に `MEDIA_SVG_MAX_BYTES` という **`media` 専用の定数**を直接使っている。JSDoc（:594-600）は「it is refused for its size a step later」と正当化しているが、それが真なのは SVG を許す purpose が `media` ひとつで、その上限がこの定数であるあいだだけである。`RULES` に SVG を許す purpose が増えて上限が違えば、2 つの上限のあいだのバイト列は形を検査されずに受理される。

`RULES` は「上限表がそのまま許可リスト」という形で purpose ごとの上限を持っているのだから、この打ち切りも `limitFor(purpose, "image/svg+xml")` から引くか、少なくとも「SVG を許す purpose は `media` だけ」という前提を JSDoc に書いて型で守れないことを明示するべきである。

##### [W-004] `packages/core/src/domain/storage/services/uploadValidationPolicy.ts:7-20` — 「フォームに上限を配る」という約束が `media` だけ守られていない

`AVATAR_ALLOWED_MIME_TYPES` / `AVATAR_MAX_BYTES` の JSDoc（:7-11）は「published so an upload form can hint the same limits it will be judged against」と書き、実際に `components/settings/ProfileForm/editor.tsx:234` と `components/workspace/WorkspaceGeneralForm/editor.tsx:191` が MIME と**サイズの両方**を送信前に読む。

対する `media` 側は `MEDIA_ALLOWED_MIME_TYPES` だけが `components/note/NoteEditor/editor.tsx:2232` で使われ、`MEDIA_IMAGE_MAX_BYTES` / `MEDIA_VIDEO_MAX_BYTES` には**消費者が 1 つも無い**。結果として、200 MB の動画も 128 KB を超える SVG も転送境界（256 MB）まで往復してから初めて拒まれる。ED-06 の「サイズ上限超は弾かれる」は満たされているが、公開した定数の用途は満たされていない。定数を使う側を足すか、`avatar` と同じ約束を `media` にはしないことを JSDoc に書き分けるか、どちらかに寄せてほしい。

#### テスト保証

- **`storeMedia`（`__tests__/storeMedia.test.ts`, 37 ケース）** — 形式判定・上限・SVG のサニタイズ往復（namespace 復元、`&nbsp;` → `&#160;`、`</svg>` の後ろの残留、XML の空白 4 文字を物差しにした境界、`desc` / `title` 配下の許可リスト、深さ 64/65、breakout tag、`a` / `font` の非 breakout 版）・容量の測り直し（縮む／膨らむ両側）・trashed ノート・移動の窓・ロールバックまで、TC 行と 1:1 で押さえている。conformance に載らない値の一致（`view.size` = 行の `size` = 容量の増分）も 3 つ揃えて検証されている。**唯一の穴は B-001 の 2 形**（構文に隠した breakout tag）。
- **`collectOrphanMedia`（27 ケース）** — 30 日境界の包含、版の本文を参照元に数える（TC-storage-257）、ノート予算 5 での打ち切りと位置の前進（259）、満ページ継続とカーソルの前進（254、worker plane 経由も）、読めない payload（255）、turn 全体の失敗で位置を保つ（258）、transaction の外で本文を解析していることの検証（777 行目）まで揃っている。継続の条件が「回収数」ではなく「ページが満ちたか」であることを、実際に 2 turn 回して確かめている点がよい。
- **`deleteFilesForNote`（14 ケース）** — 250 行の 3 turn 分割、`completed` 済み障壁の通過（TC-storage-059）と別 operation の拒否（060）、冪等（061）、消えた行のスキップ（062）まで。
- **`relocateFilesForNote`（15 ケース）** — `stageTarget` が孤児掃引を armed にする 3 分岐（media あり／なし／既に media を持つ scope）が入り、`armOrphanMediaSweepOnFirstMedia` の「流入は 2 経路」という新しい契約の両側が押さえられている。
- **conformance（`adapters/conformance/storedFileRepository.ts`）** — ADP-storage-007 / 010 を追加。キーセットの 4 性質（排他的前進、同一時刻の id 同着、カーソル行が消えても位置が解決する、`(createdAt, id)` を成分ごとに比較すると壊れる形）を個別に固定しており、memory / cloudflare の両実装が同じ述語を通る。`listByPurposeOlderThan` の `after` を offset と取り違える実装は落ちる。
- **配信（`apps/web/app/routes/__tests__/storage.delivery.test.ts`, 4 ケース）** — `FILE_PURPOSES` の差分から「載せていない purpose は 404」を走査する形になっており、purpose が増えたときに編集なしで守られる。`PUBLICLY_SERVED_PURPOSES` と正典の literal を別々に置いて突き合わせているのも正しい（片側だけ動かすと落ちる）。
- **`ensureUploadAllowed`（6 ケース）** — 行が無い主体を初期値で判定して行を書かないこと、LLM の allowance が要求者のものであること（workspace 主体でも）まで。

#### カバレッジ

**確認したファイル**

- `packages/core/src/domain/storage/services/uploadValidationPolicy.ts`
- `packages/core/src/domain/storage/services/storageUrlPolicy.ts`
- `packages/core/src/domain/storage/ports/storedFileRepository.ts`
- `packages/core/src/domain/storage/__tests__/storage.test.ts`
- `packages/core/src/domain/storage/valueObject.ts` / `storedFile.ts`（差分外・判断のため）
- `packages/core/src/application/storage/storeMedia.ts` / `collectOrphanMedia.ts` / `deleteFilesForNote.ts` / `relocateFilesForNote.ts` / `view.ts` / `deleteFiles.ts`（差分外）
- `packages/core/src/application/storage/__tests__/` 5 ファイル（`storeMedia` / `collectOrphanMedia` / `deleteFilesForNote` / `relocateFilesForNote` / `deleteFiles`）
- `packages/core/src/application/usage/ensureUploadAllowed.ts` と `__tests__/ensureUploadAllowed.test.ts`
- `packages/core/src/application/ports/objectStorage.ts`
- `packages/core/src/application/note/jobs.ts:143-177`（`storageUrlPolicyOf`。差分外・`StorageUrlPolicy` の唯一の組み立て点）
- `packages/core/src/adapters/conformance/storedFileRepository.ts`
- `packages/core/src/adapters/memory/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/cloudflare/do/repositories/storedFileRepository.ts`
- `packages/core/src/adapters/html/htmlProcessor.ts:740-900`、`allowList.ts:255-300`、`packages/core/src/domain/note/ports/htmlProcessor.ts`（差分外・SVG の受理判定と資源上限の突き合わせのため）
- `apps/web/app/routes/storage.$.tsx` と `apps/web/app/routes/__tests__/storage.delivery.test.ts`
- `apps/web/app/routes/notes/-action.tsx:328-359`（`storeNoteMediaFn`）、`apps/web/app/components/note/schema.ts:134-149`（`noteMediaUploadSchema`）
- `apps/web/app/presentation/errorDisplay.ts`（STORAGE_* / USAGE_* の文言）
- `spec/domains/storage.md`、`spec/usecases/storage.md`、`spec/testcases/storage/{storeMedia,collectOrphanMedia,deleteFilesForNote}.md`、`spec/database/index.md`、`spec/domains/index.md`（継続要求表）、`spec/inventory/{adapter,test}.md` の storage 分、`spec/adr/013-html-sanitization-policy.md`

**スキップしたファイル**（担当外）

- `apps/web/app/components/**`（`note/NoteEditor/*`、`note/TrashList/*`、`note/NoteDetail/*`、`layout/ScopeToken/*`）— `editor.tsx:2232` の `MEDIA_ALLOWED_MIME_TYPES` 参照だけを見た。frontend 担当
- `apps/web/app/routes/notes/{new,trash,$noteId_.edit}.tsx` と `workspaces/$workspaceId/notes/*`、`routeTree.gen.ts` — frontend 担当
- `packages/core/src/application/note/**`（`storeMedia` が呼ぶ `accessControl` / `editing` / `jobs` を除く）、`domain/note/**`（`ports/htmlProcessor.ts` を除く）— backend-note 担当
- `packages/core/src/adapters/html/{allowList,css,htmlProcessor}.ts` の全体と `__tests__/htmlProcessor.test.ts` — SVG の受理と資源上限に関わる範囲だけ読んだ。backend-note 担当
- `packages/core/src/domain/tag/**`、`domain/integration/**`、`application/tag/**`、`application/integration/**`、対応する adapters / conformance / spec — backend-tag 担当
- `packages/core/src/application/{cleanup,di,execution,identity,workers}/**`、`adapters/memory/{store,scopeUnitOfWork}.ts`、`adapters/cloudflare/**`（`storedFileRepository.ts` を除く）— 横断担当
- `pnpm-lock.yaml`、`packages/core/package.json`

**備考.** 検証に使った一時テストは 2 件とも削除済み（`domain/storage/__tests__/zzprobe.test.ts`、`application/storage/__tests__/zzprobe2.test.ts`）。作業ツリーには他エージェントのものと思われる `packages/core/src/adapters/html/__tests__/zzprobe.test.ts` が残っているが、当方の作成物ではないため触れていない。`pnpm vitest run --project node` の storage / usage / 配信ルート分 13 ファイル 222 ケースは全て green。
