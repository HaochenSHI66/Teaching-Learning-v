"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import {
  fetchKnowledgeGraph,
  generateKnowledgeGraph,
  type ConceptEdge,
  type ConceptNode,
  type KnowledgeGraph as KGData,
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
};

type GraphLink = {
  source: string;
  target: string;
  relationType: string;
};

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

export function KnowledgeGraphPanel({ documentId, onJumpToSlide, disabled }: KnowledgeGraphProps) {
  const [graph, setGraph] = useState<KGData | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
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

  // Transform to force-graph data
  const graphData = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };

    const nodes: GraphNode[] = graph.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      description: n.description,
      slideIds: n.slide_ids,
      val: Math.max(1, n.slide_ids.length),
    }));

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links: GraphLink[] = graph.edges
      .filter((e) => nodeIds.has(e.source_id) && nodeIds.has(e.target_id))
      .map((e) => ({
        source: e.source_id,
        target: e.target_id,
        relationType: e.relation_type,
      }));

    return { nodes, links };
  }, [graph]);

  // Configure force simulation for better spacing — nodes spread out, not clumped
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-300).distanceMax(500);
    fg.d3Force("link")?.distance(100);
    fg.d3Force("center")?.strength(0.03);
    fg.d3ReheatSimulation();
  }, [graphData]);

  // Search highlight
  const searchLower = search.toLowerCase();
  const highlightedIds = useMemo(() => {
    if (!searchLower) return new Set<string>();
    return new Set(
      graphData.nodes.filter((n) => n.name.toLowerCase().includes(searchLower)).map((n) => n.id),
    );
  }, [graphData.nodes, searchLower]);

  const nodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = (node as unknown as { x: number }).x;
      const y = (node as unknown as { y: number }).y;
      const label = node.name;
      const fontSize = Math.max(11 / globalScale, 4);
      const radius = Math.sqrt(node.val) * 5 + 5;

      const isHighlighted = highlightedIds.size > 0 && highlightedIds.has(node.id);
      const isHovered = hoveredNode?.id === node.id;
      const isSelected = selectedNode?.id === node.id;
      const isDimmed = highlightedIds.size > 0 && !isHighlighted;

      // Circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isSelected
        ? "#c49a3a"
        : isHovered
          ? "#8a6a46"
          : isDimmed
            ? "rgba(180,160,140,0.3)"
            : "#6b5540";
      ctx.fill();

      if (isHighlighted || isHovered || isSelected) {
        ctx.strokeStyle = "#c49a3a";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Label
      ctx.font = `${isHovered || isSelected ? "bold " : ""}${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isDimmed ? "rgba(100,80,60,0.3)" : "#3a2c1c";
      ctx.fillText(label, x, y + radius + 2);
    },
    [highlightedIds, hoveredNode, selectedNode],
  );

  const linkColor = useCallback(
    (link: GraphLink) => RELATION_COLORS[link.relationType] ?? "#c8b496",
    [],
  );

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoveredNode(node);
  }, []);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (selectedNode?.id === node.id) {
        setSelectedNode(null);
        return;
      }
      setSelectedNode(node);
      // If single slide, jump directly
      if (node.slideIds.length === 1 && onJumpToSlide) {
        onJumpToSlide(node.slideIds[0]);
      }
    },
    [selectedNode, onJumpToSlide],
  );

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

      {/* Legend */}
      <div className="shrink-0 flex flex-wrap gap-2 px-2 pb-2">
        {Object.entries(RELATION_LABELS).map(([key, label]) => (
          <span key={key} className="flex items-center gap-1 text-[11px] text-[#7a6248]">
            <span
              className="inline-block h-2 w-4 rounded-sm"
              style={{ backgroundColor: RELATION_COLORS[key] }}
            />
            {label}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-[#b09a80]">
          {graph.nodes.length} 概念 · {graph.edges.length} 关系
        </span>
      </div>

      {/* Graph */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden rounded-[16px] border border-[#e0d0bb] bg-[#fffdf8]">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <ForceGraph2D
          ref={fgRef}
          backgroundColor="#fffdf8"
          cooldownTicks={100}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          graphData={graphData as any}
          height={dimensions.height}
          linkColor={linkColor as any}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={0.8}
          linkWidth={1.5}
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
          warmupTicks={50}
          width={dimensions.width}
        />
      </div>

      {/* Tooltip / detail panel */}
      {(hoveredNode || selectedNode) && (
        <div className="shrink-0 mt-2 rounded-[14px] border border-[#e0d0bb] bg-[#fffdf8] px-3 py-2">
          <p className="text-[13px] font-medium text-[#3a2c1c]">
            {(selectedNode ?? hoveredNode)!.name}
          </p>
          <p className="mt-0.5 text-[12px] text-[#7a6248]">
            {(selectedNode ?? hoveredNode)!.description}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(selectedNode ?? hoveredNode)!.slideIds.map((sid, i) => (
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
        </div>
      )}
    </div>
  );
}
