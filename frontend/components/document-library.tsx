"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ParseProgressBar } from "@/components/parse-progress-bar";
import { FolderPickerModal } from "@/components/folder-picker-modal";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  defaultDropAnimationSideEffects,
  type DragCancelEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { prefetchDocument, type DocumentLibrary, type FolderDocumentItem, type FolderGroup } from "@/lib/api";

type GenerationProgress = { current: number; total: number } | null;
type SortMode = "manual" | "name" | "date";

const SORT_MODES: SortMode[] = ["manual", "name", "date"];
const naturalCollator = new Intl.Collator("zh", { numeric: true, sensitivity: "base" });

function sortedDocuments(docs: FolderDocumentItem[], mode: SortMode): FolderDocumentItem[] {
  if (mode === "manual") return docs;
  return [...docs].sort((a, b) =>
    mode === "name"
      ? naturalCollator.compare(a.filename, b.filename)
      : b.created_at.localeCompare(a.created_at),
  );
}

type DocumentLibraryProps = {
  library: DocumentLibrary;
  activeDocumentId: string | null;
  loading: boolean;
  /** True while a newly-uploaded document is processing in the background. Only disables the upload button. */
  backgroundProcessing: boolean;
  generationDocId: string | null;
  generationProgress: GenerationProgress;
  onUpload: (file: File, folderId?: string | null) => Promise<void>;
  onSelectDocument: (documentId: string) => Promise<void>;
  onDeleteDocument: (documentId: string, filename: string) => Promise<void>;
  onDeleteFolder: (folderId: string, name: string) => Promise<void>;
  onCreateFolder: (name: string) => Promise<void>;
  onMoveDocument: (documentId: string, targetFolderId: string | null, targetIndex: number) => Promise<void>;
  onRegenerateDocument: (documentId: string) => Promise<void>;
  onAbortGeneration: () => void;
};

type GroupDescriptor = {
  id: string | null;
  name: string;
  documents: FolderDocumentItem[];
};

function documentDragId(documentId: string) {
  return `doc:${documentId}`;
}

function groupTargetId(folderId: string | null) {
  return folderId ? `folder:${folderId}` : "folder:uncategorized";
}

function groupSectionId(folderId: string | null) {
  return folderId ? `folder-section:${folderId}` : "folder-section:uncategorized";
}

function getDocumentById(library: DocumentLibrary, documentId: string): FolderDocumentItem | null {
  for (const group of [...library.folders, library.uncategorized]) {
    const found = group.documents.find((doc) => doc.id === documentId);
    if (found) return found;
  }
  return null;
}

function findGroupForDocument(library: DocumentLibrary, documentId: string): GroupDescriptor | null {
  for (const folder of library.folders) {
    if (folder.documents.some((doc) => doc.id === documentId)) {
      return { id: folder.id, name: folder.name, documents: folder.documents };
    }
  }
  if (library.uncategorized.documents.some((doc) => doc.id === documentId)) {
    return {
      id: null,
      name: library.uncategorized.name,
      documents: library.uncategorized.documents,
    };
  }
  return null;
}

const SortableDocumentCard = memo(function SortableDocumentCard({
  document,
  activeDocumentId,
  loading,
  generationDocId,
  generationProgress,
  onSelectDocument,
  onDeleteDocument,
  onRegenerateDocument,
  onAbortGeneration,
  onMoveDocument,
  folders,
  dragState,
  sortEnabled,
  selectMode,
  selected,
  onToggleSelect,
}: {
  document: FolderDocumentItem;
  activeDocumentId: string | null;
  loading: boolean;
  generationDocId: string | null;
  generationProgress: GenerationProgress;
  onSelectDocument: (documentId: string) => Promise<void>;
  onDeleteDocument: (documentId: string, filename: string) => Promise<void>;
  onRegenerateDocument: (documentId: string) => Promise<void>;
  onAbortGeneration: () => void;
  onMoveDocument: (documentId: string, targetFolderId: string | null, targetIndex: number) => Promise<void>;
  folders: FolderGroup[];
  dragState?: "idle" | "source";
  sortEnabled?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (docId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: documentDragId(document.id),
    disabled: sortEnabled === false,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(transform ? { willChange: "transform" } : {}),
  };
  const resolvedDragState = dragState ?? "idle";
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    globalThis.document.addEventListener("mousedown", handleClickOutside);
    return () => globalThis.document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const isGeneratingThis = generationDocId === document.id;

  const statusDot = (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${
        document.status === "ready"
          ? "bg-[#7aaa5a]"
          : document.status === "processing"
            ? "bg-[#d4a543]"
            : "bg-[#c4594b]"
      }`}
      title={document.status}
    />
  );

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        data-testid={`document-item-${document.filename}`}
        data-drag-state={resolvedDragState}
        className={`group relative flex flex-col rounded-[14px] border transition-all duration-150 cursor-pointer ${
          activeDocumentId === document.id
            ? "border-[var(--bd-4)] bg-[var(--gd-active-doc)] shadow-[var(--sh-sm)] ring-2 ring-[var(--brand-amber)]/25"
            : "border-[var(--bd-2)] bg-[var(--sf-1)] hover:border-[var(--bd-4)] hover:bg-[var(--sf-3)] hover:shadow-[var(--sh-sm)] active:scale-[0.97] active:bg-[var(--sf-4)]"
        } ${
          isDragging || resolvedDragState === "source"
            ? "document-card-source opacity-50"
            : "document-card-idle"
        }`}
        onClick={(e) => {
          // Don't trigger if clicking menu or drag handle
          if ((e.target as HTMLElement).closest('[aria-label="更多操作"], [aria-label="拖拽排序"]')) return;
          if (!loading) void onSelectDocument(document.id);
        }}
        {...attributes}
      >
        {/* Main row */}
        <div className="flex min-h-[32px] min-w-0 items-center gap-1 px-1 py-1">
          {/* Select checkbox OR drag handle */}
          {selectMode ? (
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={(e) => { e.stopPropagation(); onToggleSelect?.(document.id); }}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 shrink-0 cursor-pointer rounded"
              style={{ accentColor: "var(--brand-sage)" }}
            />
          ) : sortEnabled !== false ? (
            <button
              ref={setActivatorNodeRef}
              {...listeners}
              type="button"
              tabIndex={-1}
              className="flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-transparent transition hover:text-[var(--tx-6)] group-hover:text-[var(--tx-6)] active:cursor-grabbing"
              aria-label="拖拽排序"
            >
              <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                <circle cx="2.5" cy="2.5" r="1.5" />
                <circle cx="7.5" cy="2.5" r="1.5" />
                <circle cx="2.5" cy="7" r="1.5" />
                <circle cx="7.5" cy="7" r="1.5" />
                <circle cx="2.5" cy="11.5" r="1.5" />
                <circle cx="7.5" cy="11.5" r="1.5" />
              </svg>
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}

          {/* File icon */}
          <span className="shrink-0 text-sm leading-none">📄</span>

          {/* Filename */}
          <span
            className="min-w-0 flex-1 text-left text-[13px] leading-snug break-all text-[var(--tx-2)] group-hover:text-[var(--tx-1)] group-hover:underline decoration-[var(--bd-4)] underline-offset-2 transition-colors"
            title={document.filename}
            onMouseEnter={() => prefetchDocument(document.id)}
            onTouchStart={() => prefetchDocument(document.id)}
          >
            {document.filename}
          </span>

          {/* Page count */}
          <span className="shrink-0 text-[11px] text-[var(--tx-5)]">{document.page_count}p</span>

          {/* Status dot / loading spinner */}
          {loading && activeDocumentId === document.id ? (
            <svg className="h-3 w-3 shrink-0 animate-spin text-[var(--brand-amber)]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          ) : statusDot}

          {/* ⋯ menu */}
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--tx-6)] transition hover:bg-[var(--sf-4)] hover:text-[var(--tx-3)]"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              aria-label="更多操作"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="3" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="8" cy="13" r="1.5" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-7 z-30 min-w-[136px] rounded-[14px] border border-[var(--bd-2)] bg-[var(--sf-1)] py-1 shadow-[var(--sh-popup)]">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--tx-2)] hover:bg-[var(--sf-4)]"
                  onClick={() => { setMenuOpen(false); void onSelectDocument(document.id); }}
                >
                  打开 / 查看
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--tx-2)] hover:bg-[var(--sf-4)] disabled:opacity-40"
                  disabled={loading || document.status !== "ready"}
                  onClick={() => { setMenuOpen(false); void onRegenerateDocument(document.id); }}
                >
                  生成解析
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--tx-2)] hover:bg-[var(--sf-4)]"
                  onClick={() => { setMenuOpen(false); setShowMovePicker(true); }}
                >
                  移动到文件夹…
                </button>
                <div className="my-1 border-t border-[var(--bd-3)]" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#9a5e4e] hover:bg-[var(--ac-red-bg)]"
                  disabled={loading}
                  onClick={() => { setMenuOpen(false); void onDeleteDocument(document.id, document.filename); }}
                >
                  删除
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Inline generation progress bar */}
        {(document.status === "processing" || isGeneratingThis) && (
          <div className="border-t border-[var(--bd-3)] px-3 pb-2 pt-1.5">
            <ParseProgressBar
              current={isGeneratingThis ? (generationProgress?.current ?? 0) : 0}
              total={isGeneratingThis ? (generationProgress?.total ?? 0) : 0}
              filename={document.filename}
            />
            {isGeneratingThis && (
              <div className="mt-1.5 flex justify-end">
                <button
                  className="text-[11px] text-[#9a5e4e] underline hover:no-underline"
                  onClick={onAbortGeneration}
                  type="button"
                >
                  终止解析
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Move-to-folder picker */}
      <FolderPickerModal
        isOpen={showMovePicker}
        filename={document.filename}
        folders={folders}
        initialFolderId={document.folder_id}
        mode="move"
        onConfirm={(folderId) => {
          setShowMovePicker(false);
          // Determine target index: append to target folder's end
          void onMoveDocument(document.id, folderId, Number.MAX_SAFE_INTEGER);
        }}
        onClose={() => setShowMovePicker(false)}
      />
    </>
  );
});

function FolderDropzone({
  folderId,
  name,
  documents,
  children,
  isActiveDrop,
  onDeleteFolder,
}: {
  folderId: string | null;
  name: string;
  documents: FolderDocumentItem[];
  children: ReactNode;
  isActiveDrop?: boolean;
  onDeleteFolder?: (folderId: string, name: string) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { isOver, setNodeRef } = useDroppable({
    id: groupSectionId(folderId),
  });

  return (
    <section
      ref={setNodeRef}
      data-testid={folderId ? `folder-dropzone-${name}` : "uncategorized-dropzone"}
      data-drag-over={isOver ? "true" : "false"}
      data-drop-flash={isActiveDrop ? "true" : "false"}
      className={`document-dropzone rounded-[24px] border px-3 py-3 transition ${
        isOver
          ? "document-dropzone-over border-[var(--bd-4)] bg-[var(--sf-1)]"
          : isActiveDrop
            ? "document-dropzone-flash border-[var(--bd-4)] bg-[var(--sf-1)]"
            : "border-[var(--bd-2)] bg-[var(--sf-1)]"
      }`}
    >
      <div className={`flex items-center justify-between ${collapsed ? "" : "mb-3"}`}>
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setCollapsed((v) => !v)}
          type="button"
        >
          <svg
            className={`h-3 w-3 shrink-0 text-[var(--tx-4)] transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-[var(--tx-2)]">{name}</p>
            <p className="text-[11px] text-[var(--tx-4)]">{documents.length} 份文档</p>
          </div>
        </button>
        {folderId && onDeleteFolder && (
          <button
            className="btn btn-outline !rounded-full !px-2.5 !py-1 text-[11px] !text-[#9a5e4e] hover:!border-[var(--ac-red-border)] hover:!bg-[var(--ac-red-bg)]"
            onClick={() => void onDeleteFolder(folderId, name)}
            type="button"
          >
            删除
          </button>
        )}
      </div>
      {!collapsed && children}
    </section>
  );
}

function FolderShelfChip({
  folderId,
  name,
  isActiveDrop,
}: {
  folderId: string | null;
  name: string;
  isActiveDrop?: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: groupTargetId(folderId),
  });

  return (
    <div
      ref={setNodeRef}
      data-testid={folderId ? `folder-target-${name}` : "folder-target-uncategorized"}
      data-drag-over={isOver ? "true" : "false"}
      data-drop-flash={isActiveDrop ? "true" : "false"}
      className={`document-folder-chip shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
        isOver
          ? "document-folder-chip-over border-[var(--bd-4)] bg-[var(--sf-3)] text-[var(--tx-3)]"
          : isActiveDrop
            ? "document-folder-chip-flash border-[var(--bd-4)] bg-[var(--sf-3)] text-[var(--tx-3)]"
            : "border-[var(--bd-1)] bg-[var(--sf-1)] text-[var(--tx-4)]"
      }`}
    >
      {name}
    </div>
  );
}

function DragPreviewCard({ document }: { document: FolderDocumentItem }) {
  return (
    <div
      className="document-drag-overlay w-[280px] rounded-[24px] border border-[var(--bd-4)] bg-[var(--gd-drag-overlay)] p-3 shadow-[var(--sh-panel)]"
      data-testid="document-drag-overlay"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--tx-1)]">{document.filename}</p>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--tx-4)]">
            <span className="rounded-full bg-[var(--sf-3)] px-2 py-1">{document.page_count} 页</span>
            <span className="rounded-full bg-[var(--sf-4)] px-2 py-1 text-[#607253]">{document.status}</span>
          </div>
        </div>
        <span className="rounded-full border border-[var(--bd-2)] bg-[var(--sf-1)] px-2 py-1 text-[10px] font-medium text-[var(--tx-5)]">
          拖拽中
        </span>
      </div>
    </div>
  );
}

export function DocumentLibrary({
  library,
  activeDocumentId,
  loading,
  backgroundProcessing,
  generationDocId,
  generationProgress,
  onUpload,
  onSelectDocument,
  onDeleteDocument,
  onCreateFolder,
  onDeleteFolder,
  onMoveDocument,
  onRegenerateDocument,
  onAbortGeneration,
}: DocumentLibraryProps) {
  const [folderDraftOpen, setFolderDraftOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<{ total: number; done: number; current: string } | null>(null);
  const [batchGenQueue, setBatchGenQueue] = useState<{ total: number; done: number; current: string } | null>(null);
  const batchGenAbortRef = useRef(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [activeDragDocumentId, setActiveDragDocumentId] = useState<string | null>(null);
  const [activeDropGroupId, setActiveDropGroupId] = useState<string | null>(null);
  const [flashGroupId, setFlashGroupId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const libraryRef = useRef(library);
  useEffect(() => { libraryRef.current = library; }, [library]);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const groups = useMemo<GroupDescriptor[]>(
    () => [
      ...library.folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        documents: sortedDocuments(folder.documents, sortMode),
      })),
      {
        id: null,
        name: library.uncategorized.name,
        documents: sortedDocuments(library.uncategorized.documents, sortMode),
      },
    ],
    [library, sortMode],
  );

  async function handleCreateFolder() {
    const trimmed = folderName.trim();
    if (!trimmed) return;
    await onCreateFolder(trimmed);
    setFolderName("");
    setFolderDraftOpen(false);
  }

  function handleFilesSelected(files: File[]) {
    if (showFolderPicker || files.length === 0) return;
    setPendingUploadFiles(files);
    setShowFolderPicker(true);
  }

  function handleFolderPickerDone(folderId: string | null) {
    setShowFolderPicker(false);
    const files = pendingUploadFiles;
    setPendingUploadFiles([]);
    if (files.length === 0) return;

    // Queue upload: process files one by one
    void (async () => {
      const total = files.length;
      setUploadQueue({ total, done: 0, current: files[0].name });
      for (let i = 0; i < total; i++) {
        setUploadQueue({ total, done: i, current: files[i].name });
        try {
          await onUpload(files[i], folderId);
        } catch (err) {
          console.error(`Upload failed for ${files[i].name}:`, err);
        }
      }
      setUploadQueue(null);
    })();
  }

  async function handleBatchGenerateSelected() {
    const allDocs = [
      ...library.folders.flatMap((f) => f.documents),
      ...library.uncategorized.documents,
    ].filter((d) => d.status === "ready" && selectedDocIds.has(d.id));

    if (allDocs.length === 0) return;
    batchGenAbortRef.current = false;
    setSelectMode(false);
    const total = allDocs.length;

    for (let i = 0; i < total; i++) {
      if (batchGenAbortRef.current) break;
      const doc = allDocs[i];
      setBatchGenQueue({ total, done: i, current: doc.filename });
      try {
        await onRegenerateDocument(doc.id);
      } catch (err) {
        console.error(`Batch gen failed for ${doc.filename}:`, err);
      }
    }
    setBatchGenQueue(null);
    setSelectedDocIds(new Set());
  }

  function toggleDocSelect(docId: string) {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }

  function toggleSelectAll() {
    const allDocs = [
      ...library.folders.flatMap((f) => f.documents),
      ...library.uncategorized.documents,
    ].filter((d) => d.status === "ready");
    if (selectedDocIds.size === allDocs.length) {
      setSelectedDocIds(new Set());
    } else {
      setSelectedDocIds(new Set(allDocs.map((d) => d.id)));
    }
  }

  function setFlashTarget(targetFolderId: string | null) {
    const flashId = targetFolderId ?? "__uncategorized__";
    setFlashGroupId(flashId);
    window.setTimeout(() => {
      setFlashGroupId((current) => (current === flashId ? null : current));
    }, 650);
  }

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const activeId = String(event.active.id);
    if (!activeId.startsWith("doc:")) return;
    setActiveDragDocumentId(activeId.replace("doc:", ""));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : "";
    if (!overId) {
      setActiveDropGroupId(null);
      return;
    }
    if (overId.startsWith("doc:")) {
      const overDocumentId = overId.replace("doc:", "");
      const targetGroup = findGroupForDocument(libraryRef.current, overDocumentId);
      setActiveDropGroupId(targetGroup?.id ?? "__uncategorized__");
      return;
    }
    if (overId.startsWith("folder:") || overId.startsWith("folder-section:")) {
      const normalizedOverId = overId.replace("folder-section:", "folder:");
      setActiveDropGroupId(
        normalizedOverId === "folder:uncategorized" ? "__uncategorized__" : normalizedOverId.replace("folder:", ""),
      );
      return;
    }
    setActiveDropGroupId(null);
  }, []);

  function resolveDrop(event: DragEndEvent): { documentId: string; targetFolderId: string | null; targetIndex: number } | null {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    if (!activeId.startsWith("doc:") || !overId) return null;
    const documentId = activeId.replace("doc:", "");

            if (overId.startsWith("doc:")) {
      const overDocumentId = overId.replace("doc:", "");
      const targetGroup = findGroupForDocument(library, overDocumentId);
      if (!targetGroup) return null;
      const targetIndex = targetGroup.documents.findIndex((doc) => doc.id === overDocumentId);
      return { documentId, targetFolderId: targetGroup.id, targetIndex };
    }

    if (overId.startsWith("folder:") || overId.startsWith("folder-section:")) {
      const normalizedOverId = overId.replace("folder-section:", "folder:");
      const targetFolderId =
        normalizedOverId === "folder:uncategorized" ? null : normalizedOverId.replace("folder:", "");
      const targetGroup =
        groups.find((group) => group.id === targetFolderId) ??
        groups.find((group) => group.id === null);
      if (!targetGroup) return null;
      return {
        documentId,
        targetFolderId,
        targetIndex: targetGroup.documents.length,
      };
    }

    return null;
  }

  async function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const move = resolveDrop(event);
    setActiveDragDocumentId(null);
    setActiveDropGroupId(null);
    if (!move) return;
    const sourceDocument = getDocumentById(library, move.documentId);
    if (!sourceDocument) return;
    if (sourceDocument.folder_id === move.targetFolderId && sourceDocument.sort_order === move.targetIndex) {
      return;
    }
    await onMoveDocument(move.documentId, move.targetFolderId, move.targetIndex);
    setFlashTarget(move.targetFolderId);
    if (activeId.startsWith("doc:")) {
      setActiveDragDocumentId(null);
    }
  }

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setActiveDragDocumentId(null);
    setActiveDropGroupId(null);
  }, []);

  const activeDragDocument = activeDragDocumentId ? getDocumentById(library, activeDragDocumentId) : null;

  return (
    <div className="flex h-full flex-col p-3">
      <label className={`btn btn-primary mb-3 inline-flex cursor-pointer text-xs ${backgroundProcessing || uploadQueue ? "opacity-70" : ""}`}>
        <span>
          {uploadQueue
            ? `上传中 ${uploadQueue.done + 1}/${uploadQueue.total}`
            : backgroundProcessing
              ? "处理中…"
              : "上传 PDF/图片"}
        </span>
        <input
          accept=".pdf,image/png,image/jpeg,image/webp"
          className="hidden"
          disabled={backgroundProcessing || !!uploadQueue}
          multiple
          onChange={(event) => {
            const fileList = event.target.files;
            if (fileList && fileList.length > 0) {
              handleFilesSelected(Array.from(fileList));
            }
            event.currentTarget.value = "";
          }}
          type="file"
        />
      </label>
      {/* Batch generate controls */}
      {batchGenQueue ? (
        <div className="mb-3 rounded-[14px] border border-[var(--bd-2)] bg-[var(--sf-1)] px-3 py-2">
          <div className="flex items-center justify-between text-[11px] text-[var(--tx-4)]">
            <span className="truncate max-w-[160px]">{batchGenQueue.current}</span>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              <span className="tabular-nums">{batchGenQueue.done + 1}/{batchGenQueue.total}</span>
              <button
                className="rounded px-1.5 py-0.5 text-[10px] border border-[var(--bd-2)] hover:bg-[var(--sf-3)] transition-colors"
                onClick={() => { batchGenAbortRef.current = true; }}
                type="button"
              >
                停止
              </button>
            </div>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--sf-4)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--brand-sage)] to-[var(--brand-amber)] transition-all duration-500"
              style={{ width: `${((batchGenQueue.done + 1) / batchGenQueue.total) * 100}%` }}
            />
          </div>
        </div>
      ) : selectMode ? (
        <div className="mb-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-[12px] text-[var(--tx-3)]">
            <button
              className="underline underline-offset-2 text-[var(--tx-4)] hover:text-[var(--tx-2)] transition-colors"
              onClick={toggleSelectAll}
              type="button"
            >
              {selectedDocIds.size === [...library.folders.flatMap((f) => f.documents), ...library.uncategorized.documents].filter((d) => d.status === "ready").length ? "取消全选" : "全选"}
            </button>
            <span className="text-[var(--tx-5)]">已选 {selectedDocIds.size} 篇</span>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-primary flex-1 !py-1.5 text-[11px]"
              disabled={selectedDocIds.size === 0 || loading || !!generationDocId}
              onClick={() => void handleBatchGenerateSelected()}
              type="button"
            >
              生成解析 ({selectedDocIds.size})
            </button>
            <button
              className="btn btn-outline !py-1.5 !px-3 text-[11px]"
              onClick={() => { setSelectMode(false); setSelectedDocIds(new Set()); }}
              type="button"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn-outline mb-3 w-full text-xs"
          disabled={loading || !!generationDocId || !!uploadQueue}
          onClick={() => setSelectMode(true)}
          type="button"
        >
          批量生成解析
        </button>
      )}

      {/* Upload queue progress */}
      {uploadQueue && (
        <div className="mb-3 rounded-[14px] border border-[var(--bd-2)] bg-[var(--sf-1)] px-3 py-2">
          <div className="flex items-center justify-between text-[11px] text-[var(--tx-4)]">
            <span className="truncate max-w-[180px]">{uploadQueue.current}</span>
            <span className="tabular-nums shrink-0 ml-2">{uploadQueue.done + 1}/{uploadQueue.total}</span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--sf-4)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--brand-sage)] to-[var(--brand-amber)] transition-all duration-500"
              style={{ width: `${((uploadQueue.done + 1) / uploadQueue.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="mb-3 rounded-[18px] border border-[var(--bd-2)] bg-[var(--sf-1)] p-2.5">
        {folderDraftOpen ? (
          <div className="flex flex-col gap-2">
            <input
              className="rounded-[14px] border border-[var(--bd-1)] bg-[var(--sf-input)] px-3 py-2 text-sm text-[var(--tx-2)] outline-none focus:border-[var(--bd-4)]"
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="文件夹名称"
              value={folderName}
            />
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1 !py-2 text-[11px]" onClick={() => void handleCreateFolder()} type="button">
                创建文件夹
              </button>
              <button
                className="btn btn-outline !py-2 !px-3 text-[11px]"
                onClick={() => {
                  setFolderDraftOpen(false);
                  setFolderName("");
                }}
                type="button"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-soft w-full !py-2 text-[11px]" onClick={() => setFolderDraftOpen(true)} type="button">
            新建文件夹
          </button>
        )}
      </div>

      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <p className="shrink-0 text-xs font-medium uppercase tracking-[0.22em] text-[var(--tx-5)]">文档库</p>
        <div className="flex items-center gap-1">
          {SORT_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSortMode(mode)}
              className={`rounded-full px-2 py-0.5 text-[10px] transition ${
                sortMode === mode
                  ? "bg-[var(--sf-5)] font-medium text-[var(--tx-3)]"
                  : "text-[var(--tx-5)] hover:bg-[var(--sf-3)] hover:text-[var(--tx-3)]"
              }`}
            >
              {mode === "manual" ? "手动" : mode === "name" ? "名称" : "时间"}
            </button>
          ))}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={(event) => void handleDragEnd(event)}
        onDragCancel={handleDragCancel}
      >
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {groups.map((group) => (
            <FolderShelfChip
              key={`chip-${group.id ?? "uncategorized"}`}
              folderId={group.id}
              isActiveDrop={(group.id ?? "__uncategorized__") === activeDropGroupId || (group.id ?? "__uncategorized__") === flashGroupId}
              name={group.name}
            />
          ))}
        </div>

        {activeDragDocument ? (
          <div className="mb-3 rounded-[18px] border border-dashed border-[var(--bd-1)] bg-[var(--sf-1)] px-3 py-2 text-[11px] text-[var(--tx-4)]">
            正在拖动 <span className="font-semibold text-[var(--tx-2)]">{activeDragDocument.filename}</span>。
            拖到上方文件夹标签或下方区域即可完成转移。
          </div>
        ) : null}

        <div className="flex-1 overflow-auto pr-1">
          <div className="space-y-3">
            {groups.map((group) => (
              <FolderDropzone
                key={groupSectionId(group.id)}
                documents={group.documents}
                folderId={group.id}
                isActiveDrop={(group.id ?? "__uncategorized__") === activeDropGroupId || (group.id ?? "__uncategorized__") === flashGroupId}
                name={group.name}
                onDeleteFolder={onDeleteFolder}
              >
                <SortableContext
                  items={group.documents.map((document) => documentDragId(document.id))}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {group.documents.length === 0 ? (
                      <div className="rounded-[18px] border border-dashed border-[var(--bd-1)] bg-[var(--sf-1)] px-3 py-4 text-xs text-[var(--tx-5)]">
                        把文档拖到这里。
                      </div>
                    ) : (
                      group.documents.map((document) => (
                        <SortableDocumentCard
                          key={document.id}
                          document={document}
                          activeDocumentId={activeDocumentId}
                          loading={loading}
                          generationDocId={generationDocId}
                          generationProgress={generationProgress}
                          onSelectDocument={onSelectDocument}
                          onDeleteDocument={onDeleteDocument}
                          onRegenerateDocument={onRegenerateDocument}
                          onAbortGeneration={onAbortGeneration}
                          onMoveDocument={onMoveDocument}
                          folders={library.folders}
                          dragState={document.id === activeDragDocumentId ? "source" : "idle"}
                          sortEnabled={sortMode === "manual"}
                          selectMode={selectMode}
                          selected={selectedDocIds.has(document.id)}
                          onToggleSelect={toggleDocSelect}
                        />
                      ))
                    )}
                  </div>
                </SortableContext>
              </FolderDropzone>
            ))}
          </div>
        </div>
        <DragOverlay
          dropAnimation={{
            duration: 180,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            sideEffects: defaultDropAnimationSideEffects({
              styles: {
                active: {
                  opacity: "0.18",
                },
              },
            }),
          }}
        >
          {activeDragDocument ? <DragPreviewCard document={activeDragDocument} /> : null}
        </DragOverlay>
      </DndContext>

      <FolderPickerModal
        isOpen={showFolderPicker}
        filename={pendingUploadFiles.length === 1 ? pendingUploadFiles[0].name : `${pendingUploadFiles.length} 个文件`}
        folders={library.folders}
        mode="upload"
        onConfirm={handleFolderPickerDone}
        onClose={() => {
          setShowFolderPicker(false);
          setPendingUploadFiles([]);
        }}
      />
    </div>
  );
}
