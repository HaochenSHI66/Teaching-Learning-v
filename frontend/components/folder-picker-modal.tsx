"use client";

import { useEffect, useRef, useState } from "react";

import { createFolder as createFolderRequest, type FolderGroup } from "@/lib/api";

type FolderPickerModalProps = {
  isOpen: boolean;
  filename: string;
  folders: FolderGroup[];
  initialFolderId?: string | null;
  mode: "upload" | "move";
  onConfirm: (folderId: string | null) => void;
  onClose: () => void;
};

export function FolderPickerModal({
  isOpen,
  filename,
  folders,
  initialFolderId,
  mode,
  onConfirm,
  onClose,
}: FolderPickerModalProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(initialFolderId ?? null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localFolders, setLocalFolders] = useState<FolderGroup[]>(folders);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync folders from parent when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalFolders(folders);
      setSelectedFolderId(initialFolderId ?? null);
      setNewFolderOpen(false);
      setNewFolderName("");
      setSubmitting(false);
    }
  }, [isOpen, folders, initialFolderId]);

  // Focus new folder input when it opens
  useEffect(() => {
    if (newFolderOpen) {
      newFolderInputRef.current?.focus();
    }
  }, [newFolderOpen]);

  // All selectable items: named folders + uncategorized sentinel
  const allItems: Array<{ id: string | null; label: string }> = [
    ...localFolders.map((f) => ({ id: f.id, label: f.name })),
    { id: null, label: "未归类" },
  ];

  function focusedIndex(): number {
    return allItems.findIndex((item) => item.id === selectedFolderId);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key === "Enter" && !newFolderOpen) {
      void handleConfirm();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(focusedIndex() + 1, allItems.length - 1);
      setSelectedFolderId(allItems[next]?.id ?? null);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = Math.max(focusedIndex() - 1, 0);
      setSelectedFolderId(allItems[prev]?.id ?? null);
    }
  }

  async function handleCreateFolder() {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const result = await createFolderRequest({ name: trimmed });
      const created: FolderGroup = {
        ...result.folder,
        documents: [],
      };
      setLocalFolders((prev) => [...prev, created]);
      setSelectedFolderId(created.id);
      setNewFolderOpen(false);
      setNewFolderName("");
    } catch {
      // silently ignore; user can retry
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    onConfirm(selectedFolderId);
  }

  if (!isOpen) return null;

  const confirmLabel = mode === "upload" ? "确认上传" : "确认移动";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={mode === "upload" ? "选择上传目标文件夹" : "选择移动目标文件夹"}
    >
      <div className="w-[320px] rounded-[24px] border border-[#e0d1bc] bg-[#fffaf2] shadow-[0_24px_60px_rgba(94,72,46,0.22)]">
        {/* Header */}
        <div className="border-b border-[#ecdec8] px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-base">📄</span>
            <p className="truncate text-sm font-semibold text-[#3f3125]" title={filename}>
              {filename}
            </p>
          </div>
          <p className="mt-1 text-xs text-[#8c765f]">选择归属文件夹</p>
        </div>

        {/* Folder list */}
        <div ref={listRef} className="max-h-[260px] overflow-y-auto px-3 py-2">
          {allItems.map((item) => (
            <button
              key={item.id ?? "__uncategorized__"}
              type="button"
              className={`flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2 text-left text-sm transition ${
                selectedFolderId === item.id
                  ? "bg-[#f2e7d2] text-[#463829]"
                  : "text-[#5f4a33] hover:bg-[#fdf3e4]"
              }`}
              onClick={() => setSelectedFolderId(item.id)}
            >
              <span
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 transition ${
                  selectedFolderId === item.id
                    ? "border-[#a07844] bg-[#a07844]"
                    : "border-[#c4a97a] bg-transparent"
                }`}
              />
              <span className="shrink-0">{item.id === null ? "📂" : "📁"}</span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}

          {/* Divider before uncategorized was last, now show new folder row */}
          <div className="my-1 border-t border-[#ecdec8]" />

          {newFolderOpen ? (
            <div className="flex items-center gap-2 rounded-[14px] bg-[#fdf3e4] px-3 py-2">
              <input
                ref={newFolderInputRef}
                className="min-w-0 flex-1 bg-transparent text-sm text-[#3f3125] outline-none placeholder:text-[#b09a7e]"
                placeholder="新文件夹名称"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.stopPropagation(); void handleCreateFolder(); }
                  if (e.key === "Escape") { e.stopPropagation(); setNewFolderOpen(false); setNewFolderName(""); }
                }}
                disabled={creating}
              />
              <button
                type="button"
                className="shrink-0 rounded-full bg-[#a07844] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                onClick={() => void handleCreateFolder()}
                disabled={creating || !newFolderName.trim()}
              >
                {creating ? "创建中…" : "创建"}
              </button>
              <button
                type="button"
                className="shrink-0 text-[11px] text-[#8c765f] hover:text-[#5f4a33]"
                onClick={() => { setNewFolderOpen(false); setNewFolderName(""); }}
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-[14px] px-3 py-2 text-left text-sm text-[#8c765f] transition hover:bg-[#fdf3e4] hover:text-[#5f4a33]"
              onClick={() => setNewFolderOpen(true)}
            >
              <span className="text-base leading-none">+</span>
              <span>新建文件夹…</span>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[#ecdec8] px-5 py-3">
          <button
            type="button"
            className="rounded-full border border-[#dcc9af] bg-[#fffaf2] px-4 py-2 text-sm text-[#7a6655] transition hover:border-[#c4a97a] hover:bg-[#f5ede0]"
            onClick={onClose}
          >
            跳过
          </button>
          <button
            type="button"
            className="rounded-full bg-[#a07844] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#8c6636] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handleConfirm()}
            disabled={submitting}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
