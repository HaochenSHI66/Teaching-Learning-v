export type Slide = {
  id: string;
  page_num: number;
  image_url: string;
  thumbnail_url: string;
  width: number;
  height: number;
  explanation_state: "not_generated" | "ready" | "generating" | "error";
  extract: SlideExtract | null;
};

export type SlideExtractBlock = {
  id: string;
  type: string;
  bbox: number[];
  order: number;
  text?: string | null;
  label?: string | null;
  font_size?: number | null;
  preview_image_url?: string | null;
};

export type SlideExtract = {
  page_num: number;
  text: string;
  summary: string;
  title_candidates: string[];
  text_blocks: SlideExtractBlock[];
  bullet_blocks: SlideExtractBlock[];
  figures: SlideExtractBlock[];
  tables: SlideExtractBlock[];
  equation_like_blocks: SlideExtractBlock[];
  code_like_blocks: SlideExtractBlock[];
  reading_order: string[];
  page_stats: Record<string, number>;
  repeat_analysis?: {
    status: string;
    window_pages: number[];
    repeat_pages: number[];
    repeated_ratio: number;
    new_block_ids: string[];
    repeated_block_ids: string[];
    repeated_blocks: {
      current_block_id: string;
      source_page_num: number;
      source_block_id: string;
      similarity: number;
      match_type: string;
      current_excerpt: string;
      source_excerpt: string;
    }[];
  } | null;
};

export type RoiBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type UploadPayload = {
  document: {
    id: string;
    filename: string;
    folder_id?: string | null;
    sort_order?: number;
    page_count: number;
  };
  slide_count: number;
};

export type ChatPayload = {
  answer: string;
  used_slide_ids: string[];
  degraded: boolean;
  follow_ups: string[];
};

export type RoiChatPayload = {
  answer: string;
  used_slide_ids: string[];
  roi_bbox: RoiBox;
};

export type QuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
};

export type QuizPayload = {
  quiz_id: string;
  slide_id: string;
  questions: QuizQuestion[];
};

export type QuizGradePayload = {
  quiz_id: string;
  score: number;
  total: number;
  feedback: string;
  results: {
    question_id: string;
    expected: string;
    actual: string;
    is_correct: boolean;
  }[];
};

export type DocumentStatus = {
  id: string;
  status: "processing" | "ready" | "error";
  page_count: number;
};

export type DocumentListItem = {
  id: string;
  filename: string;
  folder_id?: string | null;
  sort_order?: number;
  status: "processing" | "ready" | "error";
  page_count: number;
  created_at: string;
};

export type FolderDocumentItem = DocumentListItem & {
  folder_id: string | null;
  sort_order: number;
};

export type FolderGroup = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
  documents: FolderDocumentItem[];
};

export type DocumentLibrary = {
  folders: FolderGroup[];
  uncategorized: {
    id: "uncategorized";
    name: string;
    documents: FolderDocumentItem[];
  };
};

export type SlideExplanation = {
  slide_id: string;
  page_num: number;
  markdown: string;
  meta?: {
    render_mode: string;
    content_type: string;
    title: string;
    repeat_summary: {
      repeat_pages: number[];
      repeated_ratio: number;
      has_repeat_section: boolean;
    };
    sections: {
      translation_md: string;
      primary_md: string;
      repeat_md?: string;
    };
  } | null;
};

export type SlideExplanationGeneratePayload = SlideExplanation & {
  overwrote_existing: boolean;
};

export type DocumentExplanationGeneratePayload = {
  document_id: string;
  generated_count: number;
  overwrote_existing: boolean;
};

export type ReviewItem = {
  id: string;
  session_id: string;
  slide_id: string;
  source_ref: string;
  prompt: string;
  due_at: string;
  status: string;
  repetitions: number;
  interval_days: number;
  easiness: number;
};

export type ReviewQueuePayload = {
  session_id: string;
  items: ReviewItem[];
};

export type SessionAnalyticsPayload = {
  session_id: string;
  user_messages: number;
  assistant_messages: number;
  quiz_attempts: number;
  avg_quiz_score_percent: number;
  hot_slides: {
    slide_id: string;
    message_count: number;
  }[];
};

export type DocumentNotebook = {
  document_id: string;
  markdown: string;
  updated_at?: string | null;
  exists: boolean;
};

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

/** Network-layer failure (DNS, CORS, connection refused). */
export class NetworkError extends Error {
  readonly type = "network" as const;
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

/** Server returned a 5xx status. */
export class ServerError extends Error {
  readonly type = "server" as const;
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ServerError";
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  options?: { timeoutMs?: number; retries?: number },
): Promise<T> {
  const { timeoutMs = 30_000, retries = 1 } = options ?? {};
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 1000));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${apiBase}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { ...(init?.headers ?? {}) },
      });
      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        if (response.status >= 500) {
          // 5xx — retryable
          lastError = new ServerError(text || `服务器错误 (${response.status})`, response.status);
          continue;
        }
        // 4xx — not retryable
        throw new Error(text || `请求失败 (${response.status})`);
      }

      return (await response.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new NetworkError("请求超时，请检查网络连接。");
        continue;
      }
      if (err instanceof NetworkError || err instanceof ServerError) {
        lastError = err;
        continue;
      }
      if (err instanceof TypeError) {
        lastError = new NetworkError("网络连接失败，请确认后端服务正在运行。");
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new NetworkError("请求失败");
}

export function getAssetUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${apiBase}${path}`;
}

export async function uploadDocument(file: File, folderId?: string | null): Promise<UploadPayload> {
  const form = new FormData();
  form.append("file", file);
  if (folderId) {
    form.append("folder_id", folderId);
  }

  return request<UploadPayload>("/api/v1/documents/upload", {
    method: "POST",
    body: form,
  });
}

export async function fetchDocuments(): Promise<DocumentListItem[]> {
  const payload = await request<{ documents: DocumentListItem[] }>("/api/v1/documents");
  return payload.documents;
}

export async function fetchFolderLibrary(): Promise<DocumentLibrary> {
  return request<DocumentLibrary>("/api/v1/folders");
}

export async function createFolder(params: {
  name: string;
  color?: string;
}): Promise<{ folder: Omit<FolderGroup, "documents"> }> {
  return request<{ folder: Omit<FolderGroup, "documents"> }>("/api/v1/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      color: params.color ?? "oat",
    }),
  });
}

export async function moveDocumentToFolder(params: {
  documentId: string;
  targetFolderId: string | null;
  targetIndex: number;
}): Promise<{ document: FolderDocumentItem }> {
  return request<{ document: FolderDocumentItem }>("/api/v1/folders/move-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_id: params.documentId,
      target_folder_id: params.targetFolderId,
      target_index: params.targetIndex,
    }),
  });
}

export async function fetchDocumentStatus(documentId: string): Promise<DocumentStatus> {
  return request<DocumentStatus>(`/api/v1/documents/${documentId}/status`);
}

export async function deleteFolder(folderId: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/v1/folders/${folderId}`, {
    method: "DELETE",
  });
}

export async function deleteDocument(documentId: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/v1/documents/${documentId}`, {
    method: "DELETE",
  });
}

/** Poll until document status is "ready" or "error". Max wait ~3min. */
export async function pollDocumentReady(
  documentId: string,
  onProgress?: (status: DocumentStatus) => void,
): Promise<DocumentStatus> {
  const INTERVAL_MS = 1500;
  const MAX_ATTEMPTS = 120;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const status = await fetchDocumentStatus(documentId);
    onProgress?.(status);
    if (status.status === "ready" || status.status === "error") {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  throw new Error("Document processing timed out");
}

export async function fetchSlides(documentId: string): Promise<Slide[]> {
  const payload = await request<{ document_id: string; slides: Slide[] }>(
    `/api/v1/documents/${documentId}/slides`,
  );
  return payload.slides;
}

export async function fetchDocumentExplanations(documentId: string): Promise<SlideExplanation[]> {
  const payload = await request<{ document_id: string; explanations: SlideExplanation[] }>(
    `/api/v1/documents/${documentId}/explanations`,
  );
  return payload.explanations;
}

export async function exportDocumentExplanations(documentId: string): Promise<{ markdown: string }> {
  return request<{ document_id: string; markdown: string }>(
    `/api/v1/documents/${documentId}/explanations/export`,
  );
}

export async function generateSlideExplanation(
  documentId: string,
  slideId: string,
): Promise<SlideExplanationGeneratePayload> {
  return request<SlideExplanationGeneratePayload>(
    `/api/v1/documents/${documentId}/slides/${slideId}/explanations/generate`,
    {
      method: "POST",
    },
  );
}

export async function generateDocumentExplanations(
  documentId: string,
): Promise<DocumentExplanationGeneratePayload> {
  return request<DocumentExplanationGeneratePayload>(
    `/api/v1/documents/${documentId}/explanations/generate`,
    {
      method: "POST",
    },
  );
}

export async function createSession(documentId: string, currentSlideId?: string): Promise<{ id: string }> {
  return request<{ id: string }>("/api/v1/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      document_id: documentId,
      current_slide_id: currentSlideId,
    }),
  });
}

export async function askSlideQuestion(params: {
  sessionId: string;
  message: string;
  slideId?: string;
  mode?: "slide" | "global";
}): Promise<ChatPayload> {
  return request<ChatPayload>("/api/v1/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session_id: params.sessionId,
      message: params.message,
      slide_id: params.slideId,
      mode: params.mode ?? "slide",
    }),
  });
}

export async function askRoiQuestion(params: {
  sessionId: string;
  slideId: string;
  message: string;
  roi: RoiBox;
}): Promise<RoiChatPayload> {
  return request<RoiChatPayload>("/api/v1/chat/roi", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session_id: params.sessionId,
      slide_id: params.slideId,
      message: params.message,
      roi: params.roi,
    }),
  });
}

export async function generateQuiz(params: {
  sessionId: string;
  slideId: string;
  questionCount?: number;
}): Promise<QuizPayload> {
  return request<QuizPayload>("/api/v1/quizzes/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session_id: params.sessionId,
      slide_id: params.slideId,
      question_count: params.questionCount ?? 3,
    }),
  });
}

export async function gradeQuiz(params: {
  quizId: string;
  answers: Record<string, string>;
}): Promise<QuizGradePayload> {
  return request<QuizGradePayload>(`/api/v1/quizzes/${params.quizId}/grade`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ answers: params.answers }),
  });
}

export async function fetchReviewQueue(sessionId: string): Promise<ReviewQueuePayload> {
  return request<ReviewQueuePayload>(`/api/v1/review/${sessionId}/queue`);
}

export async function completeReviewItem(
  reviewId: string,
  quality: number = 4,
): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(`/api/v1/review/${reviewId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quality }),
  });
}

export async function fetchSessionAnalytics(sessionId: string): Promise<SessionAnalyticsPayload> {
  return request<SessionAnalyticsPayload>(`/api/v1/analytics/${sessionId}`);
}

export async function exportNotes(params: {
  sessionId: string;
  title: string;
}): Promise<{ title: string; markdown: string }> {
  return request<{ title: string; markdown: string }>("/api/v1/notes/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session_id: params.sessionId,
      title: params.title,
    }),
  });
}

export async function autogenNotes(params: {
  sessionId: string;
  title: string;
}): Promise<{ title: string; markdown: string }> {
  return request<{ title: string; markdown: string }>("/api/v1/notes/autogen", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session_id: params.sessionId,
      title: params.title,
    }),
  });
}

export async function fetchNotebook(documentId: string): Promise<DocumentNotebook> {
  return request<DocumentNotebook>(`/api/v1/notebooks/${documentId}`);
}

export async function saveNotebook(
  documentId: string,
  markdown: string,
): Promise<DocumentNotebook> {
  return request<DocumentNotebook>(`/api/v1/notebooks/${documentId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ markdown }),
  });
}

export async function autogenNotebook(
  documentId: string,
  title: string = "自动笔记",
): Promise<DocumentNotebook> {
  return request<DocumentNotebook>(`/api/v1/notebooks/${documentId}/autogen`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title }),
  });
}

export async function exportNotebook(
  documentId: string,
): Promise<{ title: string; markdown: string }> {
  return request<{ title: string; markdown: string }>(`/api/v1/notebooks/${documentId}/export`, {
    method: "POST",
  });
}

// ── Slide Notes ───────────────────────────────────────────────

export type SlideNote = {
  id: string;
  document_id: string;
  slide_id: string;
  page_num: number;
  content_md: string;
  source: "manual" | "ai" | "mixed";
  updated_at: string | null;
};

export async function fetchSlideNotes(documentId: string): Promise<SlideNote[]> {
  const res = await request<{ document_id: string; notes: SlideNote[] }>(
    `/api/v1/slide-notes/${documentId}`,
  );
  return res.notes;
}

export async function fetchSlideNote(slideId: string): Promise<SlideNote> {
  return request<SlideNote>(`/api/v1/slide-notes/slide/${slideId}`);
}

export async function saveSlideNote(
  slideId: string,
  contentMd: string,
  source: string = "manual",
): Promise<SlideNote> {
  return request<SlideNote>(`/api/v1/slide-notes/slide/${slideId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content_md: contentMd, source }),
  });
}

export async function generateSlideNote(slideId: string): Promise<{ slide_id: string; content_md: string }> {
  return request<{ slide_id: string; content_md: string }>(
    `/api/v1/slide-notes/slide/${slideId}/generate`,
    { method: "POST" },
  );
}

export async function generateAllSlideNotes(documentId: string): Promise<{ generated_count: number }> {
  return request<{ document_id: string; generated_count: number }>(
    `/api/v1/slide-notes/${documentId}/generate-all`,
    { method: "POST" },
  );
}

export async function exportSlideNotes(documentId: string): Promise<{ title: string; markdown: string }> {
  return request<{ title: string; markdown: string }>(
    `/api/v1/slide-notes/${documentId}/export`,
    { method: "POST" },
  );
}

// ── Bookmarks ─────────────────────────────────────────────────

export type BookmarkTag = "important" | "difficult" | "review" | "exam";

export type Bookmark = {
  id: string;
  document_id: string;
  slide_id: string;
  page_num: number;
  tag: BookmarkTag;
  note: string;
  created_at: string;
};

export async function fetchBookmarks(documentId: string, tag?: BookmarkTag): Promise<Bookmark[]> {
  const query = tag ? `?tag=${tag}` : "";
  const res = await request<{ document_id: string; bookmarks: Bookmark[] }>(
    `/api/v1/bookmarks/${documentId}${query}`,
  );
  return res.bookmarks;
}

export async function createBookmark(slideId: string, tag: BookmarkTag, note?: string): Promise<Bookmark> {
  return request<Bookmark>("/api/v1/bookmarks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slide_id: slideId, tag, note: note ?? "" }),
  });
}

export async function deleteBookmark(bookmarkId: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/v1/bookmarks/${bookmarkId}`, {
    method: "DELETE",
  });
}

// ── Flashcards ────────────────────────────────────────────────

export type FlashcardItem = {
  id: string;
  document_id: string;
  slide_id: string;
  front_md: string;
  back_md: string;
  source: "auto" | "manual";
  created_at: string;
};

export type FlashcardStats = {
  document_id: string;
  slides: { slide_id: string; page_num: number; total: number; mastered: number; due: number }[];
  total: number;
  mastered: number;
  due: number;
  mastery_percent: number;
};

export async function fetchFlashcards(documentId: string): Promise<FlashcardItem[]> {
  const res = await request<{ document_id: string; flashcards: FlashcardItem[] }>(
    `/api/v1/flashcards/${documentId}`,
  );
  return res.flashcards;
}

export async function generateFlashcards(slideId: string): Promise<{ count: number }> {
  return request<{ slide_id: string; count: number }>(
    `/api/v1/flashcards/slide/${slideId}/generate`,
    { method: "POST" },
  );
}

export async function generateAllFlashcards(documentId: string): Promise<{ total_count: number }> {
  return request<{ document_id: string; total_count: number }>(
    `/api/v1/flashcards/${documentId}/generate-all`,
    { method: "POST" },
  );
}

export async function deleteFlashcard(flashcardId: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/v1/flashcards/${flashcardId}`, {
    method: "DELETE",
  });
}

export async function fetchFlashcardStats(documentId: string): Promise<FlashcardStats> {
  return request<FlashcardStats>(`/api/v1/flashcards/${documentId}/stats`);
}

// ── Knowledge Graph ───────────────────────────────────────────

export type ConceptNode = {
  id: string;
  name: string;
  description: string;
  slide_ids: string[];
};

export type ConceptEdge = {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: "prerequisite" | "related" | "part_of" | "contrast";
};

export type KnowledgeGraph = {
  document_id: string;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
};

export async function fetchKnowledgeGraph(documentId: string): Promise<KnowledgeGraph> {
  return request<KnowledgeGraph>(`/api/v1/knowledge-graph/${documentId}`);
}

export async function generateKnowledgeGraph(
  documentId: string,
): Promise<{ concept_count: number; relation_count: number }> {
  return request<{ document_id: string; concept_count: number; relation_count: number }>(
    `/api/v1/knowledge-graph/${documentId}/generate`,
    { method: "POST" },
    { timeoutMs: 60_000 },
  );
}
