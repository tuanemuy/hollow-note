### frontend

対象: `7-round-007.files`（197 行）のうち `apps/web/app/` の 38 ファイル全部と、`spec/pages/index.md` / `spec/manual-tests/editing.md` / `spec/design/` との整合。ゼロベースで読み直した（差分ではなく現物のファイルを読み、行番号は現物のもの）。判定済みキー（`triage-keys.md`）は再掲しない。

今ラウンドの 4 つの重点について先に結論を置く。

- **`EditorSnapshot` 1 つへの集約**: 確定値の書き込み口が `setConfirmedSnapshot` に絞られ、遷移が `confirm(sent, next)` / `reseed(title, body)` の 2 つ、面へ載せるだけが `loadSurface` に分かれた形は正しい。前ラウンドの B-001（往復中のタイトルが載せ直しに捨てられる）は `sameSnapshot`（`editor.tsx:139-140`）で閉じ、W-005（ビジュアルで `dirty` が下りない）も `confirm` の `setBody`（`836`）で閉じている。**ただし「型から部分確定が消えた」という JSDoc の主張は成り立っていない**（W-004）。
- **「送った写しを確定させる」規則の 5 経路**: 退避の復元（`1466`）・競合の上書き / 破棄（`1158-1163`）・版の復元（`1202`）・モード切替（`990-1013`）・破棄（`1121-1125`）はいずれも「確定値はサーバーが持っている値、面は載せるだけ」を守っている。**穴は確定の側ではなく ED-04 の門の側に残っている** — 門が `next !== mode` を条件に持つので、モードを変えずに `<style>` を持つ本文が WYSIWYG の面へ流れ込む 4 経路が素通りする（B-001）。
- **`SaveStatus` の `rejected`**: `classify`（`511-538`）の枝分けと、退避も再試行も出さない扱い（`1594-1622`）・打鍵で降りる扱い（`562-572`）・自動保存が自力で再開しない扱い（`923-938`）はすべて `spec/pages/index.md:317` の新しい行と一致している。ここは指摘なし。一方で**隣の `failed` のほうが壊れた** — 保存以外の 3 経路が `stashed: false` の `failed` を作るので、既存ノートで「ノートがまだ作られていない」と告げる（W-001）。
- **scrub の「落とす / unwrap」分割と `contain` の親**: `UNSAFE_DROP_ELEMENTS` / `UNSAFE_UNWRAP_ELEMENTS`（`surfaces.tsx:271-287`）は `adapters/html/allowList.ts` の `DROP_WITH_CONTENT` と一致し、`form` の非対称（前ラウンド W-001）は閉じた。直列化・再パースの窓も WYSIWYG の 2 経路（`surfaces.tsx:137-147` / `176-204`）から消えた。`:host` の閉じ込め（前ラウンド W-003）も `surfaces.tsx:619` と `NoteBody/index.tsx:173` の 2 か所で親側に入っている。ここも指摘なし。

#### Blockers

- **[B-001]** `apps/web/app/components/note/NoteEditor/editor.tsx:965-969` `needsWysiwygWarning` — **ED-04 の門が「モードを変える瞬間」にしか掛からないので、`<style>` を持つ本文が開いたままの WYSIWYG の面へ流れ込む経路がすべて素通りする**

  門の条件は `next === "wysiwyg" && next !== mode && (…)` である（`966-967`）。前ラウンドで門の材料は「これから面へ載る本文」（`willDropStyleElements(nextBody)`）に直り、`reseedFromServer` の中にも置かれた（`1043`）が、**`next !== mode` が残っているため、モードが変わらない載せ直しでは門そのものが評価されない**。一方 `WysiwygSurface` は `baseline` が変わるたびに無条件で `dropStyleElements` を掛ける（`surfaces.tsx:137-147`）。両者がずれる経路は 4 本ある。

  1. **版の復元**（`1184-1212`）— `restore` は `reseedFromServer(mode, true)`（`1202`）を呼ぶ。`acknowledged === true` に加えて `next === mode` なので、二重に門が効かない。
  2. **競合の解決**（`1128-1167`）— `resolveConflict` は `reseedFromServer` を経由せず `readEditState` を自分で呼んで `reseed(latest.title, latest.html)`（`1158` / `1163`）へ直行する。門を通す位置が構造上どこにも無い。
  3. **退避の復元**（`1446-1489`）— `loadSurface(draftOffer.title, draftOffer.html)`（`1466`）。退避は HTML モードで書かれた本文でもありうる（`writeDraft` の呼び出しは `771-777` の 1 か所で、`sent.body` はそのときのモードの本文）。
  4. **保存後の載せ直し**（`865-871`）— `reseedIfUnchanged` は `reseedFromServer(mode, true)` を呼ぶ。JSDoc（`867-868`）が「モードは変わらないので門は掛からない」と自ら書いている。

  いちばん素直に踏むのは 1 で、これは `spec/manual-tests/editing.md:124`（TC-06 手順 7「その版の『復元』を選ぶ → 元の装飾を持つ内容に戻る」）そのものである。TC-06 は手順 1〜3 で「装飾ノート → WYSIWYG へ切り替え → 了解して進む」を通るので、手順 7 の時点で利用者は **WYSIWYG に居る**。そこから変換前の版へ戻すと、`reseedFromServer` が引いた `latest.html` の `<style>` は面へ載る前に落とされ、画面上では装飾が戻らない。しかも `confirmed.body` と `body` state には `<style>` が入ったままなので `dirty` は下りたままで、**次の 1 打鍵で `body` が面の `innerHTML`（`<style>` 無し）に置き換わり、その保存で本文からも消える**。ED-04 が「保存前に版が保持され、版から戻せる」と約束している当の機能が、警告も版理由（`wysiwygConversion`）も無しに元へ戻らない。

  2 は共有ワークスペースの経路で、被害が他人の内容に及ぶ。A が WYSIWYG で開いている（`mayLoseDecoration === false` の素朴ノートなので警告は出ていない）あいだに B が HTML モードでスタイルシートを足す → A の保存が競合 → A が「自分の変更を破棄する」を選ぶ → `reseed(latest.html)` で B のスタイルシートが面から落ちる → A が 1 文字打った次の保存で B の装飾が本文から消える。`surfaces.tsx:334-335` の JSDoc が「失われることは ED-04 の門が先に告げる」と書いているのは、この 4 経路では偽である。

  直し方: 門の条件から `next !== mode` を外し、「面へ載せる本文が `<style>` を持つか」だけで判定できるようにする（`next === mode` のときに毎回警告が出ないよう、比較対象を「いま面に載っている本文」にするのでもよい）。そのうえで `resolveConflict` の 2 本を `reseedFromServer` と同じ門の内側へ寄せ、`restore` の `acknowledged` を `true` 固定にしない。門に掛かったときの扱いは既に `reseedFromServer:1043-1048` にある（正本は載せるがモードは据え置き、警告を出して了解を待つ）ので、載せ先を HTML へ倒すだけで一貫する。

#### Warnings

- **[W-001]** `apps/web/app/components/note/NoteEditor/editor.tsx:1008` / `1141` / `1207` — 保存以外の 3 経路が `stashed: false` の `failed` を作るので、**既存ノートで「ノートがまだ作られていないため、内容はこの端末に退避できていません」と告げ、再試行も出さない**

  `SaveStatus` の `failed.stashed` は「実際に端末へ退避できたか」だが（JSDoc `148-154`）、`stashed` を立てられるのは `commit` の `catch`（`771-777`）だけである。`classify(error)` をそのまま `setStatus` へ渡す 3 経路 — `applyMode`（`1008`、モード切替 / 破棄）・`resolveConflict`（`1141`）・`restore`（`1207`）— はいずれも `stashed: false` で入る。そこは通信エラーで落ちうる `readEditState` / `restoreNoteRevision` の往復で、**ノートは確実に存在している**。

  結果、Alert（`1551-1592`）は `status.stashed` の 1 本で分岐しているので、
  - 文面（`1590`）が「ノートがまだ作られていないため…」という**事実に反する説明**になり、
  - 逃げ道が「内容をダウンロード」だけになって「再試行」（`1562-1572`）が出ない。

  `spec/pages/index.md:316` の「保存失敗 | 通信エラー（ローカル退避と再試行）」に対して、退避も再試行も無い `failed` が 3 経路ぶん生まれている。詰みはしない（下端の「保存」は `!editable || busy || creationFailed` でしか落ちないので押せば復帰する）が、案内は逆を向いている。

  直し方: 文面と逃げ道の分岐を `status.stashed` ではなく `creationFailed`（`900-902`、= `identity.kind === "new"`）に掛ける。`stashed` が本当に必要なのは「退避したので次に開けば復元できる」の 1 文だけなので、3 通り（作られていない / 退避した / 退避していないが再試行はできる）に割るのが素直である。

- **[W-002]** `apps/web/app/components/note/NoteEditor/editor.tsx:1268` `settlePlaceholder` — HTML モードの差し替えが `String.prototype.replace` に**文字列**の置換値を渡しているので、ファイル名の `$'` / `$&` が本文の一部を注入する

  `setBody((value) => value.replace(placeholderPattern(id), markup))` の `markup` は `mediaMarkup(stored.url, stored.mimeType, file.name)`（`2277-2284`）で、`alt` に入るのは `escapeAttribute(fileName)`（`2274-2275`）である。`escapeAttribute` が落とすのは `&` / `"` / `<` の 3 つで、`$` は残る。置換値の中の `$'` は**マッチより後ろの文字列全体**に展開されるので、`a$'b.png` という名前のファイルを HTML モードで挿すと、本文の後半がまるごと `<img … alt="a` と `b.png">` のあいだへ生で差し込まれ、要素の境界が壊れる（`$&` / `` $` `` / `$$` も同様）。

  面は `scrubForSurface` を通るので `on*` が復活する経路ではないが、本文は壊れたまま次の保存でサーバーへ行く。WYSIWYG 側（`1252-1267`）は `node.replaceWith(inserted)` なので同じ穴が無い。

  直し方: `value.replace(placeholderPattern(id), () => markup)` にする（関数の戻り値は `$` 展開を受けない）。

- **[W-003]** `apps/web/app/components/note/NoteEditor/editor.tsx:651-670` — 新規作成の初回保存が**往復中の打鍵を確定させたうえで画面ごと移す**ので、`confirm` が守った打鍵がそこで捨てられる

  `commit` の `new` の枝は `confirm(sent, …)`（`643-647`）で「送った写し」だけを確定させる — ここまでは規則どおりで、往復のあいだに打った分は `title` / `body` に残り `dirty` のままになる。その直後に `router.navigate({ to: "/notes/$noteId/edit", …, replace: true })`（`651-667`）が走る。**移った先は別のルートなので島はアンマウントされ、新しい編集画面はサーバーから読み直した本文で開く** — 残っていた打鍵はどこにも無い。

  加えて、この navigate はルーターの blocker（`498-504`）の下にある。`leaveConfirmRef.current` は `dirty` が真なら `LEAVE_CONFIRM` なので、**利用者が何も操作していないのに「未保存の変更があります。このまま移動すると失われます。」という素の `confirm()` が出る**。取り消すと URL は `/notes/new` のまま（`identity` は既に `existing` なので以後の保存は正しいノートへ行くが、再読み込みで全部失われる）、了解すると上のとおり打鍵が消える。

  `spec/manual-tests/editing.md` TC-02 手順 1〜2 のような「打って待つだけ」では踏まないが、初回保存は 1.5 秒の無操作で走るので、打ち続けている利用者は普通に踏む。

  直し方: 置き換えを `dirty` が下りてから行う（写しが一致するまで待つ）か、この 1 回だけ blocker を素通りさせるフラグを立て、かつ移る前に残りの打鍵をもう 1 度 `commit` する。少なくとも「自分が起こした遷移で自分の離脱確認を出す」形は無くす。

- **[W-004]** `apps/web/app/components/note/NoteEditor/editor.tsx:104-115` / `300-314` — 「部分確定は型として書けない」という JSDoc の主張が実装と一致していない（確定値の書き手は 3 か所ある）

  `EditorSnapshot` の JSDoc（`105-108`）は「確定値を動かせるのは写し 1 つを丸ごと渡す 2 つの遷移（`confirm` と `reseed`）だけ」、`setConfirmedSnapshot` の JSDoc（`307-310`）は「1 つの項目だけを進める入口は持たない」と書いている。実際には、

  - `setConfirmedSnapshot` は `EditorSnapshot` を受けるだけなので、`{ ...confirmedRef.current, visual: … }` を書くことを型は何も妨げない。
  - `VisualSurface` の `onReady`（`1793-1806`）が **`confirm` / `reseed` を通さずに** `setConfirmedSnapshot({ ...confirmedRef.current, visual: { paths, pathwise } })` を呼ぶ。これは 3 つ目の遷移である。
  - `commit` の `catch`（`764-766`）も `confirm(sent, { ...confirmedRef.current, title: appliedTitle })` で、実質「タイトルだけ進める」確定である。

  どちらの呼び出しも**それ自体は正しい**（前者は「面が組み上がった」という確定とは別種の事実、後者は「rename だけ通った」という事実の写し取り）。問題は、illegal state を型で潰したと JSDoc が宣言していることで、CLAUDE.md の「Make illegal states unrepresentable at the type level before falling back to runtime checks」を根拠に読む次の書き手は、`setConfirmedSnapshot` を安全な入口だと信じて 4 つ目の部分確定を足せてしまう。

  直し方は 2 つのどちらか。(a) 実際に型で閉じる — `setConfirmedSnapshot` を非公開にし、`confirm` / `reseed` / `attachVisualPaths`（`onReady` 用）の 3 つだけを公開する。`attachVisualPaths` は `VisualPaths` しか受けないので、他の項目を触れない形になる。(b) JSDoc を実装に合わせ、遷移が 3 つあること（と `catch` の 1 件が `confirm` を通る理由）を書く。いま書かれている「2 つだけ」は、どちらでもない。

#### テスト保証

対象は `presentation/` と `components/note/__tests__/` の純関数テスト（新規のコンポーネントテストが無いことは指摘しない）。

- `presentation/__tests__/errorDisplay.test.ts:99-149` — 本スライスが到達する 11 コードを表で持ち、「kind の共通文言と**違う**こと」を押さえている。辞書から 1 行消せば必ず落ちる形で、文字列の丸写しより強い。`OPTIMISTIC_LOCK_FAILURE` をこの形で押さえられない理由（共通文言と同一で、それが正しい）が `112-115` に書かれ、代わりに HTTP 側（409）で押さえてある。`NOTE_LOCKED_BY_JOB` の「待って / もう一度お試しください ではない」（`126-134`）と、`STORAGE_*` の 2 用途併記（`136-148`）は文言の**意図**を検査していて、辞書を「それらしい別の文」に書き換えても落ちる。
- `presentation/__tests__/errorResponse.test.ts:53-72` — 「例外表に**入っていない**こと」を固定する向き。うっかり 401 / 410 を足すと落ちる。効いている。
- `components/note/__tests__/schema.test.ts:69-129` — 転送上限（2 MB）とドメイン上限（サニタイズ後 800 KB）の**関係**そのものを検査している。`107-129` は実際に `createHtmlProcessor().process()` まで通して「転送は通り、ドメインが `ContentTooLarge` で拒む」を突き合わせており、両側の数を独立に動かすと落ちる。本スライスで一番実効性の高いテスト。`classify`（`editor.tsx:528-532`）が `NOTE_CONTENT_TOO_LARGE` を `rejected` へ落とせるのは、この関係が保たれている限りである。
- `routes/__tests__/storage.delivery.test.ts` — 公開してよい purpose を、ルート側と `FILE_PURPOSES` の差分の両側から押さえている。`media` が加わった今回も、載せていない purpose が 404 に落ちることが編集なしで守られる形になっている。

弱いところ: 今回の Blocker（`needsWysiwygWarning` の `next !== mode`）と W-002（`String.replace` の `$` 展開）は、どちらも**純関数として切り出せる判定**の近くにありながらテストが無い。`willDropStyleElements`（`surfaces.tsx:351-355`）・`hasStyleElement`（`NoteEditor/index.tsx:147`）・`isSafeLinkUrl`（`editor.tsx:2158-2168`）・`diffTextNodeEdits` / `collectEditableTextNodes`（`textNodes.ts`）は DOM だけで完結する純関数で、とくに `collectEditableTextNodes` の経路づけはアダプターの `resolveTextNode` と噛み合わないと編集が全件 `pathNotFound` に落ちる — `docs/test.md`「Frontend: the bare minimum」の例外（`presentation/` の純関数）の趣旨からすれば、ここは同じ理由でテストに値する。前ラウンドと同じ指摘なので今回も件数には数えない。

前ラウンド W-002（scrub → 直列化 → 再パースの mXSS 窓）は、WYSIWYG の 2 経路が `replaceChildren` / `insertNode` に直って窓ごと消え、HTML プレビューの 1 経路は前ラウンドが提示した代替（「この窓を承知のうえで残す旨を JSDoc へ書く」）が `NoteBody/index.tsx:106-110` に入っている。閉じたものとして扱い、蒸し返さない。

#### カバレッジ

読んだファイル（`apps/web/app/` 全 38 ファイル）:

- `components/layout/ScopeToken/index.tsx`, `ScopeToken/listing.ts`
- `components/note/NoteBody/index.tsx`
- `components/note/NoteDetail/index.tsx`, `NoteDetail/detail.tsx`, `NoteDetail/menu.tsx`
- `components/note/NoteEditor/{index,editor,frame,skeleton,surfaces}.tsx`, `NoteEditor/{highlight,preferences,textNodes}.ts`
- `components/note/NoteList/board.tsx`, `NoteList/index.tsx`
- `components/note/TrashList/{index,board}.tsx`, `TrashList/action.ts`
- `components/note/schema.ts`, `components/note/__tests__/schema.test.ts`
- `presentation/errorDisplay.ts`, `presentation/__tests__/errorDisplay.test.ts`, `presentation/__tests__/errorResponse.test.ts`
- `routes/notes/-action.tsx`, `routes/notes/$noteId_.edit.tsx`, `routes/notes/new.tsx`, `routes/notes/trash.tsx`
- `routes/storage.$.tsx`, `routes/__tests__/storage.delivery.test.ts`
- `routes/workspaces/$workspaceId/-action.tsx`, `routes/workspaces/$workspaceId/notes/{index,new,trash,$noteId_.edit}.tsx`
- `routes/workspaces/$workspaceId/settings/-action.tsx`, `settings/route.tsx`
- `routeTree.gen.ts` — 生成物なので、6 本の新ルートが登録されていることの確認のみ

判断のために読んだ差分外のファイル: `packages/core/src/adapters/html/allowList.ts`（面の scrub の 2 集合が保存側の `DROP_WITH_CONTENT` と一致するかの突き合わせ）、`spec/pages/index.md`（P-11 / P-12 / P-14）、`spec/manual-tests/editing.md`（差分全量 + TC-04 / 06 / 11 / 17 / 19 / 21 / 23 / 24 / 30 / 32 / 33 の本文）、`spec/inventory/frontend.md`（PAGE-p12-001..008 / PAGE-p14-001..004）。

`ShellScope.canWrite` を渡す 4 か所（`workspaces/$workspaceId/notes/index.tsx:69` / `notes/trash.tsx:66` / `settings/route.tsx:76` / `-action.tsx` の 2 loader）はすべて省略していないことを確認した。`ScopeToken/index.tsx:180-186` の `switchTo` は遷移用の値なので省略で問題ない。

スキップしたファイル: なし（担当分は全量読んだ）。

記述の衛生: `apps/web/app/` 配下に `.thread/` への参照は無い（`spec/` / `docs/` / `packages/core/src/` を含めてリポジトリ全体で 0 件）。コード内の参照先は `spec/` の節と ADR 番号に閉じている。
