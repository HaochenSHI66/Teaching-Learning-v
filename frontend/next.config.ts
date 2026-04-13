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

  // ── Production optimizations for public deployment ──
  compress: true,

  // Long-lived cache headers for static assets
  headers: async () => [
    {
      source: "/_next/static/:path*",
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    },
    {
      source: "/fonts/:path*",
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    },
  ],

  // Tree-shake lucide-react icons (each ~1KB instead of full barrel import)
  // Note: uses optimizePackageImports which is more reliable than modularizeImports
  experimental: {
    optimizePackageImports: ["lucide-react", "motion/react"],
  },
};

export default nextConfig;
