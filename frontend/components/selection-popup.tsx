"use client";

import { useEffect, useRef, useState } from "react";

type SelectionPopupProps = {
  containerRef: React.RefObject<HTMLElement | null>;
  onInsert?: (text: string) => void;
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
      className="fixed z-50 flex items-center gap-1 rounded-xl border border-[var(--bd-1)] bg-[var(--sf-1)] px-1.5 py-1 shadow-[var(--sh-popup)]"
      style={{ left: popup.x, top: popup.y, transform: "translate(-50%, -100%)" }}
    >
      {onInsert && (
        <>
          <button
            className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--ac-green-text)] hover:bg-[var(--ac-green-hover-light)] transition-colors"
            disabled={disabled}
            onClick={() => { onInsert(popup.text); setPopup(null); }}
            type="button"
          >
            摘录至笔记
          </button>
          <span className="h-3 w-px bg-[var(--bd-1)]" />
        </>
      )}
      <button
        className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--ac-blue-text)] hover:bg-[var(--ac-blue-hover)] transition-colors"
        disabled={disabled}
        onClick={() => { onElaborate(popup.text); setPopup(null); }}
        type="button"
      >
        深入解析
      </button>
    </div>
  );
}
