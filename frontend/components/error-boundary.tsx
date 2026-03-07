"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
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
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-[24px] border border-[#d9c2b6] bg-[#f8ebe4] p-8 text-[#7a4d41] shadow-[0_16px_36px_rgba(122,98,66,0.08)]">
            <p className="font-semibold">页面出现错误</p>
            <p className="text-sm text-[#9a5e4e]">{this.state.message}</p>
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
