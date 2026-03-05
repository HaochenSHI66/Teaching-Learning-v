from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import fitz
from PIL import Image


SUPPORTED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}
SUPPORTED_TYPES = SUPPORTED_IMAGE_TYPES | {"application/pdf"}


@dataclass
class SlideAsset:
    page_num: int
    image_rel_path: str
    thumbnail_rel_path: str
    width: int
    height: int
    extracted_text: str


def _save_thumbnail(source: Path, destination: Path, max_width: int = 320) -> tuple[int, int]:
    with Image.open(source) as image:
        image = image.convert("RGB")
        width, height = image.size
        thumbnail = image.copy()
        thumbnail.thumbnail((max_width, max_width * 8))
        thumbnail.save(destination, format="PNG")
    return width, height


def _render_pdf(pdf_path: Path, output_dir: Path) -> list[SlideAsset]:
    slides_dir = output_dir / "slides"
    thumbs_dir = output_dir / "thumbnails"
    slides_dir.mkdir(parents=True, exist_ok=True)
    thumbs_dir.mkdir(parents=True, exist_ok=True)

    assets: list[SlideAsset] = []
    with fitz.open(pdf_path) as document:
        for page_index, page in enumerate(document, start=1):
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            slide_file = slides_dir / f"slide_{page_index:03d}.png"
            pixmap.save(slide_file)

            thumb_file = thumbs_dir / f"thumb_{page_index:03d}.png"
            width, height = _save_thumbnail(slide_file, thumb_file)

            assets.append(
                SlideAsset(
                    page_num=page_index,
                    image_rel_path=slide_file.relative_to(output_dir).as_posix(),
                    thumbnail_rel_path=thumb_file.relative_to(output_dir).as_posix(),
                    width=width,
                    height=height,
                    extracted_text=page.get_text("text").strip(),
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
    return [
        SlideAsset(
            page_num=1,
            image_rel_path=slide_file.relative_to(output_dir).as_posix(),
            thumbnail_rel_path=thumb_file.relative_to(output_dir).as_posix(),
            width=width,
            height=height,
            extracted_text="",
        )
    ]


def process_document(
    *,
    source_file: Path,
    media_type: str,
    document_dir: Path,
) -> list[SlideAsset]:
    if media_type == "application/pdf":
        return _render_pdf(source_file, document_dir)

    if media_type in SUPPORTED_IMAGE_TYPES:
        return _render_image(source_file, document_dir)

    raise ValueError(f"Unsupported file type: {media_type}")
