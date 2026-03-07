"use client";

import { useCallback, useState } from "react";

import { askRoiQuestion, askSlideQuestion, type RoiBox, type Slide } from "@/lib/api";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  slideId?: string;
};

let _counter = 0;
function nextId() {
  return `msg-${Date.now()}-${++_counter}`;
}

type ChatState = {
  chatMessages: ChatMessage[];
  explanation: string;
  chatInput: string;
  loading: boolean;
  statusText: string;
  mode: "slide" | "global";
};

type ChatActions = {
  setChatInput: (v: string) => void;
  setMode: (m: "slide" | "global") => void;
  setExplanation: (markdown: string) => void;
  ask: (message: string, sessionId: string, slide?: Slide) => Promise<void>;
  askRoi: (roi: RoiBox, sessionId: string, slide: Slide) => Promise<void>;
  clearSlideMessages: (slideId: string) => void;
  clearStatus: () => void;
};

export function useChat(): ChatState & ChatActions {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [explanation, setExplanation] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [mode, setMode] = useState<"slide" | "global">("slide");

  const ask = useCallback(
    async (message: string, sessionId: string, slide?: Slide) => {
      const question = message.trim();
      if (!question) return;

      const slideId = mode === "slide" ? slide?.id : undefined;

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
        setExplanation(response.answer);
        setChatMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", content: response.answer, slideId },
        ]);
        setStatusText(response.degraded ? "回答完成（降级模式）" : "回答完成");
      } catch (error) {
        const msg = error instanceof Error ? error.message : "未知错误";
        setChatMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", content: `请求失败：${msg}`, slideId },
        ]);
        setStatusText(`提问失败：${msg}`);
      } finally {
        setLoading(false);
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
      setExplanation(response.answer);
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

  return {
    chatMessages,
    explanation,
    chatInput,
    loading,
    statusText,
    mode,
    setChatInput,
    setMode,
    setExplanation,
    ask,
    askRoi,
    clearSlideMessages,
    clearStatus: () => setStatusText(""),
  };
}
