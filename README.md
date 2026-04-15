# AI 돌봄 매칭

자연어로 조건을 입력하면 AI가 꼭 맞는 돌봄 도우미·가정을 매칭해주는 Next.js 데모 서비스입니다. 애플 헬스케어 스타일의 UI로, 돌봄 도우미·가정 프로필 관리, 양방향 후기 자동 생성, 실시간 비용 추적까지 포함합니다.

> **샘플용 프로젝트입니다.** 실제 서비스 배포 전 개인정보·인증·결제·안전 검증 로직을 반드시 보강해야 합니다.

## 주요 기능

- **AI 매칭**: 가정이 자연어로 조건을 입력하면 Claude Sonnet이 후보 도우미를 점수화해 상위 5명 추천
- **자동 bio 파싱**: 자기소개서를 입력하면 구조화된 프로필 필드(급여·시간·돌봄유형 등)로 자동 변환
- **양방향 후기 생성**: 매칭 성사 시 가정 → 도우미, 도우미 → 가정 방향 모두 현실적인 후기 작성
- **거리 하드 필터**: 봉천동/과천/대치동 3개 동 기준 10km 이내만 매칭
- **실시간 비용 추적**: 토큰 사용량·원화 환산 비용을 UI 및 `/api/cost`에서 확인

## 로컬 실행

1. **의존성 설치**
   ```bash
   npm install
   ```

2. **환경변수 설정** — `.env.local` 파일을 생성하고 API 키 입력:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
   (`.env.example` 참고)

3. **더미데이터 생성** (도우미 200, 가정 200, 매칭 100건)
   ```bash
   python scripts/generate_dummy.py
   ```
   완료 후 터미널에 비용 출력:
   ```
   더미데이터 생성 완료 | 총 비용: 약 454원 (입력 52,616 tokens / 출력 73,638 tokens)
   ```

4. **개발 서버 실행**
   ```bash
   npm run dev
   ```
   http://localhost:3000 접속.

## Vercel 배포

1. **GitHub repo에 push**
   ```bash
   git init && git add . && git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```

2. **Vercel에서 Import**
   - [vercel.com](https://vercel.com) → New Project → GitHub repo 선택
   - Framework: Next.js (자동 감지됨)

3. **Environment Variables 설정**
   - `ANTHROPIC_API_KEY` 에 실제 API 키 입력
   - 모든 환경(Production / Preview / Development)에 적용

4. **Deploy**
   - 자동 빌드 & 배포됨
   - `data/*.json` 은 빈 배열로 배포되므로, 로컬에서 `python scripts/generate_dummy.py` 실행 후 생성된 JSON을 커밋 → 재배포하면 데모 데이터가 반영됩니다

## 모델 구성

| 용도 | 모델 | 단가 (USD/1M tokens) |
|---|---|---|
| 더미데이터 생성 | `claude-haiku-4-5-20251001` | 입력 $0.80 / 출력 $4.00 |
| 매칭 추론 및 후기 생성 | `claude-sonnet-4-6` | 입력 $3.00 / 출력 $15.00 |

- 달러 → 원화 환산율: `× 1,350`
- 누적 비용은 서버 메모리에 저장되며 `/api/cost` 로 조회

## API 엔드포인트

| 엔드포인트 | 메서드 | 설명 |
|---|---|---|
| `/api/match` | POST | bio·location·role 받아 상위 5명 매칭. 요청자를 JSON에 영속화 |
| `/api/review` | POST | helper_id·family_id 로 양방향 후기 + matches.json 기록 |
| `/api/cost` | GET | 누적 입력/출력 토큰 · 원화 비용 |
| `/api/admin/add` | POST | 도우미/가정 추가 + 즉시 매칭 |
| `/api/match-result` | GET | 매칭 상세 조회 |
| `/api/profile` | GET | 프로필 후기 조회 |
| `/api/review-add` | POST | 단방향 AI 후기 추가 생성 |

## 프로젝트 구조

```
aicarematch/
├── app/
│   ├── layout.tsx              # 전역 레이아웃 + TokenProvider
│   ├── page.tsx                # 홈 (두 개의 메인 액션 카드)
│   ├── search/page.tsx         # 자연어 조건 입력
│   ├── results/page.tsx        # 매칭 결과 카드 리스트
│   ├── matched/page.tsx        # 매칭 성사 + 양방향 후기 표시
│   ├── admin/page.tsx          # 도우미/가정 등록 + 즉시 매칭
│   ├── profile/[id]/reviews/   # 프로필별 전체 후기
│   └── api/                    # 위 표 참조
├── components/
│   ├── Nav.tsx                 # 상단 네비 + 샘플용 뱃지
│   ├── HelperCard.tsx          # 확장형 도우미 카드
│   ├── TokenProvider.tsx       # 클라이언트 측 누적 비용 컨텍스트
│   ├── TokenCounter.tsx        # 우측 하단 비용 표시
│   ├── Button.tsx              # ripple 애플 버튼
│   ├── Checkmark.tsx           # 드로잉 애니메이션
│   └── Stars.tsx               # 별점
├── lib/
│   ├── types.ts                # Helper/Family/Match 타입
│   ├── distance.ts             # 지역 간 거리 테이블 (하드코딩)
│   ├── data.ts                 # JSON 파일 read/write
│   ├── claude.ts               # Anthropic SDK 래퍼 + 비용 자동 누적
│   └── cost.ts                 # 모델 단가 · 서버 메모리 누적
├── data/
│   ├── helpers.json            # 초기 []; 더미 생성 후 채워짐
│   ├── families.json           # 초기 []
│   └── matches.json            # 초기 []
├── scripts/
│   └── generate_dummy.py       # Haiku로 더미 데이터 일괄 생성
├── vercel.json                 # 배포 설정 (regions: icn1)
└── tailwind.config.ts          # 애플 스타일 디자인 토큰
```

## 기술 스택

- **Framework**: Next.js 15 (App Router) + React 18 + TypeScript
- **스타일**: Tailwind CSS (애플 Health/Fitness 스타일 토큰)
- **AI**: Anthropic Claude (Haiku 4.5 + Sonnet 4.6)
- **저장소**: JSON 파일 (실서비스라면 DB로 교체)
- **배포**: Vercel (서울 리전 `icn1`)

## 라이선스

샘플·데모 용도. 상업적 사용 전 라이선스 검토 필요.
