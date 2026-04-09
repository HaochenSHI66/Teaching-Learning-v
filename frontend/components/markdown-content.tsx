"use client";

import { useEffect, useRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import mermaid from "mermaid";

// Initialize mermaid once
mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  fontFamily: "inherit",
  securityLevel: "loose",
});

type MarkdownContentProps = {
  content: string;
  className?: string;
  onConceptClick?: (conceptName: string) => void;
};

function stripCodeFence(markdown: string): string {
  const stripped = markdown.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "");
  if (stripped.length < markdown.length) return stripped.trim();
  return markdown;
}

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

/** Renders a mermaid code block as an SVG diagram. */
function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
    let cancelled = false;

    mermaid.render(id, code.trim()).then(({ svg }) => {
      if (!cancelled && containerRef.current) {
        containerRef.current.innerHTML = svg;
      }
    }).catch(() => {
      // If mermaid fails to render, show the raw code
      if (!cancelled && containerRef.current) {
        containerRef.current.textContent = code;
        containerRef.current.className = "whitespace-pre-wrap text-sm text-[var(--tx-4)] bg-[var(--sf-3)] rounded-xl p-4";
      }
    });

    return () => { cancelled = true; };
  }, [code]);

  return (
    <div
      ref={containerRef}
      className="my-3 flex justify-center overflow-x-auto rounded-xl border border-[var(--bd-2)] bg-[var(--sf-1)] p-4"
    />
  );
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
          // Render mermaid code blocks as diagrams
          code: ({ className: codeClassName, children, ...rest }) => {
            const match = /language-mermaid/.exec(codeClassName || "");
            if (match) {
              return <MermaidBlock code={String(children).replace(/\n$/, "")} />;
            }
            return <code className={codeClassName} {...rest}>{children}</code>;
          },
          // Render fenced code blocks - check for mermaid
          pre: ({ children, ...rest }) => {
            // If the child is a mermaid code block, MermaidBlock handles it
            // Otherwise render normally
            return <pre {...rest}>{children}</pre>;
          },
          // Render [[concept]] wiki-links as clickable pills
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({
            "concept-link": ({ node, ...props }: Record<string, unknown>) => {
              const concept = (props["data-concept"] ?? props.children) as string;
              return (
                <span
                  className="inline-flex cursor-pointer items-center rounded-md border border-[var(--ac-green-border)] bg-[var(--ac-green-bg)] px-1.5 py-0.5 text-[0.85em] font-medium text-[var(--ac-green-text)] transition-colors hover:bg-[var(--ac-green-hover)]"
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
        rehypePlugins={[[rehypeRaw, { passThrough: ["math", "inlineMath"] }], rehypeKatex]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {convertWikiLinks(normalizeCallouts(stripCodeFence(content)))}
      </ReactMarkdown>
    </div>
  );
}
