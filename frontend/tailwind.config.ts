import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand:  { DEFAULT: "#b5451b", light: "#fdf6f0", dark: "#8f3615" },
        cream:  "#f5f0e8",
        sidebar: "#ede8df",
        charcoal: "#1a1a1a",
        muted:  "#6b6b6b",
        "warm-border": "#ddd6ca",
      },
      fontFamily: {
        serif: ["var(--font-playfair)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
