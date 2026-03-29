"use client";

import { useCallback, useRef } from "react";

type SwipeOptions = {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  threshold?: number; // min px to count as swipe, default 50
};

/**
 * Returns touch handlers for horizontal swipe detection.
 * Attach the returned props to a container element.
 */
export function useSwipeNavigation({ onSwipeLeft, onSwipeRight, threshold = 50 }: SwipeOptions) {
  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    startX.current = touch.clientX;
    startY.current = touch.clientY;
    tracking.current = true;
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!tracking.current) return;
      tracking.current = false;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX.current;
      const dy = touch.clientY - startY.current;
      // Only trigger if horizontal movement dominates
      if (Math.abs(dx) < threshold || Math.abs(dy) > Math.abs(dx)) return;
      if (dx < 0) {
        onSwipeLeft(); // swipe left → next slide
      } else {
        onSwipeRight(); // swipe right → prev slide
      }
    },
    [onSwipeLeft, onSwipeRight, threshold],
  );

  return { onTouchStart, onTouchEnd };
}
