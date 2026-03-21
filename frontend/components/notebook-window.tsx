"use client";

import { NoteEditor } from "@/components/note-editor";
import type { Slide } from "@/lib/api";

type NotebookWindowProps = {
  open: boolean;
  slides: Slide[];
  currentSlideIndex: number;
  documentId: string;
  onCollapse: () => void;
  loading: boolean;
  disabled: boolean;
  documentName?: string;
  viewMode: "edit" | "preview";
  onViewModeChange: (mode: "edit" | "preview") => void;
  saveStateLabel?: string;
  /** Legacy props — passed through for backward compat */
  markdown?: string;
  onChange?: (value: string) => void;
  onFormat?: () => void;
  onAIOrganize?: () => void;
  onAIPolish?: (content: string) => Promise<string>;
  onExport?: () => void;
};

export function NotebookWindow({
  open,
  slides,
  currentSlideIndex,
  documentId,
  onCollapse,
  loading,
  disabled,
  documentName,
  viewMode,
  onViewModeChange,
  saveStateLabel,
  markdown,
  onChange,
  onFormat,
  onAIOrganize,
  onAIPolish,
  onExport,
}: NotebookWindowProps) {
  if (!documentName || !open) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed inset-y-[76px] right-5 z-30 flex w-[min(560px,calc(100vw-2rem))] justify-end xl:inset-y-[92px]"
      data-testid="notebook-window"
    >
      <div className="pointer-events-auto h-full w-full">
        <NoteEditor
          slides={slides}
          currentSlideIndex={currentSlideIndex}
          documentId={documentId}
          disabled={disabled}
          documentName={documentName}
          loading={loading}
          onAIPolish={onAIPolish}
          onCollapse={onCollapse}
          onViewModeChange={onViewModeChange}
          saveStateLabel={saveStateLabel}
          viewMode={viewMode}
          markdown={markdown}
          onChange={onChange}
          onFormat={onFormat}
          onAIOrganize={onAIOrganize}
          onExport={onExport}
        />
      </div>
    </div>
  );
}
