"""
돌봄 매칭 챗봇 — 더미데이터를 Upstash Vector에 업로드
Upstash Vector 인덱스는 BGE-M3 임베딩 모델로 생성되어 있어야 함.
"""

import json, os, sys, time
from pathlib import Path

try:
    from upstash_vector import Index
except ImportError:
    print("pip install upstash-vector 를 먼저 실행하세요.")
    sys.exit(1)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ENV_PATH = Path(__file__).resolve().parent.parent / ".env.local"

env = {}
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()

url = env.get("UPSTASH_VECTOR_REST_URL", "")
token = env.get("UPSTASH_VECTOR_REST_TOKEN", "")

if not url or not token:
    print("UPSTASH_VECTOR_REST_URL / TOKEN이 .env.local에 설정되지 않았습니다.")
    sys.exit(1)

index = Index(url=url, token=token)

BATCH_SIZE = 10


def make_helper_text(h: dict) -> str:
    """도우미 레코드 → 검색용 텍스트"""
    parsed = h.get("parsed", {})
    parts = [
        f"[도우미] {h.get('name', '')}",
        f"지역: {h.get('location', '')}",
        f"나이: {parsed.get('age', '')}",
        f"돌봄유형: {', '.join(parsed.get('care_type', []))}",
        f"시간: {parsed.get('hours', '')}",
        f"희망일당: {parsed.get('wage_min', '')}원",
        f"선호성별: {parsed.get('preferred_gender', '')}",
    ]
    bio = h.get("bio", "")
    if bio:
        parts.append(bio)
    for r in h.get("reviews_received", [])[:3]:
        if r.get("text"):
            parts.append(f"후기: {r['text']}")
    return " | ".join(parts)


def make_family_text(f: dict) -> str:
    """가정 레코드 → 검색용 텍스트"""
    parsed = f.get("parsed", {})
    parts = [
        f"[가정]",
        f"지역: {f.get('location', '')}",
        f"돌봄유형: {parsed.get('care_type', '')}",
        f"돌봄대상 나이: {parsed.get('care_age', '')}",
        f"시간: {parsed.get('hours', '')}",
        f"최대일당: {parsed.get('wage_max', '')}원",
        f"선호성별: {parsed.get('preferred_gender', '')}",
    ]
    bio = f.get("bio", "")
    if bio:
        parts.append(bio)
    for r in f.get("reviews_received", [])[:3]:
        if r.get("text"):
            parts.append(f"후기: {r['text']}")
    return " | ".join(parts)


def upload_file(filename: str, text_fn):
    filepath = DATA_DIR / filename
    if not filepath.exists():
        print(f"  {filename} 없음, 건너뜀")
        return 0

    data = json.loads(filepath.read_text(encoding="utf-8"))
    if not data:
        print(f"  {filename} 비어있음")
        return 0

    total = 0
    for i in range(0, len(data), BATCH_SIZE):
        batch = data[i:i + BATCH_SIZE]
        vectors = []
        for item in batch:
            item_id = item.get("id", f"unknown_{total}")
            text = text_fn(item)
            vectors.append({
                "id": item_id,
                "data": text,
                "metadata": item,
            })
        try:
            index.upsert(vectors=vectors)
            total += len(batch)
            print(f"  {filename}: {total}/{len(data)}")
        except Exception as e:
            print(f"  {filename} 오류: {e}")
        time.sleep(0.3)

    return total


def main():
    print("=" * 50)
    print("돌봄 매칭 — Upstash Vector 업로드")
    print("=" * 50)

    print("\n[helpers.json]")
    h_count = upload_file("helpers.json", make_helper_text)

    print("\n[families.json]")
    f_count = upload_file("families.json", make_family_text)

    print(f"\n{'=' * 50}")
    print(f"업로드 완료: 도우미 {h_count}건, 가정 {f_count}건, 총 {h_count + f_count}건")
    print("=" * 50)


if __name__ == "__main__":
    main()
