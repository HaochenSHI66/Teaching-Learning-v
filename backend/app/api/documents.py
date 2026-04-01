from __future__ import annotations

import logging
import os
import re as _re
import shutil
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Query, Request, UploadFile, status
from app.middleware.rate_limit import rate_limit
from sqlmodel import Session, select
from sqlalchemy import func

from app.api.deps import get_db_session, require_document_owner
from app.auth import get_current_user
from app.services.usage_limits import check_document_limit
from app.db import create_db_engine
from app.models import (
    Concept,
    Document,
    DocumentNotebook,
    Folder,
    LearningSession,
    Message,
    Note,
    Quiz,
    QuizAttempt,
    ReviewItem,
    Slide,
    SlideExplanation,
    SlideExtract,
    User,
)
from app.schemas import (
    DocumentDeleteResponse,
    DocumentCacheBatchResponse,
    DocumentCacheBundleRead,
    DocumentExplanationGenerateResponse,
    DocumentExplanationsExportResponse,
    DocumentExplanationsResponse,
    DocumentListItem,
    DocumentListResponse,
    DocumentRead,
    DocumentStatusResponse,
    SlideExtractRead,
    SlideExplanationGenerateResponse,
    SlideExplanationRead,
    SlideRead,
    SlidesResponse,
    UploadResponse,
)
from app.services.explanation_cache import (
    build_document_explanations_markdown,
)
from app.services.explanation_engine import (
    CURRENT_EXPLANATION_VERSION,
    explanation_meta_is_current,
    explanation_markdown_is_stale,
    generate_slide_explanation,
)
from app.services.slide_processor import (
    SUPPORTED_TYPES,
    extract_payload_is_current,
    process_document,
)
from app.api.knowledge_graph import generate_knowledge_graph_for_document

def bump_content_version(session: Session, document_id: str) -> None:
    document = session.get(Document, document_id)
    if document:
        document.content_version = (document.content_version or 0) + 1
        session.add(document)


router = APIRouter(prefix="/api/v1/documents", tags=["documents"])
logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))  # 50 MB default

# ── Magic-byte MIME detection ────────────────────────────────────
_MAGIC_SIGNATURES = {
    b'%PDF': 'application/pdf',
    b'\x89PNG': 'image/png',
    b'\xff\xd8\xff': 'image/jpeg',
    b'RIFF': 'image/webp',  # WebP starts with RIFF....WEBP
}
_ALLOWED_MIMES = set(_MAGIC_SIGNATURES.values())


def _detect_mime(content: bytes) -> str | None:
    """Detect MIME type from magic bytes. Returns None if unrecognised."""
    for sig, mime in _MAGIC_SIGNATURES.items():
        if content[:len(sig)] == sig:
            if sig == b'RIFF' and content[8:12] != b'WEBP':
                continue
            return mime
    return None


def _sanitize_filename(raw: str) -> str:
    """Strip path components and dangerous characters from an uploaded filename."""
    # Take only the final path component (handles ../../foo and C:\foo\bar)
    name = PurePosixPath(raw).name
    name = name.split("\\")[-1]  # handle Windows paths too
    # Remove any remaining path separators or null bytes
    name = name.replace("\x00", "").strip()
    # Keep only safe characters: letters, digits, dots, hyphens, underscores, CJK
    name = _re.sub(r'[^\w.\-\u4e00-\u9fff\u3400-\u4dbf]', '_', name)
    if not name or name.startswith('.'):
        name = "uploaded_file"
    return name


def _check_document_owner(document: Document, current_user: User) -> None:
    """Return 404 if document belongs to a different user (prevents enumeration)."""
    if document.user_id is not None and document.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Document not found")


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


def _maybe_auto_generate_knowledge_graph(session: Session, document_id: str) -> None:
    """Auto-generate knowledge graph if all slides have explanations and no graph exists yet."""
    # Skip if graph already exists (avoid redundant regeneration on each slide edit)
    existing_concepts = session.exec(
        select(Concept).where(Concept.document_id == document_id)
    ).first()
    if existing_concepts:
        return

    slides = session.exec(
        select(Slide).where(Slide.document_id == document_id)
    ).all()
    if not slides:
        return

    explanations = session.exec(
        select(SlideExplanation).where(SlideExplanation.document_id == document_id)
    ).all()
    explained_slide_ids = {exp.slide_id for exp in explanations}

    all_have_explanations = all(s.id in explained_slide_ids for s in slides)
    if not all_have_explanations:
        return

    try:
        concept_count, relation_count = generate_knowledge_graph_for_document(
            session, document_id
        )
        logger.info(
            "Auto-generated knowledge graph for %s: %d concepts, %d relations",
            document_id, concept_count, relation_count,
        )
    except Exception as exc:
        logger.warning(
            "Auto-generation of knowledge graph failed for %s: %s",
            document_id, exc,
        )


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
        except Exception as exc:
            logger.exception("Document processing failed for %s: %s", document_id, exc)
            document.status = "error"
            session.add(document)
            session.commit()
            return

        document.page_count = len(assets)
        document.status = "ready"
        session.add(document)

        slides: list[Slide] = []
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
                    payload=asset.extract_payload
                    or {
                        "page_num": asset.page_num,
                        "text": asset.extracted_text,
                        "summary": summary,
                    },
                )
            )
            slides.append(slide)

        # Commit slides and mark document ready before generating explanations,
        # so the document is immediately accessible in the UI.
        session.commit()
        bump_content_version(session, document.id)
        session.commit()

        # Generate explanations in windowed batches (3 at a time, sequential windows)
        # to preserve cross-page context while still gaining speedup
        import concurrent.futures

        _BG_WINDOW = 3
        pairs = list(zip(slides, assets))

        def _gen_one(slide_asset_pair):
            s, a = slide_asset_pair
            img = document_dir / a.image_rel_path
            try:
                md, _, _, meta = generate_slide_explanation(
                    slide=s,
                    question="请生成这一页的完整讲解",
                    extracted_text=a.extracted_text,
                    slide_image_path=img,
                    extract_payload=a.extract_payload,
                    related_pages=[a.page_num],
                )
                return (s, a, md, meta)
            except Exception:
                return None

        for win_start in range(0, len(pairs), _BG_WINDOW):
            window = pairs[win_start:win_start + _BG_WINDOW]
            with concurrent.futures.ThreadPoolExecutor(max_workers=_BG_WINDOW) as pool:
                futures = [pool.submit(_gen_one, pair) for pair in window]
                window_results = [f.result() for f in futures]

            # Commit this window before starting next (so next window has context)
            for result in window_results:
                if result is None:
                    continue
                slide, asset, explanation_markdown, explanation_meta = result
                session.add(
                    SlideExplanation(
                        document_id=document.id,
                        slide_id=slide.id,
                        page_num=asset.page_num,
                        markdown=explanation_markdown,
                        meta=explanation_meta,
                        version=CURRENT_EXPLANATION_VERSION,
                    )
                )
            session.commit()

        bump_content_version(session, document.id)
        session.commit()

        # Auto-generate knowledge graph after all explanations are done
        _maybe_auto_generate_knowledge_graph(session, document.id)


def _payload_to_extract_read(*, document_id: str, slide: Slide, payload: dict | None) -> SlideExtractRead:
    source = deepcopy(payload or {})

    def normalize_blocks(blocks: list[dict] | None) -> list[dict]:
        normalized: list[dict] = []
        for block in blocks or []:
            item = dict(block)
            preview_path = item.pop("preview_image_path", None)
            if preview_path:
                item["preview_image_url"] = f"/storage/{document_id}/{preview_path}"
            normalized.append(item)
        return normalized

    return SlideExtractRead(
        page_num=int(source.get("page_num") or slide.page_num),
        text=str(source.get("text") or ""),
        summary=str(source.get("summary") or ""),
        title_candidates=list(source.get("title_candidates") or []),
        text_blocks=normalize_blocks(source.get("text_blocks")),
        bullet_blocks=normalize_blocks(source.get("bullet_blocks")),
        figures=normalize_blocks(source.get("figures")),
        tables=normalize_blocks(source.get("tables")),
        equation_like_blocks=normalize_blocks(source.get("equation_like_blocks")),
        code_like_blocks=normalize_blocks(source.get("code_like_blocks")),
        reading_order=list(source.get("reading_order") or []),
        page_stats={str(key): int(value) for key, value in (source.get("page_stats") or {}).items()},
        repeat_analysis=source.get("repeat_analysis"),
    )


def _find_original_source_file(document_dir: Path) -> Path:
    original_dir = document_dir / "original"
    candidates = sorted(path for path in original_dir.iterdir() if path.is_file()) if original_dir.exists() else []
    if not candidates:
        raise HTTPException(status_code=404, detail="Original document source not found")
    return candidates[0]


def _explanation_is_current(explanation: SlideExplanation | None) -> bool:
    if explanation is None:
        return False
    if int(getattr(explanation, "version", 0) or 0) != CURRENT_EXPLANATION_VERSION:
        return False
    if explanation_markdown_is_stale(explanation.markdown):
        return False
    if not explanation_meta_is_current(getattr(explanation, "meta", None)):
        return False
    return True


def _refresh_document_extracts_if_needed(
    *,
    session: Session,
    document: Document,
    storage_root: Path,
) -> dict[str, dict]:
    slides = session.exec(select(Slide).where(Slide.document_id == document.id).order_by(Slide.page_num)).all()
    extract_rows = session.exec(select(SlideExtract).where(SlideExtract.slide_id.in_([slide.id for slide in slides]))).all() if slides else []
    extract_map = {item.slide_id: item for item in extract_rows}

    if slides and all(extract_payload_is_current(extract_map.get(slide.id).payload if extract_map.get(slide.id) else None) for slide in slides):
        return {slide_id: row.payload for slide_id, row in extract_map.items()}

    document_dir = storage_root / document.storage_path
    source_file = _find_original_source_file(document_dir)
    render_scale = float(os.getenv("PDF_RENDER_SCALE", "3.0"))
    assets = process_document(
        source_file=source_file,
        media_type=document.media_type,
        document_dir=document_dir,
        render_scale=render_scale,
    )
    slide_by_page = {slide.page_num: slide for slide in slides}

    refreshed_payloads: dict[str, dict] = {}
    for asset in assets:
        slide = slide_by_page.get(asset.page_num)
        if slide is None:
            continue
        slide.image_path = asset.image_rel_path
        slide.thumbnail_path = asset.thumbnail_rel_path
        slide.width = asset.width
        slide.height = asset.height
        session.add(slide)

        payload = asset.extract_payload or {
            "page_num": asset.page_num,
            "text": asset.extracted_text,
            "summary": asset.extracted_text.splitlines()[0] if asset.extracted_text else "",
        }
        extract_row = extract_map.get(slide.id)
        if extract_row is None:
            extract_row = SlideExtract(slide_id=slide.id, payload=payload)
        else:
            extract_row.payload = payload
        session.add(extract_row)
        refreshed_payloads[slide.id] = payload

    session.commit()
    return refreshed_payloads


def _upsert_slide_explanation(
    *,
    session: Session,
    document_id: str,
    storage_root: Path,
    slide: Slide,
    extracted_text: str,
    extract_payload: dict | None = None,
) -> tuple[SlideExplanation, bool]:
    # Find existing explanation for this slide — take latest, delete duplicates
    all_explanations = session.exec(
        select(SlideExplanation)
        .where(SlideExplanation.slide_id == slide.id)
        .order_by(SlideExplanation.generated_at.desc())
    ).all()
    explanation = all_explanations[0] if all_explanations else None
    for stale in all_explanations[1:]:
        session.delete(stale)
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    slide_image_path = storage_root / document.storage_path / slide.image_path
    markdown, _, _, meta = generate_slide_explanation(
        slide=slide,
        question="请生成这一页的完整讲解",
        extracted_text=extracted_text,
        slide_image_path=slide_image_path if slide_image_path.exists() else None,
        extract_payload=extract_payload,
        related_pages=[slide.page_num],
    )
    overwrote_existing = explanation is not None

    if explanation:
        explanation.markdown = markdown
        explanation.meta = meta
        explanation.version = CURRENT_EXPLANATION_VERSION
        explanation.generated_at = datetime.now(timezone.utc)
        session.add(explanation)
        bump_content_version(session, document_id)
        return explanation, overwrote_existing

    explanation = SlideExplanation(
        document_id=document_id,
        slide_id=slide.id,
        page_num=slide.page_num,
        markdown=markdown,
        meta=meta,
        version=CURRENT_EXPLANATION_VERSION,
    )
    session.add(explanation)
    session.flush()
    bump_content_version(session, document_id)

    # Auto-upsert concepts extracted from the explanation
    _upsert_concepts_from_meta(session=session, document_id=document_id, slide=slide, meta=meta)

    return explanation, overwrote_existing


def _current_explanations_for_document(*, session: Session, document_id: str) -> list[SlideExplanation]:
    all_explanations = session.exec(
        select(SlideExplanation)
        .where(SlideExplanation.document_id == document_id)
        .order_by(SlideExplanation.page_num, SlideExplanation.generated_at.desc())
    ).all()

    seen_slides: dict[str, SlideExplanation] = {}
    for item in all_explanations:
        if item.slide_id not in seen_slides:
            seen_slides[item.slide_id] = item

    explanations = [item for item in seen_slides.values() if _explanation_is_current(item)]
    explanations.sort(key=lambda x: x.page_num)
    return explanations


def _build_slide_reads(
    *,
    document_id: str,
    slides: list[Slide],
    extract_map: dict[str, dict],
    explanations: list[SlideExplanation],
) -> list[SlideRead]:
    explanation_map = {item.slide_id: item for item in explanations}
    return [
        SlideRead(
            id=slide.id,
            page_num=slide.page_num,
            image_url=f"/storage/{document_id}/{slide.image_path}",
            thumbnail_url=f"/storage/{document_id}/{slide.thumbnail_path}",
            width=slide.width,
            height=slide.height,
            extract=_payload_to_extract_read(
                document_id=document_id,
                slide=slide,
                payload=extract_map.get(slide.id),
            ),
            explanation_state=(
                "ready"
                if _explanation_is_current(explanation_map.get(slide.id))
                and extract_payload_is_current(extract_map.get(slide.id))
                else "not_generated"
            ),
        )
        for slide in slides
    ]


def _build_explanation_reads(*, explanations: list[SlideExplanation]) -> list[SlideExplanationRead]:
    return [
        SlideExplanationRead(
            slide_id=item.slide_id,
            page_num=item.page_num,
            markdown=item.markdown,
            meta=item.meta,
        )
        for item in explanations
    ]


def _upsert_concepts_from_meta(*, session: Session, document_id: str, slide: Slide, meta: dict) -> None:
    """Create or update Concept records from meta.concepts extracted during explanation generation."""
    concepts = meta.get("concepts") or []
    if not concepts:
        return

    for item in concepts:
        name_en = str(item.get("name_en", "")).strip()
        name_zh = str(item.get("name_zh", "")).strip()
        description = str(item.get("description", "")).strip()
        if not name_en or not name_zh:
            continue

        # Use Chinese name as canonical name, with English in the description
        canonical_name = f"{name_zh} ({name_en})"

        # Check if concept already exists for this document
        existing = session.exec(
            select(Concept).where(
                Concept.document_id == document_id,
                Concept.name == canonical_name,
            )
        ).first()

        if existing:
            # Add this slide_id if not already present
            slide_ids = existing.slide_ids or []
            if slide.id not in slide_ids:
                existing.slide_ids = [*slide_ids, slide.id]
                if description and len(description) > len(existing.description):
                    existing.description = description
                session.add(existing)
        else:
            session.add(Concept(
                document_id=document_id,
                name=canonical_name,
                description=description,
                slide_ids=[slide.id],
                importance=3,
            ))


def _delete_document_related_records(*, session: Session, document_id: str) -> None:
    slides = session.exec(select(Slide).where(Slide.document_id == document_id)).all()
    slide_ids = [slide.id for slide in slides]

    sessions = session.exec(
        select(LearningSession).where(LearningSession.document_id == document_id)
    ).all()
    session_ids = [item.id for item in sessions]

    quizzes = []
    quiz_ids: list[str] = []
    if session_ids:
        quizzes = session.exec(select(Quiz).where(Quiz.session_id.in_(session_ids))).all()
        quiz_ids = [quiz.id for quiz in quizzes]

        for message in session.exec(select(Message).where(Message.session_id.in_(session_ids))).all():
            session.delete(message)
        for note in session.exec(select(Note).where(Note.session_id.in_(session_ids))).all():
            session.delete(note)
        for review_item in session.exec(
            select(ReviewItem).where(ReviewItem.session_id.in_(session_ids))
        ).all():
            session.delete(review_item)

    if quiz_ids:
        for attempt in session.exec(select(QuizAttempt).where(QuizAttempt.quiz_id.in_(quiz_ids))).all():
            session.delete(attempt)

    for quiz in quizzes:
        session.delete(quiz)

    if slide_ids:
        for extract in session.exec(select(SlideExtract).where(SlideExtract.slide_id.in_(slide_ids))).all():
            session.delete(extract)
        for explanation in session.exec(
            select(SlideExplanation).where(SlideExplanation.slide_id.in_(slide_ids))
        ).all():
            session.delete(explanation)

    for learning_session in sessions:
        session.delete(learning_session)
    for slide in slides:
        session.delete(slide)
    for notebook in session.exec(
        select(DocumentNotebook).where(DocumentNotebook.document_id == document_id)
    ).all():
        session.delete(notebook)


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    request: Request,
    file: UploadFile,
    background_tasks: BackgroundTasks,
    folder_id: str | None = Form(default=None),
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> UploadResponse:
    check_document_limit(session, current_user.id)

    media_type = file.content_type or "application/octet-stream"
    if media_type not in SUPPORTED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {media_type}",
        )

    # Normalize empty string to None
    resolved_folder_id: str | None = folder_id or None
    if resolved_folder_id:
        folder = session.get(Folder, resolved_folder_id)
        if not folder:
            raise HTTPException(status_code=422, detail="folder_id does not exist")

    content = await _read_upload(file)

    # Validate file type by magic bytes, not client-provided content_type
    detected_mime = _detect_mime(content)
    if detected_mime is not None and detected_mime != media_type:
        media_type = detected_mime  # trust magic bytes over client header
    if detected_mime is not None and detected_mime not in _ALLOWED_MIMES:
        raise HTTPException(
            status_code=400,
            detail=f"File content does not match an allowed type (detected: {detected_mime})",
        )

    document = Document(
        filename=_sanitize_filename(file.filename or "uploaded_file"),
        media_type=media_type,
        storage_path="",
        folder_id=resolved_folder_id,
        sort_order=session.exec(select(func.count()).select_from(Document).where(Document.folder_id == resolved_folder_id)).one(),
        status="processing",
        user_id=current_user.id,
    )

    storage_root: Path = request.app.state.storage_dir
    document_dir = storage_root / document.id
    # Store relative path from storage_root for portability
    document.storage_path = document.id
    original_dir = document_dir / "original"
    original_dir.mkdir(parents=True, exist_ok=True)

    file_name = _sanitize_filename(file.filename or "uploaded_file")
    source_file = original_dir / file_name
    source_file.write_bytes(content)

    session.add(document)
    session.commit()
    session.refresh(document)

    render_scale = float(os.getenv("PDF_RENDER_SCALE", "3.0"))
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
            folder_id=document.folder_id,
            sort_order=document.sort_order,
            status=document.status,
            page_count=document.page_count,
        ),
        slide_count=0,
    )


@router.get("", response_model=DocumentListResponse)
def list_documents(
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> DocumentListResponse:
    stmt = select(Document)
    stmt = stmt.where(Document.user_id == current_user.id)
    documents = session.exec(stmt.order_by(Document.created_at.desc())).all()
    return DocumentListResponse(
        documents=[
            DocumentListItem(
                id=document.id,
                filename=document.filename,
                folder_id=document.folder_id,
                sort_order=document.sort_order,
                status=document.status,
                page_count=document.page_count,
                created_at=document.created_at,
            )
            for document in documents
        ]
    )


@router.get("/cache-batch", response_model=DocumentCacheBatchResponse)
def get_document_cache_batch(
    request: Request,
    document_id: list[str] = Query(...),
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> DocumentCacheBatchResponse:
    if len(document_id) > 6:
        raise HTTPException(status_code=422, detail="At most 6 documents may be requested per cache batch")

    requested_ids = list(dict.fromkeys(document_id))
    documents = session.exec(select(Document).where(Document.id.in_(requested_ids))).all()
    document_map = {document.id: document for document in documents}

    bundles: list[DocumentCacheBundleRead] = []
    for requested_id in requested_ids:
        document = document_map.get(requested_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")
        _check_document_owner(document, current_user)
        if document.status == "processing":
            raise HTTPException(status_code=409, detail="Document is still being processed")
        if document.status == "error":
            raise HTTPException(status_code=422, detail="Document processing failed")

        extract_map = _refresh_document_extracts_if_needed(
            session=session,
            document=document,
            storage_root=request.app.state.storage_dir,
        )
        slides = session.exec(
            select(Slide).where(Slide.document_id == requested_id).order_by(Slide.page_num)
        ).all()
        explanations = _current_explanations_for_document(session=session, document_id=requested_id)
        bundles.append(
            DocumentCacheBundleRead(
                document_id=requested_id,
                slides=_build_slide_reads(
                    document_id=requested_id,
                    slides=slides,
                    extract_map=extract_map,
                    explanations=explanations,
                ),
                explanations=_build_explanation_reads(explanations=explanations),
            )
        )

    return DocumentCacheBatchResponse(documents=bundles)


@router.get("/{document_id}/status", response_model=DocumentStatusResponse)
def get_document_status(
    document_id: str,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> DocumentStatusResponse:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_owner(document, current_user)
    return DocumentStatusResponse(
        id=document.id,
        status=document.status,
        page_count=document.page_count,
    )


@router.get("/{document_id}/slides", response_model=SlidesResponse)
def list_document_slides(
    document_id: str,
    request: Request,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> SlidesResponse:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_owner(document, current_user)
    if document.status == "processing":
        raise HTTPException(status_code=409, detail="Document is still being processed")
    if document.status == "error":
        raise HTTPException(status_code=422, detail="Document processing failed")

    extract_map = _refresh_document_extracts_if_needed(
        session=session,
        document=document,
        storage_root=request.app.state.storage_dir,
    )
    slides = session.exec(select(Slide).where(Slide.document_id == document_id).order_by(Slide.page_num)).all()
    explanations = _current_explanations_for_document(session=session, document_id=document_id)

    return SlidesResponse(
        document_id=document_id,
        slides=_build_slide_reads(
            document_id=document_id,
            slides=slides,
            extract_map=extract_map,
            explanations=explanations,
        ),
    )


@router.get("/{document_id}/explanations", response_model=DocumentExplanationsResponse)
def list_document_explanations(
    document_id: str,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> DocumentExplanationsResponse:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_owner(document, current_user)
    if document.status != "ready":
        raise HTTPException(status_code=409, detail="Document explanations are not ready")

    explanations = _current_explanations_for_document(session=session, document_id=document_id)

    return DocumentExplanationsResponse(
        document_id=document_id,
        explanations=_build_explanation_reads(explanations=explanations),
    )


@router.post(
    "/{document_id}/slides/{slide_id}/explanations/generate",
    response_model=SlideExplanationGenerateResponse,
)
def regenerate_slide_explanation(
    document_id: str,
    slide_id: str,
    request: Request,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    _rate_limit=Depends(rate_limit(200, 60, "explanation_generate")),
) -> SlideExplanationGenerateResponse:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_owner(document, current_user)
    if document.status != "ready":
        raise HTTPException(status_code=409, detail="Document is not ready")

    slide = session.get(Slide, slide_id)
    if not slide or slide.document_id != document_id:
        raise HTTPException(status_code=404, detail="Slide not found")

    extract_map = _refresh_document_extracts_if_needed(
        session=session,
        document=document,
        storage_root=request.app.state.storage_dir,
    )
    extract_payload = extract_map.get(slide_id) or {}
    extracted_text = str(extract_payload.get("text") or "")
    explanation, overwrote_existing = _upsert_slide_explanation(
        session=session,
        document_id=document_id,
        storage_root=request.app.state.storage_dir,
        slide=slide,
        extracted_text=extracted_text,
        extract_payload=extract_payload,
    )
    session.commit()
    session.refresh(explanation)

    # Auto-generate knowledge graph if all slides now have explanations
    _maybe_auto_generate_knowledge_graph(session, document_id)

    return SlideExplanationGenerateResponse(
        slide_id=slide.id,
        page_num=slide.page_num,
        markdown=explanation.markdown,
        meta=explanation.meta,
        overwrote_existing=overwrote_existing,
        content_version=document.content_version,
    )


@router.post(
    "/{document_id}/explanations/generate",
    response_model=DocumentExplanationGenerateResponse,
)
def regenerate_document_explanations(
    document_id: str,
    request: Request,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    _rate_limit=Depends(rate_limit(200, 60, "explanation_generate")),
) -> DocumentExplanationGenerateResponse:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_owner(document, current_user)
    if document.status != "ready":
        raise HTTPException(status_code=409, detail="Document is not ready")

    extract_map = _refresh_document_extracts_if_needed(
        session=session,
        document=document,
        storage_root=request.app.state.storage_dir,
    )
    slides = session.exec(select(Slide).where(Slide.document_id == document_id).order_by(Slide.page_num)).all()

    generated_count = 0
    overwrote_existing = False
    for slide in slides:
        extracted_text = str((extract_map.get(slide.id) or {}).get("text") or "")
        try:
            _, overwrote = _upsert_slide_explanation(
                session=session,
                document_id=document_id,
                storage_root=request.app.state.storage_dir,
                slide=slide,
                extracted_text=extracted_text,
                extract_payload=extract_map.get(slide.id),
            )
        except Exception:
            logger.warning(
                "Failed to regenerate explanation for slide %s (page %d), skipping",
                slide.id, slide.page_num,
            )
            continue
        generated_count += 1
        overwrote_existing = overwrote_existing or overwrote
        # Commit slide-by-slide to avoid holding a long SQLite write lock for the
        # full document regeneration window.
        session.commit()

    return DocumentExplanationGenerateResponse(
        document_id=document_id,
        generated_count=generated_count,
        overwrote_existing=overwrote_existing,
        content_version=document.content_version,
    )


@router.get("/{document_id}/explanations/export", response_model=DocumentExplanationsExportResponse)
def export_document_explanations(
    document_id: str,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> DocumentExplanationsExportResponse:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_owner(document, current_user)
    if document.status != "ready":
        raise HTTPException(status_code=409, detail="Document explanations are not ready")
    explanations = session.exec(
        select(SlideExplanation)
        .where(SlideExplanation.document_id == document_id)
        .order_by(SlideExplanation.page_num)
    ).all()
    explanations = [item for item in explanations if _explanation_is_current(item)]
    markdown = build_document_explanations_markdown(
        title="全部PPT讲解",
        slide_markdowns=[item.markdown for item in explanations],
    )
    return DocumentExplanationsExportResponse(document_id=document_id, markdown=markdown)


@router.delete("/{document_id}", response_model=DocumentDeleteResponse)
def delete_document(
    document_id: str,
    request: Request,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> DocumentDeleteResponse:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    _check_document_owner(document, current_user)

    _delete_document_related_records(session=session, document_id=document_id)
    session.delete(document)
    session.commit()

    document_dir = request.app.state.storage_dir / document.storage_path
    if document_dir.exists():
        shutil.rmtree(document_dir, ignore_errors=True)

    return DocumentDeleteResponse(id=document_id, deleted=True)
