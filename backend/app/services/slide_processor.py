from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import fitz
from PIL import Image

from app.services.repetition import analyze_repeat_window


SUPPORTED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}
SUPPORTED_TYPES = SUPPORTED_IMAGE_TYPES | {"application/pdf"}
CURRENT_EXTRACT_SCHEMA_VERSION = 3


@dataclass
class SlideAsset:
    page_num: int
    image_rel_path: str
    thumbnail_rel_path: str
    width: int
    height: int
    extracted_text: str
    extract_payload: dict = field(default_factory=dict)


def _save_thumbnail(source: Path, destination: Path, max_width: int = 320) -> tuple[int, int]:
    with Image.open(source) as image:
        image = image.convert("RGB")
        width, height = image.size
        thumbnail = image.copy()
        thumbnail.thumbnail((max_width, max_width * 8))
        thumbnail.save(destination, format="PNG", compress_level=1)
    return width, height


def _save_thumbnail_from_pixmap(pixmap: "fitz.Pixmap", destination: Path, max_width: int = 320) -> tuple[int, int]:
    image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    try:
        width, height = image.size
        image.thumbnail((max_width, max_width * 8))
        image.save(destination, format="PNG", compress_level=1)
        return width, height
    finally:
        image.close()


def _normalize_bbox(bbox: tuple[float, float, float, float] | list[float]) -> list[float]:
    return [round(float(value), 2) for value in bbox]


def _looks_like_equation(text: str) -> bool:
    markers = ("=", "∑", "∫", "∂", "λ", "→", "√")
    return any(marker in text for marker in markers)


def _looks_like_code(text: str) -> bool:
    markers = ("def ", "class ", "return ", "{", "}", ";", "=>")
    return any(marker in text for marker in markers)


def _extract_text_from_block(block: dict) -> tuple[str, float]:
    lines: list[str] = []
    max_font_size = 0.0

    for line in block.get("lines", []):
        spans: list[str] = []
        for span in line.get("spans", []):
            text = (span.get("text") or "").strip()
            if text:
                spans.append(text)
            max_font_size = max(max_font_size, float(span.get("size", 0.0)))
        if spans:
            lines.append(" ".join(spans))

    return "\n".join(lines).strip(), max_font_size


def _classify_text_block(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith(("-", "*", "•")):
        return "bullet"
    if _looks_like_code(stripped):
        return "code_like"
    if _looks_like_equation(stripped):
        return "equation_like"
    return "text"


def _looks_like_page_number(text: str) -> bool:
    stripped = text.strip()
    return stripped.isdigit() and len(stripped) <= 4


def extract_payload_is_current(payload: dict | None) -> bool:
    if not payload:
        return False
    if int(payload.get("schema_version") or 0) != CURRENT_EXTRACT_SCHEMA_VERSION:
        return False
    required_keys = {
        "title_candidates",
        "text_blocks",
        "bullet_blocks",
        "figures",
        "tables",
        "equation_like_blocks",
        "code_like_blocks",
        "reading_order",
        "page_stats",
        "repeat_analysis",
    }
    return required_keys.issubset(payload.keys())


def _save_figure_previews(
    *,
    slide_file: Path,
    output_dir: Path,
    page_num: int,
    figure_blocks: list[dict],
    render_scale: float,
) -> None:
    if not figure_blocks:
        return

    extracts_dir = output_dir / "extracts"
    extracts_dir.mkdir(parents=True, exist_ok=True)

    with Image.open(slide_file) as image:
        for index, figure in enumerate(figure_blocks, start=1):
            x0, y0, x1, y1 = figure["bbox"]
            crop_box = (
                max(int(x0 * render_scale), 0),
                max(int(y0 * render_scale), 0),
                min(int(x1 * render_scale), image.width),
                min(int(y1 * render_scale), image.height),
            )
            if crop_box[2] <= crop_box[0] or crop_box[3] <= crop_box[1]:
                continue

            preview_file = extracts_dir / f"slide_{page_num:03d}_figure_{index:02d}.png"
            cropped = image.crop(crop_box)
            try:
                cropped.save(preview_file, format="PNG")
            finally:
                cropped.close()
            figure["preview_image_path"] = preview_file.relative_to(output_dir).as_posix()


def _extract_pdf_payload(
    *,
    page: fitz.Page,
    slide_file: Path,
    output_dir: Path,
    page_num: int,
    render_scale: float,
) -> tuple[str, dict]:
    page_dict = page.get_text("dict")
    raw_text = page.get_text("text").strip()

    text_blocks: list[dict] = []
    bullet_blocks: list[dict] = []
    equation_like_blocks: list[dict] = []
    code_like_blocks: list[dict] = []
    figure_blocks: list[dict] = []
    reading_order: list[str] = []
    title_candidates: list[tuple[float, float, str]] = []

    for block_index, block in enumerate(page_dict.get("blocks", []), start=1):
        bbox = _normalize_bbox(block.get("bbox", (0, 0, 0, 0)))
        if block.get("type") == 0:
            text, max_font_size = _extract_text_from_block(block)
            if not text:
                continue
            if _looks_like_page_number(text):
                continue

            block_type = _classify_text_block(text)
            item = {
                "id": f"text-{page_num}-{block_index}",
                "type": block_type,
                "bbox": bbox,
                "text": text,
                "order": len(reading_order) + 1,
                "font_size": round(max_font_size, 2),
            }
            text_blocks.append(item)
            reading_order.append(item["id"])

            if block_type == "bullet":
                bullet_blocks.append(item)
            if block_type == "equation_like":
                equation_like_blocks.append(item)
            if block_type == "code_like":
                code_like_blocks.append(item)
            if max_font_size >= 18:
                title_candidates.append((bbox[1], -max_font_size, text))
        elif block.get("type") == 1:
            figure = {
                "id": f"figure-{page_num}-{block_index}",
                "type": "figure",
                "bbox": bbox,
                "label": f"Figure Region {len(figure_blocks) + 1}",
                "order": len(reading_order) + 1,
            }
            figure_blocks.append(figure)
            reading_order.append(figure["id"])

    _save_figure_previews(
        slide_file=slide_file,
        output_dir=output_dir,
        page_num=page_num,
        figure_blocks=figure_blocks,
        render_scale=render_scale,
    )

    ordered_titles = [text for _, _, text in sorted(title_candidates)[:3]]
    summary = ordered_titles[0] if ordered_titles else (text_blocks[0]["text"] if text_blocks else "")

    payload = {
        "schema_version": CURRENT_EXTRACT_SCHEMA_VERSION,
        "page_num": page_num,
        "text": raw_text,
        "summary": summary,
        "title_candidates": ordered_titles,
        "text_blocks": text_blocks,
        "bullet_blocks": bullet_blocks,
        "figures": figure_blocks,
        "tables": [],
        "equation_like_blocks": equation_like_blocks,
        "code_like_blocks": code_like_blocks,
        "reading_order": reading_order,
        "page_stats": {
            "text_block_count": len(text_blocks),
            "bullet_count": len(bullet_blocks),
            "figure_count": len(figure_blocks),
            "table_count": 0,
            "word_count": len(raw_text.split()),
        },
    }
    return raw_text, payload


def _extract_image_payload(*, image_rel_path: str, page_num: int, width: int, height: int) -> tuple[str, dict]:
    payload = {
        "schema_version": CURRENT_EXTRACT_SCHEMA_VERSION,
        "page_num": page_num,
        "text": "",
        "summary": "",
        "title_candidates": [],
        "text_blocks": [],
        "bullet_blocks": [],
        "figures": [
            {
                "id": f"figure-{page_num}-1",
                "type": "figure",
                "bbox": [0.0, 0.0, float(width), float(height)],
                "label": "Image Block 1",
                "order": 1,
                "preview_image_path": image_rel_path,
            }
        ],
        "tables": [],
        "equation_like_blocks": [],
        "code_like_blocks": [],
        "reading_order": [f"figure-{page_num}-1"],
        "page_stats": {
            "text_block_count": 0,
            "bullet_count": 0,
            "figure_count": 1,
            "table_count": 0,
            "word_count": 0,
        },
    }
    return "", payload


def _render_pdf(pdf_path: Path, output_dir: Path, render_scale: float = 2.0) -> list[SlideAsset]:
    slides_dir = output_dir / "slides"
    thumbs_dir = output_dir / "thumbnails"
    slides_dir.mkdir(parents=True, exist_ok=True)
    thumbs_dir.mkdir(parents=True, exist_ok=True)

    assets: list[SlideAsset] = []
    with fitz.open(pdf_path) as document:
        for page_index, page in enumerate(document, start=1):
            pixmap = page.get_pixmap(matrix=fitz.Matrix(render_scale, render_scale), alpha=False)
            # Build PIL image from in-memory pixmap samples (no intermediate file)
            pil_image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            slide_file = slides_dir / f"slide_{page_index:03d}.png"
            # compress_level=1: fastest PNG write (~3x faster than default level 6)
            pil_image.save(slide_file, format="PNG", compress_level=1)
            pil_image.close()

            thumb_file = thumbs_dir / f"thumb_{page_index:03d}.png"
            width, height = _save_thumbnail_from_pixmap(pixmap, thumb_file)
            del pixmap
            extracted_text, extract_payload = _extract_pdf_payload(
                page=page,
                slide_file=slide_file,
                output_dir=output_dir,
                page_num=page_index,
                render_scale=render_scale,
            )

            assets.append(
                SlideAsset(
                    page_num=page_index,
                    image_rel_path=slide_file.relative_to(output_dir).as_posix(),
                    thumbnail_rel_path=thumb_file.relative_to(output_dir).as_posix(),
                    width=width,
                    height=height,
                    extracted_text=extracted_text,
                    extract_payload=extract_payload,
                )
            )
    return assets


def _render_image(image_path: Path, output_dir: Path) -> list[SlideAsset]:
    slides_dir = output_dir / "slides"
    thumbs_dir = output_dir / "thumbnails"
    slides_dir.mkdir(parents=True, exist_ok=True)
    thumbs_dir.mkdir(parents=True, exist_ok=True)

    slide_file = slides_dir / "slide_001.png"
    thumb_file = thumbs_dir / "thumb_001.png"

    with Image.open(image_path) as image:
        converted = image.convert("RGB")
        converted.save(slide_file, format="PNG")

    width, height = _save_thumbnail(slide_file, thumb_file)
    extracted_text, extract_payload = _extract_image_payload(
        image_rel_path=slide_file.relative_to(output_dir).as_posix(),
        page_num=1,
        width=width,
        height=height,
    )
    return [
        SlideAsset(
            page_num=1,
            image_rel_path=slide_file.relative_to(output_dir).as_posix(),
            thumbnail_rel_path=thumb_file.relative_to(output_dir).as_posix(),
            width=width,
            height=height,
            extracted_text=extracted_text,
            extract_payload=extract_payload,
        )
    ]


def process_document(
    *,
    source_file: Path,
    media_type: str,
    document_dir: Path,
    render_scale: float = 2.0,
) -> list[SlideAsset]:
    assets: list[SlideAsset]
    if media_type == "application/pdf":
        assets = _render_pdf(source_file, document_dir, render_scale=render_scale)
    elif media_type in SUPPORTED_IMAGE_TYPES:
        assets = _render_image(source_file, document_dir)
    else:
        raise ValueError(f"Unsupported file type: {media_type}")

    analyze_repeat_window(assets)
    return assets
