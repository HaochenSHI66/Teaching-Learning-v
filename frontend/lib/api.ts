export type Slide = {
  id: string;
  page_num: number;
  image_url: string;
  thumbnail_url: string;
  width: number;
  height: number;
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
  status: "processing" | "ready" | "error";
  page_count: number;
  created_at: string;
};

export type SlideExplanation = {
  slide_id: string;
  page_num: number;
  markdown: string;
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

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function getAssetUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${apiBase}${path}`;
}

export async function uploadDocument(file: File): Promise<UploadPayload> {
  const form = new FormData();
  form.append("file", file);

  return request<UploadPayload>("/api/v1/documents/upload", {
    method: "POST",
    body: form,
  });
}

export async function fetchDocuments(): Promise<DocumentListItem[]> {
  const payload = await request<{ documents: DocumentListItem[] }>("/api/v1/documents");
  return payload.documents;
}

export async function fetchDocumentStatus(documentId: string): Promise<DocumentStatus> {
  return request<DocumentStatus>(`/api/v1/documents/${documentId}/status`);
}

/** Poll until document status is "ready" or "error". Max wait ~60s. */
export async function pollDocumentReady(
  documentId: string,
  onProgress?: (status: DocumentStatus) => void,
): Promise<DocumentStatus> {
  const INTERVAL_MS = 1500;
  const MAX_ATTEMPTS = 40;

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
