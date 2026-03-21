"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  completeReviewItem,
  fetchFlashcards,
  fetchReviewQueue,
  type FlashcardItem,
  type ReviewItem,
} from "@/lib/api";

// ── Types ────────────────────────────────────────────────────

type FlashcardReviewProps = {
  documentId: string;
  sessionId: string;
  open: boolean;
  onClose: () => void;
};

type ReviewCard = {
  reviewItem: ReviewItem;
  front: string;
  back: string;
};

type ReviewResult = {
  reviewId: string;
  quality: number;
};

type Phase = "loading" | "reviewing" | "summary" | "empty" | "error";

// ── Quality rating config ────────────────────────────────────

const QUALITY_OPTIONS = [
  { quality: 0, label: "忘了", cls: "btn-quality-danger" },
  { quality: 2, label: "模糊", cls: "btn-quality-warn" },
  { quality: 3, label: "记住", cls: "btn-quality-ok" },
  { quality: 5, label: "简单", cls: "btn-quality-done" },
] as const;

// ── Component ────────────────────────────────────────────────

export function FlashcardReview({
  documentId,
  sessionId,
  open,
  onClose,
}: FlashcardReviewProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ReviewResult[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const backdropRef = useRef<HTMLDivElement>(null);

  // ── Load data when modal opens ───────────────────────────

  const loadData = useCallback(async () => {
    setPhase("loading");
    setCurrentIndex(0);
    setFlipped(false);
    setResults([]);
    setErrorMsg("");

    try {
      const [queuePayload, flashcards] = await Promise.all([
        fetchReviewQueue(sessionId),
        fetchFlashcards(documentId),
      ]);

      // Build a lookup from flashcard id to the item
      const flashcardMap = new Map<string, FlashcardItem>();
      for (const fc of flashcards) {
        flashcardMap.set(fc.id, fc);
      }

      // Filter review items to flashcard-sourced ones only
      const flashcardReviewItems = queuePayload.items.filter((item) =>
        item.source_ref.startsWith("flashcard:"),
      );

      // Build review cards by joining review items with flashcard data
      const reviewCards: ReviewCard[] = [];
      for (const item of flashcardReviewItems) {
        const fcId = item.source_ref.replace("flashcard:", "");
        const fc = flashcardMap.get(fcId);
        reviewCards.push({
          reviewItem: item,
          front: item.prompt,
          back: fc?.back_md ?? "（答案不可用）",
        });
      }

      if (reviewCards.length === 0) {
        setPhase("empty");
      } else {
        setCards(reviewCards);
        setPhase("reviewing");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "加载失败");
      setPhase("error");
    }
  }, [sessionId, documentId]);

  useEffect(() => {
    if (open) {
      void loadData();
    }
  }, [open, loadData]);

  // ── Keyboard shortcuts ───────────────────────────────────

  useEffect(() => {
    if (!open) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (phase !== "reviewing" || submitting) return;

      if (!flipped && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setFlipped(true);
        return;
      }
      if (flipped) {
        const keyMap: Record<string, number> = {
          "1": 0,
          "2": 2,
          "3": 3,
          "4": 5,
        };
        if (e.key in keyMap) {
          e.preventDefault();
          void handleRate(keyMap[e.key]);
        }
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase, flipped, submitting, currentIndex]);

  // ── Rate handler ─────────────────────────────────────────

  async function handleRate(quality: number) {
    if (submitting || phase !== "reviewing") return;
    const card = cards[currentIndex];
    if (!card) return;

    setSubmitting(true);
    try {
      await completeReviewItem(card.reviewItem.id, quality);
      const newResults = [...results, { reviewId: card.reviewItem.id, quality }];
      setResults(newResults);

      if (currentIndex + 1 >= cards.length) {
        setPhase("summary");
      } else {
        setCurrentIndex((i) => i + 1);
        setFlipped(false);
      }
    } catch {
      // Allow retry — don't advance
    } finally {
      setSubmitting(false);
    }
  }

  // ── Summary stats ────────────────────────────────────────

  const summaryStats = useMemo(() => {
    const total = results.length;
    const remembered = results.filter((r) => r.quality >= 3).length;
    const rate = total > 0 ? Math.round((remembered / total) * 100) : 0;
    return { total, remembered, rate };
  }, [results]);

  // ── Render nothing when closed ───────────────────────────

  if (!open) return null;

  // ── Progress fraction ────────────────────────────────────

  const progress =
    phase === "reviewing" && cards.length > 0
      ? Math.round(((currentIndex + (flipped ? 0.5 : 0)) / cards.length) * 100)
      : phase === "summary"
        ? 100
        : 0;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="闪卡复习"
    >
      <div className="w-[420px] max-w-[92vw] rounded-[20px] border border-[#e0d1bc] bg-[#fffaf2] shadow-[0_24px_60px_rgba(94,72,46,0.22)]">
        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-[#ecdec8] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-base">🃏</span>
            <h2 className="text-sm font-semibold text-[#3f3125]">闪卡复习</h2>
            {phase === "reviewing" && cards.length > 0 && (
              <span className="ml-1 text-xs text-[#8c765f]">
                {currentIndex + 1} / {cards.length}
              </span>
            )}
          </div>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full text-[#8c765f] transition hover:bg-[#f2e7d2] hover:text-[#5f4a33]"
            onClick={onClose}
            aria-label="关闭"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* ── Progress bar ───────────────────────────────── */}
        {(phase === "reviewing" || phase === "summary") && (
          <div className="px-5 pt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#ecdec8]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#6f8c68] to-[#7f8763] transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Body ───────────────────────────────────────── */}
        <div className="px-5 py-4">
          {phase === "loading" && <LoadingView />}
          {phase === "error" && <ErrorView message={errorMsg} onRetry={loadData} />}
          {phase === "empty" && <EmptyView />}
          {phase === "reviewing" && cards[currentIndex] && (
            <CardView
              card={cards[currentIndex]}
              flipped={flipped}
              submitting={submitting}
              onFlip={() => setFlipped(true)}
              onRate={handleRate}
            />
          )}
          {phase === "summary" && (
            <SummaryView stats={summaryStats} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function LoadingView() {
  return (
    <div className="flex flex-col items-center justify-center py-10">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#ecdec8] border-t-[#a07844]" />
      <p className="mt-3 text-sm text-[#8c765f]">正在加载复习卡片…</p>
    </div>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-10">
      <p className="text-sm text-[#9a5e4e]">{message}</p>
      <button
        type="button"
        className="btn btn-soft mt-4"
        onClick={() => void onRetry()}
      >
        重试
      </button>
    </div>
  );
}

function EmptyView() {
  return (
    <div className="flex flex-col items-center justify-center py-10">
      <span className="text-3xl">✨</span>
      <p className="mt-3 text-sm font-medium text-[#3f3125]">暂无待复习卡片</p>
      <p className="mt-1 text-xs text-[#8c765f]">所有卡片都已复习完毕，稍后再来</p>
    </div>
  );
}

function CardView({
  card,
  flipped,
  submitting,
  onFlip,
  onRate,
}: {
  card: ReviewCard;
  flipped: boolean;
  submitting: boolean;
  onFlip: () => void;
  onRate: (quality: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Card area with flip */}
      <div className="perspective-[800px]">
        <div
          className={`relative min-h-[160px] rounded-[16px] border border-[#e0d1bc] bg-[#fbf6ed] p-5 shadow-[0_8px_24px_rgba(94,72,46,0.08)] transition-transform duration-500 ${
            flipped ? "[transform:rotateX(0deg)]" : ""
          }`}
          style={{ transformStyle: "preserve-3d" }}
        >
          {/* Front */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#b09a7e]">
              {flipped ? "答案" : "问题"}
            </span>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#3f3125]">
              {flipped ? card.back : card.front}
            </p>
          </div>
        </div>
      </div>

      {/* Action area */}
      {!flipped ? (
        <button
          type="button"
          className="btn btn-dark mx-auto"
          onClick={onFlip}
        >
          显示答案
          <span className="ml-1 text-[10px] opacity-60">Space</span>
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-center text-[10px] text-[#8c765f]">你觉得这道题如何？</p>
          <div className="flex items-center justify-center gap-2">
            {QUALITY_OPTIONS.map((opt, idx) => (
              <button
                key={opt.quality}
                type="button"
                className={`btn btn-segment ${opt.cls} min-w-[56px]`}
                disabled={submitting}
                onClick={() => void onRate(opt.quality)}
              >
                {opt.label}
                <span className="ml-0.5 text-[9px] opacity-50">{idx + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryView({
  stats,
  onClose,
}: {
  stats: { total: number; remembered: number; rate: number };
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center py-6">
      <span className="text-3xl">🎉</span>
      <p className="mt-3 text-base font-semibold text-[#3f3125]">复习完成</p>

      <div className="mt-4 grid w-full max-w-[280px] grid-cols-3 gap-3 text-center">
        <StatCell label="总计" value={String(stats.total)} />
        <StatCell label="记住" value={String(stats.remembered)} accent />
        <StatCell label="记忆率" value={`${stats.rate}%`} accent />
      </div>

      <button
        type="button"
        className="btn btn-primary mt-6"
        onClick={onClose}
      >
        完成
      </button>
    </div>
  );
}

function StatCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-[12px] border border-[#ecdec8] bg-[#fbf6ed] px-2 py-2.5">
      <p
        className={`text-lg font-bold ${
          accent ? "text-[#6f8c68]" : "text-[#3f3125]"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-[#8c765f]">{label}</p>
    </div>
  );
}
