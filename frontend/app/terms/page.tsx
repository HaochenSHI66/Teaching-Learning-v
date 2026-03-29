import Link from "next/link";

export const metadata = {
  title: "服务条款 - PPT学习助手",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href="/"
        className="mb-8 inline-block text-sm text-[var(--tx-5)] hover:text-[var(--tx-3)] transition-colors"
      >
        &larr; 返回首页
      </Link>

      <article className="prose prose-neutral max-w-none">
        <h1>服务条款</h1>
        <p className="text-sm text-gray-500">最后更新：2026年3月</p>

        <h2>1. 服务说明</h2>
        <p>
          PPT学习助手（以下简称"本服务"）是一个个人学习辅助工具，旨在帮助用户理解和学习PPT幻灯片内容。本服务由学生开发者独立开发和维护。
        </p>

        <h2>2. 用户责任</h2>
        <ul>
          <li>用户只能上传自己拥有合法使用权的材料（如自己的课件、经授权分享的教学资料等）。</li>
          <li>用户不得上传侵犯他人知识产权的内容。</li>
          <li>用户应遵守所在地区的法律法规使用本服务。</li>
        </ul>

        <h2>3. 内容使用</h2>
        <ul>
          <li>用户上传的材料仅供个人学习使用，不会与其他用户共享。</li>
          <li>禁止通过本服务分享或再分发受版权保护的内容。</li>
          <li>用户生成的笔记和学习记录归用户个人所有。</li>
        </ul>

        <h2>4. 服务状态</h2>
        <p>
          本服务按现状（as-is）提供，由学生开发者维护。我们不保证服务的持续可用性或稳定性，但会尽最大努力保障服务正常运行。
        </p>

        <h2>5. 免责声明</h2>
        <ul>
          <li>AI生成的讲解内容可能不完全准确，仅供学习参考，不应作为唯一的学习依据。</li>
          <li>对于因使用本服务产生的任何直接或间接损失，我们不承担责任。</li>
          <li>用户应自行判断AI生成内容的准确性和适用性。</li>
        </ul>

        <h2>6. 条款修改</h2>
        <p>
          我们保留随时修改本服务条款的权利。条款变更后继续使用本服务即视为接受修改后的条款。重大变更将通过服务内通知告知用户。
        </p>

        <h2>7. 联系方式</h2>
        <p>
          如有问题或建议，请通过以下方式联系我们：
        </p>
        <ul>
          <li>电子邮件：[待补充]</li>
        </ul>
      </article>
    </main>
  );
}
