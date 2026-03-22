"use client";

import { useCallback, useRef, useState } from "react";

import {
  generateSlideExplanation,
  type Slide,
  type SlideExplanation,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errorMessage";

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
  const batchAbortRef = useRef(false);

  const handleGenerateCurrentSlideExplanation = useCallback(async () => {
    if (!documentId || !currentSlide) return;
    setSlideGenerationLoading(true);
    setGlobalStatus("重新生成解析中…");
    try {
      const result = await generateSlideExplanation(documentId, currentSlide.id);
      setCachedExplanation(currentSlide.id, result);
      setExplanation(result.markdown);
      setExplanationMeta(result.meta ?? null);
      setGlobalStatus("解析已更新");
    } catch (error) {
      setGlobalStatus(`解析生成失败：${getErrorMessage(error)}`);
    } finally {
      setSlideGenerationLoading(false);
    }
  }, [documentId, currentSlide, setCachedExplanation, setExplanation, setExplanationMeta, setGlobalStatus]);

  const handleBatchGenerate = useCallback(async () => {
    if (!documentId || slides.length === 0) return;
    batchAbortRef.current = false;
    setSlideGenerationLoading(true);
    setGlobalStatus("批量生成解析中…");

    let completed = 0;
    const total = slides.length;

    for (const slide of slides) {
      if (batchAbortRef.current) break;
      try {
        const result = await generateSlideExplanation(documentId, slide.id);
        setCachedExplanation(slide.id, result);
        completed++;
        setGlobalStatus(`批量生成中… ${completed}/${total} 页`);
      } catch {
        completed++;
        // Continue on individual slide failure
      }
    }

    setSlideGenerationLoading(false);
    setGlobalStatus(
      batchAbortRef.current
        ? `批量生成已中止（${completed}/${total} 页）`
        : `批量生成完成（${completed}/${total} 页）`,
    );
  }, [documentId, slides, setCachedExplanation, setGlobalStatus]);

  const abortBatchGeneration = useCallback(() => {
    batchAbortRef.current = true;
  }, []);

  return {
    slideGenerationLoading,
    setSlideGenerationLoading,
    handleGenerateCurrentSlideExplanation,
    handleBatchGenerate,
    abortBatchGeneration,
  };
}
