"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { SERVICE_AREAS } from "@/lib/distance";

export default function SearchPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [location, setLocation] = useState("봉천동");
  const [loading, setLoading] = useState(false);

  const submit = () => {
    if (!text.trim()) {
      alert("돌봄이 필요한 상황을 자유롭게 적어주세요.");
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ q: text, location });
    router.push(`/results?${params.toString()}`);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-[36px] font-semibold text-apple-label">
        어떤 돌봄이 필요하세요?
      </h1>
      <p className="mt-3 text-[18px] text-apple-gray">
        자유롭게 적어주시면 AI가 상황을 이해해 꼭 맞는 돌봄 선생님을 찾아드려요.
      </p>

      <div className="mt-10 space-y-6">
        <div>
          <label className="block text-[15px] text-apple-gray mb-2">돌봄 상황 설명</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="예) 85세 치매 어머니 돌봐주실 여성 선생님 찾아요. 오전 9시부터 오후 6시까지, 일당 12만원 정도 생각 중입니다."
            rows={6}
            className="w-full bg-apple-silver rounded-card border border-transparent focus:border-apple-blue focus:bg-white focus:outline-none p-5 text-[18px] leading-relaxed resize-none transition-all"
          />
        </div>

        <div>
          <label className="block text-[15px] text-apple-gray mb-2">지역</label>
          <div className="grid grid-cols-3 gap-3">
            {SERVICE_AREAS.map((a) => (
              <button
                key={a}
                onClick={() => setLocation(a)}
                className="text-[18px] py-4 rounded-2xl border transition-all active:scale-[0.97]"
                style={location === a
                  ? { background: "linear-gradient(135deg, #C5DDD9, #9DBFBA)", color: "white", borderColor: "transparent" }
                  : { background: "white", color: "#636366", borderColor: "#E5E5EA" }
                }
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4 flex justify-center">
          <Button onClick={submit} disabled={loading} className="w-full md:w-auto min-w-[240px]">
            {loading ? "찾는 중..." : "돌봄 선생님 찾기"}
          </Button>
        </div>

        <p className="text-center text-[13px] text-apple-gray">
          현재 서비스 지역: 봉천동, 과천, 대치동
        </p>
      </div>
    </div>
  );
}
