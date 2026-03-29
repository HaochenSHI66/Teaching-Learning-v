"use client";

import { useCallback, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export function AccountSettings() {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const token = window.localStorage.getItem("token");
      const res = await fetch(`${apiBase}/account`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `删除失败 (${res.status})`);
      }

      // Clear auth state and redirect to landing
      window.localStorage.removeItem("token");
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除账户失败，请重试");
      setDeleting(false);
    }
  }, []);

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/50 p-5">
      <h3 className="text-base font-semibold text-red-800">删除账户</h3>
      <p className="mt-1 text-sm text-red-700/80">
        永久删除您的账户及所有关联数据，包括上传的文档、学习记录和笔记。此操作不可逆。
      </p>

      {error && (
        <p className="mt-3 text-sm text-red-600 font-medium">{error}</p>
      )}

      {!confirming ? (
        <button
          type="button"
          className="mt-4 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors"
          onClick={() => setConfirming(true)}
        >
          删除账户
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium text-red-800">
            确定要删除账户吗？此操作不可逆，所有数据将被永久删除。
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? "正在删除..." : "确认删除"}
            </button>
            <button
              type="button"
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              disabled={deleting}
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
