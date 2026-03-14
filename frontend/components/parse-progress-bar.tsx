"use client";

import { memo, useEffect, useState } from "react";

type Props = {
  current: number;
  total: number;
  filename?: string;
};

const WORM_FRAMES = ["🐛", "🌿", "✨", "🌱"];

export const ParseProgressBar = memo(function ParseProgressBar({ current, total, filename }: Props) {
  const pct = total > 0 ? Math.min(1, current / total) : 0;
  const pctDisplay = Math.round(pct * 100);
  const isIndeterminate = current === 0;

  // Cute worm emoji that cycles while parsing
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % WORM_FRAMES.length), 600);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-1.5">
      {/* Label row */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#7a6347]">
          <span
            className="inline-block transition-transform duration-300"
            style={{ transform: `rotate(${isIndeterminate ? frame * 15 : 0}deg)` }}
          >
            {WORM_FRAMES[frame]}
          </span>
          {isIndeterminate ? (
            <span className="animate-pulse">准备解析…</span>
          ) : (
            <span>
              解析中 <span className="tabular-nums font-semibold text-[#5f7a52]">{current}</span>
              <span className="text-[#a08b72]"> / {total}</span> 页
            </span>
          )}
        </span>
        {!isIndeterminate && (
          <span className="tabular-nums text-[11px] font-semibold text-[#8c9d78]">
            {pctDisplay}%
          </span>
        )}
      </div>

      {/* Track */}
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[#ede3cf] shadow-[inset_0_1px_3px_rgba(122,98,66,0.14)]">
        {isIndeterminate ? (
          /* Shimmer worm for indeterminate state */
          <div className="parse-worm absolute inset-y-0 w-2/5 rounded-full bg-gradient-to-r from-[#dbc49a] via-[#c9a86c] to-[#8a9d76]" />
        ) : (
          /* Determinate fill using scaleX (GPU composited) */
          <div
            className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-gradient-to-r from-[#c9a97a] via-[#d6a45b] to-[#8a9d76] transition-transform duration-500 ease-out"
            style={{ transform: `scaleX(${pct})` }}
          >
            {/* Bubble at the front */}
            {pct > 0.04 && (
              <span
                className="absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 translate-x-1/2 rounded-full border border-[#c4974c]/60 bg-[#f0c97a] shadow-[0_0_6px_rgba(214,164,91,0.6)] animate-bounce"
                aria-hidden="true"
              />
            )}
          </div>
        )}
      </div>

      {/* Filename hint */}
      {filename && (
        <p className="truncate text-[10px] text-[#9c876e]" title={filename}>
          {filename}
        </p>
      )}
    </div>
  );
});
