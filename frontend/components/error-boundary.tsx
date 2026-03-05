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
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-red-50 p-8 text-red-800">
            <p className="font-semibold">页面出现错误</p>
            <p className="text-sm text-red-600">{this.state.message}</p>
            <button
              className="rounded-lg bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-800"
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
