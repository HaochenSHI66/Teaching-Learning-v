from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.models import Document, Folder
from app.schemas import (
    FolderCreateRequest,
    FolderDeleteResponse,
    FolderDocumentItem,
    FolderGroupRead,
    FolderLibraryResponse,
    FolderRead,
    FolderResponse,
    FolderUpdateRequest,
    MoveDocumentRequest,
    MoveDocumentResponse,
    UncategorizedGroupRead,
)

router = APIRouter(prefix="/api/v1/folders", tags=["folders"])


def _sort_documents(documents: list[Document]) -> list[Document]:
    return sorted(documents, key=lambda item: (item.sort_order, item.created_at, item.filename.lower()))


def _sort_folders(folders: list[Folder]) -> list[Folder]:
    return sorted(folders, key=lambda item: (item.sort_order, item.created_at, item.name.lower()))


def _document_item(document: Document) -> FolderDocumentItem:
    return FolderDocumentItem(
        id=document.id,
        filename=document.filename,
        folder_id=document.folder_id,
        sort_order=document.sort_order,
        status=document.status,
        page_count=document.page_count,
        created_at=document.created_at,
    )


def _folder_read(folder: Folder) -> FolderRead:
    return FolderRead(
        id=folder.id,
        name=folder.name,
        color=folder.color,
        sort_order=folder.sort_order,
        created_at=folder.created_at,
    )


def _reindex_documents(session: Session, *, folder_id: str | None) -> None:
    documents = session.exec(select(Document).where(Document.folder_id == folder_id)).all()
    for index, document in enumerate(_sort_documents(documents)):
        document.sort_order = index
        session.add(document)


def _build_library(session: Session) -> FolderLibraryResponse:
    folders = _sort_folders(session.exec(select(Folder)).all())
    documents = session.exec(select(Document)).all()

    grouped_docs: dict[str | None, list[Document]] = {}
    for document in documents:
        grouped_docs.setdefault(document.folder_id, []).append(document)

    folder_groups = [
        FolderGroupRead(
            **_folder_read(folder).model_dump(),
            documents=[_document_item(document) for document in _sort_documents(grouped_docs.get(folder.id, []))],
        )
        for folder in folders
    ]
    uncategorized = UncategorizedGroupRead(
        documents=[_document_item(document) for document in _sort_documents(grouped_docs.get(None, []))]
    )
    return FolderLibraryResponse(folders=folder_groups, uncategorized=uncategorized)


@router.get("", response_model=FolderLibraryResponse)
def list_folder_library(session: Session = Depends(get_db_session)) -> FolderLibraryResponse:
    return _build_library(session)


@router.post("", response_model=FolderResponse, status_code=status.HTTP_201_CREATED)
def create_folder(
    payload: FolderCreateRequest,
    session: Session = Depends(get_db_session),
) -> FolderResponse:
    next_order = len(session.exec(select(Folder)).all())
    folder = Folder(name=payload.name.strip(), color=payload.color.strip(), sort_order=next_order)
    session.add(folder)
    session.commit()
    session.refresh(folder)
    return FolderResponse(folder=_folder_read(folder))


@router.patch("/{folder_id}", response_model=FolderResponse)
def update_folder(
    folder_id: str,
    payload: FolderUpdateRequest,
    session: Session = Depends(get_db_session),
) -> FolderResponse:
    folder = session.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    if payload.name is not None:
        folder.name = payload.name.strip()
    if payload.color is not None:
        folder.color = payload.color.strip()

    session.add(folder)
    session.commit()
    session.refresh(folder)
    return FolderResponse(folder=_folder_read(folder))


@router.delete("/{folder_id}", response_model=FolderDeleteResponse)
def delete_folder(
    folder_id: str,
    session: Session = Depends(get_db_session),
) -> FolderDeleteResponse:
    folder = session.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    uncategorized_documents = _sort_documents(session.exec(select(Document).where(Document.folder_id.is_(None))).all())
    offset = len(uncategorized_documents)
    for index, document in enumerate(_sort_documents(session.exec(select(Document).where(Document.folder_id == folder_id)).all())):
        document.folder_id = None
        document.sort_order = offset + index
        session.add(document)

    session.delete(folder)
    session.commit()
    _reindex_documents(session, folder_id=None)
    session.commit()
    return FolderDeleteResponse(id=folder_id, deleted=True)


@router.post("/move-document", response_model=MoveDocumentResponse)
def move_document(
    payload: MoveDocumentRequest,
    session: Session = Depends(get_db_session),
) -> MoveDocumentResponse:
    document = session.get(Document, payload.document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    if payload.target_folder_id is not None and not session.get(Folder, payload.target_folder_id):
        raise HTTPException(status_code=404, detail="Target folder not found")

    source_folder_id = document.folder_id
    target_folder_id = payload.target_folder_id

    target_documents = _sort_documents(
        [
            item
            for item in session.exec(select(Document).where(Document.folder_id == target_folder_id)).all()
            if item.id != document.id
        ]
    )
    target_index = min(payload.target_index, len(target_documents))
    target_documents.insert(target_index, document)

    document.folder_id = target_folder_id
    for index, item in enumerate(target_documents):
        item.folder_id = target_folder_id
        item.sort_order = index
        session.add(item)

    if source_folder_id != target_folder_id:
        _reindex_documents(session, folder_id=source_folder_id)

    session.commit()
    session.refresh(document)
    return MoveDocumentResponse(document=_document_item(document))
