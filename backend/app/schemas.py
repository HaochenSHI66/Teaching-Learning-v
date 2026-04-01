from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class DocumentRead(BaseModel):
    id: str
    filename: str
    media_type: str
    folder_id: str | None = None
    sort_order: int = 0
    status: str
    page_count: int


class UploadResponse(BaseModel):
    document: DocumentRead
    slide_count: int


class DocumentStatusResponse(BaseModel):
    id: str
    status: str
    page_count: int


class DocumentListItem(BaseModel):
    id: str
    filename: str
    folder_id: str | None = None
    sort_order: int = 0
    status: str
    page_count: int
    created_at: datetime


class DocumentListResponse(BaseModel):
    documents: list[DocumentListItem]


class FolderDocumentItem(BaseModel):
    id: str
    filename: str
    folder_id: str | None = None
    sort_order: int = 0
    status: str
    page_count: int
    created_at: datetime


class FolderRead(BaseModel):
    id: str
    name: str
    color: str
    sort_order: int
    created_at: datetime


class FolderGroupRead(FolderRead):
    documents: list[FolderDocumentItem]


class UncategorizedGroupRead(BaseModel):
    id: str = "uncategorized"
    name: str = "未归类"
    documents: list[FolderDocumentItem]


class FolderLibraryResponse(BaseModel):
    folders: list[FolderGroupRead]
    uncategorized: UncategorizedGroupRead


class FolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = Field(default="oat", min_length=1, max_length=40)


class FolderUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    color: str | None = Field(default=None, min_length=1, max_length=40)


class FolderResponse(BaseModel):
    folder: FolderRead


class FolderDeleteResponse(BaseModel):
    id: str
    deleted: bool


class MoveDocumentRequest(BaseModel):
    document_id: str
    target_folder_id: str | None = None
    target_index: int = Field(default=0, ge=0)


class MoveDocumentResponse(BaseModel):
    document: FolderDocumentItem


class SlideExtractBlockRead(BaseModel):
    id: str
    type: str
    bbox: list[float]
    order: int
    text: str | None = None
    label: str | None = None
    font_size: float | None = None
    preview_image_url: str | None = None


class SlideExtractRead(BaseModel):
    page_num: int
    text: str
    summary: str
    title_candidates: list[str]
    text_blocks: list[SlideExtractBlockRead]
    bullet_blocks: list[SlideExtractBlockRead]
    figures: list[SlideExtractBlockRead]
    tables: list[SlideExtractBlockRead]
    equation_like_blocks: list[SlideExtractBlockRead]
    code_like_blocks: list[SlideExtractBlockRead]
    reading_order: list[str]
    page_stats: dict[str, int]
    repeat_analysis: dict | None = None


class SlideRead(BaseModel):
    id: str
    page_num: int
    image_url: str
    thumbnail_url: str
    width: int
    height: int
    extract: SlideExtractRead | None = None
    explanation_state: str = "not_generated"


class SlidesResponse(BaseModel):
    document_id: str
    slides: list[SlideRead]


class SlideExplanationRead(BaseModel):
    slide_id: str
    page_num: int
    markdown: str
    meta: dict | None = None


class SlideExplanationGenerateResponse(BaseModel):
    slide_id: str
    page_num: int
    markdown: str
    meta: dict | None = None
    overwrote_existing: bool


class DocumentExplanationsResponse(BaseModel):
    document_id: str
    explanations: list[SlideExplanationRead]


class DocumentExplanationGenerateResponse(BaseModel):
    document_id: str
    generated_count: int
    overwrote_existing: bool


class DocumentExplanationsExportResponse(BaseModel):
    document_id: str
    markdown: str


class DocumentCacheBundleRead(BaseModel):
    document_id: str
    slides: list[SlideRead]
    explanations: list[SlideExplanationRead]


class DocumentCacheBatchResponse(BaseModel):
    documents: list[DocumentCacheBundleRead]


class DocumentDeleteResponse(BaseModel):
    id: str
    deleted: bool


class SessionCreateRequest(BaseModel):
    document_id: str
    current_slide_id: str | None = None
    follow_current_page: bool = True


class SessionRead(BaseModel):
    id: str
    document_id: str
    current_slide_id: str | None
    follow_current_page: bool
    created_at: datetime


class ChatRequest(BaseModel):
    session_id: str
    message: str
    slide_id: str | None = None
    mode: str = Field(default="slide", pattern="^(slide|global)$")


class ChatResponse(BaseModel):
    answer: str
    used_slide_ids: list[str]
    degraded: bool
    follow_ups: list[str]


class RoiBox(BaseModel):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    w: float = Field(gt=0.0, le=1.0)
    h: float = Field(gt=0.0, le=1.0)


class RoiChatRequest(BaseModel):
    session_id: str
    slide_id: str
    message: str
    roi: RoiBox


class RoiChatResponse(BaseModel):
    answer: str
    used_slide_ids: list[str]
    roi_bbox: RoiBox


class NotesExportRequest(BaseModel):
    session_id: str
    title: str = "PPT 学习笔记"


class NotesExportResponse(BaseModel):
    title: str
    markdown: str


class DocumentNotebookRead(BaseModel):
    document_id: str
    markdown: str
    updated_at: datetime | None = None
    exists: bool = False


class DocumentNotebookSaveRequest(BaseModel):
    markdown: str = Field(...)


class DocumentNotebookAutoGenerateRequest(BaseModel):
    title: str = "自动笔记"


class DocumentNotebookExportResponse(BaseModel):
    title: str
    markdown: str


class NotesAutoGenerateRequest(BaseModel):
    session_id: str
    title: str = "自动笔记"


class QuizGenerateRequest(BaseModel):
    session_id: str
    slide_id: str
    question_count: int = Field(default=3, ge=1, le=10)


class QuizQuestion(BaseModel):
    id: str
    prompt: str
    options: list[str]


class QuizGenerateResponse(BaseModel):
    quiz_id: str
    slide_id: str
    questions: list[QuizQuestion]


class QuizGradeRequest(BaseModel):
    answers: dict[str, str]


class QuizGradeResult(BaseModel):
    question_id: str
    expected: str
    actual: str
    is_correct: bool


class QuizGradeResponse(BaseModel):
    quiz_id: str
    score: int
    total: int
    feedback: str
    results: list[QuizGradeResult]


class ReviewItemRead(BaseModel):
    id: str
    session_id: str
    slide_id: str
    source_ref: str
    prompt: str
    due_at: datetime
    status: str
    repetitions: int
    interval_days: float
    easiness: float


class ReviewQueueResponse(BaseModel):
    session_id: str
    items: list[ReviewItemRead]


class ReviewCompleteResponse(BaseModel):
    id: str
    status: str


class HotSlideStat(BaseModel):
    slide_id: str
    message_count: int


class SessionAnalyticsResponse(BaseModel):
    session_id: str
    user_messages: int
    assistant_messages: int
    quiz_attempts: int
    avg_quiz_score_percent: int
    hot_slides: list[HotSlideStat]


# ── Slide Notes ────────────────────────────────────────────────

class SlideNoteRead(BaseModel):
    id: str
    document_id: str
    slide_id: str
    page_num: int
    content_md: str
    source: str
    updated_at: datetime | None = None


class SlideNoteSaveRequest(BaseModel):
    content_md: str = Field(...)
    source: str = Field(default="manual")


class SlideNoteListResponse(BaseModel):
    document_id: str
    notes: list[SlideNoteRead]


class SlideNoteGenerateResponse(BaseModel):
    slide_id: str
    content_md: str
    source: str = "ai"


class SlideNoteBatchGenerateResponse(BaseModel):
    document_id: str
    generated_count: int


class SlideNoteExportResponse(BaseModel):
    title: str
    markdown: str


# ── Bookmarks ──────────────────────────────────────────────────

class BookmarkCreateRequest(BaseModel):
    slide_id: str
    tag: str = Field(default="important", pattern="^(important|difficult|review|exam)$")
    note: str = Field(default="")


class BookmarkRead(BaseModel):
    id: str
    document_id: str
    slide_id: str
    page_num: int
    tag: str
    note: str
    created_at: datetime


class BookmarkListResponse(BaseModel):
    document_id: str
    bookmarks: list[BookmarkRead]


class BookmarkDeleteResponse(BaseModel):
    id: str
    deleted: bool


# ── Flashcards ─────────────────────────────────────────────────

class FlashcardRead(BaseModel):
    id: str
    document_id: str
    slide_id: str
    front_md: str
    back_md: str
    source: str
    created_at: datetime


class FlashcardCreateRequest(BaseModel):
    slide_id: str
    front_md: str
    back_md: str


class FlashcardListResponse(BaseModel):
    document_id: str
    flashcards: list[FlashcardRead]


class FlashcardGenerateResponse(BaseModel):
    slide_id: str
    count: int


class FlashcardBatchGenerateResponse(BaseModel):
    document_id: str
    total_count: int


class FlashcardDeleteResponse(BaseModel):
    id: str
    deleted: bool


class FlashcardSlideStats(BaseModel):
    slide_id: str
    page_num: int
    total: int
    mastered: int
    due: int


class FlashcardStatsResponse(BaseModel):
    document_id: str
    slides: list[FlashcardSlideStats]
    total: int
    mastered: int
    due: int
    mastery_percent: int


# ── Knowledge Graph ────────────────────────────────────────────

class ConceptRead(BaseModel):
    id: str
    name: str
    description: str
    slide_ids: list[str]
    importance: int = 3


class ConceptRelationRead(BaseModel):
    id: str
    source_id: str
    target_id: str
    relation_type: str


class KnowledgeGraphResponse(BaseModel):
    document_id: str
    nodes: list[ConceptRead]
    edges: list[ConceptRelationRead]


class KnowledgeGraphGenerateResponse(BaseModel):
    document_id: str
    concept_count: int
    relation_count: int


class ConceptsBySlideItem(BaseModel):
    concept: ConceptRead
    prerequisites: list[ConceptRead]
    flashcard_count: int = 0


class ConceptsBySlideResponse(BaseModel):
    document_id: str
    slide_id: str
    items: list[ConceptsBySlideItem]


class PrerequisiteChainResponse(BaseModel):
    document_id: str
    concept_id: str
    chain: list[ConceptRead]


# ── Export Styled Notes ────────────────────────────────────────

class ExportNotesRequest(BaseModel):
    style: str = "modern-minimal"
    format: str = "html"
    include_images: bool = True
    include_explanations: bool = True
    include_key_terms: bool = True
    include_knowledge_map: bool = True
    include_flashcards: bool = True


class ExportNotesStyle(BaseModel):
    id: str
    name: str
    name_zh: str
    description: str
    color_primary: str
    color_accent: str


class ExportNotesStylesResponse(BaseModel):
    styles: list[ExportNotesStyle]


class ExportNotesPreviewResponse(BaseModel):
    html: str
    title: str
    page_count: int
    concept_count: int
