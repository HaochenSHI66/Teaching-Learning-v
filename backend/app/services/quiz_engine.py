from __future__ import annotations

import re

TOKEN_PATTERN = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]{3,}")
DEFAULT_KEYWORDS = ["核心定义", "推导逻辑", "边界条件", "应用场景", "误区"]


def _extract_keywords(text: str, limit: int) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for token in TOKEN_PATTERN.findall(text):
        normalized = token.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(token)
        if len(ordered) >= limit:
            break

    if not ordered:
        ordered.extend(DEFAULT_KEYWORDS[:limit])

    while len(ordered) < limit:
        ordered.append(DEFAULT_KEYWORDS[len(ordered) % len(DEFAULT_KEYWORDS)])

    return ordered


def generate_quiz(*, page_num: int, source_text: str, question_count: int) -> tuple[list[dict], dict[str, str]]:
    keywords = _extract_keywords(source_text, question_count)
    questions: list[dict] = []
    answer_key: dict[str, str] = {}

    for index in range(question_count):
        question_id = f"q{index + 1}"
        keyword = keywords[index]
        questions.append(
            {
                "id": question_id,
                "prompt": f"第 {page_num} 页里，关于“{keyword}”最关键的学习动作是什么？",
                "options": [
                    "A. 明确定义并连接上下文",
                    "B. 只记住结论，不关心前提",
                    "C. 跳过符号解释直接套公式",
                    "D. 把本页和无关章节强行关联",
                ],
            }
        )
        answer_key[question_id] = "A"

    return questions, answer_key


def grade_quiz(*, answer_key: dict[str, str], answers: dict[str, str]) -> tuple[int, int, str, list[dict]]:
    results: list[dict] = []
    score = 0

    for question_id, expected in answer_key.items():
        actual = answers.get(question_id, "")
        is_correct = actual.upper() == expected.upper()
        if is_correct:
            score += 1
        results.append(
            {
                "question_id": question_id,
                "expected": expected,
                "actual": actual,
                "is_correct": is_correct,
            }
        )

    total = len(answer_key)
    mastery = 0 if total == 0 else round((score / total) * 100)
    feedback = f"掌握度 {mastery}%（{score}/{total}）。建议先复盘错误题对应的定义与前提条件。"
    return score, total, feedback, results
