"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import {
  fetchConceptPrerequisites,
  fetchKnowledgeGraph,
  generateKnowledgeGraph,
  type ConceptEdge,
  type ConceptNode,
  type KnowledgeGraph as KGData,
  type PrerequisiteChainItem,
} from "@/lib/api";

// Dynamic import to avoid SSR issues with canvas
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FGRef = any;

type KnowledgeGraphProps = {
  documentId: string;
  onJumpToSlide?: (slideId: string) => void;
  disabled?: boolean;
};

type GraphNode = {
  id: string;
  name: string;
  description: string;
  slideIds: string[];
  val: number; // node size weight
  // Hierarchical layout positions (set when in hierarchical mode)
  fx?: number;
  fy?: number;
};

type GraphLink = {
  source: string;
  target: string;
  relationType: string;
};

type LayoutMode = "force" | "hierarchical";

const RELATION_COLORS: Record<string, string> = {
  prerequisite: "#c45a4a",
  related: "#5a7ebf",
  part_of: "#5a9e6f",
  contrast: "#c49a3a",
};

const RELATION_LABELS: Record<string, string> = {
  prerequisite: "前置",
  related: "相关",
  part_of: "从属",
  contrast: "对比",
};

const ALL_RELATION_TYPES = ["prerequisite", "related", "part_of", "contrast"] as const;

// ── Topological Sort Utility ──────────────────────────────────

type TopoResult = { depth: Map<string, number>; order: string[] };

function topologicalSort(
  nodeIds: string[],
  edges: { source: string; target: string; relationType: string }[],
): TopoResult {
  // Only consider prerequisite and part_of edges for hierarchy
  const relevantEdges = edges.filter(
    (e) => e.relationType === "prerequisite" || e.relationType === "part_of",
  );

  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIds) {
    adjacency.set(id, []);
    inDegree.set(id, 0);
  }

  for (const e of relevantEdges) {
    const src = typeof e.source === "string" ? e.source : (e.source as unknown as { id: string }).id;
    const tgt = typeof e.target === "string" ? e.target : (e.target as unknown as { id: string }).id;
    if (adjacency.has(src) && inDegree.has(tgt)) {
      adjacency.get(src)!.push(tgt);
      inDegree.set(tgt, (inDegree.get(tgt) ?? 0) + 1);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  const depth = new Map<string, number>();

  // Initialize all nodes with depth 0 in case of cycles
  for (const id of nodeIds) {
    depth.set(id, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      depth.set(neighbor, Math.max(depth.get(neighbor) ?? 0, (depth.get(current) ?? 0) + 1));
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // Handle any remaining nodes (cycles) — assign them depth 0
  for (const id of nodeIds) {
    if (!order.includes(id)) {
      order.push(id);
    }
  }

  return { depth, order };
}

export function KnowledgeGraphPanel({ documentId, onJumpToSlide, disabled }: KnowledgeGraphProps) {
  const [graph, setGraph] = useState<KGData | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("force");
  const [visibleRelations, setVisibleRelations] = useState<Set<string>>(
    new Set(ALL_RELATION_TYPES),
  );
  const [prerequisiteChain, setPrerequisiteChain] = useState<PrerequisiteChainItem[]>([]);
  const [prerequisiteLoading, setPrerequisiteLoading] = useState(false);
  const [prerequisiteHighlightIds, setPrerequisiteHighlightIds] = useState<Set<string>>(
    new Set(),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<FGRef>(null);
  const [dimensions, setDimensions] = useState({ width: 400, height: 300 });

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

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

  // When switching to hierarchical, default to only prerequisite + part_of visible
  const handleLayoutChange = useCallback((mode: LayoutMode) => {
    setLayoutMode(mode);
    if (mode === "hierarchical") {
      setVisibleRelations(new Set(["prerequisite", "part_of"]));
    } else {
      setVisibleRelations(new Set(ALL_RELATION_TYPES));
    }
  }, []);

  const toggleRelation = useCallback((relType: string) => {
    setVisibleRelations((prev) => {
      const next = new Set(prev);
      if (next.has(relType)) {
        next.delete(relType);
      } else {
        next.add(relType);
      }
      return next;
    });
  }, []);

  // Transform to force-graph data
  const graphData = useMemo(() => {
    if (!graph) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };

    const nodeIds = new Set(graph.nodes.map((n) => n.id));

    const allLinks: GraphLink[] = graph.edges
      .filter((e) => nodeIds.has(e.source_id) && nodeIds.has(e.target_id))
      .map((e) => ({
        source: e.source_id,
        target: e.target_id,
        relationType: e.relation_type,
      }));

    // Filter links by visible relation types
    const links = allLinks.filter((l) => visibleRelations.has(l.relationType));

    // Build nodes
    let nodes: GraphNode[];

    if (layoutMode === "hierarchical") {
      const topoResult = topologicalSort(
        graph.nodes.map((n) => n.id),
        allLinks,
      );

      // Group by depth column
      const depthGroups = new Map<number, string[]>();
      for (const n of graph.nodes) {
        const d = topoResult.depth.get(n.id) ?? 0;
        if (!depthGroups.has(d)) depthGroups.set(d, []);
        depthGroups.get(d)!.push(n.id);
      }

      const maxDepth = Math.max(...Array.from(depthGroups.keys()), 0);
      const colSpacing = dimensions.width / (maxDepth + 2);

      nodes = graph.nodes.map((n) => {
        const d = topoResult.depth.get(n.id) ?? 0;
        const group = depthGroups.get(d) ?? [n.id];
        const indexInGroup = group.indexOf(n.id);
        const rowSpacing = dimensions.height / (group.length + 1);

        return {
          id: n.id,
          name: n.name,
          description: n.description,
          slideIds: n.slide_ids,
          val: Math.max(1, n.slide_ids.length),
          fx: colSpacing * (d + 1),
          fy: rowSpacing * (indexInGroup + 1),
        };
      });
    } else {
      nodes = graph.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        description: n.description,
        slideIds: n.slide_ids,
        val: Math.max(1, n.slide_ids.length),
        fx: undefined,
        fy: undefined,
      }));
    }

    return { nodes, links };
  }, [graph, layoutMode, visibleRelations, dimensions]);

  // Configure force simulation for better spacing — nodes spread out, not clumped
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (layoutMode === "force") {
      fg.d3Force("charge")?.strength(-300).distanceMax(500);
      fg.d3Force("link")?.distance(100);
      fg.d3Force("center")?.strength(0.03);
      fg.d3ReheatSimulation();
    } else {
      // In hierarchical mode, disable forces since we use fixed positions
      fg.d3Force("charge")?.strength(0);
      fg.d3Force("link")?.distance(0);
      fg.d3Force("center")?.strength(0);
      fg.d3ReheatSimulation();
    }
  }, [graphData, layoutMode]);

  // Search highlight
  const searchLower = search.toLowerCase();
  const highlightedIds = useMemo(() => {
    if (!searchLower) return new Set<string>();
    return new Set(
      graphData.nodes.filter((n) => n.name.toLowerCase().includes(searchLower)).map((n) => n.id),
    );
  }, [graphData.nodes, searchLower]);

  // Combined highlight: search + prerequisite chain
  const allHighlightedIds = useMemo(() => {
    const combined = new Set<string>();
    for (const id of highlightedIds) combined.add(id);
    for (const id of prerequisiteHighlightIds) combined.add(id);
    return combined;
  }, [highlightedIds, prerequisiteHighlightIds]);

  const nodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = (node as unknown as { x: number }).x;
      const y = (node as unknown as { y: number }).y;
      const label = node.name;
      const fontSize = Math.max(11 / globalScale, 4);
      const radius = Math.sqrt(node.val) * 5 + 5;

      const isHighlighted = allHighlightedIds.size > 0 && allHighlightedIds.has(node.id);
      const isHovered = hoveredNode?.id === node.id;
      const isSelected = selectedNode?.id === node.id;
      const isInPrereqChain = prerequisiteHighlightIds.has(node.id);
      const isDimmed = allHighlightedIds.size > 0 && !isHighlighted && !isHovered && !isSelected;

      // Circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isSelected
        ? "#c49a3a"
        : isInPrereqChain
          ? "#c45a4a"
          : isHovered
            ? "#8a6a46"
            : isDimmed
              ? "rgba(180,160,140,0.3)"
              : "#6b5540";
      ctx.fill();

      if (isHighlighted || isHovered || isSelected || isInPrereqChain) {
        ctx.strokeStyle = isInPrereqChain ? "#c45a4a" : "#c49a3a";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Label
      ctx.font = `${isHovered || isSelected || isInPrereqChain ? "bold " : ""}${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isDimmed ? "rgba(100,80,60,0.3)" : "#3a2c1c";
      ctx.fillText(label, x, y + radius + 2);
    },
    [allHighlightedIds, hoveredNode, selectedNode, prerequisiteHighlightIds],
  );

  const linkColor = useCallback(
    (link: GraphLink) => {
      if (allHighlightedIds.size > 0) {
        const srcId = typeof link.source === "string" ? link.source : (link.source as unknown as { id: string }).id;
        const tgtId = typeof link.target === "string" ? link.target : (link.target as unknown as { id: string }).id;
        const srcHighlighted = allHighlightedIds.has(srcId);
        const tgtHighlighted = allHighlightedIds.has(tgtId);
        if (!srcHighlighted || !tgtHighlighted) {
          return "rgba(200,180,150,0.15)";
        }
      }
      return RELATION_COLORS[link.relationType] ?? "#c8b496";
    },
    [allHighlightedIds],
  );

  const linkWidth = useCallback(
    (link: GraphLink) => {
      if (allHighlightedIds.size > 0) {
        const srcId = typeof link.source === "string" ? link.source : (link.source as unknown as { id: string }).id;
        const tgtId = typeof link.target === "string" ? link.target : (link.target as unknown as { id: string }).id;
        if (allHighlightedIds.has(srcId) && allHighlightedIds.has(tgtId)) {
          return 2.5;
        }
      }
      return 1.5;
    },
    [allHighlightedIds],
  );

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoveredNode(node);
  }, []);

  // Fetch prerequisite chain when a node is selected
  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (selectedNode?.id === node.id) {
        setSelectedNode(null);
        setPrerequisiteChain([]);
        setPrerequisiteHighlightIds(new Set());
        return;
      }
      setSelectedNode(node);

      // Fetch prerequisite chain
      setPrerequisiteLoading(true);
      setPrerequisiteChain([]);
      fetchConceptPrerequisites(documentId, node.id)
        .then((payload) => {
          setPrerequisiteChain(payload.chain);
          // Highlight the selected node + all prerequisites
          const ids = new Set<string>([node.id, ...payload.chain.map((c) => c.id)]);
          setPrerequisiteHighlightIds(ids);
        })
        .catch(() => {
          setPrerequisiteChain([]);
          setPrerequisiteHighlightIds(new Set([node.id]));
        })
        .finally(() => setPrerequisiteLoading(false));

      // If single slide, jump directly
      if (node.slideIds.length === 1 && onJumpToSlide) {
        onJumpToSlide(node.slideIds[0]);
      }
    },
    [selectedNode, onJumpToSlide, documentId],
  );

  // Clear prerequisite highlight when deselecting
  useEffect(() => {
    if (!selectedNode) {
      setPrerequisiteChain([]);
      setPrerequisiteHighlightIds(new Set());
    }
  }, [selectedNode]);

  // Empty state
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[#9a846a]">
        加载中...
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-[13px] text-[#9a846a]">尚未生成知识图谱</p>
        <button
          className="btn btn-primary !px-4 !py-2 !text-[13px]"
          disabled={disabled || generating}
          onClick={handleGenerate}
          type="button"
        >
          {generating ? "生成中..." : "生成知识图谱"}
        </button>
        {generating && (
          <p className="text-[12px] text-[#b09a80]">正在分析所有页面，可能需要 30 秒...</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-2 pb-2">
        <input
          className="flex-1 rounded-lg border border-[#d5c2a4] bg-white px-2.5 py-1.5 text-[13px] text-[#554535] outline-none placeholder:text-[#c8b496] focus:border-[#8a9d76]"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索概念..."
          value={search}
        />
        <button
          className="shrink-0 rounded-lg border border-[#d0bfa4] bg-[#f0e5d1] px-2.5 py-1.5 text-[12px] font-medium text-[#6b5540] transition-colors hover:bg-[#e8d8c0]"
          disabled={generating}
          onClick={handleGenerate}
          type="button"
        >
          {generating ? "重新生成中..." : "重新生成"}
        </button>
      </div>

      {/* Layout toggle */}
      <div className="shrink-0 flex items-center gap-2 px-2 pb-2">
        <div className="inline-flex rounded-full border border-[#e0d0bb] bg-[#fffdf8] p-0.5">
          <button
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              layoutMode === "force"
                ? "bg-[#6b5540] text-[#fffdf8] shadow-sm"
                : "text-[#7a6248] hover:bg-[#f0e5d1]"
            }`}
            onClick={() => handleLayoutChange("force")}
            type="button"
          >
            自由布局
          </button>
          <button
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              layoutMode === "hierarchical"
                ? "bg-[#6b5540] text-[#fffdf8] shadow-sm"
                : "text-[#7a6248] hover:bg-[#f0e5d1]"
            }`}
            onClick={() => handleLayoutChange("hierarchical")}
            type="button"
          >
            学习顺序
          </button>
        </div>
      </div>

      {/* Legend with relation filters */}
      <div className="shrink-0 rounded-[12px] border border-[#e8dcc8] bg-[#faf5ec] mx-2 mb-2 px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {Object.entries(RELATION_LABELS).map(([key, label]) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[#7a6248] select-none"
            >
              <input
                checked={visibleRelations.has(key)}
                className="h-3 w-3 rounded border-[#d0bfa4] accent-[#6b5540]"
                onChange={() => toggleRelation(key)}
                type="checkbox"
              />
              <span
                className="inline-block h-2 w-4 rounded-sm"
                style={{ backgroundColor: RELATION_COLORS[key] }}
              />
              {label}
            </label>
          ))}
          <span className="ml-auto text-[11px] text-[#b09a80]">
            {graph.nodes.length} 概念 · {graph.edges.length} 关系
          </span>
        </div>
      </div>

      {/* Graph */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden rounded-[16px] border border-[#e0d0bb] bg-[#fffdf8]">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <ForceGraph2D
          ref={fgRef}
          backgroundColor="#fffdf8"
          cooldownTicks={layoutMode === "hierarchical" ? 0 : 100}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          graphData={graphData as any}
          height={dimensions.height}
          linkColor={linkColor as any}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={0.8}
          linkWidth={linkWidth as any}
          nodeCanvasObject={nodeCanvasObject as any}
          nodePointerAreaPaint={((node: any, color: string, ctx: CanvasRenderingContext2D) => {
            const x = node.x ?? 0;
            const y = node.y ?? 0;
            const radius = Math.sqrt(node.val ?? 1) * 4 + 6;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }) as any}
          onNodeClick={handleNodeClick as any}
          onNodeHover={handleNodeHover as any}
          warmupTicks={layoutMode === "hierarchical" ? 0 : 50}
          width={dimensions.width}
        />
      </div>

      {/* Detail panel for selected/hovered node */}
      {(hoveredNode || selectedNode) && (
        <div className="shrink-0 mt-2 max-h-48 overflow-auto rounded-[14px] border border-[#e0d0bb] bg-[#fffdf8] px-3 py-2">
          <p className="text-[13px] font-medium text-[#3a2c1c]">
            {(selectedNode ?? hoveredNode)!.name}
          </p>
          <p className="mt-0.5 text-[12px] text-[#7a6248]">
            {(selectedNode ?? hoveredNode)!.description}
          </p>

          {/* Slide jump buttons */}
          <div className="mt-1 flex flex-wrap gap-1">
            {(selectedNode ?? hoveredNode)!.slideIds.map((sid) => (
              <button
                key={sid}
                className="rounded-md border border-[#d0bfa4] bg-[#f0e5d1] px-2 py-0.5 text-[11px] text-[#6b5540] transition-colors hover:bg-[#e8d8c0]"
                onClick={() => onJumpToSlide?.(sid)}
                type="button"
              >
                跳转
              </button>
            ))}
          </div>

          {/* Flashcard link (Task 4) */}
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="rounded-md border border-[#c9d5b9] bg-[#eef4e6] px-2 py-0.5 text-[11px] font-medium text-[#5a7248] cursor-default">
              查看闪卡
            </span>
          </div>

          {/* Prerequisite chain (Task 2) */}
          {selectedNode && (
            <div className="mt-2 border-t border-[#eee2cf] pt-2">
              <p className="text-[11px] font-medium text-[#9a846a]">前置知识链</p>
              {prerequisiteLoading ? (
                <p className="mt-1 text-[11px] text-[#b09a80] animate-pulse">加载中...</p>
              ) : prerequisiteChain.length === 0 ? (
                <p className="mt-1 text-[11px] text-[#b09a80]">无前置知识</p>
              ) : (
                <div className="mt-1 space-y-1">
                  {prerequisiteChain.map((item, idx) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-2 rounded-[10px] border border-[#e8dcc8] bg-[#faf5ec] px-2 py-1.5"
                    >
                      {/* Depth indicator */}
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#c45a4a] text-[9px] font-bold text-white">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-[#3a2c1c]">{item.name}</p>
                        {item.description && (
                          <p className="mt-0.5 text-[11px] text-[#7a6248] line-clamp-2">
                            {item.description}
                          </p>
                        )}
                      </div>
                      {item.slide_ids.length > 0 && (
                        <button
                          className="shrink-0 rounded-md border border-[#d0bfa4] bg-[#f0e5d1] px-2 py-0.5 text-[11px] text-[#6b5540] transition-colors hover:bg-[#e8d8c0]"
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
          )}
        </div>
      )}
    </div>
  );
}
