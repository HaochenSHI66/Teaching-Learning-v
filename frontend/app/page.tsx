"use client";

import { useEffect, useMemo, useState } from "react";

import { AIPanel } from "@/components/ai-panel";
import { SlideViewer } from "@/components/slide-viewer";
import {
  askRoiQuestion,
  askSlideQuestion,
  createSession,
  exportNotes,
  fetchSlides,
  generateQuiz,
  gradeQuiz,
  type QuizQuestion,
  type RoiBox,
  type Slide,
  uploadDocument,
} from "@/lib/api";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function Page() {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [mode, setMode] = useState<"slide" | "global">("slide");
  const [roi, setRoi] = useState<RoiBox | null>(null);
  const [explanation, setExplanation] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [notesMarkdown, setNotesMarkdown] = useState("");

  const [quizId, setQuizId] = useState<string | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizFeedback, setQuizFeedback] = useState("");

  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("请先上传 PDF/图片开始学习。");

  const currentSlide = useMemo(() => slides[currentSlideIndex], [slides, currentSlideIndex]);

  useEffect(() => {
    setRoi(null);
  }, [currentSlideIndex]);

  async function handleUpload(file: File) {
    setLoading(true);
    setStatusText("正在上传并切页...");
    try {
      const upload = await uploadDocument(file);
      const fetchedSlides = await fetchSlides(upload.document.id);
      setDocumentId(upload.document.id);
      setSlides(fetchedSlides);
      setCurrentSlideIndex(0);
      setExplanation("");
      setChatMessages([]);
      setNotesMarkdown("");
      setChatInput("");
      setRoi(null);
      setQuizId(null);
      setQuizQuestions([]);
      setQuizAnswers({});
      setQuizFeedback("");

      if (fetchedSlides.length > 0) {
        const session = await createSession(upload.document.id, fetchedSlides[0].id);
        setSessionId(session.id);
      } else {
        setSessionId(null);
      }

      setStatusText(`上传成功，共 ${fetchedSlides.length} 页。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`上传失败：${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function ensureSession(): Promise<string> {
    if (sessionId) {
      return sessionId;
    }
    if (!documentId) {
      throw new Error("请先上传文档");
    }
    const session = await createSession(documentId, currentSlide?.id);
    setSessionId(session.id);
    return session.id;
  }

  async function ask(message: string) {
    const question = message.trim();
    if (!question) {
      return;
    }

    setLoading(true);
    setStatusText("AI 正在生成回答...");
    setChatMessages((prev) => [...prev, { role: "user", content: question }]);

    try {
      const sid = await ensureSession();
      const response = await askSlideQuestion({
        sessionId: sid,
        message: question,
        slideId: mode === "slide" ? currentSlide?.id : undefined,
        mode,
      });

      setExplanation(response.answer);
      setChatMessages((prev) => [...prev, { role: "assistant", content: response.answer }]);
      setStatusText(response.degraded ? "回答完成（降级模式）" : "回答完成");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "未知错误";
      setChatMessages((prev) => [...prev, { role: "assistant", content: `请求失败：${messageText}` }]);
      setStatusText(`提问失败：${messageText}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleExplainRoi() {
    if (!currentSlide || !roi) {
      return;
    }

    setLoading(true);
    setStatusText("正在解释框选区域...");
    setChatMessages((prev) => [...prev, { role: "user", content: "请解释我框选的区域" }]);

    try {
      const sid = await ensureSession();
      const response = await askRoiQuestion({
        sessionId: sid,
        slideId: currentSlide.id,
        message: "请解释我框选的区域",
        roi,
      });

      setExplanation(response.answer);
      setChatMessages((prev) => [...prev, { role: "assistant", content: response.answer }]);
      setStatusText("区域解释完成");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "未知错误";
      setStatusText(`区域解释失败：${messageText}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateQuiz() {
    if (!currentSlide) {
      return;
    }

    setLoading(true);
    setStatusText("正在生成本页小测...");
    try {
      const sid = await ensureSession();
      const quiz = await generateQuiz({
        sessionId: sid,
        slideId: currentSlide.id,
        questionCount: 3,
      });
      setQuizId(quiz.quiz_id);
      setQuizQuestions(quiz.questions);
      setQuizAnswers({});
      setQuizFeedback("小测已生成，请选择答案后提交批改。");
      setStatusText("小测生成完成");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "未知错误";
      setStatusText(`小测生成失败：${messageText}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitQuiz() {
    if (!quizId) {
      return;
    }

    setLoading(true);
    setStatusText("正在批改...");
    try {
      const graded = await gradeQuiz({ quizId, answers: quizAnswers });
      setQuizFeedback(graded.feedback);
      setStatusText(`批改完成：${graded.score}/${graded.total}`);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "未知错误";
      setStatusText(`批改失败：${messageText}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleExportNotes() {
    setLoading(true);
    setStatusText("正在导出笔记...");
    try {
      const sid = await ensureSession();
      const result = await exportNotes({
        sessionId: sid,
        title: "PPT 学习笔记",
      });
      setNotesMarkdown(result.markdown);
      setStatusText("笔记导出完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`导出失败：${message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col p-4 md:p-6">
      <header className="mb-4 rounded-2xl bg-white/90 p-4 shadow-panel">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink md:text-2xl">PPT 分屏讲解学习助手</h1>
            <p className="text-sm text-slate-600">上传资料后，按页学习、追问、框选解释并导出笔记。</p>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm text-white">
            <span>{loading ? "处理中..." : "上传 PDF/图片"}</span>
            <input
              accept=".pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={loading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleUpload(file);
                }
                event.currentTarget.value = "";
              }}
              type="file"
            />
          </label>
        </div>

        <p className="mt-3 rounded-lg bg-accentSoft px-3 py-2 text-sm text-slate-700">{statusText}</p>
      </header>

      <section className="grid flex-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <SlideViewer
          currentIndex={currentSlideIndex}
          onRoiChange={setRoi}
          onSelect={setCurrentSlideIndex}
          roi={roi}
          slides={slides}
        />
        <AIPanel
          chatInput={chatInput}
          chatMessages={chatMessages}
          disabled={!currentSlide}
          explanation={explanation}
          loading={loading}
          mode={mode}
          notesMarkdown={notesMarkdown}
          onChatInputChange={setChatInput}
          onExplainRoi={() => {
            void handleExplainRoi();
          }}
          onExportNotes={() => {
            void handleExportNotes();
          }}
          onGenerateExplanation={() => {
            void ask("请解释当前页的核心知识点，并给出1分钟自测题");
          }}
          onGenerateQuiz={() => {
            void handleGenerateQuiz();
          }}
          onModeChange={setMode}
          onQuizAnswerChange={(questionId, answer) => {
            setQuizAnswers((prev) => ({ ...prev, [questionId]: answer }));
          }}
          onSendChat={() => {
            const message = chatInput;
            setChatInput("");
            void ask(message);
          }}
          onSubmitQuiz={() => {
            void handleSubmitQuiz();
          }}
          quizAnswers={quizAnswers}
          quizFeedback={quizFeedback}
          quizQuestions={quizQuestions}
          roiReady={Boolean(roi)}
        />
      </section>
    </main>
  );
}
