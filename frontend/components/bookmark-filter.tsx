"use client";

import type { BookmarkTag } from "@/lib/api";

type BookmarkFilterProps = {
  activeFilter: BookmarkTag | null;
  onFilterChange: (tag: BookmarkTag | null) => void;
  bookmarkCounts: Record<BookmarkTag, number>;
};

const FILTER_OPTIONS: {
  tag: BookmarkTag | null;
  label: string;
  activeClass: string;
}[] = [
  {
    tag: null,
    label: "全部",
    activeClass: "border-[#c9a97a] bg-[#5d4a39] text-[#fffaf2]",
  },
  {
    tag: "important",
    label: "重点",
    activeClass: "border-[#fca5a5] bg-[#dc2626] text-white",
  },
  {
    tag: "difficult",
    label: "难点",
    activeClass: "border-[#fdba74] bg-[#ea580c] text-white",
  },
  {
    tag: "review",
    label: "待复习",
    activeClass: "border-[#93c5fd] bg-[#2563eb] text-white",
  },
  {
    tag: "exam",
    label: "考试",
    activeClass: "border-[#c4b5fd] bg-[#9333ea] text-white",
  },
];

export function BookmarkFilter({
  activeFilter,
  onFilterChange,
  bookmarkCounts,
}: BookmarkFilterProps) {
  const totalCount =
    bookmarkCounts.important +
    bookmarkCounts.difficult +
    bookmarkCounts.review +
    bookmarkCounts.exam;

  // Hide filter bar entirely if there are no bookmarks at all
  if (totalCount === 0 && activeFilter === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 px-1 py-1.5">
      {FILTER_OPTIONS.map((opt) => {
        const isActive = activeFilter === opt.tag;
        const count =
          opt.tag === null ? totalCount : bookmarkCounts[opt.tag];
        const showCount = opt.tag !== null;

        return (
          <button
            key={opt.tag ?? "all"}
            type="button"
            onClick={() =>
              onFilterChange(isActive && opt.tag !== null ? null : opt.tag)
            }
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium transition-colors ${
              isActive
                ? opt.activeClass
                : "border-[#e0d0bb] bg-[#fffdf8] text-[#826f5c] hover:bg-[#f8f2e8]"
            }`}
          >
            {opt.label}
            {showCount && count > 0 && (
              <span
                className={`text-[11px] ${
                  isActive ? "opacity-80" : "text-[#b09a87]"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
