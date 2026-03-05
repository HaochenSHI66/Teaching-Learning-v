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
      <section className="h-full rounded-2xl bg-white/80 p-6 shadow-panel">
        <p className="text-sm text-slate-600">上传文档后会在这里显示 PPT 页面。</p>
      </section>
    );
  }

  return (
    <section className="grid h-full grid-cols-[112px_1fr] gap-4 rounded-2xl bg-white/80 p-4 shadow-panel">
      <aside className="overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
        <ul className="space-y-2">
          {slides.map((slide, index) => (
            <li key={slide.id}>
              <button
                className={`w-full overflow-hidden rounded-lg border text-left transition ${
                  index === currentIndex
                    ? "border-accent ring-2 ring-accent/30"
                    : "border-slate-200 hover:border-slate-300"
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
                <span className="block bg-white px-2 py-1 text-xs text-slate-500">#{slide.page_num}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex flex-col gap-3">
        <header className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          <span>当前页：{currentSlide.page_num}</span>
          <div className="flex items-center gap-2">
            {roi ? <span className="rounded-full bg-accentSoft px-2 py-1 text-xs text-slate-700">ROI 已选择</span> : null}
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
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

        <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-2">
          <div
            className="relative mx-auto inline-block touch-none select-none"
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
              updateDraft(start, point);
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
              updateDraft(start, point);
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
              className="mx-auto block h-auto max-w-full rounded-lg"
              draggable={false}
              src={getAssetUrl(currentSlide.image_url)}
            />
            {roiStyle ? (
              <div
                className="pointer-events-none absolute border-2 border-amber-500 bg-amber-200/20"
                style={roiStyle}
              />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
