"use client";

import { useState } from "react";

import {
  createBookmark,
  deleteBookmark,
  type Bookmark,
  type BookmarkTag,
} from "@/lib/api";

type SlideBookmarksProps = {
  slideId: string;
  documentId: string;
  bookmarks: Bookmark[];
  onBookmarksChange: () => void;
};

const TAG_CONFIG: {
  tag: BookmarkTag;
  label: string;
  activeColor: string;
  icon: (active: boolean, color: string) => React.ReactNode;
}[] = [
  {
    tag: "important",
    label: "重点",
    activeColor: "#dc2626",
    icon: (active, color) => (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 1.5l1.76 3.57 3.94.57-2.85 2.78.67 3.93L8 10.67l-3.52 1.68.67-3.93L2.3 5.64l3.94-.57L8 1.5z"
          fill={active ? color : "none"}
          stroke={active ? color : "#b09a87"}
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    tag: "difficult",
    label: "难点",
    activeColor: "#ea580c",
    icon: (active, color) => (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M9.5 2L6 9h3.5L6.5 14l7-8H9.5L12 2H9.5z"
          fill={active ? color : "none"}
          stroke={active ? color : "#b09a87"}
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    tag: "review",
    label: "待复习",
    activeColor: "#2563eb",
    icon: (active, color) => (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M13.5 8A5.5 5.5 0 113 5.5"
          stroke={active ? color : "#b09a87"}
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M1.5 3v3h3"
          stroke={active ? color : "#b09a87"}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    tag: "exam",
    label: "考试",
    activeColor: "#9333ea",
    icon: (active, color) => (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 12.5l1.5-1.5M8.5 3.5l4 4-6.5 6.5H2V10L8.5 3.5z"
          fill={active ? color : "none"}
          stroke={active ? color : "#b09a87"}
          strokeWidth="1.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export function SlideBookmarks({
  slideId,
  bookmarks,
  onBookmarksChange,
}: SlideBookmarksProps) {
  const [loading, setLoading] = useState<BookmarkTag | null>(null);

  async function handleToggle(tag: BookmarkTag) {
    if (loading) return;

    const existing = bookmarks.find(
      (b) => b.slide_id === slideId && b.tag === tag,
    );

    setLoading(tag);
    try {
      if (existing) {
        await deleteBookmark(existing.id);
      } else {
        await createBookmark(slideId, tag);
      }
      onBookmarksChange();
    } catch {
      // Silently fail; the parent will refresh state
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-[var(--bd-2)] bg-[var(--sf-1)] px-1.5 py-1 shadow-sm">
      {TAG_CONFIG.map((cfg) => {
        const active = bookmarks.some(
          (b) => b.slide_id === slideId && b.tag === cfg.tag,
        );
        const isLoading = loading === cfg.tag;

        return (
          <button
            key={cfg.tag}
            type="button"
            aria-label={`${active ? "取消" : "添加"}${cfg.label}书签`}
            aria-pressed={active}
            title={cfg.label}
            disabled={isLoading}
            onClick={() => handleToggle(cfg.tag)}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              active
                ? "bg-[var(--sf-3)]"
                : "hover:bg-[var(--sf-2)]"
            } ${isLoading ? "animate-pulse opacity-60" : ""}`}
          >
            {cfg.icon(active, cfg.activeColor)}
          </button>
        );
      })}
    </div>
  );
}
