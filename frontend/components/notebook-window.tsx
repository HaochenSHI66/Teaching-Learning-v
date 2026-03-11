"use client";

import { NoteEditor } from "@/components/note-editor";

type NotebookWindowProps = {
  open: boolean;
  markdown: string;
  onChange: (value: string) => void;
  onFormat: () => void;
  onAIOrganize: () => void;
  onAIPolish: (content: string) => Promise<string>;
  onExport: () => void;
  onCollapse: () => void;
  loading: boolean;
  disabled: boolean;
  documentName?: string;
  viewMode: "edit" | "preview";
  onViewModeChange: (mode: "edit" | "preview") => void;
  saveStateLabel?: string;
};

export function NotebookWindow({
  open,
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
          disabled={disabled}
          documentName={documentName}
          loading={loading}
          markdown={markdown}
          onAIOrganize={onAIOrganize}
          onAIPolish={onAIPolish}
          onChange={onChange}
          onCollapse={onCollapse}
          onExport={onExport}
          onFormat={onFormat}
          onViewModeChange={onViewModeChange}
          saveStateLabel={saveStateLabel}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
}
