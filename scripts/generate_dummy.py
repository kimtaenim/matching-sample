"""
돌봄 매칭 서비스 더미 데이터 생성 스크립트

도우미 200명, 가정 200명, 매칭 100건을 생성하고
bio 및 후기 텍스트는 Claude API (claude-haiku-4-5)로 생성합니다.

실행: python generate_dummy.py
필요: ANTHROPIC_API_KEY 환경변수
"""

import json
import os
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

from anthropic import Anthropic


def _load_env_file(path: Path):
    """간단한 .env 파서 (python-dotenv 의존성 없이)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        # 비어있거나 없으면 덮어쓰기 (setdefault는 빈 값일 때도 유지하는 문제가 있음)
        if not os.environ.get(k):
            os.environ[k] = v


# ANTHROPIC_API_KEY가 환경변수에 없으면 프로젝트 루트의 .env.local 에서 로드
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_load_env_file(_PROJECT_ROOT / ".env.local")

# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------
MODEL = "claude-haiku-4-5-20251001"
BATCH_SIZE = 10

N_HELPERS = 200
N_FAMILIES = 200
N_MATCHES = 100

LOCATIONS = ["봉천동", "과천", "대치동"]
CARE_TYPES = ["아동", "노인", "치매노인", "장애인", "환자"]
GENDERS = ["무관", "남", "여"]

# 거리 테이블 (km). None 또는 10 초과 = 매칭 불가
DISTANCE = {
    ("봉천동", "봉천동"): 1,
    ("봉천동", "과천"): 6,
    ("과천", "봉천동"): 6,
    ("봉천동", "대치동"): 15,
    ("대치동", "봉천동"): 15,
    ("과천", "과천"): 1,
    ("과천", "대치동"): 10,
    ("대치동", "과천"): 10,
    ("대치동", "대치동"): 1,
}
MAX_DISTANCE = 10

# 가격 (USD per 1M tokens)
PRICE_INPUT_PER_M = 0.80
PRICE_OUTPUT_PER_M = 4.00
USD_TO_KRW = 1350

# ---------------------------------------------------------------------------
# 성 및 이름 풀
# ---------------------------------------------------------------------------
SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "류", "전"]
GIVEN_NAMES = [
    "영자", "순자", "미숙", "정순", "말순", "경숙", "영숙", "명자", "정희", "춘자",
    "은영", "지영", "미경", "현숙", "수진", "혜경", "미영", "선영", "영희", "연숙",
    "상철", "기석", "병호", "재현", "동근", "성수", "용환", "진호", "창수", "만식",
    "민수", "준호", "성민", "재훈", "지훈", "동훈", "영수", "철수", "현우", "태호",
]

# ---------------------------------------------------------------------------
# 토큰 트래커
# ---------------------------------------------------------------------------
class Usage:
    input = 0
    output = 0


def call_claude(client: Anthropic, prompt: str, max_tokens: int = 2048) -> str:
    resp = client.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    Usage.input += resp.usage.input_tokens
    Usage.output += resp.usage.output_tokens
    return resp.content[0].text


def extract_json_array(text: str):
    """응답 텍스트에서 JSON 배열 추출."""
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1:
        raise ValueError(f"JSON array not found: {text[:200]}")
    return json.loads(text[start : end + 1])


# ---------------------------------------------------------------------------
# 구조적(parsed) 데이터 생성
# ---------------------------------------------------------------------------
def random_hours():
    start = random.choice([7, 8, 9, 10, 13])
    length = random.choice([4, 6, 8, 9])
    end = start + length
    return f"{start:02d}:00-{end:02d}:00"


def make_helper_struct(i: int):
    care_types = random.sample(CARE_TYPES, k=random.randint(1, 3))
    return {
        "id": f"h{i:03d}",
        "name": random.choice(SURNAMES) + random.choice(GIVEN_NAMES),
        "location": random.choice(LOCATIONS),
        "parsed": {
            "wage_min": random.choice([80000, 90000, 100000, 110000, 120000, 130000, 150000]),
            "care_type": care_types,
            "hours": random_hours(),
            "preferred_gender": random.choice(GENDERS),
            "age": random.randint(35, 68),
        },
    }


def make_family_struct(i: int):
    care_type = random.choice(CARE_TYPES)
    if care_type == "아동":
        care_age = random.randint(1, 12)
    elif care_type in ("노인", "치매노인"):
        care_age = random.randint(70, 92)
    else:
        care_age = random.randint(20, 80)
    return {
        "id": f"f{i:03d}",
        "location": random.choice(LOCATIONS),
        "parsed": {
            "wage_max": random.choice([90000, 100000, 110000, 120000, 130000, 150000, 180000]),
            "care_type": care_type,
            "hours": random_hours(),
            "preferred_gender": random.choice(GENDERS),
            "care_age": care_age,
        },
    }


# ---------------------------------------------------------------------------
# bio 생성 (Claude API)
# ---------------------------------------------------------------------------
def gen_helper_bios(client: Anthropic, batch):
    items = [
        {
            "id": h["id"],
            "name": h["name"],
            "location": h["location"],
            "care_type": h["parsed"]["care_type"],
            "age": h["parsed"]["age"],
            "wage_min": h["parsed"]["wage_min"],
            "hours": h["parsed"]["hours"],
        }
        for h in batch
    ]
    prompt = f"""아래는 돌봄 도우미 {len(items)}명의 정보입니다. 각 도우미마다 자기소개서 형식의 bio를 한국어로 2-4문장 작성해주세요.
경력, 성격, 강점, 희망 조건이 자연스럽게 드러나게 써주세요. 딱딱하지 않고 진솔한 톤으로.

도우미 정보:
{json.dumps(items, ensure_ascii=False, indent=2)}

JSON 배열로만 응답하세요. 형식:
[{{"id": "h001", "bio": "..."}}, ...]
"""
    text = call_claude(client, prompt, max_tokens=3500)
    return {x["id"]: x["bio"] for x in extract_json_array(text)}


def gen_family_bios(client: Anthropic, batch):
    items = [
        {
            "id": f["id"],
            "location": f["location"],
            "care_type": f["parsed"]["care_type"],
            "care_age": f["parsed"]["care_age"],
            "wage_max": f["parsed"]["wage_max"],
            "hours": f["parsed"]["hours"],
            "preferred_gender": f["parsed"]["preferred_gender"],
        }
        for f in batch
    ]
    prompt = f"""아래는 돌봄 서비스를 구하는 가정 {len(items)}곳의 정보입니다. 각 가정이 커뮤니티 게시판에 넋두리처럼 편하게 쓴 bio를 한국어로 2-4문장 작성해주세요.
고민, 상황, 원하는 조건을 편한 말투로. 완벽한 문장이 아니어도 됩니다. "~해요", "~네요" 같은 자연스러운 구어체로.

가정 정보:
{json.dumps(items, ensure_ascii=False, indent=2)}

JSON 배열로만 응답하세요. 형식:
[{{"id": "f001", "bio": "..."}}, ...]
"""
    text = call_claude(client, prompt, max_tokens=3500)
    return {x["id"]: x["bio"] for x in extract_json_array(text)}


def gen_reviews(client: Anthropic, batch):
    """matches 배치에 대해 양방향 후기를 생성."""
    items = [
        {
            "match_id": m["id"],
            "helper_name": m["_helper_name"],
            "family_care_type": m["_care_type"],
            "family_care_age": m["_care_age"],
            "rating_helper": m["review_helper"]["rating"],
            "rating_family": m["review_family"]["rating"],
        }
        for m in batch
    ]
    prompt = f"""아래는 돌봄 매칭 {len(items)}건의 정보입니다. 각 매칭마다 두 개의 후기를 작성해주세요:
1) family_review: 가정이 도우미에게 남긴 후기 (1-2문장, rating_helper 점수에 어울리는 톤)
2) helper_review: 도우미가 가정에게 남긴 후기 (1-2문장, rating_family 점수에 어울리는 톤)

자연스럽고 구체적으로, 돌봄 대상 정보를 반영해서 써주세요.

매칭 정보:
{json.dumps(items, ensure_ascii=False, indent=2)}

JSON 배열로만 응답하세요. 형식:
[{{"match_id": "m001", "family_review": "...", "helper_review": "..."}}, ...]
"""
    text = call_claude(client, prompt, max_tokens=3000)
    return {x["match_id"]: x for x in extract_json_array(text)}


# ---------------------------------------------------------------------------
# 메인 파이프라인
# ---------------------------------------------------------------------------
def batched(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY 환경변수가 필요합니다.", file=sys.stderr)
        sys.exit(1)

    random.seed(42)
    client = Anthropic()

    # 1. 구조 데이터
    print(f"[1/4] 도우미 {N_HELPERS}명, 가정 {N_FAMILIES}곳 구조 데이터 생성...")
    helpers = [make_helper_struct(i + 1) for i in range(N_HELPERS)]
    families = [make_family_struct(i + 1) for i in range(N_FAMILIES)]

    # 2. 헬퍼 bio
    print(f"[2/4] 도우미 bio 생성 (배치 {BATCH_SIZE}건씩, 총 {N_HELPERS // BATCH_SIZE}회 호출)...")
    for idx, batch in enumerate(batched(helpers, BATCH_SIZE), 1):
        bios = gen_helper_bios(client, batch)
        for h in batch:
            h["bio"] = bios.get(h["id"], "")
        print(f"   helper batch {idx}/{N_HELPERS // BATCH_SIZE} done")

    # 3. 가정 bio
    print(f"[3/4] 가정 bio 생성 (배치 {BATCH_SIZE}건씩)...")
    for idx, batch in enumerate(batched(families, BATCH_SIZE), 1):
        bios = gen_family_bios(client, batch)
        for f in batch:
            f["bio"] = bios.get(f["id"], "")
        print(f"   family batch {idx}/{N_FAMILIES // BATCH_SIZE} done")

    # reviews 필드 초기화
    for h in helpers:
        h["reviews_received"] = []
        h["reviews_written"] = []
    for f in families:
        f["reviews_received"] = []
        f["reviews_written"] = []

    # 4. 매칭 생성 (거리 조건)
    print(f"[4/4] 매칭 {N_MATCHES}건 생성 및 후기 작성...")
    helpers_by_id = {h["id"]: h for h in helpers}
    families_by_id = {f["id"]: f for f in families}

    matches = []
    attempts = 0
    used = set()
    while len(matches) < N_MATCHES and attempts < N_MATCHES * 30:
        attempts += 1
        h = random.choice(helpers)
        f = random.choice(families)
        key = (h["id"], f["id"])
        if key in used:
            continue
        dist = DISTANCE.get((h["location"], f["location"]))
        if dist is None or dist > MAX_DISTANCE:
            continue
        # care_type 겹치는지 체크 (선택적)
        if f["parsed"]["care_type"] not in h["parsed"]["care_type"]:
            # 70% 확률로 skip, 30%는 허용 (유연 매칭)
            if random.random() < 0.7:
                continue
        used.add(key)
        date = (datetime(2025, 10, 1) + timedelta(days=random.randint(0, 180))).strftime("%Y-%m-%d")
        rating_h = random.choices([5, 4, 3, 2], weights=[55, 30, 12, 3])[0]
        rating_f = random.choices([5, 4, 3, 2], weights=[55, 30, 12, 3])[0]
        reasons = [
            f"거리 {dist}km, 돌봄 유형 일치",
            f"희망 조건 근접 (거리 {dist}km)",
            f"시간대 및 지역 매칭 ({h['location']}-{f['location']})",
            f"돌봄 경험 및 조건 부합",
        ]
        m = {
            "id": f"m{len(matches) + 1:03d}",
            "helper_id": h["id"],
            "family_id": f["id"],
            "date": date,
            "status": "완료",
            "match_reason": random.choice(reasons),
            "review_helper": {"rating": rating_h, "text": ""},
            "review_family": {"rating": rating_f, "text": ""},
            "_helper_name": h["name"],
            "_care_type": f["parsed"]["care_type"],
            "_care_age": f["parsed"]["care_age"],
        }
        matches.append(m)

    print(f"   매칭 {len(matches)}건 구성 완료. 후기 생성 중...")

    # 후기 생성
    for idx, batch in enumerate(batched(matches, BATCH_SIZE), 1):
        reviews = gen_reviews(client, batch)
        for m in batch:
            r = reviews.get(m["id"], {})
            m["review_helper"]["text"] = r.get("family_review", "")
            m["review_family"]["text"] = r.get("helper_review", "")
        print(f"   review batch {idx}/{(len(matches) + BATCH_SIZE - 1) // BATCH_SIZE} done")

    # reviews 역참조 채우기
    for m in matches:
        h = helpers_by_id[m["helper_id"]]
        f = families_by_id[m["family_id"]]
        h["reviews_received"].append({
            "from": m["family_id"], "date": m["date"],
            "rating": m["review_helper"]["rating"], "text": m["review_helper"]["text"],
        })
        f["reviews_written"].append({
            "to": m["helper_id"], "date": m["date"],
            "rating": m["review_helper"]["rating"], "text": m["review_helper"]["text"],
        })
        f["reviews_received"].append({
            "from": m["helper_id"], "date": m["date"],
            "rating": m["review_family"]["rating"], "text": m["review_family"]["text"],
        })
        h["reviews_written"].append({
            "to": m["family_id"], "date": m["date"],
            "rating": m["review_family"]["rating"], "text": m["review_family"]["text"],
        })

    # 내부용 필드 제거
    for m in matches:
        for k in ("_helper_name", "_care_type", "_care_age"):
            m.pop(k, None)

    # 저장
    data_dir = _PROJECT_ROOT / "data"
    data_dir.mkdir(exist_ok=True)
    with open(data_dir / "helpers.json", "w", encoding="utf-8") as fp:
        json.dump(helpers, fp, ensure_ascii=False, indent=2)
    with open(data_dir / "families.json", "w", encoding="utf-8") as fp:
        json.dump(families, fp, ensure_ascii=False, indent=2)
    with open(data_dir / "matches.json", "w", encoding="utf-8") as fp:
        json.dump(matches, fp, ensure_ascii=False, indent=2)

    # 비용 계산
    cost_usd = (Usage.input / 1_000_000) * PRICE_INPUT_PER_M + (Usage.output / 1_000_000) * PRICE_OUTPUT_PER_M
    cost_krw = cost_usd * USD_TO_KRW
    print(
        f"더미데이터 생성 완료 | 총 비용: 약 {cost_krw:,.0f}원 "
        f"(입력 {Usage.input:,} tokens / 출력 {Usage.output:,} tokens)"
    )


if __name__ == "__main__":
    main()
