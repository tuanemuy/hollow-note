# 動作確認計画 — Issue #19: [runtime] ScopeTaskScheduler に priority と lease を足し、spec/database の scheduled_tasks に揃える

**Issue:** #19
**作成日:** 2026-08-24

---

## 確認環境

このIssueの変更を確認するために必要な手順のみ記載（依存パッケージのインストール等、プロジェクト全体のセットアップは省略）。

本 Issue は backend / ポート契約の変更で UI は変わらない。実機で観測できるのは **scope task ランナーが駆動する唯一の実装済み経路＝アカウント削除の完走**と、**`SCOPE_TASK_LEASE_MS` の env 配線**の 2 つだけである。それ以外の契約（選択規則・遷移表・入力境界）は適合スイートと単体テストが正本なので、下の項目 6 に集約する。

### 環境変数（起動前に必須）

`apps/web/.env` が次の 3 行であること（現状のファイルがそのまま使える）。

```
APP_URL=http://localhost:3100
OAUTH_DEV_MODE=true
MEMORY_MAIL_LOG_ACTION_URL=true
```

- `OAUTH_DEV_MODE=true` — Google 資格情報なしでサインインを済ませるためのループバック IdP（同意画面はアプリ内ルート `/dev/oauth/authorize`）。**これが無いと dev の boot が拒否される**（`apps/web/.env.example`「Exactly one of the two setups below must be configured or boot fails」）。`NODE_ENV=development` でしか受理されないので、**`pnpm start`（本番ビルド）では使えない** — 項目 4 では外す。
- `APP_URL` の**ポートがそのまま dev サーバーの待ち受けポート**になる（`apps/web/vite.config.node.ts` が `APP_URL` から `server.port` を導く）。現状の `.env` は `3100` なので **`http://localhost:3100`** を開く。
- `MEMORY_MAIL_LOG_ACTION_URL=true` — 本計画は OAuth 経路でサインインするので必須ではないが、既存の行はそのまま残してよい。
- `SCOPE_TASK_LEASE_MS` は項目 3・4 とエッジケース 2 でだけ足す。**書く値は `apps/web/.env.example` の該当行をコピーして使う**（AC-17 が要求する記載。行が無ければその時点で AC-17 未達）。

### 検証環境の起動

すべてリポジトリルートで実行する。

| 用途 | コマンド | 出典（実ファイルで確認） |
| --- | --- | --- |
| 開発サーバー | `pnpm dev` | root `package.json` の `scripts.dev`（→ `@repo/web` の `dev:node` = `vite dev --config vite.config.node.ts`）/ `README.md`「Development commands」/ `CLAUDE.md`「Development Commands」。URL は `APP_URL` のポート（現状 `http://localhost:3100`） |
| 型検査 | `pnpm typecheck` | root `package.json` の `scripts.typecheck`（`tsgo && pnpm -r typecheck`）/ `CLAUDE.md`「After changes」 |
| Lint（自動修正） | `pnpm lint:fix` | root `package.json` の `scripts.lint:fix`（`biome check --write`）/ `README.md` |
| 整形 | `pnpm format` | root `package.json` の `scripts.format`（`biome format --write`）/ `README.md` |
| 単体テスト・適合スイート | `pnpm test` | root `package.json` の `scripts.test` → `test:unit`（`vitest run`）/ `README.md`「Development commands」 |
| 本番ビルド | `pnpm build` | root `package.json` の `scripts.build` → `@repo/web` の `build:node`（`vite build --config vite.config.node.ts`） |
| 本番起動 | `pnpm start` | root `package.json` の `scripts.start` → `@repo/web` の `start:node`（`tsx scripts/listen.node.ts`）。待ち受け URL は起動ログの `[listen.node] listening on http://...` 行 |

アバターアップロード用のテストファイル（項目 1 で 1 度だけ作る。`node -e` の一行実行は `.thread/2/testing.md`「テスト用ファイルの準備」の慣用に倣う）:

```
mkdir -p /tmp/hollow-manual-19 && node -e "
const fs=require('fs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
fs.writeFileSync('/tmp/hollow-manual-19/avatar.png',Buffer.concat([png,Buffer.alloc(64*1024-png.length)]));
"
```

補足（すべて実ファイルで確認済み）:

- **DB のマイグレーション・シードは不要。** 永続化は in-memory アダプターのみで、`package.json` に `db:*` スクリプトは存在しない（`README.md`「Persistence is in-memory, so there is no schema to generate and no migration command.」）。
- **データはプロセス内メモリのみ。** 各項目は「1 プロセスで完結する」単位で書いてあるが、項目をまたいでアカウントを使い回さない（サーバーを落とすと全消去されるため、各項目の冒頭でアカウントを作り直す）。
- **dev では boot が遅延する。** `apps/web/app/server.node.ts` の `getOrStartBoot()` は最初のリクエストで走るので、env が不正でも `pnpm dev` の起動時点では失敗せず、**最初にページを開いた時点で 500 とターミナルのエラー**になる。起動そのものの成否で判定したい項目 4 は `pnpm start`（`apps/web/scripts/listen.node.ts` が起動時に `boot()` を呼ぶ）で行う。
- **scope task ランナーは dev サーバーと同一プロセスで動く**（1 秒 tick + commit kick）。削除は数秒で `accepted` → `running` → `completed` まで進むので、判定は最大 60 秒待って行う。

### デプロイ方法

なし（Node ランタイム一本。ローカルの `pnpm dev` と `pnpm build` → `pnpm start` だけで確認できる）。

## 確認項目

実機で観測できない AC は項目にしない。**AC-2〜AC-6（選択規則）・AC-9（遷移表）・AC-10（入力境界）・AC-11 / AC-13（未登録 kind とリース中の再入）は、参照ランタイムに未登録 kind も複数 writer も存在しないため画面からは観測できず、項目 6（`pnpm test`）に集約する。AC-14（spec の改訂）・AC-15（ポート JSDoc の縮退記述除去）は文書側の基準なのでレビューで確認する。**

### 1. アカウント削除が claim → 処理 → settle を跨いで完走する

- **対応する受け入れ基準:** AC-16（+ AC-7 の実機側面）
- **検証手段:** browser
- **目的:** claim がリースを取るようになった後も、継続タスクで駆動されるアカウント削除が最後まで進むことを確かめる。**この Issue が壊しうる唯一の実装済み経路**であり、`claim 件数 ≤ その round で処理する件数` の不変条件（steps.md ステップ 8 の WHY コメント）が破れていれば、行がリース期間ぶん（既定 5 分）ロックされて進捗が止まる
- **手順:**
  1. リポジトリルートで `pnpm dev` を実行し、ターミナルを見える位置に置く
  2. `http://localhost:3100/signin` を開き、「Google で続ける」→ 同意画面で `del-a@example.com` / 表示名 `削除太郎` / `email_verified` を **ON** にして「許可する」を押す
  3. `/notes` でノートを 3 件作る
  4. `/settings/profile` の「画像を選ぶ」で `/tmp/hollow-manual-19/avatar.png` を選び、保存する（`deleteFilesByOwner` に削除対象を持たせるため）
  5. `/settings/danger` を開き、確認欄に `del-a@example.com` を入力して「アカウントを削除する」を押す
  6. 画面から離れずに進捗表示を最大 60 秒観察する
  7. 完了表示の遷移導線を押し、そのあと `/notes` を開く
- **期待結果:** 手順 6 で進捗が `accepted` → `running` → `completed` と進み、**数秒（遅くとも 60 秒以内）で完了する**。手順 7 でトップページへ遷移し、`/notes` はサインイン画面へ倒れる。
- **確認ポイント:**
  - **進捗が `running` のまま数十秒〜5 分止まったら本 Issue の退行**である。5 分（既定 `SCOPE_TASK_LEASE_MS`）経ってから急に進む場合、claim した行をその round で処理しきれておらず、リース失効の回収でしか前に進めていない。
  - ターミナルに **`[scope-tasks] task threw` / `[scope-tasks] backoff failed` / `[scope-tasks] no handler for …` が 1 行も出ないこと**。`no handler` が出たら priority を足した継続 kind の綴りがハンドラ表とずれている。
  - 削除完了後にターミナルへ **`[scope-tasks]` 系の警告が周期的に立ち続けないこと**（立つ場合、リースを取ったまま settle されない行が残っている）。

### 2. 2 アカウントの削除を並行して受理しても両方完走する

- **対応する受け入れ基準:** AC-6、AC-16
- **検証手段:** browser
- **目的:** `listDue` に scope 横断の枠取りが入った後も、複数 scope に due な行がある状況で**どの scope も取り残されない**ことを実機で確かめる（`listDue` の候補述語とリース不可視が scope 横断で効いていること）
- **手順:**
  1. `pnpm dev` を再起動する（前項目のデータを捨てる）
  2. ウィンドウ1（通常）で `del-b@example.com` / 表示名 `削除次郎`、ウィンドウ2（シークレット）で `del-c@example.com` / 表示名 `削除三郎` を、それぞれ手順 1〜2 と同じ OAuth 経路でサインインして作る。どちらもノートを 3 件ずつ作る
  3. ウィンドウ1 の `/settings/danger` で `del-b@example.com` を入力して削除を実行する
  4. **その直後（数秒以内）に**ウィンドウ2 の `/settings/danger` で `del-c@example.com` を入力して削除を実行する
  5. 両ウィンドウの進捗表示を最大 60 秒観察する
- **期待結果:** 2 つとも `completed` に到達する。片方が先に完了しても、もう片方が待たされたまま止まることはない。
- **確認ポイント:**
  - **片方が `running` のまま止まったら、`listDue` が一方の scope の行で埋まって他方を候補に載せていない**（ADR-007 が `listDue` にも枠取りを課した理由そのもの）。
  - 手順 4 のタイミングが取れず 1 件目が完了してしまった場合は「並行にならなかった」と記録し、`pnpm dev` を再起動してやり直す。2 件が本当に重なったかは、ターミナルの削除ログが交互に出ることで判断する。
  - 実装済み 4 kind はすべて priority 0（security cleanup）か 3（期限回収）なので、**この項目で観測できるのは「複数 scope が取り残されない」ことまで**である。priority クラス間の枠取りそのものは項目 6 の適合スイートが拘束する。

### 3. `SCOPE_TASK_LEASE_MS` を配備側が選べる（dev で値が届く）

- **対応する受け入れ基準:** AC-17
- **検証手段:** browser
- **目的:** `TuningEnv` → `NodeServerEnv` → runner tuning → `runDueScopeTasks` の 1 本道が実際に繋がっており、env に値を置いた状態でも削除が従来どおり完走することを確かめる
- **手順:**
  1. `apps/web/.env.example` を開き、「Optional: outbox / worker tuning」節に `SCOPE_TASK_LEASE_MS` の行（既定値つきのコメント）があることを確認し、**その行をコピーして** `apps/web/.env` に貼り、コメントを外して有効化する（例: `SCOPE_TASK_LEASE_MS=600000`）
  2. `pnpm dev` を再起動する
  3. `http://localhost:3100/signin` から `del-d@example.com` / 表示名 `削除四郎` でサインインし、ノートを 3 件作る
  4. `/settings/danger` で削除を実行し、進捗を最大 60 秒観察する
  5. 確認後、`apps/web/.env` の `SCOPE_TASK_LEASE_MS` の行を消す
- **期待結果:** 手順 1 で `.env.example` に既定値つきの行が実在する。手順 2 でサーバーが起動し、手順 4 で削除が `completed` まで進む（既定値のときと所要時間が変わらない）。
- **確認ポイント:**
  - **手順 1 で `.env.example` に行が無ければ AC-17 未達**（値の届き方が正しくても、配備側は口の存在を知りようがない）。
  - 手順 2 でページを開いた瞬間に 500 になり、ターミナルに zod のエラーが出る場合は、`.env.example` に載っている書式そのものが受理されていない（既定値のコメントと schema の不一致）。
  - この項目は「値が届いても壊れない」ところまでしか見ない。**届いた値が実際に `claimDue` の `leaseMs` になっているか**の観測はエッジケース 2 で行う。

### 4. 正でない `SCOPE_TASK_LEASE_MS` は boot を拒否する

- **対応する受け入れ基準:** AC-17
- **検証手段:** api
- **目的:** `leaseMs` が正の整数であることを boot 時の zod が強制し、**不正な値のまま起動してしまわない**ことを、起動の成否が終了コードに出る本番ランチャーで確かめる
- **手順:**
  1. `apps/web/.env` を次の内容にする（`pnpm start` は `NODE_ENV=production` を宣言するので `OAUTH_DEV_MODE` は受理されない。外さないと**別の理由で**起動が失敗し、この項目の判定にならない）:
     ```
     APP_URL=http://localhost:3000
     GOOGLE_OAUTH_CLIENT_ID=dummy
     GOOGLE_OAUTH_CLIENT_SECRET=dummy
     SCOPE_TASK_LEASE_MS=0
     ```
  2. リポジトリルートで `pnpm build`
  3. `pnpm start` を実行し、終了するまで待って `echo $?` で終了コードを見る
  4. `.env` の `SCOPE_TASK_LEASE_MS=0` を `SCOPE_TASK_LEASE_MS=abc` に変えて `pnpm start` を再実行する
  5. `.env` の `SCOPE_TASK_LEASE_MS` の行を削除して `pnpm start` を再実行し、起動を確認したら `Ctrl+C` で止める
  6. `.env` を確認環境の 3 行（`APP_URL=http://localhost:3100` / `OAUTH_DEV_MODE=true` / `MEMORY_MAIL_LOG_ACTION_URL=true`）に戻す
- **期待結果:**
  - 手順 3・4: プロセスが**起動せずに終了**する。標準エラーに `[listen.node] failed to start` が出て、その cause に `leaseMs`（`SCOPE_TASK_LEASE_MS` から射影されるフィールド名）を含む zod のバリデーションエラーが出る。終了コードは **1**。`[listen.node] listening on http://...` は**出ない**。
  - 手順 5: `[listen.node] listening on http://...` が出て起動する（未設定なら `SCOPE_TASK_LEASE_MS` 定数の既定値が使われる）。
- **確認ポイント:**
  - **失敗メッセージが `leaseMs` ではなく `OAUTH_DEV_MODE` を指していたら手順 1 の `.env` の作り直しから**（OAuth の refinement が先に走るので、`OAUTH_DEV_MODE=true` が残っているとリース値の検査まで到達しない）。
  - 手順 3・4 で**起動してしまったら AC-17 未達**（`z.coerce.number().int().positive()` になっていない、または `readScopeTaskTuning` が `boot()` から呼ばれていない）。
  - `pnpm dev` では boot が最初のリクエストまで遅延するので、この項目を `pnpm dev` で代替しない（起動の成否として観測できない）。

### 5. 静的検査が緑

- **対応する受け入れ基準:** AC-16
- **検証手段:** api
- **目的:** 署名変更（`claimDue` のオブジェクト引数化・`priority` 必須化）と `ScheduledTaskRow` の判別共用体化が、全呼び出し側・全テストへ追随しきっていることを型で確かめる
- **手順:**
  1. リポジトリルートで `pnpm typecheck`
  2. `pnpm lint:fix`
  3. `pnpm format`
- **期待結果:** 3 つとも成功で終了する（`pnpm typecheck` は `tsgo` と `pnpm -r typecheck` の両方が緑）。
- **確認ポイント:** `pnpm lint:fix` / `pnpm format` は書き込みを伴うので、**実行後に差分が出たらそれもコミット対象**。判別共用体化で `dueAt` を読めなくなる箇所（`deleteAccount.cleanup.test.ts` / `deleteAccount.terminalPrune.test.ts` / `deleteFilesByOwner.test.ts` の生行観測）は、ここで型エラーとして必ず露見する。

### 6. 適合スイートと application 層のテストが緑

- **対応する受け入れ基準:** AC-12（＝ AC-1〜AC-10 の拘束）、AC-11、AC-13、AC-16
- **検証手段:** api
- **目的:** 画面から観測できない契約（priority 順・予約枠・返却集合の一意性・リースと reclaim・遷移規則・`limit <= 0`・未登録 kind のリース挙動・settle しないハンドラの再入）が、memory バックエンドで実際に成立していることを確かめる
- **手順:**
  1. リポジトリルートで `pnpm test`
- **期待結果:** 全ファイルが緑で終了する。出力に少なくとも次が含まれる:
  - `packages/core/src/adapters/conformance/scopeTaskScheduler.ts` を通す適合スイート（既存 8 ケース + priority / 予約枠 / 返却順 / `limit` 縮退 / リース / reclaim / 遷移 / `limit <= 0` の追加ケース）
  - `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`（AC-11 の「リース中は `listDue` に出ず、失効後に戻り、`failed` に落ちない」と AC-13 の「同じ clock で 2 回連続実行 → ハンドラ 1 回 / `processed: 0` / `attempt` と `dueAt` が不変」）
  - 回帰群: `deleteAccount.cleanup.test.ts` / `deleteAccount.terminalPrune.test.ts` / `deleteFilesByOwner.test.ts` / `deleteQuota.test.ts` / `adapters/memory/__tests__/unitOfWork.test.ts`
- **確認ポイント:**
  - **落ちたケースが「新しい契約を実装できていない」のか「既存ケースの前提がリースで変わった」のかを区別する。** 後者は steps.md ステップ 10 が名指しする範囲（`scopeTaskRunner.test.ts` の 204-225 だけが壊れる見積もり）に収まっているはずで、それ以外が壊れたら見積もり自体を疑う。
  - `SCOPE_TASK_LEASE_MS` の env 配線には専用テストを足さない方針（`OUTBOX_LEASE_MS` の先例に揃える）なので、**AC-17 はこの項目では担保されない**。項目 3・4 が唯一の検証。

## エッジケース・異常系

### 1. 削除の進行中に dev サーバーがリロードされてもデッドロックしない

- **検証手段:** browser
- **対応する受け入れ基準:** AC-8（リース失効後の reclaim）、AC-16
- **目的:** Issue が名指しする「dev サーバーのリロードで runner が入れ替わる」状況で、**claim したまま settle されなかった行がリース失効で回収される**ことを実機で確かめる。参照ランタイムは 1 プロセス・in-memory なので、**store を保ったまま runner が入れ替わる唯一の窓がこの HMR リロード**であり、reclaim を実機で観測できる唯一の手段になる
- **手順:**
  1. `apps/web/.env` に `SCOPE_TASK_LEASE_MS=10000`（10 秒）を足して `pnpm dev` を起動する（既定の 5 分では待ち時間が長すぎて判定できない）
  2. `del-e@example.com` / 表示名 `削除五郎` でサインインし、ノートを 20 件ほど作ってアバターも保存する（削除の turn 数を増やして窓を広げるため）
  3. `/settings/danger` で削除を実行する
  4. 進捗が `running` になった直後に、`apps/web/app/routes/index.tsx` を開いて**空白 1 文字を足して保存**し、HMR を起こす（ターミナルに `[server.node] retiring the previous boot` → `[server.node] worker runner started` が出る）
  5. 進捗表示を最大 90 秒観察する
  6. 確認後、`.env` の `SCOPE_TASK_LEASE_MS` の行を消す
- **期待結果:** 削除は `completed` まで到達する。途中で止まっても、**遅くともリース失効（10 秒）後の tick で再 claim されて前進する**。
- **確認ポイント:**
  - **90 秒経っても `running` のままなら、リース失効行が候補に戻っていない**（候補述語 `running AND leaseExpiresAt <= now` の欠落、または `listDue` 側だけ失効を見ていない）。本 Issue の中心的な退行なので、この場合は `SCOPE_TASK_LEASE_MS` を 3000 まで下げて再試験し、再現するなら起票する。
  - **リロードのタイミングが取れず、リロード前に削除が完了してしまうことは普通に起きる。** その場合は「窓に入らなかった」と記録し、手順 2 のノート件数を増やして 2〜3 回やり直す。3 回試して窓に入らなければ「未再現」と記録して打ち切る（既定の在庫では turn が短すぎるという事実の記録であって、失敗ではない）。
  - reclaim が起きた場合でも **`attempt` は増えない**（ADR-004）ので、削除がバックオフで遅くなる兆候（進捗が指数的に間延びする）が出たら、リース失効の回収が `backoff` 経由になっている疑いがある。

### 2. 極端に短いリースでも取り違えが起きない

- **検証手段:** browser
- **対応する受け入れ基準:** AC-17、AC-7
- **目的:** env で渡した値が実際に `claimDue` の `leaseMs` として使われていること（項目 3 が見送った部分）を、**リースが turn より短いときにしか起きない挙動**で裏取りする。ADR-005 のとおり settle は fencing しないので、リースが短すぎれば「継続の鎖が止まる」ことがありうる
- **手順:**
  1. `apps/web/.env` に `SCOPE_TASK_LEASE_MS=1000`（1 秒。ランナーの tick と同じ長さ）を足して `pnpm dev` を起動する
  2. `del-f@example.com` / 表示名 `削除六郎` でサインインし、ノートを 20 件ほど作ってアバターも保存する
  3. `/settings/danger` で削除を実行し、進捗を最大 90 秒観察する
  4. ターミナルのログを確認する
  5. 確認後、`.env` の `SCOPE_TASK_LEASE_MS` の行を消す
- **期待結果:** 削除は `completed` まで到達する。実装済み 4 kind はいずれも**自分の turn の中で settle する**（`complete` か `schedule` で再武装する）ので、1 秒のリースでも取り違えの窓には入らない。
- **確認ポイント:**
  - **`[scope-tasks] task threw` が繰り返し出て削除が止まる場合**、リースが短いことで同じ行が二重に claim され、負けた側が空振りしている。これは ADR-005 が「実害は配備側の判断のまま残る」とした窓が 1 秒という極端な値で顕在化したもので、**不具合ではなく設計どおりの縮退**として記録する（起票しない）。値を 300000 に戻して完走することまで確認する。
  - 逆に **`SCOPE_TASK_LEASE_MS=1000` でも既定値のときと何ひとつログが変わらない場合は、env の値が `claimDue` まで届いていない疑い**がある（項目 3 は「壊れないこと」しか見ないので、ここが実質的な配線確認になる）。その場合は `runner.ts` の `runScopeTaskTick` が `runDueScopeTasks(container, { leaseMs })` を渡しているかを先に疑う。

## 既存機能への影響確認

- **アカウント削除の完走（`deleteFilesByOwner` / `deleteQuota` / personal cleanup hand-over / barrier prune の 4 kind）** — 本 Issue が触る継続経路のすべて。項目 1（単一）・項目 2（並行）・エッジケース 1・2 で通す。ここが緑なら、priority を渡す 6 か所と runner の claim 変更が実機で成立している。
- **通常の書き込み操作（ノートの作成・削除、`/settings/profile` のアバター保存）** — `claimDue` が書き込みになったことで scope UoW の commit kick（`scopeTaskTrigger.kick` は `schedule` のラップだけが立てる）が誤って発火すると、無用な tick が回る。項目 1 手順 3・4 の操作中に、ターミナルへ `[scope-tasks]` 系のログが**出ないこと**を併せて見る。
- **outbox の relay / prune の tuning（`OUTBOX_BATCH_SIZE` / `OUTBOX_LEASE_MS` / `OUTBOX_MAX_ATTEMPTS` / `OUTBOX_RETENTION_MS`）** — `SCOPE_TASK_LEASE_MS` は同じ `TuningEnv` → `NodeServerEnv` → runner tuning の経路に 1 変数増やす変更なので、既存 4 変数の射影が壊れうる。項目 4 手順 1 の `.env` に `OUTBOX_LEASE_MS=300000` も足した状態で `pnpm start` が起動すること（手順 5 の起動確認と同時に見る）。
- **本番ビルド（`pnpm build` → `pnpm start`）** — dev（vite の `loadEnv`）と本番（`listen.node.ts` の dotenv）で env の読み込み経路が違う。項目 4 手順 5 で `[listen.node] listening on http://...` が出るところまで確認する。**OAuth のループバック IdP は本番では使えない**ので、本番ビルドでの削除の完走までは追わない（サインイン手段がメール + パスワードに限られ、本 Issue の変更点とは独立した経路になるため）。
- **`spec/database` / `spec/platform` の改訂（AC-14）と ポート JSDoc の縮退記述の除去（AC-15）** — 実機からは観測できない。レビューで、`scheduled_tasks` の `lease_expires_at` 列・`scheduled_tasks_lease_idx`・Alarm 起床規則 2 か所と、`application/ports/scopeTaskScheduler.ts` から縮退記述 3 文が消えていることを目視で確認する。
