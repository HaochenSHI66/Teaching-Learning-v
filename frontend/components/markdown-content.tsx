"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type MarkdownContentProps = {
  content: string;
  className?: string;
};

function stripCodeFence(markdown: string): string {
  const stripped = markdown.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "");
  // Only return stripped version if it actually removed an outer fence
  if (stripped.length < markdown.length) return stripped.trim();
  return markdown;
}

function normalizeCallouts(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      const matched = line.match(/^>\s*\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*$/i);
      if (!matched) return line;
      return `> **${matched[1].toUpperCase()}**`;
    })
    .join("\n");
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join("");
  }
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return flattenText(props?.children ?? "");
  }
  return "";
}

export function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
  return (
    <div className={`markdown-body prose prose-base max-w-none ${className}`}>
      <ReactMarkdown
        components={{
          blockquote: ({ children }) => {
            const text = flattenText(children).toUpperCase();
            let tone = "callout-note";
            if (text.includes("WARNING")) tone = "callout-warning";
            if (text.includes("TIP")) tone = "callout-tip";
            if (text.includes("IMPORTANT")) tone = "callout-important";

            return <blockquote className={`callout ${tone}`}>{children}</blockquote>;
          },
        }}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {normalizeCallouts(stripCodeFence(content))}
      </ReactMarkdown>
    </div>
  );
}
