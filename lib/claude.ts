import Anthropic from "@anthropic-ai/sdk";
import { addCost } from "./cost";
import type { TokenDelta } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function client() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
    }
    _client = new Anthropic();
  }
  return _client;
}

export interface ClaudeResult {
  text: string;
  usage: TokenDelta;
  cost_krw: number;
  model: string;
}

export interface CallOptions {
  maxTokens?: number;
  model?: string;
}

export async function callClaude(
  prompt: string,
  options: CallOptions = {}
): Promise<ClaudeResult> {
  const model = options.model || DEFAULT_MODEL;
  let resp;
  try {
    resp = await client().messages.create({
      model,
      max_tokens: options.maxTokens || 1500,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (e) {
    throw new Error(`Claude API 호출 실패: ${(e as Error).message}`);
  }
  const block = resp.content[0];
  const text = block?.type === "text" ? block.text : "";
  const usage: TokenDelta = {
    input: resp.usage.input_tokens,
    output: resp.usage.output_tokens,
  };
  const cost_krw = addCost(model, usage.input, usage.output);
  return { text, usage, cost_krw, model };
}

export function extractJson<T = unknown>(text: string): T {
  const firstObj = text.indexOf("{");
  const firstArr = text.indexOf("[");
  let start = -1;
  if (firstObj === -1) start = firstArr;
  else if (firstArr === -1) start = firstObj;
  else start = Math.min(firstObj, firstArr);
  if (start === -1) throw new Error("No JSON found: " + text.slice(0, 200));
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end === -1) throw new Error("Unbalanced JSON: " + text.slice(0, 200));
  return JSON.parse(text.slice(start, end + 1));
}
