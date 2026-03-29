"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchAdminStats,
  fetchAdminUsers,
  fetchAdminDocuments,
  fetchAdminSystem,
  updateAdminUser,
  deleteAdminDocument,
  type AdminStats,
  type AdminUser,
  type AdminDocument,
  type AdminSystem,
} from "@/lib/api";

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--bd-1)] bg-[var(--sf-1)] px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-[var(--tx-5)]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[var(--tx-1)]">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-[var(--tx-4)]">{sub}</p>}
    </div>
  );
}

function BarChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-2 h-24">
      {data.map((d) => (
        <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[10px] text-[var(--tx-5)]">{d.count}</span>
          <div
            className="w-full rounded-t-md bg-[var(--brand-sage)]"
            style={{ height: `${Math.max((d.count / max) * 100, 2)}%` }}
          />
          <span className="text-[10px] text-[var(--tx-5)]">{d.date}</span>
        </div>
      ))}
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [documents, setDocuments] = useState<AdminDocument[]>([]);
  const [system, setSystem] = useState<AdminSystem | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchAdminStats(),
      fetchAdminUsers(),
      fetchAdminDocuments(),
      fetchAdminSystem(),
    ])
      .then(([s, u, d, sys]) => {
        setStats(s);
        setUsers(u);
        setDocuments(d);
        setSystem(sys);
      })
      .catch((err) => {
        if (err?.status === 403) {
          router.replace("/");
          return;
        }
        setError(err?.message || "Failed to load admin data");
      })
      .finally(() => setLoading(false));
  }, [router]);

  const toggleUser = async (userId: string, disabled: boolean) => {
    await updateAdminUser(userId, { is_disabled: !disabled });
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, is_disabled: !disabled } : u)));
  };

  const handleDeleteDoc = async (docId: string, filename: string) => {
    if (!confirm(`确定删除「${filename}」及其所有讲解？`)) return;
    await deleteAdminDocument(docId);
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ backgroundColor: "var(--sf-bg, #f5f1eb)" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--brand-sage)] border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ backgroundColor: "var(--sf-bg, #f5f1eb)" }}>
        <p className="text-[var(--tx-3)]">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: "var(--sf-bg, #f5f1eb)" }}>
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--tx-5)]">Admin</p>
            <h1 className="text-xl font-bold text-[var(--tx-1)]">管理后台</h1>
          </div>
          <button
            onClick={() => router.push("/")}
            className="rounded-xl border border-[var(--bd-2)] bg-[var(--sf-1)] px-3 py-1.5 text-[12px] text-[var(--tx-3)] hover:bg-[var(--sf-3)]"
          >
            返回主页
          </button>
        </div>

        {/* ── Section 1: Stats ──────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--tx-2)]">使用统计</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="用户数" value={stats?.total_users ?? 0} />
            <StatCard label="文档数" value={stats?.total_documents ?? 0} />
            <StatCard label="讲解总数" value={stats?.total_explanations ?? 0} />
            <StatCard label="今日生成" value={stats?.today_explanations ?? 0} />
          </div>
          {stats?.daily_explanations && (
            <div className="mt-3 rounded-2xl border border-[var(--bd-1)] bg-[var(--sf-1)] p-4">
              <p className="mb-2 text-[12px] font-medium text-[var(--tx-4)]">近 7 天讲解生成趋势</p>
              <BarChart data={stats.daily_explanations} />
            </div>
          )}
        </section>

        {/* ── Section 2: Users ──────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--tx-2)]">用户管理</h2>
          <div className="overflow-hidden rounded-2xl border border-[var(--bd-1)] bg-[var(--sf-1)]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--bd-2)] bg-[var(--sf-2)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--tx-4)]">用户</th>
                  <th className="px-4 py-2 text-left font-medium text-[var(--tx-4)]">邮箱</th>
                  <th className="px-4 py-2 text-center font-medium text-[var(--tx-4)]">文档数</th>
                  <th className="px-4 py-2 text-center font-medium text-[var(--tx-4)]">注册时间</th>
                  <th className="px-4 py-2 text-center font-medium text-[var(--tx-4)]">状态</th>
                  <th className="px-4 py-2 text-center font-medium text-[var(--tx-4)]">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-[var(--bd-1)] last:border-0">
                    <td className="px-4 py-2.5 text-[var(--tx-2)]">
                      {u.display_name}
                      {u.is_admin && <span className="ml-1.5 rounded bg-[var(--ac-amber-bg)] px-1.5 py-0.5 text-[10px] text-[var(--ac-amber-text)]">管理员</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--tx-4)]">{u.email}</td>
                    <td className="px-4 py-2.5 text-center text-[var(--tx-3)]">{u.document_count}</td>
                    <td className="px-4 py-2.5 text-center text-[var(--tx-4)] text-[12px]">{new Date(u.created_at).toLocaleDateString("zh-CN")}</td>
                    <td className="px-4 py-2.5 text-center">
                      {u.is_disabled ? (
                        <span className="rounded-full bg-[var(--ac-red-bg)] px-2 py-0.5 text-[11px] text-[var(--ac-red-text)]">已禁用</span>
                      ) : (
                        <span className="rounded-full bg-[var(--ac-green-bg)] px-2 py-0.5 text-[11px] text-[var(--ac-green-text)]">正常</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {!u.is_admin && (
                        <button
                          onClick={() => toggleUser(u.id, u.is_disabled)}
                          className="rounded-lg border border-[var(--bd-2)] px-2 py-1 text-[11px] text-[var(--tx-4)] hover:bg-[var(--sf-3)]"
                        >
                          {u.is_disabled ? "启用" : "禁用"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Section 3: Documents ──────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--tx-2)]">内容管理</h2>
          <div className="overflow-hidden rounded-2xl border border-[var(--bd-1)] bg-[var(--sf-1)]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--bd-2)] bg-[var(--sf-2)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--tx-4)]">文件名</th>
                  <th className="px-4 py-2 text-left font-medium text-[var(--tx-4)]">上传者</th>
                  <th className="px-4 py-2 text-center font-medium text-[var(--tx-4)]">页数</th>
                  <th className="px-4 py-2 text-center font-medium text-[var(--tx-4)]">讲解覆盖</th>
                  <th className="px-4 py-2 text-center font-medium text-[var(--tx-4)]">操作</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const pct = Math.round(doc.coverage * 100);
                  const color = pct >= 80 ? "var(--ac-green-text)" : pct >= 50 ? "var(--ac-amber-text)" : "var(--ac-red-text)";
                  return (
                    <tr key={doc.id} className="border-b border-[var(--bd-1)] last:border-0">
                      <td className="px-4 py-2.5 text-[var(--tx-2)]">{doc.filename}</td>
                      <td className="px-4 py-2.5 text-[var(--tx-4)]">{doc.owner_name}</td>
                      <td className="px-4 py-2.5 text-center text-[var(--tx-3)]">{doc.page_count}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span style={{ color }}>{pct}%</span>
                        <span className="ml-1 text-[11px] text-[var(--tx-5)]">({doc.explanation_count}/{doc.page_count})</span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => handleDeleteDoc(doc.id, doc.filename)}
                          className="rounded-lg border border-[var(--ac-red-border)] px-2 py-1 text-[11px] text-[var(--ac-red-text)] hover:bg-[var(--ac-red-bg)]"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Section 4: System ─────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-[var(--tx-2)]">系统监控</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="数据库大小" value={`${system?.db_size_mb ?? 0} MB`} />
            <StatCard label="存储占用" value={`${system?.storage_size_mb ?? 0} MB`} />
            <StatCard label="运行时间" value={system ? formatUptime(system.uptime_seconds) : "—"} />
            <StatCard
              label="后端状态"
              value={system?.status === "running" ? "正常" : "异常"}
              sub={[
                system?.llm_configured ? "LLM OK" : "LLM 未配置",
                system?.vision_configured ? "Vision OK" : "Vision 未配置",
              ].join(" · ")}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
