import Link from "next/link";

export const metadata = {
  title: "隐私政策 - PPT学习助手",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href="/"
        className="mb-8 inline-block text-sm text-[var(--tx-5)] hover:text-[var(--tx-3)] transition-colors"
      >
        &larr; 返回首页
      </Link>

      <article className="prose prose-neutral max-w-none">
        <h1>隐私政策</h1>
        <p className="text-sm text-gray-500">最后更新：2026年3月</p>

        <h2>1. 收集的数据</h2>
        <p>为了提供学习辅助服务，我们会收集以下信息：</p>
        <ul>
          <li><strong>账户信息：</strong>电子邮件地址、显示名称。</li>
          <li><strong>使用数据：</strong>学习会话记录、聊天消息、笔记、测验记录等。</li>
          <li><strong>上传的文档：</strong>用户上传的PPT及相关文件。</li>
        </ul>

        <h2>2. 数据收集目的</h2>
        <p>
          收集上述数据的唯一目的是为用户提供个性化的学习辅助服务，包括幻灯片讲解、智能问答、笔记管理和复习功能。
        </p>

        <h2>3. 第三方数据共享</h2>
        <p>
          本服务使用阿里云DashScope API处理文档内容和生成讲解。这意味着您上传的文档内容和相关请求数据会被发送至阿里云位于中国大陆的服务器进行处理。除此之外，我们不会将您的个人数据分享给任何其他第三方。
        </p>

        <h2>4. 数据保留</h2>
        <p>
          您的数据将一直保留，直到您主动请求删除账户。删除账户后，所有关联数据（包括上传的文档、学习记录、笔记等）将被永久删除。
        </p>

        <h2>5. 用户权利</h2>
        <p>您对自己的个人数据享有以下权利：</p>
        <ul>
          <li><strong>访问权：</strong>您可以随时查看自己的账户信息和学习数据。</li>
          <li><strong>更正权：</strong>您可以修改自己的账户信息。</li>
          <li><strong>删除权：</strong>您可以通过账户设置删除自己的账户及所有关联数据。</li>
        </ul>

        <h2>6. 数据安全</h2>
        <ul>
          <li>用户密码使用加密算法（bcrypt）安全存储，我们无法查看您的明文密码。</li>
          <li>使用JWT（JSON Web Token）进行身份认证，保障会话安全。</li>
          <li>所有API通信通过HTTPS加密传输。</li>
        </ul>

        <h2>7. Cookie与本地存储</h2>
        <p>
          本服务不使用Cookie。我们仅使用浏览器本地存储（localStorage）保存登录令牌以维持您的登录状态。您可以随时通过清除浏览器数据来移除这些信息。
        </p>

        <h2>8. 隐私政策更新</h2>
        <p>
          我们可能会不时更新本隐私政策。重大变更将通过服务内通知告知用户。继续使用本服务即视为接受更新后的隐私政策。
        </p>

        <h2>9. 联系方式</h2>
        <p>
          如果您对本隐私政策有任何疑问，或希望行使您的数据权利，请通过以下方式联系我们：
        </p>
        <ul>
          <li>电子邮件：[待补充]</li>
        </ul>
      </article>
    </main>
  );
}
