from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.models import Concept, ConceptRelation, Document, Slide, SlideExplanation
from app.schemas import (
    ConceptRead,
    ConceptRelationRead,
    KnowledgeGraphGenerateResponse,
    KnowledgeGraphResponse,
)
from app.services.model_gateway import ModelGateway

router = APIRouter(prefix="/api/v1/knowledge-graph", tags=["knowledge-graph"])
logger = logging.getLogger(__name__)


def _get_document_or_404(session: Session, document_id: str) -> Document:
    doc = session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


CONCEPT_EXTRACT_PROMPT = """你是一个知识图谱提取助手。请从以下PPT讲解内容中提取关键概念及其关系。

要求：
- 提取 10-30 个核心概念（名词/术语）
- 每个概念附带一句话描述
- 标注概念出现的页码（slide_nums）
- 识别概念间关系：prerequisite（前置知识）、related（相关）、part_of（从属）、contrast（对比）
- 输出严格JSON格式

所有页面讲解内容：
{explanations}

输出格式（纯JSON，不要```标记）：
{{
  "concepts": [
    {{"name": "概念名", "description": "一句话描述", "slide_nums": [1, 3, 5]}}
  ],
  "relations": [
    {{"source": "概念A", "target": "概念B", "type": "related"}}
  ]
}}"""


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


@router.post("/{document_id}/generate", response_model=KnowledgeGraphGenerateResponse)
def generate_knowledge_graph(
    document_id: str,
    session: Session = Depends(get_db_session),
) -> KnowledgeGraphGenerateResponse:
    doc = _get_document_or_404(session, document_id)

    explanations = session.exec(
        select(SlideExplanation)
        .where(SlideExplanation.document_id == document_id)
        .order_by(SlideExplanation.page_num)
    ).all()
    if not explanations:
        raise HTTPException(status_code=409, detail="No explanations available")

    # Build page_num -> slide_id map
    slides = session.exec(
        select(Slide).where(Slide.document_id == document_id)
    ).all()
    page_to_slide: dict[int, str] = {s.page_num: s.id for s in slides}

    # Combine all explanations
    combined = "\n\n".join(
        f"--- Page {exp.page_num} ---\n{exp.markdown}" for exp in explanations
    )

    gateway = ModelGateway(timeout=15.0)
    if not gateway.is_configured():
        raise HTTPException(status_code=503, detail="Model gateway not configured")

    prompt = CONCEPT_EXTRACT_PROMPT.format(explanations=combined)
    raw = gateway.generate_text_markdown(prompt=prompt).strip()

    # Parse
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1]
        if cleaned.endswith("```"):
            cleaned = cleaned.rsplit("```", 1)[0]
        data = json.loads(cleaned.strip())
    except (json.JSONDecodeError, IndexError):
        raise HTTPException(status_code=502, detail="Failed to parse knowledge graph response")

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
    for item in data.get("concepts", []):
        slide_nums = item.get("slide_nums", [])
        slide_ids = [page_to_slide[pn] for pn in slide_nums if pn in page_to_slide]
        concept = Concept(
            document_id=document_id,
            name=item.get("name", ""),
            description=item.get("description", ""),
            slide_ids=slide_ids,
        )
        session.add(concept)
        session.commit()
        session.refresh(concept)
        name_to_id[concept.name] = concept.id
        concept_count += 1

    # Insert relations
    relation_count = 0
    for item in data.get("relations", []):
        source_name = item.get("source", "")
        target_name = item.get("target", "")
        source_id = name_to_id.get(source_name)
        target_id = name_to_id.get(target_name)
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

    return KnowledgeGraphGenerateResponse(
        document_id=document_id,
        concept_count=concept_count,
        relation_count=relation_count,
    )
