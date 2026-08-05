# テストケース: runConversion

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| Markdown ファイルと待機中のジョブ | 実行する | HTML に変換され、ノートが `ready` になり、ジョブが `succeeded` になる | |
| 装飾のない HTML から変換された | 実行後に確認する | `styleMode: "default"` になる | |
| `style` 要素を含む HTML ファイル | 実行する | `styleMode: "preserve"` になる | |
| 既に `succeeded` のジョブ | 再度実行する | 何もせず終わる（冪等） | |
| 既に `failed` / `canceled` のジョブ | 再配送で受け取る | 何もせず終わる（終端状態は再実行しない） | |
| ジョブの行が存在しない（退会の後始末 `deleteJobsForRequester` と配送が競合した） | 配送で受け取る | 何もせず成功として返る（行がない以上その配送で進められる処理はなく、再配送しても結果は変わらない。run 系共通規則の判定 1） | |
| リースが有効な `running` のジョブ | 再配送で受け取る | 何もせず終わる（他のワーカーが実行中） | |
| リースが失効した `running` のジョブ | 再配送で受け取る | `Job.start` が引き継いで再開し、`attempts` が加算され進捗が作り直される | |
| リース失効の引き継ぎで `attempts` が上限を超える | 再配送で受け取る | 再開せず `failed("timeout")` になり、手動 `retry` の余地が残る。同じ UoW で「共通: 強制終端の後始末」を `cause: { type: "expired" }` として実行し、`processing` のままの対象ノートが `failed(timeout)` に回復する（本処理に入る前に終端するため、ワーカー自身が本文を書き換える余地がない） | |
| ノートが削除済み | 実行する | `failed("targetMissing")` になる | |
| LLM が必要で未連携 | 実行する | `Note.markAwaitingIntegration` でノートが `awaitingIntegration` になり、ジョブが `failed("integrationRequired")` になる | |
| `markAwaitingIntegration` が適用された | 発行イベントを確認する | `note.awaitingIntegration` が発行される（`content_status` は `upsert` でしか更新されないため、このイベントがないと投影が `processing` のまま残る） | |
| `note.awaitingIntegration` が投影された | 読み取りモデルを確認する | `content_status` が `awaitingIntegration` に更新され、`countByContentStatus(owner, "awaitingIntegration")` に数えられる | |
| `awaitingIntegration` のノートがある状態で OpenRouter を連携する | `completeIntegrationOAuth` の案内を確認する | `countByContentStatus` を根拠とする「要 LLM 連携の N 件」が実体と一致する（イベントを購読しないと常に 0 件になる） | |
| `payload.conversionPreference: "machineOnly"` で OpenRouter 連携がある Word ファイル | 実行する | 連携があっても `capability.llm: "declined"` として扱われ、機械的変換（`textExtraction`）になる | |
| `payload.conversionPreference: "auto"` で OpenRouter 連携がある Word ファイル | 実行する | LLM を使う方針（`textExtractionThenStructuring`）になる | |
| `payload.conversionPreference: "machineOnly"` で機械的変換ができない形式（テキスト層のない PDF） | 実行する | `unavailable(machineExtractionUnavailable)` となり、ノートが `failed(machineExtractionUnavailable)`、ジョブが `failed("machineExtractionUnavailable")` になる | |
| `payload.conversionPreference: "machineOnly"` で画像、OpenRouter 連携済み | 実行する | 連携があっても結果は同じで、`Note.markAwaitingIntegration` は呼ばれない（案内は連携ではなく `auto` での取り込み直し） | |
| `payload.conversionPreference: "machineOnly"` で変換した | 使用量を確認する | LLM 実行回数は消費されていない | |
| LLM が必要で連携が失効（`CredentialResolver.resolve` が `reauthorizationRequired`） | 実行する | 方針の決定に進まず、ノートが `failed(providerAuthFailed)`、ジョブが `failed("providerAuthFailed")` になる | |
| `resolve` がtoken refreshまたは `lastUsedAt` 更新を返す | 実行する | `resolved.updated` をglobal D1で先に保存してからscope-local変換を続ける。後続のノート・ジョブ保存が競合してもconnection更新は巻き戻さない | |
| `resolve` が返した `expired` が非 `null` | 実行する | global D1で連携と `integration.expired` を先に保存し、scope-localでノート・ジョブを失敗させる。plane間で停止しても再試行がexpired状態を読み直して同じ結果へ収束する | |
| 未連携（連携の行がない）と失効を比べる | 実行する | 未連携は `awaitingIntegration` + `failed("integrationRequired")`、失効は `failed(providerAuthFailed)` + `failed("providerAuthFailed")` で、結果も案内も分かれる（`unavailable` に畳まない） | |
| 実行中に外部から強制終端された（`trashNote` / `cancelJob` / 連携失効による一括失敗など） | 結果を保存する | 保存が `ConflictError` になるためジョブを読み直し、終端済みなら生成物を破棄して成功として返す（ジョブは書き換えない。run 系共通規則の判定 4） | |
| 保存の `ConflictError` 後に読み直したジョブが終端していない（別のワーカーが引き継いだ） | 結果を保存する | `ConflictError` をそのまま投げて再配送に委ねる | |
| LLM 実行回数の上限に達している | 実行する | ノートが `failed(quotaExceeded)` になる | |
| モデルがレート制限を返す | 実行する | `failed("quotaExceeded")` になる | |
| 実行が時間切れになる | 実行する | `failed("timeout")` になる | |
| 破損したファイル | 実行する | `failed("corruptedFile")` になる | |
| パスワード保護された PDF（`FormatDetector.detect` の `passwordProtected` が真）で `conversionPreference: "machineOnly"` | 実行する | 方針の決定にも連携の解決にも進まず、ノートが `failed(passwordProtected)`、ジョブが `failed("passwordProtected")` になる（`machineExtractionUnavailable` に化けない） | |
| パスワード保護された PDF で OpenRouter 未連携 | 実行する | 同じく `failed(passwordProtected)` + `Job.fail("passwordProtected")` になる（`integrationRequired` に化けず、`markAwaitingIntegration` も呼ばれない） | |
| パスワード保護された PDF で OpenRouter 連携済み（`conversionPreference: "auto"`） | 実行する | 同じく `failed(passwordProtected)` + `Job.fail("passwordProtected")` になり、LLM 実行回数も消費されない | |
| 取り込み時に `failed(passwordProtected)` としたノート | 変換後の理由を確認する | 同じファイルで理由が入れ替わらない（P-13 は 3 つの理由で案内を分けているため、`planConversionForUpload` の手順 3 と同じ優先順位を保つ） | |
| 未対応形式 | 実行する | ノートが `failed(unsupportedFormat)` になる | |
| 変換結果に外部参照がある | 実行する | 参照取り込みジョブが登録される | |
| `payload.requestedVisibility` が `unlisted` | 実行する | 変換成功後に限定公開になり、共有リンクが発行される | |
| `payload.requestedVisibility` が `public` でハンドル未設定 | 実行する | 非公開のまま残り、ジョブは成功する | |
| 変換に失敗した | 結果を確認する | 公開ステータスは変更されない | |
| `payload.requestedVisibility` の適用 | 手順 14 の実装を確認する | `changeNoteVisibility` ユースケースは呼ばず、その手順 2〜4 を本文の更新と同じ UoW で再現する（呼ぶと `run` が入れ子になり、未保存のノートに渡せる `expectedVersion` もない）。手順 1 の権限確認は再現しない（実行主体は利用者ではなくジョブ） | |
| LLM を要する方針 | `consumeLlmCall` の呼び出し位置を確認する | ノートとジョブを保存する `UnitOfWorkProvider.run` を開く**前**に呼ぶ（`run` を入れ子にしないため）。消費は Usage 側の UoW で先に確定し、そのあと変換が失敗しても戻らない | |
| `parentId` を持つ子ジョブで方針が `unavailable` | 実行する | ジョブが終端し、`job.failed` によって親の進捗が進む（子が終端しないまま残らない） | |
| タイトルの由来が `auto` で変換が題名を返す | 実行する | タイトルが差し替わる | |
| タイトルの由来が `manual` | 実行する | タイトルは差し替わらない | |
| LLM を使う変換を実行した | 使用量を確認する | LLM 実行回数が 1 消費されている | |
| 実行前に判明した失敗（未連携） | 使用量を確認する | LLM 実行回数は消費されていない | |
| `requestedVisibility: "public"` だが公開ハンドルが未設定 | 実行する | ノートは非公開のまま残り、ジョブは `succeeded` になる。`notices` に `{ kind: "visibilityNotApplied", requested: "public", reason: "handleMissing" }` が入る（`failure.detail` には書かない。成功したジョブは `failure` を持たない） | |
| `requestedVisibility: "public"` でワークスペース所有だがスラッグが未設定 | 実行する | 同じく `reason: "slugMissing"` の申し送りが入る | |
| 公開ステータスが適用できた | 実行する | `notices` は空配列になる | |
| 変換結果に外部参照がある | 実行する | `StorageUrlPolicy.isInternal` が偽の参照が 1 件以上あるときだけ参照取り込みジョブが登録される | |
| 同じノートに未終端の `referenceImport` ジョブがある | 実行する | 新しい参照取り込みジョブは登録されず、変換ジョブ自体は成功する（`ensureNoDuplicate` は使わない。例外にせず登録を見送るだけ） | |
