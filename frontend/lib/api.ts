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

export type ExplanationItem = {
  label: string;
  explanation: string;
  highlight: string | null;
  sub_items: { label: string; explanation: string }[];
  callout: {
    type: "IMPORTANT" | "TIP" | "WARNING" | "NOTE";
    text: string;
  } | null;
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
      summary_md?: string;
    };
    structured_items?: ExplanationItem[];
  } | null;
};

export type SlideExplanationGeneratePayload = SlideExplanation & {
  overwrote_existing: boolean;
  content_version: number;
};

export type DocumentExplanationGeneratePayload = {
  document_id: string;
  generated_count: number;
  overwrote_existing: boolean;
  content_version: number;
};

export type DocumentCacheBundle = {
  document_id: string;
  content_version: number;
  slides: Slide[];
  explanations: SlideExplanation[];
};

export type DocumentCacheBatchPayload = {
  documents: DocumentCacheBundle[];
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

import { getToken } from "./auth";
import { type AuthUser, setToken, setUser } from "./auth";

// API base: empty string = same origin (production behind tunnel).
// Only use localhost:18920 when running locally on localhost.
function _detectApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) return process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof window === "undefined") return "http://127.0.0.1:18920"; // SSR fallback
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:18920"
    : "";  // same origin — relative URLs
}
const apiBase = _detectApiBase();

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
  const { timeoutMs = 30_000, retries: requestedRetries = 1 } = options ?? {};
  const method = (init?.method ?? "GET").toUpperCase();
  const retries = method === "GET" ? requestedRetries : 0;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 1000));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // If caller passed an external signal (e.g. for cancellation), forward its abort
    const externalSignal = init?.signal;
    if (externalSignal) {
      if (externalSignal.aborted) { controller.abort(); }
      else { externalSignal.addEventListener("abort", () => controller.abort(), { once: true }); }
    }

    try {
      const token = getToken();
      const headers = new Headers(init?.headers);
      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      const response = await fetch(`${apiBase}${path}`, {
        ...init,
        signal: controller.signal,
        headers,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        if (response.status >= 500) {
          // 5xx — retryable
          lastError = new ServerError(text || `服务器错误 (${response.status})`, response.status);
          continue;
        }
        // 401 — token expired, auto logout
        if (response.status === 401 && typeof window !== "undefined" && !path.includes("/auth/")) {
          const { clearAuth } = await import("./auth");
          clearAuth();
          window.location.href = "/login";
          throw new Error("登录已过期，请重新登录");
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
  }, { timeoutMs: 120_000 }); // 2min for large PDFs on public network
}

// ── Bootstrap: one request to get everything for initial load ──
export type BootstrapData = {
  folders: DocumentLibrary;
  first_document: {
    document_id: string;
    content_version: number;
    slides: Slide[];
  } | null;
};

export async function fetchBootstrap(): Promise<BootstrapData> {
  return request<BootstrapData>("/api/v1/bootstrap");
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
  signal?: AbortSignal,
): Promise<DocumentStatus> {
  const INTERVAL_MS = 1500;
  const MAX_ATTEMPTS = 120;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException("Polling aborted", "AbortError");
    const status = await fetchDocumentStatus(documentId);
    onProgress?.(status);
    if (status.status === "ready" || status.status === "error") {
      return status;
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, INTERVAL_MS);
      signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(undefined); }, { once: true });
    });
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

export async function fetchDocumentCacheBatch(documentIds: string[]): Promise<DocumentCacheBatchPayload> {
  const params = new URLSearchParams();
  for (const documentId of documentIds) {
    params.append("document_id", documentId);
  }
  return request<DocumentCacheBatchPayload>(
    `/api/v1/documents/cache-batch?${params.toString()}`,
    undefined,
    { timeoutMs: 120_000, retries: 1 },
  );
}

// ── Prefetch cache: warm up document data on hover ──
const _prefetchCache = new Map<string, { slides: Promise<Slide[]>; explanations: Promise<SlideExplanation[]>; ts: number }>();

/** Call on mouseenter of a document card. Fires fetch early so loadDocument is instant. */
export function prefetchDocument(documentId: string): void {
  if (_prefetchCache.has(documentId)) return;
  _prefetchCache.set(documentId, {
    slides: fetchSlides(documentId),
    explanations: fetchDocumentExplanations(documentId),
    ts: Date.now(),
  });
  // Evict stale entries (>60s)
  for (const [key, val] of _prefetchCache) {
    if (Date.now() - val.ts > 60_000) _prefetchCache.delete(key);
  }
}

/** Consume prefetched data if available, otherwise fetch fresh. */
export async function fetchSlidesWithPrefetch(documentId: string): Promise<Slide[]> {
  const cached = _prefetchCache.get(documentId);
  if (cached) return cached.slides;
  return fetchSlides(documentId);
}

export async function fetchExplanationsWithPrefetch(documentId: string): Promise<SlideExplanation[]> {
  const cached = _prefetchCache.get(documentId);
  if (cached) return cached.explanations;
  return fetchDocumentExplanations(documentId);
}

export async function exportDocumentExplanations(documentId: string): Promise<{ markdown: string }> {
  return request<{ document_id: string; markdown: string }>(
    `/api/v1/documents/${documentId}/explanations/export`,
  );
}

export async function generateSlideExplanation(
  documentId: string,
  slideId: string,
  signal?: AbortSignal,
): Promise<SlideExplanationGeneratePayload> {
  return request<SlideExplanationGeneratePayload>(
    `/api/v1/documents/${documentId}/slides/${slideId}/explanations/generate`,
    {
      method: "POST",
      signal,
    },
    { timeoutMs: 180_000 },
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
    { timeoutMs: 600_000 },
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
  return request<ChatPayload>(
    "/api/v1/chat",
    {
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
    },
    { timeoutMs: 120_000 },
  );
}

/** Streaming chat via SSE. Calls onChunk for each token, returns full answer. */
export async function streamChatResponse(params: {
  sessionId: string;
  message: string;
  slideId?: string;
  mode?: "slide" | "global";
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<ChatPayload> {
  const token = getToken();
  const response = await fetch(`${apiBase}/api/v1/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      session_id: params.sessionId,
      message: params.message,
      slide_id: params.slideId,
      mode: params.mode ?? "slide",
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `请求失败 (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let fullAnswer = "";
  let buffer = "";

  try {
    while (true) {
      if (params.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;
        try {
          const data = JSON.parse(jsonStr);
          if (data.delta) {
            params.onChunk?.(data.delta);
            fullAnswer += data.delta;
          }
          if (data.done && data.answer) {
            fullAnswer = data.answer;
          }
          if (data.error) {
            throw new Error(data.error);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== jsonStr) throw e;
        }
      }
    }
  } catch (err) {
    // Release the reader lock before re-throwing
    reader.cancel().catch(() => {});
    throw err;
  }

  return {
    answer: fullAnswer,
    used_slide_ids: [],
    degraded: false,
    follow_ups: ["能再详细说说吗", "给我举个例子", "这个和前一页有什么关系"],
  };
}

export async function askRoiQuestion(params: {
  sessionId: string;
  slideId: string;
  message: string;
  roi: RoiBox;
}): Promise<RoiChatPayload> {
  return request<RoiChatPayload>(
    "/api/v1/chat/roi",
    {
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
    },
    { timeoutMs: 120_000 },
  );
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
  importance: number; // 1-5, default 3
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
    { timeoutMs: 180_000 },
  );
}

// ── Knowledge Graph: Concepts by Slide ────────────────────────

export type SlideConcept = {
  id: string;
  name: string;
  description: string;
  slide_ids: string[];
  flashcard_count: number;
};

export type ConceptsBySlidePayload = {
  document_id: string;
  slide_id: string;
  concepts: SlideConcept[];
};

type ConceptsBySlideRaw = {
  document_id: string;
  slide_id: string;
  items: Array<{
    concept: { id: string; name: string; description: string; slide_ids: string[] };
    prerequisites: Array<{ id: string; name: string; description: string; slide_ids: string[] }>;
    flashcard_count: number;
  }>;
};

export async function fetchConceptsBySlide(
  documentId: string,
  slideId: string,
): Promise<ConceptsBySlidePayload> {
  const raw = await request<ConceptsBySlideRaw>(
    `/api/v1/knowledge-graph/${documentId}/concepts-by-slide/${slideId}`,
  );
  return {
    document_id: raw.document_id,
    slide_id: raw.slide_id,
    concepts: raw.items.map((item) => ({
      ...item.concept,
      flashcard_count: item.flashcard_count,
    })),
  };
}

// ── Knowledge Graph: Prerequisite Chain ───────────────────────

export type PrerequisiteChainItem = {
  id: string;
  name: string;
  description: string;
  slide_ids: string[];
};

export type PrerequisiteChainPayload = {
  concept_id: string;
  chain: PrerequisiteChainItem[];
};

export async function fetchConceptPrerequisites(
  documentId: string,
  conceptId: string,
): Promise<PrerequisiteChainPayload> {
  return request<PrerequisiteChainPayload>(
    `/api/v1/knowledge-graph/${documentId}/concepts/${conceptId}/prerequisites`,
  );
}

// ── Auth ──────────────────────────────────────────────────────

export async function loginApi(email: string, password: string): Promise<AuthUser> {
  const data = await request<{ token: string; user: { id: string; email: string; display_name: string; is_admin?: boolean } }>("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const user: AuthUser = { id: data.user.id, email: data.user.email, display_name: data.user.display_name, is_admin: data.user.is_admin ?? false };
  setToken(data.token);
  setUser(user);
  return user;
}

export async function registerApi(email: string, password: string, displayName: string): Promise<AuthUser> {
  const data = await request<{ token: string; user: { id: string; email: string; display_name: string } }>("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
  setToken(data.token);
  setUser({ id: data.user.id, email: data.user.email, display_name: data.user.display_name });
  return { id: data.user.id, email: data.user.email, display_name: data.user.display_name };
}

// ── Export Styled Notes ───────────────────────────────────────

export type ExportNotesStyle = {
  id: string;
  name: string;
  name_zh: string;
  description: string;
  color_primary: string;
  color_accent: string;
};

export type ExportNotesRequest = {
  style: string;
  format: "html" | "pdf";
  include_images: boolean;
  include_explanations: boolean;
  include_key_terms: boolean;
  include_knowledge_map: boolean;
  include_flashcards: boolean;
};

export async function fetchExportStyles(): Promise<ExportNotesStyle[]> {
  const data = await request<{ styles: ExportNotesStyle[] }>(
    "/api/v1/export-notes/styles",
  );
  return data.styles;
}

export async function previewExportNotes(
  documentId: string,
  options: ExportNotesRequest,
): Promise<{ html: string; title: string; page_count: number; concept_count: number }> {
  return request<{ html: string; title: string; page_count: number; concept_count: number }>(
    `/api/v1/export-notes/${documentId}/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    },
    { timeoutMs: 120_000 },
  );
}

export async function downloadExportNotes(
  documentId: string,
  options: ExportNotesRequest,
): Promise<void> {
  const token = getToken();
  const res = await fetch(`${apiBase}/api/v1/export-notes/${documentId}/download`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new ServerError(await res.text() || `下载失败 (${res.status})`, res.status);
  const blob = await res.blob();
  const ext = options.format === "pdf" ? "pdf" : "html";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `study-notes.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


// ── Admin API ────────────────────────────────────────────────

export type AdminStats = {
  total_users: number;
  total_documents: number;
  total_explanations: number;
  today_explanations: number;
  daily_explanations: { date: string; count: number }[];
};

export type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  is_disabled: boolean;
  created_at: string;
  document_count: number;
};

export type AdminDocument = {
  id: string;
  filename: string;
  owner_email: string;
  owner_name: string;
  page_count: number;
  explanation_count: number;
  coverage: number;
  created_at: string;
};

export type AdminSystem = {
  status: string;
  db_size_mb: number;
  storage_size_mb: number;
  llm_configured: boolean;
  vision_configured: boolean;
  uptime_seconds: number;
};

export async function fetchAdminStats(): Promise<AdminStats> {
  return request<AdminStats>("/api/v1/admin/stats");
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const data = await request<{ users: AdminUser[] }>("/api/v1/admin/users");
  return data.users;
}

export async function updateAdminUser(userId: string, body: { is_disabled?: boolean; is_admin?: boolean }): Promise<void> {
  await request("/api/v1/admin/users/" + userId, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchAdminDocuments(): Promise<AdminDocument[]> {
  const data = await request<{ documents: AdminDocument[] }>("/api/v1/admin/documents");
  return data.documents;
}

export async function deleteAdminDocument(documentId: string): Promise<void> {
  await request("/api/v1/admin/documents/" + documentId, { method: "DELETE" });
}

export async function fetchAdminSystem(): Promise<AdminSystem> {
  return request<AdminSystem>("/api/v1/admin/system");
}

// ── Sync manifest ──
export type SyncManifestResponse = {
  schema: { explanation_version: number; extract_version: number };
  documents: Record<string, { version: number; page_count: number; filename: string }>;
};

export async function fetchSyncManifest(): Promise<SyncManifestResponse> {
  return request<SyncManifestResponse>("/api/v1/sync/manifest");
}

// ── Global Chat History ───────────────────────────────────────

export type GlobalMessageItem = {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  slide_id: string | null;
  filename: string;
  page_num: number | null;
};

export async function fetchGlobalMessages(): Promise<GlobalMessageItem[]> {
  return request<GlobalMessageItem[]>("/api/v1/chat/global");
}

export async function deleteGlobalMessages(): Promise<void> {
  await request<{ ok: boolean }>("/api/v1/chat/global", { method: "DELETE" });
}
