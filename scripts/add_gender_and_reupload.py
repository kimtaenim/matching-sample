"""
도우미/가정에 gender 필드 추가 (이름 기반 추론) + Upstash 재업로드.
이후 API에서 `parsed.gender = '여'` 형식으로 벡터 filter 사용 가능.
"""

import json, sys, time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

try:
    from upstash_vector import Index
except ImportError:
    print("pip install upstash-vector")
    sys.exit(1)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ENV_PATH = Path(__file__).resolve().parent.parent / ".env.local"

env = {}
for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

index = Index(url=env["UPSTASH_VECTOR_REST_URL"], token=env["UPSTASH_VECTOR_REST_TOKEN"])


# 한국 이름 끝글자 → 성별 (고신뢰 엔딩만, 나머지는 무작위 폴백)
FEMALE_ENDINGS = {
    "경", "숙", "희", "자", "순", "미", "연", "은", "정", "아", "혜", "주", "선",
    "림", "란", "채", "애", "옥", "실", "화", "임", "영", "숙", "진", "현", "빈",
    "윤", "담", "슬", "별", "솔", "원", "지", "서", "유", "나", "린", "예", "하"
}
MALE_ENDINGS = {
    "수", "석", "훈", "호", "준", "철", "규", "명", "식", "환", "택", "형", "용",
    "범", "혁", "재", "근", "민", "성", "우", "한", "웅", "빈", "찬", "국", "태",
    "호", "식", "학", "승", "기", "도", "현", "동", "성", "혁", "산"
}


def infer_gender(name: str) -> str:
    """이름 끝 한 글자로 성별 추론. 모호한 경우 이름 전체에서 특징 글자 찾기. 최후엔 '무관'."""
    if not name or len(name) < 2:
        return "무관"
    last = name[-1]
    if last in FEMALE_ENDINGS and last not in MALE_ENDINGS:
        return "여"
    if last in MALE_ENDINGS and last not in FEMALE_ENDINGS:
        return "남"
    # 충돌 글자 (현, 빈, 영 등): given name 전체에서 더 뚜렷한 힌트 찾기
    given = name[1:]  # 성 제외
    for ch in given:
        if ch in FEMALE_ENDINGS and ch not in MALE_ENDINGS:
            return "여"
        if ch in MALE_ENDINGS and ch not in FEMALE_ENDINGS:
            return "남"
    # 판별 불가 → 이름 해시로 랜덤 분배 (더미데이터니까 균형 유지)
    return "여" if hash(name) % 2 == 0 else "남"


def process_file(filename: str):
    filepath = DATA_DIR / filename
    data = json.loads(filepath.read_text(encoding="utf-8"))

    gender_count = {"여": 0, "남": 0}
    for item in data:
        name = item.get("name", "")
        parsed = item.setdefault("parsed", {})
        g = infer_gender(name)
        parsed["gender"] = g
        gender_count[g] = gender_count.get(g, 0) + 1

        # tags에도 성별 추가 (벡터 검색 시 힌트)
        tags = item.get("tags", [])
        if g not in tags:
            tags.append(g)
            if g == "여":
                for syn in ["여자", "여성", "여선생님", "여선생"]:
                    if syn not in tags:
                        tags.append(syn)
            else:
                for syn in ["남자", "남성", "남선생님", "남선생"]:
                    if syn not in tags:
                        tags.append(syn)
        item["tags"] = tags

    filepath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  {filename}: 여 {gender_count.get('여', 0)}명 / 남 {gender_count.get('남', 0)}명")
    return data


def reupload(data):
    total = 0
    for i in range(0, len(data), 10):
        batch = data[i:i+10]
        vectors = []
        for item in batch:
            tags = item.get("tags", [])
            text = " ".join(str(t) for t in tags)
            vectors.append({
                "id": item["id"],
                "data": text,
                "metadata": item,
            })
        try:
            index.upsert(vectors=vectors)
            total += len(batch)
        except Exception as e:
            print(f"  오류 ({i}): {e}")
        time.sleep(0.2)
    print(f"  업로드 완료: {total}개")


def main():
    print("=" * 50)
    print("돌봄 봇 - gender 필드 추가 + Upstash 재업로드")
    print("=" * 50)

    print("\n[helpers.json]")
    helpers = process_file("helpers.json")
    reupload(helpers)

    print("\n[families.json]")
    families = process_file("families.json")
    reupload(families)

    print("\n성별 샘플:")
    for h in helpers[:8]:
        print(f"  {h['name']} → {h['parsed'].get('gender')}")

    print("=" * 50)


if __name__ == "__main__":
    main()
