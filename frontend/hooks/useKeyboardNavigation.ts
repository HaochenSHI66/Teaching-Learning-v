"use client";

import { useEffect } from "react";
import type { Slide } from "@/lib/api";

/**
 * Handles left/right arrow key navigation between slides.
 * Skips events when the user is focused on an input or textarea.
 */
export function useKeyboardNavigation(
  slides: Slide[],
  currentSlideIndex: number,
  setCurrentSlideIndex: (index: number) => void,
) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when user is typing in an input/textarea/contentEditable
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentSlideIndex(Math.max(0, currentSlideIndex - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setCurrentSlideIndex(Math.min(slides.length - 1, currentSlideIndex + 1));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [slides, currentSlideIndex, setCurrentSlideIndex]);
}
