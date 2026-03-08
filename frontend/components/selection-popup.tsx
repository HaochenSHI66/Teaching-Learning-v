"use client";

import { useEffect, useRef, useState } from "react";

type SelectionPopupProps = {
  containerRef: React.RefObject<HTMLElement | null>;
  onInsert: (text: string) => void;
  onElaborate: (text: string) => void;
  disabled?: boolean;
};

export function SelectionPopup({ containerRef, onInsert, onElaborate, disabled }: SelectionPopupProps) {
  const [popup, setPopup] = useState<{ text: string; x: number; y: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleSelectionChange() {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";

      if (!text || !selection || selection.rangeCount === 0) {
        setPopup(null);
        return;
      }

      const range = selection.getRangeAt(0);
      const anchor = selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode?.parentElement ?? null;

      if (!anchor || !containerRef.current?.contains(anchor)) {
        setPopup(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      setPopup({ text, x: rect.left + rect.width / 2, y: rect.top - 8 });
    }

    function handleMouseUp() {
      // Delay to allow selection to stabilize
      setTimeout(handleSelectionChange, 10);
    }

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [containerRef]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopup(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!popup) return null;

  return (
    <div
      ref={popupRef}
      className="fixed z-50 flex items-center gap-1 rounded-xl border border-[#d9c7ab] bg-[#fffaf1] px-1.5 py-1 shadow-[0_4px_16px_rgba(109,85,58,0.18)]"
      style={{ left: popup.x, top: popup.y, transform: "translate(-50%, -100%)" }}
    >
      <button
        className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-[#607253] hover:bg-[#edf1e6] transition-colors"
        disabled={disabled}
        onClick={() => { onInsert(popup.text); setPopup(null); }}
        type="button"
      >
        摘录至笔记
      </button>
      <span className="h-3 w-px bg-[#d9c7ab]" />
      <button
        className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-[#7290a6] hover:bg-[#eaf0f5] transition-colors"
        disabled={disabled}
        onClick={() => { onElaborate(popup.text); setPopup(null); }}
        type="button"
      >
        深入解析
      </button>
    </div>
  );
}
