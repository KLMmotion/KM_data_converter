/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Segoe UI", "Microsoft YaHei", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Code", "Consolas", "monospace"]
      },
      boxShadow: {
        glow: "0 0 40px rgba(56, 189, 248, 0.28)",
        panel: "0 24px 80px rgba(8, 20, 44, 0.42)"
      }
    }
  },
  plugins: []
};
