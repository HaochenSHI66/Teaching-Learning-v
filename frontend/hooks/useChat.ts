"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { askRoiQuestion, askSlideQuestion, fetchGlobalMessages, deleteGlobalMessages, type GlobalMessageItem, type RoiBox, type Slide, type SlideExplanation } from "@/lib/api";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  slideId?: string;
};

type ChatState = {
  chatMessages: ChatMessage[];
  explanation: string;
  explanationMeta: SlideExplanation["meta"] | null;
  chatInput: string;
  loading: boolean;
  statusText: string;
  mode: "slide" | "global";
  globalMessages: GlobalMessageItem[];
  globalLoading: boolean;
};

type ChatActions = {
  setChatInput: (v: string) => void;
  setMode: (m: "slide" | "global") => void;
  setExplanation: (markdown: string) => void;
  setExplanationMeta: (meta: SlideExplanation["meta"] | null) => void;
  ask: (message: string, sessionId: string, slide?: Slide) => Promise<void>;
  askRoi: (roi: RoiBox, sessionId: string, slide: Slide) => Promise<void>;
  clearSlideMessages: (slideId: string) => void;
  clearStatus: () => void;
  loadGlobalMessages: () => Promise<void>;
  clearGlobalMessages: () => Promise<void>;
};

export function useChat(): ChatState & ChatActions {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [explanation, setExplanation] = useState("");
  const [explanationMeta, setExplanationMeta] = useState<SlideExplanation["meta"] | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [mode, setMode] = useState<"slide" | "global">("slide");
  const [globalMessages, setGlobalMessages] = useState<GlobalMessageItem[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const msgIdRef = useRef(0);
  function nextId() {
    return `msg-${++msgIdRef.current}-${crypto.randomUUID()}`;
  }

  // Abort pending request on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const ask = useCallback(
    async (message: string, sessionId: string, slide?: Slide) => {
      const question = message.trim();
      if (!question) return;

      // Abort any in-flight request before starting a new one
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const slideId = slide?.id;

      setLoading(true);
      setStatusText("AI 正在生成回答...");
      setChatMessages((prev) => [...prev, { id: nextId(), role: "user", content: question, slideId }]);

      try {
        const response = await askSlideQuestion({
          sessionId,
          message: question,
          slideId: mode === "slide" ? slide?.id : undefined,
          mode,
        });
        setChatMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", content: response.answer, slideId },
        ]);
        setStatusText(response.degraded ? "回答完成（降级模式）" : "回答完成");
      } catch (error) {
        // If this request was aborted (superseded), don't update UI
        if (controller.signal.aborted) return;
        const msg = error instanceof Error ? error.message : "未知错误";
        setChatMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", content: `请求失败：${msg}`, slideId },
        ]);
        setStatusText(`提问失败：${msg}`);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [mode],
  );

  const askRoi = useCallback(async (roi: RoiBox, sessionId: string, slide: Slide) => {
    setLoading(true);
    setStatusText("正在解释框选区域...");
    setChatMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: "请解释我框选的区域", slideId: slide.id },
    ]);

    try {
      const response = await askRoiQuestion({
        sessionId,
        slideId: slide.id,
        message: "请解释我框选的区域",
        roi,
      });
      setChatMessages((prev) => [
        ...prev,
        { id: nextId(), role: "assistant", content: response.answer, slideId: slide.id },
      ]);
      setStatusText("区域解释完成");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      setStatusText(`区域解释失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearSlideMessages = useCallback((slideId: string) => {
    setChatMessages((prev) => prev.filter((m) => m.slideId !== slideId));
  }, []);

  const loadGlobalMessages = useCallback(async () => {
    setGlobalLoading(true);
    try {
      const msgs = await fetchGlobalMessages();
      setGlobalMessages(msgs);
    } finally {
      setGlobalLoading(false);
    }
  }, []);

  const clearGlobalMessages = useCallback(async () => {
    await deleteGlobalMessages();
    setGlobalMessages([]);
  }, []);

  return {
    chatMessages,
    explanation,
    explanationMeta,
    chatInput,
    loading,
    statusText,
    mode,
    globalMessages,
    globalLoading,
    setChatInput,
    setMode,
    setExplanation,
    setExplanationMeta,
    ask,
    askRoi,
    clearSlideMessages,
    clearStatus: () => setStatusText(""),
    loadGlobalMessages,
    clearGlobalMessages,
  };
}
