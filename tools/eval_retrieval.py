#!/usr/bin/env python3
"""
eval_retrieval.py — MLP-style Recall@1/5 retrieval evaluator.

Tests whether each explanation uniquely identifies its source slide among N candidates.

Protocol:
  1. Select N slides with both explanations and extracted text
  2. Embed each explanation (query) and each slide's extracted text (corpus)
  3. Rank corpus by cosine similarity for each query
  4. Report Recall@1 and Recall@5

Usage:
    python tools/eval_retrieval.py              # 50 slides for user "shc"
    python tools/eval_retrieval.py --limit 20   # 20 slides
    python tools/eval_retrieval.py --method tfidf      # force TF-IDF
    python tools/eval_retrieval.py --method embedding  # force API embeddings
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

# Load backend/.env
_env_path = PROJECT_ROOT / "backend" / ".env"
if _env_path.exists():
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_DB = PROJECT_ROOT / "backend" / "storage" / "app.db"
EMBEDDING_MODEL = "text-embedding-v3"


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def get_user_id(conn: sqlite3.Connection, user_hint: str = "shc") -> str:
    cur = conn.execute(
        "SELECT id, email FROM user WHERE email LIKE ?",
        (f"%{user_hint}%",),
    )
    rows = cur.fetchall()
    if not rows:
        raise SystemExit(f"No user found with email containing '{user_hint}'")
    if len(rows) > 1:
        emails = ", ".join(r[1] for r in rows)
        print(f"[warn] Multiple users matched '{user_hint}': {emails}. Using first.", file=sys.stderr)
    return rows[0][0]


def load_slides_for_retrieval(
    conn: sqlite3.Connection,
    user_id: str,
    limit: int,
) -> list[dict]:
    """
    Return slides that have BOTH an explanation AND extracted text (SlideExtract).
    Each row has: exp_id, slide_id, document_id, page_num, explanation_text, slide_text.
    """
    sql = """
        SELECT
            se.id         AS exp_id,
            se.document_id,
            se.slide_id,
            se.page_num,
            se.markdown,
            se.meta,
            d.filename,
            sx.payload    AS extract_payload
        FROM slideexplanation se
        JOIN document d ON se.document_id = d.id
        JOIN slideextract sx ON sx.slide_id = se.slide_id
        WHERE d.user_id = ?
          AND sx.payload IS NOT NULL
        ORDER BY d.filename, se.page_num
        LIMIT ?
    """
    cur = conn.execute(sql, [user_id, limit])
    cols = [c[0] for c in cur.description]
    rows = cur.fetchall()
    return [dict(zip(cols, r)) for r in rows]


def get_explanation_text(row: dict) -> str:
    """Return best explanation text from meta (items format) or markdown."""
    meta = None
    if row["meta"]:
        try:
            meta = json.loads(row["meta"]) if isinstance(row["meta"], str) else row["meta"]
        except (json.JSONDecodeError, TypeError):
            pass

    if meta and isinstance(meta, dict) and meta.get("items"):
        lines = []
        for item in meta["items"]:
            title = item.get("title", "")
            if title:
                lines.append(f"**{title}**")
            for sub in item.get("sub_items", []):
                lines.append(f"- {sub}")
            explanation = item.get("explanation", "")
            if explanation:
                lines.append(explanation)
        return "\n".join(lines)

    return row["markdown"] or "(no explanation)"


def get_slide_text(row: dict) -> str:
    """Return SlideExtract.payload['text'] as the slide's text representation."""
    payload = row["extract_payload"]
    if payload:
        try:
            p = json.loads(payload) if isinstance(payload, str) else payload
            return p.get("text", "") or ""
        except (json.JSONDecodeError, TypeError):
            pass
    return ""


# ---------------------------------------------------------------------------
# Embedding: Option A — API embeddings (DashScope / OpenAI-compatible)
# ---------------------------------------------------------------------------

def get_api_embeddings(texts: list[str], api_key: str, base_url: str) -> np.ndarray | None:
    """
    Call the /embeddings endpoint. Returns (N, D) float32 array or None on failure.
    Batches requests to avoid hitting API limits.
    """
    try:
        from openai import OpenAI
    except ImportError:
        print("[warn] openai package not available, can't use embedding API", file=sys.stderr)
        return None

    client = OpenAI(api_key=api_key, base_url=base_url)
    batch_size = 20
    all_embeddings: list[list[float]] = []

    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]
        print(f"  Embedding batch {start // batch_size + 1}/{(len(texts) + batch_size - 1) // batch_size} …", end=" ", flush=True)
        try:
            resp = client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
            # Sort by index to preserve order
            sorted_data = sorted(resp.data, key=lambda x: x.index)
            all_embeddings.extend([d.embedding for d in sorted_data])
            print(f"OK ({len(sorted_data)} vectors)")
        except Exception as exc:
            print(f"FAILED: {exc}", file=sys.stderr)
            return None

    return np.array(all_embeddings, dtype=np.float32)


# ---------------------------------------------------------------------------
# Embedding: Option B — sentence-transformers (local)
# ---------------------------------------------------------------------------

def get_st_embeddings(texts: list[str]) -> np.ndarray | None:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        return None
    print("  Loading sentence-transformers model …", flush=True)
    model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
    vecs = model.encode(texts, show_progress_bar=True, convert_to_numpy=True)
    return vecs.astype(np.float32)


# ---------------------------------------------------------------------------
# Embedding: Option C — TF-IDF
# ---------------------------------------------------------------------------

def get_tfidf_embeddings(texts: list[str]) -> np.ndarray:
    from sklearn.feature_extraction.text import TfidfVectorizer
    vec = TfidfVectorizer(
        analyzer="char_wb",
        ngram_range=(2, 4),
        max_features=8192,
        sublinear_tf=True,
    )
    mat = vec.fit_transform(texts)
    # Return dense float32 array
    arr = mat.toarray().astype(np.float32)
    return arr


# ---------------------------------------------------------------------------
# Cosine similarity and Recall@K
# ---------------------------------------------------------------------------

def cosine_sim_matrix(query_vecs: np.ndarray, corpus_vecs: np.ndarray) -> np.ndarray:
    """Returns (N_query, N_corpus) cosine similarity matrix."""
    # L2 normalize
    q_norm = query_vecs / (np.linalg.norm(query_vecs, axis=1, keepdims=True) + 1e-10)
    c_norm = corpus_vecs / (np.linalg.norm(corpus_vecs, axis=1, keepdims=True) + 1e-10)
    return q_norm @ c_norm.T  # (N, N)


def compute_recall(sim_matrix: np.ndarray, k: int) -> tuple[float, int]:
    """
    Each query i should match corpus item i (same index = correct slide).
    Returns (recall@k, correct_count).
    """
    n = sim_matrix.shape[0]
    correct = 0
    for i in range(n):
        # Get top-k indices (descending)
        top_k = np.argpartition(sim_matrix[i], -k)[-k:]
        if i in top_k:
            correct += 1
    return correct / n, correct


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Recall@1/5 retrieval evaluator")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="Path to SQLite DB")
    parser.add_argument("--limit", type=int, default=50, help="Number of slides to evaluate (default: 50)")
    parser.add_argument(
        "--method",
        choices=["auto", "embedding", "tfidf"],
        default="auto",
        help="Embedding method: auto (try API→ST→TF-IDF), embedding, tfidf",
    )
    parser.add_argument("--user", default="shc", help="User email fragment (default: shc)")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        raise SystemExit(f"DB not found: {db_path}")

    conn = sqlite3.connect(str(db_path))
    user_id = get_user_id(conn, args.user)

    rows = load_slides_for_retrieval(conn, user_id, args.limit)
    conn.close()

    n = len(rows)
    if n == 0:
        raise SystemExit("No slides with both explanations and extracted text found.")

    print(f"Retrieval Evaluation — user: {args.user} (N={n})")
    print(f"Note: N may be < --limit if fewer slides have extracted text\n")

    # Build text lists (parallel: query i corresponds to corpus i)
    explanation_texts = [get_explanation_text(r) for r in rows]
    slide_texts = [get_slide_text(r) for r in rows]

    # Filter out slides with empty text on either side
    valid_indices = [
        i for i in range(n)
        if explanation_texts[i].strip() and slide_texts[i].strip()
    ]
    if len(valid_indices) < n:
        dropped = n - len(valid_indices)
        print(f"[warn] Dropped {dropped} slides with empty explanation or slide text.", file=sys.stderr)
        rows = [rows[i] for i in valid_indices]
        explanation_texts = [explanation_texts[i] for i in valid_indices]
        slide_texts = [slide_texts[i] for i in valid_indices]
        n = len(rows)

    if n == 0:
        raise SystemExit("No valid slides after filtering empty text.")

    # All texts together for fitting (TF-IDF needs to see all)
    all_texts = explanation_texts + slide_texts

    # ---------------------------------------------------------------------------
    # Select embedding method
    # ---------------------------------------------------------------------------
    method_used = None
    query_vecs: np.ndarray | None = None
    corpus_vecs: np.ndarray | None = None

    api_key = os.environ.get("TEXT_API_KEY") or os.environ.get("API_KEY")
    base_url = os.environ.get("TEXT_BASE_URL") or os.environ.get("BASE_URL")

    use_embedding = args.method in ("auto", "embedding")
    use_tfidf = args.method == "tfidf"

    if use_embedding and api_key and base_url:
        print(f"Embedding method: API ({EMBEDDING_MODEL} via {base_url})")
        print(f"Embedding {n} explanations …")
        q_vecs = get_api_embeddings(explanation_texts, api_key, base_url)
        if q_vecs is not None:
            print(f"Embedding {n} slide texts …")
            c_vecs = get_api_embeddings(slide_texts, api_key, base_url)
            if c_vecs is not None:
                query_vecs = q_vecs
                corpus_vecs = c_vecs
                method_used = f"API ({EMBEDDING_MODEL})"

    if query_vecs is None and args.method in ("auto",):
        print("API embeddings unavailable, trying sentence-transformers …")
        combined = get_st_embeddings(all_texts)
        if combined is not None:
            query_vecs = combined[:n]
            corpus_vecs = combined[n:]
            method_used = "sentence-transformers (paraphrase-multilingual-MiniLM-L12-v2)"

    if query_vecs is None or use_tfidf:
        if use_tfidf:
            print("Embedding method: TF-IDF (forced)")
        else:
            print("Falling back to TF-IDF …")
        # TF-IDF: fit on all texts, then split
        from sklearn.feature_extraction.text import TfidfVectorizer
        vec = TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=(2, 4),
            max_features=8192,
            sublinear_tf=True,
        )
        combined_mat = vec.fit_transform(all_texts).toarray().astype(np.float32)
        query_vecs = combined_mat[:n]
        corpus_vecs = combined_mat[n:]
        method_used = "TF-IDF (char 2-4gram)"

    # ---------------------------------------------------------------------------
    # Compute similarity and recall
    # ---------------------------------------------------------------------------
    print(f"\nComputing cosine similarity matrix ({n}×{n}) …")
    sim = cosine_sim_matrix(query_vecs, corpus_vecs)

    k1, correct1 = compute_recall(sim, k=1)
    k5_actual = min(5, n)
    k5, correct5 = compute_recall(sim, k=k5_actual)

    # Per-slide details
    per_slide = []
    for i, row in enumerate(rows):
        top5_idx = np.argsort(sim[i])[::-1][:5].tolist()
        per_slide.append({
            "exp_id": row["exp_id"],
            "slide_id": row["slide_id"],
            "document_id": row["document_id"],
            "filename": row["filename"],
            "page_num": row["page_num"],
            "rank_of_correct": int(np.where(np.argsort(sim[i])[::-1] == i)[0][0]) + 1,
            "top5_indices": top5_idx,
            "correct_at_1": int(top5_idx[0] == i),
            "correct_at_5": int(i in top5_idx),
        })

    # ---------------------------------------------------------------------------
    # Print results
    # ---------------------------------------------------------------------------
    print()
    print("=" * 55)
    print(f"Retrieval Evaluation — user: {args.user} (N={n})")
    print(f"Embedding method: {method_used}")
    print()
    print(f"Recall@1:  {k1:.2f}  ({correct1}/{n} correct)")
    print(f"Recall@{k5_actual}:  {k5:.2f}  ({correct5}/{n} correct)")
    print()
    target = 0.80
    status = "PASS" if k1 >= target else "FAIL"
    print(f"Target: Recall@1 >= {target:.2f} -> {'✅' if status == 'PASS' else '❌'} {status}")

    # ---------------------------------------------------------------------------
    # Save results
    # ---------------------------------------------------------------------------
    output_dir = PROJECT_ROOT / "tools" / "eval_results"
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = output_dir / f"retrieval_{timestamp}.json"

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at": datetime.now().isoformat(),
                "user": args.user,
                "n": n,
                "method": method_used,
                "recall_at_1": k1,
                "recall_at_5": k5,
                "correct_at_1": correct1,
                "correct_at_5": correct5,
                "per_slide": per_slide,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(f"\nResults saved to: {output_path}")


if __name__ == "__main__":
    main()
