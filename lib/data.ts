import { promises as fs } from "fs";
import path from "path";
import type { Helper, Family, Match } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

async function readJson<T>(file: string): Promise<T> {
  const raw = await fs.readFile(path.join(DATA_DIR, file), "utf-8");
  return JSON.parse(raw) as T;
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.writeFile(
    path.join(DATA_DIR, file),
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}

export async function getHelpers(): Promise<Helper[]> {
  return readJson<Helper[]>("helpers.json");
}

export async function getFamilies(): Promise<Family[]> {
  return readJson<Family[]>("families.json");
}

export async function getMatches(): Promise<Match[]> {
  return readJson<Match[]>("matches.json");
}

export async function saveHelpers(helpers: Helper[]): Promise<void> {
  await writeJson("helpers.json", helpers);
}

export async function saveFamilies(families: Family[]): Promise<void> {
  await writeJson("families.json", families);
}

export async function saveMatches(matches: Match[]): Promise<void> {
  await writeJson("matches.json", matches);
}

export async function getHelper(id: string): Promise<Helper | undefined> {
  const arr = await getHelpers();
  return arr.find((h) => h.id === id);
}

export async function getFamily(id: string): Promise<Family | undefined> {
  const arr = await getFamilies();
  return arr.find((f) => f.id === id);
}

export function nextId(prefix: "h" | "f" | "m", existing: { id: string }[]): string {
  const nums = existing
    .map((x) => parseInt(x.id.slice(1), 10))
    .filter((n) => !Number.isNaN(n));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(n).padStart(3, "0")}`;
}
