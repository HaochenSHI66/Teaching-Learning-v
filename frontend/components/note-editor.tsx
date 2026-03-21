"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownContent } from "@/components/markdown-content";
import type { Slide, SlideNote } from "@/lib/api";
import {
  fetchSlideNotes,
  saveSlideNote,
  generateSlideNote,
  generateAllSlideNotes,
  exportSlideNotes,
} from "@/lib/api";

type NoteVersion = { timestamp: number; content: string };

type NoteEditorProps = {
  slides: Slide[];
  currentSlideIndex: number;
  documentId: string;
  onCollapse?: () => void;
  loading: boolean;
  disabled: boolean;
  documentName?: string;
  viewMode: "edit" | "preview";
  onViewModeChange: (mode: "edit" | "preview") => void;
  /** Legacy — kept for backward compat, not actively used by per-slide editor */
  markdown?: string;
  onChange?: (v: string) => void;
  onFormat?: () => void;
  onAIOrganize?: () => void;
  onAIPolish?: (content: string) => Promise<string>;
  onExport?: () => void;
  saveStateLabel?: string;
};

export function NoteEditor({
  slides,
  currentSlideIndex,
  documentId,
  onCollapse,
  loading,
  disabled,
  documentName,
  viewMode,
  onViewModeChange,
  onAIPolish,
  saveStateLabel: externalSaveLabel,
}: NoteEditorProps) {
  // ── Per-slide notes state ────────────────────────────────────
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [selectedPageIndex, setSelectedPageIndex] = useState(currentSlideIndex);
  const [fullDocView, setFullDocView] = useState(false);
  const [internalSaveState, setInternalSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [generating, setGenerating] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);

  // ── Legacy state (history, polish, diff) ─────────────────────
  const [history, setHistory] = useState<NoteVersion[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [diffView, setDiffView] = useState<{ before: string; after: string } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageNavRef = useRef<HTMLDivElement>(null);

  const selectedSlide = slides[selectedPageIndex] ?? null;
  const currentContent = selectedSlide ? (notesMap[selectedSlide.id] ?? "") : "";

  // ── Load all slide notes on mount / documentId change ────────
  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    fetchSlideNotes(documentId)
      .then((notes) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const n of notes) {
          map[n.slide_id] = n.content_md;
        }
        setNotesMap(map);
      })
      .catch(() => {
        // silent — notes may not exist yet
      });
    return () => { cancelled = true; };
  }, [documentId]);

  // ── Auto-follow: sync selected page when main viewer changes ─
  useEffect(() => {
    if (!fullDocView) {
      setSelectedPageIndex(currentSlideIndex);
    }
  }, [currentSlideIndex, fullDocView]);

  // ── Debounced save ───────────────────────────────────────────
  const persistNote = useCallback(
    (slideId: string, content: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setInternalSaveState("saving");
      saveTimerRef.current = setTimeout(async () => {
        try {
          await saveSlideNote(slideId, content);
          setInternalSaveState("saved");
        } catch {
          setInternalSaveState("error");
        }
      }, 800);
    },
    [],
  );

  function handleContentChange(value: string) {
    if (!selectedSlide) return;
    setNotesMap((prev) => ({ ...prev, [selectedSlide.id]: value }));
    persistNote(selectedSlide.id, value);
  }

  // ── Page navigation click ────────────────────────────────────
  function handlePageSelect(idx: number) {
    setFullDocView(false);
    setSelectedPageIndex(idx);
  }

  // ── Generate note for current page ───────────────────────────
  async function handleGenerate() {
    if (!selectedSlide) return;
    setGenerating(true);
    try {
      const result = await generateSlideNote(selectedSlide.id);
      setNotesMap((prev) => ({ ...prev, [result.slide_id]: result.content_md }));
    } catch {
      // silently fail
    } finally {
      setGenerating(false);
    }
  }

  // ── Generate all notes ───────────────────────────────────────
  async function handleGenerateAll() {
    if (!documentId) return;
    setGeneratingAll(true);
    try {
      await generateAllSlideNotes(documentId);
      // Reload all notes
      const notes = await fetchSlideNotes(documentId);
      const map: Record<string, string> = {};
      for (const n of notes) {
        map[n.slide_id] = n.content_md;
      }
      setNotesMap(map);
    } catch {
      // silently fail
    } finally {
      setGeneratingAll(false);
    }
  }

  // ── Export ───────────────────────────────────────────────────
  async function handleExport() {
    if (!documentId) return;
    try {
      const result = await exportSlideNotes(documentId);
      const blob = new Blob([result.markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(documentName ?? "notes").replace(/\.[^.]+$/, "")}-slide-notes.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silently fail
    }
  }

  // ── Polish current note ──────────────────────────────────────
  async function handleAIPolish() {
    if (!onAIPolish || !currentContent.trim()) return;
    setPolishing(true);
    try {
      const before = currentContent;
      const result = await onAIPolish(currentContent);
      if (result && result !== before && selectedSlide) {
        setHistory((prev) => [{ timestamp: Date.now(), content: before }, ...prev.slice(0, 9)]);
        setDiffView({ before, after: result });
        setNotesMap((prev) => ({ ...prev, [selectedSlide.id]: result }));
        persistNote(selectedSlide.id, result);
      }
    } finally {
      setPolishing(false);
    }
  }

  function acceptDiff() { setDiffView(null); }
  function revertDiff() {
    if (diffView && selectedSlide) {
      setNotesMap((prev) => ({ ...prev, [selectedSlide.id]: diffView.before }));
      persistNote(selectedSlide.id, diffView.before);
    }
    setDiffView(null);
  }

  function restoreVersion(v: NoteVersion) {
    if (!selectedSlide) return;
    setHistory((prev) => [
      { timestamp: Date.now(), content: currentContent },
      ...prev.filter((x) => x.timestamp !== v.timestamp).slice(0, 9),
    ]);
    setNotesMap((prev) => ({ ...prev, [selectedSlide.id]: v.content }));
    persistNote(selectedSlide.id, v.content);
    setHistoryOpen(false);
  }

  // ── Full doc concatenation ───────────────────────────────────
  const fullDocMarkdown = useMemo(() => {
    return slides
      .map((s) => {
        const content = notesMap[s.id] ?? "";
        return `## 第 ${s.page_num} 页\n\n${content || "_（暂无笔记）_"}`;
      })
      .join("\n\n---\n\n");
  }, [slides, notesMap]);

  // ── Save state label ─────────────────────────────────────────
  const saveLabel =
    internalSaveState === "saving"
      ? "自动保存中"
      : internalSaveState === "saved"
        ? "已保存"
        : internalSaveState === "error"
          ? "保存失败"
          : externalSaveLabel ?? "已加载";

  const saveDot =
    saveLabel === "自动保存中"
      ? "bg-amber-400 animate-pulse"
      : saveLabel === "已保存"
        ? "bg-emerald-400"
        : saveLabel === "保存失败"
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
              <span className="flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${saveDot} transition-colors duration-500`} />
                <span className="text-[11px] text-[#b09a80]">{saveLabel}</span>
              </span>
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
                  viewMode === "edit" && !fullDocView
                    ? "btn-segment-active bg-[#fffbf3] text-[#3a2c1c] shadow-[0_1px_3px_rgba(100,76,46,0.18)]"
                    : "text-[#9a8570] hover:text-[#5a4535]"
                }`}
                onClick={() => { setFullDocView(false); onViewModeChange("edit"); }}
                type="button"
              >
                编辑
              </button>
              <button
                className={`rounded-full px-3 py-[3px] text-[12px] font-medium transition-all duration-150 ${
                  viewMode === "preview" && !fullDocView
                    ? "btn-segment-active bg-[#fffbf3] text-[#3a2c1c] shadow-[0_1px_3px_rgba(100,76,46,0.18)]"
                    : "text-[#9a8570] hover:text-[#5a4535]"
                }`}
                onClick={() => { setFullDocView(false); onViewModeChange("preview"); }}
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
        <div className="flex items-center gap-1 flex-wrap">
          {/* Generate for current page */}
          <button
            className="rounded-lg border border-[#c4a055] bg-[linear-gradient(140deg,#e8c870,#d09438)] px-2.5 py-[5px] text-[13px] font-semibold text-[#3d2108] shadow-[0_1px_4px_rgba(180,130,40,0.30)] transition-all hover:brightness-105 hover:shadow-[0_2px_8px_rgba(180,130,40,0.40)] disabled:opacity-40 disabled:shadow-none"
            disabled={loading || disabled || generating || !selectedSlide || fullDocView}
            onClick={handleGenerate}
            type="button"
          >
            {generating ? "生成中…" : "✦ 从解析生成"}
          </button>
          {/* Generate all */}
          <button
            className="rounded-lg border border-[#d0bfa4] bg-[#f0e5d1] px-2.5 py-[5px] text-[13px] font-medium text-[#6b5540] transition-colors hover:bg-[#e8d8c0] disabled:opacity-40"
            disabled={loading || disabled || generatingAll}
            onClick={handleGenerateAll}
            type="button"
          >
            {generatingAll ? "全部生成中…" : "全部生成"}
          </button>

          {/* Divider */}
          <span className="mx-1 h-3.5 w-px rounded-full bg-[#d0bfa4]" />

          {/* Polish */}
          <button
            className="rounded-lg border border-[#d0bfa4] bg-[#f0e5d1] px-2.5 py-[5px] text-[13px] font-medium text-[#6b5540] transition-colors hover:bg-[#e8d8c0] disabled:opacity-40"
            disabled={loading || disabled || polishing || !currentContent.trim() || fullDocView}
            onClick={handleAIPolish}
            type="button"
          >
            {polishing ? "润色中…" : "润色"}
          </button>

          {/* Export — ghost, right-aligned */}
          <button
            className="ml-auto rounded-lg border border-[#d0bfa4] bg-transparent px-2.5 py-[5px] text-[13px] text-[#9a8570] transition-colors hover:bg-[#ede3d3] hover:text-[#5a4535] disabled:opacity-40"
            disabled={loading || disabled}
            onClick={handleExport}
            type="button"
          >
            导出 ↗
          </button>
        </div>
      </div>

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

      {/* Main area: two-column layout */}
      <div className="min-h-0 flex-1 flex px-3 pb-3 gap-2">

        {/* Left column: page navigation */}
        <div
          ref={pageNavRef}
          className="shrink-0 w-[100px] overflow-y-auto rounded-[16px] border border-[#ddd0bb] bg-[#faf5ec]"
        >
          {/* Full Doc button */}
          <button
            className={`w-full px-2 py-2 text-left border-b border-[#ede3d4] transition-colors ${
              fullDocView
                ? "bg-[#e8d8c0] text-[#3a2c1c]"
                : "text-[#7a6248] hover:bg-[#f0e5d1]"
            }`}
            onClick={() => {
              setFullDocView(true);
              onViewModeChange("preview");
            }}
            type="button"
          >
            <span className="block text-[11px] font-semibold">全文档</span>
          </button>

          {/* Page list */}
          {slides.map((slide, idx) => {
            const noteContent = notesMap[slide.id] ?? "";
            const hasNotes = noteContent.trim().length > 0;
            const isSelected = !fullDocView && idx === selectedPageIndex;
            const preview = noteContent.trim().slice(0, 20);

            return (
              <button
                key={slide.id}
                className={`w-full px-2 py-1.5 text-left border-b border-[#ede3d4] last:border-0 transition-colors ${
                  isSelected
                    ? "bg-[#e8d8c0] text-[#3a2c1c]"
                    : "text-[#7a6248] hover:bg-[#f0e5d1]"
                }`}
                onClick={() => handlePageSelect(idx)}
                type="button"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-[6px] w-[6px] rounded-full shrink-0 ${
                      hasNotes ? "bg-[#8a9d76]" : "border border-[#c8b496] bg-transparent"
                    }`}
                  />
                  <span className="text-[12px] font-medium">P{slide.page_num}</span>
                </div>
                {preview && (
                  <p className="mt-0.5 truncate text-[10px] leading-tight text-[#b09a80]">
                    {preview}
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* Right column: editor / preview */}
        <div className="min-w-0 flex-1">
          {fullDocView ? (
            /* Full doc read-only preview */
            <div
              className="h-full overflow-auto rounded-[20px] border border-[#ddd0bb] bg-[#fffdf8] px-4 py-3"
              ref={previewRef}
            >
              {fullDocMarkdown.trim() ? (
                <MarkdownContent content={fullDocMarkdown} />
              ) : (
                <p className="text-xs text-[#b09a80]">暂无笔记。</p>
              )}
            </div>
          ) : viewMode === "preview" ? (
            <div
              className="h-full overflow-auto rounded-[20px] border border-[#ddd0bb] bg-[#fffdf8] px-4 py-3"
              data-testid="notebook-preview"
              ref={previewRef}
            >
              {currentContent.trim() ? (
                <MarkdownContent content={currentContent} />
              ) : (
                <p className="text-xs text-[#b09a80]">
                  第 {selectedSlide?.page_num ?? "?"} 页暂无笔记。点击「从解析生成」自动生成。
                </p>
              )}
            </div>
          ) : (
            <textarea
              className="h-full w-full min-h-[120px] rounded-[20px] border border-[#ddd0bb] bg-[#fffdf8] px-4 py-3 font-mono text-[13px] leading-[1.7] text-[#4a3828] shadow-[inset_0_1px_4px_rgba(110,82,46,0.06)] resize-none outline-none placeholder:text-[#c8b496] transition-colors focus:border-[#b8a878] focus:shadow-[inset_0_1px_4px_rgba(110,82,46,0.08),0_0_0_3px_rgba(200,180,140,0.15)]"
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder={`第 ${selectedSlide?.page_num ?? "?"} 页笔记，支持 Markdown。`}
              value={currentContent}
            />
          )}
        </div>
      </div>
    </section>
  );
}
