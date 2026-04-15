"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/Button";
import { HelperCard } from "@/components/HelperCard";
import { SERVICE_AREAS } from "@/lib/distance";
import type { Helper } from "@/lib/types";
import { useTokens, tokenedFetch } from "@/components/TokenProvider";

type Role = "helper" | "family";

interface ResultItem extends Helper {
  match_reason: string;
  match_score: number;
}
interface AddResult {
  id: string;
  requester_id: string;
  results: ResultItem[];
}

function AdminInner() {
  const params = useSearchParams();
  const initial = (params.get("role") === "family" ? "family" : "helper") as Role;
  const [role, setRole] = useState<Role>(initial);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("봉천동");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AddResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { add } = useTokens();

  const submit = async () => {
    if (!bio.trim() || (role === "helper" && !name.trim())) {
      alert("필수 항목을 모두 입력해주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload =
        role === "helper"
          ? { role, name, location, bio }
          : { role, location, bio };
      const data = await tokenedFetch<AddResult>(
        "/api/admin/add",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        add
      );
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-[36px] font-bold text-apple-label">프로필 등록</h1>
      <p className="mt-2 text-[17px] text-apple-gray">
        자연어로 설명만 입력하면 AI가 구조화해 저장하고, 즉시 매칭을 실행합니다.
      </p>

      <div className="mt-8 flex gap-2">
        {(["helper", "family"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`text-[17px] px-6 py-3 rounded-full transition-all active:scale-[0.97] ${
              role === r
                ? "bg-apple-blue text-white shadow-card"
                : "bg-apple-silver text-apple-label2 hover:bg-apple-silver2"
            }`}
          >
            {r === "helper" ? "도우미 등록" : "가정 등록"}
          </button>
        ))}
      </div>

      <div className="mt-8 bg-white border border-apple-silver2 rounded-card p-8 shadow-card space-y-5">
        {role === "helper" && (
          <Field label="이름">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 김영숙"
              className="w-full bg-apple-silver rounded-xl px-4 py-3 text-[18px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-apple-blue transition-all"
            />
          </Field>
        )}

        <Field label="지역">
          <div className="grid grid-cols-3 gap-3">
            {SERVICE_AREAS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setLocation(a)}
                className={`text-[17px] py-3 rounded-xl border transition-all active:scale-[0.97] ${
                  location === a
                    ? "bg-apple-blue text-white border-apple-blue"
                    : "bg-white text-apple-label border-apple-silver2 hover:bg-apple-silver"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label={role === "helper" ? "자기소개 (자연어)" : "돌봄 조건 (자연어)"}
        >
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={5}
            placeholder={
              role === "helper"
                ? "예) 50대 여성입니다. 아동과 노인 돌봄 경력 10년이고, 평일 오전 9시부터 오후 6시까지 가능합니다. 일당 12만원 정도 원합니다."
                : "예) 85세 치매 어머니 돌봐주실 여성 선생님 찾아요. 오전 9시부터 오후 6시까지, 일당 12만원 정도 생각 중입니다."
            }
            className="w-full bg-apple-silver rounded-xl p-4 text-[17px] leading-relaxed focus:bg-white focus:outline-none focus:ring-2 focus:ring-apple-blue transition-all resize-none"
          />
        </Field>

        <div className="flex justify-end pt-2">
          <Button onClick={submit} disabled={loading}>
            {loading ? "AI가 분석 중..." : "등록하고 매칭 실행"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-6 bg-red-50 border border-red-200 rounded-card p-4 text-red-700">
          오류: {error}
        </div>
      )}

      {result && (
        <div className="mt-10 animate-fadeSlideUp">
          <h2 className="text-[26px] font-bold">
            {role === "helper" ? "등록 완료" : "추천 도우미"}
          </h2>
          <p className="mt-1 text-apple-gray">
            {role === "helper"
              ? `새 도우미 ID: ${result.id}`
              : `새 가정 ID: ${result.id} · 아래 분들이 추천됐습니다.`}
          </p>

          {role === "family" && result.results.length > 0 ? (
            <div className="mt-6 space-y-4">
              {result.results.map((r, i) => (
                <HelperCard
                  key={r.id}
                  helper={r}
                  index={i}
                  matchReason={r.match_reason}
                  matchScore={r.match_score}
                  familyId={result.requester_id}
                />
              ))}
            </div>
          ) : role === "helper" ? (
            <p className="mt-4 text-apple-gray">
              등록됐습니다. 가정이 조건을 입력하면 이 분에게도 추천이 갑니다.
            </p>
          ) : (
            <p className="mt-4 text-apple-gray">
              조건에 맞는 도우미를 찾지 못했어요.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[14px] text-apple-gray mb-2">{label}</label>
      {children}
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-apple-gray">로딩 중...</div>}>
      <AdminInner />
    </Suspense>
  );
}
