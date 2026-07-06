/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        panel: "0 24px 80px rgba(2, 6, 23, 0.36)",
        glow: "0 0 32px rgba(125, 211, 252, 0.22)"
      }
    }
  },
  plugins: []
};
