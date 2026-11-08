import { emptyArchive } from "../src/lib/data.js";
import type { Archive, EatingRecord } from "../src/types/model.js";

export const SAMPLE_NOW = new Date("2026-11-08T03:00:00Z");
const U = "sample-user";
const base = (id: string, at = "2026-11-01T00:00:00.000Z") => ({ id, user_id: U, created_at: at });

/** Invented archive for the sample output and tests. No real records. */
export function sampleArchive(): Archive {
  const a = emptyArchive();
  a.user = { id: U, display_name: "예시", created_at: "2026-10-01T00:00:00.000Z" };
  const names = ["가상 김치찌개", "가상 마라탕", "가상 크루아상", "가상 아메리카노", "가상 순두부", "가상 피자"];
  names.forEach((name, i) => a.menus.push({ ...base("m" + i), name, normalized_name: name, active: true }));
  a.places.push({ ...base("p0"), name: "가상 식당", normalized_name: "가상식당", place_type: "RESTAURANT" });
  a.brands.push({ ...base("b0"), name: "가상 브랜드", normalized_name: "가상브랜드" });
  const rec = (i: number, day: string, verdict: EatingRecord["verdict"], reorder: EatingRecord["reorder_intent"], note: string): EatingRecord => ({
    ...base("r" + i, day + "T09:00:00.000Z"), menu_id: "m" + i, place_id: i % 2 ? undefined : "p0",
    eaten_at: day, verdict, reorder_intent: reorder, short_note: note, updated_at: day + "T09:00:00.000Z",
  });
  a.records.push(
    rec(0, "2026-11-07", "LIKE", "YES", "국물이 깊었다"), rec(1, "2026-11-05", "NEUTRAL", "MAYBE", ""),
    rec(2, "2026-11-03", "LIKE", "YES", "바삭함"), rec(3, "2026-10-30", "DISLIKE", "NO", "너무 썼다"),
    rec(4, "2026-10-28", "LIKE", "MAYBE", "담백"), rec(5, "2026-10-20", "NEUTRAL", "NO", "평범"),
  );
  a.wishes.push(
    { ...base("w0", "2026-11-06T15:30:00.000Z"), target_type: "MENU", target_id: "m5" },
    { ...base("w1", "2026-11-02T01:00:00.000Z"), target_type: "PLACE", target_id: "p0" },
    { ...base("w2", "2026-10-25T01:00:00.000Z"), target_type: "BRAND", target_id: "b0" },
  );
  return a;
}
