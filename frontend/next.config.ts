import type { NextConfig } from "next";

// Node 25+ exposes a broken `localStorage` global (getItem is undefined).
// This crashes any SSR code or dependency that calls localStorage.getItem().
// Suppress it so SSR behaves like Node <22 where localStorage didn't exist.
if (typeof window === "undefined" && typeof globalThis.localStorage !== "undefined") {
  (globalThis as Record<string, unknown>).localStorage = undefined as unknown as Storage;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
};

export default nextConfig;
