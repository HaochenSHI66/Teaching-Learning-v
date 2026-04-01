from __future__ import annotations

import json
import logging
import os
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from app.middleware.rate_limit import rate_limit
from sqlmodel import Session, select

from app.api.deps import get_db_session, require_document_owner
from app.auth import get_current_user
from app.models import Concept, ConceptRelation, Document, Flashcard, Slide, SlideExplanation, User
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
CHUNK_SIZE = 6  # pages per LLM call (reduced from 12 to prevent JSON truncation)

CONCEPT_EXTRACT_PROMPT = """你是一个专业的学术知识图谱提取引擎。你的任务是从PPT讲解内容中精确提取核心概念和它们之间的逻辑关系，构建高质量的知识图谱。

═══ 概念提取规则 ═══

数量：根据文档复杂度提取 15-40 个概念。简单主题取下限，复杂主题取上限。

命名规范：
- 使用精确的学术术语，不要泛化。例如用"梯度下降法(Gradient Descent)"而非"优化方法"，用"B+树"而非"树结构"
- 中文为主，重要英文术语用括号附注，如"反向传播(Backpropagation)"、"时间复杂度(Time Complexity)"
- 避免提取元概念：不要提取"总结"、"目录"、"引言"、"本章内容"、"课程大纲"等非知识性条目
- 去重：如果两个名称指向同一概念（如"BP算法"和"反向传播"），只保留更规范的那个

概念类型覆盖（尽量全面）：
- 定义与术语：核心定义、专业名词
- 定理与公式：数学定理、推导公式、重要等式
- 算法与方法：具体算法步骤、方法论
- 数据结构：具体的数据组织方式
- 关键示例：文档中用于说明概念的重要例子（仅当例子本身有教学价值时提取）

描述要求：
- 每个概念必须附带1-2句有意义的描述，说明"这个概念是什么"或"这个概念解决什么问题"
- 不要写空洞的描述如"一个重要的概念"。要写具体内容，如"一种基于梯度信息迭代更新参数以最小化损失函数的优化算法"

页码标注（slide_nums）：
- 标注该概念出现的**所有页码**，包括定义、推导、举例、提及
- 宁多勿少——只要该页内容涉及到这个概念就应该标注

重要度评分（importance）：
- 5：文档的核心主题概念，贯穿全文
- 4：在多页中被深入讨论的主要概念
- 3：重要的支撑概念，有专门段落讲解
- 2：简要提及的次要概念
- 1：外围/切线性质的概念

═══ 关系提取规则 ═══

关系类型（4种）：
1. "prerequisite"：A 是理解 B 的逻辑前提。这是最重要的关系类型，但要严格把关——只有真正的逻辑依赖才算。问自己："不懂 A 的人能否理解 B？"如果不能，才建立此关系。
2. "related"：A 和 B 在主题上相关，但没有前置依赖关系，常常在同一上下文中出现。
3. "part_of"：A 是 B 的子概念、组成部分或特例。例如"快速排序" part_of "排序算法"。
4. "contrast"：A 和 B 在文档中被明确对比或比较。例如"BFS" contrast "DFS"。

关系数量指导：
- 目标边数 = 概念数 x 1.5 到 概念数 x 2.5
- 每个概念至少要有1条关系，不要出现孤立节点
- 不要建立自环（source 和 target 相同）
- prerequisite 关系应占总关系数的 30-50%

好的 prerequisite 示例：
- "矩阵乘法" → "特征值分解"：特征值分解的计算过程依赖矩阵乘法运算
- "条件概率" → "贝叶斯定理"：贝叶斯定理是条件概率的直接推论
- "二叉树" → "二叉搜索树"：二叉搜索树在二叉树结构上增加了有序性约束
- "损失函数" → "梯度下降法"：梯度下降法通过计算损失函数的梯度来优化参数

═══ 输入内容 ═══

以下是PPT各页面的讲解内容：
{explanations}

═══ 输出格式 ═══

输出纯JSON，不要用```markdown标记包裹，不要添加任何注释：
{{
  "concepts": [
    {{
      "name": "概念名称(English Term)",
      "description": "1-2句精确描述该概念的定义或作用",
      "slide_nums": [1, 3, 5],
      "importance": 4
    }}
  ],
  "relations": [
    {{
      "source": "前置概念A",
      "target": "依赖概念B",
      "type": "prerequisite"
    }}
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
    """Parse JSON from LLM output, with truncation repair."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1]
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]
    cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to repair truncated JSON by closing open brackets
        repaired = cleaned
        # Count open/close braces and brackets
        open_braces = repaired.count("{") - repaired.count("}")
        open_brackets = repaired.count("[") - repaired.count("]")
        # Trim back to last complete item (find last '},')
        last_complete = max(repaired.rfind("},"), repaired.rfind("}]"))
        if last_complete > 0:
            repaired = repaired[: last_complete + 1]
            # Close remaining open brackets/braces
            open_brackets = repaired.count("[") - repaired.count("]")
            open_braces = repaired.count("{") - repaired.count("}")
            repaired += "]" * max(0, open_brackets)
            repaired += "}" * max(0, open_braces)
            try:
                result = json.loads(repaired)
                logger.warning("Repaired truncated JSON (trimmed %d chars)", len(cleaned) - len(repaired))
                return result
            except json.JSONDecodeError:
                pass
        # If repair fails, raise original error
        raise


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


def _normalize_concept_name(name: str) -> str:
    """Normalize a concept name for deduplication comparison.

    Strips whitespace, normalizes Chinese/English parentheses, and lowercases
    any ASCII portions for matching.
    """
    n = name.strip()
    # Unify parentheses: Chinese fullwidth -> ASCII
    n = n.replace("\uff08", "(").replace("\uff09", ")")
    # Collapse multiple spaces
    n = " ".join(n.split())
    # Lowercase ASCII portions only (preserve CJK)
    result = []
    for ch in n:
        if ch.isascii():
            result.append(ch.lower())
        else:
            result.append(ch)
    return ''.join(result)


def _are_similar_concepts(a: str, b: str) -> bool:
    """Return True if two concept names are similar enough to merge.

    Similarity criteria: one name is a substring of the other and covers >80%
    of the shorter name's length, OR the normalized forms are identical.
    """
    na = _normalize_concept_name(a)
    nb = _normalize_concept_name(b)
    if na == nb:
        return True
    shorter, longer = (na, nb) if len(na) <= len(nb) else (nb, na)
    if not shorter:
        return False
    # If the shorter name is contained in the longer one and is >80% of the
    # longer name's length, treat them as the same concept.
    if shorter in longer and len(shorter) / len(longer) > 0.8:
        return True
    return False


def _merge_chunk_results(
    chunk_results: list[dict],
    page_to_slide: dict[int, str],
) -> tuple[list[dict], list[dict]]:
    """Merge and deduplicate concepts from multiple chunk results.

    Returns (merged_concepts, filtered_relations) where:
    - Concepts are deduplicated by exact name and fuzzy similarity
    - Relations only include edges where both endpoints exist
    - Duplicate edges (same source+target+type) are removed
    """
    # ── Phase 1: collect raw concepts and normalize names ──
    raw_concepts: list[dict] = []  # list of (normalized_name, original_item, slide_ids)
    for result in chunk_results:
        for item in result.get("concepts", []):
            name = _normalize_concept_name(item.get("name", ""))
            if not name:
                continue
            slide_nums = item.get("slide_nums", [])
            slide_ids = [page_to_slide[pn] for pn in slide_nums if pn in page_to_slide]
            raw_concepts.append({
                "name": name,
                "description": item.get("description", ""),
                "slide_ids": slide_ids,
                "importance": item.get("importance", 3),
            })

    # ── Phase 2: deduplicate with fuzzy matching ──
    # Maps normalized canonical name -> merged concept dict
    concept_map: dict[str, dict] = {}
    # Maps any name variant -> canonical name (for relation remapping)
    name_alias: dict[str, str] = {}

    for rc in raw_concepts:
        name = rc["name"]
        # Check if this name matches an existing canonical name
        canonical = name_alias.get(name)
        if canonical is None:
            # Try fuzzy match against all existing canonical names
            for existing_name in list(concept_map.keys()):
                if _are_similar_concepts(name, existing_name):
                    canonical = existing_name
                    break

        if canonical is not None:
            # Merge into existing concept
            existing = concept_map[canonical]
            existing_ids = set(existing["slide_ids"])
            existing_ids.update(rc["slide_ids"])
            existing["slide_ids"] = list(existing_ids)
            # Keep the longer description
            if len(rc["description"]) > len(existing["description"]):
                existing["description"] = rc["description"]
            # Keep the higher importance
            existing["importance"] = max(existing["importance"], rc["importance"])
            # If the new name is longer (more specific), adopt it as canonical
            if len(name) > len(canonical):
                concept_map[name] = concept_map.pop(canonical)
                concept_map[name]["name"] = name
                name_alias[canonical] = name
                name_alias[name] = name
            else:
                name_alias[name] = canonical
        else:
            # New concept
            concept_map[name] = {
                "name": name,
                "description": rc["description"],
                "slide_ids": rc["slide_ids"],
                "importance": rc["importance"],
            }
            name_alias[name] = name

    # ── Phase 3: collect and filter relations ──
    valid_names = set(concept_map.keys())

    def _resolve_name(n: str) -> str | None:
        """Resolve a relation endpoint to a canonical concept name."""
        normalized = _normalize_concept_name(n)
        # Direct alias lookup
        if normalized in name_alias:
            canon = name_alias[normalized]
            if canon in valid_names:
                return canon
        # Direct match
        if normalized in valid_names:
            return normalized
        # Fuzzy fallback for relation endpoints
        for vn in valid_names:
            if _are_similar_concepts(normalized, vn):
                return vn
        return None

    all_relations: list[dict] = []
    seen_relations: set[tuple[str, str, str]] = set()
    for result in chunk_results:
        for item in result.get("relations", []):
            source = _resolve_name(item.get("source", ""))
            target = _resolve_name(item.get("target", ""))
            rel_type = item.get("type", "related")
            if source and target and source != target:
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
    failed_chunks = 0
    for chunk in chunks:
        try:
            result = _call_llm_for_chunk(gateway, chunk)
            chunk_results.append(result)
        except Exception as exc:
            failed_chunks += 1
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

    if failed_chunks:
        logger.warning(
            "Knowledge graph for %s: %d/%d chunks failed — graph may be incomplete",
            document_id,
            failed_chunks,
            len(chunks),
        )

    # Merge results across chunks
    merged_concepts, merged_relations = _merge_chunk_results(chunk_results, page_to_slide)

    # ── Post-processing validation ──
    # 1. Build set of concept names referenced by at least one relation
    names_in_relations: set[str] = set()
    for rel in merged_relations:
        names_in_relations.add(rel["source"])
        names_in_relations.add(rel["target"])

    # 2. Remove orphan concepts — only low-importance ones (importance <= 2)
    merged_concepts = [
        c for c in merged_concepts
        if c["name"] in names_in_relations or c.get("importance", 3) > 2
    ]

    # 3. Rebuild valid names after orphan removal and filter edges
    valid_concept_names = {c["name"] for c in merged_concepts}
    seen_edges: set[tuple[str, str, str]] = set()
    validated_relations: list[dict] = []
    for rel in merged_relations:
        src, tgt, rtype = rel["source"], rel["target"], rel["type"]
        if src in valid_concept_names and tgt in valid_concept_names and src != tgt:
            edge_key = (src, tgt, rtype)
            if edge_key not in seen_edges:
                seen_edges.add(edge_key)
                validated_relations.append(rel)
    merged_relations = validated_relations

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
            importance=item.get("importance", 3),
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
    current_user: User = Depends(get_current_user),
) -> KnowledgeGraphResponse:
    require_document_owner(document_id, current_user.id, session)

    concepts = session.exec(
        select(Concept).where(Concept.document_id == document_id)
    ).all()
    relations = session.exec(
        select(ConceptRelation).where(ConceptRelation.document_id == document_id)
    ).all()

    return KnowledgeGraphResponse(
        document_id=document_id,
        nodes=[
            ConceptRead(id=c.id, name=c.name, description=c.description, slide_ids=c.slide_ids, importance=c.importance)
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
    current_user: User = Depends(get_current_user),
    _rate_limit=Depends(rate_limit(3, 60, "knowledge_graph_generate")),
) -> KnowledgeGraphGenerateResponse:
    require_document_owner(document_id, current_user.id, session)

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
    current_user: User = Depends(get_current_user),
) -> ConceptsBySlideResponse:
    require_document_owner(document_id, current_user.id, session)

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
            ConceptRead(id=p.id, name=p.name, description=p.description, slide_ids=p.slide_ids, importance=p.importance)
            for p in prereqs_for.get(c.id, [])
        ]
        items.append(
            ConceptsBySlideItem(
                concept=ConceptRead(
                    id=c.id, name=c.name, description=c.description, slide_ids=c.slide_ids, importance=c.importance
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
    current_user: User = Depends(get_current_user),
) -> PrerequisiteChainResponse:
    require_document_owner(document_id, current_user.id, session)

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
        # Don't include the target concept itself in its own prerequisite chain
        if cid != concept_id:
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
                ConceptRead(id=c.id, name=c.name, description=c.description, slide_ids=c.slide_ids, importance=c.importance)
            )

    return PrerequisiteChainResponse(
        document_id=document_id,
        concept_id=concept_id,
        chain=chain_reads,
    )
