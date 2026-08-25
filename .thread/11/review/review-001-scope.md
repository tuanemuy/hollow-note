### Scope business / 投影・全文検索 / R2

#### Blockers

- **[B-001]** AC-5 で canon に書き込んだ `4n + 3` は「1 turn の SQL 文の総数」ではない。実際に scope object が実行する文はおよそ **`8n + 9`**
  - 場所: `packages/core/src/adapters/cloudflare/do/scopeObject.ts:126-149`（`bind`）/ `packages/core/src/adapters/cloudflare/do/scopeObject.ts:54-73`（`query` / `applyWriteSet`）/ `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts:88,101,255` / `spec/platform/index.md:154`
  - 理由: 計測 harness（`counting`）が数えているのは **`ScopeSqlExecutor` の呼び出し回数**と**write-set に積まれた文の配列長**であって、Durable Object の中で走る SQL 文ではない。`ScopeObject.query` / `applyWriteSet` はどちらも先頭で `bind(scopeKey)` を呼び、`bind` は毎回 `INSERT INTO _scope_identity … ON CONFLICT DO NOTHING` と `boundScope()` の `SELECT` を実行する。したがって読み 1 往復は 3 文、commit 1 往復は `2 + (2n+1)` 文になり、n 件のバッチで実際に走るのは `3(2n+2) + (2n+3) = 8n + 9` 文。既定バッチ 100 件なら ADR-025 が書いた「403 文」ではなく 809 文である。AC-5 の要求は「実測し、満たせないなら**実測値へ**改める」であり、実測していない数字を `spec/platform/index.md` に固定したことで、canon が実装より 2 倍楽観的な値を持つ状態になった。`spec/platform/index.md` は「Cloudflare 実装の実測」と明記しているので、読み手はこれを DO 内の文数として読む。加えて `bind` は**読み経路に毎回書き込み文を混ぜている**（ロールバック不能な、`transactionSync` の外の INSERT）ことも、この行からは読めない。
  - 提案: 二択のどちらか。(a) `ScopeObject` のインスタンスに束縛済み `ScopeKey` をメモ化し、初回 RPC 以外は `bind` が 0 文で済むようにする（読み経路から書き込みが消える副次効果もある。物理分離の保証は「初回に pin して以降は突き合わせる」で変わらない）。そのうえで harness が数える値を実 SQL 文数に一致させ、`4n + 3` を維持する。(b) メモ化しないなら、`spec/platform/index.md:154` と `.thread/11/adr.md` の ADR-025 の数字を「往復 `2n + 3` 回・write-set 文 `2n + 1` 文・DO 内実行文 `8n + 9`」の形に書き直し、`deleteFilesByOwner.test.ts:88` のコメント（「`query` calls — one SQL statement and one round trip each」）も直す。どちらにせよ、harness が数えていない量を「実測」と呼ばないこと。

#### Warnings

- **[W-001]** `public_note_search` に private / trashed の行まで投影され、可視性の絞り込みが read 側だけに置かれている
  - 場所: `packages/core/src/adapters/cloudflare/d1/repositories/publicNoteQueryService.ts:36`（`PUBLISHED`）/ `packages/core/src/adapters/cloudflare/d1/repositories/publicNoteProjection.ts:31-56`
  - 理由: `spec/database/index.md#public_note_search--public_note_search_tags--public_note_search_fts` は「`lifecycle = 'active' AND visibility = 'public'` の行だけを持つ」と定め、[ADR 021](../../../spec/adr/021-scope-sharded-data-plane.md) も「D1 の `public_note_search` には `public` かつ `active` の行だけを投影する」と書いている。実装は `replaceSnapshotIfNewer` が可視性を一切見ずに完全 snapshot を書き、`searchPublic` / `listPublicSitemapEntries` / `listPublicAuthors` の 3 か所で述語を掛けて隠している。今日は 3 経路すべてに述語があるので漏洩は無いが、(1) **private ノートの本文（`text`、最大 800,000 バイト）と FTS bigram が scope DO を出て global D1 に複製される**。scope 分割の主目的（ADR 021）と、`spec/platform/index.md`「global容量」の見積り（`公開Note件数 × p95投影行サイズ × FTS/索引実測係数`）の両方が崩れる。(2) 公開読みは PK キーセット走査に述語を重ねる形なので、非公開行の比率だけ sitemap / author 列挙のスキャン量が増える。(3) 述語を 1 か所書き忘れた瞬間に非公開本文が公開エンドポイントへ出る。memory バックエンドが同じ形（`adapters/memory/repositories/publicNoteQueryService.ts:57`）なので本 PR だけの逸脱ではないが、プロセス内 Map と global D1 では露出の意味が違う。
  - 提案: `replaceSnapshotIfNewer` が `entry.visibility !== "public" || entry.lifecycle !== "active"` を受けたら「行を消して世代だけ記録する」か「`removeIfNewer` 相当へ倒す」形にするのが本来。世代ベクトルの比較可能性を捨てられないなら、`spec/database/index.md` と ADR 021 の該当文をそちらへ改めたうえで、`.thread/11/adr.md` ではなく `spec/adr/` に判断を残すこと（両バックエンドが同じ振る舞いなので ADR 046 の「正本のある側へ倒す」対象）。

- **[W-002]** 検索の 1 ページが `SELECT ns.*` で `text` 列（最大 800,000 バイト）を limit 件ぶん引き上げる
  - 場所: `packages/core/src/adapters/cloudflare/do/repositories/localNoteQueryService.ts:130` / `packages/core/src/adapters/cloudflare/d1/repositories/publicNoteQueryService.ts:133`
  - 理由: `NoteSummary` / `PublicNoteSummary` に `text` は無く、この列を使うのは `highlightExcerpt` が **`excerpt` に一致が無かったとき**だけである（`projection/noteSearchRow.ts:toSummary`）。ところが実装は全行の `text` を常に取ってくる。local 側は DO の RPC を、public 側は D1 の応答を通るので、limit 20 のページが最悪 16 MB を運ぶ。Workers の memory 128 MB（`spec/platform/index.md`「実上限」）と D1 の応答サイズに対して素直でないし、ADR 017 が `note_search` の行サイズを 824,000 バイトと見積もった前提が「この列は投影のためにあり、読みでは運ばない」ことに乗っている。
  - 提案: 列を明示し、`text` は「`excerpt` に一致が無かった行」に対してだけ 2 段目のクエリで引く（キーワード有りかつ excerpt 不一致の行だけなので通常 0〜数件）。あるいは `substr(text, 1, N)` を投影して窓の候補に絞る。

- **[W-003]** `noteRevisionRepository` が `html` を含む全列を毎回読み、削除は 1 行 1 文
  - 場所: `packages/core/src/adapters/cloudflare/do/repositories/noteRevisionRepository.ts:91`（`rowsOfNote`）、`:146`（`listByNote`）、`:163`（`deleteOlderThanNewest`）、`:172`（`deleteByNote`）
  - 理由: 保持は 1 ノート 20 版・1 版 800,000 バイト（ADR 017）なので、`deleteByNote` / `deleteOlderThanNewest` は**消すためだけに最大 16 MB を DO から Worker へ運ぶ**。`listByNote(noteId, 5)` も 20 版すべてを読んでから `slice(0, 5)` している。加えて削除は `remove(...)` を行数ぶん並べるので、`sql/json.ts` に `deleteRowsFromJson` があるのに使わず、`spec/database/index.md`「共通の規約」の「ID の並びで消すクエリは `?` を件数ぶん並べない／多行 INSERT も 1 文にまとめる」の趣旨から外れている（`?` の上限には触れないが 1 文にはなっていない）。
  - 提案: 削除・件数判定の経路は `SELECT id, created_at FROM …` に絞り、削除本体は `deleteRowsFromJson` の 1 文にする（overlay が要るなら `remove` の `statement` を 1 文の共有オブジェクトにせず、`opaque` 1 文 + overlay 用の軽い `remove` に分ける形でもよい）。`listByNote` は `LIMIT ?` を SQL に落とす。

- **[W-004]** `readForUpdate` の事前読みが save / delete ごとに 1 往復を足しており、これが AC-5 の `2n` の出どころ
  - 場所: `packages/core/src/adapters/cloudflare/do/repositories/storedFileRepository.ts:263` / `packages/core/src/adapters/cloudflare/do/repositories/noteRepository.ts:298`（同型が `storageQuotaRepository` / `llmUsageRepository` にもある）
  - 理由: 正しさの砦は `occGuard` であり、事前読みは「エラーが commit ではなく呼び出し地点で出る」ことしか足していない。適合スイートは scoped port を **autocommit セッション**で組んでいる（`__tests__/conformanceBackend.ts` の `forScope` が `createAutocommitSession`）ので、`session.write` が即適用され、guard 単独で `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が呼び出し地点に出る。つまり契約上この読みは不要である。ADR-025 は `application/identity/updateProfile.ts` が呼び出し地点で `OPTIMISTIC_LOCK_FAILURE` を捕らえることを根拠にしているが、そこは global plane の話で、scope の staged セッションで同じ分岐を必要とするユースケースは今日存在しない。全 scope リポジトリの mutating 呼び出しを一律 2 倍にする代償として釣り合っているかは、ADR-025 の「範囲外」ではなく本 PR の判断として明示すべき。
  - 提案: 少なくとも staged セッション（`session.staged === true`）では事前読みを落とし、guard だけに委ねる形を検討する。落とせないなら、ADR-025 に「呼び出し地点でのエラーのために読みを 2 倍にする」ことをトレードオフとしてもっと正面から書く（現状は 1 段落の補足になっている）。

- **[W-005]** `mapPositions` が **1 文字ずつ** NFKC を掛けており、索引側・needle 側の「文字列全体の NFKC」と一致しない
  - 場所: `packages/core/src/adapters/cloudflare/search/highlight.ts:54-70`
  - 理由: NFKC は合成を含むので、文字単位の適用は文字列全体の適用と等しくない。本文が結合列（`か` + U+3099）で保存されている場合、`bigramIndexText`（`normalizeForSearch(value)` を文字列全体に掛ける）は `が` を索引に入れるので FTS はヒットするが、`mapPositions` の `normalized` は `か` + 濁点のままなので `searchRunsOf("が")` の needle `が` が見つからず `highlightedExcerpt` が `null` になる。`spec/database/index.md#ハイライトと抜粋の生成` は「照合は前処理の 1〜2 段目だけを**検索語と対象テキストの双方に**適用した文字列同士の部分一致」と定めており、片方だけ文字単位というのは規定と違う。取り込んだ HTML 由来の本文は NFD 混じりが普通に起こりうる。
  - 提案: `normalizeForSearch(source)` を一度掛け、写像は「正規化後の各コード単位 → 元テキストの区間」として作る（`Intl.Segmenter` で書記素単位に切ってから 1 単位ずつ正規化する、あるいは元テキストを先に NFC/NFKC 前提へ寄せる）。少なくとも「文字単位 NFKC は全体 NFKC ではない」ことを既知の限界として `spec/database/index.md`「既知の限界」に足す。

- **[W-006]** `tagFilter` が `tagNames` の重複を許さず、memory バックエンドと結果が食い違う
  - 場所: `packages/core/src/adapters/cloudflare/projection/searchClauses.ts:54-57`（呼び出しは `localNoteQueryService.ts:118`、`publicNoteQueryService.ts:127`）
  - 理由: `COUNT(DISTINCT t.normalized) = ?` に渡すのが `criteria.tagNames.length` なので、`["work","work"]` が来ると左辺は 1、右辺は 2 で必ず 0 件になる。memory 側は `criteria.tagNames.every(...)` なので重複は無害。`tagNames` は `readonly string[]` で、ポートにも一意性の記述が無く、今日の呼び出し元（検索ユースケース）がまだ無いので露見していないが、同じ入力で 2 バックエンドの答えが違うのは ADR 026 が禁じている状態。
  - 提案: 右辺に `new Set(criteria.tagNames).size` を使う（`jsonList` にも重複を除いた配列を渡す）。あわせてポート JSDoc に「正規化済み・重複なし」を書くか、適合スイートに重複ケースを 1 本足す（足すなら memory も同じスイートを通ること）。

- **[W-007]** `listMonthsWithNotes` が所有者の active ノート全件を Worker のメモリへ引き上げる
  - 場所: `packages/core/src/adapters/cloudflare/do/repositories/localNoteQueryService.ts:145-160`
  - 理由: `SELECT DISTINCT created_at … WHERE owner … AND lifecycle='active'` に上限が無い。`created_at` はミリ秒なので実質ノート 1 件 1 行で、10 GB まで伸びる scope（`spec/platform/index.md`「SQLite-backed Durable Objects」）では数万〜数十万行が 1 RPC で返る。`spec/platform/index.md`「Scope DO」の分割単位表は他の全経路に 50〜200 行の上限を置いており、ここだけ無制限。タイムゾーン変換を JS でやる判断（`projection/viewerCalendar.ts`）は妥当だが、それは「全行を返す」理由にはならない。
  - 提案: `MIN(created_at)` / `MAX(created_at)` を 1 文で取り、その範囲の月境界を JS で列挙して、月ごとに `EXISTS` を 1 文で確かめる（月数は有限）。あるいは `created_at` を UTC 日でグルーピングしてから境界日だけ個別判定する。

- **[W-008]** `R2.deleteMany` が 1 回の `bucket.delete` に渡す key 数の上限（1,000）を確認しない
  - 場所: `packages/core/src/adapters/cloudflare/r2/objectStorage.ts:116-126`
  - 理由: ポートは「複数形の `deleteMany` だけが存在する」と定めており、件数の上限は書いていない。今日の呼び出し元は `expired artifact / orphan media 100 files` などの有界経路だが、`storage.fileDeleted` の購読者がバッチを大きくした瞬間に R2 側の上限で `ExternalApiError` になる。上限は R2 の制約であってアダプターの内側にあるべき知識。
  - 提案: `deleteMany` 側で 1,000 件ずつチャンクして順に消す（不在許容なので再実行も安全）。`spec/platform/index.md` の R2 表にこの上限行を足すのも合わせて。

- **[W-009]** `redactAuthor` が「行が変わったか」を返す契約に対し、条件付き UPDATE が 0 行でも `true` を返し、overlay も無条件に書き換わる
  - 場所: `packages/core/src/adapters/cloudflare/projection/snapshotWriter.ts:195-222`
  - 理由: ポート JSDoc は「A missing row, a row created by someone else, and a row already at that generation or later are all no-ops … Returns whether a row changed」と定める。実装は `redactedRow(await readStored(...))` で先に 3 つの no-op を判定するが、その後の `UPDATE … WHERE note_id = ? AND created_by = ? AND author_version < ?` が並行更新で 0 行に当たっても `true` を返す。さらに `upsert` の overlay には赤字化した行を無条件に置くので、同じ UoW の後続の `readStored` が「実際には書かれない値」を返す。at-least-once の fan-out は収束するので実害は小さいが、戻り値を数える運用イベント（`spec/usecases/identity.md` 手順 4）が過大に出る。
  - 提案: 条件付き UPDATE ではなく `occGuard` + 無条件 UPDATE にして「当たらなければ中断」に倒すか、autocommit 経路では `RETURNING` / 変更行数で判定して戻り値を実際の結果に合わせる。

- **[W-010]** `spec/platform/index.md` に「Cloudflare 実装の実測」とその内訳を書いたのは [ADR 056](../../../spec/adr/056-performance-budget-placement.md) の決定 3 に反する
  - 場所: `spec/platform/index.md:154`
  - 理由: ADR 056 は「**どのバックエンドがその数に届かないかは、予算文書ではなく本 ADR のコンテキストに残す。予算文書の節の軸は実行基盤の上限であって、個々のアダプターの実装制約ではない。そこに書くと節の軸が濁る**」と明記している。改訂後の段落は「Cloudflare 実装の実測」「`findById` + 削除前の版確認」「`_occ_guard` + `DELETE`」という、まさに個々のアダプターの実装制約を予算文書へ持ち込んでいる。AC-5 が許したのは「当該行を実測値へ改める」ことで、内訳の置き場所までは動かしていない。
  - 提案: 予算文書には「書き込みは件数によらず 1 回の原子適用」という実行基盤の軸の主張だけを残し、`4n + 3`（B-001 を直したあとの正しい値）とその内訳は ADR 056 のコンテキストへ追記するか、`spec/adr/` に新 ADR として起こす。

- **[W-011]** scope 検証の縮小が `spec/database/index.md`「共通の規約」に反映されておらず、`llm_usages` はその判断の列挙にも入っていない
  - 場所: `spec/database/index.md:20` / `.thread/11/adr.md:582-613`（ADR-024）/ `packages/core/src/adapters/cloudflare/do/repositories/llmUsageRepository.ts`
  - 理由: 規約は「scope table の `owner_type / owner_id` **または** `scope_type / scope_id` は object 自身の ScopeKey と一致しなければならない。adapter が復元・保存の両方で検査する」と無条件に書かれたままで、実装が検査するのは `notes` だけ。判断そのもの（会計上の帰属と物理 scope を分ける）は妥当で、ポート JSDoc（`StoredFileRepository`: "never overrides the physical scope"）と適合スイートに正本があるという ADR 046 の当て方も正しい。問題は置き場所で、`.thread/11/adr.md` は Issue の作業ファイル（直近のコミットが「レビュー記録を片付ける」で消している類）なので、canon 側にこの読み替えが残らない。加えて ADR-024 の列挙は `stored_files` / `storage_quotas` だけで、同じく検査していない `llm_usages.user_id`（personal scope では scope 鍵そのもの）に触れていない。
  - 提案: `spec/database/index.md:20` の 1 文を「scope 鍵として使っている列（今日は `notes.owner_type / owner_id` と `_scope_identity`）」へ narrow し、会計上の帰属列は対象外であることを明記する。ADR-024 は `spec/adr/` へ昇格し、`llm_usages` を列挙に加える。

- **[W-012]** production の JSDoc が `.thread/11/adr.md` を参照している
  - 場所: `packages/core/src/adapters/cloudflare/r2/objectStorage.ts:28`（同型が `execution/writeSet.ts` / `sql/executor.ts` / `do/scopeStub.ts` / `do/scopeObject.ts` / `do/scopeName.ts` / `sql/json.ts` などにも）
  - 理由: CLAUDE.md は「`spec/adr/index.md` — the index of non-obvious design decisions still in force」と定めており、`.thread/` は Issue ごとの作業ディレクトリ。ADR-001〜004 のように**実装の読み手が必ず要る**判断（write-set の理由、RPC 1 往復の理由、テスト名前空間の理由）を作業ファイルに置くと、Issue が閉じたあと参照が死ぬ。
  - 提案: 少なくとも ADR-001 / 002 / 003 / 004 / 024 / 025 は `spec/adr/` へ移し、`spec/adr/index.md` に登録して JSDoc のリンク先を差し替える。

- **[W-013]** cursor が「signed」ではない
  - 場所: `packages/core/src/adapters/cloudflare/cursor.ts:40-59`
  - 理由: `PublicNoteQueryService` のポート JSDoc は「Cursors are **signed** opaque values carrying the query fingerprint and shard generation; condition changes, **tampering**, and retired generations surface as `ValidationError("INVALID_PAGINATION")`」と書いている。実装は base64url した JSON で、fingerprint は criteria から決定的に計算できるので、改竄検出になっていない。実害は「公開行の keyset 位置を任意に飛ばせる」だけ（`PUBLISHED` 述語は必ず掛かる）だが、契約語と実装が食い違っている。memory も同型なので ADR 046 の「正本のある側へ倒す」対象。
  - 提案: ポート JSDoc から `signed` を落として「opaque かつ fingerprint 付き」に弱めるか（守る責務が呼び出し側に無いことも書く）、両バックエンドに HMAC を入れる。物理 shard 化で `shard generation` を載せる時点で判断が要るので、今のうちにどちらかへ倒しておくのが安い。

#### 良かった点

- `_occ_guard` の形が `spec/database/index.md#_occ_guard` の追記どおりで、guard を条件付き更新の**直前**に積む理由（同一 batch 内で後続文が先行文の効果を見る）と制約名固定の理由がコードと spec の両方に一貫している。`occGuard(condition)` が「期待が成り立たないときだけ実行され、実行されれば必ず CHECK に反する」形に畳まれているのは読みやすい。
- contentless FTS5 の取り消しが**生テキスト列から前処理関数を再適用して**求められており（`snapshotWriter.ts:ftsMutation`）、`rowid` を bound value ではなく `SELECT … WHERE note_id = ?` で解決している。後者のおかげで「同じ UoW で同じノートを 2 回投影する」経路が壊れない。ADR 017 の要求を正面から満たしている。
- bigram 前処理が `search/bigram.ts` の 1 ファイルに閉じ、書き込み側（`bigramIndexText`）・クエリ側（`bigramMatchExpression`）・ハイライト側（`normalizeForSearch` / `searchRunsOf`）が同じ `splitRuns` を共有している。CJK 範囲表も `spec/database/index.md#bigram-前処理` と 1 対 1。`for (const char of …)` によるコードポイント反復なのでサロゲートペアも割れない。
- ハイライトの HTML エスケープが正しい。`render` は `<mark>` 以外のすべての区間を `escapeHtml`（`& < > " '`）に通しており、出力に現れるマークアップは `<mark>` / `</mark>` だけ。適合スイート `ADP-note-021` の injection ケースが振る舞いとして固定している。
- `bm25(fts, 5.0, 1.0, 3.0)` の列順（`title_fts`, `text_fts`, `tag_names_fts`）と昇順ソートが正しく、`spec/database/index.md#note_search_fts` の例と一致している。
- 公開投影の世代ベクトル条件が階層化されており（`routeVersion` が先、同世代内だけ 3 成分比較）、`workspace→personal` 移動で `workspaceVersion` が 0 に落ちても `incomparable` に固まらない。等値ベクトルが `stale` になる点も適合スイート `ADP-note-028` と一致。
- `NoteProjectionRevisionStore.bump` が read → OCC guard → upsert を**同じ write-set**に積んでおり、イベントの enqueue と同一 transaction に載る（ADR 027）。`current === 0` のときだけ guard の述語を「行が存在しないこと」へ切り替えるのも、同一 UoW 内での二重 bump に対して正しく動く。
- `ObjectStorage.put` が `meta` を無視して**書いたバイト列から** size と sha256 を測っており（ADR 050）、`sha256Of` が `body.buffer` ではなく新しい `ArrayBuffer` へコピーしてから digest しているのは、view が大きなバッファの窓であるケースを正しく踏んでいる。
- `ObjectKey.create` が `..` と先頭 `/` を弾いているので、`publicUrl` の `${publicBaseUrl}/${prefix}${key}` にパストラバーサルの余地は無い（`ObjectKey.build` 経由なら所有者セグメント + UUID + 拡張子のみ）。keyPrefix による名前空間分離も `r2.test.ts` の 3 本目のケースが実際に観測している。

#### カバレッジ

- 確認: `.thread/11/plan.md`, `.thread/11/adr.md`（ADR-024 / ADR-025 を中心に）, `.thread/11/progress.md`
- 確認: `spec/database/index.md`, `spec/platform/index.md`（いずれも差分と該当節）
- 確認: `packages/core/src/adapters/cloudflare/do/repositories/noteRepository.ts`
- 確認: `packages/core/src/adapters/cloudflare/do/repositories/noteRevisionRepository.ts`
- 確認: `packages/core/src/adapters/cloudflare/do/repositories/storedFileRepository.ts`
- 確認: `packages/core/src/adapters/cloudflare/do/repositories/storageQuotaRepository.ts`
- 確認: `packages/core/src/adapters/cloudflare/do/repositories/llmUsageRepository.ts`
- 確認: `packages/core/src/adapters/cloudflare/do/repositories/appliedOperationStore.ts`
- 確認: `packages/core/src/adapters/cloudflare/do/repositories/noteProjection.ts`
- 確認: `packages/core/src/adapters/cloudflare/do/repositories/localNoteQueryService.ts`
- 確認: `packages/core/src/adapters/cloudflare/d1/repositories/publicNoteProjection.ts`
- 確認: `packages/core/src/adapters/cloudflare/d1/repositories/publicNoteQueryService.ts`
- 確認: `packages/core/src/adapters/cloudflare/projection/noteSearchRow.ts`
- 確認: `packages/core/src/adapters/cloudflare/projection/searchClauses.ts`
- 確認: `packages/core/src/adapters/cloudflare/projection/snapshotWriter.ts`
- 確認: `packages/core/src/adapters/cloudflare/projection/viewerCalendar.ts`
- 確認: `packages/core/src/adapters/cloudflare/search/bigram.ts`
- 確認: `packages/core/src/adapters/cloudflare/search/highlight.ts`
- 確認: `packages/core/src/adapters/cloudflare/r2/objectStorage.ts`
- 確認: `packages/core/src/adapters/cloudflare/cursor.ts`
- 確認: `packages/core/src/adapters/cloudflare/do/schema.ts`, `do/scopeObject.ts`, `do/scopeName.ts`, `do/scopeStub.ts`
- 確認: `packages/core/src/adapters/cloudflare/sql/occGuard.ts`, `sql/row.ts`, `sql/json.ts`, `sql/statement.ts`, `sql/errors.ts`, `sql/executor.ts`, `sql/session.ts`
- 確認: `packages/core/src/adapters/cloudflare/execution/writeSet.ts`（投影・OCC の理解に必要な範囲）
- 確認: `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`（`public_note_search*` の節）
- 確認: `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts`
- 確認: `packages/core/src/adapters/cloudflare/__tests__/r2.test.ts`
- 確認: `packages/core/src/adapters/cloudflare/__tests__/conformance/scopeBusiness.test.ts`
- 確認: `packages/core/src/adapters/cloudflare/__tests__/conformance/projection.test.ts`
- 確認: `packages/core/src/adapters/cloudflare/__tests__/ports/scopeBusiness.ts`
- 確認: `packages/core/src/adapters/cloudflare/__tests__/ports/projection.ts`
- 確認（差分外の照合先）: `packages/core/src/domain/storage/ports/storedFileRepository.ts`, `domain/note/ports/{localNoteProjectionWriter,publicNoteProjectionWriter,publicNoteQueryService}.ts`, `application/ports/{objectStorage,appliedOperationStore}.ts`, `domain/storage/valueObject.ts`, `adapters/conformance/{storedFileRepository,noteProjection,localNoteQueryService,publicNoteQueryService,backend}.ts`, `adapters/memory/repositories/{noteProjection,publicNoteQueryService}.ts`, `adapters/memory/objectStorage.ts`, `application/di/cloudflareRuntime.ts`（scope の配線のみ）, `spec/adr/{006,011,013,017,021,024,026,027,033,046,049,050,056}.md`, `spec/testcases/storage/deleteFilesByOwner.md`
- スキップ: `.thread/11/{foundation,steps,testing}.md` — 進行管理・手順書で、契約と実装の照合材料ではない（plan.md / adr.md は確認済み）
- スキップ: `docs/test.md`, `package.json`, `packages/core/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `packages/core/{tsconfig.json,tsconfig.cloudflare.json,vitest.workers.config.ts,wrangler.test.jsonc}` — ツール / ビルド / 依存の設定で、本観点の対象外
- スキップ: `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts` — スイート網羅の台帳で、担当ポートの振る舞いを見ていない
- スキップ: `packages/core/src/adapters/cloudflare/__tests__/{alarm,durability,harness,idempotency,lease,runtimeComposition,support,unitOfWork}.test.ts`, `__tests__/{env.d.ts,worker.ts,pendingPorts.ts,conformanceBackend.ts}`, `__tests__/ports/{deps,directory,identity,route,scopeInfra}.ts`, `__tests__/conformance/{directory,identity,route,scopeInfra,unitOfWork}.test.ts` — Alarm / lease / UoW / Identity 束の観測で他観点の担当（`conformanceBackend.ts` はセッション種別の確認のためだけに部分参照）
- スキップ: `packages/core/src/adapters/cloudflare/d1/repositories/`（`publicNoteProjection.ts` / `publicNoteQueryService.ts` を除く 17 ファイル）, `d1/schema.ts`, `d1/migrations/0003_membership_directory.sql` — Identity / directory / route / outbox で Global plane 観点の担当
- スキップ: `packages/core/src/adapters/cloudflare/do/{alarm,dueIndex,scheduledTasks}.ts`, `do/repositories/{scopeCleanupAdmissionStore,scopeTaskScheduler}.ts` — Alarm / scheduled task 観点の担当
- スキップ: `packages/core/src/adapters/cloudflare/execution/{globalUnitOfWork,nesting,scopeUnitOfWork}.ts`, `cloudflare/{scopeRouter,scopeTaskQueue}.ts` — UoW / routing 観点の担当
- スキップ: `packages/core/src/application/di/{cloudflareRuntime,runtime}.ts` — DI 配線が担当観点外（scope 側リポジトリへ `scope` が渡っていることだけ確認）
