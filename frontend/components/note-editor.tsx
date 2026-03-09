"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownContent } from "@/components/markdown-content";
import { extractNotebookOutline } from "@/lib/notebookFormat";

type NoteVersion = { timestamp: number; content: string };

type NoteEditorProps = {
  markdown: string;
  onChange: (v: string) => void;
  onFormat: () => void;
  onAIOrganize: () => void;
  onAIPolish: (content: string) => Promise<string>;
  onExport: () => void;
  onCollapse?: () => void;
  loading: boolean;
  disabled: boolean;
  documentName?: string;
  viewMode: "edit" | "preview";
  onViewModeChange: (mode: "edit" | "preview") => void;
  saveStateLabel?: string;
};

export function NoteEditor({
  markdown,
  onChange,
  onFormat,
  onAIOrganize,
  onAIPolish,
  onExport,
  onCollapse,
  loading,
  disabled,
  documentName,
  viewMode,
  onViewModeChange,
  saveStateLabel,
}: NoteEditorProps) {
  const [history, setHistory] = useState<NoteVersion[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [diffView, setDiffView] = useState<{ before: string; after: string } | null>(null);
  const [pendingHeading, setPendingHeading] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const outline = useMemo(() => extractNotebookOutline(markdown), [markdown]);

  function scrollPreviewToHeading(heading: string) {
    const container = previewRef.current;
    if (!container) return false;
    const headings = Array.from(container.querySelectorAll("h2"));
    const target = headings.find((item) => item.textContent?.trim() === heading);
    if (!target) return false;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextScrollTop = container.scrollTop + (targetRect.top - containerRect.top) - 12;
    container.scrollTop = Math.max(0, nextScrollTop);
    return true;
  }

  async function handleAIPolish() {
    if (!markdown.trim()) return;
    setPolishing(true);
    try {
      const before = markdown;
      const result = await onAIPolish(markdown);
      if (result && result !== before) {
        setHistory((prev) => [{ timestamp: Date.now(), content: before }, ...prev.slice(0, 9)]);
        setDiffView({ before, after: result });
        onChange(result);
      }
    } finally {
      setPolishing(false);
    }
  }

  function acceptDiff() { setDiffView(null); }
  function revertDiff() {
    if (diffView) { onChange(diffView.before); }
    setDiffView(null);
  }

  function restoreVersion(v: NoteVersion) {
    setHistory((prev) => [{ timestamp: Date.now(), content: markdown }, ...prev.filter((x) => x.timestamp !== v.timestamp).slice(0, 9)]);
    onChange(v.content);
    setHistoryOpen(false);
  }

  useEffect(() => {
    if (!pendingHeading || viewMode !== "preview" || !previewRef.current) return;
    const container = previewRef.current;
    const frame = window.requestAnimationFrame(() => {
      scrollPreviewToHeading(pendingHeading);
      setPendingHeading(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingHeading, viewMode, markdown]);

  function jumpToHeading(heading: string) {
    if (viewMode === "preview") {
      window.setTimeout(() => {
        scrollPreviewToHeading(heading);
      }, 0);
    } else {
      setPendingHeading(heading);
      onViewModeChange("preview");
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[30px] border border-[#d9c7ab] bg-[linear-gradient(180deg,#fffaf2,#f6ebdb)] p-3 shadow-[0_28px_60px_rgba(122,98,66,0.12)]">
      {/* Header */}
      <header className="mb-2 shrink-0 flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[10px] uppercase tracking-[0.26em] text-[#9d876f]">Notebook</p>
            {saveStateLabel ? (
              <span className="rounded-full border border-[#e2d4bf] bg-[#fffdf8] px-2 py-0.5 text-[10px] text-[#8f7a63]">
                {saveStateLabel}
              </span>
            ) : null}
          </div>
          {documentName && <p className="text-xs font-medium text-[#463829] truncate max-w-[160px]">{documentName}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button
            className={`btn btn-segment !px-2.5 !py-1 !text-[10px] ${viewMode === "edit" ? "btn-segment-active" : "btn-segment-idle"}`}
            onClick={() => onViewModeChange("edit")}
            type="button"
          >
            编辑
          </button>
          <button
            className={`btn btn-segment !px-2.5 !py-1 !text-[10px] ${viewMode === "preview" ? "btn-segment-active" : "btn-segment-idle"}`}
            onClick={() => onViewModeChange("preview")}
            type="button"
          >
            预览
          </button>
          <button
            className={`btn btn-segment !px-2.5 !py-1 !text-[10px] ${historyOpen ? "btn-segment-active" : "btn-segment-idle"}`}
            onClick={() => setHistoryOpen((v) => !v)}
            type="button"
          >
            版本 {history.length > 0 && `(${history.length})`}
          </button>
          {onCollapse ? (
            <button
              className="btn btn-outline !px-2.5 !py-1 !text-[10px]"
              onClick={onCollapse}
              type="button"
            >
              收起笔记本
            </button>
          ) : null}
        </div>
      </header>

      {/* Toolbar */}
      <div className="mb-2 shrink-0 flex flex-wrap gap-1">
        <button className="btn btn-soft !py-1 !px-2.5 !text-[11px]" disabled={loading || disabled} onClick={onFormat} type="button">
          整理
        </button>
        <button className="btn btn-soft !py-1 !px-2.5 !text-[11px]" disabled={loading || disabled} onClick={onAIOrganize} type="button">
          结构化
        </button>
        <button
          className="btn btn-primary !py-1 !px-2.5 !text-[11px]"
          disabled={loading || disabled || polishing || !markdown.trim()}
          onClick={handleAIPolish}
          type="button"
        >
          {polishing ? "润色中…" : "润色"}
        </button>
        <button className="btn btn-soft !py-1 !px-2.5 !text-[11px] ml-auto" disabled={loading || disabled} onClick={onExport} type="button">
          导出
        </button>
      </div>

      {outline.length > 1 ? (
        <div
          className="mb-2 shrink-0 flex gap-1 overflow-x-auto rounded-[18px] border border-[#e0d0bb] bg-[#fffdf8] p-2"
          data-testid="notebook-outline"
        >
          {outline.map((item) => (
            <button
              key={item.heading}
              className="btn btn-outline shrink-0 !rounded-full !px-3 !py-1 !text-[10px]"
              onClick={() => jumpToHeading(item.heading)}
              title={item.title}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Diff banner */}
      {diffView && (
        <div className="mb-2 shrink-0 rounded-[16px] border border-[#c8d5b9] bg-[#edf2e4] px-3 py-2">
          <p className="mb-1.5 text-[11px] font-medium text-[#607253]">润色已完成，确认应用变更？</p>
          <div className="flex gap-1.5">
            <button className="btn btn-success !py-0.5 !px-3 !text-[11px]" onClick={acceptDiff} type="button">应用</button>
            <button className="btn btn-outline !py-0.5 !px-3 !text-[11px]" onClick={revertDiff} type="button">还原</button>
          </div>
        </div>
      )}

      {/* History panel */}
      {historyOpen && (
        <div className="mb-2 shrink-0 rounded-[16px] border border-[#e0d0bb] bg-[#fffdf8] p-2 max-h-40 overflow-auto">
          {history.length === 0 ? (
            <p className="text-[11px] text-[#a08b78]">暂无版本记录。润色后自动保留快照。</p>
          ) : (
            history.map((v) => (
              <div key={v.timestamp} className="flex items-center justify-between py-1 border-b border-[#f0e8db] last:border-0">
                <p className="text-[11px] text-[#7a6655]">
                  {new Date(v.timestamp).toLocaleTimeString()} — {v.content.slice(0, 40).replace(/\n/g, " ")}…
                </p>
                <button
                  className="btn btn-outline !py-0.5 !px-2 !text-[10px]"
                  onClick={() => restoreVersion(v)}
                  type="button"
                >
                  恢复
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Main editor / preview */}
      <div className="min-h-0 flex-1">
        {viewMode === "preview" ? (
          <div
            className="h-full overflow-auto rounded-[22px] border border-[#deccb1] bg-[#fffdf8] p-3"
            data-testid="notebook-preview"
            ref={previewRef}
          >
            {markdown.trim() ? (
              <MarkdownContent content={markdown} />
            ) : (
              <p className="text-xs text-[#a08b78]">笔记为空。</p>
            )}
          </div>
        ) : (
          <textarea
            className="h-full w-full min-h-[120px] rounded-[22px] border border-[#deccb1] bg-[#fffdf8] p-3 font-mono text-[11px] leading-5 text-[#5a4938] shadow-inner resize-none outline-none focus:border-[#8a9d76]"
            onChange={(e) => onChange(e.target.value)}
            placeholder="在此记录笔记，支持 Markdown。"
            value={markdown}
          />
        )}
      </div>
    </section>
  );
}
