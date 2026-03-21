"use client";

import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";

import { BookmarkFilter } from "@/components/bookmark-filter";
import { SlideBookmarks } from "@/components/slide-bookmarks";
import { getAssetUrl, type Bookmark, type BookmarkTag, type RoiBox, type Slide } from "@/lib/api";

type SlideViewerProps = {
  slides: Slide[];
  currentIndex: number;
  roi: RoiBox | null;
  onSelect: (index: number) => void;
  onRoiChange: (roi: RoiBox | null) => void;
  bookmarks: Bookmark[];
  bookmarkFilter: BookmarkTag | null;
  onBookmarkFilterChange: (tag: BookmarkTag | null) => void;
  onBookmarksChange: () => void;
  documentId: string;
};

type Point = { x: number; y: number };

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function SlideViewer({ slides, currentIndex, roi, onSelect, onRoiChange, bookmarks, bookmarkFilter, onBookmarkFilterChange, onBookmarksChange, documentId }: SlideViewerProps) {
  const currentSlide = slides[currentIndex];
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [draftRoi, setDraftRoi] = useState<RoiBox | null>(null);
  // Track which URL has finished loading. mainImageLoaded is derived inline so
  // it becomes false immediately when the URL changes (no effect delay → no flash).
  const [loadedUrl, setLoadedUrl] = useState<string | undefined>(undefined);
  const mainImageLoaded = loadedUrl === currentSlide?.image_url;
  const imgRef = useRef<HTMLImageElement>(null);

  // For cached images onLoad never fires — check img.complete after URL change.
  useEffect(() => {
    const url = currentSlide?.image_url;
    if (url && imgRef.current?.complete) {
      setLoadedUrl(url);
    }
  }, [currentSlide?.image_url]);

  const activeRoi = draftRoi ?? roi;

  const roiStyle = useMemo(() => {
    if (!activeRoi) return null;
    return {
      left: `${activeRoi.x * 100}%`,
      top: `${activeRoi.y * 100}%`,
      width: `${activeRoi.w * 100}%`,
      height: `${activeRoi.h * 100}%`,
    };
  }, [activeRoi]);

  // Keyboard navigation: left/right arrows
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (slides.length === 0) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        if (currentIndex < slides.length - 1) {
          onSelect(currentIndex + 1);
          onRoiChange(null);
        }
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        if (currentIndex > 0) {
          onSelect(currentIndex - 1);
          onRoiChange(null);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [slides.length, currentIndex, onSelect, onRoiChange]);

  const toRelative = useCallback((clientX: number, clientY: number): Point | null => {
    const element = canvasRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  }, []);

  const updateDraft = useCallback((start: Point, current: Point) => {
    setDraftRoi({
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      w: Math.abs(current.x - start.x),
      h: Math.abs(current.y - start.y),
    });
  }, []);

  const commitDrag = useCallback(
    (start: Point, end: Point) => {
      const nextRoi = {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        w: Math.abs(end.x - start.x),
        h: Math.abs(end.y - start.y),
      };
      onRoiChange(nextRoi.w < 0.01 || nextRoi.h < 0.01 ? null : nextRoi);
      setDraftRoi(null);
    },
    [onRoiChange],
  );

  if (!currentSlide) {
    return (
      <section className="flex h-full items-center justify-center rounded-[30px] border border-[#d9c7ab] bg-[#fbf6ed]/96 p-6 shadow-[0_24px_54px_rgba(122,98,66,0.12)]">
        <div className="max-w-sm rounded-[28px] border border-dashed border-[#dbc8ad] bg-gradient-to-b from-[#fffaf2] to-[#f7eedd] px-8 py-10 text-center shadow-[0_8px_32px_rgba(122,98,66,0.07)]">
          {/* Decorative illustration — Forest Canopy × Golden Hour */}
          <svg aria-hidden="true" className="mx-auto mb-5 h-20 w-20 opacity-80" viewBox="0 0 80 80" fill="none">
            <rect x="12" y="20" width="56" height="44" rx="6" fill="#f4e8d0" stroke="#d6b87a" strokeWidth="1.5"/>
            <rect x="18" y="28" width="22" height="28" rx="3" fill="#e8d5b4" stroke="#c9a86c" strokeWidth="1"/>
            <rect x="44" y="28" width="18" height="12" rx="2" fill="#ddebd5" stroke="#92a97e" strokeWidth="1"/>
            <rect x="44" y="44" width="18" height="12" rx="2" fill="#ddebd5" stroke="#92a97e" strokeWidth="1"/>
            <path d="M22 16 L40 8 L58 16" stroke="#b89a5e" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
            <circle cx="40" cy="8" r="3" fill="#d6a45b"/>
          </svg>
          <p className="text-[10px] uppercase tracking-[0.32em] text-[#9c876e]">Viewer</p>
          <p className="mt-2.5 text-base font-semibold text-[#473829]">上传文档后会在这里显示 PPT 页面。</p>
          <p className="mt-2 text-sm leading-6 text-[#83715f]">
            左侧会出现缩略页导航，你可以在画布里框选区域，再去问答里做局部解释。
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d6bf98] bg-[#f5e9d4] px-3 py-1 text-[11px] text-[#7a6347]">
              <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5A6.5 6.5 0 1 0 14.5 8 6.507 6.507 0 0 0 8 1.5ZM0 8a8 8 0 1 1 8 8A8.009 8.009 0 0 1 0 8Zm8.75-3.25a.75.75 0 0 0-1.5 0V8c0 .199.079.39.22.53l2 2a.75.75 0 1 0 1.06-1.06L8.75 7.69Z"/></svg>
              上传 PDF / 图片
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#c0d1b4] bg-[#eaf1e4] px-3 py-1 text-[11px] text-[#5f7a52]">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              选择页面解析
            </span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="grid h-full min-h-0 grid-cols-[112px_1fr] gap-4 rounded-[30px] border border-[#d9c7ab] bg-[#fbf6ed]/96 p-4 shadow-[0_24px_54px_rgba(122,98,66,0.12)]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-[#e1d1bc] bg-[#f5ebda] p-2">
        <BookmarkFilter
          activeFilter={bookmarkFilter}
          onFilterChange={onBookmarkFilterChange}
          bookmarkCounts={{
            important: bookmarks.filter((b) => b.tag === "important").length,
            difficult: bookmarks.filter((b) => b.tag === "difficult").length,
            review: bookmarks.filter((b) => b.tag === "review").length,
            exam: bookmarks.filter((b) => b.tag === "exam").length,
          }}
        />
        <ul className="min-h-0 flex-1 space-y-2 overflow-auto">
          {slides.map((slide, index) => {
            const slideBMs = bookmarks.filter((b) => b.slide_id === slide.id);
            if (bookmarkFilter && !slideBMs.some((b) => b.tag === bookmarkFilter)) return null;
            const dotColors: Record<BookmarkTag, string> = {
              important: "bg-red-400",
              difficult: "bg-orange-400",
              review: "bg-blue-400",
              exam: "bg-purple-400",
            };
            return (
              <li key={slide.id}>
                <button
                  className={`w-full overflow-hidden rounded-xl border text-left transition ${
                    index === currentIndex
                      ? "border-[#c2ae81] bg-[linear-gradient(135deg,#fffaf1_0%,#f1e5d1_100%)] ring-2 ring-[#d9bf91]/40"
                      : "border-[#e1d1bc] bg-[#fffaf2] hover:border-[#c9b08b] hover:bg-white"
                  }`}
                  onClick={() => {
                    onSelect(index);
                    onRoiChange(null);
                  }}
                  type="button"
                >
                  <img
                    alt={`Slide ${slide.page_num}`}
                    className="block h-auto w-full"
                    loading="lazy"
                    decoding="async"
                    src={getAssetUrl(slide.thumbnail_url)}
                  />
                  <span className="flex items-center gap-1 bg-[#f7efdf] px-2 py-1 text-xs text-[#7e6c5a]">
                    #{slide.page_num}
                    {slideBMs.map((bm) => (
                      <span key={bm.id} className={`inline-block h-1.5 w-1.5 rounded-full ${dotColors[bm.tag]}`} />
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="flex min-h-0 flex-col gap-3">
        <header className="shrink-0 flex items-center justify-between rounded-[24px] border border-[#e1d1bc] bg-[#fffaf2] px-4 py-3 text-sm text-[#7e6c5a]">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#a18a72]">Current Slide</p>
            <p className="mt-1 text-sm font-medium text-[#463829]">当前页：{currentSlide.page_num}</p>
          </div>
          <div className="flex items-center gap-2">
            {currentSlide && (
              <SlideBookmarks
                slideId={currentSlide.id}
                documentId={documentId}
                bookmarks={bookmarks}
                onBookmarksChange={onBookmarksChange}
              />
            )}
            {roi ? <span className="rounded-full border border-[#c8b185] bg-[#f2e8d3] px-3 py-1 text-xs text-[#6d7f5a]">ROI 已选择</span> : null}
            <button
              className="btn btn-outline !rounded-lg !px-3 !py-1.5 text-xs"
              onClick={() => onRoiChange(null)}
              type="button"
            >
              清除框选
            </button>
            <span>
              {currentIndex + 1}/{slides.length}
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-auto rounded-[24px] border border-[#e1d1bc] bg-[radial-gradient(circle_at_top,_rgba(214,164,91,0.14),_transparent_34%),linear-gradient(180deg,#fffaf1,#f4eada)] p-3">
          <div
            className="relative mx-auto inline-block touch-none select-none rounded-[22px] border border-[#d8c6aa] bg-[#fffdf7] p-2 shadow-[0_24px_70px_rgba(122,98,66,0.18)]"
            // Mouse events
            onMouseDown={(event) => {
              const point = toRelative(event.clientX, event.clientY);
              if (!point) return;
              setDragStart(point);
              setDraftRoi(null);
            }}
            onMouseLeave={() => {
              if (dragStart) { setDragStart(null); setDraftRoi(null); }
            }}
            onMouseMove={(event) => {
              if (!dragStart) return;
              const point = toRelative(event.clientX, event.clientY);
              if (point) updateDraft(dragStart, point);
            }}
            onMouseUp={(event) => {
              if (!dragStart) return;
              const point = toRelative(event.clientX, event.clientY);
              const start = dragStart;
              setDragStart(null);
              if (!point) { setDraftRoi(null); return; }
              commitDrag(start, point);
            }}
            // Touch events
            onTouchEnd={(event) => {
              if (!dragStart) return;
              const touch = event.changedTouches[0];
              const start = dragStart;
              setDragStart(null);
              if (!touch) { setDraftRoi(null); return; }
              const point = toRelative(touch.clientX, touch.clientY);
              if (!point) { setDraftRoi(null); return; }
              commitDrag(start, point);
            }}
            onTouchMove={(event) => {
              if (!dragStart) return;
              event.preventDefault();
              const touch = event.touches[0];
              if (!touch) return;
              const point = toRelative(touch.clientX, touch.clientY);
              if (point) updateDraft(dragStart, point);
            }}
            onTouchStart={(event) => {
              const touch = event.touches[0];
              if (!touch) return;
              const point = toRelative(touch.clientX, touch.clientY);
              if (!point) return;
              setDragStart(point);
              setDraftRoi(null);
            }}
            ref={canvasRef}
          >
            {!mainImageLoaded && (
              <div className="absolute inset-2 animate-pulse rounded-[18px] bg-[#f0e6d4]" aria-hidden="true" />
            )}
            <img
              ref={imgRef}
              alt={`Slide ${currentSlide.page_num}`}
              className={`mx-auto block h-auto max-w-full rounded-[18px] ${mainImageLoaded ? "" : "opacity-0"}`}
              draggable={false}
              fetchPriority="high"
              decoding="async"
              src={getAssetUrl(currentSlide.image_url)}
              onLoad={() => setLoadedUrl(currentSlide.image_url)}
            />
            {roiStyle ? (
              <div
                className="pointer-events-none absolute border-2 border-[var(--brand-amber)] bg-[var(--brand-amber)]/20"
                style={roiStyle}
              />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
