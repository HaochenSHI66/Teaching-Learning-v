# PPT Split-Screen Learning Assistant

MVP+ for page-by-page PPT/PDF learning:
- Left panel: slide viewer with thumbnails and page switching
- Right panel: AI explanation, page-bound Q&A, markdown note export
- Drag-to-select ROI on slide and request region-only explanation
- Per-slide quiz generation and auto-grading
- Cross-slide retrieval hints in chat answers (RAG-lite with page citation)
- Wrong-answer review queue with one-click completion
- Session analytics (messages, quiz attempts, average mastery, hot slides)

## Repository Structure

- `backend/`: FastAPI API service
- `frontend/`: Next.js split-screen UI
- `docs/plans/`: design and implementation plan docs
- `storage/`: runtime storage for uploaded files and rendered slide images (generated at runtime)

## Implemented Features

- Upload `PDF` and common image types (`png/jpg/webp`)
- Auto split/render slides and thumbnails
- PDF text extraction into `slide_extracts` for retrieval and quiz generation
- Create learning session bound to current document
- Page-level explanation and follow-up Q&A
- ROI box explanation (`/api/v1/chat/roi`)
- Cross-slide retrieval for related context pages and page citation
- Slide quiz generation and grading (`/api/v1/quizzes/generate`, `/api/v1/quizzes/{id}/grade`)
- Wrong-question review queue (`/api/v1/review/{session_id}/queue`)
- Session-level learning analytics (`/api/v1/analytics/{session_id}`)
- Export markdown notes from session interactions

## Backend API

- `POST /api/v1/documents/upload`
- `GET /api/v1/documents/{document_id}/slides`
- `POST /api/v1/sessions`
- `GET /api/v1/sessions/{session_id}`
- `POST /api/v1/chat`
- `POST /api/v1/chat/roi`
- `POST /api/v1/quizzes/generate`
- `POST /api/v1/quizzes/{quiz_id}/grade`
- `GET /api/v1/review/{session_id}/queue`
- `POST /api/v1/review/{review_id}/complete`
- `GET /api/v1/analytics/{session_id}`
- `POST /api/v1/notes/export`
- `GET /health`

## Local Development

### 1) Backend

```bash
cd backend
pip install -e '.[dev]'
uvicorn app.main:app --reload --port 8000
```

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Open: [http://localhost:3000](http://localhost:3000)

## Docker Compose

```bash
docker compose up --build
```

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend: [http://localhost:8000](http://localhost:8000)

## Tests

```bash
cd backend
pytest -q
```

## Notes on Scope

Current branch covers Phase 1 + core Phase 2 + foundational Phase 3. Still reserved for later:
- True multimodal ROI understanding (current ROI is deterministic template with region metadata)
- Vector database + embedding-based semantic RAG
- Time-based review reminders and spaced repetition automation
- Background worker queue (Celery/RQ) for heavy preprocessing tasks
