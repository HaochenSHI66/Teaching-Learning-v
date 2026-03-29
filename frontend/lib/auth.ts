const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  is_admin?: boolean;
}

function safeStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage && typeof window.localStorage.getItem === "function") {
      return window.localStorage;
    }
  } catch {
    // localStorage can throw in some environments (e.g. sandboxed iframes)
  }
  return null;
}

export function getToken(): string | null {
  return safeStorage()?.getItem(TOKEN_KEY) ?? null;
}

export function setToken(token: string): void {
  safeStorage()?.setItem(TOKEN_KEY, token);
  // Also set as cookie so Next.js middleware can read it for auth redirect
  if (typeof document !== "undefined") {
    document.cookie = `auth_token=${token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;
  }
}

export function getUser(): AuthUser | null {
  const raw = safeStorage()?.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setUser(user: AuthUser): void {
  safeStorage()?.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  const s = safeStorage();
  s?.removeItem(TOKEN_KEY);
  s?.removeItem(USER_KEY);
  // Also clear the cookie
  if (typeof document !== "undefined") {
    document.cookie = "auth_token=; path=/; max-age=0";
  }
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
