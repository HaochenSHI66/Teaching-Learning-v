from __future__ import annotations

import json
import logging
import os
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.models import Concept, ConceptRelation, Document, Flashcard, Slide, SlideExplanation
from app.schemas import (
    ConceptRead,
    ConceptRelationRead,
    ConceptsBySlideItem,
    ConceptsBySlideResponse,
    KnowledgeGraphGenerateResponse,
    KnowledgeGraphResponse,
    PrerequisiteChainResponse,
)
from app.services.model_gateway import ModelGateway

router = APIRouter(prefix="/api/v1/knowledge-graph", tags=["knowledge-graph"])
logger = logging.getLogger(__name__)

# ── Chunked generation settings ──────────────────────────────────
CHUNK_SIZE = 12  # pages per LLM call (within the 10-15 range)

CONCEPT_EXTRACT_PROMPT = """你是一个知识图谱提取助手。请从以下PPT讲解内容中提取关键概念及其关系。

要求：
- 提取 10-30 个核心概念（名词/术语）
- 每个概念附带一句话描述
- 标注概念出现的页码（slide_nums），使用讲解内容中标注的 Page 数字
- 积极识别 prerequisite（前置知识）关系——这是最有价值的关系类型。如果理解概念 B 需要先理解概念 A，则 A 是 B 的前置知识
- 同时识别 related（相关）、part_of（从属）、contrast（对比）关系
- 输出严格JSON格式

以下是好的 prerequisite 关系示例，供参考：
1. "线性代数" → "特征值分解"：理解特征值分解需要先掌握线性代数中的矩阵运算和向量空间
2. "概率论" → "贝叶斯定理"：贝叶斯定理建立在条件概率的基础之上
3. "数据结构-树" → "二叉搜索树"：二叉搜索树是树这一数据结构的特殊化应用

请尽可能多地识别 prerequisite 关系。对于每个概念，思考"学习这个概念之前需要掌握什么"，如果那个前置知识也在概念列表中，就建立 prerequisite 关系。

所有页面讲解内容：
{explanations}

输出格式（纯JSON，不要```标记）：
{{
  "concepts": [
    {{"name": "概念名", "description": "一句话描述", "slide_nums": [1, 3, 5]}}
  ],
  "relations": [
    {{"source": "前置概念A", "target": "概念B", "type": "prerequisite"}}
  ]
}}"""


def _get_document_or_404(session: Session, document_id: str) -> Document:
    doc = session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def _create_text_gateway(timeout: float = 120.0) -> ModelGateway:
    """Create a ModelGateway configured with the TEXT model env vars."""
    return ModelGateway(
        api_key=os.getenv("TEXT_API_KEY"),
        base_url=os.getenv("TEXT_BASE_URL"),
        model=os.getenv("TEXT_MODEL"),
        timeout=timeout,
    )


def _parse_llm_json(raw: str) -> dict:
    """Parse JSON from LLM output, stripping markdown fences if present."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1]
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]
    return json.loads(cleaned.strip())


def _chunk_explanations(
    explanations: list[SlideExplanation],
    chunk_size: int = CHUNK_SIZE,
) -> list[list[SlideExplanation]]:
    """Split explanations into chunks of chunk_size pages each."""
    chunks: list[list[SlideExplanation]] = []
    for i in range(0, len(explanations), chunk_size):
        chunks.append(explanations[i : i + chunk_size])
    return chunks


def _call_llm_for_chunk(
    gateway: ModelGateway,
    chunk: list[SlideExplanation],
) -> dict:
    """Call the LLM for one chunk of explanations and return parsed JSON."""
    text_parts = []
    for exp in chunk:
        text_parts.append(f"--- Page {exp.page_num} ---\n{exp.markdown}")
    combined = "\n\n".join(text_parts)

    prompt = CONCEPT_EXTRACT_PROMPT.format(explanations=combined)
    raw = gateway.generate_text_markdown(prompt=prompt).strip()
    return _parse_llm_json(raw)


def _merge_chunk_results(
    chunk_results: list[dict],
    page_to_slide: dict[int, str],
) -> tuple[list[dict], list[dict]]:
    """Merge and deduplicate concepts from multiple chunk results.

    Returns (merged_concepts, filtered_relations) where:
    - Concepts are deduplicated by name (slide_ids merged)
    - Relations only include edges where both endpoints exist
    """
    # Deduplicate concepts by name
    concept_map: dict[str, dict] = {}  # name -> concept dict
    for result in chunk_results:
        for item in result.get("concepts", []):
            name = item.get("name", "").strip()
            if not name:
                continue
            slide_nums = item.get("slide_nums", [])
            slide_ids = [page_to_slide[pn] for pn in slide_nums if pn in page_to_slide]
            if name in concept_map:
                # Merge slide_ids (deduplicate)
                existing_ids = set(concept_map[name]["slide_ids"])
                existing_ids.update(slide_ids)
                concept_map[name]["slide_ids"] = list(existing_ids)
                # Keep the longer description
                if len(item.get("description", "")) > len(concept_map[name].get("description", "")):
                    concept_map[name]["description"] = item.get("description", "")
            else:
                concept_map[name] = {
                    "name": name,
                    "description": item.get("description", ""),
                    "slide_ids": slide_ids,
                }

    # Collect all concept names for relation filtering
    valid_names = set(concept_map.keys())

    # Collect and filter relations
    all_relations: list[dict] = []
    seen_relations: set[tuple[str, str, str]] = set()
    for result in chunk_results:
        for item in result.get("relations", []):
            source = item.get("source", "").strip()
            target = item.get("target", "").strip()
            rel_type = item.get("type", "related")
            if source in valid_names and target in valid_names and source != target:
                key = (source, target, rel_type)
                if key not in seen_relations:
                    seen_relations.add(key)
                    all_relations.append({
                        "source": source,
                        "target": target,
                        "type": rel_type,
                    })

    return list(concept_map.values()), all_relations


def generate_knowledge_graph_for_document(
    session: Session,
    document_id: str,
) -> tuple[int, int]:
    """Core graph generation logic, callable from endpoints and background tasks.

    Returns (concept_count, relation_count).
    """
    doc = session.get(Document, document_id)
    if not doc:
        raise ValueError(f"Document {document_id} not found")

    explanations = session.exec(
        select(SlideExplanation)
        .where(SlideExplanation.document_id == document_id)
        .order_by(SlideExplanation.page_num)
    ).all()
    if not explanations:
        raise ValueError("No explanations available")

    # Build page_num -> slide_id map
    slides = session.exec(
        select(Slide).where(Slide.document_id == document_id)
    ).all()
    page_to_slide: dict[int, str] = {s.page_num: s.id for s in slides}

    gateway = _create_text_gateway(timeout=120.0)
    if not gateway.is_configured():
        raise RuntimeError("Text model gateway not configured")

    # Chunked generation
    chunks = _chunk_explanations(explanations, CHUNK_SIZE)
    chunk_results: list[dict] = []
    for chunk in chunks:
        try:
            result = _call_llm_for_chunk(gateway, chunk)
            chunk_results.append(result)
        except Exception as exc:
            logger.error(
                "Knowledge graph chunk failed for %s (pages %s-%s): %s",
                document_id,
                chunk[0].page_num if chunk else "?",
                chunk[-1].page_num if chunk else "?",
                exc,
            )
            # Continue with other chunks rather than failing entirely
            continue

    if not chunk_results:
        raise RuntimeError("All knowledge graph generation chunks failed")

    # Merge results across chunks
    merged_concepts, merged_relations = _merge_chunk_results(chunk_results, page_to_slide)

    # Delete existing concepts and relations for this document
    old_relations = session.exec(
        select(ConceptRelation).where(ConceptRelation.document_id == document_id)
    ).all()
    for r in old_relations:
        session.delete(r)
    old_concepts = session.exec(
        select(Concept).where(Concept.document_id == document_id)
    ).all()
    for c in old_concepts:
        session.delete(c)
    session.commit()

    # Insert new concepts
    name_to_id: dict[str, str] = {}
    concept_count = 0
    for item in merged_concepts:
        concept = Concept(
            document_id=document_id,
            name=item["name"],
            description=item.get("description", ""),
            slide_ids=item.get("slide_ids", []),
        )
        session.add(concept)
        session.commit()
        session.refresh(concept)
        name_to_id[concept.name] = concept.id
        concept_count += 1

    # Insert relations
    relation_count = 0
    for item in merged_relations:
        source_id = name_to_id.get(item["source"])
        target_id = name_to_id.get(item["target"])
        if not source_id or not target_id:
            continue
        relation = ConceptRelation(
            document_id=document_id,
            source_id=source_id,
            target_id=target_id,
            relation_type=item.get("type", "related"),
        )
        session.add(relation)
        relation_count += 1

    session.commit()
    return concept_count, relation_count


# ── GET graph ─────────────────────────────────────────────────────

@router.get("/{document_id}", response_model=KnowledgeGraphResponse)
def get_knowledge_graph(
    document_id: str,
    session: Session = Depends(get_db_session),
) -> KnowledgeGraphResponse:
    _get_document_or_404(session, document_id)

    concepts = session.exec(
        select(Concept).where(Concept.document_id == document_id)
    ).all()
    relations = session.exec(
        select(ConceptRelation).where(ConceptRelation.document_id == document_id)
    ).all()

    return KnowledgeGraphResponse(
        document_id=document_id,
        nodes=[
            ConceptRead(id=c.id, name=c.name, description=c.description, slide_ids=c.slide_ids)
            for c in concepts
        ],
        edges=[
            ConceptRelationRead(id=r.id, source_id=r.source_id, target_id=r.target_id, relation_type=r.relation_type)
            for r in relations
        ],
    )


# ── POST generate ────────────────────────────────────────────────

@router.post("/{document_id}/generate", response_model=KnowledgeGraphGenerateResponse)
def generate_knowledge_graph(
    document_id: str,
    session: Session = Depends(get_db_session),
) -> KnowledgeGraphGenerateResponse:
    _get_document_or_404(session, document_id)

    explanations = session.exec(
        select(SlideExplanation)
        .where(SlideExplanation.document_id == document_id)
    ).all()
    if not explanations:
        raise HTTPException(status_code=409, detail="No explanations available")

    try:
        concept_count, relation_count = generate_knowledge_graph_for_document(
            session, document_id
        )
    except RuntimeError as exc:
        if "not configured" in str(exc).lower():
            raise HTTPException(status_code=503, detail="Model gateway not configured")
        raise HTTPException(status_code=502, detail=f"Model call failed: {exc}")
    except Exception as exc:
        logger.error("Knowledge graph generation failed for %s: %s", document_id, exc)
        raise HTTPException(status_code=502, detail=f"Model call failed: {exc}")

    return KnowledgeGraphGenerateResponse(
        document_id=document_id,
        concept_count=concept_count,
        relation_count=relation_count,
    )


# ── GET concepts-by-slide ────────────────────────────────────────

@router.get(
    "/{document_id}/concepts-by-slide/{slide_id}",
    response_model=ConceptsBySlideResponse,
)
def get_concepts_by_slide(
    document_id: str,
    slide_id: str,
    session: Session = Depends(get_db_session),
) -> ConceptsBySlideResponse:
    _get_document_or_404(session, document_id)

    # Verify slide exists and belongs to document
    slide = session.get(Slide, slide_id)
    if not slide or slide.document_id != document_id:
        raise HTTPException(status_code=404, detail="Slide not found")

    # Get all concepts for this document
    concepts = session.exec(
        select(Concept).where(Concept.document_id == document_id)
    ).all()

    # Filter concepts that appear on this slide
    slide_concepts = [c for c in concepts if slide_id in (c.slide_ids or [])]

    if not slide_concepts:
        return ConceptsBySlideResponse(document_id=document_id, slide_id=slide_id, items=[])

    # Get all prerequisite relations for this document
    prereq_relations = session.exec(
        select(ConceptRelation).where(
            ConceptRelation.document_id == document_id,
            ConceptRelation.relation_type == "prerequisite",
        )
    ).all()

    # Build map: target_id -> list of source concepts (prerequisites)
    concept_by_id = {c.id: c for c in concepts}
    prereqs_for: dict[str, list[Concept]] = defaultdict(list)
    for rel in prereq_relations:
        if rel.source_id in concept_by_id:
            prereqs_for[rel.target_id].append(concept_by_id[rel.source_id])

    # Count flashcards by slide overlap for each concept
    flashcards = session.exec(
        select(Flashcard).where(Flashcard.document_id == document_id)
    ).all()

    def _flashcard_count_for_concept(concept: Concept) -> int:
        concept_slide_set = set(concept.slide_ids or [])
        if not concept_slide_set:
            return 0
        return sum(1 for fc in flashcards if fc.slide_id in concept_slide_set)

    items = []
    for c in slide_concepts:
        prereq_reads = [
            ConceptRead(id=p.id, name=p.name, description=p.description, slide_ids=p.slide_ids)
            for p in prereqs_for.get(c.id, [])
        ]
        items.append(
            ConceptsBySlideItem(
                concept=ConceptRead(
                    id=c.id, name=c.name, description=c.description, slide_ids=c.slide_ids
                ),
                prerequisites=prereq_reads,
                flashcard_count=_flashcard_count_for_concept(c),
            )
        )

    return ConceptsBySlideResponse(
        document_id=document_id,
        slide_id=slide_id,
        items=items,
    )


# ── GET prerequisite chain ───────────────────────────────────────

@router.get(
    "/{document_id}/concepts/{concept_id}/prerequisites",
    response_model=PrerequisiteChainResponse,
)
def get_prerequisite_chain(
    document_id: str,
    concept_id: str,
    session: Session = Depends(get_db_session),
) -> PrerequisiteChainResponse:
    _get_document_or_404(session, document_id)

    target = session.get(Concept, concept_id)
    if not target or target.document_id != document_id:
        raise HTTPException(status_code=404, detail="Concept not found")

    # Get all prerequisite relations for this document
    prereq_relations = session.exec(
        select(ConceptRelation).where(
            ConceptRelation.document_id == document_id,
            ConceptRelation.relation_type == "prerequisite",
        )
    ).all()

    # Build map: target_id -> list of source_ids (prerequisites)
    prereqs_map: dict[str, list[str]] = defaultdict(list)
    for rel in prereq_relations:
        prereqs_map[rel.target_id].append(rel.source_id)

    # Recursive traversal with cycle detection and depth limit
    MAX_DEPTH = 5
    chain: list[str] = []
    visited: set[str] = set()

    def _traverse(cid: str, depth: int) -> None:
        if depth > MAX_DEPTH or cid in visited:
            return
        visited.add(cid)
        for prereq_id in prereqs_map.get(cid, []):
            if prereq_id not in visited:
                _traverse(prereq_id, depth + 1)
        chain.append(cid)

    _traverse(concept_id, 0)

    # Load concept objects for the chain
    concept_ids_set = set(chain)
    all_concepts = session.exec(
        select(Concept).where(
            Concept.document_id == document_id,
            Concept.id.in_(list(concept_ids_set)),
        )
    ).all()
    concept_by_id = {c.id: c for c in all_concepts}

    chain_reads = []
    for cid in chain:
        c = concept_by_id.get(cid)
        if c:
            chain_reads.append(
                ConceptRead(id=c.id, name=c.name, description=c.description, slide_ids=c.slide_ids)
            )

    return PrerequisiteChainResponse(
        document_id=document_id,
        concept_id=concept_id,
        chain=chain_reads,
    )
