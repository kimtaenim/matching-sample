"""
젊은 도우미 200명 추가 생성 (20~35세)
기존 helpers.json에 추가 + Upstash에 업로드
"""

import json, os, sys, time, random
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

try:
    import anthropic
    from upstash_vector import Index
except ImportError:
    print("pip install anthropic upstash-vector")
    sys.exit(1)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ENV_PATH = Path(__file__).resolve().parent.parent / ".env.local"

env = {}
for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

client = anthropic.Anthropic(api_key=env["ANTHROPIC_API_KEY"])
index = Index(url=env["UPSTASH_VECTOR_REST_URL"], token=env["UPSTASH_VECTOR_REST_TOKEN"])

MODEL = "claude-haiku-4-5-20251001"
LOCATIONS = ["봉천동", "과천", "대치동"]
CARE_TYPES = ["아동", "노인", "치매노인", "장애인", "환자"]
GENDERS = ["남", "여"]

total_input = 0
total_output = 0


def call_haiku(prompt, max_tokens=4096):
    global total_input, total_output
    resp = client.messages.create(
        model=MODEL, max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    total_input += resp.usage.input_tokens
    total_output += resp.usage.output_tokens
    return resp.content[0].text


def extract_json(text):
    start = text.find("[")
    if start == -1: start = text.find("{")
    if start == -1: raise ValueError("No JSON")
    end = text.rfind("]") if text[start] == "[" else text.rfind("}")
    return json.loads(text[start:end+1])


def gen_young_helpers(start_id, count=200):
    helpers = []
    batch_size = 10
    for batch in range(count // batch_size):
        sid = start_id + batch * batch_size
        prompt = f"""한국의 젊은 돌봄 도우미 {batch_size}명의 더미데이터를 JSON 배열로 생성하세요.
id는 h{sid:03d}~h{sid+batch_size-1:03d}.

조건:
- 나이: 20~35세 (골고루 분포)
- 성별: 남녀 골고루
- 지역: 봉천동, 과천, 대치동 중 하나
- care_type: 아동/노인/치매노인/장애인/환자 중 1~3개
- bio: 자기소개 2~3문장. 젊고 활발한 느낌, 각자 개성 있게.
- hours: 다양하게 (09:00-18:00, 14:00-22:00, 07:00-15:00 등)
- wage_min: 80000~150000 사이
- preferred_gender: 무관/남/여

형식:
{{
  "id": "h201",
  "name": "한국식 이름",
  "location": "봉천동",
  "bio": "자기소개",
  "parsed": {{
    "care_type": ["아동"],
    "age": 25,
    "wage_min": 100000,
    "hours": "09:00-18:00",
    "preferred_gender": "무관"
  }},
  "reviews_received": [],
  "reviews_written": []
}}

JSON 배열만 출력."""

        text = call_haiku(prompt)
        try:
            items = extract_json(text)
            helpers.extend(items)
            print(f"  배치 {batch+1}/{count//batch_size}: {len(items)}명")
        except Exception as e:
            print(f"  배치 {batch+1} 실패: {e}")
        time.sleep(0.3)

    return helpers


def upload_to_vector(helpers):
    batch_size = 10
    total = 0
    for i in range(0, len(helpers), batch_size):
        batch = helpers[i:i+batch_size]
        vectors = []
        for h in batch:
            parsed = h.get("parsed", {})
            text = f"[도우미] {h.get('name','')} | 지역: {h.get('location','')} | 나이: {parsed.get('age','')} | 돌봄유형: {', '.join(parsed.get('care_type',[]))} | {h.get('bio','')}"
            vectors.append({"id": h["id"], "data": text, "metadata": h})
        try:
            index.upsert(vectors=vectors)
            total += len(batch)
            print(f"  업로드: {total}/{len(helpers)}")
        except Exception as e:
            print(f"  업로드 오류: {e}")
        time.sleep(0.3)
    return total


def main():
    print("=" * 50)
    print("젊은 도우미 200명 추가 생성")
    print("=" * 50)

    # 기존 데이터 로드
    helpers_path = DATA_DIR / "helpers.json"
    existing = json.loads(helpers_path.read_text(encoding="utf-8"))
    print(f"기존 도우미: {len(existing)}명")

    # 새 ID 시작점
    max_id = max(int(h["id"][1:]) for h in existing if h["id"].startswith("h"))
    start_id = max_id + 1
    print(f"새 ID 시작: h{start_id:03d}")

    # 생성
    print("\n생성 중...")
    new_helpers = gen_young_helpers(start_id, 200)
    print(f"생성 완료: {len(new_helpers)}명")

    # 기존에 추가
    existing.extend(new_helpers)
    helpers_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"저장 완료: 총 {len(existing)}명")

    # Upstash 업로드
    print("\nUpstash 업로드 중...")
    uploaded = upload_to_vector(new_helpers)
    print(f"업로드 완료: {uploaded}명")

    # 비용
    cost_usd = (total_input / 1_000_000) * 0.8 + (total_output / 1_000_000) * 4.0
    cost_krw = round(cost_usd * 1350)
    print(f"\n비용: {cost_krw}원 (입력 {total_input:,} / 출력 {total_output:,} tokens)")

    # 등록 도우미 수 확인
    print(f"\n최종 등록 도우미: {len(existing)}명 (400+ 목표)")
    print("=" * 50)


if __name__ == "__main__":
    main()
