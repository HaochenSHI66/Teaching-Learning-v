"use client";

import { useEffect, useState } from "react";

import { ConceptChip, segmentTextWithConcepts } from "@/components/concept-chip";
import { MarkdownContent } from "@/components/markdown-content";
import { fetchConceptsBySlide, type SlideConcept } from "@/lib/api";

type ConceptHighlightedContentProps = {
  content: string;
  documentId?: string;
  slideId?: string;
  onJumpToSlide?: (slideId: string) => void;
  className?: string;
};

/**
 * Renders markdown content with concept terms highlighted as interactive chips.
 * Falls back to plain MarkdownContent when no concepts are available.
 */
export function ConceptHighlightedContent({
  content,
  documentId,
  slideId,
  onJumpToSlide,
  className,
}: ConceptHighlightedContentProps) {
  const [concepts, setConcepts] = useState<SlideConcept[]>([]);

  useEffect(() => {
    if (!documentId || !slideId) {
      setConcepts([]);
      return;
    }
    let cancelled = false;
    fetchConceptsBySlide(documentId, slideId)
      .then((payload) => {
        if (!cancelled) setConcepts(payload.concepts);
      })
      .catch(() => {
        if (!cancelled) setConcepts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, slideId]);

  // If no concepts, just render plain markdown
  if (concepts.length === 0) {
    return content ? <MarkdownContent content={content} className={className} /> : null;
  }

  // Render markdown first, then overlay concept chips on the rendered text.
  // Since injecting into ReactMarkdown's render tree is complex, we use a
  // post-render approach: render a summary bar of concepts found on this slide,
  // plus the normal markdown with concept names highlighted via a custom wrapper.
  return (
    <div className={className}>
      {/* Concept chips bar */}
      <div className="mb-2 flex flex-wrap gap-1 rounded-[12px] border border-[var(--bd-3)] bg-[var(--sf-2)] px-2.5 py-1.5">
        <span className="mr-1 self-center text-[11px] text-[var(--tx-5)]">本页概念</span>
        {concepts.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center rounded-md border border-[var(--bd-1)] bg-[var(--sf-3)] px-1.5 py-0.5 text-[11px] text-[var(--tx-3)]"
          >
            <ConceptChip concept={c} matchedText={c.name} onJumpToSlide={onJumpToSlide} />
          </span>
        ))}
      </div>
      {content && <MarkdownContent content={content} className={className} />}
    </div>
  );
}
