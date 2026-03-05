"use client";

import { useState } from "react";

import {
  completeReviewItem,
  fetchReviewQueue,
  fetchSessionAnalytics,
  type ReviewItem,
  type SessionAnalyticsPayload,
} from "@/lib/api";

type ReviewState = {
  reviewItems: ReviewItem[];
  analytics: SessionAnalyticsPayload | null;
  loading: boolean;
};

type ReviewActions = {
  refresh: (sessionId: string) => Promise<void>;
  complete: (reviewId: string, quality: number, sessionId: string) => Promise<void>;
};

export function useReview(onStatusChange: (text: string) => void): ReviewState & ReviewActions {
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [analytics, setAnalytics] = useState<SessionAnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh(sessionId: string) {
    try {
      const [queue, stats] = await Promise.all([
        fetchReviewQueue(sessionId),
        fetchSessionAnalytics(sessionId),
      ]);
      setReviewItems(queue.items);
      setAnalytics(stats);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      onStatusChange(`刷新学习分析失败：${msg}`);
    }
  }

  async function complete(reviewId: string, quality: number, sessionId: string) {
    setLoading(true);
    onStatusChange("正在更新复习状态...");
    try {
      await completeReviewItem(reviewId, quality);
      await refresh(sessionId);
      onStatusChange(quality >= 3 ? "复习项已完成" : "已加入重复队列");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      onStatusChange(`更新复习状态失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return { reviewItems, analytics, loading, refresh, complete };
}
