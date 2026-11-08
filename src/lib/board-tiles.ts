/**
 * PALATE → Life Board tiles (manifest v1, board docs/TILES.md).
 *
 * `buildBoardTiles` is pure: the same archive and `now` always give the same manifest (no randomness,
 * no network, no storage), which is what lets the uploader skip a send whose content did not change.
 * Only approved, saved meals and wishes are used. Meal photos are `data:` images inside this browser,
 * which the board cannot show, so covers are letter cells (`{ mono }`).
 */
import type { Archive, EatingRecord } from "../types/model.js";

export const BOARD_APP = "food";
export const BOARD_HREF = "https://kingjnu-sakayume.github.io/food/";
const KST_MS = 9 * 3600 * 1000;
const VERDICT_LABEL = { LIKE: "호", NEUTRAL: "보통", DISLIKE: "불호" } as const;

export interface BoardCover { src?: string; alt?: string; mono?: string }
export interface BoardRow { title: string; value?: string; muted?: boolean }
export interface BoardTile {
  id: string; name: string; tone: "strip" | "type"; form?: "list" | "line";
  sizes: string[]; size: string; default: boolean; href: string; data: Record<string, unknown>;
}
export interface BoardManifest { version: 1; app: "food"; generated_at: string; tiles: BoardTile[] }

/** Cut to `max` UTF-16 units (JavaScript `.length`, as the board counts), with "…" when cut. */
export function cut(text: string, max: number): string {
  const s = text.trim().replace(/\s+/g, " ");
  if (s.length <= max) return s;
  let head = s.slice(0, max - 1);
  const last = head.charCodeAt(head.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return head.trimEnd() + "…";
}
const present = (s: string | undefined): string | undefined => (s && s.trim() ? s : undefined);
const mono = (s: string) => Array.from(s.trim())[0] ?? "";

/** "11/5" in the current (KST) year, "25/11/5" otherwise. Dates, never "yesterday". */
function shortDate(day: string, now: Date): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return undefined;
  const base = `${Number(m[2])}/${Number(m[3])}`;
  const year = new Date(now.getTime() + KST_MS).getUTCFullYear();
  return Number(m[1]) === year ? base : `${m[1].slice(2)}/${base}`;
}
const kstDay = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t + KST_MS).toISOString().slice(0, 10);
};

const newest = (a: EatingRecord, b: EatingRecord) =>
  b.eaten_at.localeCompare(a.eaten_at) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

export function buildBoardTiles(archive: Archive, now: Date): BoardManifest {
  const menus = new Map(archive.menus.map((m) => [m.id, m]));
  const places = new Map(archive.places.map((p) => [p.id, p]));
  const brands = new Map(archive.brands.map((b) => [b.id, b]));
  const records = archive.records.filter((r) => menus.has(r.menu_id) && present(menus.get(r.menu_id)!.name)).sort(newest);
  const tiles: BoardTile[] = [];

  // recent: latest meals, one cell per menu.
  const seen = new Set<string>();
  const items: Array<{ title: string; cover: BoardCover }> = [];
  for (const r of records) {
    if (seen.has(r.menu_id) || items.length >= 8) continue;
    seen.add(r.menu_id);
    const name = menus.get(r.menu_id)!.name;
    items.push({ title: cut(name, 30), cover: { mono: mono(name) } });
  }
  if (items.length)
    tiles.push({
      id: "recent", name: "PALATE · 최근 먹은 것", tone: "strip", sizes: ["2x1", "4x1"], size: "2x1", default: true, href: BOARD_HREF,
      data: { label: "PALATE", square: true, items },
    });

  // last: the most recent meal on one line.
  const last = records[0];
  if (last) {
    const menu = menus.get(last.menu_id)!;
    const place = last.place_id ? places.get(last.place_id)?.name : undefined;
    const date = shortDate(last.eaten_at, now);
    const note = present(last.short_note);
    const sub = [date, note && cut(note, 100)].filter(Boolean).join(" · ");
    tiles.push({
      id: "last", name: "PALATE · 마지막 식사", tone: "type", form: "line", sizes: ["2x1", "4x1"], size: "2x1", default: false, href: BOARD_HREF,
      data: {
        label: "마지막 식사",
        title: cut(present(place) ? `${menu.name} · ${place}` : menu.name, 160),
        ...(sub ? { sub } : {}),
        pill: VERDICT_LABEL[last.verdict],
      },
    });
  }

  // again: menus whose latest meal said "다시 먹는다".
  const latestByMenu = new Map<string, EatingRecord>();
  for (const r of records) if (!latestByMenu.has(r.menu_id)) latestByMenu.set(r.menu_id, r);
  const againRows: BoardRow[] = [...latestByMenu.values()]
    .filter((r) => r.reorder_intent === "YES").slice(0, 12)
    .map((r) => {
      const value = shortDate(r.eaten_at, now);
      return { title: cut(menus.get(r.menu_id)!.name, 80), ...(value ? { value } : {}) };
    });
  if (againRows.length)
    tiles.push({
      id: "again", name: "PALATE · 다시 먹을 것", tone: "type", form: "list", sizes: ["2x1", "2x2"], size: "2x2", default: false, href: BOARD_HREF,
      data: { label: "다시 먹을 것", rows: againRows },
    });

  // wish: saved wishes, newest first, with the day they were added.
  const wishRows: BoardRow[] = [];
  for (const w of [...archive.wishes].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))) {
    if (wishRows.length >= 12) break;
    const name = w.target_type === "MENU" ? menus.get(w.target_id)?.name
      : w.target_type === "PLACE" ? places.get(w.target_id)?.name : brands.get(w.target_id)?.name;
    if (!present(name)) continue;
    const value = shortDate(kstDay(w.created_at), now);
    wishRows.push({ title: cut(name!, 80), ...(value ? { value } : {}) });
  }
  if (wishRows.length || records.length)
    tiles.push({
      id: "wish", name: "PALATE · 먹고 싶은 것", tone: "type", form: "list", sizes: ["2x1", "2x2"], size: "2x2", default: false, href: BOARD_HREF,
      data: { label: "먹고 싶은 것", rows: wishRows.length ? wishRows : [{ title: "담아 둔 위시가 없어요", muted: true }] },
    });

  return { version: 1, app: BOARD_APP, generated_at: now.toISOString(), tiles };
}

/** The part of the manifest that decides whether a send is needed (everything but `generated_at`). */
export function boardBodyForHash(manifest: BoardManifest): string {
  return JSON.stringify({ version: manifest.version, app: manifest.app, tiles: manifest.tiles });
}
