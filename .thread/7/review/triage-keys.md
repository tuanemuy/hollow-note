# 判定キー（wont-fix / defer）— Issue #7

次ラウンドのレビュアー向けの薄いビュー。ここにある指摘は再掲しない（新事実があるときだけ蒸し返す）。

| Key | 判定 | Issue |
| --- | --- | --- |
| [W-009] application/note/listTrashedNotes.ts | wont-fix | — |
| [W-006] spec/domains/storage.md:273 | wont-fix | — |
| [W-006] components/note/NoteEditor/editor.tsx | defer | |
| [W-001] workers/subscribers.ts:note.purged | wont-fix | — |
| [W-002] domain/note/services/noteAccessPolicy.ts:ensureCanDelete | wont-fix | — |
| [W-006] application/note/emptyTrash.ts:scheduleBulkPurge | wont-fix | — |
| [W-006] application/storage/storeMedia.ts:resolveEditableNote | wont-fix | — |
| [W-005] adapters/cloudflare/do/repositories/tagAssignmentRepository.ts:insert | wont-fix | — |
| [W-009] application/usage/ | defer | |
| [W-003] spec/adr/013:163 | defer | |
| [W-003] apps/web/app/routes/storage.$.tsx:GET | defer | |
| [W-007] spec/scenario/editing.md:87 | wont-fix | — |
| [W-008] spec/pages/index.md:361 | wont-fix | — |
| [W-010] components/note/NoteList/board.tsx:canMove | wont-fix | — |
| [W-003] application/note/purgeExpiredTrash.ts:残余 | wont-fix | — |
| [W-008] components/layout/ScopeToken/listing.ts:canWrite | wont-fix | — |
| [W-002] application/note/editing.ts:scopeOfOwner | wont-fix | — |
| [W-002] application/storage/collectOrphanMedia.ts:orphans | wont-fix | — |
| [W-007] spec/pages/index.md:298 | wont-fix | — |

ラウンド 005: `wont-fix` / `defer` は 0 件（24 件すべて `fix` 19 / `fix-editorial` 5）。このビューに追記する行は無い。

ラウンド 006: `wont-fix` 3 件（上表の末尾 3 行）。`defer` は 0 件。
理由の要約は `triage.md` のラウンド 006 の行を見ること。

- `[W-002] application/note/editing.ts:scopeOfOwner` — ADR-097 が別名の再エクスポートを明示的なトレードオフとして決着済み
- `[W-002] application/storage/collectOrphanMedia.ts:orphans` — 「3 段への分割で弱くなった」は偽（初版から削除は判定と別 transaction）
- `[W-007] spec/pages/index.md:298` — 取り込み先セレクターはラウンド001 [W-006] で defer 済み（#1 の持ち分）。ADR-039 が他スライスの未実装を spec から消すことを禁じている

ラウンド 006 の方針転換で **閉じた** もの（次ラウンドで蒸し返さないこと）:

- `HtmlProcessor` の有界性は「入力の形の論証」ではなく**資源の直接的な上限**で担保する方針へ切り替えた。SVG の breakout tag 拒否（ADR-099）は前段の安価な防御として残るが、128 KB の根拠ではなくなる。膨張率の新しい実測例を挙げるだけの指摘は、上限が効いている限り新事実にならない
- ADR-095 / ADR-099 が「別スライスの課題」として残した `updateNoteBody` の HTML モードの露出は本ラウンドで同時に閉じる。別 Issue は起票しない

ラウンド 007: `wont-fix` / `defer` は 0 件（18 件すべて `fix` 11 / `fix-editorial` 7）。このビューに追記する行は無い。

ラウンド 007 で **決着した設計判断**（次ラウンドで蒸し返さないこと）:

- **SVG の受理 gate は完全でなくてよい。** `readSvgDocument` / `opensAsSvg` の構文の読み飛ばしを HTML のトークナイザーへ寄せる（＝「塞ぐ」）路線は採らない。ADR 013 が「入力の形の論証」を降ろした以上、XML と HTML のトークナイザーの一致を証明し続ける形は canon に置かない。約束は `sanitizeSvg` の境界翻訳（`HTML_PROCESSOR_TOO_COMPLEX` → Storage の語彙）で担保し、gate は前段の安価な防御として残す。gate を迂回できること自体を挙げるだけの指摘は、費用が資源メーターで有界であるかぎり新事実にならない
- **`EMPTY_TRASH_SYNCHRONOUS_LIMIT = 50` は動かさない。** 50 は global statement の勘定（550〜600 文）より先に「51 件以上はジョブ」という利用者に見える閾値として 6 つの canon に固定されている。実上限 1,000 の内側であることを `spec/platform/index.md` に根拠として書いたうえで据え置く。値を下げよという指摘は、その 6 つの canon を同時に動かす提案としてしか成立しない

ラウンド 008: `wont-fix` / `defer` は 0 件（22 件すべて `fix` 13 / `fix-editorial` 9）。このビューに追記する行は無い。

ラウンド 008 で **決着した設計判断**（次ラウンドで蒸し返さないこと）:

- **資源上限は 5 つになる — 節点数を足す。** ラウンド006 の「入力の形ではなく資源で有界にする」方針は維持し、欠けていた次元（節点数）を `HtmlProcessorLimit` に足して `createMeteredTreeAdapter` の既存 4 課金点で数える。`<template>` 包みの振り分け（`</template` / `<form` は素の経路）は**変えない** — 包みの挙動同値はラウンド008 の差分テスト（無作為 39 万件・全数 156 万件で差分 0）が支持しており、常に包んで 2 通を比較する案は病的な入力で解析を 2 回払う。逃げ道が速くならないこと自体を挙げるだけの指摘は、費用が節点数の枠で有界であるかぎり新事実にならない
- **`MEDIA_SVG_MAX_BYTES = 128 KB` の「導出」は canon から降ろす。** 128 KB を「`process` の出力が 800,000 を割ることの証明」から導く形は 4 回続けて実測に否定された（6 倍 → 86 倍 → 180 倍 → エスケープ 6 倍で 786,073 バイト）。約束（「Storage の語彙でしか失敗しない」）は `storeMedia` の境界翻訳（`HTML_PROCESSOR_TOO_COMPLEX` と `NoteErrorCode.ContentTooLarge` の両方を `FileTooLarge` へ）で構造的に担保する。値を下げよ・メーターをエスケープ後にせよという指摘は、境界翻訳が塞いでいるかぎり新事実にならない
- **`.thread/` の ADR 番号をコード・`spec/`・`docs/` から引かない規約は、回帰テストで機械的に見張る。** 以後この違反は緑のまま通らない

ラウンド 009: `wont-fix` 0 件 / `defer` 1 件。

| Key | 判定 | Issue |
| --- | --- | --- |
| [W-003] routes/notes/-action.tsx:createNoteWithBodyFn | defer | #67 |

ラウンド 009 で **決着した設計判断**（次ラウンドで蒸し返さないこと）:

- **継続要求表の payload 規則は 2 文に分かれる**（ADR-131）。`scope task の payload に scope は現れない`（宛先は `scheduled_tasks` の行が持つ）／`global task は宛先 scope を payload で運ぶ`（行が scope を持たないため）。ラウンド 008 の一律の規則は誤りとして撤回済み。表と `spec/usecases/{tag,storage,usage,job,identity,integration}.md` はこの規則に揃えた。表記の不統一を挙げるだけの指摘は、両方の規則に照らして一致しているかぎり新事実にならない
- **`analyzeMarkup` の警告はトークン列の構造比較で出す**（ADR-132）。`<br/>` / `<P>` / 単引用符 / エンティティ表記の違いは parse5 の直列化が必ず生む差なので警告しない。文字列一致に戻せ・文言だけ変えよという指摘は採らない
- **URL スキーム規則の実行形は `domain/note/services/urlPolicy.ts` に 1 本だけ置く**（ADR-130）。ADR 013 の URL 表の正典はそのままで、HTML アダプター・編集島の面・リンク表示の 3 適用点はこの純関数を呼ぶ。適用点ごとに個別の判定を足す提案は採らない（規則が割れることがラウンド 005 / 009 の Blocker の原因だった）
- **`editor.tsx:commit` の構造的な是正は Issue #68 の持ち分。** 保存の全関心を 1 関数が抱えている点そのものへの指摘は、#68 を根拠に継承する（本 PR で直すのは個別の穴だけ）
- **ED-01 の「本文の先頭行からタイトルを導出する」は Issue #67 の持ち分。** ADR-047 の前提（受け皿は `createBlankNote` 側、`updateNoteBody` はタイトルに触れない、plan.md が ED-01 を除外）は今も真

ラウンド 010〜013: `wont-fix` 0 件 / `defer` 4 件。

| Key | 判定 | Issue |
| --- | --- | --- |
| [W-003] routes/notes/-action.tsx:createNoteWithBodyFn（ED-01 の自動命名） | defer | #67 |
| [W-004] components/note/NoteEditor/editor.tsx:commit（構造の是正） | defer | #68 |
| [W-001] spec/inventory/test.md:1860（TC-storage-074 のテスト本体） | defer | #6 |
| [W-001] spec/inventory/test.md × testcases（範囲外の 56 行） | defer | #69 |

ラウンド 010〜013 で **決着した設計判断**（次ラウンドで蒸し返さないこと）:

- **再試行は一次経路の入口を呼ぶだけ**（ADR-133）。`RetryTarget` は一次経路と 1 対 1 の 5 種（`save` / `mode` / `conflict` / `revision` / `reload`）で、retry 固有の門も分岐も持たない。R008〜R011 の 4 ラウンドはいずれも「再試行が一次経路と別の方針を持つ」型だった。表を増やす提案は採らない
- **復元は 1 往復**（ADR-135）。応答が `title` / `html` を運び 2 段目は同期処理。`failed` のどの種でも「`confirmed` はサーバーの姿」が不変条件として成り立つ。2 段目を分ける・`failed` に印を足す提案は採らない
- **往復をまたぐ関数は生きた値の ref だけを読む**（ADR-136 / ADR-137）。範囲は「往復をまたぐ関数が読む値すべて」で、**`liveReads.test.ts` が禁止集合を計算して強制する**。識別子を列挙する形には戻さない。「島の全 state を載せよ」という提案も採らない（保証はテストが担う）
- **`commit` 本体の関数分割は Issue #68 の持ち分。** 本 PR は個別の穴だけを閉じる。「`commit` が全関心を抱えている」こと自体の指摘は #68 を根拠に継承する
- **継続要求の規則は多重度の 4 分類**（ADR-134）。例外列挙には戻さない。表 40 行すべてが分類に収まることは 2 ラウンド続けて独立に確認済み
- **`spec/inventory/test.md` は testcases が正で、ヘッダーの手順に従って写す。** 生成スクリプトは置かない
