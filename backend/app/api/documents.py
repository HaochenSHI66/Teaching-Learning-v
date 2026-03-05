from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile, status
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.db import create_db_engine
from app.models import Document, Slide, SlideExplanation, SlideExtract
from app.schemas import (
    DocumentExplanationsExportResponse,
    DocumentExplanationsResponse,
    DocumentListItem,
    DocumentListResponse,
    DocumentRead,
    DocumentStatusResponse,
    SlideExplanationRead,
    SlideRead,
    SlidesResponse,
    UploadResponse,
)
from app.services.explanation_cache import (
    build_cached_slide_explanation,
    build_document_explanations_markdown,
)
from app.services.slide_processor import SUPPORTED_TYPES, process_document

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))  # 50 MB default


async def _read_upload(file: UploadFile) -> bytes:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )
    return content


def _process_document_background(
    *,
    document_id: str,
    source_file: Path,
    media_type: str,
    document_dir: Path,
    database_url: str,
    render_scale: float,
) -> None:
    """Background task: render slides and persist to DB."""
    engine = create_db_engine(database_url)
    with Session(engine) as session:
        document = session.get(Document, document_id)
        if not document:
            return
        try:
            assets = process_document(
                source_file=source_file,
                media_type=media_type,
                document_dir=document_dir,
                render_scale=render_scale,
            )
        except Exception:
            document.status = "error"
            session.add(document)
            session.commit()
            return

        document.page_count = len(assets)
        document.status = "ready"
        session.add(document)

        for asset in assets:
            slide = Slide(
                document_id=document.id,
                page_num=asset.page_num,
                image_path=asset.image_rel_path,
                thumbnail_path=asset.thumbnail_rel_path,
                width=asset.width,
                height=asset.height,
            )
            session.add(slide)
            session.flush()

            summary = asset.extracted_text.splitlines()[0] if asset.extracted_text else ""
            session.add(
                SlideExtract(
                    slide_id=slide.id,
                    payload={
                        "page_num": asset.page_num,
                        "text": asset.extracted_text,
                        "summary": summary,
                    },
                )
            )
            session.add(
                SlideExplanation(
                    document_id=document.id,
                    slide_id=slide.id,
                    page_num=asset.page_num,
                    markdown=build_cached_slide_explanation(
                        page_num=asset.page_num,
                        extracted_text=asset.extracted_text,
                    ),
                )
            )

        session.commit()


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    request: Request,
    file: UploadFile,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_db_session),
) -> UploadResponse:
    media_type = file.content_type or "application/octet-stream"
    if media_type not in SUPPORTED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {media_type}",
        )

    content = await _read_upload(file)

    document = Document(
        filename=file.filename or "uploaded_file",
        media_type=media_type,
        storage_path="",
        status="processing",
    )

    storage_root: Path = request.app.state.storage_dir
    document_dir = storage_root / document.id
    # Store relative path from storage_root for portability
    document.storage_path = document.id
    original_dir = document_dir / "original"
    original_dir.mkdir(parents=True, exist_ok=True)

    file_name = file.filename or "uploaded_file"
    source_file = original_dir / file_name
    source_file.write_bytes(content)

    session.add(document)
    session.commit()
    session.refresh(document)

    render_scale = float(os.getenv("PDF_RENDER_SCALE", "2.0"))
    database_url = str(request.app.state.engine.url)

    background_tasks.add_task(
        _process_document_background,
        document_id=document.id,
        source_file=source_file,
        media_type=media_type,
        document_dir=document_dir,
        database_url=database_url,
        render_scale=render_scale,
    )

    return UploadResponse(
        document=DocumentRead(
            id=document.id,
            filename=document.filename,
            media_type=document.media_type,
            status=document.status,
            page_count=document.page_count,
        ),
        slide_count=0,
    )


@router.get("", response_model=DocumentListResponse)
def list_documents(session: Session = Depends(get_db_session)) -> DocumentListResponse:
    documents = session.exec(select(Document).order_by(Document.created_at.desc())).all()
    return DocumentListResponse(
        documents=[
            DocumentListItem(
                id=document.id,
                filename=document.filename,
                status=document.status,
                page_count=document.page_count,
                created_at=document.created_at,
            )
            for document in documents
        ]
    )


@router.get("/{document_id}/status", response_model=DocumentStatusResponse)
def get_document_status(
    document_id: str,
    session: Session = Depends(get_db_session),
) -> DocumentStatusResponse:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentStatusResponse(
        id=document.id,
        status=document.status,
        page_count=document.page_count,
    )


@router.get("/{document_id}/slides", response_model=SlidesResponse)
def list_document_slides(
    document_id: str,
    session: Session = Depends(get_db_session),
) -> SlidesResponse:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.status == "processing":
        raise HTTPException(status_code=409, detail="Document is still being processed")
    if document.status == "error":
        raise HTTPException(status_code=422, detail="Document processing failed")

    query = select(Slide).where(Slide.document_id == document_id).order_by(Slide.page_num)
    slides = session.exec(query).all()

    return SlidesResponse(
        document_id=document_id,
        slides=[
            SlideRead(
                id=slide.id,
                page_num=slide.page_num,
                image_url=f"/storage/{document_id}/{slide.image_path}",
                thumbnail_url=f"/storage/{document_id}/{slide.thumbnail_path}",
                width=slide.width,
                height=slide.height,
            )
            for slide in slides
        ],
    )


@router.get("/{document_id}/explanations", response_model=DocumentExplanationsResponse)
def list_document_explanations(
    document_id: str,
    session: Session = Depends(get_db_session),
) -> DocumentExplanationsResponse:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.status != "ready":
        raise HTTPException(status_code=409, detail="Document explanations are not ready")

    explanations = session.exec(
        select(SlideExplanation)
        .where(SlideExplanation.document_id == document_id)
        .order_by(SlideExplanation.page_num)
    ).all()

    return DocumentExplanationsResponse(
        document_id=document_id,
        explanations=[
            SlideExplanationRead(
                slide_id=item.slide_id,
                page_num=item.page_num,
                markdown=item.markdown,
            )
            for item in explanations
        ],
    )


@router.get("/{document_id}/explanations/export", response_model=DocumentExplanationsExportResponse)
def export_document_explanations(
    document_id: str,
    session: Session = Depends(get_db_session),
) -> DocumentExplanationsExportResponse:
    payload = list_document_explanations(document_id=document_id, session=session)
    markdown = build_document_explanations_markdown(
        title="全部PPT讲解",
        slide_markdowns=[item.markdown for item in payload.explanations],
    )
    return DocumentExplanationsExportResponse(document_id=document_id, markdown=markdown)
