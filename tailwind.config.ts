import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Palette Radar (Delta Solutions).
        brand: {
          DEFAULT: "#1f6feb",
          dark: "#1a5fcc",
          light: "#e8f1ff",
        },
      },
    },
  },
  plugins: [],
};

export default config;
