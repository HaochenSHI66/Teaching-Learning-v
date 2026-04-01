// frontend/hooks/usePreload.ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { DocumentCacheManager } from "@/lib/DocumentCacheManager";
import { fetchSyncManifest, fetchDocumentCacheBatch } from "@/lib/api";

const BATCH_SIZE = 4;

export function usePreload(manager: DocumentCacheManager | null) {
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const runRef = useRef(0);

  useEffect(() => {
    if (!manager) return;
    const runId = ++runRef.current;

    void (async () => {
      setSyncing(true);
      try {
        // 1. Hydrate memory from IndexedDB
        await manager.hydrateAll();

        // 2. Fetch manifest
        const manifest = await fetchSyncManifest();

        if (runRef.current !== runId) return;

        // 3. Diff against local
        const diff = await manager.diffManifest(manifest);

        if (diff.updated.length === 0) {
          // Still save schema version even if nothing to update
          await manager.saveSchemaVersion(manifest.schema);
          setSyncing(false);
          return;
        }

        // 4. Batch-fetch changed docs
        setProgress({ done: 0, total: diff.updated.length });
        const batches: string[][] = [];
        for (let i = 0; i < diff.updated.length; i += BATCH_SIZE) {
          batches.push(diff.updated.slice(i, i + BATCH_SIZE));
        }

        let done = 0;
        let allBatchesSucceeded = true;
        for (const batch of batches) {
          if (runRef.current !== runId) return;
          try {
            const payload = await fetchDocumentCacheBatch(batch);
            for (const item of payload.documents) {
              await manager.set(item.document_id, {
                slides: item.slides,
                explanations: item.explanations,
                version: item.content_version ?? 0,
              });
            }
            done += batch.length;
            setProgress({ done, total: diff.updated.length });
          } catch (err) {
            console.error("[usePreload] batch failed:", err);
            allBatchesSucceeded = false;
            done += batch.length;
            setProgress({ done, total: diff.updated.length });
          }
        }

        // Only persist schema version AFTER all batches succeeded.
        // If any batch failed, next sync will re-detect schema change and retry.
        if (allBatchesSucceeded) {
          await manager.saveSchemaVersion(manifest.schema);
        }
      } catch (err) {
        console.error("[usePreload] sync failed:", err);
      } finally {
        if (runRef.current === runId) setSyncing(false);
      }
    })();
  }, [manager]);

  return { syncing, progress };
}
