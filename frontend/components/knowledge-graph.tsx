"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchConceptPrerequisites,
  fetchKnowledgeGraph,
  generateKnowledgeGraph,
  type ConceptNode,
  type KnowledgeGraph as KGData,
  type PrerequisiteChainItem,
} from "@/lib/api";

// ── Importance → color palette mapping ──────────────────────────

type TagColor = {
  bg: string;
  border: string;
  text: string;
  dot: string;
  hoverBg: string;
  activeBg: string;
  activeBorder: string;
};

const TAG_PALETTES: Record<number, TagColor> = {
  5: {
    bg: "var(--concept-5-bg, rgba(201,123,92,0.12))",
    border: "var(--concept-5-border, rgba(201,123,92,0.28))",
    text: "var(--concept-5-text, var(--brand-terracotta))",
    dot: "var(--brand-terracotta)",
    hoverBg: "var(--concept-5-hover, rgba(201,123,92,0.18))",
    activeBg: "var(--concept-5-active, rgba(201,123,92,0.22))",
    activeBorder: "var(--brand-terracotta)",
  },
  4: {
    bg: "var(--concept-4-bg, rgba(214,164,91,0.12))",
    border: "var(--concept-4-border, rgba(214,164,91,0.28))",
    text: "var(--concept-4-text, var(--brand-amber))",
    dot: "var(--brand-amber)",
    hoverBg: "var(--concept-4-hover, rgba(214,164,91,0.18))",
    activeBg: "var(--concept-4-active, rgba(214,164,91,0.22))",
    activeBorder: "var(--brand-amber)",
  },
  3: {
    bg: "var(--concept-3-bg, rgba(111,140,104,0.10))",
    border: "var(--concept-3-border, rgba(111,140,104,0.22))",
    text: "var(--concept-3-text, var(--brand-sage))",
    dot: "var(--brand-sage)",
    hoverBg: "var(--concept-3-hover, rgba(111,140,104,0.16))",
    activeBg: "var(--concept-3-active, rgba(111,140,104,0.20))",
    activeBorder: "var(--brand-sage)",
  },
  2: {
    bg: "var(--concept-2-bg, rgba(114,144,166,0.10))",
    border: "var(--concept-2-border, rgba(114,144,166,0.22))",
    text: "var(--concept-2-text, var(--brand-blue))",
    dot: "var(--brand-blue)",
    hoverBg: "var(--concept-2-hover, rgba(114,144,166,0.16))",
    activeBg: "var(--concept-2-active, rgba(114,144,166,0.20))",
    activeBorder: "var(--brand-blue)",
  },
  1: {
    bg: "var(--concept-1-bg, rgba(127,135,99,0.10))",
    border: "var(--concept-1-border, rgba(127,135,99,0.22))",
    text: "var(--concept-1-text, var(--brand-olive))",
    dot: "var(--brand-olive)",
    hoverBg: "var(--concept-1-hover, rgba(127,135,99,0.16))",
    activeBg: "var(--concept-1-active, rgba(127,135,99,0.20))",
    activeBorder: "var(--brand-olive)",
  },
};

function getPalette(importance: number): TagColor {
  return TAG_PALETTES[Math.max(1, Math.min(5, importance))] ?? TAG_PALETTES[3];
}

const RELATION_LABELS: Record<string, string> = {
  prerequisite: "前置",
  related: "相关",
  part_of: "从属",
  contrast: "对比",
};

const RELATION_DOTS: Record<string, string> = {
  prerequisite: "var(--brand-terracotta)",
  related: "var(--brand-blue)",
  part_of: "var(--brand-sage)",
  contrast: "var(--brand-amber)",
};

function importanceStars(level: number): string {
  const clamped = Math.max(1, Math.min(5, level));
  return "★".repeat(clamped) + "☆".repeat(5 - clamped);
}

// ── Types ──────────────────────────────────────────────────────

type KnowledgeGraphProps = {
  documentId: string;
  onJumpToSlide?: (slideId: string) => void;
  disabled?: boolean;
};

type SortMode = "importance" | "name" | "relations";

// ── Main Component ────────────────────────────────────────────

export function KnowledgeGraphPanel({ documentId, onJumpToSlide, disabled }: KnowledgeGraphProps) {
  const [graph, setGraph] = useState<KGData | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [prerequisiteChain, setPrerequisiteChain] = useState<PrerequisiteChainItem[]>([]);
  const [prerequisiteLoading, setPrerequisiteLoading] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("importance");
  const [filterImportance, setFilterImportance] = useState<number | null>(null);

  // Fetch graph on mount
  useEffect(() => {
    setLoading(true);
    fetchKnowledgeGraph(documentId)
      .then(setGraph)
      .catch(() => setGraph(null))
      .finally(() => setLoading(false));
  }, [documentId]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      await generateKnowledgeGraph(documentId);
      const data = await fetchKnowledgeGraph(documentId);
      setGraph(data);
    } catch {
      // ignore
    } finally {
      setGenerating(false);
    }
  }, [documentId]);

  // Compute relation info per node
  const nodeRelations = useMemo(() => {
    if (!graph) return new Map<string, { type: string; targetName: string; targetId: string }[]>();
    const nameMap = new Map<string, string>();
    for (const n of graph.nodes) nameMap.set(n.id, n.name);

    const map = new Map<string, { type: string; targetName: string; targetId: string }[]>();
    for (const n of graph.nodes) map.set(n.id, []);

    for (const e of graph.edges) {
      const srcRels = map.get(e.source_id);
      const tgtRels = map.get(e.target_id);
      if (srcRels) {
        srcRels.push({
          type: e.relation_type,
          targetName: nameMap.get(e.target_id) ?? e.target_id,
          targetId: e.target_id,
        });
      }
      if (tgtRels) {
        tgtRels.push({
          type: e.relation_type,
          targetName: nameMap.get(e.source_id) ?? e.source_id,
          targetId: e.source_id,
        });
      }
    }
    return map;
  }, [graph]);

  // Relation count per node (for sorting)
  const relationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!graph) return counts;
    for (const n of graph.nodes) counts.set(n.id, 0);
    for (const e of graph.edges) {
      counts.set(e.source_id, (counts.get(e.source_id) ?? 0) + 1);
      counts.set(e.target_id, (counts.get(e.target_id) ?? 0) + 1);
    }
    return counts;
  }, [graph]);

  // Filter & sort
  const filteredNodes = useMemo(() => {
    if (!graph) return [];
    let nodes = [...graph.nodes];

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      nodes = nodes.filter(
        (n) => n.name.toLowerCase().includes(q) || n.description.toLowerCase().includes(q),
      );
    }

    // Importance filter
    if (filterImportance !== null) {
      nodes = nodes.filter((n) => (n.importance ?? 3) === filterImportance);
    }

    // Sort
    if (sortMode === "importance") {
      nodes.sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3));
    } else if (sortMode === "name") {
      nodes.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    } else if (sortMode === "relations") {
      nodes.sort((a, b) => (relationCounts.get(b.id) ?? 0) - (relationCounts.get(a.id) ?? 0));
    }

    return nodes;
  }, [graph, search, sortMode, filterImportance, relationCounts]);

  // Importance stats
  const importanceStats = useMemo(() => {
    if (!graph) return {};
    const stats: Record<number, number> = {};
    for (const n of graph.nodes) {
      const imp = n.importance ?? 3;
      stats[imp] = (stats[imp] ?? 0) + 1;
    }
    return stats;
  }, [graph]);

  // Toggle expand & fetch prerequisites
  const handleToggle = useCallback(
    (node: ConceptNode) => {
      if (expandedId === node.id) {
        setExpandedId(null);
        setPrerequisiteChain([]);
        return;
      }
      setExpandedId(node.id);
      setPrerequisiteLoading(true);
      setPrerequisiteChain([]);
      fetchConceptPrerequisites(documentId, node.id)
        .then((payload) => setPrerequisiteChain(payload.chain))
        .catch(() => setPrerequisiteChain([]))
        .finally(() => setPrerequisiteLoading(false));
    },
    [expandedId, documentId],
  );

  // Jump to related concept
  const handleJumpToConcept = useCallback((targetId: string) => {
    setExpandedId(targetId);
    // Scroll to element
    setTimeout(() => {
      const el = document.getElementById(`concept-${targetId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }, []);

  // ── Empty / Loading states ──

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[var(--tx-5)]">
        <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        加载中...
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--bd-2)] bg-[var(--sf-2)]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--tx-5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <circle cx="4" cy="7" r="2" />
            <circle cx="20" cy="7" r="2" />
            <circle cx="4" cy="17" r="2" />
            <circle cx="20" cy="17" r="2" />
            <line x1="9.5" y1="10.5" x2="5.5" y2="8.5" />
            <line x1="14.5" y1="10.5" x2="18.5" y2="8.5" />
            <line x1="9.5" y1="13.5" x2="5.5" y2="15.5" />
            <line x1="14.5" y1="13.5" x2="18.5" y2="15.5" />
          </svg>
        </div>
        <p className="text-[13px] text-[var(--tx-5)]">尚未生成知识概念</p>
        <button
          className="btn btn-primary !px-4 !py-2 !text-[13px]"
          disabled={disabled || generating}
          onClick={handleGenerate}
          type="button"
        >
          {generating ? "生成中..." : "生成知识概念"}
        </button>
        {generating && (
          <p className="text-[12px] text-[var(--tx-6)]">正在分析所有页面，可能需要 30 秒...</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* ── Toolbar: search + sort + regenerate ── */}
      <div className="shrink-0 flex items-center gap-2 px-1">
        <div className="relative flex-1">
          <svg
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--tx-6)]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="w-full rounded-xl border border-[var(--bd-1)] bg-[var(--sf-input)] py-1.5 pl-8 pr-3 text-[13px] text-[var(--tx-3)] outline-none placeholder:text-[var(--tx-6)] focus:border-[var(--brand-sage)]"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索概念..."
            value={search}
          />
        </div>
        <select
          className="shrink-0 rounded-xl border border-[var(--bd-1)] bg-[var(--sf-input)] px-2 py-1.5 text-[12px] text-[var(--tx-4)] outline-none"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
        >
          <option value="importance">按重要度</option>
          <option value="name">按名称</option>
          <option value="relations">按关联数</option>
        </select>
        <button
          className="shrink-0 rounded-xl border border-[var(--bd-2)] bg-[var(--sf-4)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--tx-4)] transition-colors hover:bg-[var(--sf-5)]"
          disabled={generating}
          onClick={handleGenerate}
          type="button"
        >
          {generating ? "生成中..." : "重新生成"}
        </button>
      </div>

      {/* ── Importance filter pills ── */}
      <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-1">
        <button
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all ${
            filterImportance === null
              ? "bg-[var(--tx-4)] text-[var(--sf-1)] shadow-sm"
              : "border border-[var(--bd-2)] bg-[var(--sf-2)] text-[var(--tx-5)] hover:bg-[var(--sf-4)]"
          }`}
          onClick={() => setFilterImportance(null)}
          type="button"
        >
          全部 {graph.nodes.length}
        </button>
        {[5, 4, 3, 2, 1].map((level) =>
          importanceStats[level] ? (
            <button
              key={level}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all ${
                filterImportance === level
                  ? "shadow-sm"
                  : "border border-[var(--bd-2)] hover:bg-[var(--sf-4)]"
              }`}
              style={
                filterImportance === level
                  ? { background: getPalette(level).dot, color: "#fff" }
                  : { background: getPalette(level).bg, color: getPalette(level).text }
              }
              onClick={() => setFilterImportance(filterImportance === level ? null : level)}
              type="button"
            >
              {"★".repeat(level)} {importanceStats[level]}
            </button>
          ) : null,
        )}
        <span className="ml-auto text-[11px] text-[var(--tx-6)]">
          {graph.edges.length} 关系
        </span>
      </div>

      {/* ── Concept Tag List ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {filteredNodes.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-[13px] text-[var(--tx-6)]">
            无匹配概念
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 content-start">
            {filteredNodes.map((node) => {
              const importance = node.importance ?? 3;
              const pal = getPalette(importance);
              const isExpanded = expandedId === node.id;
              const rels = nodeRelations.get(node.id) ?? [];
              const relCount = rels.length;

              return (
                <div
                  key={node.id}
                  id={`concept-${node.id}`}
                  className={`transition-all duration-200 ${isExpanded ? "w-full" : ""}`}
                >
                  {/* ── Tag pill ── */}
                  <button
                    className={`group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-all duration-200 ${
                      isExpanded
                        ? "rounded-b-none rounded-t-2xl border-b-0 w-full justify-between"
                        : "hover:shadow-sm active:scale-[0.97]"
                    }`}
                    style={{
                      background: isExpanded ? pal.activeBg : pal.bg,
                      borderColor: isExpanded ? pal.activeBorder : pal.border,
                      color: pal.text,
                    }}
                    onClick={() => handleToggle(node)}
                    type="button"
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: pal.dot }}
                      />
                      <span className="truncate">{node.name}</span>
                    </span>
                    {relCount > 0 && (
                      <span
                        className="shrink-0 ml-0.5 rounded-full px-1.5 py-0 text-[10px] font-semibold opacity-70"
                        style={{ background: pal.border, color: pal.text }}
                      >
                        {relCount}
                      </span>
                    )}
                    {isExpanded && (
                      <svg
                        className="ml-auto h-3.5 w-3.5 shrink-0 transition-transform"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    )}
                  </button>

                  {/* ── Expanded detail panel ── */}
                  {isExpanded && (
                    <div
                      className="animate-fade-slide-in w-full rounded-b-2xl border border-t-0 px-3.5 pb-3 pt-2"
                      style={{
                        background: pal.activeBg,
                        borderColor: pal.activeBorder,
                      }}
                    >
                      {/* Importance + description */}
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12px] leading-relaxed text-[var(--tx-3)]">
                          {node.description}
                        </p>
                        <span
                          className="shrink-0 text-[11px] tracking-tight"
                          style={{ color: pal.dot }}
                        >
                          {importanceStars(importance)}
                        </span>
                      </div>

                      {/* Related concepts as mini tags */}
                      {rels.length > 0 && (
                        <div className="mt-2.5">
                          <p className="mb-1 text-[11px] font-medium text-[var(--tx-5)]">关联概念</p>
                          <div className="flex flex-wrap gap-1">
                            {rels.map((rel, idx) => (
                              <button
                                key={`${rel.targetId}-${rel.type}-${idx}`}
                                className="inline-flex items-center gap-1 rounded-full border border-[var(--bd-2)] bg-[var(--sf-1)] px-2 py-0.5 text-[11px] text-[var(--tx-4)] transition-colors hover:bg-[var(--sf-3)]"
                                onClick={() => handleJumpToConcept(rel.targetId)}
                                type="button"
                              >
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-full"
                                  style={{ background: RELATION_DOTS[rel.type] ?? "var(--tx-6)" }}
                                />
                                <span className="text-[10px] opacity-60">{RELATION_LABELS[rel.type] ?? rel.type}</span>
                                <span>{rel.targetName}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Slide jump buttons */}
                      {node.slide_ids.length > 0 && (
                        <div className="mt-2.5">
                          <p className="mb-1 text-[11px] font-medium text-[var(--tx-5)]">出现页面</p>
                          <div className="flex flex-wrap gap-1">
                            {node.slide_ids.map((sid, idx) => (
                              <button
                                key={sid}
                                className="rounded-lg border border-[var(--bd-2)] bg-[var(--sf-1)] px-2 py-0.5 text-[11px] font-medium text-[var(--tx-4)] transition-colors hover:bg-[var(--sf-3)] hover:text-[var(--tx-2)]"
                                onClick={() => onJumpToSlide?.(sid)}
                                type="button"
                              >
                                P{idx + 1}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Prerequisite chain */}
                      <div className="mt-2.5 border-t border-[var(--bd-3)] pt-2">
                        <p className="mb-1 text-[11px] font-medium text-[var(--tx-5)]">前置知识链</p>
                        {prerequisiteLoading ? (
                          <div className="flex items-center gap-1.5 text-[11px] text-[var(--tx-6)]">
                            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            加载中...
                          </div>
                        ) : prerequisiteChain.length === 0 ? (
                          <p className="text-[11px] text-[var(--tx-6)]">无前置知识</p>
                        ) : (
                          <div className="space-y-1">
                            {prerequisiteChain.map((item, idx) => (
                              <div
                                key={item.id}
                                className="flex items-start gap-2 rounded-xl border border-[var(--bd-3)] bg-[var(--sf-1)] px-2.5 py-1.5 transition-colors hover:bg-[var(--sf-3)]"
                              >
                                <span
                                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                                  style={{ background: "var(--brand-terracotta)" }}
                                >
                                  {idx + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <button
                                    className="text-left text-[12px] font-medium text-[var(--tx-2)] hover:underline"
                                    onClick={() => handleJumpToConcept(item.id)}
                                    type="button"
                                  >
                                    {item.name}
                                  </button>
                                  {item.description && (
                                    <p className="mt-0.5 text-[11px] text-[var(--tx-4)] line-clamp-2">
                                      {item.description}
                                    </p>
                                  )}
                                </div>
                                {item.slide_ids.length > 0 && (
                                  <button
                                    className="shrink-0 rounded-lg border border-[var(--bd-2)] bg-[var(--sf-4)] px-2 py-0.5 text-[11px] text-[var(--tx-4)] transition-colors hover:bg-[var(--sf-5)]"
                                    onClick={() => onJumpToSlide?.(item.slide_ids[0])}
                                    type="button"
                                  >
                                    跳转
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Legend footer ── */}
      <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--bd-3)] px-2 pt-2">
        {Object.entries(RELATION_LABELS).map(([key, label]) => (
          <span key={key} className="flex items-center gap-1 text-[10px] text-[var(--tx-5)]">
            <span
              className="inline-block h-1.5 w-4 rounded-sm"
              style={{ backgroundColor: RELATION_DOTS[key] }}
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
