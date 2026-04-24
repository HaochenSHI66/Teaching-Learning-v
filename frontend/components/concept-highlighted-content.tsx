"use client";

import { MarkdownContent } from "@/components/markdown-content";

type ConceptHighlightedContentProps = {
  content: string;
  documentId?: string;
  slideId?: string;
  onJumpToSlide?: (slideId: string) => void;
  className?: string;
};

export function ConceptHighlightedContent({
  content,
  className,
}: ConceptHighlightedContentProps) {
  return content ? <MarkdownContent content={content} className={className} /> : null;
}
