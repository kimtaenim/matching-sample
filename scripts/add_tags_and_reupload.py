"""
돌봄 매칭 봇 — 모든 도우미/가정에 tags 메타데이터 추가 + Upstash 재업로드
tags: 지역, 나이대, 돌봄유형, 성별, 시간대, bio 키워드
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


def generate_helper_tags(h):
    tags = []
    tags.append("도우미")
    tags.append(h.get("name", ""))
    tags.append(h.get("location", ""))

    parsed = h.get("parsed", {})
    if isinstance(parsed, dict):
        age = parsed.get("age", 0)
        if isinstance(age, (int, float)) and age > 0:
            tags.append(f"{int(age)}세")
            if age <= 25:
                tags.extend(["20대", "젊은", "young"])
            elif age <= 35:
                tags.extend(["30대", "젊은", "young"])
            elif age <= 45:
                tags.extend(["40대", "중년"])
            elif age <= 55:
                tags.extend(["50대", "중년"])
            else:
                tags.extend(["60대이상", "시니어"])

        care_types = parsed.get("care_type", [])
        if isinstance(care_types, list):
            tags.extend(care_types)
            for ct in care_types:
                if ct == "아동":
                    tags.extend(["아이", "초등", "어린이", "놀아주기", "방과후"])
                elif ct == "노인":
                    tags.extend(["어르신", "실버", "고령"])
                elif ct == "치매노인":
                    tags.extend(["치매", "어르신", "인지"])
                elif ct == "환자":
                    tags.extend(["간병", "병원", "거동불편"])
                elif ct == "장애인":
                    tags.extend(["장애", "활동보조"])

        hours = parsed.get("hours", "")
        if hours:
            tags.append(hours)
            if "09:" in hours or "08:" in hours or "07:" in hours:
                tags.append("오전")
            if "18:" in hours or "17:" in hours or "19:" in hours or "20:" in hours or "21:" in hours or "22:" in hours:
                tags.append("저녁")

        gender = parsed.get("preferred_gender", "")
        if gender:
            tags.append(gender)

    # bio에서 키워드 추출
    bio = h.get("bio", "")
    keywords = ["활발", "밝은", "차분", "꼼꼼", "따뜻", "성실", "경험", "경력", "자격증",
                "간호", "요리", "운전", "남성", "여성", "체력"]
    for kw in keywords:
        if kw in bio:
            tags.append(kw)

    seen = set()
    unique = []
    for t in tags:
        t = str(t).strip()
        if t and t not in seen:
            seen.add(t)
            unique.append(t)
    return unique


def generate_family_tags(f):
    tags = []
    tags.append("가정")
    tags.append(f.get("location", ""))

    parsed = f.get("parsed", {})
    if isinstance(parsed, dict):
        care_type = parsed.get("care_type", "")
        if care_type:
            tags.append(care_type)
        care_age = parsed.get("care_age", 0)
        if care_age:
            tags.append(f"{care_age}세")

    bio = f.get("bio", "")
    if bio:
        tags.append(bio[:50])

    seen = set()
    return [t for t in tags if t and (t not in seen and not seen.add(t))]


def process_and_upload(filename, tag_fn):
    filepath = DATA_DIR / filename
    data = json.loads(filepath.read_text(encoding="utf-8"))

    for item in data:
        item["tags"] = tag_fn(item)

    filepath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  {filename}: {len(data)}개 태그 추가")

    # 업로드
    total = 0
    for i in range(0, len(data), 10):
        batch = data[i:i+10]
        vectors = []
        for item in batch:
            tags = item.get("tags", [])
            text = " ".join(tags)
            vectors.append({
                "id": item["id"],
                "data": text,
                "metadata": item,
            })
        try:
            index.upsert(vectors=vectors)
            total += len(batch)
            if total % 50 == 0:
                print(f"  업로드: {total}/{len(data)}")
        except Exception as e:
            print(f"  오류: {e}")
        time.sleep(0.2)
    print(f"  업로드 완료: {total}개")
    return data


def main():
    print("=" * 50)
    print("돌봄 봇 - 태그 추가 + Upstash 재업로드")
    print("=" * 50)

    print("\n[helpers.json]")
    helpers = process_and_upload("helpers.json", generate_helper_tags)

    print("\n[families.json]")
    families = process_and_upload("families.json", generate_family_tags)

    # 태그 샘플
    print(f"\n도우미 태그 샘플:")
    for h in helpers[:3]:
        print(f"  {h['id']} {h['name']}: {h['tags'][:10]}...")

    print(f"\n총 도우미 {len(helpers)} + 가정 {len(families)} = {len(helpers)+len(families)}개")
    print("=" * 50)


if __name__ == "__main__":
    main()
