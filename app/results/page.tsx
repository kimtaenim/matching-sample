"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HelperCard } from "@/components/HelperCard";
import { useTokens, tokenedFetch } from "@/components/TokenProvider";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface MatchResponse {
  need_info?: boolean;
  reply?: string;
  next_question?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results?: any[];
  requester_id?: string | null;
  _usage?: { input: number; output: number };
}

interface Turn {
  role: "user" | "ai";
  text: string;
}

function ResultsInner() {
  const params = useSearchParams();
  const initialBio = params.get("q") || "";
  const location = params.get("location") || "봉천동";
  const { add, input: tokIn, output: tokOut, costKRW } = useTokens();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [finalResults, setFinalResults] = useState<any[] | null>(null);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  async function callMatch(msgs: Message[]) {
    setLoading(true);
    try {
      const r = await tokenedFetch<MatchResponse>(
        "/api/match",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: msgs,
            location,
            role: "family",
          }),
        },
        add
      );

      const reply = r.reply || r.next_question || "";

      if (r.need_info) {
        setTurns((t) => [...t, { role: "ai", text: reply }]);
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
      } else {
        setTurns((t) => [...t, { role: "ai", text: reply }]);
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
        if (r.results && r.results.length > 0) {
          setFinalResults(r.results);
        }
      }
    } catch {
      setTurns((t) => [...t, { role: "ai", text: "잠시 문제가 생겼어요. 다시 말씀해 주시겠어요?" }]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialized.current || !initialBio) return;
    initialized.current = true;
    const firstMsg: Message = { role: "user", content: initialBio };
    setTurns([{ role: "user", text: initialBio }]);
    setMessages([firstMsg]);
    callMatch([firstMsg]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, finalResults, loading]);

  function handleSend(text: string) {
    if (!text.trim() || loading) return;
    const answer = text.trim();
    setInput("");

    if (finalResults) setFinalResults(null);

    const userMsg: Message = { role: "user", content: answer };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setTurns((t) => [...t, { role: "user", text: answer }]);
    callMatch(newMessages);
  }

  return (
    <div className="fixed inset-0 flex flex-col" style={{ top: "56px" }}>
      {/* 대화 영역 */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-3">
        {turns.map((t, i) => (
          <ChatBubble key={i} role={t.role} text={t.text} />
        ))}
        {loading && <ChatBubble role="ai" text="생각 중..." loading />}

        {/* 매칭 결과 */}
        {finalResults && finalResults.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            {finalResults.map((r, i) => (
              <HelperCard
                key={r.id || i}
                helper={r}
                index={i}
                matchReason={r.match_reason}
                matchScore={r.match_score}
                headline={r.headline}
                forFamily={r.for_family}
                forHelper={r.for_helper}
              />
            ))}
          </div>
        )}

        {finalResults && finalResults.length === 0 && (
          <div className="bg-white rounded-2xl p-6 text-center shadow-card">
            <p className="text-[16px] text-apple-label font-semibold">
              조건에 맞는 분을 찾지 못했어요
            </p>
            <p className="mt-2 text-apple-gray text-[14px]">
              조건을 바꿔서 다시 말씀해 주세요.
            </p>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* 입력 영역 — 하단 고정 */}
      <div className="shrink-0 p-3 pb-4" style={{ borderTop: "1px solid rgba(0,0,0,0.06)", background: "#FAFAFA" }}>
        {(tokIn > 0 || tokOut > 0) && (
          <p className="text-center text-[10px] mb-1.5" style={{ color: "#8E8E93" }}>
            입력 {tokIn.toLocaleString()} · 출력 {tokOut.toLocaleString()} tokens · 약 {costKRW.toLocaleString()}원
          </p>
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend(input); }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={finalResults ? "다른 조건이나 의견을 말씀해 주세요..." : "자유롭게 말씀해 주세요..."}
            className="flex-1 bg-apple-silver rounded-xl px-4 py-3 text-[15px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-apple-blue transition-all"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-5 py-3 rounded-xl bg-apple-blue text-white text-[15px] font-semibold disabled:opacity-40 active:scale-[0.97] transition-all"
          >
            전송
          </button>
        </form>
      </div>
    </div>
  );
}

function ChatBubble({ role, text, loading }: { role: "user" | "ai"; text: string; loading?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fadeSlideUp`}>
      <div
        className={`max-w-[80%] px-4 py-3 rounded-2xl text-[15px] leading-relaxed ${
          isUser
            ? "bg-apple-blue text-white rounded-br-md"
            : "bg-white text-apple-label2 rounded-bl-md shadow-card"
        } ${loading ? "animate-pulse-soft" : ""}`}
      >
        {text}
      </div>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-apple-gray">로딩 중...</div>}>
      <ResultsInner />
    </Suspense>
  );
}
