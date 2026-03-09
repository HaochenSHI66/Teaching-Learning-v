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
  onOpen: () => void;
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
  onOpen,
  onCollapse,
  loading,
  disabled,
  documentName,
  viewMode,
  onViewModeChange,
  saveStateLabel,
}: NotebookWindowProps) {
  if (!documentName && !open) {
    return null;
  }

  return (
    <>
      {!open ? (
        <button
          className="fixed right-5 top-1/2 z-30 -translate-y-1/2 rounded-[22px] border border-[#d8c6aa] bg-[#fffaf1]/96 px-4 py-5 shadow-[0_24px_50px_rgba(122,98,66,0.18)] backdrop-blur-xl"
          data-testid="notebook-dock"
          onClick={onOpen}
          type="button"
        >
          <span className="block text-[10px] uppercase tracking-[0.28em] text-[#9d876f]">Notebook</span>
          <span className="mt-2 block text-sm font-semibold text-[#4a3a2b] [writing-mode:vertical-rl]">
            笔记本
          </span>
        </button>
      ) : null}

      {open ? (
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
      ) : null}
    </>
  );
}
