"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { SlideConcept } from "@/lib/api";

type ConceptChipProps = {
  concept: SlideConcept;
  matchedText: string;
  onJumpToSlide?: (slideId: string) => void;
};

/**
 * Inline chip that highlights a concept term in the explanation text.
 * On click, shows a popover with description, prerequisites info, and navigation.
 */
export function ConceptChip({ concept, matchedText, onJumpToSlide }: ConceptChipProps) {
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        chipRef.current?.contains(e.target as Node) ||
        popoverRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const handleJumpToFirst = useCallback(() => {
    if (concept.slide_ids.length > 0 && onJumpToSlide) {
      onJumpToSlide(concept.slide_ids[0]);
    }
    setOpen(false);
  }, [concept.slide_ids, onJumpToSlide]);

  return (
    <span ref={chipRef} className="relative inline">
      <span
        className="cursor-pointer rounded-[4px] bg-[#f0e6d6] px-0.5 py-[1px] text-[#5a4530] transition-all hover:border-b hover:border-[#c49a3a] hover:bg-[#e8dbc5]"
        onClick={handleToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleToggle();
        }}
        role="button"
        tabIndex={0}
      >
        {matchedText}
      </span>

      {open && (
        <div
          ref={popoverRef}
          className="absolute left-1/2 top-full z-50 mt-1.5 w-64 -translate-x-1/2 rounded-[14px] border border-[#d9c7ab] bg-[#fffaf1] p-3 shadow-[0_8px_24px_rgba(109,85,58,0.18)]"
        >
          {/* Arrow */}
          <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-[#d9c7ab] bg-[#fffaf1]" />

          <p className="text-[13px] font-semibold text-[#3a2c1c]">{concept.name}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[#7a6248]">
            {concept.description || "暂无描述"}
          </p>

          {/* Slide references */}
          {concept.slide_ids.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-[11px] text-[#9a846a]">
                出现于 {concept.slide_ids.length} 页
              </span>
              <button
                className="rounded-md border border-[#d0bfa4] bg-[#f0e5d1] px-2 py-0.5 text-[11px] font-medium text-[#6b5540] transition-colors hover:bg-[#e8d8c0]"
                onClick={handleJumpToFirst}
                type="button"
              >
                跳转到首次出现
              </button>
            </div>
          )}

          {/* Flashcard count */}
          {concept.flashcard_count > 0 && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-[11px] text-[#9a846a]">
                {concept.flashcard_count} 张闪卡
              </span>
              <span className="rounded-md border border-[#c9d5b9] bg-[#eef4e6] px-2 py-0.5 text-[11px] font-medium text-[#5a7248] transition-colors hover:bg-[#ddebd0] cursor-default">
                查看闪卡
              </span>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

// ── Utility: inject ConceptChips into plain text ──────────────

type ConceptChipSegment =
  | { type: "text"; text: string }
  | { type: "chip"; concept: SlideConcept; matchedText: string };

/**
 * Split a plain text string into segments, matching concept names (case-insensitive substring).
 * Longer concept names are matched first to avoid partial overlaps.
 */
export function segmentTextWithConcepts(
  text: string,
  concepts: SlideConcept[],
): ConceptChipSegment[] {
  if (!concepts.length || !text) return [{ type: "text", text }];

  // Sort by name length descending so longer matches take priority
  const sorted = [...concepts].sort((a, b) => b.name.length - a.name.length);

  // Build a case-insensitive regex matching any concept name
  const escaped = sorted.map((c) => escapeRegExp(c.name)).filter(Boolean);
  if (escaped.length === 0) return [{ type: "text", text }];

  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const segments: ConceptChipSegment[] = [];
  let lastIndex = 0;
  const matched = new Set<string>(); // only highlight first occurrence of each concept

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const matchedText = match[0];
    const conceptNameLower = matchedText.toLowerCase();

    // Find the concept this match corresponds to
    const concept = sorted.find((c) => c.name.toLowerCase() === conceptNameLower);
    if (!concept) continue;

    // Only highlight first occurrence
    if (matched.has(concept.id)) continue;
    matched.add(concept.id);

    if (match.index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "chip", concept, matchedText });
    lastIndex = match.index + matchedText.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }

  return segments;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
