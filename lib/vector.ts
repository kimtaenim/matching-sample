/**
 * Upstash Vector 클라이언트 래퍼
 *
 * Upstash Vector 인덱스를 BGE-M3 임베딩 모델로 생성해야 함.
 * 생성 시 Embedding Model = "bge-m3" 선택.
 * data 필드에 텍스트를 넣으면 Upstash가 자동으로 임베딩.
 */

import { Index } from "@upstash/vector";

let _index: Index | null = null;

function getIndex(): Index {
  if (!_index) {
    const url = process.env.UPSTASH_VECTOR_REST_URL;
    const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
    if (!url || !token) {
      throw new Error("UPSTASH_VECTOR_REST_URL / TOKEN이 설정되지 않았습니다.");
    }
    _index = new Index({ url, token });
  }
  return _index;
}

export interface VectorMetadata {
  [key: string]: unknown;
}

/**
 * 텍스트 데이터를 Upstash에 upsert (자동 임베딩)
 */
export async function upsertVector(
  id: string,
  text: string,
  metadata: VectorMetadata
): Promise<void> {
  const index = getIndex();
  await index.upsert({
    id,
    data: text,
    metadata,
  });
}

/**
 * 배치 upsert
 */
export async function upsertVectorBatch(
  items: { id: string; data: string; metadata: VectorMetadata }[]
): Promise<void> {
  const index = getIndex();
  await index.upsert(items);
}

/**
 * 유사도 검색 (텍스트 → 자동 임베딩 → 검색)
 */
export async function queryVector(
  text: string,
  topK: number = 10,
  filter?: string
): Promise<{ id: string; score: number; metadata: VectorMetadata }[]> {
  const index = getIndex();
  const results = await index.query({
    data: text,
    topK,
    includeMetadata: true,
    ...(filter ? { filter } : {}),
  });
  return results.map((r) => ({
    id: r.id as string,
    score: r.score,
    metadata: (r.metadata || {}) as VectorMetadata,
  }));
}
