import type { Location } from "./types";

const TABLE: Record<string, number> = {
  "봉천동|봉천동": 1,
  "봉천동|과천": 6,
  "과천|봉천동": 6,
  "봉천동|대치동": 15,
  "대치동|봉천동": 15,
  "과천|과천": 1,
  "과천|대치동": 10,
  "대치동|과천": 10,
  "대치동|대치동": 1,
};

export const MAX_DISTANCE = 10;
export const SERVICE_AREAS: Location[] = ["봉천동", "과천", "대치동"];

export function distance(a: Location, b: Location): number | null {
  const v = TABLE[`${a}|${b}`];
  return v === undefined ? null : v;
}

export function withinRange(a: Location, b: Location): boolean {
  const d = distance(a, b);
  return d !== null && d <= MAX_DISTANCE;
}
