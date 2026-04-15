import type { Metadata } from "next";
import "./globals.css";
import { TokenProvider } from "@/components/TokenProvider";
import { TokenCounter } from "@/components/TokenCounter";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "AI 돌봄 매칭",
  description: "AI 기반 돌봄 도우미 매칭 서비스",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="font-sans">
        <TokenProvider>
          <Nav />
          <main className="max-w-5xl mx-auto px-6 pt-10 pb-16 page-enter">
            {children}
            <TokenCounter />
          </main>
        </TokenProvider>
      </body>
    </html>
  );
}
