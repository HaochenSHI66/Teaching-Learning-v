"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { DocumentLibrary, FolderDocumentItem } from "@/lib/api";

type GenerationProgress = { current: number; total: number } | null;

type DocumentLibraryProps = {
  library: DocumentLibrary;
  activeDocumentId: string | null;
  loading: boolean;
  generationDocId: string | null;
  generationProgress: GenerationProgress;
  notePanelOpen: boolean;
  onToggleNotes: () => void;
  onUpload: (file: File) => Promise<void>;
  onSelectDocument: (documentId: string) => Promise<void>;
  onDeleteDocument: (documentId: string, filename: string) => Promise<void>;
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

function SortableDocumentCard({
  document,
  activeDocumentId,
  loading,
  generationDocId,
  generationProgress,
  notePanelOpen,
  onToggleNotes,
  onSelectDocument,
  onDeleteDocument,
  onRegenerateDocument,
  onAbortGeneration,
}: {
  document: FolderDocumentItem;
  activeDocumentId: string | null;
  loading: boolean;
  generationDocId: string | null;
  generationProgress: GenerationProgress;
  notePanelOpen: boolean;
  onToggleNotes: () => void;
  onSelectDocument: (documentId: string) => Promise<void>;
  onDeleteDocument: (documentId: string, filename: string) => Promise<void>;
  onRegenerateDocument: (documentId: string) => Promise<void>;
  onAbortGeneration: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: documentDragId(document.id),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      data-testid={`document-item-${document.filename}`}
      className={`rounded-[22px] border p-3 transition ${
        activeDocumentId === document.id
          ? "border-[#cab384] bg-[linear-gradient(135deg,#fff8ec_0%,#f2e7d2_62%,#ece4d5_100%)] shadow-[0_18px_36px_rgba(122,98,66,0.12)]"
          : "border-[#e0d1bc] bg-[#fffaf2] hover:border-[#cdb796] hover:bg-white"
      } ${isDragging ? "opacity-80 shadow-[0_18px_36px_rgba(122,98,66,0.2)]" : ""}`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => void onSelectDocument(document.id)}
          type="button"
        >
          <p className="truncate text-sm font-medium text-[#463829]">{document.filename}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#86715b]">
            <span className="rounded-full bg-[#f1e6d4] px-2 py-1">{document.page_count} 页</span>
            <span
              className={`rounded-full px-2 py-1 ${
                document.status === "ready"
                  ? "bg-[#e8efe0] text-[#607253]"
                  : document.status === "processing"
                    ? "bg-[#f7ecd7] text-[#8c6c46]"
                    : "bg-[#f5e3dc] text-[#9a5e4e]"
              }`}
            >
              {document.status}
            </span>
          </div>
        </button>
        <button
          className="btn btn-outline !rounded-full !px-2.5 !py-1 text-[11px] !text-[#9a5e4e] hover:!border-[#d0a193] hover:!bg-[#f5e3dc]"
          disabled={loading}
          onClick={() => void onDeleteDocument(document.id, document.filename)}
          type="button"
        >
          删除
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {generationDocId === document.id ? (
          <>
            <div className="flex items-center justify-between text-[11px] text-[#7a6655]">
              <span>
                {generationProgress
                  ? `${generationProgress.current} / ${generationProgress.total} 页`
                  : "准备中…"}
              </span>
              <button
                className="btn btn-outline !rounded-full !px-2.5 !py-0.5 !text-[10px] !text-[#9a5e4e] hover:!border-[#d0a193] hover:!bg-[#f5e3dc]"
                onClick={onAbortGeneration}
                type="button"
              >
                终止
              </button>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#ede3d3]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#c9a97a] to-[#8a9d76] transition-all duration-300"
                style={{
                  width: generationProgress
                    ? `${(generationProgress.current / generationProgress.total) * 100}%`
                    : "0%",
                }}
              />
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <button
              className="btn btn-soft flex-1 !rounded-full !py-2 text-[11px]"
              disabled={loading || document.status !== "ready"}
              onClick={() => void onRegenerateDocument(document.id)}
              type="button"
            >
              生成解析
            </button>
            {activeDocumentId === document.id && (
              <button
                className={`btn !rounded-full !py-2 !px-3 text-[11px] ${notePanelOpen ? "btn-dark" : "btn-soft"}`}
                onClick={onToggleNotes}
                type="button"
              >
                笔记
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function FolderDropzone({
  folderId,
  name,
  documents,
  children,
}: {
  folderId: string | null;
  name: string;
  documents: FolderDocumentItem[];
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: groupSectionId(folderId),
  });

  return (
    <section
      ref={setNodeRef}
      data-testid={folderId ? `folder-dropzone-${name}` : "uncategorized-dropzone"}
      className={`rounded-[24px] border px-3 py-3 transition ${
        isOver ? "border-[#b89b70] bg-[#fff8ee]" : "border-[#e1d2be] bg-[#fffaf3]"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[#463829]">{name}</p>
          <p className="text-[11px] text-[#8c765f]">{documents.length} 份文档</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function FolderShelfChip({
  folderId,
  name,
}: {
  folderId: string | null;
  name: string;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: groupTargetId(folderId),
  });

  return (
    <div
      ref={setNodeRef}
      data-testid={folderId ? `folder-target-${name}` : "folder-target-uncategorized"}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
        isOver
          ? "border-[#b38e5e] bg-[#f4e6cd] text-[#5f4a33]"
          : "border-[#dcc9af] bg-[#fffaf2] text-[#7a6655]"
      }`}
    >
      {name}
    </div>
  );
}

export function DocumentLibrary({
  library,
  activeDocumentId,
  loading,
  generationDocId,
  generationProgress,
  notePanelOpen,
  onToggleNotes,
  onUpload,
  onSelectDocument,
  onDeleteDocument,
  onCreateFolder,
  onMoveDocument,
  onRegenerateDocument,
  onAbortGeneration,
}: DocumentLibraryProps) {
  const [folderDraftOpen, setFolderDraftOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const groups = useMemo<GroupDescriptor[]>(
    () => [
      ...library.folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        documents: folder.documents,
      })),
      {
        id: null,
        name: library.uncategorized.name,
        documents: library.uncategorized.documents,
      },
    ],
    [library],
  );

  async function handleCreateFolder() {
    const trimmed = folderName.trim();
    if (!trimmed) return;
    await onCreateFolder(trimmed);
    setFolderName("");
    setFolderDraftOpen(false);
  }

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
    const move = resolveDrop(event);
    if (!move) return;
    const sourceDocument = getDocumentById(library, move.documentId);
    if (!sourceDocument) return;
    if (sourceDocument.folder_id === move.targetFolderId && sourceDocument.sort_order === move.targetIndex) {
      return;
    }
    await onMoveDocument(move.documentId, move.targetFolderId, move.targetIndex);
  }

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-3 rounded-[22px] border border-[#e4d8c5] bg-[#fffaf1] p-3">
        <p className="text-[10px] uppercase tracking-[0.26em] text-[#9d876f]">Document Dock</p>
        <p className="mt-2 text-sm font-medium text-[#463829]">资料库</p>
        <p className="mt-1 text-xs leading-5 text-[#877563]">
          上传文档后自动生成解析缓存，支持按学科整理与拖拽迁移。
        </p>
      </div>

      <label className={`btn btn-primary mb-3 inline-flex cursor-pointer text-xs ${loading ? "opacity-70" : ""}`}>
        <span>上传 PDF/图片</span>
        <input
          accept=".pdf,image/png,image/jpeg,image/webp"
          className="hidden"
          disabled={loading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onUpload(file);
            event.currentTarget.value = "";
          }}
          type="file"
        />
      </label>

      <div className="mb-3 rounded-[18px] border border-[#e4d8c5] bg-[#fffdf8] p-2.5">
        {folderDraftOpen ? (
          <div className="flex flex-col gap-2">
            <input
              className="rounded-[14px] border border-[#dac8ac] bg-white px-3 py-2 text-sm text-[#4f4030] outline-none focus:border-[#a88f69]"
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

      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#9a846a]">文档库</p>
        <span className="text-[11px] text-[#9a846a]">
          {library.folders.length} 个文件夹 · {groups.reduce((sum, group) => sum + group.documents.length, 0)} 份
        </span>
      </div>

      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={(event) => void handleDragEnd(event)}>
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {groups.map((group) => (
            <FolderShelfChip key={`chip-${group.id ?? "uncategorized"}`} folderId={group.id} name={group.name} />
          ))}
        </div>

        <div className="flex-1 overflow-auto pr-1">
          <div className="space-y-3">
            {groups.map((group) => (
              <FolderDropzone key={groupSectionId(group.id)} folderId={group.id} name={group.name} documents={group.documents}>
                <SortableContext
                  items={group.documents.map((document) => documentDragId(document.id))}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {group.documents.length === 0 ? (
                      <div className="rounded-[18px] border border-dashed border-[#dbc8ad] bg-[#fffdf8] px-3 py-4 text-xs text-[#8b7764]">
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
                          notePanelOpen={notePanelOpen}
                          onToggleNotes={onToggleNotes}
                          onSelectDocument={onSelectDocument}
                          onDeleteDocument={onDeleteDocument}
                          onRegenerateDocument={onRegenerateDocument}
                          onAbortGeneration={onAbortGeneration}
                        />
                      ))
                    )}
                  </div>
                </SortableContext>
              </FolderDropzone>
            ))}
          </div>
        </div>
      </DndContext>
    </div>
  );
}
