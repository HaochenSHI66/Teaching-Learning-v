"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  generateSlideExplanation,
  type Slide,
  type SlideExplanation,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errorMessage";

export type GenerationProgress = {
  stage: "idle" | "vision" | "text" | "done";
  elapsed: number;
  message: string;
};

export type BatchProgress = {
  total: number;
  completed: number;
  failed: number;
  currentPages: number[];  // pages currently being generated
  isRunning: boolean;
};

type SlideGenerationOptions = {
  documentId: string | null;
  slides: Slide[];
  setCachedExplanation: (slideId: string, explanation: SlideExplanation) => void;
  setExplanation: (value: string) => void;
  setExplanationMeta: (meta: SlideExplanation["meta"] | null) => void;
  setGlobalStatus: (status: string) => void;
  currentSlide: Slide | undefined;
};

export function useSlideGeneration({
  documentId,
  slides,
  setCachedExplanation,
  setExplanation,
  setExplanationMeta,
  setGlobalStatus,
  currentSlide,
}: SlideGenerationOptions) {
  const [slideGenerationLoading, setSlideGenerationLoading] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const batchAbortRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const clearProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearBatchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Vision stage typically takes 5-10s; switch to text stage after this threshold
  const VISION_STAGE_DURATION = 8;

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (clearProgressTimeoutRef.current) clearTimeout(clearProgressTimeoutRef.current);
      if (clearBatchTimeoutRef.current) clearTimeout(clearBatchTimeoutRef.current);
    };
  }, []);

  const startProgressTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    setGenerationProgress({ stage: "vision", elapsed: 0, message: "正在读取页面内容..." });

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setGenerationProgress((prev) => {
        if (!prev || prev.stage === "done") return prev;
        if (elapsed >= VISION_STAGE_DURATION && prev.stage === "vision") {
          return { stage: "text", elapsed, message: "正在生成讲解..." };
        }
        return { ...prev, elapsed };
      });
    }, 1000);
  }, [VISION_STAGE_DURATION]);

  const stopProgressTimer = useCallback((success: boolean) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (success) {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setGenerationProgress({ stage: "done", elapsed, message: "完成" });
      // Clear progress after a brief display
      clearProgressTimeoutRef.current = setTimeout(() => {
        setGenerationProgress(null);
        clearProgressTimeoutRef.current = null;
      }, 2000);
    } else {
      setGenerationProgress(null);
    }
  }, []);

  const handleGenerateCurrentSlideExplanation = useCallback(async () => {
    if (!documentId || !currentSlide) return;
    setSlideGenerationLoading(true);
    setGlobalStatus("重新生成解析中…");
    startProgressTimer();
    try {
      const result = await generateSlideExplanation(documentId, currentSlide.id);
      setCachedExplanation(currentSlide.id, result);
      setExplanation(result.markdown);
      setExplanationMeta(result.meta ?? null);
      setGlobalStatus("解析已更新");
      stopProgressTimer(true);
    } catch (error) {
      setGlobalStatus(`解析生成失败：${getErrorMessage(error)}`);
      stopProgressTimer(false);
    } finally {
      setSlideGenerationLoading(false);
    }
  }, [documentId, currentSlide, setCachedExplanation, setExplanation, setExplanationMeta, setGlobalStatus, startProgressTimer, stopProgressTimer]);

  const batchAbortControllerRef = useRef<AbortController | null>(null);

  const handleBatchGenerate = useCallback(async () => {
    if (!documentId || slides.length === 0) return;
    batchAbortRef.current = false;
    const abortController = new AbortController();
    batchAbortControllerRef.current = abortController;

    setSlideGenerationLoading(true);
    setGlobalStatus("批量生成解析中…");

    const WINDOW = 3;
    let completed = 0;
    let failed = 0;
    const total = slides.length;

    setBatchProgress({ total, completed: 0, failed: 0, currentPages: [], isRunning: true });

    // Process in sequential windows to preserve cross-page context
    for (let i = 0; i < total; i += WINDOW) {
      if (batchAbortRef.current) break;
      const windowSlides = slides.slice(i, i + WINDOW);
      const currentPages = windowSlides.map((s) => s.page_num);
      setBatchProgress((prev) => prev ? { ...prev, currentPages } : prev);

      const results = await Promise.allSettled(
        windowSlides.map((slide) =>
          generateSlideExplanation(documentId!, slide.id, abortController.signal),
        ),
      );

      if (batchAbortRef.current) break;

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled") {
          setCachedExplanation(windowSlides[j].id, r.value);
        } else {
          failed++;
        }
        completed++;
      }
      setBatchProgress({ total, completed, failed, currentPages: [], isRunning: true });
      setGlobalStatus(`批量生成中… ${completed}/${total} 页`);
    }

    batchAbortControllerRef.current = null;
    setSlideGenerationLoading(false);
    const aborted = batchAbortRef.current;
    setGlobalStatus(
      aborted
        ? `批量生成已中止（${completed}/${total} 页）`
        : `批量生成完成（${completed}/${total} 页${failed > 0 ? `，${failed} 页失败` : ""}）`,
    );

    // Mark as finished but keep visible briefly for success message
    setBatchProgress((prev) => prev ? { ...prev, isRunning: false, currentPages: [] } : prev);
    clearBatchTimeoutRef.current = setTimeout(() => {
      setBatchProgress(null);
      clearBatchTimeoutRef.current = null;
    }, 3000);
  }, [documentId, slides, setCachedExplanation, setGlobalStatus]);

  const abortBatchGeneration = useCallback(() => {
    batchAbortRef.current = true;
    // Immediately cancel in-flight HTTP requests
    batchAbortControllerRef.current?.abort();
  }, []);

  return {
    slideGenerationLoading,
    setSlideGenerationLoading,
    generationProgress,
    batchProgress,
    handleGenerateCurrentSlideExplanation,
    handleBatchGenerate,
    abortBatchGeneration,
  };
}
