// frontend/hooks/useDocumentCache.ts
"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { DocumentCacheManager, DocumentData } from "@/lib/DocumentCacheManager";
import type { SlideExplanation } from "@/lib/api";

/**
 * React bridge to DocumentCacheManager via useSyncExternalStore.
 * Provides synchronous reads from the manager's memory cache.
 * Triggers hydrate from IndexedDB when docId changes.
 */
export function useDocumentCache(
  manager: DocumentCacheManager | null,
  docId: string | null,
) {
  // Subscribe to manager changes
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!manager) return () => {};
      return manager.onChange(() => onStoreChange());
    },
    [manager],
  );

  // Snapshot: read current doc data from memory (synchronous)
  const getSnapshot = useCallback(() => {
    if (!manager || !docId) return undefined;
    return manager.get(docId);
  }, [manager, docId]);

  const data = useSyncExternalStore(subscribe, getSnapshot, () => undefined);

  // Hydrate from IndexedDB when docId changes
  useEffect(() => {
    if (!manager || !docId) return;
    if (!manager.has(docId)) {
      void manager.hydrate(docId);
    }
  }, [manager, docId]);

  return useMemo(
    () => ({
      slides: data?.slides ?? [],
      explanations: data?.explanations ?? [],
      version: data?.version ?? 0,
      isLoaded: data !== undefined,
      // Convenience: explanations keyed by slide_id (for page.tsx compatibility)
      explanationsBySlideId: Object.fromEntries(
        (data?.explanations ?? []).map((e) => [e.slide_id, e]),
      ) as Record<string, SlideExplanation>,
    }),
    [data],
  );
}
