"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  downloadExportNotes,
  fetchExportStyles,
  previewExportNotes,
  type ExportNotesRequest,
  type ExportNotesStyle,
} from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────

type Phase = "config" | "generating" | "preview" | "downloading" | "error";

type ExportNotesModalProps = {
  documentId: string;
  documentName?: string;
  open: boolean;
  onClose: () => void;
};

// ── Content toggle definitions ────────────────────────────────

const CONTENT_TOGGLES: {
  key: keyof Pick<
    ExportNotesRequest,
    | "include_images"
    | "include_explanations"
    | "include_key_terms"
    | "include_knowledge_map"
    | "include_flashcards"
  >;
  label: string;
}[] = [
  { key: "include_images", label: "图片" },
  { key: "include_explanations", label: "讲解" },
  { key: "include_key_terms", label: "关键术语" },
  { key: "include_knowledge_map", label: "知识图谱" },
  { key: "include_flashcards", label: "闪卡" },
];

// ── Component ─────────────────────────────────────────────────

export function ExportNotesModal({
  documentId,
  documentName,
  open,
  onClose,
}: ExportNotesModalProps) {
  const [phase, setPhase] = useState<Phase>("config");
  const [styles, setStyles] = useState<ExportNotesStyle[]>([]);
  const [selectedStyle, setSelectedStyle] = useState<string>("");
  const [toggles, setToggles] = useState({
    include_images: true,
    include_explanations: true,
    include_key_terms: true,
    include_knowledge_map: false,
    include_flashcards: false,
  });
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewMeta, setPreviewMeta] = useState<{
    title: string;
    page_count: number;
    concept_count: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);

  // ── Load styles on mount ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetchExportStyles()
      .then((s) => {
        if (cancelled) return;
        setStyles(s);
        if (s.length > 0 && !selectedStyle) {
          setSelectedStyle(s[0].id);
        }
      })
      .catch(() => {
        /* styles will remain empty; user sees empty picker */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reset when modal opens ────────────────────────────────
  useEffect(() => {
    if (open) {
      setPhase("config");
      setPreviewHtml("");
      setPreviewMeta(null);
      setErrorMsg("");
      setToggles({
        include_images: true,
        include_explanations: true,
        include_key_terms: true,
        include_knowledge_map: false,
        include_flashcards: false,
      });
      if (styles.length > 0) {
        setSelectedStyle(styles[0].id);
      }
    }
  }, [open, styles]);

  // ── Build request payload ─────────────────────────────────
  const buildRequest = useCallback(
    (format: "html" | "pdf"): ExportNotesRequest => ({
      style: selectedStyle,
      format,
      ...toggles,
    }),
    [selectedStyle, toggles],
  );

  // ── Generate preview ──────────────────────────────────────
  async function handleGeneratePreview() {
    setPhase("generating");
    setErrorMsg("");
    try {
      const result = await previewExportNotes(documentId, buildRequest("html"));
      setPreviewHtml(result.html);
      setPreviewMeta({
        title: result.title,
        page_count: result.page_count,
        concept_count: result.concept_count,
      });
      setPhase("preview");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "生成预览失败");
      setPhase("error");
    }
  }

  // ── Download ──────────────────────────────────────────────
  async function handleDownload(format: "html" | "pdf") {
    setPhase("downloading");
    setErrorMsg("");
    try {
      await downloadExportNotes(documentId, buildRequest(format));
      setPhase("preview");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "下载失败");
      setPhase("error");
    }
  }

  // ── Toggle helper ─────────────────────────────────────────
  function flipToggle(key: keyof typeof toggles) {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // ── Keyboard ──────────────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  if (!open) return null;

  // ── Config screen ─────────────────────────────────────────
  const configScreen = (
    <>
      {/* Style picker */}
      <div className="mb-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--tx-2)]">选择风格</h3>
        <div className="grid grid-cols-3 gap-3">
          {styles.map((s) => {
            const isActive = selectedStyle === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedStyle(s.id)}
                className="rounded-[16px] border-2 p-3 text-left transition"
                style={{
                  borderColor: isActive
                    ? "var(--ac-green-border, #6b9e78)"
                    : "var(--bd-2)",
                  backgroundColor: isActive
                    ? "var(--ac-green-bg, #edf5ef)"
                    : "var(--sf-2)",
                }}
              >
                {/* Color swatches */}
                <div className="mb-2 flex gap-1.5">
                  <span
                    className="inline-block h-4 w-4 rounded-full"
                    style={{ backgroundColor: s.color_primary }}
                  />
                  <span
                    className="inline-block h-4 w-4 rounded-full"
                    style={{ backgroundColor: s.color_accent }}
                  />
                </div>
                <p
                  className="text-sm font-semibold"
                  style={{
                    color: isActive
                      ? "var(--ac-green-text, #3d6b4a)"
                      : "var(--tx-1)",
                  }}
                >
                  {s.name_zh}
                </p>
                <p className="mt-0.5 text-xs text-[var(--tx-5)]">
                  {s.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content toggles */}
      <div className="mb-6">
        <h3 className="mb-3 text-sm font-semibold text-[var(--tx-2)]">包含内容</h3>
        <div className="flex flex-wrap gap-2">
          {CONTENT_TOGGLES.map(({ key, label }) => {
            const active = toggles[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => flipToggle(key)}
                className="rounded-full border px-3.5 py-1.5 text-sm font-medium transition"
                style={{
                  borderColor: active
                    ? "var(--ac-green-border, #6b9e78)"
                    : "var(--bd-2)",
                  backgroundColor: active
                    ? "var(--ac-green-bg, #edf5ef)"
                    : "var(--sf-2)",
                  color: active
                    ? "var(--ac-green-text, #3d6b4a)"
                    : "var(--tx-4)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Generate button */}
      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-primary rounded-full px-6 py-2.5 text-sm font-semibold"
          onClick={() => void handleGeneratePreview()}
          disabled={!selectedStyle}
        >
          生成预览
        </button>
      </div>
    </>
  );

  // ── Generating screen ─────────────────────────────────────
  const generatingScreen = (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[var(--bd-3)] border-t-[var(--brand-sage)]" />
      <p className="text-sm text-[var(--tx-4)]">正在生成精美笔记...</p>
    </div>
  );

  // ── Preview screen ────────────────────────────────────────
  const previewScreen = (
    <>
      {/* Meta bar */}
      {previewMeta && (
        <div className="mb-3 flex items-center gap-4 text-xs text-[var(--tx-5)]">
          <span>{previewMeta.title}</span>
          <span>{previewMeta.page_count} 页</span>
          <span>{previewMeta.concept_count} 个概念</span>
        </div>
      )}

      {/* Preview iframe */}
      <div
        className="overflow-hidden rounded-[16px] border border-[var(--bd-2)]"
        style={{ height: "min(60vh, 520px)" }}
      >
        <iframe
          srcDoc={previewHtml}
          title="笔记预览"
          className="h-full w-full border-0"
          sandbox="allow-same-origin"
        />
      </div>

      {/* Action buttons */}
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          className="rounded-full border border-[var(--bd-2)] bg-[var(--sf-1)] px-4 py-2 text-sm text-[var(--tx-4)] transition hover:bg-[var(--sf-3)]"
          onClick={() => setPhase("config")}
        >
          返回修改
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-full border border-[var(--bd-2)] bg-[var(--sf-1)] px-4 py-2 text-sm font-medium text-[var(--tx-2)] transition hover:bg-[var(--sf-3)]"
            onClick={() => void handleDownload("html")}
            disabled={phase === "downloading"}
          >
            下载 HTML
          </button>
          <button
            type="button"
            className="btn btn-primary rounded-full px-5 py-2 text-sm font-semibold"
            onClick={() => void handleDownload("pdf")}
            disabled={phase === "downloading"}
          >
            下载 PDF
          </button>
        </div>
      </div>
    </>
  );

  // ── Downloading screen ────────────────────────────────────
  const downloadingScreen = (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[var(--bd-3)] border-t-[var(--brand-sage)]" />
      <p className="text-sm text-[var(--tx-4)]">正在准备下载...</p>
    </div>
  );

  // ── Error screen ──────────────────────────────────────────
  const errorScreen = (
    <div className="flex flex-col items-center justify-center py-16">
      <div
        className="mb-4 rounded-[16px] px-5 py-3 text-sm"
        style={{
          backgroundColor: "var(--ac-red-bg, #fef2f2)",
          color: "var(--ac-red-text, #b91c1c)",
          border: "1px solid var(--ac-red-border, #fca5a5)",
        }}
      >
        {errorMsg || "发生未知错误"}
      </div>
      <button
        type="button"
        className="rounded-full border border-[var(--bd-2)] bg-[var(--sf-1)] px-4 py-2 text-sm text-[var(--tx-4)] transition hover:bg-[var(--sf-3)]"
        onClick={() => setPhase("config")}
      >
        返回修改
      </button>
    </div>
  );

  // ── Phase → content mapping ───────────────────────────────
  const phaseContent: Record<Phase, React.ReactNode> = {
    config: configScreen,
    generating: generatingScreen,
    preview: previewScreen,
    downloading: downloadingScreen,
    error: errorScreen,
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="导出学习笔记"
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[24px] border border-[var(--bd-2)] bg-[var(--sf-1)]"
        style={{ boxShadow: "var(--sh-panel, 0 24px 60px rgba(94,72,46,0.22))" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--bd-3)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--tx-1)]">
              导出学习笔记
            </h2>
            {documentName && (
              <p className="mt-0.5 truncate text-xs text-[var(--tx-5)]">
                {documentName}
              </p>
            )}
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--tx-5)] transition hover:bg-[var(--sf-3)] hover:text-[var(--tx-3)]"
            onClick={onClose}
            aria-label="关闭"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {phaseContent[phase]}
        </div>
      </div>
    </div>
  );
}
