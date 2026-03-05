import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#F7F4EE",
        ink: "#1E2A39",
        accent: "#0F766E",
        accentSoft: "#CCFBF1",
      },
      fontFamily: {
        sans: ["\"Noto Sans SC\"", "\"Source Han Sans SC\"", "sans-serif"],
      },
      boxShadow: {
        panel: "0 10px 30px rgba(15, 23, 42, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
