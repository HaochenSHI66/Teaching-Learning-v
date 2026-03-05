"use client";

import { useMemo, useRef, useState } from "react";

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
    if (!activeRoi) {
      return null;
    }
    return {
      left: `${activeRoi.x * 100}%`,
      top: `${activeRoi.y * 100}%`,
      width: `${activeRoi.w * 100}%`,
      height: `${activeRoi.h * 100}%`,
    };
  }, [activeRoi]);

  if (!currentSlide) {
    return (
      <section className="h-full rounded-2xl bg-white/80 p-6 shadow-panel">
        <p className="text-sm text-slate-600">上传文档后会在这里显示 PPT 页面。</p>
      </section>
    );
  }

  const toRelative = (clientX: number, clientY: number): Point | null => {
    const element = canvasRef.current;
    if (!element) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  };

  const updateDraft = (start: Point, current: Point) => {
    const left = Math.min(start.x, current.x);
    const top = Math.min(start.y, current.y);
    const right = Math.max(start.x, current.x);
    const bottom = Math.max(start.y, current.y);

    setDraftRoi({
      x: left,
      y: top,
      w: right - left,
      h: bottom - top,
    });
  };

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
            className="relative mx-auto inline-block"
            onMouseDown={(event) => {
              const point = toRelative(event.clientX, event.clientY);
              if (!point) {
                return;
              }
              setDragStart(point);
              setDraftRoi(null);
            }}
            onMouseMove={(event) => {
              if (!dragStart) {
                return;
              }
              const point = toRelative(event.clientX, event.clientY);
              if (!point) {
                return;
              }
              updateDraft(dragStart, point);
            }}
            onMouseUp={(event) => {
              if (!dragStart) {
                return;
              }
              const point = toRelative(event.clientX, event.clientY);
              setDragStart(null);
              if (!point) {
                setDraftRoi(null);
                return;
              }

              updateDraft(dragStart, point);
              const left = Math.min(dragStart.x, point.x);
              const top = Math.min(dragStart.y, point.y);
              const right = Math.max(dragStart.x, point.x);
              const bottom = Math.max(dragStart.y, point.y);
              const nextRoi = { x: left, y: top, w: right - left, h: bottom - top };

              if (nextRoi.w < 0.01 || nextRoi.h < 0.01) {
                onRoiChange(null);
              } else {
                onRoiChange(nextRoi);
              }
              setDraftRoi(null);
            }}
            onMouseLeave={() => {
              if (dragStart) {
                setDragStart(null);
                setDraftRoi(null);
              }
            }}
            ref={canvasRef}
          >
            <img
              alt={`Slide ${currentSlide.page_num}`}
              className="mx-auto block h-auto max-w-full rounded-lg"
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
