from app.models import Slide
from pathlib import Path

from app.services.explanation_engine import generate_slide_explanation, sanitize_slide_markdown
from app.services.prompt_templates import build_slide_explanation_prompt


def _slide() -> Slide:
    return Slide(
        id="slide-1",
        document_id="doc-1",
        page_num=10,
        image_path="slides/slide_010.png",
        thumbnail_path="thumbnails/thumb_010.png",
        width=1024,
        height=768,
    )


def test_sanitize_slide_markdown_replaces_placeholder_heading() -> None:
    markdown = (
        "## Slide 标题\n\n"
        "Supervised Learning (Classification) Space\n\n"
        "> [!NOTE]\n"
        "> 本页主题是监督学习中的分类空间。\n"
    )

    sanitized = sanitize_slide_markdown(
        slide=_slide(),
        markdown=markdown,
        extracted_text="Supervised Learning (Classification) Space",
        extract_payload={
            "summary": "Supervised Learning (Classification) Space",
            "title_candidates": ["Supervised Learning (Classification) Space"],
        },
    )

    assert sanitized.startswith("## Supervised Learning (Classification) Space")
    assert "## Slide 标题" not in sanitized
    assert "[!NOTE]" not in sanitized


def test_sanitize_slide_markdown_strips_quick_check_section() -> None:
    markdown = (
        "## Gradient Descent\n\n"
        "### 完整翻译与解释\n\n"
        "这里是解释。\n\n"
        "### 1分钟自测 Quick Check\n\n"
        "1. 这是什么？\n\n"
        "### 知识点总结\n\n"
        "这里是总结。\n"
    )

    sanitized = sanitize_slide_markdown(
        slide=_slide(),
        markdown=markdown,
        extracted_text="Gradient Descent",
        extract_payload={"title_candidates": ["Gradient Descent"]},
    )

    assert "Quick Check" not in sanitized
    assert "1分钟自测" not in sanitized
    assert "### 知识点总结" in sanitized


def test_build_slide_explanation_prompt_matches_full_translation_contract() -> None:
    prompt = build_slide_explanation_prompt(
        page_num=3,
        question="请生成这页讲解",
        extracted_text="Gradient Descent\n- learning rate\n- update rule",
        related_pages=[2, 3, 4],
    )

    assert "### 完整翻译与解释" in prompt
    assert "### 例题完整讲解" in prompt
    assert "### 知识点总结" in prompt
    assert "不要输出「1分钟自测」「Quick Check」" in prompt
    assert "不要把讲解写成一行一行的碎片化短句" in prompt


def test_generate_slide_explanation_compacts_title_page_without_model_call(tmp_path: Path) -> None:
    class SpyGateway:
        called = False

        def generate_slide_markdown(self, **_: object) -> str:
            self.called = True
            raise AssertionError("gateway should not be used for title pages")

    gateway = SpyGateway()
    slide_image = tmp_path / "slide.png"
    slide_image.write_bytes(b"fake")

    markdown, _, degraded, meta = generate_slide_explanation(
        slide=_slide(),
        question="请生成这页讲解",
        extracted_text="Machine Learning",
        slide_image_path=slide_image,
        extract_payload={
            "summary": "Machine Learning",
            "title_candidates": ["Machine Learning"],
            "text_blocks": [
                {"id": "text-10-1", "type": "text", "text": "Machine Learning", "bbox": [0, 0, 1, 1], "order": 1}
            ],
            "bullet_blocks": [],
            "figures": [],
            "tables": [],
            "equation_like_blocks": [],
            "code_like_blocks": [],
            "page_stats": {"word_count": 2, "text_block_count": 1, "bullet_count": 0, "figure_count": 0, "table_count": 0},
        },
        gateway=gateway,
    )

    assert gateway.called is False
    assert degraded is False
    assert markdown.strip() == "## Machine Learning"
    assert "### " not in markdown
    assert meta["render_mode"] == "compact-static"
    assert meta["content_type"] == "title"


def test_generate_slide_explanation_compacts_toc_page_to_outline() -> None:
    markdown, _, degraded, meta = generate_slide_explanation(
        slide=_slide(),
        question="请生成这页讲解",
        extracted_text="Agenda\nIntroduction\nOptimization\nEvaluation",
        extract_payload={
            "summary": "Agenda",
            "title_candidates": ["Agenda"],
            "text_blocks": [
                {"id": "text-10-1", "type": "text", "text": "Agenda", "bbox": [0, 0, 1, 1], "order": 1}
            ],
            "bullet_blocks": [
                {"id": "bullet-10-1", "type": "bullet", "text": "- Introduction", "bbox": [0, 0, 1, 1], "order": 2},
                {"id": "bullet-10-2", "type": "bullet", "text": "- Optimization", "bbox": [0, 0, 1, 1], "order": 3},
                {"id": "bullet-10-3", "type": "bullet", "text": "- Evaluation", "bbox": [0, 0, 1, 1], "order": 4},
            ],
            "figures": [],
            "tables": [],
            "equation_like_blocks": [],
            "code_like_blocks": [],
            "page_stats": {"word_count": 4, "text_block_count": 1, "bullet_count": 3, "figure_count": 0, "table_count": 0},
        },
    )

    assert degraded is False
    assert markdown.startswith("## Agenda")
    assert "- Introduction" in markdown
    assert "- Optimization" in markdown
    assert "### " not in markdown
    assert meta["render_mode"] == "compact-static"
    assert meta["content_type"] == "toc"
