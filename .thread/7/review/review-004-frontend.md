### frontend

対象: `apps/web/app/` の全変更（`7-round-004.files` 189 行のうち 38 ファイル）と、`spec/pages/index.md` / `spec/manual-tests/editing.md` / `spec/design/pages/{P12-editor,P14-trash}.html` との整合。ゼロベースで読み直した。

`.thread/7/review/triage-keys.md` にある判定済みキー（`[W-006] NoteEditor/editor.tsx` の取り込み先セレクター、`[W-003] routes/storage.$.tsx:GET`、`[W-008] spec/pages/index.md:361`、`[W-010] NoteList/board.tsx:canMove` ほか）は再掲しない。

前ラウンドの Blocker 2 件は解消を確認した。B-001（面の外から入った本文が送られないまま「保存済み」になる）は `commit` の分岐条件が `mode === "visual" && body === savedBody`（`editor.tsx:519`）になり、`composeBody()`（427-431）が `composeEditedHtml(baseline, visualCurrent)`（1532-1543）を返すことで、退避・ダウンロード・競合の上書きが同じ定義を読む形になった。B-002（自動保存が破棄・明示保存・版の復元と同時に走る）は `EditorActivity` / `runExclusive`（95-105、269-282）に集約され、自動保存の門が `busy`（622）を見る形になった。`runExclusive` の早期 return は `try` の**外**（273）にあるので、入れなかった側が他人のロックを解放することはなく、`finally`（278-281）に到達しない枝も無い — デッドロックは無い。版を進めうる往復（`updateNoteBody` / `applyTextNodeEdits` / `renameNote` / `createNoteWithBody` / `restoreNoteRevision` / `getNote` の引き直し）はすべて `runExclusive` の中からしか呼ばれていないことを呼び出し元まで辿って確認した。ゴミ箱のノートの終端（`NoteEditor/index.tsx:50-52`、`NoteDetail/index.tsx:56-58`）と、`TrashedNoteView` / `RestoredNoteView` の `version` を応答から受け取る形（`detail.tsx:167-179` / `188-198`、`NoteList/board.tsx` の `onTrash`）も確認した。

#### Blockers

- **[B-001]** ビジュアルモードで、**自動保存の往復中に打った文字が「保存済み」として捨てられる**
  - 場所: `apps/web/app/components/note/NoteEditor/editor.tsx:519-535`（`commit` のビジュアル分岐）、とくに 532 行 `visualOriginal.current = new Map(visualCurrent.current);` と 534 行 `setVisualDirty(false);`
  - 理由: 送る差分は 520-523 行で `await` の**前**に組むのに、適用済みの基準（`visualOriginal`）は 532 行で `await` の**後**に `visualCurrent.current` を読み直して作る。`visualCurrent` は面の `input` ハンドラー（1375-1381）が往復中もそのまま書き換える ref で、`VisualSurface` は保存中も凍らない（`editable` は `locked` / `blocked` でしか降りない）。したがって往復のあいだに打った文字は、**サーバーへ送られていないのに** 新しい基準へ取り込まれる。続く 534 行が `visualDirty` を落とし、535 行の `settleSaved(appliedTitle, body)` が `body === savedBody` のまま `saved` にするので、`dirty` は `title !== savedTitle || body !== savedBody || visualDirty` の 3 項すべてが偽になり、自動保存はもう走らない。
  - 再現: ビジュアルモードでテキストノードを `A` に書き換える → 1.5 秒後に自動保存が走る → 応答が返るまでのあいだに `B` を打つ → 保存表示は「保存済み」になり、`B` はどこにも送られない。さらに続けて `C` を打つと、次の保存が送る `expected` は `AB`（往復後に取り込まれた値）でサーバーが持つのは `A` なので、`applyTextNodeEdits` は `contentChanged` で弾き、画面には「反映できなかった編集があります」（1297-1306）だけが出る。**利用者の打鍵が黙って消えたうえ、原因と無関係な文言が出る。**
  - 同種の欠陥が HTML / WYSIWYG に無いのは、あちらが `await` の**前**に確定した `currentBody`（440 行）を `settleSaved` に渡しており（558 行）、往復中の打鍵で `body !== savedBody` が残って自動保存がもう一度走るためである。ビジュアル分岐だけが「送った値」ではなく「いまの値」を確定済みにしている。
  - 直し方: 送る対象を 1 つの値に固定する。`const sent = new Map(visualCurrent.current);` を `await` の前に取り、差分は `diffTextNodeEdits(visualOriginal.current, sent)`、成功後は `visualOriginal.current = sent` とし、`setVisualDirty` は `false` の決め打ちではなく `diffTextNodeEdits(sent, visualCurrent.current).length > 0` で組み直す。`skipped` に落ちた経路まで基準に取り込んでいる点も同じ 1 か所で直る。

#### Warnings

- **[W-001]** 面を差し替える確認が、占有を取れなかったときに**確認だけ消えてモードが変わらない**
  - 場所: `editor.tsx:690-692`（`applyMode` が `setPendingMode(null)` / `setWysiwygWarning(false)` を `runExclusive`（697）より**前**に呼ぶ）と `editor.tsx:1212-1218`（WYSIWYG 警告の「了解して進む」に `disabled={busy}` が無い）
  - 理由: `runExclusive` は占有が取れなければ黙って `null` を返す設計なので、入口の側で「押せない」を保証しないと、押した痕跡だけが消える。同じ入口の `discard`（1049）・競合の 2 ボタン（1136 / 1144）・退避の「復元する」（1084）・版の「復元」（1475）はすべて `disabled={busy}` を持っているのに、「了解して進む」だけが持たない。到達経路: 既定モードの復元（312-331）で警告が出ている状態のままメディアを挿入する（`startSide` → `isSideBusy`）→ 警告の「了解して進む」を押す。警告は消え、モードは HTML のまま、何も起きない。
  - 直し方は 2 つあり、どちらでもよい: ボタンに `disabled={busy}` を足すか、`applyMode` の確認クリアを `runExclusive` のコールバック内へ移して「占有を取れたときだけ確認を畳む」形にする。後者のほうが入口を 1 か所に保つ設計と揃う。

- **[W-002]** `busy` が「版を進めうる往復」と「版を進めない往復」を 1 つに畳んでおり、**往復を伴わない操作まで自動保存のたびに止まる**
  - 場所: `editor.tsx:622`（`busy` の定義）と、それを読む `editor.tsx:1327`（`FormatBar`）/ `1496`（`MediaButton`）/ `1501`（「版を復元」）/ `1017-1018`（モードのラジオ）
  - 理由: `editor.tsx:261` の JSDoc は「版を進めない往復（メディアの保管・版一覧の取得）。並行してよい」と宣言し、実装も `startSide` で分けてある。ところが UI の活性は `busy = activity.kind !== "idle" || isSideBusy || isSubmitting` の 1 つだけを見るので、宣言した並行は画面上では起きない。とくに `FormatBar` の 6 コマンド（1709-1719）とリンク挿入は `document.execCommand` で面の DOM を触るだけで**往復を 1 回も持たない**のに、1.5 秒ごとの自動保存が走るたびに 1 往復ぶん暗くなる。面そのものは保存中も編集を受け付ける（打鍵はできる）ので、「打てるが太字にできない」という食い違った状態になる。correctness 上も止める理由が無い（打鍵と同じく `body !== savedBody` が残って次の保存が拾う）。
  - 「版を復元」（一覧の取得は `startSide`）とメディア挿入も同じ理由で保存中に落とす必要は無い。止める必要があるのは版を進めうる 4 つ（保存・破棄・モード切替・版の復元）だけなので、`busy` を「排他の占有」と「側の往復」に分けて、活性はそれぞれが要る側だけを読ませたい。

- **[W-003]** `EditorTarget` は判別ユニオンなのに、島に入った直後に**不正な組み合わせが作れる 3 つの独立した state へ展開される**
  - 場所: `editor.tsx:61-71`（`EditorTarget`）と `187-196`（`noteId: string | null` / `versionRef = -1` / `savedTitle = ""` / `savedBody = ""`）
  - 理由: `EditorTarget` は `new`（`noteId` も `version` も無い）と `existing`（両方ある）を型で分けているのに、島は `noteId === null` と `versionRef.current === -1` と `savedTitle/savedBody === ""` という 3 つの独立した値へ崩す。以降の分岐（446、693、781、813、916、1501）はすべて `noteId === null` だけを見て `versionRef` の整合は人手の約束に依存しており、`-1` は転送境界の `expectedVersion`（`components/note/schema.ts:51` の `z.number().int().min(0)`）が受け付けない値でもある。今は `-1` が送られる経路が無いことを追って確認したが、それは「型で無理」ではなく「読んで確かめた」に過ぎない。`EditorActivity` に判別ユニオンを入れた同じ判断を、ノートの同一性にも当てれば sentinel は消える（`useState<{kind:"new"} | {kind:"existing"; noteId: string; version: number}>` 1 本）。
  - 併せて `EditorTarget` の `styleMode`（69 行）は島の中で 1 度も読まれていない。RSC 境界を渡る死んだフィールドなので落としたい（`mayLoseDecoration` の材料としては `NoteEditor/index.tsx:102-103` が既にサーバー側で畳んでいる）。

- **[W-004]** 新規作成の初回保存だけ、確定済みのタイトルに**サーバーの正規化前の生値**を入れている
  - 場所: `editor.tsx:459`（`settleSaved(currentTitle, currentBody)`）。対比は同じ関数の 492-506 行と、その JSDoc（488-491）
  - 理由: 488-491 行は「確定値は**応答の値**である。`NoteTitle.manual` が空を『無題』に変え前後の空白を落とすので、送った生値を確定済みとして持つと `dirty` が下りない」と明文化していて、既存ノートの `rename` はそのとおり `renamed.title` を使う。ところが新規作成の枝は同じ正規化を通る `createBlankNote` の結果を待たずに `currentTitle` を確定済みにする。空タイトルで作ったノートは一覧・詳細では「無題」なのに、編集画面のタイトル欄だけが空のまま（`dirty` も下りているので直る契機が無い）で残る。前後空白を入れた場合も同じ。
  - `createNoteWithBodyFn`（`routes/notes/-action.tsx:371-436`）が `title` を返していないので画面側だけでは直せない。応答に `title` を足して（既に `getNote` を読んでいるので往復は増えない）、`settleSaved` へ渡すのが最小の直し。

- **[W-005]** アップロードの一覧と「再試行」が、**挿入を持たないビジュアルモードでも生き残る**
  - 場所: `editor.tsx:1385-1428`（`uploads` の描画にモードの条件が無い）、`750-762`（`replaceBody` は `uploads` を畳まない）、`864-867`（`sourceRef === null` のときの `insertMarkup`）
  - 理由: 1493-1497 行が明示するとおり ED-06 の挿入はビジュアルモードには存在しない（`MediaButton` も `onDropFiles` も渡していない）。しかし HTML / WYSIWYG で失敗したアップロードの行はモードを跨いで残り、その「再試行」（1408）はビジュアルモードでも押せる。押すと `insertMarkup` は `wysiwygRef` も `sourceRef` も持たない枝（866）に落ち、`body` の末尾へ生の `<span data-hollow-upload=...>` を継ぎ足す。面は `baseline` を描くのでその要素は画面に出ず、しかし `body !== savedBody` になるので、次の保存が `commit` の丸ごと分岐へ落ちて仮の要素ごとサーバーへ送られうる（成功すれば `settlePlaceholder` の正規表現置換が間に合うが、成否は往復の順序次第）。
  - `replaceBody` で `uploads` も畳む（面を載せ直した以上、前の面に挿していた仮の要素はもう無い）か、ビジュアルモードでは一覧を描かないかのどちらかで閉じる。

- **[W-006]** 「未保存の本文は live DOM に入るので `on*` を落とす」という規則を、**3 つの面のうち 1 つしか守っていない**
  - 場所: `NoteEditor/surfaces.tsx:182-232`（`scrubForPreview` とその JSDoc）、`surfaces.tsx:125-131`（`WysiwygSurface` の `surface.innerHTML = baseline`）、`surfaces.tsx:415-443`（`VisualSurface` が `baseline` を shadow root へ入れる）、`NoteBody/index.tsx` の新しい JSDoc
  - 理由: `scrubForPreview` の JSDoc は「**プレビューは live DOM** なので、保存前の本文をそのまま渡すと `<img onerror>` のようなハンドラーがこの画面で走る」と危険を名指しし、`NoteBody` の JSDoc も「ここへ届く本文は 2 種類あり、未保存のほうを落とす責任は渡す側にある」と受けている。ところが未保存の本文を live DOM へ入れるのは `HtmlSurface` のプレビューだけではない。`WysiwygSurface` は `baseline` をそのまま `innerHTML` に代入し、`VisualSurface` は `template.content` を shadow root へ移す。そして `baseline` に未保存の HTML が入る経路は実在する — 退避の「復元する」（`editor.tsx:1096-1099`）が `setBaseline(draftOffer.html)` を呼ぶ。
  - 実害は自分の端末で自分が書いた markup に限られる（退避はサーバーを通らない）ので Blocker には置かないが、**危険を明文化した JSDoc と実装が食い違っている**状態そのものが次の変更を誤らせる。`scrubForPreview` を 3 つの面の入口に共通で通すか、JSDoc の断言を「`HtmlSurface` のプレビューだけが通る」と実態に合わせるかのどちらかにしたい。

- **[W-007]** 版理由の辞書と `RevisionReason` が 2 行食い違っている
  - 場所: `editor.tsx:145-152`（`REVISION_REASON_LABEL`）と `packages/core/src/domain/note/noteRevision.ts:13-17`（`RevisionReason`）
  - 理由: 辞書は 6 行あるが、ドメインの union は `manualEdit` / `regeneration` / `wysiwygConversion` / `restore` の 4 つで、`conversion` と `referenceImport` はどこからも来ない。`listNoteRevisionsFn`（`routes/notes/-action.tsx:291-297`）は `revision.reason` をそのまま運ぶので、届く値は必ず 4 つのいずれかである。`?? revision.reason` のフォールバックがあるので画面は壊れないが、辞書が `Record<string, string>` で受けているために型でも落ちない。`Record<RevisionReason, string>` にして 4 行に揃えれば、理由が増えたときに辞書側が必ず落ちる。

- **[W-008]** `ShellScope.canWrite` が省略可の `boolean` で、「知らない」と「持っていない」が同じ値になっている
  - 場所: `apps/web/app/components/layout/ScopeToken/listing.ts:39-52`
  - 理由: JSDoc が「**省略は『出さない』と読む**」「ロールを読む画面は省略しないこと。省略は『知らない』であって『持っていない』ではない」と 2 段構えで読み方を規定しているのは、型がその区別を持てないからである。`canWrite === true` の判定（`ScopeToken/index.tsx:260`）は `undefined` と `false` を同じに扱うので、ロールを持っている loader が 1 行書き忘れた瞬間に、その画面でだけ editor から導線が消える — しかも型検査も lint も何も言わない（このラウンドで設定シェルに 1 行足したのは、まさにその漏れを塞ぐ修正である）。省略不可の `canWrite: boolean` にして、ロールを読まない側に「読まない」ことを型で言わせる（`Omit` した別の枝を持つ、あるいは `trash: "shown" | "hidden"` のように**判定結果**を運ぶ）ほうが、CLAUDE.md の「不正な状態を型で表現不能にする」に沿う。現時点で workspace scope を描く 3 つの loader（`notes/index.tsx:70`、`notes/trash.tsx:66`、`settings/route.tsx:76`）はすべて渡していることは確認した。

#### テスト保証

このスライスがフロントエンドに足した純関数テストが**実際に何を守っているか**（`docs/test.md`「Frontend: the bare minimum」の方針どおり、新規のコンポーネントテストが無いことは指摘しない）。

- `components/note/__tests__/schema.test.ts:67-130` — 転送上限 2 MB の境界（ちょうど通る / 1 文字超えて落ちる）を `updateNoteBodySchema` と `createNoteWithBodySchema` の両方で押さえたうえで、最後のケースが**両側突き合わせになっている**: 生 HTML 1.2 MB 相当（`<script>` 400 KB + 本文 400 K 文字）が転送を通り、実物の `createHtmlProcessor().process` が `NOTE_CONTENT_TOO_LARGE` を返すことまで見る。転送枠とドメイン上限を同じ数にした瞬間に落ちるので、`schema.ts:37-49` のコメントが主張する設計が実効的に固定されている。ここは fake を挟まずアダプター本体を呼んでいる点も良い。
- `presentation/__tests__/errorDisplay.test.ts:99-125` — 11 コードについて「辞書に載っている」ことを、文字列の写経ではなく **kind の共通文言と異なること**で判定している。文言を書き換えてもテストは壊れず、辞書から落ちたときだけ落ちる。`OPTIMISTIC_LOCK_FAILURE` をこの形では判定できない理由をコメントで明示して除外しているのも正しい。加えて `NOTE_LOCKED_BY_JOB` が「待って」を含み「もう一度お試しください」を含まないこと（127-136）と、共有ストレージコードが 2 用途・2 上限を名指しすること（138-150）は、共通文言へ倒れた瞬間に落ちる性質の検査になっている。
- `presentation/__tests__/errorResponse.test.ts:53-72` — 新コードが例外表に**入っていない**ことを 422 / 404 / 409 で固定する。「足さなかった」という判断は普通テストに残らないので、これは価値がある。
- `routes/__tests__/storage.delivery.test.ts` — ルートの GET ハンドラーを実物の memory `ObjectStorage` に対して回す。TC-storage-175 / 176 に加えて、`FILE_PURPOSES` の**補集合**を走査して 404 を確認する 106-136 行が効いている（鍵空間に purpose が増えたとき、このファイルを編集しなくても「載せる / 載せない」の判断を強制する唯一の場所）。`PUBLICLY_SERVED_PURPOSES` を読まずに正典を書き直している 110 行も、対にすべき片側として正しい。

守られていない範囲（次に足すならここ、の意味で）:

- `applyTextNodeEditsSchema`（`schema.ts:81-105`）が丸ごと素通り。`textNodePath` の正規表現（`/^\d+(\.\d+)*$/`）は `NoteEditor/textNodes.ts` の経路規約と `adapters/html/htmlProcessor.ts` の `resolveTextNode` に一致していなければ編集が全件落ちる境界そのもので、`TEXT_NODE_EDITS_TOTAL_MAX` の `superRefine` はこのファイルで唯一の手書き規則である。どちらも 1 ケースずつで固定できる。
- `noteMediaUploadSchema`（141-148）の `file.size > 0` と 256 MB 上限、`emptyTrashSchema` / `trashNoteSchema` などの新スキーマの否定ケースが無い。
- `errorDisplay` の辞書が、画面が実際に分類するコード（`editor.tsx:388-400` の `switch`）や `NoteErrorCode` / `StorageErrorCode` / `UsageErrorCode` と結ばれていない。`EDITING_CODES` は人手で維持された文字列の並びなので、ドメイン側のコードが改名されても辞書と一緒に静かに古くなる。列挙を import して突き合わせる形にできる。
- `storage.$.tsx:91-95` の `downloadName`（ヘッダーに置けない文字を落とす唯一の手書き関数）と、splat に `..` や絶対パスが来た場合の挙動が未検査。

#### カバレッジ

確認したファイル（`apps/web/app/` の全変更 38 ファイル）:

- `components/layout/ScopeToken/index.tsx`、`components/layout/ScopeToken/listing.ts`
- `components/note/NoteBody/index.tsx`
- `components/note/NoteDetail/{index,detail,menu}.tsx`
- `components/note/NoteEditor/{index,editor,frame,surfaces,skeleton}.tsx`、`components/note/NoteEditor/{highlight,preferences,textNodes}.ts`
- `components/note/NoteList/{index,board}.tsx`
- `components/note/TrashList/{index,board}.tsx`、`components/note/TrashList/action.ts`
- `components/note/schema.ts`、`components/note/__tests__/schema.test.ts`
- `presentation/errorDisplay.ts`、`presentation/__tests__/{errorDisplay,errorResponse}.test.ts`
- `routes/notes/{-action,new,trash,$noteId_.edit}.tsx`
- `routes/storage.$.tsx`、`routes/__tests__/storage.delivery.test.ts`
- `routes/workspaces/$workspaceId/-action.tsx`
- `routes/workspaces/$workspaceId/notes/{index,new,trash,$noteId_.edit}.tsx`
- `routes/workspaces/$workspaceId/settings/{-action,route}.tsx`
- `routeTree.gen.ts`（生成物。新ルート 6 本の登録と `notes/new` が `notes/$noteId` より先に一致することのみ確認）

差分外で判断のために読んだもの: `packages/core/src/application/note/view.ts`（`NoteDetailView.version` / `trashedAt`、`NoteListItemView.version`、`TrashedNoteListItemView`、`EmptyTrashView`、`NoteRevisionView` の突き合わせ）、`domain/note/{errorCode,noteRevision}.ts`、`domain/storage/errorCode.ts`、`domain/usage/errorCode.ts`、`application/storage/view.ts`、`spec/pages/index.md`（P-11 / P-12 / P-14）、`spec/manual-tests/editing.md`、`spec/design/pages/P14-trash.html`。

スキップしたファイル: なし（担当範囲の `apps/web/app/` は全量を読んだ。`packages/core/` と `spec/` の残りは他レビュアーの担当）。

記述の衛生: `apps/web/app/` に `.thread/` への参照は 1 件も無い（`grep` 済み）。コード内から参照している設計文書は `spec/adr/007` / `spec/adr/013` / `spec/design/index.md` / `spec/pages/index.md` / `spec/scenario/editing.md` のいずれも実在する。
