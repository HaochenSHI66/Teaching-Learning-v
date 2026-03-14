"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  /** When this value changes, the boundary automatically resets. */
  resetKey?: unknown;
};

type State = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: "" });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex h-full flex-col items-center justify-center gap-4 rounded-[24px] border border-[#d9c2b6] bg-[#f8ebe4] p-8 text-[#7a4d41] shadow-[0_16px_36px_rgba(122,98,66,0.08)]">
            {/* Decorative broken-page icon */}
            <svg aria-hidden="true" className="h-14 w-14 opacity-70" viewBox="0 0 56 56" fill="none">
              <rect x="8" y="4" width="32" height="44" rx="5" fill="#f5dcd4" stroke="#c98b7b" strokeWidth="1.5"/>
              <path d="M28 4v12h12" stroke="#c98b7b" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              <line x1="14" y1="26" x2="34" y2="26" stroke="#d9a898" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="4 3"/>
              <line x1="14" y1="33" x2="28" y2="33" stroke="#d9a898" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="4 3"/>
              <circle cx="43" cy="43" r="10" fill="#ffe0d6" stroke="#c98b7b" strokeWidth="1.5"/>
              <line x1="43" y1="38" x2="43" y2="44" stroke="#c98b7b" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="43" cy="47" r="1.2" fill="#c98b7b"/>
            </svg>
            <div className="text-center">
              <p className="font-semibold text-[#6b3f36]">页面渲染出错</p>
              <p className="mt-1 max-w-[220px] text-sm leading-5 text-[#9a5e4e]">
                {this.state.message || "发生未知错误，请尝试重新加载。"}
              </p>
            </div>
            <button
              className="btn btn-warning"
              onClick={() => this.setState({ hasError: false, message: "" })}
              type="button"
            >
              重试
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
