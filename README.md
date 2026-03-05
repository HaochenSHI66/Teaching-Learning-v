# PPT Split-Screen Learning Assistant

MVP for page-by-page PPT/PDF learning:
- Left panel: slide viewer with thumbnails and page switching
- Right panel: AI explanation, page-bound Q&A, markdown note export

## Repository Structure

- `backend/`: FastAPI API service
- `frontend/`: Next.js split-screen UI
- `docs/plans/`: design and implementation plan docs
- `storage/`: runtime storage for uploaded files and rendered slide images (generated at runtime)

## MVP Features

- Upload `PDF` and common image types (`png/jpg/webp`)
- Auto split/render slides and thumbnails
- Create learning session bound to current document
- Page-level explanation and follow-up Q&A
- Export markdown notes from session interactions

## Backend API (MVP)

- `POST /api/v1/documents/upload`
- `GET /api/v1/documents/{document_id}/slides`
- `POST /api/v1/sessions`
- `GET /api/v1/sessions/{session_id}`
- `POST /api/v1/chat`
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

This branch focuses on Phase-1 MVP. The following are reserved for next iterations:
- ROI box selection explanation
- Cross-slide RAG retrieval
- Quiz auto-grading and spaced review scheduling
- Background worker queue (Celery/RQ)
