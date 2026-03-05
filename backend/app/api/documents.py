from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from sqlmodel import Session, select

from app.models import Document, Slide
from app.schemas import DocumentRead, SlideRead, SlidesResponse, UploadResponse
from app.services.slide_processor import SUPPORTED_TYPES, process_document

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])


async def _read_upload(file: UploadFile) -> bytes:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    return content


def _get_session(request: Request):
    engine = request.app.state.engine
    with Session(engine) as session:
        yield session


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    request: Request,
    file: UploadFile,
    session: Session = Depends(_get_session),
) -> UploadResponse:
    media_type = file.content_type or "application/octet-stream"
    if media_type not in SUPPORTED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {media_type}",
        )

    document = Document(
        filename=file.filename or "uploaded_file",
        media_type=media_type,
        storage_path="",
    )

    storage_root: Path = request.app.state.storage_dir
    document_dir = storage_root / document.id
    original_dir = document_dir / "original"
    original_dir.mkdir(parents=True, exist_ok=True)

    file_name = file.filename or "uploaded_file"
    source_file = original_dir / file_name
    source_file.write_bytes(await _read_upload(file))

    try:
        assets = process_document(
            source_file=source_file,
            media_type=media_type,
            document_dir=document_dir,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    document.storage_path = document_dir.as_posix()
    document.page_count = len(assets)
    session.add(document)

    for asset in assets:
        session.add(
            Slide(
                document_id=document.id,
                page_num=asset.page_num,
                image_path=asset.image_rel_path,
                thumbnail_path=asset.thumbnail_rel_path,
                width=asset.width,
                height=asset.height,
            )
        )

    session.commit()

    return UploadResponse(
        document=DocumentRead(
            id=document.id,
            filename=document.filename,
            media_type=document.media_type,
            status=document.status,
            page_count=document.page_count,
        ),
        slide_count=len(assets),
    )


@router.get("/{document_id}/slides", response_model=SlidesResponse)
def list_document_slides(
    document_id: str,
    session: Session = Depends(_get_session),
) -> SlidesResponse:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

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
