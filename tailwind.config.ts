import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        apple: {
          blue: "#5B8DEF",      // 채도 낮춘 소프트 블루
          blueDark: "#4A7DD9",
          blueSoft: "#8AAFF0",
          gray: "#8E8E93",
          gray2: "#AEAEB2",
          silver: "#F2F2F7",
          silver2: "#E5E5EA",
          label: "#1C1C1E",
          label2: "#3A3A3C",
          // 헬스 카테고리 컬러 (톤 다운)
          red: "#E06B6B",
          pink: "#E87490",
          orange: "#E8A062",
          yellow: "#E8C26A",
          green: "#6FBF8E",
          teal: "#7DB8C9",
          indigo: "#7A7BCA",
          purple: "#A585C8",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "'SF Pro Display'",
          "'SF Pro Text'",
          "'Pretendard'",
          "system-ui",
          "sans-serif",
        ],
      },
      borderRadius: {
        card: "16px",
      },
      boxShadow: {
        card: "0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)",
        cardHover:
          "0 12px 28px rgba(0,0,0,0.10), 0 6px 10px rgba(0,0,0,0.06)",
      },
    },
  },
  plugins: [],
};
export default config;
