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

export async function fetchSlides(documentId: string): Promise<Slide[]> {
  const payload = await request<{ document_id: string; slides: Slide[] }>(
    `/api/v1/documents/${documentId}/slides`,
  );
  return payload.slides;
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
