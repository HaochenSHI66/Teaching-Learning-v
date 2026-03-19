"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownContent } from "@/components/markdown-content";
import { extractNotebookOutline } from "@/lib/notebookFormat";

type NoteVersion = { timestamp: number; content: string };

function normalizeHeadingText(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

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
    const targetHeading = normalizeHeadingText(heading);
    const target = headings.find(
      (item) => normalizeHeadingText(item.textContent ?? "") === targetHeading,
    );
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

  const saveDot =
    saveStateLabel === "自动保存中"
      ? "bg-amber-400 animate-pulse"
      : saveStateLabel === "已保存"
        ? "bg-emerald-400"
        : saveStateLabel === "保存失败"
          ? "bg-red-400"
          : "bg-[#c8b496]";

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[28px] border border-[#d5c3a5] bg-[linear-gradient(165deg,#fffcf5_0%,#f7edda_100%)] shadow-[0_32px_64px_rgba(100,76,46,0.16),0_2px_8px_rgba(100,76,46,0.06)]">

      {/* Header */}
      <header className="shrink-0 px-4 pt-4 pb-2.5">
        <div className="flex items-start justify-between gap-2">

          {/* Left: brand + document */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.34em] text-[#a08b72]">Notebook</span>
              {saveStateLabel && (
                <span className="flex items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${saveDot} transition-colors duration-500`} />
                  <span className="text-[11px] text-[#b09a80]">{saveStateLabel}</span>
                </span>
              )}
            </div>
            {documentName && (
              <p className="truncate text-[15px] font-semibold leading-snug text-[#3a2c1c] max-w-[200px]" title={documentName}>
                {documentName}
              </p>
            )}
          </div>

          {/* Right: view mode toggle + history + collapse */}
          <div className="flex items-center gap-1.5 pt-0.5 shrink-0">
            {/* Pill toggle */}
            <div className="flex items-center rounded-full border border-[#d0bfa4] bg-[#ede3d3] p-[3px]">
              <button
                className={`rounded-full px-3 py-[3px] text-[12px] font-medium transition-all duration-150 ${
                  viewMode === "edit"
                    ? "btn-segment-active bg-[#fffbf3] text-[#3a2c1c] shadow-[0_1px_3px_rgba(100,76,46,0.18)]"
                    : "text-[#9a8570] hover:text-[#5a4535]"
                }`}
                onClick={() => onViewModeChange("edit")}
                type="button"
              >
                编辑
              </button>
              <button
                className={`rounded-full px-3 py-[3px] text-[12px] font-medium transition-all duration-150 ${
                  viewMode === "preview"
                    ? "btn-segment-active bg-[#fffbf3] text-[#3a2c1c] shadow-[0_1px_3px_rgba(100,76,46,0.18)]"
                    : "text-[#9a8570] hover:text-[#5a4535]"
                }`}
                onClick={() => onViewModeChange("preview")}
                type="button"
              >
                预览
              </button>
            </div>

            {/* History icon button */}
            <button
              className={`flex h-[26px] w-[26px] items-center justify-center rounded-full border transition-colors ${
                historyOpen
                  ? "border-[#c4a97c] bg-[#f0dfc0] text-[#6b4f2c]"
                  : "border-[#d0bfa4] bg-transparent text-[#9a8570] hover:border-[#bfab8a] hover:text-[#5a4535]"
              }`}
              onClick={() => setHistoryOpen((v) => !v)}
              title={`版本历史${history.length > 0 ? ` (${history.length})` : ""}`}
              type="button"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 .49-3.51" />
              </svg>
            </button>

            {/* Collapse */}
            {onCollapse ? (
              <button
                aria-label="收起笔记本"
                className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-[#d0bfa4] text-[#9a8570] transition-colors hover:border-[#bfab8a] hover:text-[#5a4535]"
                onClick={onCollapse}
                title="收起笔记本"
                type="button"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="shrink-0 px-4 pb-2.5">
        <div className="flex items-center gap-1">
          {/* Formatting group */}
          <button
            className="rounded-lg border border-[#d0bfa4] bg-[#f0e5d1] px-2.5 py-[5px] text-[13px] font-medium text-[#6b5540] transition-colors hover:bg-[#e8d8c0] disabled:opacity-40"
            disabled={loading || disabled}
            onClick={onFormat}
            type="button"
          >
            整理
          </button>
          <button
            className="rounded-lg border border-[#d0bfa4] bg-[#f0e5d1] px-2.5 py-[5px] text-[13px] font-medium text-[#6b5540] transition-colors hover:bg-[#e8d8c0] disabled:opacity-40"
            disabled={loading || disabled}
            onClick={onAIOrganize}
            type="button"
          >
            结构化
          </button>

          {/* Divider */}
          <span className="mx-1 h-3.5 w-px rounded-full bg-[#d0bfa4]" />

          {/* Polish — gold primary action */}
          <button
            className="rounded-lg border border-[#c4a055] bg-[linear-gradient(140deg,#e8c870,#d09438)] px-3 py-[5px] text-[13px] font-semibold text-[#3d2108] shadow-[0_1px_4px_rgba(180,130,40,0.30)] transition-all hover:brightness-105 hover:shadow-[0_2px_8px_rgba(180,130,40,0.40)] disabled:opacity-40 disabled:shadow-none"
            disabled={loading || disabled || polishing || !markdown.trim()}
            onClick={handleAIPolish}
            type="button"
          >
            {polishing ? "润色中…" : "✦ 润色"}
          </button>

          {/* Export — ghost, right-aligned */}
          <button
            className="ml-auto rounded-lg border border-[#d0bfa4] bg-transparent px-2.5 py-[5px] text-[13px] text-[#9a8570] transition-colors hover:bg-[#ede3d3] hover:text-[#5a4535] disabled:opacity-40"
            disabled={loading || disabled}
            onClick={onExport}
            type="button"
          >
            导出 ↗
          </button>
        </div>
      </div>

      {/* Page outline navigation */}
      {outline.length > 1 ? (
        <div
          className="mx-4 mb-2.5 shrink-0 flex gap-1 overflow-x-auto rounded-[18px] border border-[#ddd0bb] bg-[#faf5ec] px-2 py-1.5"
          data-testid="notebook-outline"
        >
          {outline.map((item) => (
            <button
              key={item.heading}
              className="shrink-0 rounded-full border border-[#d0bfa4] bg-white/70 px-2.5 py-[3px] text-[12px] font-medium text-[#7a6248] transition-colors hover:border-[#b8a080] hover:bg-white hover:text-[#3a2c1c]"
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
        <div className="mx-4 mb-2.5 shrink-0 rounded-[16px] border border-[#aecf96] bg-[linear-gradient(140deg,#eef6e5,#e3f0d8)] px-3.5 py-2.5">
          <p className="mb-2 text-[13px] font-semibold text-[#476836]">润色完成 · 确认应用变更？</p>
          <div className="flex gap-2">
            <button
              className="rounded-lg border border-[#78b05e] bg-[#5d9845] px-3.5 py-1 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[#4f8439]"
              onClick={acceptDiff}
              type="button"
            >
              应用
            </button>
            <button
              className="rounded-lg border border-[#c8b496] bg-transparent px-3.5 py-1 text-[11px] text-[#7a6248] transition-colors hover:bg-[#ede3d3]"
              onClick={revertDiff}
              type="button"
            >
              还原
            </button>
          </div>
        </div>
      )}

      {/* History panel */}
      {historyOpen && (
        <div className="mx-4 mb-2.5 shrink-0 max-h-36 overflow-auto rounded-[16px] border border-[#ddd0bb] bg-[#faf5ec] p-2">
          {history.length === 0 ? (
            <p className="px-1 py-1.5 text-[13px] text-[#a08b72]">暂无版本记录。润色后自动保留快照。</p>
          ) : (
            history.map((v) => (
              <div key={v.timestamp} className="flex items-center justify-between gap-2 px-1 py-1.5 border-b border-[#ede3d4] last:border-0">
                <p className="min-w-0 flex-1 truncate text-[13px] text-[#7a6655]">
                  <span className="text-[#b09a80]">{new Date(v.timestamp).toLocaleTimeString()}</span>
                  {" · "}
                  {v.content.slice(0, 32).replace(/\n/g, " ")}
                </p>
                <button
                  className="shrink-0 rounded-md border border-[#d0bfa4] px-2 py-0.5 text-[12px] text-[#7a6248] transition-colors hover:bg-[#e8d8c0]"
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
      <div className="min-h-0 flex-1 px-3 pb-3">
        {viewMode === "preview" ? (
          <div
            className="h-full overflow-auto rounded-[20px] border border-[#ddd0bb] bg-[#fffdf8] px-4 py-3"
            data-testid="notebook-preview"
            ref={previewRef}
          >
            {markdown.trim() ? (
              <MarkdownContent content={markdown} />
            ) : (
              <p className="text-xs text-[#b09a80]">笔记为空。</p>
            )}
          </div>
        ) : (
          <textarea
            className="h-full w-full min-h-[120px] rounded-[20px] border border-[#ddd0bb] bg-[#fffdf8] px-4 py-3 font-mono text-[13px] leading-[1.7] text-[#4a3828] shadow-[inset_0_1px_4px_rgba(110,82,46,0.06)] resize-none outline-none placeholder:text-[#c8b496] transition-colors focus:border-[#b8a878] focus:shadow-[inset_0_1px_4px_rgba(110,82,46,0.08),0_0_0_3px_rgba(200,180,140,0.15)]"
            onChange={(e) => onChange(e.target.value)}
            placeholder="在此记录笔记，支持 Markdown。"
            value={markdown}
          />
        )}
      </div>
    </section>
  );
}
