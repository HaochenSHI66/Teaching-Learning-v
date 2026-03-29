"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getUser, getToken, clearAuth, type AuthUser } from "@/lib/auth";

export function UserButton() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    setUser(getToken() ? getUser() : null);
  }, []);

  // Close menu on outside click or scroll
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleScroll() { setOpen(false); }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  const toggleMenu = useCallback(() => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen((v) => !v);
  }, [open]);

  const handleLogout = useCallback(() => {
    clearAuth();
    window.location.href = "/login";
  }, []);

  // Not logged in — show login button
  if (!user) {
    return (
      <a
        href="/login"
        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--bd-1)] bg-[var(--sf-1)] px-3 text-[12px] font-medium text-[var(--tx-3)] transition-colors hover:bg-[var(--sf-3)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
          <polyline points="10 17 15 12 10 7"/>
          <line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        登录
      </a>
    );
  }

  const initials = (user.display_name || user.email || "?").slice(0, 1).toUpperCase();

  const dropdown = open && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[180px] rounded-xl border border-[var(--bd-1)] bg-[var(--sf-1)] py-1 shadow-[var(--sh-popup)]"
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          <div className="border-b border-[var(--bd-3)] px-4 py-3">
            <p className="text-[13px] font-medium text-[var(--tx-2)]">{user.display_name}</p>
            <p className="text-[11px] text-[var(--tx-5)]">{user.email}</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleLogout(); }}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] text-[var(--ac-red-text)] transition-colors hover:bg-[var(--ac-red-bg)]"
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            退出登录
          </button>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggleMenu}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-sage)] text-[12px] font-bold text-white transition-opacity hover:opacity-90"
        title={user.display_name}
        type="button"
      >
        {initials}
      </button>
      {dropdown}
    </>
  );
}
