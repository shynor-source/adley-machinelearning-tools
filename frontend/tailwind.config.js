/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#070b12",
          900: "#0c1320",
          850: "#101a2a",
          800: "#152236",
        },
        mint: {
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
        },
      },
      boxShadow: {
        panel: "0 1px 2px rgba(15,23,42,.06), 0 16px 48px -24px rgba(15,23,42,.18)",
        glow: "0 0 0 1px rgba(16,185,129,.18), 0 16px 50px -20px rgba(16,185,129,.45)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up .35s ease both",
        shimmer: "shimmer 1.8s linear infinite",
      },
    },
  },
  plugins: [],
};
