"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

type LoadingStep = {
  label: string;
  done: boolean;
};

type LoadingScreenProps = {
  steps: LoadingStep[];
  visible: boolean;
  onExitComplete?: () => void;
};

/**
 * Smooth progress that continuously creeps forward,
 * decelerating as it approaches each step boundary,
 * then snaps ahead when a step completes.
 */
function useSmoothProgress(steps: LoadingStep[]) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef(performance.now());

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length || 1;

  // The "floor" is where completed steps put us (e.g. 1/3 done = 33%)
  // The "ceiling" is the next step boundary
  // Between floor and ceiling, we creep slowly with deceleration
  const floor = (doneCount / total) * 100;
  const ceiling = ((doneCount + 1) / total) * 100;

  useEffect(() => {
    lastTimeRef.current = performance.now();

    function tick(now: number) {
      const dt = (now - lastTimeRef.current) / 1000; // seconds
      lastTimeRef.current = now;

      setProgress((prev) => {
        // All done → ease to 100
        if (doneCount >= total) {
          const dist = 100 - prev;
          return dist < 0.3 ? 100 : prev + dist * Math.min(1, dt * 6);
        }

        // Below the floor (step just completed) → snap up quickly
        if (prev < floor) {
          const dist = floor - prev;
          return dist < 0.3 ? floor : prev + dist * Math.min(1, dt * 8);
        }

        // Between floor and ceiling → creep slowly, decelerating as we approach ceiling
        // This gives the "slowing down" feel — never quite reaches the next step
        const maxForStep = ceiling - 2; // never quite reach the boundary
        if (prev >= maxForStep) return prev; // stall just below

        const remaining = maxForStep - prev;
        const speed = 0.5 + remaining * 0.06; // faster when far, slower when close
        return prev + speed * dt;
      });

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [doneCount, total, floor, ceiling]);

  return Math.min(100, Math.round(progress * 10) / 10);
}

export function LoadingScreen({ steps, visible, onExitComplete }: LoadingScreenProps) {
  const progress = useSmoothProgress(steps);

  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
          style={{
            background: "linear-gradient(145deg, #f7f0e5 0%, #efe4d1 48%, #eadcc6 100%)",
          }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        >
          {/* Background decorations */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <motion.div
              className="absolute rounded-full blur-[80px]"
              style={{ width: 300, height: 300, left: "15%", top: "20%", backgroundColor: "rgba(111,140,104,0.12)" }}
              animate={{ scale: [1, 1.3, 1], opacity: [0.12, 0.2, 0.12] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute rounded-full blur-[80px]"
              style={{ width: 250, height: 250, right: "15%", bottom: "25%", backgroundColor: "rgba(214,164,91,0.12)" }}
              animate={{ scale: [1, 1.2, 1], opacity: [0.12, 0.18, 0.12] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            />
          </div>

          {/* Main content */}
          <div className="relative z-10 flex flex-col items-center gap-8 px-6">
            {/* Logo / Icon */}
            <motion.div
              className="flex items-center gap-3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <motion.div
                className="flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg"
                style={{ background: "linear-gradient(135deg, #6f8c68 0%, #5a7354 100%)" }}
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              >
                <svg
                  className="h-7 w-7 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8" />
                  <path d="M12 17v4" />
                </svg>
              </motion.div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[#8c765f]">
                  Learning Studio
                </p>
                <h1
                  className="text-xl font-bold text-[#3a2c1c]"
                  style={{ fontFamily: '"Noto Serif SC", "Songti SC", serif' }}
                >
                  幻灯片研习台
                </h1>
              </div>
            </motion.div>

            {/* Progress bar */}
            <motion.div
              className="w-64 md:w-80"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e0d0bb]">
                <div
                  className="h-full rounded-full transition-none"
                  style={{
                    background: "linear-gradient(90deg, #6f8c68, #8aab6e, #d6a45b)",
                    width: `${progress}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-center text-[12px] tabular-nums text-[#8c765f]">
                {Math.round(progress)}%
              </p>
            </motion.div>

            {/* Step indicators */}
            <motion.div
              className="flex flex-col gap-2.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              {steps.map((step, i) => (
                <motion.div
                  key={step.label}
                  className="flex items-center gap-2.5"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.4 + i * 0.1 }}
                >
                  {step.done ? (
                    <motion.div
                      className="flex h-5 w-5 items-center justify-center rounded-full"
                      style={{ backgroundColor: "#6f8c68" }}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 400, damping: 15 }}
                    >
                      <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </motion.div>
                  ) : (
                    <div className="flex h-5 w-5 items-center justify-center">
                      <motion.div
                        className="h-3 w-3 rounded-full border-2 border-[#c8b496]"
                        animate={{ scale: [1, 1.2, 1], opacity: [0.6, 1, 0.6] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                      />
                    </div>
                  )}
                  <span className={`text-[13px] ${step.done ? "text-[#5a4535]" : "text-[#8c765f]"}`}>
                    {step.label}
                  </span>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
