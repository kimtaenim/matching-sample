"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Helper } from "@/lib/types";
import { HelperCard } from "@/components/HelperCard";
import { Button } from "@/components/Button";
import { useTokens, tokenedFetch } from "@/components/TokenProvider";

interface ResultItem extends Helper {
  match_reason: string;
  match_score: number;
  headline?: string;
  for_family?: string;
  for_helper?: string;
}

interface MatchResponse {
  need_info?: boolean;
  next_key?: string;
  next_question?: string;
  next_type?: "select" | "number" | "text";
  next_options?: string[] | null;
  turn?: number;
  turns_left?: number;
  results?: ResultItem[];
  requester_id?: string | null;
}

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** assistant 질문의 경우 어떤 key에 대한 질문인지 */
  asksKey?: string;
}

function ResultsInner() {
  const params = useSearchParams();
  const initialBio = params.get("q") || "";
  const location = params.get("location") || "봉천동";
  const { add } = useTokens();

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [bio, setBio] = useState(initialBio);
  const [turnCount, setTurnCount] = useState(0);
  const [skippedKeys, setSkippedKeys] = useState<string[]>([]);
  const [pending, setPending] = useState<MatchResponse | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [finalResults, setFinalResults] = useState<{
    results: ResultItem[];
    requester_id: string | null;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialBio) {
      setTurns([{ role: "user", text: initialBio }]);
      runMatch(initialBio, 0, []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, finalResults]);

  async function runMatch(
    currentBio: string,
    currentTurn: number,
    currentSkipped: string[]
  ) {
    setLoading(true);
    setErr(null);
    try {
      const r = await tokenedFetch<MatchResponse>(
        "/api/match",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bio: currentBio,
            location,
            role: "family",
            skipped_keys: currentSkipped,
            turn: currentTurn,
          }),
        },
        add
      );
      if (r.need_info && r.next_question) {
        setPending(r);
        setTurns((t) => [
          ...t,
          { role: "assistant", text: r.next_question!, asksKey: r.next_key },
        ]);
      } else {
        setPending(null);
        setFinalResults({
          results: r.results || [],
          requester_id: r.requester_id ?? null,
        });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleAnswer(value: string) {
    if (!pending || loading) return;
    const trimmed = value.trim();
    const asksKey = pending.next_key!;
    const displayText = trimmed || "(건너뛸게요)";
    const newTurns: ChatTurn[] = [
      ...turns,
      { role: "user", text: displayText },
    ];
    setTurns(newTurns);
    setInput("");

    if (!trimmed) {
      const newSkipped = [...skippedKeys, asksKey];
      setSkippedKeys(newSkipped);
      runMatch(bio, turnCount + 1, newSkipped);
      setTurnCount(turnCount + 1);
      return;
    }

    const q = pending.next_question!;
    const newBio = `${bio}\n(Q: ${q}\n A: ${trimmed})`;
    setBio(newBio);
    setTurnCount(turnCount + 1);
    runMatch(newBio, turnCount + 1, skippedKeys);
  }

  // err 있어도 전체 화면 교체하지 말고 하단에 토스트로만 표시

  return (
    <div>
      <h1 className="text-[30px] font-semibold text-apple-label">
        {finalResults
          ? `추천 돌봄 선생님 ${finalResults.results.length}분`
          : "돌봄 상황 확인 중"}
      </h1>
      <p className="mt-2 text-[16px] text-apple-gray">
        {finalResults
          ? "말씀해주신 상황에 맞춰 AI가 선정한 결과입니다."
          : "몇 가지만 더 여쭤보고 적합한 돌봄 선생님을 찾아드릴게요."}
      </p>

      {/* 대화 영역 */}
      <div className="mt-6 space-y-3">
        {turns.map((t, i) => (
          <ChatBubble key={i} role={t.role} text={t.text} />
        ))}
        {loading && <ChatBubble role="assistant" text="생각 중..." loading />}
        <div ref={scrollRef} />
      </div>

      {/* 답변 입력 */}
      {pending && !loading && pending.next_question && (
        <div className="mt-5 bg-white rounded-card p-5 shadow-card">
          {pending.next_type === "select" && pending.next_options && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {pending.next_options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => handleAnswer(opt)}
                  className="text-[15px] px-4 py-2.5 rounded-xl bg-apple-silver hover:bg-apple-silver2 active:scale-[0.97] transition-all"
                >
                  {opt}
                </button>
              ))}
              <button
                onClick={() => handleAnswer("")}
                className="text-[15px] px-4 py-2.5 rounded-xl bg-white border border-apple-silver2 text-apple-gray hover:bg-apple-silver active:scale-[0.97] transition-all"
              >
                건너뛰기
              </button>
            </div>
          )}
          {pending.next_type !== "select" && (
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAnswer(input);
                }}
                placeholder="답변을 입력하거나 엔터로 건너뛰기"
                type={pending.next_type === "number" ? "text" : "text"}
                className="flex-1 bg-apple-silver rounded-xl px-4 py-3 text-[17px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-apple-blue transition-all"
              />
              <Button onClick={() => handleAnswer(input)} variant="secondary">
                확인
              </Button>
            </div>
          )}
          {typeof pending.turns_left === "number" && pending.turns_left > 0 && (
            <p className="mt-3 text-[12px] text-apple-gray">
              앞으로 최대 {pending.turns_left}번 정도만 더 여쭤볼게요
            </p>
          )}
        </div>
      )}

      {err && (
        <div className="mt-4 bg-apple-silver border border-apple-silver2 rounded-xl p-4 text-[14px] text-apple-label2">
          잠시 문제가 있었어요. 다시 말씀해주시면 이어서 진행할게요.
          <button
            onClick={() => runMatch(bio, turnCount, skippedKeys)}
            className="ml-2 text-apple-blue hover:underline"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 최종 결과 카드 */}
      {finalResults && (
        <>
          {finalResults.results.length === 0 ? (
            <div className="mt-8 bg-white rounded-card p-8 text-center shadow-card">
              <p className="text-[18px] text-apple-label font-semibold">
                지금 사연과 꼭 맞는 분을 찾지 못했어요
              </p>
              <p className="mt-2 text-apple-gray text-[15px] leading-relaxed">
                조건을 조금 바꿔보시거나, 다른 지역·시간대로 다시 상담해보시면
                <br />더 좋은 분을 만나실 수 있을 거예요.
              </p>
              <a
                href="/search"
                className="mt-5 inline-block text-[15px] text-apple-blue hover:underline"
              >
                다른 조건으로 다시 상담하기 →
              </a>
            </div>
          ) : (
            <div className="mt-8 space-y-4">
              {finalResults.results.map((r, i) => (
                <HelperCard
                  key={r.id}
                  helper={r}
                  index={i}
                  matchReason={r.match_reason}
                  matchScore={r.match_score}
                  headline={r.headline}
                  forFamily={r.for_family}
                  forHelper={r.for_helper}
                  familyId={finalResults.requester_id || undefined}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ChatBubble({
  role,
  text,
  loading,
}: {
  role: "user" | "assistant";
  text: string;
  loading?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fadeSlideUp`}>
      <div
        className={`max-w-[80%] px-4 py-3 rounded-2xl text-[16px] leading-relaxed ${
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
