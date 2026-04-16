import { callClaude, extractJson } from "./claude";
import type { Family, Helper, CareType, Gender, TokenDelta } from "./types";

/**
 * 대화형 파싱:
 * - 한 번의 Claude 호출로 "현재까지의 맥락 → parsed struct + 다음 질문" 을 생성
 * - 질문은 템플릿이 아닌 LLM이 맥락에 맞게 자연스럽게 작성
 * - 사용자의 자유로운 답변(예: "여자분이면 좋은데 꼭 그런 건 아녜요")도
 *   다음 호출에서 전체 bio를 함께 재파싱하여 반영
 */

export type ParsedFamily = {
  wage_max: number | null;
  care_type: CareType | null;
  hours: string | null;
  preferred_gender: Gender | null;
  care_age: number | null;
};

export type ParsedHelper = {
  wage_min: number | null;
  care_type: CareType[] | null;
  hours: string | null;
  preferred_gender: Gender | null;
  age: number | null;
};

export interface ChatResult<P> {
  parsed: P;
  done: boolean;
  next_question: string | null;
  next_key: string | null;
  next_type: "select" | "number" | "text" | null;
  next_options: string[] | null;
  usage: TokenDelta;
  cost_krw: number;
}

const CARE_TYPES: CareType[] = ["아동", "노인", "치매노인", "장애인", "환자"];
const GENDERS: Gender[] = ["무관", "남", "여"];

const FAMILY_PROMPT = (bio: string, turn: number, maxTurns: number) => `당신은 돌봄 매칭 서비스의 따뜻한 상담사입니다. 가정이 돌봄 도우미를 찾도록 돕습니다.

사용자가 지금까지 말한 내용(초기 설명 + Q/A 기록):
"""
${bio}
"""

[중요 원칙]
- 사용자가 앞선 답변을 나중에 번복하면 최신 답변을 우선.
- 질문에 맞지 않는 답을 해도 에러 내지 말고 받을 수 있는 만큼만 받아들이세요.
- 답이 애매하면 가장 그럴싸한 해석을 고르되, 정말 단서가 없으면 null.
- 한 턴 안에서 같은 항목에 대해 서로 모순된 정보가 섞여 있으면(예: "여자분이 좋지만 남자도 괜찮다") 그 항목을 null로 두고 다음 질문으로 공손히 재확인하세요.

[1단계] 다음 구조 필드를 최신 정보 기준으로 추출:
- care_type: "아동" | "노인" | "치매노인" | "장애인" | "환자" | null
- care_age: 돌봄 받으실 분 나이 숫자 | null   (예: "70대 후반"→77, "85세"→85)
- wage_max: 하루 최대 지불 의향 금액 숫자(원) | null  (예: "15만원"→150000)
- hours: 시간대 "HH:MM-HH:MM" | null  (예: "9시부터 6시"→"09:00-18:00")
- preferred_gender: "무관" | "남" | "여" | null  ("여성이 좋겠어요"→"여")

[2단계] 현재 ${turn}번째 턴 (최대 ${maxTurns}턴). 중요한 정보가 빠져 있으면 다음 질문 한 개를 친근한 한국어로. 템플릿 금지, 맥락 반영. 충분하면 next_question=null.

next_key는 질문이 겨냥하는 필드명(위 5개 중). next_type은 care_type="select" (${JSON.stringify(CARE_TYPES)}), preferred_gender="select" (${JSON.stringify(GENDERS)}), care_age·wage_max="number", hours="text".

반드시 JSON만, 아무 설명 없이:
{
  "parsed": { "care_type": ..., "care_age": ..., "wage_max": ..., "hours": ..., "preferred_gender": ... },
  "next_question": "..." | null,
  "next_key": "care_age" | null,
  "next_type": "select"|"number"|"text" | null,
  "next_options": ["..."] | null
}`;

const HELPER_PROMPT = (bio: string, turn: number, maxTurns: number) => `당신은 돌봄 매칭 서비스의 따뜻한 상담사입니다. 돌봄 도우미가 자신을 소개하도록 돕습니다.

지금까지의 내용:
"""
${bio}
"""

[중요 원칙]
- 앞선 답변 번복 시 최신 답변 우선.
- 질문과 상관없는 답도 에러 내지 말고 받을 수 있는 만큼 받아들이세요.
- 한 항목 안에서 모순된 정보가 섞이면 해당 항목 null로 두고 다음 질문에서 공손히 재확인.

[1단계] 구조 필드 추출 (명시 없으면 null):
- care_type: ["아동"|"노인"|"치매노인"|"장애인"|"환자"] 배열 | null
- age: 도우미 본인 나이 | null
- wage_min: 희망 일당 최저 | null
- hours: 가능 시간대 "HH:MM-HH:MM" | null
- preferred_gender: "무관"|"남"|"여" | null

[2단계] ${turn}/${maxTurns}턴. 누락 중 중요 항목에 대해 맥락에 맞는 자연스러운 질문 1개. 템플릿 금지.

next_type: care_type은 "select" (${JSON.stringify(CARE_TYPES)}), preferred_gender은 "select" (${JSON.stringify(GENDERS)}), age·wage_min은 "number", hours는 "text".

JSON:
{
  "parsed": { "care_type": ..., "age": ..., "wage_min": ..., "hours": ..., "preferred_gender": ... },
  "next_question": "..." | null,
  "next_key": ... | null,
  "next_type": ... | null,
  "next_options": [...] | null
}`;

function coerceFamilyParsed(obj: Record<string, unknown>): ParsedFamily {
  return {
    wage_max: typeof obj.wage_max === "number" ? obj.wage_max : null,
    care_type:
      typeof obj.care_type === "string" &&
      (CARE_TYPES as string[]).includes(obj.care_type)
        ? (obj.care_type as CareType)
        : null,
    hours: typeof obj.hours === "string" ? obj.hours : null,
    preferred_gender: (GENDERS as string[]).includes(obj.preferred_gender as string)
      ? (obj.preferred_gender as Gender)
      : null,
    care_age: typeof obj.care_age === "number" ? obj.care_age : null,
  };
}

function coerceHelperParsed(obj: Record<string, unknown>): ParsedHelper {
  const ctArr = Array.isArray(obj.care_type)
    ? (obj.care_type.filter((x) => (CARE_TYPES as string[]).includes(x as string)) as CareType[])
    : [];
  return {
    wage_min: typeof obj.wage_min === "number" ? obj.wage_min : null,
    care_type: ctArr.length ? ctArr : null,
    hours: typeof obj.hours === "string" ? obj.hours : null,
    preferred_gender: (GENDERS as string[]).includes(obj.preferred_gender as string)
      ? (obj.preferred_gender as Gender)
      : null,
    age: typeof obj.age === "number" ? obj.age : null,
  };
}

export async function chatFamily(
  bio: string,
  turn: number,
  maxTurns: number
): Promise<ChatResult<ParsedFamily>> {
  let raw: Record<string, unknown> = {};
  let usage: TokenDelta = { input: 0, output: 0 };
  let cost_krw = 0;
  try {
    const r = await callClaude(FAMILY_PROMPT(bio, turn, maxTurns), {
      maxTokens: 700,
    });
    usage = r.usage;
    cost_krw = r.cost_krw;
    raw = extractJson<Record<string, unknown>>(r.text);
  } catch {
    // 전체 스킵 - 파싱 실패 처리
  }

  const parsed = coerceFamilyParsed((raw.parsed as Record<string, unknown>) || {});
  const nq = typeof raw.next_question === "string" ? raw.next_question : null;
  const nk = typeof raw.next_key === "string" ? raw.next_key : null;
  const nt = ["select", "number", "text"].includes(raw.next_type as string)
    ? (raw.next_type as "select" | "number" | "text")
    : null;
  const no = Array.isArray(raw.next_options) ? (raw.next_options as string[]) : null;

  // turn이 maxTurns 이상이면 강제 종료
  const reachedCap = turn >= maxTurns;
  // 필수가 안 갖춰졌으면 반드시 질문 (cap 전까지)
  const hasRequired = parsed.care_type !== null && parsed.care_age !== null;
  const done = reachedCap || (!nq) || hasRequired && !nq;

  return {
    parsed,
    done: reachedCap || !nq,
    next_question: reachedCap ? null : nq,
    next_key: reachedCap ? null : nk,
    next_type: reachedCap ? null : nt,
    next_options: reachedCap ? null : no,
    usage,
    cost_krw,
  };
}

export async function chatHelper(
  bio: string,
  turn: number,
  maxTurns: number
): Promise<ChatResult<ParsedHelper>> {
  let raw: Record<string, unknown> = {};
  let usage: TokenDelta = { input: 0, output: 0 };
  let cost_krw = 0;
  try {
    const r = await callClaude(HELPER_PROMPT(bio, turn, maxTurns), {
      maxTokens: 700,
    });
    usage = r.usage;
    cost_krw = r.cost_krw;
    raw = extractJson<Record<string, unknown>>(r.text);
  } catch {
    // skip
  }

  const parsed = coerceHelperParsed((raw.parsed as Record<string, unknown>) || {});
  const nq = typeof raw.next_question === "string" ? raw.next_question : null;
  const nk = typeof raw.next_key === "string" ? raw.next_key : null;
  const nt = ["select", "number", "text"].includes(raw.next_type as string)
    ? (raw.next_type as "select" | "number" | "text")
    : null;
  const no = Array.isArray(raw.next_options) ? (raw.next_options as string[]) : null;

  const reachedCap = turn >= maxTurns;

  return {
    parsed,
    done: reachedCap || !nq,
    next_question: reachedCap ? null : nq,
    next_key: reachedCap ? null : nk,
    next_type: reachedCap ? null : nt,
    next_options: reachedCap ? null : no,
    usage,
    cost_krw,
  };
}

/** null 필드에 최소 기본값 주입 (매칭을 위한 구조 충족용) */
export function finalizeFamily(p: ParsedFamily): Family["parsed"] {
  return {
    wage_max: p.wage_max ?? 999999,
    care_type: p.care_type ?? "환자",
    hours: p.hours ?? "00:00-24:00",
    preferred_gender: p.preferred_gender ?? "무관",
    care_age: p.care_age ?? 0,
  };
}
export function finalizeHelper(p: ParsedHelper): Helper["parsed"] {
  return {
    wage_min: p.wage_min ?? 0,
    care_type:
      p.care_type ?? (["환자", "노인", "아동", "치매노인", "장애인"] as CareType[]),
    hours: p.hours ?? "00:00-24:00",
    preferred_gender: p.preferred_gender ?? "무관",
    age: p.age ?? 0,
  };
}
