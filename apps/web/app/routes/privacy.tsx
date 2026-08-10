import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/layout/LegalPage";
import { buildHead } from "@/presentation/head";

export const Route = createFileRoute("/privacy")({
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `プライバシーポリシー — ${config.siteName}`,
      path: "/privacy",
    });
    return { meta, links };
  },
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage title="プライバシーポリシー" updated="2026年7月1日 改定">
      <h2 id="p1">1. 取得する情報</h2>
      <p>本サービスは、提供に必要な範囲で次の情報を取得します。</p>
      <ul>
        <li>アカウント情報（メールアドレス、表示名、認証情報）</li>
        <li>利用者がアップロードしたファイルと、そこから生成された内容</li>
        <li>
          サービスの利用記録（アクセス日時、操作の種類、接続元 IP アドレス）
        </li>
      </ul>

      <h2 id="p2">2. 利用目的</h2>
      <ol>
        <li>本サービスの提供・維持・改善</li>
        <li>本人確認と不正利用の防止（サインインの試行制限を含む）</li>
        <li>確認メールなど、サービス運用上の通知の送信</li>
      </ol>

      <h2 id="p3">3. 外部サービスへの送信</h2>
      <p>
        変換に言語モデルを利用する設定を選んだ場合、対象ファイルから抽出した内容が利用者の連携先（OpenRouter
        など）へ送信されます。連携は利用者の操作で開始され、いつでも解除できます。
      </p>

      <h2 id="p4">4. 第三者提供</h2>
      <p>
        法令に基づく場合を除き、本人の同意なく個人情報を第三者に提供しません。公開範囲を「公開」または「リンクを知る人」に設定したノートは、その設定に従って第三者が閲覧できます。
      </p>

      <h2 id="p5">5. 保存期間と削除</h2>
      <p>
        アカウントを削除すると、アカウントに紐づく情報は削除処理の完了をもって消去されます。ワークスペースに残るノートは、作成者を「退会した利用者」と表示した状態でワークスペースに帰属し続けます。
      </p>

      <h2 id="p6">6. Cookie</h2>
      <p>
        サインイン状態の維持のために Cookie を使用します。この Cookie
        は認証以外の目的（広告・行動追跡）には使用しません。
      </p>

      <h2 id="p7">7. お問い合わせ</h2>
      <p>
        本ポリシーに関する問い合わせは、サービス内の案内に記載された窓口で受け付けます。
      </p>
    </LegalPage>
  );
}
