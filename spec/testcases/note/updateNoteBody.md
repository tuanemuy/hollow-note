# テストケース: updateNoteBody

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 編集権限のあるノート | 有効な HTML で保存する | 本文が更新され、直前の内容が版として記録される | |
| `script` を含む HTML | 保存する | `script` が除去され、`removed` に理由つきで含まれる | |
| `noscript` を含む HTML | 保存する | 除去され、`removed` に含まれる（内容の解釈規則が実行環境で分かれ、パーサーによってはサニタイズを経ずに DOM へ復活するため） | |
| `onclick` 属性を含む HTML | 保存する | 属性が除去され、`removed` に含まれる | |
| `javascript:` の URL を含む HTML | 保存する | URL が除去され、`removed` に含まれる | |
| `vbscript:` / `file:` / `blob:` の URL を含む HTML | 保存する | いずれも許可スキームでないため除去され、`removed` に含まれる | |
| `iframe` / `frame` / `frameset` を含む HTML | 保存する | 要素ごと除去され、`removed` に含まれる（本文の内側に別文書を埋め込めない） | |
| `<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;">` を含む HTML | 保存する | 要素と `srcdoc` 属性の両方が除去され、属性値の中の HTML が残らない（要素単位の除去だけでは属性値の中の第二の HTML 文書を見られないため、`srcdoc` は属性としても単独で非許可） | |
| 許可される要素に `srcdoc` 属性を付けた HTML | 保存する | 属性が除去され、`removed` に含まれる（`srcdoc` は要素に依らず非許可） | |
| `object` / `embed` / `applet` を含む HTML | 保存する | いずれも除去され、`removed` に含まれる（プラグイン・外部データの埋め込み） | |
| `form` / `input` / `button` / `select` / `textarea` などのフォーム系要素を含む HTML | 保存する | いずれも除去され、`removed` に含まれる（正規ドメイン上の公開ページに資格情報の入力欄を置けないようにする） | |
| `base` 要素を含む HTML | 保存する | 除去され、`removed` に含まれる（本文中のすべての相対 URL の解決先をまとめて外部へ向け直せるため） | |
| `<meta http-equiv="refresh" content="0;url=...">` を含む HTML | 保存する | `meta` ごと除去され、`removed` に含まれる（公開ページに自動遷移を仕込めないようにする） | |
| `<link rel="stylesheet" href="...">` を含む HTML | 保存する | 除去され、`removed` に含まれる（`ExternalFetchPolicy` を通らない外部取得経路になるため。装飾の保持は `importExternalReferences` による `<style>` へのインライン化で代替する） | |
| 同上 | 保存後の本文を調べる | 除去した位置に空の `<style data-stylesheet-href="元の URL">` が残る（カスケード順を保つため。[domains/note.md](../../domains/note.md) の `HtmlProcessor`） | |
| 同上 | `importReferences: true` で保存する | 痕跡が `extractExternalReferences` に外部参照として現れるため、参照取り込みジョブが登録される（手順 8 の登録条件を満たす） | |
| 同上 | `importReferences: false` で保存する | **痕跡はそのまま残る**（`data-stylesheet-href` のまま。要素ごと落としも属性の付け替えもしない）。ジョブは登録されないので装飾は当たらない | |
| `importReferences: false` で保存した本文 | あとで `importReferences: true` で保存し直す | 残っていた痕跡が抽出に現れ、参照取り込みジョブが登録される（取り込み直せる） | |
| `importReferences` を省略する | 保存する | 既定の真として扱われ、取り込む場合と同じ結果になる | |
| 取り込み済みの痕跡（`<style data-imported-stylesheet="...">…CSS…</style>`）を含む本文 | 保存する | 痕跡はそのまま残り、`extractExternalReferences` には現れない。したがって参照取り込みジョブは登録されない（`data-stylesheet-href` だけが抽出対象） | |
| 取得できなかった痕跡（`<style data-stylesheet-unavailable="...">`）を含む本文 | 保存する | 同じく残り、抽出にも現れない（再登録ループを起こさない） | |
| `template` 要素を含む HTML | 保存する | 除去され、`removed` に含まれる（内容がパースされずに保持され、後段の走査とサニタイズの見え方がずれるため） | |
| 許可リストにない未知の要素・属性を含む HTML | 保存する | 列挙にないものはすべて除去される（許可リスト方式のため、非許可の列挙に載っていなくても残らない） | |
| `<style>` に `position: fixed` の宣言を含む HTML | 保存する | その宣言だけが除去され、`removed` に CSS 由来の除去として含まれる。同じ規則の他の宣言と、`style` 要素そのものは残る（宣言単位で落とす。要素ごと捨てると 1 つの違反で本文全体の装飾が消える） | |
| `<style>` に `@import url(...)` を含む HTML | 保存する | その規則だけが除去され、`removed` に含まれる（`ExternalFetchPolicy` を通らない外部取得経路であり、`ExternalReference` の属性ベースの抽出にも乗らないため） | |
| `style` 属性に `position: fixed` を指定した HTML | 保存する | 同じくその宣言だけが除去され、他の宣言は残る | |
| `position: sticky`（およびベンダー接頭辞付きの同義の指定） | 保存する | 同じく除去される（ビューポート基準の配置を許さない） | |
| `position: absolute` を含む HTML | 保存する | 除去されずに残る（本文のホスト要素を包含ブロックにすることで、絶対配置の基準を本文の内側に閉じられるため） | |
| `<style>` と `style` 属性を含み、非許可の宣言がない HTML | 保存する | どちらもそのまま残る（ADR 007 の `preserve` モードが装飾の保持のために必要とするため、全面禁止にはしない） | |
| `data:image/png;base64,...` を `img` の `src` に指定した HTML | 保存する | 残る（リソース参照の `data:` はラスタ画像の MIME に限って許可される） | |
| `data:text/html,...` / `data:image/svg+xml,...` を含む HTML | 保存する | 除去される（どちらもスクリプトを運べるため） | |
| `data:` の URL を `a` の `href`（ナビゲーション）に指定した HTML | 保存する | 除去される（`data:` を許可するのはリソース参照のみ） | |
| 見出し・段落・リスト・表・`details` / `figure` / ルビなど、許可リストの内側の文書要素だけからなる HTML | 保存する | 除去されずにそのまま保存され、`removed` が空になる | |
| `class` / `id` / `data-*` / `aria-*` を持つ HTML | 保存する | いずれも残る（スクリプトのない環境では不活性で、取り込んだ装飾のセレクタが依存するため） | |
| `autofocus` のように振る舞いを持つグローバル属性 | 保存する | 除去される（不活性な属性だけを許可する線引き） | |
| `<a target="_blank">` を含む HTML | 保存する | `rel="noopener noreferrer"` が付与された形に正規化される（`window.opener` 経由で遷移元を書き換えられる経路を残さない） | |
| `script` / `foreignObject` / 外部を指す `href` を含むインライン `<svg>` | 保存する | `svg` の描画要素の部分集合だけが残り、それらは除去される（本文中のインライン `svg` と保管する SVG ファイルで同じ部分集合を使う） | |
| 除去が複数の分類にまたがる HTML | 保存する | `removed` に要素・属性・URL スキーム・CSS 由来の除去がそれぞれ分類つきで積まれ、画面が分類ごとに畳める形で返る | |
| 壊れた HTML | 保存する | 補正された結果が保存され、例外にならない | |
| サニタイズ後が 800,000 バイトを超える | 保存する | `BusinessRuleError(ContentTooLarge)` が投げられる | |
| サニタイズ後がちょうど 800,000 バイト | 保存する | 保存できる（境界値。上限は D1 の行サイズ 2,000,000 バイトから逆算した値） | |
| 見出しが 200 件を超える HTML | 保存する | 先頭 200 件だけが `headings` に残り、超過分は捨てられる（本文の保存自体は成功する） | |
| サニタイズ前が 2 MB を超える | 保存する | `ValidationError` が投げられる（転送境界での制限） | |
| 版が 20 件ある | 保存する | 最古の版が削除され、20 件が保たれる | |
| viewer である | 保存する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| ゴミ箱のノート | 保存する | `BusinessRuleError(NoteIsTrashed)` が投げられる | |
| 実行中の変換ジョブがある | 保存する | `BusinessRuleError(NoteLockedByJob)` が投げられる | |
| 実行中の再生成ジョブがある（本文は `ready` のまま） | 保存する | `BusinessRuleError(NoteLockedByJob)` が投げられる | |
| 終端した変換・再生成ジョブしかない | 保存する | 成功する（実行中のジョブだけが編集を拒む） | |
| 他者が先に更新した | 古い `expectedVersion` で保存する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
| 保存時に除名されている | 保存する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 新しい外部参照を含み `importReferences: true` | 保存する | 参照取り込みジョブが登録され、`referenceImportJobId` が返る | |
| 外部参照がなく `importReferences: true` | 保存する | ジョブは登録されず、`referenceImportJobId: null` が返る | |
| 取り込み済みで、本文の参照がすべてサービス内のストレージを指す | `importReferences: true` で保存する | ジョブは登録されない。`extractExternalReferences` は内部の URL も返すため、`StorageUrlPolicy.isInternal` で絞ってから件数を判定する（絞らないと取り込むものがないのに保存のたびにジョブが登録される） | |
| 同じノートに未終端の `referenceImport` ジョブがある | 新しい外部参照を含む本文を `importReferences: true` で保存する | 保存は成功し、新しいジョブは登録されず、既存の `referenceImportJobId` が返る（自動保存の間隔ごとにジョブが増えない） | |
| 同上 | 例外の有無を確認する | `BusinessRuleError(DuplicateJob)` は投げない。`JobConcurrencyPolicy.ensureNoDuplicate` は使わず、`listActiveByTarget` の結果を `kind` で絞るだけである（重複は利用者の誤りではなく自動保存の副作用なので、保存を失敗させない） | |
| 同じノートの `referenceImport` ジョブが終端している | 保存する | 新しいジョブが登録される（未終端のものだけが重複とみなされる） | |
| 個人所有のノートで参照取り込みジョブが登録された | ジョブの `scope` を確認する | 対象ノートの所有文脈から `{ type: "user", userId: owner.userId }` が入る | |
| 参加ワークスペース所有のノートを他のメンバーが編集して参照取り込みジョブが登録された | ジョブの `scope` を確認する | `{ type: "workspace", workspaceId }` が入る（基準は所有者であり、`createdBy` でも編集した `userId` でもない） | |
| `reason: "wysiwygConversion"` | 保存する | 版の記録理由が `wysiwygConversion` になる | |
