"use client";

import { useTheme } from "@/components/theme-provider";

const MODES = [
  { value: "light" as const, label: "日间" },
  { value: "dark" as const, label: "深夜" },
  { value: "auto" as const, label: "自动" },
];

export function ThemeToggle() {
  const { theme, setTheme, resolved } = useTheme();

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-[var(--bd-2)] bg-[var(--sf-1)] p-0.5">
      {MODES.map((mode) => {
        const isActive = theme === mode.value;
        return (
          <button
            key={mode.value}
            type="button"
            onClick={() => setTheme(mode.value)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-all duration-150 ${
              isActive
                ? "bg-[var(--sf-5)] text-[var(--tx-1)] shadow-sm"
                : "text-[var(--tx-5)] hover:text-[var(--tx-3)]"
            }`}
            aria-label={mode.label}
          >
            {mode.value === "light" && (
              <svg className="inline-block h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd"/>
              </svg>
            )}
            {mode.value === "dark" && (
              <svg className="inline-block h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/>
              </svg>
            )}
            {mode.value === "auto" && (
              <svg className="inline-block h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd"/>
              </svg>
            )}
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
