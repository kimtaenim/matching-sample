import { callClaude, extractJson } from "./claude";
import type { Helper, Family, TokenDelta, CareType, Gender } from "./types";

/**
 * 자연어 bio에서 구조 필드를 관대하게 추출.
 *
 * 원칙:
 * - Claude에 "명시되지 않은 값은 null" 지시
 * - 파싱 후 누락된 필드는 기본값으로 덮지 않고 `missing` 목록으로 반환
 * - API 레이어에서 missing을 사용자에게 되묻기 → follow-up 답변과 병합
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

export interface MissingField {
  key: string;
  label: string;
  type: "select" | "number" | "text";
  options?: string[];
  placeholder?: string;
}

interface ParseResult<T> {
  parsed: T;
  missing: MissingField[];
  usage: TokenDelta;
  cost_krw: number;
}

const CARE_TYPES: CareType[] = ["아동", "노인", "치매노인", "장애인", "환자"];
const GENDERS: Gender[] = ["무관", "남", "여"];

const FAMILY_PROMPT = (bio: string) => `아래 가정의 돌봄 조건 자연어 설명을 구조화해서 JSON으로만 응답해주세요.

중요:
- 설명에 명시되지 않은 값은 반드시 null.
- 절대 추측해서 채우지 마세요.
- "70대 후반" 같은 나이는 77처럼 대표 숫자로 변환 가능.

조건 설명: """${bio}"""

JSON 형식:
{
  "wage_max": 일당 원화 숫자 | null,
  "care_type": "아동"|"노인"|"치매노인"|"장애인"|"환자" | null,
  "hours": "HH:MM-HH:MM" | null,
  "preferred_gender": "무관"|"남"|"여" | null,
  "care_age": 숫자 | null
}`;

const HELPER_PROMPT = (bio: string) => `아래 돌봄 도우미의 자기소개를 구조화해서 JSON으로만 응답해주세요.

중요:
- 소개에 명시되지 않은 값은 반드시 null.
- 절대 추측하지 마세요.
- care_type은 해당되는 것들을 배열로. 해당 없으면 null.

자기소개: """${bio}"""

JSON 형식:
{
  "wage_min": 일당 원화 숫자 | null,
  "care_type": ["아동"|"노인"|"치매노인"|"장애인"|"환자"] | null,
  "hours": "HH:MM-HH:MM" | null,
  "preferred_gender": "무관"|"남"|"여" | null,
  "age": 숫자 | null
}`;

export async function parseFamilyBio(bio: string): Promise<ParseResult<ParsedFamily>> {
  let obj: Record<string, unknown> = {};
  let usage: TokenDelta = { input: 0, output: 0 };
  let cost_krw = 0;
  try {
    const r = await callClaude(FAMILY_PROMPT(bio), { maxTokens: 400 });
    usage = r.usage;
    cost_krw = r.cost_krw;
    obj = extractJson<Record<string, unknown>>(r.text);
  } catch {
    // 전체 null 처리
  }

  const parsed: ParsedFamily = {
    wage_max: typeof obj.wage_max === "number" ? obj.wage_max : null,
    care_type:
      typeof obj.care_type === "string" &&
      (CARE_TYPES as string[]).includes(obj.care_type)
        ? (obj.care_type as CareType)
        : null,
    hours: typeof obj.hours === "string" ? obj.hours : null,
    preferred_gender:
      (GENDERS as string[]).includes(obj.preferred_gender as string)
        ? (obj.preferred_gender as Gender)
        : null,
    care_age: typeof obj.care_age === "number" ? obj.care_age : null,
  };

  const missing: MissingField[] = [];
  if (parsed.care_type == null) {
    missing.push({
      key: "care_type",
      label: "어떤 돌봄이 필요하세요?",
      type: "select",
      options: CARE_TYPES,
    });
  }
  if (parsed.care_age == null) {
    missing.push({
      key: "care_age",
      label: "돌봄 받으실 분의 나이",
      type: "number",
      placeholder: "예: 78",
    });
  }
  if (parsed.preferred_gender == null) {
    missing.push({
      key: "preferred_gender",
      label: "선호하는 도우미 성별",
      type: "select",
      options: GENDERS,
    });
  }
  if (parsed.hours == null) {
    missing.push({
      key: "hours",
      label: "필요한 시간대",
      type: "text",
      placeholder: "예: 09:00-18:00 (모르면 비워두세요)",
    });
  }
  if (parsed.wage_max == null) {
    missing.push({
      key: "wage_max",
      label: "일당 상한 (원)",
      type: "number",
      placeholder: "예: 150000 (모르면 비워두세요)",
    });
  }

  return { parsed, missing, usage, cost_krw };
}

export async function parseHelperBio(bio: string): Promise<ParseResult<ParsedHelper>> {
  let obj: Record<string, unknown> = {};
  let usage: TokenDelta = { input: 0, output: 0 };
  let cost_krw = 0;
  try {
    const r = await callClaude(HELPER_PROMPT(bio), { maxTokens: 400 });
    usage = r.usage;
    cost_krw = r.cost_krw;
    obj = extractJson<Record<string, unknown>>(r.text);
  } catch {
    // 전체 null 처리
  }

  const ctArr =
    Array.isArray(obj.care_type)
      ? (obj.care_type.filter((x) =>
          (CARE_TYPES as string[]).includes(x as string)
        ) as CareType[])
      : [];

  const parsed: ParsedHelper = {
    wage_min: typeof obj.wage_min === "number" ? obj.wage_min : null,
    care_type: ctArr.length ? ctArr : null,
    hours: typeof obj.hours === "string" ? obj.hours : null,
    preferred_gender:
      (GENDERS as string[]).includes(obj.preferred_gender as string)
        ? (obj.preferred_gender as Gender)
        : null,
    age: typeof obj.age === "number" ? obj.age : null,
  };

  const missing: MissingField[] = [];
  if (parsed.care_type == null) {
    missing.push({
      key: "care_type",
      label: "가능한 돌봄 유형 (하나 선택)",
      type: "select",
      options: CARE_TYPES,
    });
  }
  if (parsed.age == null) {
    missing.push({
      key: "age",
      label: "나이",
      type: "number",
      placeholder: "예: 52",
    });
  }
  if (parsed.preferred_gender == null) {
    missing.push({
      key: "preferred_gender",
      label: "선호하는 가정 성별 (없으면 무관)",
      type: "select",
      options: GENDERS,
    });
  }
  if (parsed.hours == null) {
    missing.push({
      key: "hours",
      label: "가능한 시간대",
      type: "text",
      placeholder: "예: 09:00-18:00 (모르면 비워두세요)",
    });
  }
  if (parsed.wage_min == null) {
    missing.push({
      key: "wage_min",
      label: "희망 일당 최저 (원)",
      type: "number",
      placeholder: "예: 100000 (모르면 비워두세요)",
    });
  }

  return { parsed, missing, usage, cost_krw };
}

/** follow-up answers를 parsed 필드에 머지. 빈 값은 무시. */
export function mergeFamilyAnswers(
  parsed: ParsedFamily,
  answers: Record<string, unknown>
): ParsedFamily {
  const out = { ...parsed };
  if (typeof answers.wage_max === "number") out.wage_max = answers.wage_max;
  if (
    typeof answers.care_type === "string" &&
    (CARE_TYPES as string[]).includes(answers.care_type)
  )
    out.care_type = answers.care_type as CareType;
  if (typeof answers.hours === "string" && answers.hours.trim())
    out.hours = answers.hours;
  if (
    (GENDERS as string[]).includes(answers.preferred_gender as string)
  )
    out.preferred_gender = answers.preferred_gender as Gender;
  if (typeof answers.care_age === "number") out.care_age = answers.care_age;
  return out;
}

export function mergeHelperAnswers(
  parsed: ParsedHelper,
  answers: Record<string, unknown>
): ParsedHelper {
  const out = { ...parsed };
  if (typeof answers.wage_min === "number") out.wage_min = answers.wage_min;
  if (typeof answers.care_type === "string" &&
    (CARE_TYPES as string[]).includes(answers.care_type))
    out.care_type = [answers.care_type as CareType];
  if (typeof answers.hours === "string" && answers.hours.trim())
    out.hours = answers.hours;
  if ((GENDERS as string[]).includes(answers.preferred_gender as string))
    out.preferred_gender = answers.preferred_gender as Gender;
  if (typeof answers.age === "number") out.age = answers.age;
  return out;
}

/** 저장용 최종 struct (null → 데모상 동작을 위한 최소값). */
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

/** 필수 필드만 판단하여 must_ask 모드 결정 (최소: care_type, care_age or age). */
export function isFamilyReady(p: ParsedFamily): boolean {
  return p.care_type !== null && p.care_age !== null;
}
export function isHelperReady(p: ParsedHelper): boolean {
  return p.care_type !== null && p.age !== null;
}

/** 누락 키 하나를 골라 자연스러운 한국어 질문으로 변환 (템플릿). */
export function nextQuestion(missing: MissingField[], skippedKeys: string[] = []): MissingField | null {
  const remaining = missing.filter((m) => !skippedKeys.includes(m.key));
  if (!remaining.length) return null;
  return remaining[0];
}

export function questionText(m: MissingField): string {
  switch (m.key) {
    case "care_type":
      return "어떤 돌봄이 필요하신지 알려주세요. 아동, 노인, 치매노인, 장애인, 환자 중에서요.";
    case "care_age":
      return "돌봄 받으실 분의 연세가 어떻게 되세요?";
    case "preferred_gender":
      return "도우미 성별로 선호하시는 쪽이 있으세요? 없으시면 '무관'이라고 말씀해주셔도 됩니다.";
    case "hours":
      return "어느 시간대에 도움이 필요하세요? 예를 들어 '오전 9시부터 오후 6시까지'처럼 말씀해주세요.";
    case "wage_max":
      return "하루 급여로 생각하시는 금액이 있으신가요? 괜찮으시면 숫자로 알려주세요.";
    case "age":
      return "나이를 알려주실 수 있을까요?";
    case "wage_min":
      return "희망하시는 일당은 얼마 정도세요?";
    default:
      return `${m.label}을(를) 알려주시겠어요?`;
  }
}
