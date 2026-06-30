import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Palette Radar (Delta Solutions — Brand Book).
        canvas: "#f4f1ea", // sfondo neutro chiaro
        ink: "#12161f", // testo scuro
        line: "#e2ded6", // bordo card
        "line-soft": "#eceae3", // bordo righe tabella
        brand: {
          DEFAULT: "#2b7fff", // blu accent
          violet: "#8b5cf6", // viola accent
        },
      },
      fontFamily: {
        sans: ['"Space Grotesk"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"Space Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(90deg,#2b7fff,#8b5cf6)",
      },
      borderRadius: {
        card: "16px",
      },
    },
  },
  plugins: [],
};

export default config;
