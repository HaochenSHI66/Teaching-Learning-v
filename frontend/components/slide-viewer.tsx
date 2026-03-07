"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getAssetUrl, type RoiBox, type Slide } from "@/lib/api";

type SlideViewerProps = {
  slides: Slide[];
  currentIndex: number;
  roi: RoiBox | null;
  onSelect: (index: number) => void;
  onRoiChange: (roi: RoiBox | null) => void;
};

type Point = { x: number; y: number };

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function SlideViewer({ slides, currentIndex, roi, onSelect, onRoiChange }: SlideViewerProps) {
  const currentSlide = slides[currentIndex];
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [draftRoi, setDraftRoi] = useState<RoiBox | null>(null);

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
        <div className="max-w-md rounded-[24px] border border-dashed border-[#dbc8ad] bg-[#fffaf2] px-6 py-8 text-center">
          <p className="text-xs uppercase tracking-[0.26em] text-[#9c876e]">Viewer</p>
          <p className="mt-3 text-lg font-medium text-[#473829]">上传文档后会在这里显示 PPT 页面。</p>
          <p className="mt-2 text-sm leading-6 text-[#83715f]">
            左侧会出现缩略页导航，你可以在画布里框选区域，再去问答里做局部解释。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="grid h-full min-h-0 grid-cols-[112px_1fr] gap-4 rounded-[30px] border border-[#d9c7ab] bg-[#fbf6ed]/96 p-4 shadow-[0_24px_54px_rgba(122,98,66,0.12)]">
      <aside className="min-h-0 overflow-auto rounded-[24px] border border-[#e1d1bc] bg-[#f5ebda] p-2">
        <ul className="space-y-2">
          {slides.map((slide, index) => (
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
                  src={getAssetUrl(slide.thumbnail_url)}
                />
                <span className="block bg-[#f7efdf] px-2 py-1 text-xs text-[#7e6c5a]">#{slide.page_num}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex min-h-0 flex-col gap-3">
        <header className="shrink-0 flex items-center justify-between rounded-[24px] border border-[#e1d1bc] bg-[#fffaf2] px-4 py-3 text-sm text-[#7e6c5a]">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#a18a72]">Current Slide</p>
            <p className="mt-1 text-sm font-medium text-[#463829]">当前页：{currentSlide.page_num}</p>
          </div>
          <div className="flex items-center gap-2">
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
            <img
              alt={`Slide ${currentSlide.page_num}`}
              className="mx-auto block h-auto max-w-full rounded-[18px]"
              draggable={false}
              src={getAssetUrl(currentSlide.image_url)}
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
