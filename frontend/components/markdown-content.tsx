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
  onConceptClick?: (conceptName: string) => void;
};

function stripCodeFence(markdown: string): string {
  const stripped = markdown.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "");
  // Only return stripped version if it actually removed an outer fence
  if (stripped.length < markdown.length) return stripped.trim();
  return markdown;
}

/** Convert [[concept]] wiki-links to <concept-link> custom elements for rendering. */
function convertWikiLinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, '<concept-link data-concept="$1">$1</concept-link>');
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

export function MarkdownContent({ content, className = "", onConceptClick }: MarkdownContentProps) {
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
          // Render [[concept]] wiki-links as clickable pills
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({
            "concept-link": ({ node, ...props }: Record<string, unknown>) => {
              const concept = (props["data-concept"] ?? props.children) as string;
              return (
                <span
                  className="inline-flex cursor-pointer items-center rounded-md border border-[#c9d5b9] bg-[#eef4e6] px-1.5 py-0.5 text-[0.85em] font-medium text-[#5a7248] transition-colors hover:bg-[#ddebd0]"
                  onClick={() => onConceptClick?.(String(concept))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") onConceptClick?.(String(concept)); }}
                >
                  {props.children as React.ReactNode}
                </span>
              );
            },
          } as any),
        }}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {convertWikiLinks(normalizeCallouts(stripCodeFence(content)))}
      </ReactMarkdown>
    </div>
  );
}
