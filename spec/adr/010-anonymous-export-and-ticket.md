# 010. 匿名の PDF エクスポートは要求者なしのジョブとし、結果到達は署名チケットで行う

## ステータス

承認済み

## コンテキスト

閲覧者はサインインなしでノートをダウンロードできる（EX-04）。HTML / Markdown は同期で返せるが、PDF は非同期ジョブとして生成する（[ADR 005](./005-async-processing.md)）。ところが `Job` は `requestedBy: UserId` を必須で持ち、匿名の閲覧者には対応する `UserId` が存在しない。このままでは EX-04 の PDF が Job モデルと両立しない。

`requestedBy` は単なる記録ではなく、処理履歴の絞り込み・キャンセルと再試行の権限判定・退会時のジョブ後始末のキーを兼ねている。匿名を許すには、これらの意味を壊さずに「要求者がいないジョブ」を表現し、さらにジョブ一覧を見られない匿名の閲覧者が進捗照会と結果ダウンロードに到達する手段を用意する必要がある。

## 決定

- `Job` を判別ユニオン化し、`requestedBy: null` は `kind: "pdfExport"` かつ `parentId: null` の場合に限って構成可能とする（型 + 不変条件 + DB の CHECK 制約の三層で強制する）。サインイン済み利用者の PDF は従来どおり `requestedBy: UserId` を持ち、履歴に載りキャンセルできる
- 外部リソースの実行主体は `requestedBy` のままとする。executor のような別フィールドは導入しない。唯一の例外は Drive バックアップからの再生成で、`BackupRecord.userId` の連携トークンを使う。この規約はユースケース（conversion / integration）に 1 文で明記する
- 匿名の結果到達は、SharePass（domains/note.md）と同型のステートレス署名チケット（ExportTicket）で行う。中身は `{ jobId または fileId, noteId, issuedAt }` の署名値で、有効期間は発行から 30 分、サーバー側には保存しない
- ExportTicket は Note ドメインの値オブジェクトではなく、アプリケーション層の型として定義する（[usecases/note.md](../usecases/note.md) の「共通: ExportTicket」）。理由は 2 つで、(1) `JobId` を参照するため Note ドメインに置くと Note → Job の依存が生まれ、既にある Job → Note と循環する（[ADR 008](./008-domain-boundaries.md)）、(2) Note の不変条件に一切関与せず、発行はユースケース、署名と検証は presentation 層の責務であってドメイン値オブジェクトである必然性がない。SharePass は `ShareLink.password.updatedAt` との突き合わせという Note の不変条件に関与するためドメインに残る（ExportTicket との非対称はこの差による）
- 有効期間を 30 分に確定するのは、PDF 生成の実行時間の上限に余裕を足せば足りるためである。失効しても `exportNote` の再実行で再到達できるので、長く持たせても得られるものがない。境界値（`issuedAt + 30 分`）はテストで検証する
- チケットはノートアクセスをバイパスする能力証明ではない。進捗照会・ダウンロードのたびに `NoteAccessPolicy.evaluate`（shareToken / SharePass / userId はリクエストから取得）を再実行し、非公開化・削除・リンク再発行後は「見つかりません」を返す（EX-04 の要件どおり）。チケット失効時は `exportNote` の再実行で再発行する
- `exportNote` の PDF 分岐は、まず期限内の既存 artifact を再利用する。条件は同一ノート・**同版**で、かつ**残りの保持期間がチケットの有効期間（30 分）に余裕を足した長さ以上**（`expiresAt >= now + 35 分`）であること。この下限を課すのは、返したチケットが有効なうちに artifact のほうが先に失効し、ダウンロードが `ARTIFACT_EXPIRED` で落ちるのを防ぐためである
- 当初この条件は逆向きの**上限**（残りの保持期間が 24 時間以内）としていた。一括ダウンロードの子が作る 7 日保持の生成物を単体エクスポートに返すと EX-01 の「PDF は 24 時間保持」が崩れる、という理由だったが、これは EX-01 の 24 時間を保持期間の**上限**と読み違えたものである。EX-01 は「その間は再生成せずに再ダウンロードできる」と述べる**下限**の約束であり、約束より長く残る生成物を返しても違反しない。上限は守る必要のない制約だったうえ、再利用の対象を「残りが短いもの」だけに絞る形になっており、残り数分で失効する artifact も対象に含めてしまう害があった（通常の 24 時間 TTL の artifact でも、生成から 23:30〜24:00 の間に来た要求では必ずダウンロードが失効で落ちる）。上限を削除し、下限に置き換える
- 再利用できるものがなければ、同一ノートの未終端 pdfExport ジョブがあれば新規登録せず、そのジョブへのチケットを返す（相乗り）。**相乗りは版を条件にしない** — キュー待ちのジョブは描画される版が実行時点まで確定せず、「同版であること」を事前条件に置けないためである。したがって相乗りしたあとにノートが更新されれば、受け取る PDF は要求時点ではなく実行時点の版になる
- 相乗りは `JobConcurrencyPolicy.ensureNoDuplicate` による多重実行の禁止とは両立しない（`BusinessRuleError(DuplicateJob)` で弾くと要求元に返す `jobId` がなくなる）ため、`exportNote` はこれを呼ばない。したがって同一ノートの未終端 pdfExport ジョブが高々 1 件である保証はなく、相乗りによる増幅の抑止は**最善努力**である。硬い上限は transport 層のレート制限（IP・ノート単位）と PDF レンダラーの同時実行上限（運用）が与え、相乗りはその手前で同時要求の大半を吸収する層として置く
- 匿名 artifact の帰属: `StoredFile.uploadedBy` を NULL 可にし、匿名 pdfExport の artifact のみ null とする。`StorageOwner` はノートの所有文脈（個人所有ならその利用者、ワークスペース所有ならそのワークスペース）。サインイン時は要求者の個人 subject のままとする。artifact は容量クォータに算入しないため、帰属の違いにクォータ上の副作用はない
- 匿名ジョブの `JobScope` は対象ノートの所有文脈から導出する（型変更なし）。副作用として、ゴミ箱への移動やワークスペース削除に伴うジョブキャンセルの網に匿名ジョブも入る。これは望ましい挙動である
- 匿名ジョブは `listByRequester` 系に現れず、`getJobDetail` / `cancelJob` / `retryJob` の対象外（`requestedBy: null` はどの userId とも一致しない）。匿名の「再試行」は `exportNote` の再実行であり、履歴は `pruneJobHistory` で 90 日後に消える
- 進捗照会とダウンロードのユースケース（`getExportStatus` / `downloadExportArtifact`）を Note ドメインに新設する。チケットとノートアクセス資格を受け、毎回アクセスを再評価する。加えて `{ kind: "file" }` のチケットを受けたときは**両方とも** artifact の生死（不在・期限切れ）を確かめて `ARTIFACT_EXPIRED` を返す — 上の下限条件はチケット発行時点の保証にすぎず、発行後に artifact が保持期限を迎える、あるいは強制終端の後始末や所有者の削除で回収されることはありうるためである。`getExportStatus` だけがこれを省くと、「完了しました」と表示した直後にダウンロードが失効で落ちる
- 乱用対策の硬い上限は transport 層のレート制限（IP・ノート単位）と PDF レンダラーの同時実行上限（運用）が担う。相乗りと artifact の 24 時間キャッシュはその手前で大半を吸収する最善努力の層である。異種ノートを大量に狙う攻撃はレート制限を素通りするため、同時実行上限で受ける

## 検討した代替案

### executor を payload に分離する

`requestedBy`（要求者）と実行主体（executor）を別に持つ案。しかしジョブ登録ユースケースは常に「要求者本人がリソースアクセス権を持つ」ことを事前条件にしており（requestBackup は本人の Drive 連携、requestRegeneration は本人の OpenRouter 連携）、再試行も `requestedBy` 一致のみ許可のため、両者が乖離する経路が仕様上存在しない。Drive 再生成の帰属は `BackupRecord.userId` としてリソース側に記録するパターンが既にあり、executor と二重帰属になる。さらに全 11 kind（`JobKind`。[domains/job.md](../domains/job.md)）の payload に恒等な重複フィールドが生まれ、乖離しうる不正状態をわざわざ型で表現可能にしてしまう。不採用。

### 既存 artifact の再利用のみで賄う

ジョブモデルに手を入れず、所有者が生成済みの PDF がある場合だけ匿名ダウンロードを許す案。初回要求時・期限切れ後・版の更新後には artifact が存在せず、「閲覧できるノートは常にダウンロードできる」という EX-04 の要件を満たせない。不採用。

### 匿名の PDF だけ同期でレンダリングする

ジョブを作らなければ帰属の問題は消えるが、PDF 生成は実行時間が読めないから非同期にした（[ADR 005](./005-async-processing.md)）のであり、要求単位の実行時間制約に反する。匿名かどうかで実行経路が分かれると、レンダリング処理も二重になる。不採用。

## 影響

- `jobs.requested_by` は NULL 可になり、CHECK 制約（`requested_by IS NULL` → `kind = 'pdfExport' AND parent_id IS NULL`）を追加する。要求者を引く 3 索引（`jobs_requester_parents_created_idx` / `jobs_requester_created_idx` / `jobs_requester_active_idx`）は `WHERE requested_by IS NOT NULL` の部分インデックスにする
- `stored_files.uploaded_by` は NULL 可になる。`job.enqueued` の payload も `requestedBy` の null を許容する
- 相乗りと再利用のため、ノート + 版で期限内 artifact を引くリポジトリメソッドが必要になる。`exportNote` の出力 DTO に fileId / チケットのフィールドを追加する
- `getExportStatus` は `JobRepository` に加えて `StoredFileRepository` にも依存する（`{ kind: "file" }` の分岐で artifact の生死を確かめるため）。エラーの語彙も `downloadExportArtifact` と同じ `ARTIFACT_EXPIRED` を持つ
- 再利用の下限（`expiresAt >= now + 35 分`）は境界値テストの対象になる。単体エクスポートの artifact は TTL 24 時間なので、生成から 23 時間 25 分を過ぎた要求では再利用されず作り直しになる。EX-01 の「その間は再生成せずに再ダウンロードできる」を文字どおり読めばこの末尾 35 分は外れるが、利用者が受け取る結果は「少し待って同じ PDF を得る」であって失敗ではない。下限を置かない場合の結果は「チケットを受け取った直後にダウンロードが `ARTIFACT_EXPIRED` で落ちる」であり、こちらのほうが約束から遠い。末尾 35 分の再生成を許すのは、その比較に基づく意図的な選択である
- チケットの署名・検証は SharePass と同じ暗号プリミティブを再利用できる
- `ExportTicket` の定義はアプリケーション層（`application/export/`）に置く。Note ドメインは `JobId` を参照せず、依存表（[domains/index.md](../domains/index.md)）と ADR-008 の依存図の注記も「Note は Job を知らない」を明示する。チケット型を参照する側（`exportNote` / `getExportStatus` / `downloadExportArtifact` と、それを引くドメイン文書）の参照先は domains/note.md ではなくアプリケーション層の定義になる
- 有効期間が 30 分に確定したことで、失効の境界値テストが具体値を持てる（`issuedAt + 30 分`）
