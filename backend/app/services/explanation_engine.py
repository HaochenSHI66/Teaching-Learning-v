from __future__ import annotations

from app.models import Slide


def generate_slide_explanation(*, slide: Slide, question: str) -> tuple[str, list[str]]:
    answer = (
        f"本页在讲什么（一句话）：\n"
        f"这页是第 {slide.page_num} 页，核心在于围绕你的问题“{question}”提炼关键概念并建立理解框架。\n\n"
        "知识点拆解：\n"
        "1. 先识别标题与主结论，明确这页要解决的问题。\n"
        "2. 拆分图表/公式/代码中的输入、过程、输出关系。\n"
        "3. 将本页结论连接到上一页或先修知识。\n\n"
        "例题/推导：\n"
        "- 按“已知条件 -> 推理步骤 -> 结论”复述一遍该页内容。\n\n"
        "易错点：\n"
        "- 只记结论不理解前提条件。\n"
        "- 把符号或变量含义混淆。\n\n"
        "1分钟自测：\n"
        "1. 这页的核心结论是什么？\n"
        "2. 哪个前提一旦变化会让结论失效？\n"
        "3. 你能用自己的话复述推理路径吗？\n"
    )

    follow_ups = [
        "请把这一页和前一页串起来讲一遍",
        "给我一个更直觉的例子",
        "出两道针对这页的判断题",
    ]
    return answer, follow_ups
