"use client";

import { useState } from "react";

import { generateQuiz, gradeQuiz, type QuizQuestion } from "@/lib/api";

type QuizState = {
  quizId: string | null;
  quizQuestions: QuizQuestion[];
  quizAnswers: Record<string, string>;
  quizFeedback: string;
  loading: boolean;
};

type QuizActions = {
  generate: (sessionId: string, slideId: string) => Promise<void>;
  submit: () => Promise<void>;
  setAnswer: (questionId: string, answer: string) => void;
  reset: () => void;
};

export function useQuiz(
  onStatusChange: (text: string) => void,
  onRefreshInsights: () => Promise<void>,
): QuizState & QuizActions {
  const [quizId, setQuizId] = useState<string | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizFeedback, setQuizFeedback] = useState("");
  const [loading, setLoading] = useState(false);

  async function generate(sessionId: string, slideId: string) {
    setLoading(true);
    onStatusChange("正在生成本页小测...");
    try {
      const quiz = await generateQuiz({ sessionId, slideId, questionCount: 3 });
      setQuizId(quiz.quiz_id);
      setQuizQuestions(quiz.questions);
      setQuizAnswers({});
      setQuizFeedback("小测已生成，请选择答案后提交批改。");
      onStatusChange("小测生成完成");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      onStatusChange(`小测生成失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!quizId) return;
    setLoading(true);
    onStatusChange("正在批改...");
    try {
      const graded = await gradeQuiz({ quizId, answers: quizAnswers });
      setQuizFeedback(graded.feedback);
      await onRefreshInsights();
      onStatusChange(`批改完成：${graded.score}/${graded.total}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      onStatusChange(`批改失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }

  function setAnswer(questionId: string, answer: string) {
    setQuizAnswers((prev) => ({ ...prev, [questionId]: answer }));
  }

  function reset() {
    setQuizId(null);
    setQuizQuestions([]);
    setQuizAnswers({});
    setQuizFeedback("");
  }

  return { quizId, quizQuestions, quizAnswers, quizFeedback, loading, generate, submit, setAnswer, reset };
}
