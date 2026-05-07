"use client";

import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";

import { BookmarkFilter } from "@/components/bookmark-filter";
import { SlideBookmarks } from "@/components/slide-bookmarks";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { getAssetUrl, type Bookmark, type BookmarkTag, type FlashcardStats, type RoiBox, type Slide } from "@/lib/api";

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
  flashcardStats: FlashcardStats | null;
  itemCount?: number;
  onHoverItem?: (index: number | null) => void;
  onLockItem?: (index: number | null) => void;
};

type Point = { x: number; y: number };

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function SlideViewer({ slides, currentIndex, roi, onSelect, onRoiChange, bookmarks, bookmarkFilter, onBookmarkFilterChange, onBookmarksChange, documentId, flashcardStats, itemCount = 0, onHoverItem, onLockItem }: SlideViewerProps) {
  const currentSlide = slides[currentIndex];
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [draftRoi, setDraftRoi] = useState<RoiBox | null>(null);
  const dragMovedRef = useRef(false);
  const isMobile = useIsMobile();

  const swipeHandlers = useSwipeNavigation({
    onSwipeLeft: () => {
      if (currentIndex < slides.length - 1) {
        onSelect(currentIndex + 1);
        onRoiChange(null);
      }
    },
    onSwipeRight: () => {
      if (currentIndex > 0) {
        onSelect(currentIndex - 1);
        onRoiChange(null);
      }
    },
  });
  // Track which URL has finished loading. mainImageLoaded is derived inline so
  // it becomes false immediately when the URL changes (no effect delay → no flash).
  const [loadedUrl, setLoadedUrl] = useState<string | undefined>(undefined);
  const mainImageLoaded = loadedUrl === currentSlide?.image_url;
  const imgRef = useRef<HTMLImageElement>(null);
  const thumbRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

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

  useEffect(() => {
    thumbRefs.current.get(currentIndex)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [currentIndex]);

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
      <section className="flex h-full items-center justify-center rounded-[30px] border border-[var(--bd-1)] bg-[var(--sf-2)]/96 p-6 shadow-[var(--sh-card)]">
        <div className="max-w-sm rounded-[28px] border border-dashed border-[var(--bd-1)] bg-gradient-to-b from-[var(--sf-1)] to-[#f7eedd] px-8 py-10 text-center shadow-[var(--sh-sm)]">
          {/* Decorative illustration — Forest Canopy × Golden Hour */}
          <svg aria-hidden="true" className="mx-auto mb-5 h-20 w-20 opacity-80" viewBox="0 0 80 80" fill="none">
            <rect x="12" y="20" width="56" height="44" rx="6" fill="#f4e8d0" stroke="#d6b87a" strokeWidth="1.5"/>
            <rect x="18" y="28" width="22" height="28" rx="3" fill="#e8d5b4" stroke="#c9a86c" strokeWidth="1"/>
            <rect x="44" y="28" width="18" height="12" rx="2" fill="#ddebd5" stroke="#92a97e" strokeWidth="1"/>
            <rect x="44" y="44" width="18" height="12" rx="2" fill="#ddebd5" stroke="#92a97e" strokeWidth="1"/>
            <path d="M22 16 L40 8 L58 16" stroke="#b89a5e" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
            <circle cx="40" cy="8" r="3" fill="#d6a45b"/>
          </svg>
          <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--tx-5)]">Viewer</p>
          <p className="mt-2.5 text-base font-semibold text-[var(--tx-2)]">上传文档后会在这里显示 PPT 页面。</p>
          <p className="mt-2 text-sm leading-6 text-[var(--tx-5)]">
            左侧会出现缩略页导航，你可以在画布里框选区域，再去问答里做局部解释。
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d6bf98] bg-[#f5e9d4] px-3 py-1 text-[11px] text-[var(--tx-4)]">
              <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5A6.5 6.5 0 1 0 14.5 8 6.507 6.507 0 0 0 8 1.5ZM0 8a8 8 0 1 1 8 8A8.009 8.009 0 0 1 0 8Zm8.75-3.25a.75.75 0 0 0-1.5 0V8c0 .199.079.39.22.53l2 2a.75.75 0 1 0 1.06-1.06L8.75 7.69Z"/></svg>
              上传 PDF / 图片
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ac-green-border)] bg-[var(--ac-green-bg)] px-3 py-1 text-[11px] text-[var(--ac-green-text)]">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              选择页面解析
            </span>
          </div>
        </div>
      </section>
    );
  }

  // ── Mobile layout: no thumbnails, swipe to navigate ──
  if (isMobile) {
    return (
      <section
        className="mobile-slide-viewer flex h-full min-h-0 flex-col rounded-[16px] border border-[var(--bd-1)] bg-[var(--sf-2)]/96 shadow-[var(--sh-card)] overflow-hidden"
        {...swipeHandlers}
      >
        {/* Compact page indicator */}
        <header className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--bd-2)] bg-[var(--sf-1)]">
          <span className="text-[12px] font-medium text-[var(--tx-2)]">P{currentSlide.page_num}</span>
          <div className="flex items-center gap-2">
            <SlideBookmarks
              slideId={currentSlide.id}
              documentId={documentId}
              bookmarks={bookmarks}
              onBookmarksChange={onBookmarksChange}
            />
            <span className="text-[12px] tabular-nums text-[var(--tx-5)]">
              {currentIndex + 1}/{slides.length}
            </span>
          </div>
        </header>

        {/* Slide image — fills remaining space */}
        <div className="flex-1 min-h-0 overflow-auto bg-[var(--gd-slide)] p-1.5 flex items-center justify-center">
          <div className="relative inline-block rounded-[12px] border border-[var(--bd-1)] bg-[var(--sf-1)] p-1 shadow-sm">
            {!mainImageLoaded && (
              <div className="absolute inset-1 animate-pulse rounded-[10px] bg-[var(--sf-4)]" aria-hidden="true" />
            )}
            <img
              ref={imgRef}
              alt={`Slide ${currentSlide.page_num}`}
              className={`block h-auto max-w-full max-h-full rounded-[10px] ${mainImageLoaded ? "" : "opacity-0"}`}
              draggable={false}
              fetchPriority="high"
              decoding="async"
              src={getAssetUrl(currentSlide.image_url)}
              onLoad={() => setLoadedUrl(currentSlide.image_url)}
            />
          </div>
        </div>

        {/* Navigation buttons */}
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-t border-[var(--bd-2)] bg-[var(--sf-1)]">
          <button
            className="flex items-center gap-1.5 rounded-xl border border-[var(--bd-1)] bg-[var(--sf-2)] px-4 py-2 text-[13px] font-medium text-[var(--tx-3)] active:bg-[var(--sf-4)] disabled:opacity-30 disabled:pointer-events-none"
            disabled={currentIndex <= 0}
            onClick={() => { onSelect(currentIndex - 1); onRoiChange(null); }}
            type="button"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            上一页
          </button>
          <span className="text-[12px] tabular-nums text-[var(--tx-5)]">{currentIndex + 1} / {slides.length}</span>
          <button
            className="flex items-center gap-1.5 rounded-xl border border-[var(--bd-1)] bg-[var(--sf-2)] px-4 py-2 text-[13px] font-medium text-[var(--tx-3)] active:bg-[var(--sf-4)] disabled:opacity-30 disabled:pointer-events-none"
            disabled={currentIndex >= slides.length - 1}
            onClick={() => { onSelect(currentIndex + 1); onRoiChange(null); }}
            type="button"
          >
            下一页
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </section>
    );
  }

  // ── Desktop layout: main slide on top, thumbnails strip at bottom ──
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden rounded-[30px] border border-[var(--bd-1)] bg-[var(--sf-2)]/96 p-4 shadow-[var(--sh-card)]">
      {/* Header bar */}
      <header className="shrink-0 flex items-center justify-between rounded-[24px] border border-[var(--bd-2)] bg-[var(--sf-1)] px-4 py-2.5 text-sm text-[var(--tx-4)]">
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-[var(--tx-2)]">第 {currentSlide.page_num} 页</p>
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
          {roi ? <span className="rounded-full border border-[var(--bd-4)] bg-[#f2e8d3] px-3 py-1 text-xs text-[#6d7f5a]">ROI</span> : null}
          <button
            className="btn btn-outline !rounded-lg !px-3 !py-1.5 text-xs"
            onClick={() => onRoiChange(null)}
            type="button"
          >
            清除框选
          </button>
          <span className="tabular-nums text-[12px]">
            {currentIndex + 1}/{slides.length}
          </span>
        </div>
      </header>

        <div className="flex-1 min-h-0 overflow-hidden rounded-[24px] border border-[var(--bd-2)] bg-[var(--gd-slide)] p-3 flex items-center justify-center">
          <div
            className="relative touch-none select-none rounded-[22px] border border-[var(--bd-1)] bg-[var(--sf-1)] p-2 shadow-[var(--sh-panel)] max-w-full max-h-full"
            // Mouse events
            onMouseDown={(event) => {
              const point = toRelative(event.clientX, event.clientY);
              if (!point) return;
              setDragStart(point);
              setDraftRoi(null);
            }}
            onMouseLeave={() => {
              if (dragStart) { setDragStart(null); setDraftRoi(null); }
              onHoverItem?.(null);
            }}
            onMouseMove={(event) => {
              if (itemCount && onHoverItem) {
                const rect = event.currentTarget.getBoundingClientRect();
                const relY = event.clientY - rect.top;
                const band = Math.min(Math.floor((relY / rect.height) * itemCount), itemCount - 1);
                onHoverItem(band);
              }
              if (!dragStart) return;
              dragMovedRef.current = true;
              const point = toRelative(event.clientX, event.clientY);
              if (point) updateDraft(dragStart, point);
            }}
            onMouseUp={(event) => {
              if (!dragStart) return;
              const point = toRelative(event.clientX, event.clientY);
              const start = dragStart;
              setDragStart(null);
              if (!point) { setDraftRoi(null); dragMovedRef.current = false; return; }
              commitDrag(start, point);
              // dragMovedRef stays true so the subsequent onClick can detect and swallow the drag-end click
            }}
            onClick={(e) => {
              if (dragMovedRef.current) { dragMovedRef.current = false; return; }
              if (!itemCount || !onLockItem) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const relY = e.clientY - rect.top;
              const band = Math.min(Math.floor((relY / rect.height) * itemCount), itemCount - 1);
              onLockItem(band);
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
              <div className="absolute inset-2 animate-pulse rounded-[18px] bg-[var(--sf-4)]" aria-hidden="true" />
            )}
            <img
              ref={imgRef}
              alt={`Slide ${currentSlide.page_num}`}
              className={`mx-auto block max-w-full max-h-full rounded-[18px] object-contain ${mainImageLoaded ? "" : "opacity-0"}`}
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

      {/* Thumbnail strip at bottom — horizontal scroll */}
      <div className="shrink-0 max-h-[72px] rounded-[14px] border border-[var(--bd-2)] bg-[var(--sf-3)] p-1">
        <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
          {slides.map((slide, index) => {
            const slideBMs = bookmarks.filter((b) => b.slide_id === slide.id);
            if (bookmarkFilter && !slideBMs.some((b) => b.tag === bookmarkFilter)) return null;
            const dotColors: Record<BookmarkTag, string> = {
              important: "bg-red-400",
              difficult: "bg-orange-400",
              review: "bg-blue-400",
              exam: "bg-purple-400",
            };
            const slideStat = flashcardStats?.slides.find((s) => s.slide_id === slide.id);
            return (
              <button
                key={slide.id}
                ref={(el) => {
                  if (el) thumbRefs.current.set(index, el);
                  else thumbRefs.current.delete(index);
                }}
                className={`shrink-0 overflow-hidden rounded-lg border transition ${
                  index === currentIndex
                    ? "border-[var(--bd-4)] ring-2 ring-[var(--brand-amber)]/30"
                    : "border-[var(--bd-2)] hover:border-[var(--bd-4)]"
                }`}
                onClick={() => {
                  onSelect(index);
                  onRoiChange(null);
                }}
                type="button"
                style={{ width: 64 }}
              >
                <img
                  alt={`Slide ${slide.page_num}`}
                  className="block h-auto w-full"
                  loading="lazy"
                  decoding="async"
                  src={getAssetUrl(slide.thumbnail_url)}
                />
                {slideStat && slideStat.total > 0 && (
                  <div className="flex h-0.5 w-full">
                    {slideStat.mastered > 0 && (
                      <div className="h-full bg-emerald-400" style={{ width: `${(slideStat.mastered / slideStat.total) * 100}%` }} />
                    )}
                    {slideStat.total - slideStat.mastered - slideStat.due > 0 && (
                      <div className="h-full bg-amber-300" style={{ width: `${((slideStat.total - slideStat.mastered - slideStat.due) / slideStat.total) * 100}%` }} />
                    )}
                    {slideStat.due > 0 && (
                      <div className="h-full bg-gray-300" style={{ width: `${(slideStat.due / slideStat.total) * 100}%` }} />
                    )}
                  </div>
                )}
                <div className="flex items-center justify-center gap-0.5 bg-[var(--sf-3)] py-0.5 text-[10px] text-[var(--tx-5)]">
                  {slide.page_num}
                  {slideBMs.map((bm) => (
                    <span key={bm.id} className={`inline-block h-1 w-1 rounded-full ${dotColors[bm.tag]}`} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
